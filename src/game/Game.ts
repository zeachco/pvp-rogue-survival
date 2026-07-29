import { BALANCE, type BalanceConfig } from "../../common/balance";
import { itemRequirementMultiplier } from "../../common/items";
import { rollAttackStrike, spellPower } from "../../common/combat";
import { systemRandom } from "../../common/random";
import type {
	CreepWave,
	GroundDrop,
	ServerMessage,
	UnitBuild,
} from "../../common/protocol";
import { SocketClient } from "../net/SocketClient";
import { SessionStorage } from "../platform/SessionStorage";
import { Hud } from "../ui/Hud";
import { AttackArea } from "./AttackArea";
import { Creep } from "./Creep";
import { Hero } from "./Hero";
import { ItemDrop } from "./ItemDrop";
import { GameMap } from "./Map";
import { Projectile } from "./Projectile";
import { SpellEffect } from "./SpellEffect";
import { ArenaState, type QueuedSpawn } from "./ArenaState";
import {
	enqueueWave,
	releaseReadySpawns,
	removeInactive,
} from "./systems/lifecycle";
import { resolveCombat } from "./systems/combat";
import {
	cancelHostileProjectiles,
	castForceFieldTargets,
	HeroCombatSystem,
} from "./systems/HeroCombatSystem";
import { AuraSystem } from "./systems/AuraSystem";
import { ThreeRenderer } from "./render/ThreeRenderer";
import { distance, type PlayerState, type Vector2 } from "./types";
import { correctArenaBoundary } from "./bounds";
import { emittedImpactForce } from "./ImpactForce";

const FIXED_STEP = 1 / 60;

declare global {
	interface Window {
		__mltDebug?: {
			game: Game;
			getState: () => Record<string, unknown>;
			join: (name: string) => void;
			clearSession: () => void;
		};
	}
}

export class Game {
	private readonly map = new GameMap();
	private readonly socket = new SocketClient();
	private readonly sessionStorage = new SessionStorage();
	private readonly arena = new ArenaState();
	private readonly hud: Hud;
	private readonly renderer: ThreeRenderer;
	private readonly heroCombat = new HeroCombatSystem();
	private readonly auraSystem = new AuraSystem();
	private readonly keys = new Set<string>();
	private hero = new Hero(this.map.center);
	private player?: PlayerState;
	private savedSession = this.sessionStorage.load();
	private balance: BalanceConfig = BALANCE;
	private debugName = this.savedSession?.username ?? "unjoined";
	private readonly pendingPickupAt = new Map<string, number>();
	private lastTimestamp = performance.now();
	private accumulator = 0;
	private defeatCooldown = 0;
	private isChatting = false;
	private resizeObserver?: ResizeObserver;
	private hovered?: Creep;
	private hoverPeeking = false;
	private inspected?: Creep;
	private waveMode: "competitive" | "solo" | "training" = "training";
	private realmMode: "training" | "waiting" | "competitive" = "training";
	private get creeps(): Creep[] {
		return this.arena.creeps;
	}
	private get attacks(): AttackArea[] {
		return this.arena.attacks;
	}
	private get projectiles(): Projectile[] {
		return this.arena.projectiles;
	}
	private get drops(): ItemDrop[] {
		return this.arena.drops;
	}
	private get pendingPickups(): Set<string> {
		return this.arena.pendingPickups;
	}
	private get blockedPickups(): Set<string> {
		return this.arena.blockedPickups;
	}
	private get waveQueue(): QueuedSpawn[] {
		return this.arena.waveQueue;
	}

	constructor(
		private readonly canvas: HTMLCanvasElement,
		hudRoot: HTMLDivElement,
	) {
		this.map.buildMeshes();
		this.renderer = new ThreeRenderer(this.canvas, this.map);
		this.renderer.scene.add(this.map.mesh);
		this.hero.onCombatText = (text) => this.arena.addCombatText(text);
		this.hud = new Hud(hudRoot, {
			onJoin: (name) => this.join(name),
			onAllocation: (allocation) =>
				this.socket.send({ type: "updateAllocation", allocation }),
			onRespec: (allocation) =>
				this.socket.send({ type: "respecStats", allocation }),
			onEquip: (tileId) => this.socket.send({ type: "equipItem", tileId }),
			onSell: (tileId, bulk) =>
				this.socket.send({ type: "sellItem", tileId, bulk }),
			onPurge: (tileId, bulk) =>
				this.socket.send({ type: "purgeItem", tileId, bulk }),
			onUpgrade: (tileId, bulk) =>
				this.socket.send({ type: "upgradeItem", tileId, bulk }),
			onSend: (tileId, bulk) =>
				this.socket.send({ type: "sendItem", tileId, bulk }),
			onExtract: (tileId, bulk) =>
				this.socket.send({ type: "extractSkill", tileId, bulk }),
			onPromoteScrap: (target, bulk) =>
				this.socket.send({ type: "promoteScrap", target, bulk }),
			onSetRarityAction: (rarity, action) =>
				this.socket.send({ type: "setRarityAction", rarity, action }),
			onLeaveRealm: () => this.socket.send({ type: "leaveRealm" }),
			onEnterRealm: () => this.enterRealm(),
			onKillPlayer: () => {
				if (
					window.confirm(
						"Kill this hero? Death progression and currency penalties will apply.",
					)
				)
					this.socket.send({ type: "suicide" });
			},
			onBack: () => this.clearInspection(),
			onLogout: () => this.socket.send({ type: "logout" }),
			onInspectHero: (heroId) =>
				this.socket.send({ type: "inspectHero", heroId }),
			onToggleSkill: (skillId) =>
				this.socket.send({ type: "toggleSkill", skillId }),
			onDismissPanelTrigger: (panel) =>
				this.socket.send({ type: "dismissPanelTrigger", panel }),
			onChat: (text) => this.socket.send({ type: "chat", text }),
			onChattingChange: (chatting) => {
				this.isChatting = chatting;
			},
		});
		if (this.savedSession) this.hud.setJoinName(this.savedSession.username);
		this.registerDebugGlobal();
	}

	start(): void {
		this.resize();
		window.addEventListener("resize", () => this.resize());
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this.canvas);
		window.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !this.isChatting) {
				event.preventDefault();
				this.hud.focusChat();
				return;
			}
			if (["w", "a", "s", "d"].includes(event.key.toLowerCase()))
				event.preventDefault();
			this.keys.add(event.key.toLowerCase());
		});
		window.addEventListener("keyup", (event) =>
			this.keys.delete(event.key.toLowerCase()),
		);
		this.canvas.addEventListener("mousemove", (event) =>
			this.updateHover(event),
		);
		this.canvas.addEventListener("click", (event) => this.inspectAt(event));
		this.canvas.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				this.renderer.applyZoom(event.deltaY);
			},
			{ passive: false },
		);
		this.socket.onOpen(() => {
			if (this.savedSession) this.join("", this.savedSession.heroId);
			else {
				this.hud.setNotice("Enter a name to join.");
				this.socket.send({ type: "listHeroes" });
			}
		});
		this.socket.onClose(() =>
			this.hud.setNotice("Server disconnected. Reconnecting..."),
		);
		this.socket.onMessage((message) => this.handleServerMessage(message));
		this.socket.connect();
		requestAnimationFrame((timestamp) => this.tick(timestamp));
	}

	private join(name: string, heroId?: string): void {
		this.debugName = name.trim() || this.debugName;
		this.socket.send(
			heroId ? { type: "join", heroId } : { type: "join", name },
		);
		this.hud.setNotice("Joining arena...");
	}
	private enterRealm(): void {
		if (this.realmMode !== "training") return;
		this.realmMode = "waiting";
		this.socket.send({ type: "enterRealm" });
	}
	private handleServerMessage(message: ServerMessage): void {
		if (message.type === "welcome") {
			this.player = {
				id: message.playerId,
				name: message.player.name,
				receivesDeathEchoes: message.player.receivesDeathEchoes,
				score: message.player.score,
				waveNumber: message.player.waveNumber,
				maxWaveReached: message.player.maxWaveReached,
				health: 1,
				maxHealth: 1,
				healthRegen: 0,
				mana: 0,
				maxMana: 0,
				rage: 1,
				maxRage: 1,
				attackProgress: 1,
				statuses: [],
				xpSendBuffs: message.xpSendBuffs,
				gold: message.progress.gold,
				progress: message.progress,
			};
			this.balance = message.config.balance;
			this.realmMode = message.realm.mode;
			this.hero.applyProgress(message.progress);
			this.syncHeroState();
			this.debugName = message.player.name;
			this.savedSession = {
				heroId: message.playerId,
				username: message.player.name,
			};
			this.sessionStorage.save(this.savedSession);
			this.hud.configurePanelTriggers(message.panelTriggers);
			this.hud.setPlayer(this.player);
			this.hud.setPublicHero();
			this.hud.setSpells(
				this.heroCombat.spellSlots(message.progress, this.hero),
			);
			this.hud.setRealm(message.realm);
			this.hud.setNotice("");
			this.hud.showCenterToast(
				"WASD moves. Combat and skills cast automatically. Walk over glowing item drops.",
			);
			this.reconcileDrops();
		} else if (message.type === "loggedOut") {
			this.sessionStorage.clear();
			this.savedSession = undefined;
			this.player = undefined;
			this.arena.clear();
			this.pendingPickupAt.clear();
			this.heroCombat.reset();
			this.hud.clearPlayer();
			this.hud.setPublicHero();
		} else if (message.type === "leaderboard")
			this.hud.setLeaderboard(message.heroes);
		else if (message.type === "heroProfile")
			this.hud.setPublicHero(message.hero);
		else if (message.type === "realmUpdated") {
			this.realmMode = message.realm.mode;
			if (this.player) {
				const member = [
					...message.realm.guards,
					...message.realm.attackers,
				].find(({ id }) => id === this.player!.id);
				if (member) {
					this.player.receivesDeathEchoes = member.receivesDeathEchoes;
					this.player.maxWaveReached = member.maxWaveReached;
				}
			}
			this.hud.setRealm(message.realm);
			if (this.player) this.hud.setPlayer(this.player);
		} else if (message.type === "incomingWave") this.enqueueWave(message.wave);
		else if (message.type === "creepDefeatResolved" && this.player) {
			this.player.score = message.score;
			this.player.progress = message.progress;
			this.player.xpSendBuffs = message.xpSendBuffs;
			this.player.gold = message.progress.gold;
			const position = this.arena.defeatedPositions.get(message.unitId);
			this.arena.defeatedPositions.delete(message.unitId);
			if (message.drop && position)
				this.drops.push(new ItemDrop(message.drop, { ...this.hero.position }));
			this.hero.applyProgress(message.progress, true);
			this.syncHeroState();
			this.hud.setPlayer(this.player);
			if (this.waveMode === "training") this.hud.showXpToast(message.reason);
			else this.hud.setNotice(message.reason);
		} else if (message.type === "progressionUpdated" && this.player) {
			this.player.progress = message.progress;
			this.player.xpSendBuffs = message.xpSendBuffs;
			this.player.gold = message.progress.gold;
			this.hero.applyProgress(message.progress, true);
			this.syncHeroState();
			this.hud.setPlayer(this.player);
			this.hud.setSpells(
				this.heroCombat.spellSlots(message.progress, this.hero),
			);
			this.hud.setNotice(message.reason);
		} else if (message.type === "groundDropCreated")
			this.drops.push(new ItemDrop(message.drop, { ...this.hero.position }));
		else if (message.type === "scoreAwarded" && this.player) {
			this.player.score = message.score;
			this.hud.setPlayer(this.player);
		} else if (message.type === "waveAdjusted" && this.player) {
			this.player.waveNumber = message.waveNumber;
			this.hud.setPlayer(this.player);
			this.hud.setNotice(message.reason);
		} else if (message.type === "suicideResolved" && this.player) {
			this.defeatCooldown = 0;
			this.hud.showWaveBanner(
				"Hero down",
				"Your death echo was sent to the highest-ranked hero",
			);
			this.resetArena();
		} else if (message.type === "collectItemResult")
			this.handleCollectResult(
				message.dropId,
				message.collected,
				message.reason,
			);
		else if (message.type === "dropsReconciled")
			this.handleDropsReconciled(
				message.drops,
				message.removeDropIds,
				message.resolvedDropIds,
			);
		else if (message.type === "chatMessage")
			this.hud.pushChatMessage(
				message.senderId,
				message.senderName,
				message.text,
			);
		else if (message.type === "serverNotice")
			this.hud.setNotice(message.message);
	}

	private enqueueWave(wave: CreepWave): void {
		if (wave.resetHero || wave.mode !== this.waveMode) this.arena.clear();
		if (wave.resetHero) {
			this.pendingPickupAt.clear();
			this.hero.resetForRealm();
			this.heroCombat.reset();
			this.clearInspection();
		}
		this.waveMode = wave.mode;
		enqueueWave(this.arena, wave, performance.now());
		if (this.player) {
			this.player.waveNumber = wave.waveNumber;
			this.hud.setPlayer(this.player);
		}
	}

	private tick(timestamp: number): void {
		this.accumulator += Math.min(0.1, (timestamp - this.lastTimestamp) / 1000);
		this.lastTimestamp = timestamp;
		while (this.accumulator >= FIXED_STEP) {
			this.update(FIXED_STEP);
			this.accumulator -= FIXED_STEP;
		}
		this.render();
		requestAnimationFrame((next) => this.tick(next));
	}

	private update(deltaSeconds: number): void {
		if (!this.player) return;
		if (this.defeatCooldown > 0) {
			this.defeatCooldown -= deltaSeconds;
			if (this.defeatCooldown <= 0) this.resetArena();
			return;
		}
		for (const build of releaseReadySpawns(this.arena, performance.now()))
			this.spawnCreep(build);
		const movementInput = this.isChatting
			? { x: 0, y: 0 }
			: {
					x: Number(this.keys.has("d")) - Number(this.keys.has("a")),
					y: Number(this.keys.has("w")) - Number(this.keys.has("s")),
				};
		const heroAttackActive = this.attacks.some(
			(attack) => attack.active && attack.owner === "hero",
		);
		const heroMoving =
			movementInput.x !== 0 ||
			movementInput.y !== 0 ||
			Math.hypot(this.hero.velocity.x, this.hero.velocity.y) > 0.01;
		this.heroCombat.syncSkills(this.player.progress, this.hero);
		this.hero.attackSlow = heroAttackActive;
		this.hero.movementSpeedMultiplier = this.heroCombat.whirlwindMovementSpeed;
		this.hero.healthRegenMultiplier = this.heroCombat.rapidRegenMultiplier;
		this.hero.healthRegenFlat = this.heroCombat.rapidRegenFlat;
		this.hero.update(
			deltaSeconds,
			systemRandom,
			this.waveMode === "training",
			!heroMoving && !heroAttackActive && !this.heroCombat.attacking,
		);
		this.hero.move(
			movementInput,
			deltaSeconds,
			this.map.width,
			this.map.height,
		);
		this.heroCombat.update(
			deltaSeconds,
			movementInput,
			this.hero,
			this.arena,
			this.player.progress,
			this.balance,
			systemRandom,
		);
		this.auraSystem.update(
			deltaSeconds,
			this.hero,
			this.player.progress,
			this.creeps,
			systemRandom,
		);
		for (const creep of this.creeps) creep.setGroundMovementMultiplier(1);
		for (const swamp of this.arena.swamps)
			swamp.update(deltaSeconds, this.creeps);
		for (const creep of this.creeps) {
			if (!creep.active) continue;
			const attack = creep.pursue(
				this.hero.position,
				deltaSeconds,
				this.map.width,
				this.map.height,
			);
			correctArenaBoundary(
				creep,
				this.map.width,
				this.map.height,
				deltaSeconds,
			);
			const strike = rollAttackStrike(
				creep.build.mainHand,
				creep.stats,
				"enemy",
				this.balance,
				systemRandom,
			);
			const presentation = {
				kind:
					creep.build.mainHand?.definitionId === "staff" ||
					creep.build.mainHand?.definitionId === "scepter"
						? ("magic" as const)
						: ("physical" as const),
				critical: strike.critical,
			};
			if (attack?.type === "melee")
				this.attacks.push(
					new AttackArea(
						"creep",
						attack.origin,
						attack.angle,
						70,
						Math.PI,
						attack.windup,
						0.14,
						strike.damage,
						creep,
						undefined,
						creep.build.mainHand,
						presentation,
						emittedImpactForce(creep, "radial", attack.origin),
					),
				);
			if (attack?.type === "projectile")
				this.projectiles.push(
					new Projectile(
						attack.origin,
						attack.target,
						strike.damage,
						"creep",
						undefined,
						creep,
						presentation,
						creep.build.mainHand,
					),
				);
			if (attack?.type === "fireBreath") {
				this.attacks.push(
					new AttackArea(
						"creep",
						attack.origin,
						attack.angle,
						150,
						0.62,
						0.22,
						0.18,
						strike.damage *
							1.1 *
							spellPower(creep.skillLevels.get("fireBreath") ?? 1),
						creep,
						"fireBreath",
						creep.build.mainHand,
						{ kind: "fire", critical: strike.critical },
					),
				);
				this.arena.spellEffects.push(
					new SpellEffect("fireBreath", attack.origin, attack.angle),
				);
			}
			if (attack?.type === "forceField") {
				const level = creep.skillLevels.get("gravityPull") ?? 1;
				castForceFieldTargets(creep, [this.hero], level, systemRandom);
				cancelHostileProjectiles(this.projectiles, creep, "creep", level);
				this.arena.spellEffects.push(
					new SpellEffect("gravityPull", creep.position),
				);
			}
		}
		for (const attack of this.attacks) attack.update(deltaSeconds);
		const emittedProjectiles: Projectile[] = [];
		for (const projectile of this.projectiles) {
			projectile.update(deltaSeconds);
			emittedProjectiles.push(...projectile.emitFrostSpikes(deltaSeconds));
			correctArenaBoundary(
				projectile,
				this.map.width,
				this.map.height,
				deltaSeconds,
			);
		}
		this.projectiles.push(...emittedProjectiles);
		for (const effect of this.arena.spellEffects) effect.update(deltaSeconds);
		const baseStats = this.player.progress.stats;
		const attractionEnabled = this.hero.isSkillOperational("attraction");
		const universalAttraction = this.player.progress.universalSkills.includes(
			"attraction",
		)
			? 35
			: 0;
		const attractionSpeed = attractionEnabled
			? Math.max(
					universalAttraction,
					...[
						this.player.progress.mainHand,
						this.player.progress.offHand,
						this.player.progress.amulet,
						this.player.progress.charm,
					].map(
						(item) =>
							(item?.attractionSpeed ?? 0) *
							(item ? itemRequirementMultiplier(item, baseStats) : 1),
					),
				)
			: 0;
		for (const drop of this.drops) {
			if (drop.escaping) {
				drop.move(deltaSeconds);
				if (drop.outside(this.map.width, this.map.height) && drop.active) {
					drop.active = false;
					this.socket.send({ type: "deferDrop", dropId: drop.dropId });
				}
			} else {
				if (attractionSpeed > 0 && !this.pendingPickups.has(drop.dropId))
					drop.pullToward(this.hero.position, attractionSpeed, deltaSeconds);
				correctArenaBoundary(
					drop,
					this.map.width,
					this.map.height,
					deltaSeconds,
				);
			}
		}
		resolveCombat(
			this.arena,
			this.hero,
			this.player.progress.mainHand,
			this.map.width,
			this.map.height,
			systemRandom,
		);
		this.auraSystem.resolveDeaths(
			this.hero,
			this.player.progress,
			this.creeps,
			systemRandom,
		);
		this.collectKills();
		this.collectDrops();
		if (
			[...this.pendingPickupAt.values()].some(
				(sentAt) => performance.now() - sentAt >= 3000,
			)
		)
			this.reconcileDrops();
		this.arena.updateCombatTexts(deltaSeconds);
		removeInactive(this.attacks);
		removeInactive(this.projectiles);
		removeInactive(this.creeps);
		removeInactive(this.drops);
		removeInactive(this.arena.spellEffects);
		removeInactive(this.arena.swamps);
		if (this.inspected && !this.inspected.active) this.clearInspection();
		if (this.hoverPeeking && (!this.hovered || !this.hovered.active)) {
			this.hovered = undefined;
			this.hud.clearInspectionPreview();
			this.hoverPeeking = false;
		}
		this.syncHeroState();
		this.hud.setPlayer(this.player);
		this.hud.setSpells(
			this.heroCombat.spellSlots(this.player.progress, this.hero),
		);
		if (!this.hero.active) this.handleDefeat();
		this.updateCamera();
	}

	private collectKills(): void {
		for (const creep of this.creeps)
			if (!creep.active) {
				const cooldownReduction = this.heroCombat.onKill(
					this.player!.progress,
					this.hero,
				);
				if (cooldownReduction > 0)
					this.auraSystem.reduceCooldowns(cooldownReduction);
				this.arena.defeatedPositions.set(creep.build.id, { ...creep.position });
				this.socket.send({ type: "creepDefeated", unitId: creep.build.id });
			}
	}
	private collectDrops(): void {
		const overlapping = new Set<string>();
		for (const drop of this.drops) {
			if (
				!drop.active ||
				distance(drop.position, this.hero.position) >
					drop.radius + this.hero.radius
			)
				continue;
			overlapping.add(drop.dropId);
			if (
				this.pendingPickups.has(drop.dropId) ||
				this.blockedPickups.has(drop.dropId)
			)
				continue;
			if (this.socket.send({ type: "collectDrop", dropId: drop.dropId })) {
				this.pendingPickups.add(drop.dropId);
				this.pendingPickupAt.set(drop.dropId, performance.now());
			}
		}
		for (const itemId of this.blockedPickups)
			if (!overlapping.has(itemId)) this.blockedPickups.delete(itemId);
	}
	private handleCollectResult(
		dropId: string,
		collected: boolean,
		reason: string,
	): void {
		this.pendingPickups.delete(dropId);
		this.pendingPickupAt.delete(dropId);
		if (collected) {
			const drop = this.drops.find((candidate) => candidate.dropId === dropId);
			if (drop) drop.active = false;
			this.blockedPickups.delete(dropId);
		} else this.blockedPickups.add(dropId);
		this.hud.setNotice(reason);
	}
	private reconcileDrops(): void {
		if (!this.player) return;
		if (
			this.socket.send({
				type: "reconcileDrops",
				activeDropIds: this.drops
					.filter((drop) => drop.active)
					.map((drop) => drop.dropId),
				pendingDropIds: [...this.pendingPickups],
			})
		)
			for (const id of this.pendingPickups)
				this.pendingPickupAt.set(id, performance.now());
	}
	private handleDropsReconciled(
		drops: GroundDrop[],
		removeDropIds: string[],
		resolvedDropIds: string[],
	): void {
		const removed = new Set(removeDropIds);
		for (const drop of this.drops)
			if (removed.has(drop.dropId)) drop.active = false;
		for (const id of resolvedDropIds) {
			this.pendingPickups.delete(id);
			this.pendingPickupAt.delete(id);
		}
		const existing = new Set(
			this.drops.filter((drop) => drop.active).map((drop) => drop.dropId),
		);
		for (const drop of drops)
			if (!existing.has(drop.id))
				this.drops.push(new ItemDrop(drop, { ...this.hero.position }));
	}

	private spawnCreep(build: UnitBuild): void {
		const creep = new Creep(
			build,
			build.emitterId ?? "neutral",
			build.emitterName ?? build.name,
			this.map.randomEdgeSpawn(systemRandom),
			this.balance,
			systemRandom,
			this.waveMode === "training" ? 0.5 : 1,
		);
		creep.onCombatText = (text) => this.arena.addCombatText(text);
		this.creeps.push(creep);
	}
	private handleDefeat(): void {
		if (this.waveMode === "training") return;
		this.defeatCooldown = 1.8;
		this.socket.send({
			type: "heroDefeated",
			sourceUnitId: this.hero.lastDamageSourceId,
		});
		this.hud.showWaveBanner(
			"Hero down",
			"Wave reduced; progress and inventory retained",
		);
	}
	private resetArena(): void {
		this.arena.clear();
		this.pendingPickupAt.clear();
		this.heroCombat.reset();
		this.auraSystem.reset();
		this.hero = new Hero(this.map.center);
		this.hero.onCombatText = (text) => this.arena.addCombatText(text);
		this.hero.applyProgress(this.player!.progress);
		this.clearInspection();
		this.socket.send({ type: "requestWave" });
	}
	private syncHeroState(): void {
		if (!this.player) return;
		this.player.health = this.hero.hp;
		this.player.maxHealth = this.hero.maxHp;
		this.player.healthRegen = this.hero.healthRegen;
		this.player.mana = this.hero.mana;
		this.player.maxMana = this.hero.maxMana;
		this.player.rage = this.hero.rage;
		this.player.maxRage = this.hero.maxRage;
		this.player.attackProgress = this.heroCombat.attackProgress;
		this.player.statuses = this.hero.statuses.map(
			({ kind, remaining, damagePerSecond }) => ({
				kind,
				remaining,
				damagePerSecond,
			}),
		);
		this.player.gold = this.player.progress.gold;
	}

	private updateHover(event: MouseEvent): void {
		const world = this.eventWorld(event);
		const previous = this.hovered;
		this.hovered = this.creeps
			.filter((creep) => creep.active)
			.sort(
				(a, b) => distance(a.position, world) - distance(b.position, world),
			)[0];
		if (
			this.hovered &&
			distance(this.hovered.position, world) > this.hovered.radius + 8
		)
			this.hovered = undefined;
		this.canvas.style.cursor = this.hovered ? "pointer" : "default";
		if (this.hovered === previous) return;
		if (this.hovered) {
			const reward = this.creepInspectionReward(this.hovered);
			this.hud.setInspectionPreview(
				this.hovered.build,
				reward,
				undefined,
				this.hovered.maxHp,
			);
			this.hoverPeeking = true;
		} else if (this.hoverPeeking) {
			this.hud.clearInspectionPreview();
			this.hoverPeeking = false;
		}
	}
	private inspectAt(event: MouseEvent): void {
		this.updateHover(event);
		this.inspected = this.hovered;
		const reward = this.inspected
			? this.creepInspectionReward(this.inspected)
			: undefined;
		this.hud.setInspection(
			this.inspected?.build,
			reward,
			undefined,
			this.inspected?.maxHp,
		);
		this.hoverPeeking = false;
	}
	private clearInspection(): void {
		this.inspected = undefined;
		this.hoverPeeking = false;
		this.hud.setInspection();
	}
	private creepInspectionReward(creep: Creep): number {
		return Math.floor(
			creep.build.xpReward *
				this.balance.rewards.xpMultiplier *
				(this.waveMode === "solo" ? 0.5 : this.waveMode === "training" ? 0 : 1),
		);
	}
	private eventWorld(event: MouseEvent): Vector2 {
		return this.renderer.eventWorld(event);
	}
	private updateCamera(): void {
		this.renderer.updateCameraPosition(
			this.hero.position.x,
			this.hero.position.y,
		);
	}
	private render(): void {
		this.renderer.syncScene(
			this.hero,
			this.arena,
			this.hovered,
			this.inspected,
		);
		this.renderer.render();
	}
	private resize(): void {
		const width = this.canvas.clientWidth || innerWidth;
		const height = this.canvas.clientHeight || innerHeight;
		this.renderer.resize(width, height);
		this.updateCamera();
	}
	private registerDebugGlobal(): void {
		window.__mltDebug = {
			game: this,
			getState: () => ({
				player: this.player,
				balance: this.balance.id,
				hero: { hp: this.hero.hp, mana: this.hero.mana, rage: this.hero.rage },
				creeps: this.creeps.length,
				drops: this.drops.length,
				queued: this.waveQueue.length,
			}),
			join: (name) => this.join(name),
			clearSession: () => {
				this.sessionStorage.clear();
				this.savedSession = undefined;
			},
		};
	}
}
