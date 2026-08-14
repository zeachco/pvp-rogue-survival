import { BALANCE, type BalanceConfig } from "../../common/balance";
import {
	attractionSpeedMultiplier,
	forceFieldRange,
	MAX_RAGE,
	rollAttackStrike,
	STAFF_BASIC_HALF_ARC,
	STARTING_RAGE,
	spellPower,
	weaponRange,
} from "../../common/combat";
import { itemRequirementMultiplier } from "../../common/items";
import type {
	CreepWave,
	GroundDrop,
	ServerMessage,
	UnitBuild,
} from "../../common/protocol";
import { systemRandom } from "../../common/random";
import { SocketClient } from "../net/SocketClient";
import { SessionStorage } from "../platform/SessionStorage";
import { trySetPointerCapture } from "../platform/PointerCapture";
import { Hud, panelShortcut } from "../ui/Hud";
import { ArenaState, type QueuedSpawn } from "./ArenaState";
import { AttackArea } from "./AttackArea";
import { correctArenaBoundary } from "./bounds";
import { Creep } from "./Creep";
import {
	BACKGROUND_FRAME_INTERVAL_MS,
	backgroundFrameDue,
} from "./FrameScheduler";
import { GameAudio } from "./GameAudio";
import {
	GAMEPAD_ORBIT_PIXELS_PER_SECOND,
	readStandardGamepad,
} from "./GamepadInput";
import {
	type FullscreenMode,
	loadFullscreenMode,
	loadLightingMode,
	loadResolutionScale,
	loadShadowMode,
	saveFullscreenMode,
	saveLightingMode,
	saveResolutionScale,
	saveShadowMode,
} from "./graphicsSettings";
import { Hero } from "./Hero";
import { emittedImpactForce } from "./ImpactForce";
import {
	loadKeepAwakeMode,
	saveKeepAwakeMode,
	ScreenWakeLockController,
} from "./mobileSettings";
import { groundDropPresentationCenter, ItemDrop, pushDrops } from "./ItemDrop";
import { GameMap, resolveColumnCollision, touchesColumn } from "./Map";
import { Projectile } from "./Projectile";
import { ThreeRenderer } from "./render/ThreeRenderer";
import { SpellEffect } from "./SpellEffect";
import { AuraSystem } from "./systems/AuraSystem";
import { resolveCombat } from "./systems/combat";
import {
	cancelHostileProjectiles,
	castForceFieldTargets,
	HeroCombatSystem,
} from "./systems/HeroCombatSystem";
import {
	activeEnemyCountAllowsAutoForce,
	enqueueWave,
	expediteQueuedSpawns,
	releaseReadySpawns,
	removeInactive,
} from "./systems/lifecycle";
import { resolveUnitCollisions } from "./systems/movement";
import { distance, type PlayerState, type Vector2 } from "./types";

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
	private readonly audio = new GameAudio();
	private readonly wakeLock = new ScreenWakeLockController(
		"wakeLock" in navigator ? navigator.wakeLock : undefined,
		document,
	);
	private readonly audibleAttackVersions = new WeakMap<Creep, number>();
	private audibleHeroAttackVersion = 0;
	private audibleSpellCastVersion = 0;
	private readonly keys = new Set<string>();
	private gamepadButtons = new Set<number>();
	private hero = new Hero(this.map.center);
	private player?: PlayerState;
	private savedSession = this.sessionStorage.load();
	private balance: BalanceConfig = BALANCE;
	private debugName = this.savedSession?.username ?? "unjoined";
	private readonly pendingPickupAt = new Map<string, number>();
	private lastTimestamp = performance.now();
	private lastAnimationFrameAt = this.lastTimestamp;
	private accumulator = 0;
	private defeatCooldown = 0;
	private defeatDropPosition?: Vector2;
	private lastBonkAttackerId?: string;
	private duelOpponent?: Creep;
	private duelOpponentHp = 0;
	private duelLastSyncAt = 0;
	private isChatting = false;
	private orbitingCamera = false;
	private aimingHero = false;
	private aimTarget?: Creep;
	private touchCameraPointerId?: number;
	private touchCameraX = 0;
	private touchCameraY = 0;
	private suppressNextClick = false;
	private touchMovement: Vector2 = { x: 0, y: 0 };
	private resizeObserver?: ResizeObserver;
	private hovered?: Creep;
	private hoveredDrop?: ItemDrop;
	private hoverPeeking = false;
	private inspected?: Creep;
	private waveMode: "competitive" | "solo" | "training" = "training";
	private realmMode: "training" | "waiting" | "competitive" = "training";
	private fullscreenMode: FullscreenMode = "on";
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
		onOpenDevlog: () => void,
	) {
		this.map.buildMeshes();
		this.renderer = new ThreeRenderer(this.canvas);
		this.fullscreenMode = loadFullscreenMode(localStorage);
		const resolutionScale = loadResolutionScale(localStorage);
		const lightingMode = loadLightingMode(localStorage);
		const shadowMode = loadShadowMode(localStorage);
		const keepAwakeMode = loadKeepAwakeMode(localStorage);
		this.wakeLock.setEnabled(keepAwakeMode === "on");
		this.renderer.setLightingMode(lightingMode);
		this.renderer.setResolutionScale(resolutionScale);
		this.renderer.setShadowMode(shadowMode);
		this.renderer.scene.add(this.map.mesh);
		this.hero.onCombatText = (text) => this.arena.addCombatText(text);
		this.attachRadialReflect(this.hero);
		this.hud = new Hud(hudRoot, {
			onJoin: (name, password, passwordConfirmation) =>
				this.join(name, undefined, password, passwordConfirmation),
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
			onReroll: (tileId, bulk) =>
				this.socket.send({ type: "rerollItem", tileId, bulk }),
			onPromoteScrap: (target, bulk) =>
				this.socket.send({ type: "promoteScrap", target, bulk }),
			onSetRarityAction: (rarity, action) =>
				this.socket.send({ type: "setRarityAction", rarity, action }),
			onLeaveRealm: () => this.socket.send({ type: "leaveRealm" }),
			onEnterRealm: (waveNumber) => this.enterRealm(waveNumber),
			onForceNextWave: () => this.socket.send({ type: "forceNextWave" }),
			onChallengeRealm: () => this.socket.send({ type: "challengeRealm" }),
			onOpenDevlog,
			onBack: () => this.clearInspection(),
			onLogout: () => this.socket.send({ type: "logout" }),
			onChangePassword: (password, passwordConfirmation) =>
				this.socket.send({
					type: "changePassword",
					password,
					passwordConfirmation,
				}),
			onCreateCharacter: (name) =>
				this.socket.send({ type: "createCharacter", name }),
			onSwitchCharacter: (heroId) =>
				this.socket.send({ type: "switchCharacter", heroId }),
			onSetFullscreenMode: (mode) => {
				saveFullscreenMode(localStorage, mode);
				this.fullscreenMode = mode;
			},
			onSetResolutionScale: (scale) => {
				saveResolutionScale(localStorage, scale);
				this.renderer.setResolutionScale(scale);
			},
			onSetLightingMode: (mode) => {
				saveLightingMode(localStorage, mode);
				this.renderer.setLightingMode(mode);
			},
			onSetShadowMode: (mode) => {
				saveShadowMode(localStorage, mode);
				this.renderer.setShadowMode(mode);
			},
			onSetKeepAwakeMode: (mode) => {
				saveKeepAwakeMode(localStorage, mode);
				this.wakeLock.setEnabled(mode === "on");
			},
			onInspectHero: (heroId) =>
				this.socket.send({ type: "inspectHero", heroId }),
			onSetSkillEquipped: (skillId, equipped, slot) =>
				this.socket.send({ type: "setSkillEquipped", skillId, equipped, slot }),
			onToggleSkillAutoFire: (skillId) =>
				this.socket.send({ type: "toggleSkillAutoFire", skillId }),
			onSetAutoEquipOption: (option, enabled) =>
				this.socket.send({ type: "setAutoEquipOption", option, enabled }),
			onDismissPanelTrigger: (panel) =>
				this.socket.send({ type: "dismissPanelTrigger", panel }),
			onChat: (text) => this.socket.send({ type: "chat", text }),
			onChattingChange: (chatting) => {
				this.isChatting = chatting;
			},
			onPanelLayoutChange: () => this.updatePanelCameraFraming(),
		});
		this.updatePanelCameraFraming();
		this.hud.setFullscreenMode(this.fullscreenMode);
		this.hud.setResolutionScale(resolutionScale);
		this.hud.setLightingMode(lightingMode);
		this.hud.setShadowMode(shadowMode);
		this.hud.setKeepAwakeMode(keepAwakeMode);
		if (this.savedSession) this.hud.setJoinName(this.savedSession.username);
		this.setupTouchControls(hudRoot);
		this.registerDebugGlobal();
	}

	private setupTouchControls(hudRoot: HTMLDivElement): void {
		if (!(navigator.maxTouchPoints > 0 || "ontouchstart" in window)) return;
		document.documentElement.classList.add("touch-ui");
		const pad = document.createElement("div");
		pad.className = "touch-joystick";
		pad.setAttribute("aria-label", "Movement joystick");
		const knob = document.createElement("div");
		knob.className = "touch-joystick-knob";
		pad.append(knob);
		hudRoot.append(pad);
		let pointerId: number | undefined;
		const update = (event: PointerEvent) => {
			const rect = pad.getBoundingClientRect();
			const radius = rect.width * 0.34;
			let x = event.clientX - (rect.left + rect.width / 2);
			let y = event.clientY - (rect.top + rect.height / 2);
			const distance = Math.hypot(x, y);
			if (distance > radius) {
				x = (x / distance) * radius;
				y = (y / distance) * radius;
			}
			this.touchMovement = { x: x / radius, y: -y / radius };
			knob.style.transform = `translate(${x}px, ${y}px)`;
		};
		pad.addEventListener("pointerdown", (event) => {
			pointerId = event.pointerId;
			trySetPointerCapture(pad, event.pointerId);
			update(event);
		});
		pad.addEventListener("pointermove", (event) => {
			if (event.pointerId === pointerId) update(event);
		});
		const release = (event: PointerEvent) => {
			if (event.pointerId !== pointerId) return;
			pointerId = undefined;
			this.touchMovement = { x: 0, y: 0 };
			knob.style.transform = "translate(0, 0)";
		};
		pad.addEventListener("pointerup", release);
		pad.addEventListener("pointercancel", release);
	}

	async start(): Promise<void> {
		await this.renderer.init();
		this.resize();
		window.addEventListener("contextmenu", (event) => event.preventDefault());
		const unlockAudio = () => this.audio.unlock();
		window.addEventListener("pointerdown", unlockAudio, { once: true });
		window.addEventListener("keydown", unlockAudio, { once: true });
		window.addEventListener("resize", () => this.resize());
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this.canvas);
		window.addEventListener("keydown", (event) => {
			if (this.isChatting) return;
			const target = event.target;
			const editable =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				(target instanceof HTMLElement && target.isContentEditable);
			if (editable) return;
			if (event.key === "Enter") {
				event.preventDefault();
				this.hud.focusChat();
				return;
			}
			if (event.key.toLowerCase() === "k") {
				event.preventDefault();
				if (!event.repeat) this.hud.toggleSpellCatalog();
				return;
			}
			if (/^[1-6]$/.test(event.key)) {
				event.preventDefault();
				if (!event.repeat && this.hud.assignHoveredSpell(Number(event.key)))
					return;
				if (!event.repeat && this.player)
					this.heroCombat.requestSpellSlot(
						Number(event.key) - 1,
						this.player.progress,
					);
				return;
			}
			const shortcut = panelShortcut(
				event.key,
				event.ctrlKey || event.metaKey || event.altKey,
			);
			if (shortcut) {
				event.preventDefault();
				if (!event.repeat) this.hud.togglePanelShortcut(shortcut);
				return;
			}
			if (["w", "a", "s", "d"].includes(event.key.toLowerCase()))
				event.preventDefault();
			this.keys.add(event.key.toLowerCase());
		});
		window.addEventListener("keyup", (event) =>
			this.keys.delete(event.key.toLowerCase()),
		);
		const stopMouseCameraOrbit = () => {
			this.orbitingCamera = false;
			if (document.pointerLockElement === this.canvas)
				document.exitPointerLock();
		};
		document.addEventListener("pointerlockchange", () => {
			if (document.pointerLockElement !== this.canvas && this.orbitingCamera)
				this.orbitingCamera = false;
		});
		document.addEventListener("mousemove", (event) => {
			if (this.orbitingCamera && document.pointerLockElement === this.canvas) {
				if (Math.abs(event.movementX) + Math.abs(event.movementY) > 1)
					this.suppressNextClick = true;
				this.renderer.orbit(event.movementX, event.movementY);
			}
		});
		document.addEventListener("mouseup", (event) => {
			if (event.button === 0) stopMouseCameraOrbit();
			if (event.button === 2) {
				stopMouseCameraOrbit();
				this.aimingHero = false;
				this.aimTarget = undefined;
				this.hud.setAiming(false);
			}
		});
		this.canvas.addEventListener("pointerdown", (event) => {
			if (event.pointerType === "touch") {
				this.touchCameraPointerId = event.pointerId;
				this.touchCameraX = event.clientX;
				this.touchCameraY = event.clientY;
				trySetPointerCapture(this.canvas, event.pointerId);
				return;
			}
			if (event.button === 2) {
				event.preventDefault();
				this.aimingHero = true;
				this.aimTarget = this.closestLivingCreep();
				if (this.aimTarget)
					this.renderer.aimAt(this.hero.position, this.aimTarget.position);
				this.hud.setAiming(true);
				this.orbitingCamera = true;
				trySetPointerCapture(this.canvas, event.pointerId);
				if (typeof this.canvas.requestPointerLock === "function")
					void this.canvas.requestPointerLock().catch(() => {
						// Pointer capture above remains the fallback when locking is denied.
					});
				return;
			}
			if (event.button !== 0) return;
			event.preventDefault();
			this.orbitingCamera = true;
			trySetPointerCapture(this.canvas, event.pointerId);
			if (typeof this.canvas.requestPointerLock === "function")
				void this.canvas.requestPointerLock().catch(() => {
					// Pointer capture above remains the fallback when locking is denied.
				});
		});
		this.canvas.addEventListener("pointermove", (event) => {
			if (event.pointerId === this.touchCameraPointerId) {
				const deltaX = event.clientX - this.touchCameraX;
				const deltaY = event.clientY - this.touchCameraY;
				this.touchCameraX = event.clientX;
				this.touchCameraY = event.clientY;
				if (Math.abs(deltaX) + Math.abs(deltaY) > 1)
					this.suppressNextClick = true;
				this.renderer.orbit(deltaX, deltaY);
				return;
			}
			if (this.orbitingCamera && document.pointerLockElement !== this.canvas) {
				if (Math.abs(event.movementX) + Math.abs(event.movementY) > 1)
					this.suppressNextClick = true;
				this.renderer.orbit(event.movementX, event.movementY);
				return;
			}
			this.updateHover(event);
		});
		this.canvas.addEventListener("pointerleave", () => {
			this.hoveredDrop = undefined;
			this.hud.setGroundDropPreview();
		});
		this.canvas.addEventListener("pointerup", (event) => {
			if (event.pointerId === this.touchCameraPointerId)
				this.touchCameraPointerId = undefined;
			if (event.button === 0) stopMouseCameraOrbit();
			if (event.button === 2) {
				stopMouseCameraOrbit();
				this.aimingHero = false;
				this.aimTarget = undefined;
				this.hud.setAiming(false);
			}
		});
		this.canvas.addEventListener("pointercancel", () => {
			stopMouseCameraOrbit();
			this.aimingHero = false;
			this.aimTarget = undefined;
			this.hud.setAiming(false);
			this.touchCameraPointerId = undefined;
		});
		this.canvas.addEventListener("click", (event) => {
			if (this.suppressNextClick) {
				this.suppressNextClick = false;
				return;
			}
			if (event.button === 0) this.inspectAt(event);
		});
		this.canvas.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				if (event.shiftKey) this.renderer.applyTilt(event.deltaY);
				else this.renderer.applyZoom(event.deltaY);
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
		this.socket.onClose((event) => {
			this.hud.pushChatMessage("", "", serverCloseLogMessage(event), "system");
			this.hud.setNotice("Server disconnected. Reconnecting...");
		});
		this.socket.onMessage((message) => this.handleServerMessage(message));
		window.addEventListener("beforeunload", (event) => {
			if (this.realmMode === "training") return;
			event.preventDefault();
			event.returnValue = "";
		});
		this.socket.connect();
		requestAnimationFrame((timestamp) => this.animationFrame(timestamp));
		this.scheduleBackgroundFrameCheck();
	}

	private join(
		name: string,
		heroId?: string,
		password?: string,
		passwordConfirmation?: string,
	): void {
		this.debugName = name.trim() || this.debugName;
		this.socket.send(
			heroId
				? { type: "join", heroId }
				: { type: "join", name, password, passwordConfirmation },
		);
		this.hud.setNotice("Joining arena...");
	}
	private enterRealm(waveNumber: number): void {
		if (this.realmMode !== "training") return;
		if (this.fullscreenMode === "on" && !document.fullscreenElement) {
			const fullscreen = document.documentElement.requestFullscreen?.();
			if (fullscreen) void fullscreen.catch(() => {});
		}
		this.realmMode = "waiting";
		this.socket.send({ type: "enterRealm", waveNumber });
	}
	private handleServerMessage(message: ServerMessage): void {
		if (message.type === "welcome") {
			if (this.player && this.player.id !== message.playerId) {
				this.arena.clear();
				this.pendingPickupAt.clear();
				this.heroCombat.reset();
			}
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
				rage: STARTING_RAGE,
				maxRage: MAX_RAGE,
				attackProgress: 1,
				statuses: [],
				reflectiveSurgeRemaining: 0,
				rapidRegenRemaining: 0,
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
				username: message.accountName,
			};
			this.sessionStorage.save(this.savedSession);
			this.hud.configurePanelTriggers(message.panelTriggers);
			this.hud.setAccountCharacters(message.accountCharacters);
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
		} else if (message.type === "authenticationRequired") {
			this.hud.showAuthentication(message.username, message.mode);
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
			this.hud.setLeaderboard(message.heroes, message.onlineCount);
		else if (message.type === "heroProfile")
			this.hud.setPublicHero(message.hero);
		else if (message.type === "realmUpdated") {
			this.realmMode = message.realm.mode;
			if (this.player) {
				const playerId = this.player.id;
				const member = [
					...message.realm.guards,
					...message.realm.attackers,
				].find(({ id }) => id === playerId);
				if (member) {
					this.player.receivesDeathEchoes = member.receivesDeathEchoes;
					this.player.maxWaveReached = member.maxWaveReached;
				}
			}
			this.hud.setRealm(message.realm);
			if (this.player) this.hud.setPlayer(this.player);
		} else if (message.type === "forceNextWaveResult") {
			this.hud.setForceNextWaveReadyAt(message.readyAt);
			if (message.accepted) expediteQueuedSpawns(this.arena, performance.now());
		} else if (message.type === "playerBonked") {
			this.lastBonkAttackerId = message.attackerId;
			this.hero.lastDamageSourceId = undefined;
			this.hero.receiveDamage(
				this.hero.maxHp * message.damageFraction,
				{ next: () => 1 },
				undefined,
				false,
				false,
				{ kind: "physical" },
				false,
			);
			this.syncHeroState();
			this.hud.setPlayer(this.player!);
			this.hud.showCenterToast(`${message.attackerName} bonked you!`);
		} else if (message.type === "duelStarted") {
			this.arena.clear();
			this.hero.resetForRealm();
			this.hero.position = {
				x: message.side === 0 ? 120 : this.map.width - 120,
				y: this.map.center.y,
			};
			this.spawnCreep(message.opponent);
			this.duelOpponent = this.creeps.at(-1);
			if (this.duelOpponent) {
				this.duelOpponent.position = {
					x: message.side === 0 ? this.map.width - 120 : 120,
					y: this.map.center.y,
				};
				this.duelOpponentHp = this.duelOpponent.hp;
			}
			this.hud.showCenterToast("Challenge Realm deathmatch!");
		} else if (message.type === "duelEnded") {
			if (message.outcome === "victory") {
				this.resetArena();
				this.hud.showCenterToast("Challenge Realm victory!");
			} else {
				this.duelOpponent = undefined;
				this.hero.hp = 0;
				if (this.defeatCooldown <= 0) {
					this.defeatDropPosition = { ...this.hero.position };
					this.defeatCooldown = 1.8;
					this.hud.showDeathModal("Your ass got looted by a bonker.");
				}
			}
		} else if (message.type === "duelState" && this.duelOpponent) {
			this.duelOpponent.position = { x: message.x, y: message.y };
			this.duelOpponent.facing = message.facing;
			this.duelOpponent.hp = Math.min(this.duelOpponent.maxHp, message.hp);
			this.duelOpponentHp = this.duelOpponent.hp;
		} else if (message.type === "duelDamage") {
			this.lastBonkAttackerId = message.attackerId;
			this.hero.hp = Math.max(0, this.hero.hp - message.amount);
		} else if (message.type === "incomingWave") this.enqueueWave(message.wave);
		else if (message.type === "creepDefeatResolved" && this.player) {
			this.player.score = message.score;
			this.player.progress = message.progress;
			this.player.xpSendBuffs = message.xpSendBuffs;
			this.player.gold = message.progress.gold;
			const position = this.arena.defeatedPositions.get(message.unitId);
			this.arena.defeatedPositions.delete(message.unitId);
			if (position)
				for (const drop of message.drops) {
					this.drops.push(new ItemDrop(drop, { ...position }));
					if (drop.kind === "gold") this.audio.play("goldDrop");
				}
			this.hero.applyProgress(message.progress, true);
			this.syncHeroState();
			this.hud.setPlayer(this.player);
			if (this.waveMode !== "training") this.hud.setNotice(message.reason);
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
		} else if (message.type === "groundDropCreated") {
			this.drops.push(new ItemDrop(message.drop, { ...this.hero.position }));
			if (message.drop.kind === "gold") this.audio.play("goldDrop");
		} else if (message.type === "scoreAwarded" && this.player) {
			this.player.score = message.score;
			this.hud.setPlayer(this.player);
		} else if (message.type === "waveAdjusted" && this.player) {
			this.player.waveNumber = message.waveNumber;
			this.hud.setPlayer(this.player);
			this.hud.setNotice(message.reason);
		} else if (message.type === "suicideResolved" && this.player) {
			this.defeatDropPosition ??= { ...this.hero.position };
			this.defeatCooldown = 1.8;
			this.hud.showDeathModal();
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
				message.kind,
			);
		else if (message.type === "serverNotice")
			this.hud.setNotice(message.message, message.tone);
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
		this.hero.currentWave = wave.waveNumber;
		if (this.player) {
			this.player.waveNumber = wave.waveNumber;
			this.hud.setPlayer(this.player);
		}
	}

	private animationFrame(timestamp: number): void {
		this.lastAnimationFrameAt = timestamp;
		this.advanceFrame(timestamp);
		requestAnimationFrame((next) => this.animationFrame(next));
	}

	private scheduleBackgroundFrameCheck(): void {
		window.setTimeout(() => {
			const now = performance.now();
			if (backgroundFrameDue(now, this.lastAnimationFrameAt))
				this.advanceFrame(now);
			this.scheduleBackgroundFrameCheck();
		}, BACKGROUND_FRAME_INTERVAL_MS);
	}

	private advanceFrame(timestamp: number): void {
		this.accumulator += Math.min(0.1, (timestamp - this.lastTimestamp) / 1000);
		this.lastTimestamp = timestamp;
		while (this.accumulator >= FIXED_STEP) {
			this.update(FIXED_STEP);
			this.accumulator -= FIXED_STEP;
		}
		for (const build of releaseReadySpawns(this.arena, performance.now()))
			this.spawnCreep(build);
		this.render();
	}

	private update(deltaSeconds: number): void {
		if (!this.player) return;
		const gamepadInput = readStandardGamepad(
			typeof navigator.getGamepads === "function"
				? navigator.getGamepads()
				: [],
			this.gamepadButtons,
		);
		this.gamepadButtons = gamepadInput.heldButtons;
		if (!this.isChatting) {
			this.renderer.orbit(
				gamepadInput.orbit.x * GAMEPAD_ORBIT_PIXELS_PER_SECOND * deltaSeconds,
				gamepadInput.orbit.y * GAMEPAD_ORBIT_PIXELS_PER_SECOND * deltaSeconds,
			);
			for (const slot of gamepadInput.pressedSpellSlots)
				this.heroCombat.requestSpellSlot(slot, this.player.progress);
		}
		this.audio.updateBattleMusic(this.realmMode !== "training");
		if (this.defeatCooldown > 0) {
			this.defeatCooldown -= deltaSeconds;
			if (this.defeatCooldown <= 0) this.resetArena();
			return;
		}
		const rawMovementInput = this.isChatting
			? { x: 0, y: 0 }
			: {
					x:
						Number(this.keys.has("d")) -
						Number(this.keys.has("a")) +
						this.touchMovement.x +
						gamepadInput.movement.x,
					y:
						Number(this.keys.has("w")) -
						Number(this.keys.has("s")) +
						this.touchMovement.y +
						gamepadInput.movement.y,
				};
		const movementInput = this.renderer.movementForCamera(rawMovementInput);
		this.heroCombat.syncSkills(this.player.progress, this.hero);
		this.hero.movementSpeedMultiplier = this.heroCombat.whirlwindMovementSpeed;
		this.hero.clearFrameEffects();
		for (const creep of this.creeps) creep.clearFrameEffects();
		this.auraSystem.collectEffects(
			this.hero,
			this.player.progress,
			this.creeps,
		);
		for (const swamp of this.arena.swamps) swamp.collectEffects(this.creeps);
		this.hero.compileState(
			deltaSeconds,
			systemRandom,
			this.waveMode === "training",
		);
		for (const creep of this.creeps)
			if (creep.active) creep.compileState(deltaSeconds, systemRandom);
		this.hero.update(deltaSeconds, systemRandom, this.waveMode === "training");
		this.hero.move(
			movementInput,
			deltaSeconds,
			this.map.width,
			this.map.height,
		);
		resolveColumnCollision(this.hero, this.map.columns);
		this.heroCombat.update(
			deltaSeconds,
			movementInput,
			this.hero,
			this.arena,
			this.player.progress,
			this.balance,
			systemRandom,
			this.aimingHero ? this.renderer.cameraFacing() : undefined,
			(creep) => this.renderer.isWorldPositionInView(creep.position),
		);
		if (this.heroCombat.castVersion !== this.audibleSpellCastVersion) {
			this.audibleSpellCastVersion = this.heroCombat.castVersion;
			this.audio.play("spell");
		}
		if (this.hero.presentationAttackVersion !== this.audibleHeroAttackVersion) {
			this.audibleHeroAttackVersion = this.hero.presentationAttackVersion;
			this.audio.play("attack");
		}
		this.auraSystem.update(
			deltaSeconds,
			this.hero,
			this.player.progress,
			this.creeps,
			systemRandom,
			this.arena.spellEffects,
		);
		for (const swamp of this.arena.swamps)
			swamp.update(deltaSeconds, this.creeps);
		for (const blizzard of this.arena.blizzards)
			blizzard.update(deltaSeconds, this.creeps, systemRandom);
		for (const creep of this.creeps) {
			if (!creep.active) continue;
			if (creep === this.duelOpponent) continue;
			creep.castHealing(this.creeps, this.arena.spellEffects, this.hero);
			const audibleAttackVersion =
				this.audibleAttackVersions.get(creep) ??
				creep.presentationAttackVersion;
			const attack = creep.pursue(
				this.hero.position,
				deltaSeconds,
				this.map.width,
				this.map.height,
			);
			if (creep.presentationAttackVersion !== audibleAttackVersion)
				this.audio.play("attack");
			this.audibleAttackVersions.set(creep, creep.presentationAttackVersion);
			resolveColumnCollision(creep, this.map.columns);
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
						creep.build.mainHand?.definitionId === "staff"
							? STAFF_BASIC_HALF_ARC
							: Math.PI,
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
					new SpellEffect("fireBreath", attack.origin, attack.angle, 150),
				);
			}
			if (attack?.type === "forceField") {
				const level = creep.skillLevels.get("gravityPull") ?? 1;
				castForceFieldTargets(creep, [this.hero], level, systemRandom);
				pushDrops(this.drops, creep.position, forceFieldRange(level));
				cancelHostileProjectiles(this.projectiles, creep, "creep", level);
				this.arena.spellEffects.push(
					new SpellEffect(
						"gravityPull",
						creep.position,
						0,
						forceFieldRange(level),
					),
				);
			}
		}
		const activeUnits = [
			...(this.hero.active ? [this.hero] : []),
			...this.creeps.filter((creep) => creep.active),
		];
		resolveUnitCollisions(activeUnits, (unit) => {
			resolveColumnCollision(unit, this.map.columns);
			if (unit === this.hero)
				this.hero.clampToBounds(this.map.width, this.map.height);
			else
				correctArenaBoundary(unit as Creep, this.map.width, this.map.height, 0);
		});
		for (const attack of this.attacks) attack.update(deltaSeconds);
		const emittedProjectiles: Projectile[] = [];
		for (const projectile of this.projectiles) {
			projectile.update(deltaSeconds);
			if (projectile.active && touchesColumn(projectile, this.map.columns))
				projectile.active = false;
			else emittedProjectiles.push(...projectile.emitFrostSpikes(deltaSeconds));
		}
		this.projectiles.push(...emittedProjectiles);
		for (const effect of this.arena.spellEffects) effect.update(deltaSeconds);
		for (const death of this.arena.characterDeaths) death.update(deltaSeconds);
		const baseStats = this.player.progress.stats;
		const attractionEnabled = this.hero.isSkillOperational("attraction");
		const attractionLevel = this.hero.skillLevels.get("attraction") ?? 1;
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
				) * attractionSpeedMultiplier(attractionLevel)
			: 0;
		for (const drop of this.drops) {
			if (attractionSpeed > 0 && !this.pendingPickups.has(drop.dropId))
				drop.pullToward(this.hero.position, attractionSpeed, deltaSeconds);
			drop.move(deltaSeconds);
			correctArenaBoundary(drop, this.map.width, this.map.height, deltaSeconds);
		}
		resolveCombat(
			this.arena,
			this.hero,
			this.player.progress.mainHand,
			this.map.width,
			this.map.height,
			systemRandom,
		);
		if (this.duelOpponent) {
			const dealt = Math.max(0, this.duelOpponentHp - this.duelOpponent.hp);
			if (dealt > 0) this.socket.send({ type: "duelDamage", amount: dealt });
			this.duelOpponentHp = this.duelOpponent.hp;
			if (performance.now() - this.duelLastSyncAt >= 50) {
				this.duelLastSyncAt = performance.now();
				this.socket.send({
					type: "duelState",
					x: this.hero.position.x,
					y: this.hero.position.y,
					facing: this.hero.facing,
					hp: this.hero.hp,
				});
			}
		}
		this.hero.advanceEffects(deltaSeconds);
		for (const creep of this.creeps) creep.advanceEffects(deltaSeconds);
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
		if (
			activeEnemyCountAllowsAutoForce(
				this.creeps.filter((creep) => creep.active).length,
			)
		)
			this.hud.trySwarmMode();
		removeInactive(this.drops);
		removeInactive(this.arena.spellEffects);
		removeInactive(this.arena.swamps);
		removeInactive(this.arena.blizzards);
		removeInactive(this.arena.characterDeaths);
		if (this.hoveredDrop && !this.hoveredDrop.active) {
			this.hoveredDrop = undefined;
			this.hud.setGroundDropPreview();
		}
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
				if (creep === this.duelOpponent) continue;
				const deathVisual = creep.createDeathVisual();
				if (deathVisual) {
					this.arena.characterDeaths.push(deathVisual);
					this.audio.play("creepDeath");
				}
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
				this.drops.push(
					new ItemDrop(
						drop,
						reconciledDropPosition(this.hero.position, this.defeatDropPosition),
					),
				);
		this.defeatDropPosition = undefined;
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
		creep.radialReflect = (reflected, random, kind) => {
			if (
				!this.hero.active ||
				distance(creep.position, this.hero.position) > 300
			)
				return;
			this.hero.receiveDamage(reflected, random, creep, false, false, { kind });
		};
		this.creeps.push(creep);
	}
	private attachRadialReflect(hero: Hero): void {
		hero.radialReflect = (reflected, random, kind) => {
			if (!hero.active) return;
			for (const creep of this.creeps)
				if (creep.active && distance(hero.position, creep.position) <= 300)
					creep.receiveDamage(reflected, random, hero, false, false, {
						kind,
					});
		};
	}
	private handleDefeat(): void {
		if (this.waveMode === "training") return;
		this.defeatDropPosition = { ...this.hero.position };
		this.defeatCooldown = 1.8;
		this.socket.send({
			type: "heroDefeated",
			sourceUnitId: this.hero.lastDamageSourceId,
			sourcePlayerId: this.lastBonkAttackerId,
		});
		this.lastBonkAttackerId = undefined;
		this.hud.showDeathModal(
			this.duelOpponent ? "Your ass got looted by a bonker." : undefined,
		);
	}
	private resetArena(): void {
		this.hud.closeDeathModal();
		this.arena.clear();
		this.duelOpponent = undefined;
		this.hoveredDrop = undefined;
		this.hud.setGroundDropPreview();
		this.pendingPickupAt.clear();
		this.heroCombat.reset();
		this.auraSystem.reset();
		this.hero = new Hero(this.map.center);
		this.hero.onCombatText = (text) => this.arena.addCombatText(text);
		this.attachRadialReflect(this.hero);
		this.hero.applyProgress(this.player!.progress);
		this.clearInspection();
		this.socket.send({ type: "requestWave" });
		this.reconcileDrops();
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
		this.player.reflectiveSurgeRemaining = this.hero.reflectiveSurgeRemaining;
		this.player.rapidRegenRemaining = this.hero.effectRemaining("rapidRegen");
		this.player.gold = this.player.progress.gold;
	}

	private updateHover(event: MouseEvent): void {
		const world = this.eventWorld(event);
		const dropDistance = (drop: ItemDrop): number =>
			distance(
				drop.position,
				this.renderer.eventWorld(
					event,
					groundDropPresentationCenter(drop.drop),
				),
			);
		const previousDrop = this.hoveredDrop;
		this.hoveredDrop = this.drops
			.filter((drop) => drop.active)
			.sort((a, b) => dropDistance(a) - dropDistance(b))[0];
		if (
			this.hoveredDrop &&
			dropDistance(this.hoveredDrop) > this.hoveredDrop.radius + 8
		)
			this.hoveredDrop = undefined;
		if (this.hoveredDrop !== previousDrop)
			this.hud.setGroundDropPreview(this.hoveredDrop?.drop);
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
		this.canvas.style.cursor =
			this.hovered || this.hoveredDrop ? "pointer" : "default";
		if (this.hovered === previous) return;
		if (this.hovered) {
			const reward = this.creepInspectionReward(this.hovered);
			this.hud.setInspectionPreview(
				this.hovered.build,
				reward,
				undefined,
				this.hovered.maxHp,
				this.hovered.hp,
				this.hovered.timedStates(),
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
			this.inspected?.hp,
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
	private closestLivingCreep(): Creep | undefined {
		let closest: Creep | undefined;
		let closestDistance = Number.POSITIVE_INFINITY;
		for (const creep of this.creeps) {
			if (!creep.active || creep.hp <= 0) continue;
			const candidateDistance = distance(this.hero.position, creep.position);
			if (candidateDistance < closestDistance) {
				closest = creep;
				closestDistance = candidateDistance;
			}
		}
		return closest;
	}
	private updateCamera(): void {
		this.renderer.updateCameraPosition(
			this.hero.position.x,
			this.hero.position.y,
		);
	}
	private render(): void {
		this.hero.setAimGuide(
			this.aimingHero,
			this.hero.mainHand ? weaponRange(this.hero.mainHand) : undefined,
		);
		this.renderer.syncScene(
			this.hero,
			this.arena,
			this.hovered,
			this.inspected ?? this.aimTarget,
		);
		this.renderer.render();
	}
	private resize(): void {
		const width = this.canvas.clientWidth || innerWidth;
		const height = this.canvas.clientHeight || innerHeight;
		this.renderer.resize(width, height);
		this.updatePanelCameraFraming();
		this.updateCamera();
	}
	private updatePanelCameraFraming(): void {
		const width = this.canvas.clientWidth || innerWidth;
		const { left, right } = this.hud.panelOcclusion(width);
		this.renderer.setPanelOcclusion(left, right);
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

export function serverCloseLogMessage(
	event: Pick<CloseEvent, "code" | "reason">,
): string {
	const detail = event.reason.trim()
		? `code ${event.code}: ${event.reason.trim()}`
		: `code ${event.code}`;
	return `Server closed the connection (${detail}). Reconnecting...`;
}

export function reconciledDropPosition(
	heroPosition: Vector2,
	defeatPosition?: Vector2,
): Vector2 {
	return { ...(defeatPosition ?? heroPosition) };
}
