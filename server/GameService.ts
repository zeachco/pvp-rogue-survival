import type { BalanceConfig } from "../common/balance.ts";
import { publicBalance } from "../common/balance.ts";
import { collectIntoInventory, emptyScraps, equipFromInventory, extractFromInventory, purgeFromInventory, purgeYield, removeEmptyInventoryTiles, sellFromInventory, sendFromInventory, upgradeFromInventory, type InventoryResult } from "../common/inventory.ts";
import { changeItemRarity, generateBuckler, generateItem, generateRelic, itemRequirementMultiplier, itemStackKey, nextRarity, rollRarity, starterClub, type ItemInstance, type WeaponClass } from "../common/items.ts";
import { ENEMY_BONUS_SKILLS } from "../common/content.ts";
import { DEFAULT_ALLOCATION, levelForXp, STAT_KEYS, validAllocation, ZERO_STATS, type Stats } from "../common/progression.ts";
import { PROTOCOL_VERSION, type ClientMessage, type CreepWave, type GroundDrop, type HeroSummary, type PlayerId, type PublicHeroProfile, type PublicPlayer, type RealmMember, type RealmState, type ServerMessage, type UnitBuild } from "../common/protocol.ts";
import { randomSeed, type RandomSource } from "../common/random.ts";
import { championCount, creepsWithSpellsCount, isIntroWave, regularCount, regularLevel, rivalLevel, rivalXpReward, spawnAtMs } from "../common/waves.ts";
import type { Player, PlayerRepository, QueuedEquipment } from "./domain.ts";

export interface GameServiceOptions { repository: PlayerRepository; balance: BalanceConfig; random: RandomSource; createId?: () => string; send: (playerId: PlayerId, message: ServerMessage) => void; logPlayerLifecycle?: (event: "connected" | "disconnected", player: Pick<Player, "id" | "name">) => void; logRealmLifecycle?: (event: "entered" | "left", playerId: PlayerId, realmId: string, opponentIds: PlayerId[]) => void }
interface Realm { id: string; soloId: PlayerId; teamIds: PlayerId[]; down: Set<PlayerId> }
const MAX_QUEUE = 1000;

export class GameService {
  private readonly createId: () => string;
  private readonly realms = new Map<string, Realm>();
  private lastDispatchAt = Date.now();
  constructor(private readonly options: GameServiceOptions) { this.createId = options.createId ?? (() => crypto.randomUUID()); }

  join(name: string, heroId?: PlayerId, onIdentified?: (playerId: PlayerId) => void): Player {
    const player = this.joinPlayer(name, heroId); this.options.repository.markDirty(player.id); onIdentified?.(player.id); this.options.logPlayerLifecycle?.("connected", player); const created = this.matchWaitingPlayers();
    this.options.send(player.id, { type: "welcome", playerId: player.id, player: this.publicPlayer(player), progress: player.progress, panelTriggers: player.panelTriggers, realm: this.realmState(player), config: { waveIntervalMs: this.options.balance.wave.intervalMs, protocolVersion: PROTOCOL_VERSION, maxRealmAttackers: 3, maxQueuedItems: MAX_QUEUE, balance: publicBalance(this.options.balance) } });
    this.broadcastRealms();
    if (created.length) for (const realm of created) this.activateRealm(realm); else if (!player.realmId) this.dispatchCurrentWave(player, "training");
    return player;
  }

  disconnect(playerId: PlayerId): void { const player = this.options.repository.get(playerId); if (!player) return; player.connected = false; this.options.logPlayerLifecycle?.("disconnected", player); if (player.realmId) this.dissolveRealm(player.realmId); for (const realm of this.matchWaitingPlayers()) this.activateRealm(realm); this.broadcastRealms(); }

  logout(playerId: PlayerId): void { const player = this.options.repository.get(playerId); if (!player) return; this.disconnect(playerId); player.realmOptedIn = false; player.realmId = undefined; player.issuedUnits.clear(); player.groundDrops.clear(); player.deferredItems.length = 0; player.incomingQueues.clear(); player.backlashQueue.length = 0; for (const other of this.options.repository.values()) { other.incomingQueues.delete(playerId); other.backlashQueue = other.backlashQueue.filter((entry) => entry.senderId !== playerId); } this.options.repository.markDirty(player.id); }
  findPlayer(heroId?: string, username?: string): Player | undefined { return heroId ? this.options.repository.get(heroId) : username ? this.options.repository.getByUsername(username) : undefined; }
  leaderboard(): HeroSummary[] { return [...this.options.repository.values()].map((player) => ({ id: player.id, username: player.name, level: player.progress.level, receivesDeathEchoes: false })).sort((a, b) => b.level - a.level || a.username.localeCompare(b.username)).map((hero, index) => ({ ...hero, receivesDeathEchoes: index === 0 })); }
  publicHeroProfile(heroId: string): PublicHeroProfile | undefined { const player = this.options.repository.get(heroId); if (!player) return undefined; const p = player.progress; return { id: player.id, username: player.name, level: p.level, maxWaveReached: player.maxWaveReached, stats: p.stats, mainHand: p.mainHand, offHand: p.offHand, learnedSkills: p.learnedSkills, learnedSkillLevels: p.learnedSkillLevels, universalSkills: p.universalSkills }; }

  handle(playerId: PlayerId, message: Exclude<ClientMessage, { type: "join" }>): void {
    const player = this.options.repository.get(playerId); if (!player) return;
    try { switch (message.type) {
      case "updateAllocation": if (!validAllocation(message.allocation)) return this.notice(player, "Allocation must use non-negative integers totaling 5."); player.progress.allocation = { ...message.allocation }; return this.sendProgress(player, "Future level allocation updated.");
      case "respecStats": return this.respecStats(player, message.allocation);
      case "creepDefeated": return this.resolveDefeat(player, message.unitId);
      case "collectDrop": return this.collectDrop(player, message.dropId);
      case "reconcileDrops": return this.reconcileDrops(player, message.activeDropIds, message.pendingDropIds);
      case "deferDrop": return this.deferDrop(player, message.dropId);
      case "heroDefeated": return this.heroDefeated(player, message.sourceUnitId);
      case "suicide": this.heroDefeated(player, undefined, true); return this.options.send(player.id, { type: "suicideResolved" });
      case "requestWave": return this.dispatchCurrentWave(player, this.waveMode(player));
      case "equipItem": return this.applyInventoryResult(player, equipFromInventory(player.progress, message.tileId));
      case "sellItem": return this.applyInventoryAction(player, message.bulk, () => sellFromInventory(player.progress, message.tileId));
      case "purgeItem": return this.applyInventoryAction(player, message.bulk, () => purgeFromInventory(player.progress, message.tileId));
      case "upgradeItem": return this.applyInventoryAction(player, message.bulk, () => upgradeFromInventory(player.progress, message.tileId, () => this.createId(), () => this.seed()));
      case "extractSkill": return this.applyInventoryAction(player, message.bulk, () => extractFromInventory(player.progress, message.tileId));
      case "sendItem": return this.sendItem(player, message.tileId, message.bulk);
      case "leaveRealm": return this.leaveRealm(player);
      case "enterRealm": return this.enterRealm(player);
      case "scoreSnapshot": case "logout": case "listHeroes": case "inspectHero": return;
      case "dismissPanelTrigger": player.panelTriggers[message.panel] = false; return;
    } } finally { this.options.repository.markDirty(player.id); }
  }

  dispatchWaves(): void {
    this.lastDispatchAt = Date.now(); for (const realm of this.realms.values()) realm.down.clear();
    for (const player of this.options.repository.values()) if (player.connected) { if (player.realmId || player.realmOptedIn) player.waveNumber += 1; this.dispatchCurrentWave(player, this.waveMode(player)); this.options.repository.markDirty(player.id); }
    this.broadcastRealms();
  }

  private joinPlayer(name: string, heroId?: PlayerId): Player {
    const trimmed = name.trim().slice(0, 20); const existing = heroId ? this.options.repository.get(heroId) : this.options.repository.getByUsername(trimmed);
    if (existing) { existing.connected = true; existing.realmOptedIn = false; existing.waitingSince = Date.now(); removeEmptyInventoryTiles(existing.progress); return existing; }
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(trimmed)) throw new Error("Invalid username.");
    const mainHand = starterClub(); const starterItems = Array.from({ length: 3 }, () => { const seed = this.seed(); const roll = this.options.random.next(); return roll < 0.7 ? generateItem(0, "common", seed) : roll < 0.85 ? generateBuckler(0, "common", seed) : generateRelic(0, "common", seed); });
    const inventoryTiles: Player["progress"]["inventoryTiles"] = []; for (const item of starterItems) { const key = itemStackKey(item); const existing = inventoryTiles.find((tile) => tile.key === key); if (existing) existing.quantity += 1; else inventoryTiles.push({ id: `starter-random-tile-${inventoryTiles.length}`, key, item, quantity: 1 }); }
    const player: Player = { id: this.createId(), name: trimmed, score: 0, waveNumber: 0, maxWaveReached: 0, connected: true, realmOptedIn: false, waitingSince: Date.now(), outgoingRotation: 0, queueCursor: 0,
      issuedUnits: new Map(), groundDrops: new Map(), deferredItems: [], incomingQueues: new Map(), backlashQueue: [], deathEchoes: [],
      panelTriggers: { character: true, inventory: true }, progress: { level: 0, xp: 0, stats: { ...ZERO_STATS }, allocation: { ...DEFAULT_ALLOCATION }, gold: 0, souls: 0, scraps: emptyScraps(), mainHand, offHand: undefined, inventoryTiles, learnedSkills: ["healing", "rent"], learnedSkillLevels: { healing: 1, rent: 1 }, universalSkills: ["healing", "rent"] } };
    this.options.repository.save(player); return player;
  }

  private dispatchCurrentWave(player: Player, mode: "competitive" | "solo" | "training", resetHero = false): void {
    if (mode !== "training") player.maxWaveReached = Math.max(player.maxWaveReached, player.waveNumber);
    const count = regularCount(player.waveNumber, this.options.balance); const level = regularLevel(player.waveNumber, player.progress.level, count, this.options.balance); const seed = this.seed(); const intro = isIntroWave(player.waveNumber);
    const meleeClasses: WeaponClass[] = ["club", "sword", "dagger", "mace", "axe", "hammer"];
    const template = this.generateBuild("Perimeter creep", level, false, seed, undefined, true, intro ? meleeClasses : undefined); const spawns: CreepWave["spawns"] = [];
    const queued = this.takeQueued(player, count, mode !== "training");
    const skilledCount = ENEMY_BONUS_SKILLS.length ? creepsWithSpellsCount(player.waveNumber, count) : 0;
    for (let index = 0; index < count; index += 1) {
      const bonusSkills = index < skilledCount ? [ENEMY_BONUS_SKILLS[Math.floor(this.options.random.next() * ENEMY_BONUS_SKILLS.length)]] : [];
      let build: UnitBuild = { ...template, id: this.createId(), carried: [...template.carried], bonusSkills };
      const entry = queued[index]; if (entry) build = this.applyQueuedEquipment(build, entry, level, intro);
      player.issuedUnits.set(build.id, { build, mode }); spawns.push({ build, spawnAtMs: spawnAtMs(index, count, this.options.balance) });
    }
    if (!intro) for (const echo of player.deathEchoes.splice(0)) { player.issuedUnits.set(echo.id, { build: echo, mode }); spawns.push({ build: echo, spawnAtMs: this.options.balance.wave.prepareMs }); }
    const opponent = this.realmOpponents(player)[0]; const championLevel = rivalLevel(player.waveNumber, this.options.balance);
    for (let index = 0; index < championCount(player.waveNumber); index += 1) {
      const champion = this.generateBuild(opponent ? `${opponent.name}'s champion` : "Wandering champion", championLevel, true, this.seed(), opponent ? scaledStats(opponent.progress.allocation, championLevel) : undefined, false, intro ? meleeClasses : undefined);
      player.issuedUnits.set(champion.id, { build: champion, mode }); spawns.push({ build: champion, spawnAtMs: this.options.balance.wave.prepareMs + Math.floor(7.5 * this.options.balance.wave.batchIntervalMs) });
    }
    spawns.sort((a, b) => a.spawnAtMs - b.spawnAtMs);
    this.options.send(player.id, { type: "incomingWave", wave: { id: this.createId(), targetId: player.id, waveNumber: player.waveNumber, durationMs: this.options.balance.wave.intervalMs, mode, resetHero, spawns } }); this.returnDeferredItems(player);
  }

  private generateBuild(name: string, level: number, isRival: boolean, seed: number, suppliedStats?: Stats, fewerItems = false, allowedClasses?: WeaponClass[]): UnitBuild {
    const stats = suppliedStats ?? scaledStats(randomAllocation(seed), level); const mainHand = generateItem(level, rollRarity(seed + 11), seed + 17, { fewerAffixes: fewerItems, allowedClasses });
    const offHandRoll = this.options.random.next(); const offHand = !allowedClasses && mainHand.hands === 1 && offHandRoll < 0.25 ? (offHandRoll < 0.125 ? generateBuckler(level, rollRarity(seed + 19), seed + 21) : generateRelic(level, rollRarity(seed + 19), seed + 21)) : undefined;
    const carried = isRival && level > 0 ? [generateItem(level, rollRarity(seed + 23), seed + 29, { fewerAffixes: true })] : [];
    return { id: this.createId(), name, kind: isRival ? "rival" : mainHand.definitionId === "staff" ? "bubbleShooter" : "melee", level, stats, mainHand, offHand, carried, bonusSkills: [], isRival, xpReward: isRival ? rivalXpReward(level) : 10 + level, goldReward: isRival ? 3 + Math.floor(level / 2) : 1 + Math.floor(level / 5), seed };
  }

  private applyQueuedEquipment(build: UnitBuild, queued: QueuedEquipment, level: number, intro = false): UnitBuild {
    const item = queued.item; let mainHand = build.mainHand; let offHand = build.offHand;
    if (intro && (item.itemKind !== "weapon" || item.definitionId === "staff" || item.definitionId === "throwingAxe")) return { ...build, carried: [...build.carried, item], emitterId: queued.senderId, emitterName: queued.senderName, backlash: queued.backlash };
    if (item.itemKind !== "weapon") { if (mainHand.hands === 2) mainHand = generateItem(level, item.rarity, this.seed(), { allowedClasses: ["club", "sword", "dagger", "mace", "axe", "throwingAxe", "hammer"] as WeaponClass[] }); offHand = item; }
    else { mainHand = item; if (item.hands === 2) offHand = undefined; }
    return { ...build, name: `${queued.senderName}'s carrier`, kind: mainHand.definitionId === "staff" ? "bubbleShooter" : "melee", mainHand, offHand, emitterId: queued.senderId, emitterName: queued.senderName, backlash: queued.backlash };
  }

  private takeQueued(player: Player, limit: number, includeBacklash = true): QueuedEquipment[] {
    const sources = [...player.incomingQueues.entries()].filter(([, queue]) => queue.length).map(([id, queue]) => ({ id, queue })); if (includeBacklash && player.backlashQueue.length) sources.push({ id: "backlash", queue: player.backlashQueue });
    const result: QueuedEquipment[] = []; while (result.length < limit && sources.some((source) => source.queue.length)) { const source = sources[player.queueCursor++ % sources.length]; const item = source.queue.shift(); if (item) result.push(item); }
    for (const [id, queue] of player.incomingQueues) if (!queue.length) player.incomingQueues.delete(id); return result;
  }

  private resolveDefeat(player: Player, unitId: string): void {
    const issued = player.issuedUnits.get(unitId); if (!issued) return this.notice(player, "Ignored an unknown or already resolved enemy."); player.issuedUnits.delete(unitId);
    if (issued.mode === "training") return this.options.send(player.id, { type: "creepDefeatResolved", unitId, score: player.score, progress: player.progress, reason: "Training kill: no rewards." });
    const build = issued.build; player.score += build.isRival ? 10 : 2; const xp = Math.floor(build.xpReward * this.options.balance.rewards.xpMultiplier * (issued.mode === "solo" ? 0.5 : 1));
    this.grantXp(player, xp); const drop = this.rollDrop(player, build); const reason = drop ? `Gained ${xp} XP. A ${drop.kind} reward dropped.` : `Gained ${xp} XP.`;
    this.options.send(player.id, { type: "creepDefeatResolved", unitId, score: player.score, progress: player.progress, drop, reason }); this.broadcastRealms();
  }

  private rollDrop(player: Player, build: UnitBuild): GroundDrop | undefined {
    const buckler = player.progress.offHand?.itemKind === "buckler" ? player.progress.offHand : undefined; const effectiveness = buckler ? itemRequirementMultiplier(buckler, player.progress.stats) : 1; const goldGain = (buckler?.modifiers.goldGain ?? 0) * effectiveness; const rarityBoost = (buckler?.modifiers.rarityBoost ?? 0) * effectiveness;
    const goldChance = Math.min(1, (build.isRival ? 0.5 : 0.2) * this.options.balance.rewards.goldChanceMultiplier);
    if (this.options.random.next() < goldChance) { const drop: GroundDrop = { id: this.createId(), kind: "gold", amount: Math.ceil(build.goldReward * (1 + goldGain)) }; player.groundDrops.set(drop.id, drop); return drop; }
    const sent = build.emitterId ? (build.mainHand.id.includes("sent") ? build.mainHand : build.offHand?.id.includes("sent") ? build.offHand : undefined) : undefined;
    for (const item of [sent, sent?.id === build.mainHand.id ? undefined : build.mainHand, sent?.id === build.offHand?.id ? undefined : build.offHand, ...build.carried].filter(Boolean) as ItemInstance[]) {
      const chance = Math.min(this.options.balance.rewards.maxDropChance, item.dropChance * this.options.balance.rewards.dropChanceMultiplier); if (this.options.random.next() >= chance) continue;
      const id = this.createId(); const promoted = rarityBoost > 0 && nextRarity(item.rarity) && this.options.random.next() < rarityBoost ? changeItemRarity(item, nextRarity(item.rarity)!, this.seed()) : item; if (this.options.random.next() < 0.25) { const drop: GroundDrop = { id, kind: "scrap", rarity: promoted.rarity, amount: purgeYield(promoted) }; player.groundDrops.set(id, drop); return drop; }
      const dropped = { ...promoted, id: `${promoted.id}-drop-${id}` }; const drop: GroundDrop = { id, kind: "item", item: dropped }; player.groundDrops.set(id, drop); return drop;
    }
  }

  private collectDrop(player: Player, dropId: string): void { const drop = player.groundDrops.get(dropId); if (!drop) return this.options.send(player.id, { type: "collectItemResult", dropId, collected: false, reason: "That drop is no longer available." }); let changed = true; let reason: string; if (drop.kind === "gold") { player.progress.gold += drop.amount; reason = `Collected ${drop.amount} gold.`; } else if (drop.kind === "scrap") { player.progress.scraps[drop.rarity] += drop.amount; reason = `Collected ${drop.amount} ${drop.rarity} scrap.`; } else { const result = collectIntoInventory(player.progress, drop.item, () => this.createId(), () => this.seed()); changed = result.changed; reason = result.reason; } if (changed) player.groundDrops.delete(dropId); this.options.send(player.id, { type: "collectItemResult", dropId, collected: changed, reason }); if (changed) this.sendProgress(player, reason); }
  private reconcileDrops(player: Player, activeDropIds: string[], pendingDropIds: string[]): void { const reported = new Set([...activeDropIds, ...pendingDropIds]); const ledger = new Set(player.groundDrops.keys()); const drops = [...player.groundDrops.values()].filter((drop) => !reported.has(drop.id)); const removeDropIds = activeDropIds.filter((id) => !ledger.has(id)); const resolvedDropIds = pendingDropIds.filter((id) => !ledger.has(id)); this.options.send(player.id, { type: "dropsReconciled", drops, removeDropIds, resolvedDropIds }); }
  private deferDrop(player: Player, dropId: string): void { const drop = player.groundDrops.get(dropId); if (!drop || drop.kind !== "item") return this.notice(player, "Only an owned equipment drop can leave the realm."); player.groundDrops.delete(dropId); player.deferredItems.push(drop.item); this.notice(player, `${drop.item.name} will return next wave.`); }
  private returnDeferredItems(player: Player): void { if (!player.deferredItems.length) return; const deferred = player.deferredItems.splice(0); let stored = 0; for (const item of deferred) { const result = collectIntoInventory(player.progress, item, () => this.createId(), () => this.seed()); if (result.changed) stored += 1; else { const id = this.createId(); const drop: GroundDrop = { id, kind: "item", item: { ...item, id: `${item.id}-return-${id}` } }; player.groundDrops.set(id, drop); this.options.send(player.id, { type: "groundDropCreated", drop }); } } if (stored) this.sendProgress(player, `Returned ${stored} deferred item${stored === 1 ? "" : "s"} from the previous wave.`); }

  private heroDefeated(player: Player, sourceUnitId?: string, voluntary = false): void {
    if (!voluntary && !player.realmId && !player.realmOptedIn) return this.notice(player, "Training Grounds prevent defeat.");
    player.maxWaveReached = Math.max(player.maxWaveReached, player.waveNumber); this.queueDeathEcho(player);
    const source = sourceUnitId ? player.issuedUnits.get(sourceUnitId)?.build : undefined; const killer = source?.emitterId && !source.backlash && source.emitterId !== player.id ? this.options.repository.get(source.emitterId) : undefined;
    const lostGold = Math.floor(player.progress.gold / 2); const lostSouls = Math.floor(player.progress.souls / 2); player.progress.gold -= lostGold; player.progress.souls -= lostSouls;
    if (killer) { killer.progress.gold += lostGold; killer.progress.souls += lostSouls; this.options.repository.markDirty(killer.id); this.sendProgress(killer, `Defeat spoils: gained ${lostGold} Gold and ${lostSouls} Souls.`); }
    player.progress.xp = 0; player.progress.level = 0; player.progress.stats = { ...ZERO_STATS };
    player.waveNumber = 0; player.issuedUnits.clear(); player.groundDrops.clear(); this.options.repository.markDirty(player.id); this.sendProgress(player, `Defeated: XP, attributes, and wave reset; lost ${lostGold} Gold and ${lostSouls} Souls.`);
    this.options.send(player.id, { type: "waveAdjusted", waveNumber: 0, reason: "Wave reset to 0 after defeat." });
    if (player.realmId) { const realm = this.realms.get(player.realmId); if (realm) { realm.down.add(player.id); const side = realm.soloId === player.id ? [realm.soloId] : realm.teamIds; if (side.every((id) => realm.down.has(id))) { if (killer) { killer.progress.souls += 1; this.options.repository.markDirty(killer.id); this.sendProgress(killer, "Realm defeated: gained 1 Soul."); } this.dissolveRealm(realm.id); for (const created of this.matchWaitingPlayers()) this.activateRealm(created); } } }
    this.broadcastRealms();
  }

  private queueDeathEcho(player: Player): void {
    const recipient = [...this.options.repository.values()].sort((a, b) => b.progress.level - a.progress.level || a.name.localeCompare(b.name))[0];
    if (!recipient || recipient.id === player.id) return;
    const p = player.progress; const seed = this.seed(); const echo: UnitBuild = { id: this.createId(), name: `${player.name}'s death echo`, kind: "rival", level: p.level, stats: { ...p.stats }, mainHand: structuredClone(p.mainHand), offHand: p.offHand ? structuredClone(p.offHand) : undefined, carried: [], bonusSkills: [], isRival: true, xpReward: rivalXpReward(p.level), goldReward: 3 + Math.floor(p.level / 2), seed };
    recipient.deathEchoes.push(echo); this.options.repository.markDirty(recipient.id); if (recipient.connected) this.notice(recipient, `${player.name}'s death echo will enter your next wave.`);
  }

  private sendItem(player: Player, tileId: string, bulk = false): void {
    let sent = 0; let reason = "That equipment is no longer available.";
    do {
      if (this.queuedBy(player.id) >= MAX_QUEUE) { reason = "Your realm queue has reached 1000 items."; break; }
      const target = this.nextTarget(player); if (!target) { reason = "No Realm Guard is available."; break; }
      const result = sendFromInventory(player.progress, tileId); reason = result.reason; if (!result.changed || !result.sent) break;
      const queue = target.incomingQueues.get(player.id) ?? []; queue.push({ item: result.sent, senderId: player.id, senderName: player.name, backlash: false }); target.incomingQueues.set(player.id, queue); sent += 1;
    } while (bulk && sent < MAX_QUEUE);
    removeEmptyInventoryTiles(player.progress); if (!sent) return this.notice(player, reason); this.sendProgress(player, bulk ? `Queued ${sent} items for future carriers.` : reason); this.broadcastRealms();
  }

  private leaveRealm(player: Player): void { if (!player.realmId) { player.realmOptedIn = false; return this.broadcastRealms(); } if (!this.canLeave()) return this.notice(player, "Leave to Lobby opens after the final planned spawn."); const id = player.realmId; player.realmOptedIn = false; this.dissolveRealm(id); for (const created of this.matchWaitingPlayers()) this.activateRealm(created); this.dispatchCurrentWave(player, "training"); this.broadcastRealms(); }
  private enterRealm(player: Player): void { player.realmOptedIn = true; player.waitingSince = Date.now(); const created = this.matchWaitingPlayers(); for (const realm of created) this.activateRealm(realm); if (!player.realmId) { player.issuedUnits.clear(); player.groundDrops.clear(); this.dispatchCurrentWave(player, "solo", true); } this.broadcastRealms(); }

  private matchWaitingPlayers(): Realm[] {
    const created: Realm[] = [];
    const waiting = [...this.options.repository.values()].filter((p) => p.connected && p.realmOptedIn && !p.realmId).sort((a, b) => b.progress.level - a.progress.level || a.waitingSince - b.waitingSince || a.id.localeCompare(b.id));
    while (waiting.length >= 2) { const solo = waiting.shift()!; const subset = bestSubset(solo, waiting); if (!subset.length) break; for (const member of subset) waiting.splice(waiting.indexOf(member), 1); const realm: Realm = { id: this.createId(), soloId: solo.id, teamIds: subset.map((p) => p.id), down: new Set() }; this.realms.set(realm.id, realm); solo.realmId = realm.id; for (const member of subset) member.realmId = realm.id; created.push(realm); }
    return created;
  }

  private activateRealm(realm: Realm): void { for (const id of [realm.soloId, ...realm.teamIds]) { const player = this.options.repository.get(id); if (!player?.connected) continue; this.options.logRealmLifecycle?.("entered", id, realm.id, this.realmOpponentIds(realm, id)); player.issuedUnits.clear(); player.groundDrops.clear(); this.dispatchCurrentWave(player, "competitive", true); } }

  private dissolveRealm(id: string): void { const realm = this.realms.get(id); if (!realm) return; const members = [realm.soloId, ...realm.teamIds].map((pid) => this.options.repository.get(pid)).filter(isPlayer); const memberIds = new Set(members.map((p) => p.id));
    for (const recipient of members) for (const [senderId, queue] of [...recipient.incomingQueues]) if (senderId !== recipient.id && memberIds.has(senderId)) { const sender = this.options.repository.get(senderId); if (sender) for (const entry of queue) sender.backlashQueue.push({ ...entry, backlash: true, senderId: sender.id, senderName: "Realm backlash" }); recipient.incomingQueues.delete(senderId); }
    for (const member of members) { this.options.logRealmLifecycle?.("left", member.id, realm.id, this.realmOpponentIds(realm, member.id)); member.realmId = undefined; member.waitingSince = Date.now(); } this.realms.delete(id); }

  private nextTarget(player: Player): Player | undefined { const opponents = this.realmOpponents(player); if (!opponents.length) return player; return opponents[player.outgoingRotation++ % opponents.length]; }
  private realmOpponentIds(realm: Realm, playerId: PlayerId): PlayerId[] { return realm.soloId === playerId ? [...realm.teamIds] : [realm.soloId]; }
  private realmOpponents(player: Player): Player[] { if (!player.realmId) return []; const realm = this.realms.get(player.realmId); if (!realm) return []; const ids = realm.soloId === player.id ? realm.teamIds : [realm.soloId]; return ids.map((id) => this.options.repository.get(id)).filter(isPlayer); }
  private queuedBy(senderId: string): number { let count = 0; for (const player of this.options.repository.values()) { count += player.incomingQueues.get(senderId)?.length ?? 0; if (player.id === senderId) count += player.backlashQueue.length; } return count; }
  private canLeave(): boolean { return Date.now() - this.lastDispatchAt >= this.options.balance.wave.prepareMs + 9 * this.options.balance.wave.batchIntervalMs; }

  private realmState(player: Player): RealmState { if (!player.realmId) { const self = { ...this.publicPlayer(player), down: false }; return { mode: player.realmOptedIn ? "waiting" : "training", guards: [self], attackers: [self], outgoingQueued: this.queuedBy(player.id), incomingQueued: [...player.incomingQueues.values()].reduce((n, q) => n + q.length, player.backlashQueue.length + player.deathEchoes.length), canLeave: true }; } const realm = this.realms.get(player.realmId)!; const opponents = this.realmOpponents(player); const member = (entry: Player): RealmMember => ({ ...this.publicPlayer(entry), down: realm.down.has(entry.id) }); return { mode: "competitive", guards: opponents.map(member), attackers: opponents.map(member), outgoingQueued: this.queuedBy(player.id), incomingQueued: [...player.incomingQueues.values()].reduce((n, q) => n + q.length, player.deathEchoes.length), canLeave: this.canLeave() }; }
  private waveMode(player: Player): "competitive" | "solo" | "training" { return player.realmId ? "competitive" : player.realmOptedIn ? "solo" : "training"; }
  private broadcastRealms(): void { for (const player of this.options.repository.values()) if (player.connected) this.options.send(player.id, { type: "realmUpdated", realm: this.realmState(player) }); }
  private publicPlayer(player: Player): PublicPlayer { return { id: player.id, name: player.name, score: player.score, waveNumber: player.waveNumber, level: player.progress.level, receivesDeathEchoes: this.leaderboard()[0]?.id === player.id }; }
  private grantXp(player: Player, amount: number): void { const old = player.progress.level; player.progress.xp += amount; const next = levelForXp(player.progress.xp); for (let level = old; level < next; level += 1) for (const key of STAT_KEYS) player.progress.stats[key] += player.progress.allocation[key]; player.progress.level = next; }
  private respecStats(player: Player, allocation: Stats): void { if (!validAllocation(allocation)) return this.notice(player, "Respec ratio must use non-negative integers totaling 5."); const cost = player.progress.level * 100; if (player.progress.gold < cost) return this.notice(player, `Respec requires ${cost} gold.`); player.progress.gold -= cost; player.progress.allocation = { ...allocation }; player.progress.stats = Object.fromEntries(STAT_KEYS.map((key) => [key, allocation[key] * player.progress.level])) as Stats; this.sendProgress(player, `Reapplied the allocation ratio across ${player.progress.level} levels for ${cost} gold.`); }
  private applyInventoryAction(player: Player, bulk: boolean | undefined, action: () => InventoryResult): void {
    let changed = 0; let result = action();
    while (result.changed) { changed += 1; if (!bulk) break; result = action(); }
    removeEmptyInventoryTiles(player.progress); if (!changed) return this.notice(player, result.reason);
    this.sendProgress(player, bulk ? `Completed ${changed} item actions.` : result.reason);
  }
  private applyInventoryResult(player: Player, result: InventoryResult): void { if (!result.changed) return this.notice(player, result.reason); for (const item of result.dropped ?? []) { const id = this.createId(); const drop: GroundDrop = { id, kind: "item", item }; player.groundDrops.set(id, drop); this.options.send(player.id, { type: "groundDropCreated", drop }); } removeEmptyInventoryTiles(player.progress); this.sendProgress(player, result.reason); }
  private sendProgress(player: Player, reason: string): void { this.options.send(player.id, { type: "progressionUpdated", progress: player.progress, reason }); }
  private notice(player: Player, message: string): void { this.options.send(player.id, { type: "serverNotice", message }); }
  private seed(): number { return randomSeed(this.options.random); }
}

function bestSubset(solo: Player, candidates: Player[]): Player[] { let best: Player[] = []; let bestDiff = Infinity; for (let size = 1; size <= Math.min(3, candidates.length); size += 1) for (const group of combinations(candidates, size)) { const diff = Math.abs(solo.progress.level - group.reduce((sum, p) => sum + p.progress.level, 0)); if (diff < bestDiff || (diff === bestDiff && (!best.length || group.length < best.length))) { best = group; bestDiff = diff; } } return best; }
function combinations<T>(values: T[], size: number, start = 0, prefix: T[] = []): T[][] { if (prefix.length === size) return [prefix]; const result: T[][] = []; for (let i = start; i < values.length; i += 1) result.push(...combinations(values, size, i + 1, [...prefix, values[i]])); return result; }
function randomAllocation(seed: number): Stats { const values = STAT_KEYS.map((_, index) => ((seed >>> (index * 5)) & 15) + 1); const total = values.reduce((sum, value) => sum + value, 0); return Object.fromEntries(STAT_KEYS.map((key, index) => [key, 5 * values[index] / total])) as Stats; }
function scaledStats(allocation: Stats, level: number): Stats { return Object.fromEntries(STAT_KEYS.map((key) => [key, allocation[key] * level])) as Stats; }
function isPlayer(player: Player | undefined): player is Player { return Boolean(player); }
