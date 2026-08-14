import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BALANCE } from "../common/balance";
import {
	arcaneBoltExplosionRadius,
	attackProfile,
	BASIC_ATTACK_RAGE_GAIN,
	HEALING_MAX_RADIUS,
	healingCast,
	healingRadius,
	RAGE_DECAY_PER_SECOND,
	spellPower,
	swampRadius,
	weaponAttackSpeed,
} from "../common/combat";
import { emptyScraps } from "../common/inventory";
import {
	generateAccessory,
	generateBuckler,
	generateItem,
	generateRelic,
	type ItemInstance,
	starterClub,
} from "../common/items";
import {
	DEFAULT_ALLOCATION,
	type Stats,
	ZERO_STATS,
} from "../common/progression";
import { SeededRandom } from "../common/random";
import { ArenaState } from "../src/game/ArenaState";
import { AttackArea } from "../src/game/AttackArea";
import { BLIZZARD_ICICLES_PER_VOLLEY, Blizzard } from "../src/game/Blizzard";
import { correctArenaBoundary } from "../src/game/bounds";
import { type CombatText, combatTextScale } from "../src/game/CombatText";
import {
	CREEP_RESOURCE_BAR_CAMERA_OFFSET,
	Creep,
	creepResourceBarAnchorY,
	ENEMY_ROLE_LIGHTS,
	enemyRoleLight,
	enemyRoleModelKind,
	placeCreepSenderLabel,
	resourceBarWidth,
} from "../src/game/Creep";
import {
	ANIMATION_FRAME_STALE_MS,
	backgroundFrameDue,
} from "../src/game/FrameScheduler";
import { GroundSwamp } from "../src/game/GroundSwamp";
import {
	DEFAULT_GRAPHICS_SETTINGS,
	FULLSCREEN_MODE_STORAGE_KEY,
	LIGHTING_MODE_STORAGE_KEY,
	loadFullscreenMode,
	loadLightingMode,
	loadResolutionScale,
	loadShadowMode,
	RESOLUTION_SCALE_STORAGE_KEY,
	SHADOW_MODE_STORAGE_KEY,
	saveFullscreenMode,
	saveLightingMode,
	saveResolutionScale,
	saveShadowMode,
} from "../src/game/graphicsSettings";
import { HERO_LIGHT, Hero } from "../src/game/Hero";
import { applyImpactForce, emittedImpactForce } from "../src/game/ImpactForce";
import {
	COIN_BOB_AMPLITUDE,
	COIN_BOB_SPEED,
	COIN_SCATTER_MULTIPLIER,
	COIN_SPIN_SPEED,
	coinPresentationOffset,
	DROP_MAX_SPEED,
	dropRarityColor,
	GOLD_COIN_DENOMINATIONS,
	goldCoinDenominations,
	groundDropPresentationCenter,
	ItemDrop,
} from "../src/game/ItemDrop";
import {
	arenaFloorMaterial,
	arenaObstacleConeSides,
	arenaObstacleMaterial,
	GameMap,
	generateArenaColumns,
	resolveColumnCollision,
	touchesColumn,
} from "../src/game/Map";
import {
	ORBITING_HAMMER_MODEL,
	orbitingHammerRotation,
	Projectile,
	projectilePresentationCenter,
	projectileSpellLightColor,
	projectileSpellLightRadius,
	VAMPIRIC_BOOMERANG_COLLISION_INTERVAL,
} from "../src/game/Projectile";
import {
	AnimatedCharacterDeath,
	CHARACTER_MODEL_MANIFESTS,
	matchingAnimationClip,
} from "../src/game/render/AnimatedCharacter";
import {
	BLIZZARD_PROJECTILE_LIGHT_COLOR,
	BLIZZARD_PROJECTILE_LIGHT_DISTANCE,
	BLIZZARD_PROJECTILE_LIGHT_INTENSITY,
	HeroSpellLightPool,
	SWAMP_UPLIGHT_COLOR,
	SWAMP_UPLIGHT_HEIGHT,
	SWAMP_UPLIGHT_INTENSITY,
	thunderLightPosition,
} from "../src/game/render/HeroSpellLightPool";
import {
	applySceneLightingMode,
	applySceneShadowMode,
	MAP_LAYER_STEP,
	MAP_Z,
	SCENE_LIGHTING,
	Z_CREEP_OVERLAY,
} from "../src/game/render/ThreeRenderer";
import {
	ELBO_HEIGHT,
	elbowHeight,
	FORCE_FIELD_ANIMATION_DURATION,
	FORCE_FIELD_LIGHT_FADE_DURATION,
	FORCE_FIELD_LIGHT_INTENSITY,
	HEALING_AURA_FILL_MAX_OPACITY,
	HEALING_AURA_RING_MAX_OPACITY,
	HEALING_GROUND_DURATION,
	HEALING_LIGHT_LINGER_DURATION,
	HEALING_UPLIGHT_INTENSITY,
	HERO_BLOOD_SPELL_COLOR,
	HOSTILE_SPELL_COLOR,
	healingAuraOpacity,
	healingPlusOpacity,
	healingUplightIntensity,
	rentSlashAngle,
	SpellEffect,
	spellEffectLightColor,
	spellEffectLightDistance,
	THUNDER_IMPACT_DURATION,
	THUNDER_IMPACT_LIGHT_COLOR,
	THUNDER_IMPACT_LIGHT_INTENSITY,
	THUNDER_IMPACT_LIGHT_OFFSET,
	WHIRLWIND_RADIANS_PER_SECOND,
} from "../src/game/SpellEffect";
import { resolveCombat } from "../src/game/systems/combat";
import {
	basicWeaponHitCount,
	cancelHostileProjectiles,
	castForceField,
	castForceFieldTargets,
	effectiveSkillLevel,
	forceField,
	HeroCombatSystem,
	pointAlongFacing,
	skillAffordable,
} from "../src/game/systems/HeroCombatSystem";
import {
	activeEnemyCountAllowsAutoForce,
	expediteQueuedSpawns,
	MAX_ACTIVE_CREEPS,
	releaseReadySpawns,
	removeInactive,
} from "../src/game/systems/lifecycle";
import { resolveUnitCollisions } from "../src/game/systems/movement";
import { damageStatusDuration, type Vector2 } from "../src/game/types";

describe("animated 3D characters", () => {
	test("maps semantic animation aliases case-insensitively", () => {
		const idle = new THREE.AnimationClip("IDLE", 1, []);
		const walk = new THREE.AnimationClip("Walk", 1, []);
		expect(matchingAnimationClip([idle, walk], ["idle"])).toBe(idle);
		expect(matchingAnimationClip([idle, walk], ["Run", "walk"])).toBe(walk);
		expect(matchingAnimationClip([idle], ["Attack"])).toBeUndefined();
	});
	test("stores shadows locally with an off default", () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		};
		expect(loadShadowMode(storage)).toBe("off");
		saveShadowMode(storage, "dynamic");
		expect(values.get(SHADOW_MODE_STORAGE_KEY)).toBe("dynamic");
		expect(loadShadowMode(storage)).toBe("dynamic");
	});
	test("stores fullscreen-on-start locally with an on default", () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		};
		expect(loadFullscreenMode(storage)).toBe("on");
		saveFullscreenMode(storage, "off");
		expect(values.get(FULLSCREEN_MODE_STORAGE_KEY)).toBe("off");
		expect(loadFullscreenMode(storage)).toBe("off");
		values.set(FULLSCREEN_MODE_STORAGE_KEY, "invalid");
		expect(loadFullscreenMode(storage)).toBe("on");
	});
	test("stores resolution scale locally from twenty through one hundred percent", () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		};
		expect(loadResolutionScale(storage)).toBe(1);
		saveResolutionScale(storage, 0.2);
		expect(values.get(RESOLUTION_SCALE_STORAGE_KEY)).toBe("0.2");
		expect(loadResolutionScale(storage)).toBe(0.2);
		values.set(RESOLUTION_SCALE_STORAGE_KEY, "0.1");
		expect(loadResolutionScale(storage)).toBe(1);
		values.set(RESOLUTION_SCALE_STORAGE_KEY, "1.1");
		expect(loadResolutionScale(storage)).toBe(1);
	});

	test("toggles dynamic shadow maps for scene lights and meshes", () => {
		const scene = new THREE.Scene();
		const mesh = new THREE.Mesh(new THREE.BoxGeometry());
		const excludedRoot = new THREE.Group();
		excludedRoot.userData.castShadow = false;
		excludedRoot.userData.receiveShadow = false;
		const excludedMesh = new THREE.Mesh(new THREE.BoxGeometry());
		excludedRoot.add(excludedMesh);
		const floor = new THREE.Mesh(new THREE.PlaneGeometry());
		floor.userData.castShadow = false;
		floor.userData.receiveShadow = true;
		const light = new THREE.SpotLight();
		scene.add(mesh, excludedRoot, floor, light);
		const renderer = { shadowMap: { enabled: false, type: 0 } } as Pick<
			THREE.WebGLRenderer,
			"shadowMap"
		>;
		applySceneShadowMode(renderer, scene, "dynamic");
		expect(renderer.shadowMap.enabled).toBeTrue();
		expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
		expect(mesh.castShadow).toBeTrue();
		expect(mesh.receiveShadow).toBeTrue();
		expect(excludedMesh.castShadow).toBeFalse();
		expect(excludedMesh.receiveShadow).toBeFalse();
		expect(floor.castShadow).toBeFalse();
		expect(floor.receiveShadow).toBeTrue();
		expect(light.castShadow).toBeTrue();
		applySceneShadowMode(renderer, scene, "off");
		expect(renderer.shadowMap.enabled).toBeFalse();
		expect(mesh.castShadow).toBeFalse();
		expect(light.castShadow).toBeFalse();
	});

	test("keeps hero and boss models world-sized and role-specific", () => {
		expect(CHARACTER_MODEL_MANIFESTS.hero.path).toBe("/assets/models/hero.glb");
		expect(CHARACTER_MODEL_MANIFESTS.hero.footprint).toBe(50);
		expect(CHARACTER_MODEL_MANIFESTS.hero.facingOffset).toBe(Math.PI / 2);
		expect(CHARACTER_MODEL_MANIFESTS.clone.path).toBe(
			CHARACTER_MODEL_MANIFESTS.hero.path,
		);
		expect(CHARACTER_MODEL_MANIFESTS.clone.footprint).toBe(37.5);
		expect(CHARACTER_MODEL_MANIFESTS.boss.path).toBe("/assets/models/boss.glb");
		expect(CHARACTER_MODEL_MANIFESTS.boss.footprint).toBe(70);
		expect(CHARACTER_MODEL_MANIFESTS.boss.facingOffset).toBe(Math.PI / 2);
		expect(enemyRoleModelKind("clone")).toBe("clone");
		expect(enemyRoleModelKind("invader")).toBe("hero");
	});

	test("uses a dark global baseline and short-radius role lights", () => {
		expect(DEFAULT_GRAPHICS_SETTINGS.lightingMode).toBe("all");
		expect(SCENE_LIGHTING).toEqual({
			clearColor: 0x05080c,
			ambientIntensity: { off: 1.1, hero: 0.25, all: 0.05 },
			keyIntensity: 0.95,
		});
		const hero = new Hero({ x: 10, y: 20 });
		const heroLights = hero.mesh.getObjectsByProperty(
			"type",
			"SpotLight",
		) as THREE.SpotLight[];
		expect(heroLights).toHaveLength(1);
		expect(heroLights[0].color.getHex()).toBe(HERO_LIGHT.color);
		expect(heroLights[0].distance).toBe(HERO_LIGHT.distance);
		expect(heroLights[0].intensity).toBe(180);
		expect(heroLights[0].position.z).toBe(HERO_LIGHT.height);
		expect(HERO_LIGHT.height).toBe(72);
		expect(heroLights[0].angle).toBe(HERO_LIGHT.angle);
		expect(THREE.MathUtils.radToDeg(HERO_LIGHT.angle)).toBeCloseTo(62);
		expect(Math.tan(HERO_LIGHT.angle) * HERO_LIGHT.height).toBeGreaterThan(134);
		expect(heroLights[0].penumbra).toBe(HERO_LIGHT.penumbra);
		expect(heroLights[0].target.position.z).toBe(0);
		expect(hero.mesh.getObjectsByProperty("type", "PointLight")).toHaveLength(
			0,
		);

		for (const role of ["champion", "boss", "clone"] as const) {
			const light = enemyRoleLight(role);
			expect(light?.color.getHex()).toBe(ENEMY_ROLE_LIGHTS[role].color);
			expect(light?.distance).toBe(ENEMY_ROLE_LIGHTS[role].distance);
			expect(light?.position.z).toBeGreaterThan(0);
		}
		expect(enemyRoleLight("creep")).toBeUndefined();
		expect(enemyRoleLight("invader")).toBeUndefined();
	});
	test("keeps the world-oriented aura presentation centered on its owner", () => {
		const hero = new Hero({ x: 10, y: 20 });
		hero.updateAuraVisuals(0);
		expect(hero.auraGroup.position.toArray()).toEqual([10, 20, 0]);

		hero.position.x = 90;
		hero.position.y = 130;
		hero.updateAuraVisuals(1);
		expect(hero.auraGroup.position.toArray()).toEqual([90, 130, 0]);
	});
	test("stores lighting as a browser-local preference and defaults invalid values to all", () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		};
		expect(loadLightingMode(storage)).toBe("all");
		saveLightingMode(storage, "all");
		expect(values.get(LIGHTING_MODE_STORAGE_KEY)).toBe("all");
		expect(loadLightingMode(storage)).toBe("all");
		values.set(LIGHTING_MODE_STORAGE_KEY, "invalid");
		expect(loadLightingMode(storage)).toBe("all");
	});

	test("applies ambient-only, hero-only, and all lighting modes", () => {
		const scene = new THREE.Scene();
		const ambient = new THREE.AmbientLight();
		const directional = new THREE.DirectionalLight();
		const heroRoot = new THREE.Group();
		const heroLight = new THREE.SpotLight();
		const effectLight = new THREE.PointLight();
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(),
			new THREE.MeshStandardMaterial({ color: 0xff8844 }),
		);
		const litMaterial = mesh.material;
		const shaderMaterial = new THREE.ShaderMaterial({
			uniforms: { tint: { value: new THREE.Color(0x55ccff) } },
			vertexShader:
				"void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
			fragmentShader:
				"void main() { gl_FragColor = vec4(0.2, 0.8, 1.0, 0.5); }",
			transparent: true,
		});
		const shaderMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(),
			shaderMaterial,
		);
		heroRoot.add(heroLight);
		scene.add(ambient, directional, heroRoot, effectLight, mesh, shaderMesh);

		applySceneLightingMode(scene, ambient, directional, heroRoot, "off");
		expect(ambient.intensity).toBe(1.1);
		expect(ambient.visible).toBeFalse();
		expect(directional.visible).toBeFalse();
		expect(heroLight.visible).toBeFalse();
		expect(effectLight.visible).toBeFalse();
		expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
		expect(mesh.material.color.getHex()).toBe(0xff8844);
		const firstUnlitMaterial = mesh.material;
		expect(shaderMesh.material).toBe(shaderMaterial);

		applySceneLightingMode(scene, ambient, directional, heroRoot, "hero");
		expect(mesh.material).toBe(litMaterial);
		expect(ambient.intensity).toBe(0.25);
		expect(directional.visible).toBeFalse();
		expect(heroLight.visible).toBeTrue();
		expect(effectLight.visible).toBeFalse();

		const futureEffectLight = new THREE.SpotLight();
		scene.add(futureEffectLight);
		applySceneLightingMode(scene, ambient, directional, heroRoot, "hero");
		expect(futureEffectLight.visible).toBeFalse();

		applySceneLightingMode(scene, ambient, directional, heroRoot, "off");
		expect(mesh.material).toBe(firstUnlitMaterial);
		expect(shaderMesh.material).toBe(shaderMaterial);

		applySceneLightingMode(scene, ambient, directional, heroRoot, "all");
		expect(ambient.intensity).toBe(0.05);
		expect(directional.visible).toBeTrue();
		expect(heroLight.visible).toBeTrue();
		expect(effectLight.visible).toBeTrue();
		expect(futureEffectLight.visible).toBeTrue();
	});

	test("centers fallback unit bodies above the zero-height floor", () => {
		const hero = new Hero({ x: 10, y: 20 });
		hero.updateVisuals(0);
		const heroBody = hero.mesh.children.find(
			(child) =>
				child.type === "Mesh" && child.geometry.type === "CircleGeometry",
		);
		expect(heroBody?.position.z).toBe(18);

		const creep = new Creep(
			{
				id: "grounded-creep",
				name: "Grounded",
				kind: "melee",
				level: 1,
				stats: { ...ZERO_STATS },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 10, y: 20 },
			BALANCE,
			new SeededRandom(1),
		);
		expect(
			creep.mesh.children.some(
				(child) => child.type === "Group" && child.position.z === creep.radius,
			),
		).toBeTrue();
	});

	test("flashes hero and enemy presentations white for exactly one rendered frame after damage", () => {
		const hero = new Hero({ x: 0, y: 0 });
		const heroBody = hero.mesh.children.find(
			(child) =>
				child.type === "Mesh" && child.geometry.type === "CircleGeometry",
		) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
		hero.takeDamage(1);
		hero.updateVisuals(0);
		expect(heroBody.material.color.getHex()).toBe(0xffffff);
		hero.updateVisuals(1 / 60);
		expect(heroBody.material.color.getHex()).toBe(0xdffeff);
		hero.reflectiveSurgeRemaining = 2;
		hero.updateVisuals(2 / 60);
		expect(
			(heroBody.material as unknown as THREE.MeshStandardMaterial).metalness,
		).toBe(0.9);
		expect(heroBody.material.color.getHex()).toBe(0x8a9197);

		const creep = new Creep(
			{
				id: "flash-creep",
				name: "Flash Creep",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 0, y: 0 },
			BALANCE,
			new SeededRandom(1),
		);
		let creepBody:
			| THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
			| undefined;
		creep.mesh.traverse((child) => {
			if (
				!creepBody &&
				child instanceof THREE.Mesh &&
				child.material instanceof THREE.MeshStandardMaterial &&
				!child.material.wireframe
			)
				creepBody = child;
		});
		expect(creepBody).toBeDefined();
		creep.takeDamage(1);
		creep.updateVisuals(0);
		expect(creepBody?.material.color.getHex()).toBe(0xffffff);
		creep.updateVisuals(1 / 60);
		expect(creepBody?.material.color.getHex()).not.toBe(0xffffff);
		creep.reflectiveSurgeRemaining = 2;
		creep.updateVisuals(2 / 60);
		expect(creepBody?.material.metalness).toBe(0.9);
		expect(creepBody?.material.color.getHex()).toBe(0x8a9197);
	});

	test("removes render-only boss defeat presentation after 1.2 seconds", () => {
		const death = new AnimatedCharacterDeath(
			"boss",
			{ x: 12, y: 34 },
			Math.PI / 3,
		);
		expect(death.mesh.position.toArray()).toEqual([12, 34, 0]);
		death.update(1.19);
		expect(death.active).toBeTrue();
		death.update(0.01);
		expect(death.active).toBeFalse();
	});

	test("ships compact standalone GLBs with their required clips", async () => {
		for (const [path, requiredClips] of [
			["public/assets/models/hero.glb", ["Idle", "Attack", "Hit"]],
			[
				"public/assets/models/boss.glb",
				["Idle", "Walk", "Attack", "Hit", "TurnOff"],
			],
		] as const) {
			const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
			expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("glTF");
			expect(bytes.byteLength).toBeLessThan(1_000_000);
			const contents = new TextDecoder().decode(bytes);
			for (const clip of requiredClips) expect(contents).toContain(clip);
		}
	});

	test("ships the compact standalone Orbiting Hammer model", async () => {
		const bytes = new Uint8Array(
			await Bun.file(`public${ORBITING_HAMMER_MODEL.path}`).arrayBuffer(),
		);
		expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("glTF");
		expect(bytes.byteLength).toBeLessThan(40_000);
	});
});

describe("hero facing attacks", () => {
	test("resolves directional targets from current hero facing", () => {
		expect(pointAlongFacing({ x: 10, y: 20 }, 0, 50)).toEqual({
			x: 60,
			y: 20,
		});
		const upward = pointAlongFacing({ x: 10, y: 20 }, Math.PI / 2, 50);
		expect(upward.x).toBeCloseTo(10);
		expect(upward.y).toBeCloseTo(70);
	});
});

describe("arena systems", () => {
	test("preserves emitted linear and radial impact directions", () => {
		const source = new Hero({ x: 0, y: 0 });
		source.configureStats({ ...ZERO_STATS, strength: 10 });
		const target = new Hero({ x: 20, y: 20 });
		applyImpactForce(
			target,
			emittedImpactForce(source, "linear", source.position, { x: 1, y: 0 }),
		);
		expect(target.velocity).toEqual({ x: 30, y: 0 });
		target.velocity = { x: 0, y: 0 };
		applyImpactForce(
			target,
			emittedImpactForce(source, "radial", source.position),
		);
		expect(target.velocity.x).toBeCloseTo(Math.SQRT1_2 * 30);
		expect(target.velocity.y).toBeCloseTo(Math.SQRT1_2 * 30);
	});

	test("slows movement after received damage but not while attacking", () => {
		const hero = new Hero({ x: 50, y: 50 });
		hero.movementSpeedMultiplier = 1.5;
		hero.move({ x: 1, y: 0 }, 1, 2_000, 2_000);
		expect(hero.velocity.x).toBe(352.5);
		hero.velocity = { x: 0, y: 0 };
		hero.presentAttack();
		hero.move({ x: 1, y: 0 }, 1, 2_000, 2_000);
		expect(hero.velocity.x).toBe(352.5);
		hero.velocity = { x: 0, y: 0 };
		hero.takeDamage(1);
		hero.move({ x: 1, y: 0 }, 1, 2_000, 2_000);
		expect(hero.velocity.x).toBe(169.2);
		hero.update(0.35);
		hero.velocity = { x: 0, y: 0 };
		hero.move({ x: 1, y: 0 }, 1, 2_000, 2_000);
		expect(hero.velocity.x).toBe(352.5);
	});
	test("starts Rage at five, decays at one per second, and gains three on attack", () => {
		const hero = new Hero({ x: 50, y: 50 });
		hero.configureStats({ ...ZERO_STATS, spirit: 10 });
		expect(hero.rage).toBe(5);
		hero.update(1, undefined, false);
		expect(hero.rage).toBeCloseTo(5 - RAGE_DECAY_PER_SECOND);
		hero.grantRage(BASIC_ATTACK_RAGE_GAIN);
		hero.update(1, undefined, false);
		expect(hero.rage).toBeCloseTo(
			5 -
				RAGE_DECAY_PER_SECOND +
				BASIC_ATTACK_RAGE_GAIN -
				RAGE_DECAY_PER_SECOND,
		);
	});
	test("gains two Rage from damage and one from a dodge", () => {
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats({ ...ZERO_STATS, agility: 100 });
		hero.rage = 0;
		hero.receiveDamage(1, { next: () => 0 });
		expect(hero.rage).toBe(1);
		hero.rage = 0;
		hero.receiveDamage(1, { next: () => 1 });
		expect(hero.rage).toBe(2);
	});
	test("drains combined passive upkeep and suspends effects until Mana reaches one", () => {
		const hero = new Hero({ x: 50, y: 50 });
		hero.configureStats(ZERO_STATS);
		hero.knownSkills.add("attraction");
		hero.knownSkills.add("penance");
		hero.skillLevels.set("attraction", 10);
		hero.skillLevels.set("penance", 10);
		hero.mana = 5;
		hero.update(1);
		expect(hero.mana).toBeCloseTo(4.99);
		expect(hero.rage).toBeCloseTo(3.98);

		hero.knownSkills.clear();
		hero.skillLevels.clear();
		hero.knownSkills.add("deathBurst");
		hero.skillLevels.set("deathBurst", 99);
		hero.mana = 0;
		hero.update(1);
		expect(hero.mana).toBeCloseTo(0.2);
		expect(hero.isSkillOperational("deathBurst")).toBeFalse();
		hero.update(1);
		hero.update(1);
		hero.update(1);
		expect(hero.mana).toBeCloseTo(0.8);
		expect(hero.isSkillOperational("deathBurst")).toBeFalse();
		hero.update(1);
		expect(hero.mana).toBeCloseTo(0.01);
		expect(hero.isSkillOperational("deathBurst")).toBeTrue();
	});
	test("clamps resources and renders bounded creep resource-bar widths", () => {
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(ZERO_STATS);
		hero.mana = 0.5;
		hero.rage = 0.5;
		expect(hero.spendMana(1)).toBeFalse();
		expect(hero.mana).toBe(0.5);
		expect(hero.spendRage(1)).toBeFalse();
		expect(hero.rage).toBe(0.5);
		hero.takeDamage(hero.maxHp + 100);
		expect(hero.hp).toBe(0);
		expect(resourceBarWidth(-1, 10)).toBe(0);
		expect(resourceBarWidth(5, 10)).toBe(16);
		expect(resourceBarWidth(20, 10)).toBe(32);
		expect(resourceBarWidth(1, 0)).toBe(0);
	});
	test("keeps creep resource bars slightly in front of sprite depth", () => {
		const creep = new Creep(
			{
				id: "front-bars",
				name: "Front Bars",
				kind: "melee",
				level: 1,
				stats: { ...ZERO_STATS },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 10, y: 20 },
			BALANCE,
			new SeededRandom(1),
		);
		creep.healthBarGroup.position.set(10, 20, 0);
		expect(creep.resourceBarAnchorY).toBe(creepResourceBarAnchorY(32));
		expect(creepResourceBarAnchorY(16 * 2.5)).toBe(48);
		expect(creepResourceBarAnchorY(22 * 3.2)).toBeCloseTo(78.4);
		for (const bar of creep.healthBarGroup.children)
			if (bar instanceof THREE.Mesh && bar.name !== "creep-state-icon")
				expect(bar.position.y).toBeGreaterThanOrEqual(creep.resourceBarAnchorY);
		creep.faceCamera(new THREE.Quaternion());
		expect(creep.healthBarGroup.position.z).toBe(
			CREEP_RESOURCE_BAR_CAMERA_OFFSET,
		);
		for (const bar of creep.healthBarGroup.children) {
			if (!(bar instanceof THREE.Mesh)) continue;
			expect(bar.renderOrder).toBe(Z_CREEP_OVERLAY);
			const material = bar.material as THREE.MeshBasicMaterial;
			expect(material.depthTest).toBeFalse();
			expect(material.depthWrite).toBeFalse();
		}
		const camera = new THREE.PerspectiveCamera(52, 1, 1, 3000);
		camera.position.set(0, 0, 300);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		creep.position.x = 10_000;
		creep.position.y = 0;
		creep.updateThreatArrow(camera);
		expect(creep.threatArrow.visible).toBeTrue();
		const arrowNdc = creep.threatArrow.position.clone().project(camera);
		expect(Math.max(Math.abs(arrowNdc.x), Math.abs(arrowNdc.y))).toBeCloseTo(
			0.88,
		);
		creep.position.x = 0;
		creep.updateThreatArrow(camera);
		expect(creep.threatArrow.visible).toBeFalse();
	});
	test("keeps sent-item sender labels in the camera-facing resource stack", () => {
		const resourceBarGroup = new THREE.Group();
		const label = new THREE.Sprite();
		const cameraRotation = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0.4, -0.2, 0.1),
		);

		placeCreepSenderLabel(resourceBarGroup, label, 72);
		resourceBarGroup.quaternion.copy(cameraRotation);

		expect(label.parent).toBe(resourceBarGroup);
		expect(label.position.toArray()).toEqual([0, 72, 0.01]);
		expect(resourceBarGroup.quaternion.equals(cameraRotation)).toBeTrue();
	});
	test("applies passive upkeep suspension to spawned enemies", () => {
		const creep = new Creep(
			{
				id: "upkeep",
				name: "Upkeep",
				kind: "melee",
				level: 99,
				stats: { ...ZERO_STATS },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
				skillLevels: { deathBurst: 99 },
			},
			"neutral",
			"neutral",
			{ x: 100, y: 0 },
			BALANCE,
			new SeededRandom(1),
		);
		creep.mana = 0;
		creep.pursue({ x: 0, y: 0 }, 1, 1_000, 1_000);
		expect(creep.mana).toBeCloseTo(0.2);
		expect(creep.isSkillOperational("deathBurst")).toBeFalse();
	});
	test("releases at most one overdue spawn per fixed update", () => {
		const state = new ArenaState();
		const build = {
			id: "queued",
			name: "Queued",
			kind: "melee" as const,
			level: 0,
			stats: { ...ZERO_STATS },
			carried: [],
			isRival: false,
			xpReward: 0,
			goldReward: 0,
			seed: 1,
		};
		state.waveQueue.push(
			{ build: { ...build, id: "one" }, spawnAt: 1 },
			{ build: { ...build, id: "two" }, spawnAt: 2 },
		);
		expect(releaseReadySpawns(state, 100).map(({ id }) => id)).toEqual(["one"]);
		expect(releaseReadySpawns(state, 100).map(({ id }) => id)).toEqual(["two"]);
	});
	test("makes every pending spawn due without releasing them together", () => {
		const state = new ArenaState();
		const build = {
			id: "queued",
			name: "Queued",
			kind: "melee" as const,
			level: 0,
			stats: { ...ZERO_STATS },
			carried: [],
			isRival: false,
			xpReward: 0,
			goldReward: 0,
			seed: 1,
		};
		state.waveQueue.push(
			{ build: { ...build, id: "one" }, spawnAt: 10_000 },
			{ build: { ...build, id: "two" }, spawnAt: 20_000 },
		);

		expediteQueuedSpawns(state, 100);

		expect(state.waveQueue.map(({ spawnAt }) => spawnAt)).toEqual([100, 100]);
		expect(releaseReadySpawns(state, 100).map(({ id }) => id)).toEqual(["one"]);
		expect(state.waveQueue.map(({ build: queued }) => queued.id)).toEqual([
			"two",
		]);
	});
	test("allows auto force only below the active-enemy cap", () => {
		expect(activeEnemyCountAllowsAutoForce(99)).toBeTrue();
		expect(activeEnemyCountAllowsAutoForce(100)).toBeFalse();
	});
	test("keeps due spawns queued until the 100-creep cap has an open slot", () => {
		const state = new ArenaState();
		const build = {
			id: "waiting",
			name: "Waiting",
			kind: "melee" as const,
			level: 0,
			stats: { ...ZERO_STATS },
			carried: [],
			isRival: false,
			xpReward: 0,
			goldReward: 0,
			seed: 1,
		};
		state.waveQueue.push({ build, spawnAt: 1 });
		state.creeps.push(
			...Array.from(
				{ length: MAX_ACTIVE_CREEPS },
				() => ({ active: true }) as never,
			),
		);

		expect(releaseReadySpawns(state, 100)).toEqual([]);
		expect(state.waveQueue.map(({ build: queued }) => queued.id)).toEqual([
			"waiting",
		]);

		state.creeps[0].active = false;
		expect(releaseReadySpawns(state, 100).map(({ id }) => id)).toEqual([
			"waiting",
		]);
		expect(state.waveQueue).toHaveLength(0);
	});
	test("runs a background frame only after animation frames become stale", () => {
		const lastAnimationFrameAt = 1_000;
		expect(
			backgroundFrameDue(
				lastAnimationFrameAt + ANIMATION_FRAME_STALE_MS - 1,
				lastAnimationFrameAt,
			),
		).toBeFalse();
		expect(
			backgroundFrameDue(
				lastAnimationFrameAt + ANIMATION_FRAME_STALE_MS,
				lastAnimationFrameAt,
			),
		).toBeTrue();
	});
	test("lets an affordable healing creep restore itself and nearby allies", () => {
		const build = {
			id: "healer",
			name: "Healer",
			kind: "melee" as const,
			level: 1,
			stats: { ...ZERO_STATS, strength: 20, intelligence: 10 },
			mainHand: starterClub(),
			carried: [],
			isRival: false,
			xpReward: 0,
			goldReward: 0,
			seed: 1,
			skillLevels: { healing: 1 },
		};
		const healer = new Creep(
			build,
			"neutral",
			"neutral",
			{ x: 0, y: 0 },
			BALANCE,
			new SeededRandom(1),
		);
		const ally = new Creep(
			{ ...build, id: "ally", skillLevels: {} },
			"neutral",
			"neutral",
			{ x: 140, y: 0 },
			BALANCE,
			new SeededRandom(2),
		);
		const distantAlly = new Creep(
			{ ...build, id: "distant-ally", skillLevels: {} },
			"neutral",
			"neutral",
			{ x: 160, y: 0 },
			BALANCE,
			new SeededRandom(3),
		);
		healer.hp = healer.maxHp * 0.51;
		expect(healer.castHealing([healer, ally, distantAlly], [])).toBeFalse();
		healer.hp = healer.maxHp / 2;
		ally.hp = ally.maxHp / 2;
		distantAlly.hp = distantAlly.maxHp / 2;
		const mana = healer.mana;
		const expectedCost = healingCast(
			healer.hp,
			healer.maxHp,
			healer.rage,
			healer.maxRage,
			1,
		).manaCost;
		const effects: SpellEffect[] = [];
		expect(healer.castHealing([healer, ally, distantAlly], effects)).toBeTrue();
		expect(healer.mana).toBeCloseTo(mana - expectedCost);
		expect(healer.hp).toBeGreaterThan(healer.maxHp / 2);
		expect(ally.hp).toBeGreaterThan(ally.maxHp / 2);
		expect(distantAlly.hp).toBe(distantAlly.maxHp / 2);
		expect(effects).toHaveLength(1);
	});
	test("reports spell affordability from the hero's current resources", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const weapon = starterClub();
		hero.configureStats({ ...ZERO_STATS, intelligence: 5 }, undefined, weapon);
		const progress = {
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS, intelligence: 5 },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			mainHand: weapon,
			inventoryTiles: [],
			learnedSkills: [
				"bash" as const,
				"gravityPull" as const,
				"rent" as const,
				"penance" as const,
			],
			learnedSkillLevels: { bash: 1, gravityPull: 1, rent: 1, penance: 1 },
			universalSkills: [],
			equippedSkills: ["bash", "rent"],
			autoFireSkills: ["bash", "rent"],
		};
		hero.rage = 0;
		expect(skillAffordable("bash", progress, hero)).toBeFalse();
		hero.mana = 7;
		expect(skillAffordable("gravityPull", progress, hero)).toBeFalse();
		hero.mana = 8;
		expect(skillAffordable("gravityPull", progress, hero)).toBeTrue();
		hero.hp = 1;
		expect(skillAffordable("rent", progress, hero)).toBeFalse();
		new HeroCombatSystem().syncSkills(progress, hero);
		expect(skillAffordable("penance", progress, hero)).toBeTrue();
	});
	test("Time Harvest removes every tracked hero cooldown after a kill", () => {
		const hero = new Hero({ x: 50, y: 50 });
		hero.configureStats(ZERO_STATS);
		const combat = new HeroCombatSystem();
		const internal = combat as unknown as {
			attackCooldown: number;
			healingCooldown: number;
			skillCooldowns: Map<string, { remaining: number; maximum: number }>;
		};
		internal.attackCooldown = 5;
		internal.healingCooldown = 3;
		internal.skillCooldowns.set("bash", { remaining: 2, maximum: 2 });
		const amulet = Array.from({ length: 100 }, (_, seed) => ({
			...generateAccessory(0, "epic", seed, "amulet"),
			requirements: {},
		})).find((item) => item.skills.includes("timeHarvest"))!;
		const progress = {
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			mainHand: starterClub(),
			amulet,
			inventoryTiles: [],
			learnedSkills: [],
			learnedSkillLevels: {},
			universalSkills: [],
			equippedSkills: ["bash"],
			autoFireSkills: ["bash"],
		};
		expect(combat.onKill(progress, hero)).toBe(0.25);
		expect(internal.attackCooldown).toBe(4.75);
		expect(internal.healingCooldown).toBe(2.75);
		expect(internal.skillCooldowns.get("bash")?.remaining).toBe(1.75);
	});
	test("restores stacked requirement-adjusted accessory resources on kill", () => {
		const hero = new Hero({ x: 0, y: 0 });
		const amulet = {
			...generateAccessory(10, "rare", 31, "amulet"),
			requirements: {},
			statBonuses: {},
			accessoryBonuses: { healthOnKill: 20, manaOnKill: 30 },
		};
		const charm = {
			...generateAccessory(10, "rare", 32, "charm"),
			requirements: { spirit: 1 },
			statBonuses: {},
			accessoryBonuses: { healthOnKill: 10, manaOnKill: 20 },
		};
		const state = {
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS, strength: 100, intelligence: 100 },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			mainHand: starterClub(),
			amulet,
			charm,
			inventoryTiles: [],
			learnedSkills: [],
			learnedSkillLevels: {},
			universalSkills: [],
		};
		hero.applyProgress(state);
		hero.hp = 1;
		hero.mana = 0;
		new HeroCombatSystem().onKill(state, hero);
		expect(hero.hp).toBeCloseTo(30.0909);
		expect(hero.mana).toBeCloseTo(48.1818);
	});
	test("Spirit Wounds restores Mana and echoes every critical damage kind as non-recursive Cold damage", () => {
		const source = new Hero({ x: 0, y: 0 });
		source.configureStats({ ...ZERO_STATS, intelligence: 100 });
		source.knownSkills.add("manaDrain");
		source.skillLevels.set("manaDrain", 1);
		source.mana = 0;
		for (const kind of [
			"physical",
			"magic",
			"electric",
			"poison",
			"fire",
			"bleed",
		] as const) {
			const target = new Hero({ x: 10, y: 0 });
			target.configureStats({ ...ZERO_STATS, strength: 100 });
			const texts: CombatText[] = [];
			target.onCombatText = (text) => texts.push(text);
			const hp = target.hp;
			expect(
				target.receiveDamage(20, { next: () => 1 }, source, false, false, {
					kind,
					critical: true,
				}),
			).toBe(20);
			expect(target.hp).toBeCloseTo(hp - 20.2);
			expect(texts).toMatchObject([
				{ kind, critical: true },
				{ kind: "cold", critical: false },
			]);
		}
		expect(source.mana).toBeCloseTo(1.2);
	});
	test("Spirit Wounds lets status damage roll criticals and applies Frost resistance only to its Cold echo", () => {
		const source = new Hero({ x: 0, y: 0 });
		source.configureStats({ ...ZERO_STATS, agility: 100, intelligence: 10 });
		source.knownSkills.add("manaDrain");
		source.skillLevels.set("manaDrain", 99);
		source.mana = 0;
		const frostWard = { ...starterClub(), perks: { frostResist: 0.5 } };
		const target = new Hero({ x: 10, y: 0 });
		target.configureStats(
			{ ...ZERO_STATS, strength: 100 },
			undefined,
			frostWard,
		);
		target.addStatus({
			kind: "poison",
			remaining: 2,
			damagePerSecond: 10,
			source,
		});
		const hp = target.hp;
		target.compileState(1, { next: () => 0 });
		target.updateResources(1, { next: () => 0 });
		target.advanceEffects(1);
		expect(source.mana).toBeCloseTo(4.25);
		expect(target.hp).toBeCloseTo(hp - 17 - 2.125 + 0.005);
	});
	test("Spirit Wounds does nothing for non-critical damage", () => {
		const source = new Hero({ x: 0, y: 0 });
		source.configureStats({ ...ZERO_STATS, intelligence: 100 });
		source.knownSkills.add("manaDrain");
		source.skillLevels.set("manaDrain", 99);
		source.mana = 0;
		const target = new Hero({ x: 10, y: 0 });
		target.configureStats({ ...ZERO_STATS, strength: 100 });
		const hp = target.hp;
		target.receiveDamage(20, { next: () => 1 }, source, false, false, {
			kind: "magic",
			critical: false,
		});
		expect(source.mana).toBe(0);
		expect(target.hp).toBe(hp - 20);
	});
	test("Spirit Wounds overfills Mana to three times maximum and preserves it", () => {
		const source = new Hero({ x: 0, y: 0 });
		source.configureStats(ZERO_STATS);
		source.knownSkills.add("manaDrain");
		source.skillLevels.set("manaDrain", 99);
		source.mana = source.maxMana;
		const target = new Hero({ x: 10, y: 0 });
		target.configureStats({ ...ZERO_STATS, strength: 1_000 });
		target.receiveDamage(100, { next: () => 1 }, source, false, false, {
			kind: "magic",
			critical: true,
		});
		expect(source.mana).toBe(source.maxMana * 3);
		source.compileState(1);
		source.updateResources(1);
		source.restoreMana(10);
		expect(source.mana).toBe(source.maxMana * 3);
	});
	test("chains rotating skill casts while basic attacks run on their own cooldown", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const weapon = starterClub();
		hero.configureStats(ZERO_STATS, undefined, weapon);
		const target = new Creep(
			{
				id: "cast-target",
				name: "Target",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: weapon,
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 80, y: 50 },
			BALANCE,
			new SeededRandom(1),
		);
		const state = new ArenaState();
		state.creeps.push(target);
		const progress = {
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			mainHand: weapon,
			inventoryTiles: [],
			learnedSkills: ["bash" as const, "rent" as const],
			learnedSkillLevels: { bash: 1, rent: 1 },
			universalSkills: [],
			equippedSkills: ["bash", "rent" as const],
			autoFireSkills: ["bash", "rent" as const],
		};
		const combat = new HeroCombatSystem();
		const rage = hero.rage;
		combat.update(
			1 / 60,
			{ x: 0, y: 0 },
			hero,
			state,
			progress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(combat.attacking).toBeTrue();
		expect(
			combat.spellSlots(progress, hero).find((slot) => slot.id === "bash"),
		).toMatchObject({
			active: true,
			passive: false,
			bar: "learned",
			shortcut: 1,
		});
		expect(state.attacks).toHaveLength(1);
		expect(state.attacks[0].skill).toBeUndefined();
		expect(hero.rage).toBe(rage + BASIC_ATTACK_RAGE_GAIN);
		const rageAfterBasic = hero.rage;
		combat.update(
			0.2,
			{ x: 0, y: 0 },
			hero,
			state,
			progress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(state.attacks).toHaveLength(1);
		expect(hero.rage).toBe(rageAfterBasic);
		combat.update(
			0.2,
			{ x: 0, y: 0 },
			hero,
			state,
			progress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(
			state.attacks.filter((attack) => attack.skill === "bash"),
		).toHaveLength(1);
		expect(hero.rage).toBeGreaterThanOrEqual(rageAfterBasic);
		expect(
			(combat as unknown as { attackCooldown: number }).attackCooldown,
		).toBeLessThan(1);
		expect(
			combat.spellSlots(progress, hero).find((slot) => slot.id === "bash")
				?.castProgress,
		).toBeUndefined();
		expect(
			combat.spellSlots(progress, hero).find((slot) => slot.id === "rent")
				?.castProgress,
		).toBeGreaterThan(0);
		const hpBeforeRent = hero.hp;
		combat.update(
			0.3,
			{ x: 0, y: 0 },
			hero,
			state,
			progress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(
			state.attacks.filter((attack) => attack.skill === "rent"),
		).toHaveLength(1);
		expect(hero.hp).toBeLessThan(hpBeforeRent);
	});
	test("auto-faces the closest visible enemy while moving regardless of spell affordability", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const weapon = starterClub();
		hero.configureStats(ZERO_STATS, undefined, weapon);
		hero.facing = Math.PI / 2;
		const target = new Creep(
			{
				id: "facing-target",
				name: "Target",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: weapon,
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 80, y: 50 },
			BALANCE,
			new SeededRandom(1),
		);
		const state = new ArenaState();
		state.creeps.push(target);
		const progress = {
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			mainHand: weapon,
			inventoryTiles: [],
			learnedSkills: ["bash" as const],
			learnedSkillLevels: { bash: 1 },
			universalSkills: [],
			equippedSkills: ["bash" as const],
			autoFireSkills: ["bash" as const],
		};
		const combat = new HeroCombatSystem();
		hero.rage = 0;
		hero.velocity = { x: 0, y: 100 };
		combat.update(
			1 / 60,
			{ x: 0, y: 1 },
			hero,
			state,
			progress,
			BALANCE,
			new SeededRandom(1),
			undefined,
			() => false,
		);
		expect(hero.facing).toBe(Math.PI / 2);

		combat.update(
			1 / 60,
			{ x: 0, y: 1 },
			hero,
			state,
			progress,
			BALANCE,
			new SeededRandom(1),
			undefined,
			() => true,
		);
		expect(hero.facing).toBeLessThan(Math.PI / 2);
	});
	test("basic weapon attacks are free and grant rage when swung", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const weapon = starterClub();
		hero.configureStats(ZERO_STATS, undefined, weapon);
		hero.rage = 0;
		const target = new Creep(
			{
				id: "rage-target",
				name: "Target",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: weapon,
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 80, y: 50 },
			BALANCE,
			new SeededRandom(1),
		);
		const state = new ArenaState();
		state.creeps.push(target);
		const combat = new HeroCombatSystem();
		combat.update(
			1 / 60,
			{ x: 0, y: 0 },
			hero,
			state,
			{
				level: 1,
				xp: 0,
				stats: { ...ZERO_STATS },
				allocation: { ...DEFAULT_ALLOCATION },
				gold: 0,
				souls: 0,
				scraps: emptyScraps(),
				mainHand: weapon,
				inventoryTiles: [],
				learnedSkills: [],
				learnedSkillLevels: {},
				universalSkills: [],
			},
			BALANCE,
			new SeededRandom(1),
		);
		expect(hero.rage).toBe(BASIC_ATTACK_RAGE_GAIN);
		for (const attack of state.attacks) attack.update(0.2);
		resolveCombat(state, hero, weapon, 500, 500, new SeededRandom(1));
		expect(hero.rage).toBe(BASIC_ATTACK_RAGE_GAIN);
	});
	test("attack-triggered weapon skills ignore resource costs", () => {
		const staff = generateItem(1, "common", 103, {
			allowedClasses: ["staff"],
		});
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(ZERO_STATS, undefined, staff);
		hero.mana = 0;
		const state = new ArenaState();
		state.creeps.push(makeCreep("proc-target", { x: 100, y: 0 }));
		const progress = {
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			mainHand: staff,
			inventoryTiles: [],
			learnedSkills: ["arcaneBolt" as const],
			learnedSkillLevels: { arcaneBolt: 1 },
			universalSkills: [],
			equippedSkills: ["arcaneBolt" as const],
			autoFireSkills: [],
		};
		const combat = new HeroCombatSystem();
		const alwaysTrigger = { next: () => 0 };
		for (let index = 0; index < 8; index += 1)
			combat.update(
				0.5,
				{ x: 0, y: 0 },
				hero,
				state,
				progress,
				BALANCE,
				alwaysTrigger,
			);
		expect(
			state.projectiles.some((projectile) => projectile.skill === "arcaneBolt"),
		).toBeTrue();
		expect(hero.mana).toBe(0);
		const procSlot = combat
			.spellSlots(progress, hero)
			.find((slot) => slot.id === "arcaneBolt" && slot.passive);
		expect(procSlot).toMatchObject({
			active: true,
			passive: true,
			affordable: true,
			bar: "geared",
			costLabel: "Free attack proc",
		});
		expect(procSlot?.procChancesOnAttacks).toBeGreaterThan(0);
		expect(procSlot?.cooldown).toBe(0);
		expect(
			combat
				.spellSlots(progress, hero)
				.find((slot) => slot.id === "arcaneBolt" && !slot.passive)?.cooldown,
		).toBe(0);
		const projectileCount = state.projectiles.length;
		hero.mana = hero.maxMana;
		combat.requestSpellSlot(0, progress);
		for (let index = 0; index < 8; index += 1)
			combat.update(0.5, { x: 0, y: 0 }, hero, state, progress, BALANCE, {
				next: () => 1,
			});
		expect(state.projectiles.length).toBeGreaterThan(projectileCount);
		expect(hero.mana).toBeLessThan(hero.maxMana);
		const slotsAfterManualCast = combat.spellSlots(progress, hero);
		expect(
			slotsAfterManualCast.find(
				(slot) => slot.id === "arcaneBolt" && !slot.passive,
			)?.cooldown,
		).toBeGreaterThan(0);
		expect(
			slotsAfterManualCast.find(
				(slot) => slot.id === "arcaneBolt" && slot.passive,
			)?.cooldown,
		).toBe(0);
	});
	test("counts every unit in a basic weapon hit for spell-proc scaling", () => {
		const mace = generateItem(1, "common", 104, {
			allowedClasses: ["mace"],
		});
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(ZERO_STATS, undefined, mace);
		const profile = attackProfile(mace, ZERO_STATS, "hero", BALANCE);
		const creeps = [
			makeCreep("one", { x: 50, y: 0 }),
			makeCreep("two", { x: -50, y: 0 }),
			makeCreep("three", { x: 0, y: 50 }),
			makeCreep("outside", { x: profile.range + 100, y: 0 }),
		];
		expect(basicWeaponHitCount(hero, creeps, mace, profile)).toBe(3);
	});
	test("restores resources and clears transient combat state for a new realm", () => {
		const hero = new Hero({ x: 50, y: 50 });
		hero.configureStats(ZERO_STATS);
		hero.hp = 1;
		hero.mana = 0;
		hero.rage = 0;
		hero.velocity = { x: 9, y: 4 };
		hero.reflectiveSurgeRemaining = 2;
		hero.addStatus({ kind: "poison", remaining: 4, damagePerSecond: 1 });
		hero.resetForRealm();
		expect(hero.hp).toBe(hero.maxHp);
		expect(hero.mana).toBe(hero.maxMana);
		expect(hero.rage).toBe(5);
		expect(hero.statuses).toHaveLength(0);
		expect(hero.velocity).toEqual({ x: 0, y: 0 });
		expect(hero.reflectiveSurgeRemaining).toBe(0);
	});
	test("preserves mana and rage across active-wave progression updates", () => {
		const hero = new Hero({ x: 50, y: 50 });
		hero.configureStats({ ...ZERO_STATS, intelligence: 1, strength: 2 });
		hero.mana = 2;
		hero.rage = 3;
		hero.applyProgress(
			{
				level: 2,
				xp: 60,
				stats: { ...ZERO_STATS, intelligence: 3, strength: 4 },
				allocation: { ...DEFAULT_ALLOCATION },
				gold: 10,
				souls: 0,
				scraps: emptyScraps(),
				mainHand: starterClub(),
				inventoryTiles: [],
				learnedSkills: ["healing"],
				learnedSkillLevels: { healing: 1 },
				universalSkills: ["healing"],
			},
			true,
		);
		expect(hero.maxMana).toBe(11);
		expect(hero.mana).toBe(2);
		expect(hero.rage).toBe(3);
	});
	test("keeps orbiting hammers centered on their cast point and expires them", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const hammer = Projectile.orbitingHammer(hero, 0, 4, { kind: "magic" });
		hero.position.x = 70;
		hammer.update(0.1);
		expect(
			Math.hypot(hammer.position.x - 50, hammer.position.y - 50),
		).toBeCloseTo(34.75);
		expect(hammer.position.x).not.toBeCloseTo(hero.position.x + 34.75);
		hammer.update(2.4);
		expect(hammer.active).toBeFalse();
	});
	test("billboards airborne spell sprites but leaves ground effects flat", () => {
		const projectile = new Projectile(
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			1,
			"hero",
			"arcaneBolt",
		);
		const groundEffect = new SpellEffect("shockwave", { x: 0, y: 0 });
		const cameraRotation = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0.4, -0.2, 0.1),
		);

		projectile.updateVisuals(0);
		projectile.faceCamera(cameraRotation);

		expect(
			projectile.mesh.children[0].quaternion.equals(cameraRotation),
		).toBeTrue();
		expect(
			projectile.mesh.quaternion.equals(new THREE.Quaternion()),
		).toBeTrue();
		expect(groundEffect.mesh.quaternion.equals(cameraRotation)).toBeFalse();
	});
	test("renders Frozen Orb and its directional spikes as world-oriented 3D geometry", () => {
		const orb = new Projectile(
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			1,
			"hero",
			"frostOrb",
		);
		const spike = new Projectile(
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			1,
			"hero",
			"frostSpike",
		);
		const cameraRotation = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0.4, -0.2, 0.1),
		);
		orb.updateVisuals(1);
		spike.updateVisuals(1);
		orb.faceCamera(cameraRotation);
		spike.faceCamera(cameraRotation);
		const orbMeshes: THREE.Mesh[] = [];
		orb.mesh.traverse((object) => {
			if (object instanceof THREE.Mesh) orbMeshes.push(object);
		});
		expect(orbMeshes).toHaveLength(2);
		expect(
			orbMeshes.every((mesh) => mesh.geometry.type === "ExtrudeGeometry"),
		).toBeTrue();
		expect(spike.mesh.getObjectByProperty("type", "Mesh")?.geometry.type).toBe(
			"ConeGeometry",
		);
		expect(
			spike.mesh.getObjectByProperty("type", "Mesh")?.geometry.parameters
				.radialSegments,
		).toBe(5);
		expect(orb.mesh.children[0].quaternion.equals(cameraRotation)).toBeFalse();
		expect(
			spike.mesh.children[0].quaternion.equals(cameraRotation),
		).toBeFalse();
		expect(spike.mesh.children[0].children[0].rotation.z).toBeCloseTo(
			-Math.PI / 2,
		);
		expect(orbMeshes[0].rotation.z).toBeCloseTo(1.4);
		expect(orbMeshes[1].rotation.z).toBeCloseTo(-2.1);
		expect(orb.mesh.getObjectsByProperty("type", "PointLight")).toHaveLength(1);
		const orbLight = orb.mesh.getObjectByProperty(
			"type",
			"PointLight",
		) as THREE.PointLight;
		expect(orbLight.position.z).toBeGreaterThan(0);
		expect(orbLight.distance).toBe(projectileSpellLightRadius("frostOrb") * 2);
		expect(spike.mesh.getObjectsByProperty("type", "PointLight")).toHaveLength(
			0,
		);
	});
	test("gives each spell source at most one matching point light", () => {
		const hero = new Hero({ x: 0, y: 0 });
		const hammers = [0, 1, 2].map((index) =>
			Projectile.orbitingHammer(
				hero,
				(index * Math.PI * 2) / 3,
				1,
				{ kind: "magic" },
				0,
				2.4,
				false,
				index === 0,
			),
		);
		expect(
			hammers.flatMap((hammer) =>
				hammer.mesh.getObjectsByProperty("type", "PointLight"),
			),
		).toHaveLength(1);

		const scene = new THREE.Scene();
		const lightPool = new HeroSpellLightPool(scene);
		const rent = new SpellEffect(
			"rent",
			hero.position,
			0,
			0,
			undefined,
			undefined,
			true,
		);
		expect(rent.mesh.getObjectsByProperty("type", "PointLight")).toHaveLength(
			0,
		);
		expect(ELBO_HEIGHT).toBe(0.8);
		expect(elbowHeight(CHARACTER_MODEL_MANIFESTS.hero.footprint)).toBe(40);
		expect(rent.mesh.children[0].position.z).toBe(40);
		expect(rentSlashAngle(0)).toBeCloseTo(Math.PI / 4);
		expect(rentSlashAngle(0.25)).toBeCloseTo(-Math.PI / 4);
		expect(rentSlashAngle(0.5)).toBeCloseTo((-3 * Math.PI) / 4);
		expect(rentSlashAngle(0.75)).toBeCloseTo((-5 * Math.PI) / 4);
		rent.update(0.35);
		rent.updateVisuals(0.35);
		lightPool.sync(["rent"], [rent], 0.35);
		const rentLight = lightPool.light("rent") as THREE.PointLight;
		expect(rentLight.color.getHex()).toBe(HERO_BLOOD_SPELL_COLOR);
		expect(rentLight.position.z).toBeGreaterThan(0);
		expect(rentLight.distance).toBe(spellEffectLightDistance("rent", 0));
		const rentVisuals = rent.mesh.children[0] as THREE.Group;
		for (let cone = 0; cone < 4; cone += 1) {
			expect(
				rentVisuals.getObjectByName(`rent-slash-trail-${cone}`),
			).toBeInstanceOf(THREE.Mesh);
			expect(
				rentVisuals.getObjectByName(`rent-magic-sword-${cone}`),
			).toBeInstanceOf(THREE.Mesh);
		}
		expect(rentLight.intensity).toBeCloseTo(10);

		const forceField = new SpellEffect(
			"gravityPull",
			hero.position,
			0,
			320,
			undefined,
			undefined,
			true,
		);
		lightPool.sync(["gravityPull"], [forceField], 0);
		const forceFieldLight = lightPool.light("gravityPull") as THREE.PointLight;
		expect(forceFieldLight.color.getHex()).toBe(0xb98cff);
		expect(forceFieldLight.intensity).toBe(FORCE_FIELD_LIGHT_INTENSITY);
		expect(forceFieldLight.distance).toBe(640);
		expect(forceFieldLight.distance).toBe(
			spellEffectLightDistance("gravityPull", 320),
		);
		forceField.update(FORCE_FIELD_ANIMATION_DURATION);
		forceField.updateVisuals(FORCE_FIELD_ANIMATION_DURATION);
		lightPool.sync(
			["gravityPull"],
			[forceField],
			FORCE_FIELD_ANIMATION_DURATION,
		);
		expect(forceFieldLight.intensity).toBe(FORCE_FIELD_LIGHT_INTENSITY);
		expect(forceField.active).toBeTrue();
		forceField.update(FORCE_FIELD_LIGHT_FADE_DURATION / 2);
		forceField.updateVisuals(1.4);
		lightPool.sync(["gravityPull"], [forceField], 1.4);
		expect(forceFieldLight.intensity).toBeCloseTo(
			FORCE_FIELD_LIGHT_INTENSITY / 2,
		);
		forceField.update(FORCE_FIELD_LIGHT_FADE_DURATION / 2);
		forceField.updateVisuals(1.9);
		lightPool.sync(["gravityPull"], [forceField], 1.9);
		expect(forceFieldLight.intensity).toBe(0);
		expect(forceField.active).toBeFalse();

		const whirlwind = new SpellEffect(
			"whirlwind",
			hero.position,
			0,
			120,
			3,
			hero,
		);
		whirlwind.update(0.2);
		whirlwind.updateVisuals(1);
		const whirlwindVisuals = whirlwind.mesh.children[0] as THREE.Group;
		expect(WHIRLWIND_RADIANS_PER_SECOND).toBeCloseTo(Math.PI * 9);
		expect(whirlwindVisuals.position.z).toBe(40);
		expect(
			whirlwindVisuals.children.filter((child) =>
				child.name.startsWith("whirlwind-blur-trail-"),
			),
		).toHaveLength(4);
		expect(
			whirlwindVisuals.getObjectByName("whirlwind-magic-sword"),
		).toBeInstanceOf(THREE.Mesh);
		expect(
			whirlwindVisuals.children.filter(
				(child) =>
					child instanceof THREE.Mesh &&
					child.material instanceof THREE.ShaderMaterial,
			),
		).toHaveLength(4);

		const firstRentLight = rentLight;
		lightPool.sync([], [], 2);
		expect(scene.children).not.toContain(firstRentLight);
		lightPool.sync(["rent"], [], 3);
		expect(lightPool.light("rent")).toBe(firstRentLight);
		expect(firstRentLight.intensity).toBe(0);

		const flashScene = new THREE.Scene();
		const flashPool = new HeroSpellLightPool(flashScene);
		const firstFlash = new SpellEffect(
			"arcaneBoltExplosion",
			{ x: 10, y: 20 },
			0,
			80,
			undefined,
			undefined,
			true,
		);
		const latestFlash = new SpellEffect(
			"arcaneBoltExplosion",
			{ x: 30, y: 40 },
			0,
			100,
			undefined,
			undefined,
			true,
		);
		const enemyFlash = new SpellEffect("arcaneBoltExplosion", {
			x: 500,
			y: 600,
		});
		flashPool.sync(["arcaneBolt"], [firstFlash, latestFlash, enemyFlash], 0);
		const sharedFlash = flashPool.light(
			"arcaneBoltExplosion",
		) as THREE.PointLight;
		expect(flashScene.getObjectsByProperty("type", "PointLight")).toHaveLength(
			1,
		);
		expect(sharedFlash.position.x).toBe(30);
		expect(sharedFlash.position.y).toBe(40);
		expect(sharedFlash.distance).toBe(200);

		const thunderImpact = new SpellEffect(
			"thunderAura",
			{ x: 44, y: 55 },
			0,
			70,
			THUNDER_IMPACT_DURATION,
			undefined,
			true,
		);
		thunderImpact.updateVisuals(0);
		const thunderVisuals = thunderImpact.mesh.children[0] as THREE.Group;
		expect(
			thunderVisuals.children.filter((child) =>
				child.name.startsWith("thunder-impact-arc-"),
			),
		).toHaveLength(6);
		expect(
			thunderVisuals.children.every(
				(child) => child instanceof THREE.Line && child.position.z === 0,
			),
		).toBeTrue();
		const thunderScene = new THREE.Scene();
		const thunderAngles = [0, 0.25];
		const thunderLightPool = new HeroSpellLightPool(
			thunderScene,
			() => thunderAngles.shift() ?? 0,
		);
		thunderLightPool.sync(["thunderAura"], [thunderImpact], 0);
		const thunderLight = thunderLightPool.light(
			"thunderAura",
		) as THREE.PointLight;
		expect(thunderLight.color.getHex()).toBe(THUNDER_IMPACT_LIGHT_COLOR);
		expect(thunderLight.position.toArray()).toEqual([
			44 + THUNDER_IMPACT_LIGHT_OFFSET,
			55,
			4,
		]);
		expect(thunderLight.intensity).toBe(THUNDER_IMPACT_LIGHT_INTENSITY);
		thunderImpact.update(THUNDER_IMPACT_DURATION / 2);
		thunderLightPool.sync(["thunderAura"], [thunderImpact], 0.75);
		expect(thunderLight.position.x).toBeCloseTo(44);
		expect(thunderLight.position.y).toBeCloseTo(
			55 + THUNDER_IMPACT_LIGHT_OFFSET,
		);
		expect(thunderLight.intensity).toBeCloseTo(
			THUNDER_IMPACT_LIGHT_INTENSITY / 2,
		);
		expect(thunderLightPosition({ x: 12, y: 4.5 }, () => 0)).toEqual({
			x: 12 + THUNDER_IMPACT_LIGHT_OFFSET,
			y: 4.5,
		});
	});
	test("bottom-aligns every projectile silhouette above the ground", () => {
		expect(projectilePresentationCenter("arcaneBolt")).toBe(13);
		expect(projectilePresentationCenter("frostOrb")).toBe(24);
		expect(projectilePresentationCenter("vampiricBoomerang")).toBe(50);
		expect(projectilePresentationCenter(undefined, "throwingAxe")).toBe(14);
	});
	test("gives Rending Throw a distinct spinning, pulsing projectile", () => {
		const projectile = new Projectile(
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			1,
			"hero",
			"rendingThrow",
		);
		const body = projectile.mesh.children[0].children[0];
		const aura = body.getObjectByName("rending-aura");
		expect(aura).toBeDefined();

		projectile.updateVisuals(0);
		const initialRotation = body.rotation.z;
		const initialScale = aura?.scale.x;
		projectile.updateVisuals(0.1);

		expect(body.rotation.z).not.toBe(initialRotation);
		expect(aura?.scale.x).not.toBe(initialScale);
	});
	test("reserves red spell presentation for enemy ownership", () => {
		expect(spellEffectLightColor("rent")).toBe(HERO_BLOOD_SPELL_COLOR);
		expect(projectileSpellLightColor("vampiricBoomerang")).toBe(
			HERO_BLOOD_SPELL_COLOR,
		);
		expect(projectileSpellLightColor("rendingThrow")).toBe(
			HERO_BLOOD_SPELL_COLOR,
		);

		const enemyHealing = new SpellEffect("healing", { x: 0, y: 0 });
		enemyHealing.updateVisuals(0);
		const enemyColors: number[] = [];
		enemyHealing.mesh.traverse((object) => {
			if (!(object instanceof THREE.Mesh || object instanceof THREE.Line))
				return;
			const materials = Array.isArray(object.material)
				? object.material
				: [object.material];
			for (const material of materials)
				if ("color" in material && material.color instanceof THREE.Color)
					enemyColors.push(material.color.getHex());
		});
		expect(enemyColors.length).toBeGreaterThan(0);
		expect(
			enemyColors.every((color) => color === HOSTILE_SPELL_COLOR),
		).toBeTrue();
		const rapidRegen = new SpellEffect(
			"rapidRegen",
			{ x: 0, y: 0 },
			0,
			0,
			1,
			undefined,
			true,
		);
		rapidRegen.updateVisuals(0);
		expect(rapidRegen.mesh.getObjectByName("healing-plus")).toBeUndefined();

		const enemyProjectile = new Projectile(
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			1,
			"creep",
			"frostOrb",
		);
		const projectileColors: number[] = [];
		enemyProjectile.mesh.traverse((object) => {
			if (!(object instanceof THREE.Mesh)) return;
			const materials = Array.isArray(object.material)
				? object.material
				: [object.material];
			for (const material of materials)
				if ("color" in material && material.color instanceof THREE.Color)
					projectileColors.push(material.color.getHex());
		});
		expect(projectileColors.length).toBeGreaterThan(0);
		expect(
			projectileColors.every((color) => color === HOSTILE_SPELL_COLOR),
		).toBeTrue();

		const enemyArea = new AttackArea(
			"creep",
			{ x: 0, y: 0 },
			0,
			50,
			Math.PI / 2,
			0.1,
			0.1,
			1,
			undefined,
			"fireBreath",
		);
		enemyArea.updateVisuals(0);
		const areaColors: number[] = [];
		enemyArea.mesh.traverse((object) => {
			if (!(object instanceof THREE.Mesh || object instanceof THREE.Line))
				return;
			const materials = Array.isArray(object.material)
				? object.material
				: [object.material];
			for (const material of materials)
				if ("color" in material && material.color instanceof THREE.Color)
					areaColors.push(material.color.getHex());
		});
		expect(areaColors.length).toBeGreaterThan(0);
		expect(areaColors.every((color) => color === 0xff4b62)).toBeTrue();
	});
	test("tumbles Orbiting Hammer models around all three axes", () => {
		const first = orbitingHammerRotation(0.25, 0.4);
		const second = orbitingHammerRotation(0.5, 0.8);
		expect(first.x).not.toBe(0);
		expect(first.y).not.toBe(0);
		expect(first.z).not.toBe(0);
		expect(second.x).toBeGreaterThan(first.x);
		expect(second.y).toBeGreaterThan(first.y);
		expect(second.z).toBeGreaterThan(first.z);
	});
	test("keeps level-scaled orbiting hammers active for their full lifetime", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const hammer = Projectile.orbitingHammer(
			hero,
			0,
			4,
			{ kind: "magic" },
			0,
			30,
		);
		hammer.update(29.9);
		expect(hammer.active).toBeTrue();
		hammer.update(0.11);
		expect(hammer.active).toBeFalse();
	});
	test("keeps orbiting hammers active after hits and gives them diverging angular drift", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const slower = Projectile.orbitingHammer(
			hero,
			0,
			4,
			{ kind: "magic" },
			-0.1,
		);
		const faster = Projectile.orbitingHammer(
			hero,
			0,
			4,
			{ kind: "magic" },
			0.1,
		);
		slower.markHit("creep-1");
		expect(slower.canHit("creep-1")).toBeFalse();
		expect(slower.active).toBeTrue();
		slower.update(1);
		faster.update(1);
		expect(
			Math.abs(slower.position.x - faster.position.x) +
				Math.abs(slower.position.y - faster.position.y),
		).toBeGreaterThan(1);
	});
	test("returns the broad fast Vampiric Boomerang with half projectile knockback and heals from cumulative recorded damage", () => {
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(ZERO_STATS);
		hero.hp = 1;
		const boomerang = Projectile.vampiricBoomerang(
			hero,
			{ x: 100, y: 0 },
			4,
			30,
			0.5,
			starterClub(),
		);
		expect(boomerang.radius).toBe(33);
		expect(boomerang.force?.impulse).toBe(5);
		boomerang.update(0.1);
		expect(boomerang.position.x).toBeCloseTo(18);
		boomerang.markHit("outbound");
		boomerang.recordDamage(10);
		boomerang.recordDamage(6);
		expect(boomerang.active).toBeTrue();
		boomerang.update(0.3);
		boomerang.update(0.3);
		expect(boomerang.active).toBeFalse();
		expect(hero.hp).toBe(9);
	});
	test("Vampiric Boomerang damages every overlapping creep at 0.5-second collision ticks", () => {
		const state = new ArenaState();
		const hero = new Hero({ x: 50, y: 50 });
		hero.configureStats(ZERO_STATS);
		const weapon = starterClub();
		const makeCreep = (id: string, x: number) =>
			new Creep(
				{
					id,
					name: id,
					kind: "melee",
					level: 0,
					stats: { ...ZERO_STATS },
					mainHand: weapon,
					carried: [],
					isRival: false,
					xpReward: 0,
					goldReward: 0,
					seed: 1,
				},
				"neutral",
				"neutral",
				{ x, y: 50 },
				BALANCE,
				new SeededRandom(1),
			);
		const first = makeCreep("first", 140);
		const second = makeCreep("second", 155);
		state.creeps.push(first, second);
		const boomerang = Projectile.vampiricBoomerang(
			hero,
			{ x: 150, y: 50 },
			2,
			100,
			0.5,
			weapon,
		);
		state.projectiles.push(boomerang);
		const firstHp = first.hp;
		const secondHp = second.hp;
		boomerang.update(VAMPIRIC_BOOMERANG_COLLISION_INTERVAL - 0.1);
		resolveCombat(state, hero, weapon, 500, 500, new SeededRandom(1));
		expect(first.hp).toBe(firstHp);
		expect(second.hp).toBe(secondHp);
		boomerang.update(0.1);
		resolveCombat(state, hero, weapon, 500, 500, new SeededRandom(1));
		expect(first.hp).toBeCloseTo(firstHp - 1);
		expect(second.hp).toBeCloseTo(secondHp - 1);
		resolveCombat(state, hero, weapon, 500, 500, new SeededRandom(1));
		expect(first.hp).toBeCloseTo(firstHp - 1);
		expect(second.hp).toBeCloseTo(secondHp - 1);
	});
	test("Vampiric Boomerang stays world-up when projectiles face the camera", () => {
		const hero = new Hero({ x: 0, y: 0 });
		const boomerang = Projectile.vampiricBoomerang(
			hero,
			{ x: 100, y: 0 },
			2,
			100,
			0.5,
			starterClub(),
		);
		const cameraQuaternion = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0.4, 0.2, 0.1),
		);
		boomerang.faceCamera(cameraQuaternion);
		expect(
			boomerang.mesh.children[0]?.quaternion.equals(new THREE.Quaternion()),
		).toBeTrue();
	});
	test("moves Frozen Orb slowly and emits eight damaging radial spikes", () => {
		const hero = new Hero({ x: 0, y: 0 });
		const orb = new Projectile(
			hero.position,
			{ x: 100, y: 0 },
			5,
			"hero",
			"frostOrb",
			hero,
			{ kind: "magic" },
			starterClub(),
		);
		orb.update(1);
		expect(orb.position.x).toBe(75);
		const spikes = orb.emitFrostSpikes(1 / 60);
		expect(spikes).toHaveLength(8);
		expect(
			spikes.every(
				(spike) => spike.skill === "frostSpike" && spike.damage === 5,
			),
		).toBeTrue();
	});
	test("Gooey Swamp adds one poison stack per continuous second inside", () => {
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats({ ...ZERO_STATS, spirit: 10 });
		hero.knownSkills.add("voodoo");
		hero.skillLevels.set("voodoo", 99);
		const creep = new Creep(
			{
				id: "swamped",
				name: "Swamped",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 20, y: 0 },
			BALANCE,
			new SeededRandom(1),
		);
		const swamp = new GroundSwamp({ x: 0, y: 0 }, 100, hero);
		const fill = swamp.mesh.children[0];
		expect(swamp.mesh.children).toHaveLength(1);
		expect(swamp.mesh.getObjectsByProperty("type", "PointLight")).toHaveLength(
			0,
		);
		expect(fill.scale.x).toBe(1);
		expect(fill.scale.y).toBe(1);
		const swampScene = new THREE.Scene();
		const swampLightPool = new HeroSpellLightPool(swampScene);
		swampLightPool.sync(["swamp"], [], 0, [swamp]);
		const swampLight = swampLightPool.light("swamp") as THREE.PointLight;
		expect(swampLight.color.getHex()).toBe(SWAMP_UPLIGHT_COLOR);
		expect(swampLight.intensity).toBe(SWAMP_UPLIGHT_INTENSITY);
		expect(swampLight.distance).toBe(200);
		expect(SWAMP_UPLIGHT_HEIGHT).toBeGreaterThan(0);
		expect(swampLight.position.z).toBe(SWAMP_UPLIGHT_HEIGHT);
		const swampSurface = new THREE.Vector3();
		fill.getWorldPosition(swampSurface);
		expect(swampLight.position.z).toBeGreaterThan(swampSurface.z);
		swamp.update(1, [creep]);
		expect(creep.statuses).toMatchObject([
			{
				kind: "poison",
				remaining: damageStatusDuration(8),
				source: hero,
			},
		]);
		expect(creep.statuses[0]?.damagePerSecond).toBeCloseTo(0.64);
		creep.position.x = 200;
		swamp.update(0.5, [creep]);
		creep.position.x = 20;
		swamp.update(0.5, [creep]);
		expect(creep.statuses).toHaveLength(1);
		swamp.update(0.5, [creep]);
		expect(creep.statuses).toHaveLength(2);
	});
	test("Blizzard impacts deal Cold area damage and add one Frost stack", () => {
		const hero = new Hero({ x: 0, y: 0 });
		const creep = new Creep(
			{
				id: "blizzard-target",
				name: "Blizzard Target",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 20, y: 0 },
			BALANCE,
			new SeededRandom(1),
		);
		const hpBefore = creep.hp;
		const blizzard = new Blizzard({ x: 0, y: 0 }, 100, 5, 1, 13, hero, false);
		expect(
			blizzard.mesh.getObjectsByProperty("type", "SpotLight"),
		).toHaveLength(0);
		expect(
			blizzard.mesh.getObjectsByProperty("type", "PointLight"),
		).toHaveLength(0);
		blizzard.update(0, [creep], new SeededRandom(2));
		const fallingIcicles = blizzard.mesh.getObjectsByProperty(
			"name",
			"blizzard-icicle",
		) as THREE.Mesh[];
		expect(fallingIcicles).toHaveLength(BLIZZARD_ICICLES_PER_VOLLEY);
		expect(
			fallingIcicles.every((icicle) => {
				const pointDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(
					icicle.quaternion,
				);
				return pointDirection.z < -0.999;
			}),
		).toBeTrue();
		expect(fallingIcicles.filter((icicle) => icicle.visible)).toHaveLength(1);
		expect(
			new Set(
				fallingIcicles.map(
					(icicle) => `${icicle.position.x},${icicle.position.y}`,
				),
			).size,
		).toBe(BLIZZARD_ICICLES_PER_VOLLEY);
		const blizzardScene = new THREE.Scene();
		const blizzardLightPool = new HeroSpellLightPool(blizzardScene);
		blizzardLightPool.sync(["blizzard"], [], 0, [], [blizzard]);
		const blizzardLight = blizzardLightPool.light(
			"blizzard",
		) as THREE.PointLight;
		expect(blizzardLight.color.getHex()).toBe(BLIZZARD_PROJECTILE_LIGHT_COLOR);
		expect(blizzardLight.intensity).toBe(BLIZZARD_PROJECTILE_LIGHT_INTENSITY);
		expect(blizzardLight.distance).toBe(BLIZZARD_PROJECTILE_LIGHT_DISTANCE);
		expect(blizzardLight.position.toArray()).toEqual([0, 0, 10]);
		blizzard.update(0.36, [creep], new SeededRandom(2));
		blizzardLightPool.sync(["blizzard"], [], 0.36, [], [blizzard]);
		expect(blizzardLight.position.toArray()).toEqual([0, 0, 10]);
		expect(creep.hp).toBeLessThan(hpBefore);
		expect(creep.statuses).toMatchObject([
			{ kind: "freeze", remaining: 4, damagePerSecond: 0, source: hero },
		]);
	});
	test("accelerates ground drops toward an attracting hero at a bounded speed", () => {
		const drop = new ItemDrop(
			{ id: "drop", kind: "item", item: starterClub() },
			{ x: 100, y: 0 },
		);
		for (let step = 0; step < 10; step++) {
			drop.pullToward({ x: 0, y: 0 }, 35, 0.1);
			expect(Math.hypot(drop.velocity.x, drop.velocity.y)).toBeLessThanOrEqual(
				35,
			);
			drop.move(0.1);
		}
		expect(drop.position.x).toBeLessThan(100);
		expect(drop.position.x).toBeGreaterThan(65);
	});
	test("caps and rapidly damps push velocity for every drop kind", () => {
		for (const drop of [
			new ItemDrop(
				{ id: "item", kind: "item", item: starterClub() },
				{ x: 100, y: 0 },
			),
			new ItemDrop(
				{ id: "scrap", kind: "scrap", rarity: "rare", amount: 1 },
				{ x: 100, y: 0 },
			),
			new ItemDrop({ id: "gold", kind: "gold", amount: 1 }, { x: 100, y: 0 }),
		]) {
			drop.applyPush({ x: 0, y: 0 }, 180);
			expect(drop.velocity.x).toBe(DROP_MAX_SPEED);
			drop.move(0.25);
			expect(drop.position.x).toBe(122.5);
			expect(drop.velocity.x).toBeLessThan(DROP_MAX_SPEED / 2);
		}
	});
	test("Force Field moves an inward-rushing creep away on the next simulation frame", () => {
		const weapon = starterClub();
		const creep = new Creep(
			{
				id: "force-target",
				name: "Target",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: weapon,
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 100, y: 0 },
			BALANCE,
			new SeededRandom(1),
		);
		creep.velocity = { x: -400, y: 0 };
		forceField(creep, { x: 0, y: 0 }, 180);
		const before = creep.position.x;
		creep.pursue({ x: 0, y: 0 }, 1 / 60, 1000, 1000);
		expect(creep.position.x).toBeGreaterThan(before);
	});
	test("a creep carrying Force Field casts it against the hero", () => {
		const creep = new Creep(
			{
				id: "force-caster",
				name: "Caster",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS, intelligence: 2 },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 100, y: 0 },
			BALANCE,
			new SeededRandom(1),
		);
		creep.knownSkills.add("gravityPull");
		creep.mana = 8;
		expect(creep.pursue({ x: 0, y: 0 }, 2, 1_000, 1_000)).toMatchObject({
			type: "forceField",
			source: creep,
		});
	});
	test("Force Field gives nearby drops a capped outward impulse", () => {
		const state = new ArenaState();
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(ZERO_STATS);
		const drop = new ItemDrop(
			{ id: "force-drop", kind: "item", item: starterClub() },
			{ x: 100, y: 0 },
		);
		state.drops.push(drop);
		castForceField(state, hero, 1, new SeededRandom(1));
		expect(drop.position).toEqual({ x: 100, y: 0 });
		expect(drop.velocity.x).toBeGreaterThan(0);
		expect(drop.velocity.x).toBeLessThanOrEqual(DROP_MAX_SPEED);
	});
	test("Force Field launches targets with twice the former base force", () => {
		const state = new ArenaState();
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(ZERO_STATS);
		const creep = makeCreep("double-force", { x: 1, y: 0 });
		state.creeps.push(creep);
		castForceField(state, hero, 1, new SeededRandom(1));
		expect(creep.velocity.x).toBeCloseTo(358.2);
		expect(creep.velocity.y).toBe(0);
	});
	test("Force Field cancels hostile projectiles in its radius without affecting friendly projectiles", () => {
		const hero = new Hero({ x: 0, y: 0 });
		const hostile = new Projectile(
			{ x: 100, y: 0 },
			{ x: 0, y: 0 },
			1,
			"creep",
		);
		const friendly = new Projectile(
			{ x: 100, y: 0 },
			{ x: 0, y: 0 },
			1,
			"hero",
		);
		const distant = new Projectile(
			{ x: 250, y: 0 },
			{ x: 0, y: 0 },
			1,
			"creep",
		);
		cancelHostileProjectiles([hostile, friendly, distant], hero, "hero", 1);
		expect(hostile.active).toBeFalse();
		expect(friendly.active).toBeTrue();
		expect(distant.active).toBeTrue();
	});
	test("Burn and Freeze cancel one opposing stack before applying their own", () => {
		const hero = new Hero({ x: 0, y: 0 });
		hero.addStatus({ kind: "burn", remaining: 8, damagePerSecond: 1 });
		hero.addStatus({ kind: "burn", remaining: 8, damagePerSecond: 1 });
		hero.addStatus({ kind: "freeze", remaining: 4, damagePerSecond: 0 });
		expect(hero.statuses.map((status) => status.kind)).toEqual([
			"burn",
			"freeze",
		]);
		hero.addStatus({ kind: "burn", remaining: 8, damagePerSecond: 1 });
		expect(hero.statuses.map((status) => status.kind)).toEqual([
			"burn",
			"burn",
		]);
	});
	test("Force Field transfers one randomly selected status stack to each damaged target", () => {
		const source = new Hero({ x: 0, y: 0 });
		const first = new Hero({ x: 100, y: 0 });
		const second = new Hero({ x: 150, y: 0 });
		source.addStatus({ kind: "freeze", remaining: 4, damagePerSecond: 0 });
		source.addStatus({ kind: "freeze", remaining: 4, damagePerSecond: 0 });
		source.addStatus({ kind: "poison", remaining: 8, damagePerSecond: 1 });
		source.addStatus({ kind: "bleed", remaining: 3, damagePerSecond: 0.25 });
		castForceFieldTargets(source, [first, second], 1, { next: () => 0.5 });
		expect(source.statuses.map((status) => status.kind)).toEqual([
			"freeze",
			"freeze",
			"bleed",
		]);
		expect(first.statuses).toMatchObject([
			{ kind: "poison", remaining: 8, damagePerSecond: 1, source },
		]);
		expect(second.statuses).toMatchObject([
			{ kind: "poison", remaining: 8, damagePerSecond: 1, source },
		]);
	});
	test("Rapid Regeneration multiplies normal health regeneration and adds its flat bonus", () => {
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats({ ...ZERO_STATS, spirit: 20 });
		hero.hp = 1;
		hero.healthRegenMultiplier = 1.2;
		hero.healthRegenFlat = 0.1;
		hero.compileState(1);
		hero.updateResources(1);
		expect(hero.hp).toBeCloseTo(1.226);
		hero.healthRegenMultiplier = 5;
		hero.compileState(1);
		hero.updateResources(1);
		expect(hero.hp).toBeCloseTo(1.851);
	});
	test("uses visible rarity colors for equipment and scrap drops", () => {
		expect(dropRarityColor("common")).toBe("#d8e5e8");
		expect(dropRarityColor("uncommon")).toBe("#62e88a");
		expect(dropRarityColor("rare")).toBe("#6ca8ff");
		expect(dropRarityColor("epic")).toBe("#ca75ff");
	});
	test("renders Scrap as a hollow rotating and hovering lozenge", () => {
		const scrap = new ItemDrop(
			{ id: "scrap", kind: "scrap", rarity: "rare", amount: 1 },
			{ x: 0, y: 0 },
		);
		const resource = scrap.mesh.children.find(
			(child) => child.type === "Group",
		) as THREE.Group;
		const body = resource.children.find(
			(child) =>
				child.type === "Mesh" && child.geometry.type === "PlaneGeometry",
		);

		expect(body?.material).toBeInstanceOf(THREE.MeshMatcapMaterial);
		expect(body?.material.opacity).toBe(0.18);
		expect(body?.material.matcap).toBeDefined();
		expect(
			resource.children.some((child) => child.type === "LineSegments"),
		).toBeTrue();
		const time = Math.PI / (2 * COIN_BOB_SPEED);
		scrap.updateVisuals(time);
		expect(scrap.mesh.position.z).toBeCloseTo(
			groundDropPresentationCenter(scrap.drop) + COIN_BOB_AMPLITUDE,
		);
		expect(resource.rotation.y).toBeCloseTo(time * COIN_SPIN_SPEED);
	});
	test("grounds the arena and centers pickups at half their presentation height", () => {
		const drops = [
			new ItemDrop({ id: "gold", kind: "gold", amount: 2 }, { x: 1, y: 2 }),
			new ItemDrop(
				{ id: "gold-bag", kind: "gold", amount: 10 },
				{ x: 1, y: 2 },
			),
			new ItemDrop(
				{ id: "scrap", kind: "scrap", rarity: "rare", amount: 3 },
				{ x: 1, y: 2 },
			),
			new ItemDrop(
				{ id: "item", kind: "item", item: starterClub() },
				{ x: 1, y: 2 },
			),
		];
		for (const drop of drops) drop.updateVisuals(0);
		expect(MAP_Z).toBe(-0.1);
		expect(MAP_Z + MAP_LAYER_STEP * 3).toBeLessThan(0);
		for (const drop of drops)
			expect(drop.mesh.position.z).toBe(
				groundDropPresentationCenter(drop.drop),
			);
		expect(groundDropPresentationCenter(drops[0].drop)).toBe(10);
		expect(groundDropPresentationCenter(drops[1].drop)).toBe(10);
		expect(groundDropPresentationCenter(drops[2].drop)).toBe(20);
		expect(groundDropPresentationCenter(drops[3].drop)).toBe(20);
	});
	test("renders exact Gold amounts as distinct denomination-colored coins", () => {
		const coin = new ItemDrop(
			{ id: "animated-coin", kind: "gold", amount: 1 },
			{ x: 1, y: 2 },
		);
		const cluster = new ItemDrop(
			{ id: "coin-cluster", kind: "gold", amount: 24 },
			{ x: 1, y: 2 },
		);
		coin.updateVisuals(0);
		cluster.updateVisuals(0);
		const time = Math.PI / (2 * COIN_BOB_SPEED);
		coin.updateVisuals(time);
		cluster.updateVisuals(time);
		expect(coinPresentationOffset(time)).toBeCloseTo(COIN_BOB_AMPLITUDE);
		const singleCoins = coin.mesh.children[0].children as THREE.Mesh[];
		const clusteredCoins = cluster.mesh.children[0].children as THREE.Mesh[];
		expect(singleCoins).toHaveLength(1);
		expect(clusteredCoins).toHaveLength(8);
		expect(goldCoinDenominations(24)).toEqual([5, 5, 5, 5, 1, 1, 1, 1]);
		expect(goldCoinDenominations(25)).toEqual([25]);
		expect(goldCoinDenominations(625)).toEqual([625]);
		expect(clusteredCoins.map((child) => child.userData.goldValue)).toEqual([
			5, 5, 5, 5, 1, 1, 1, 1,
		]);
		expect(
			GOLD_COIN_DENOMINATIONS.map(({ value, color }) => {
				const denominationDrop = new ItemDrop(
					{ id: `gold-${value}`, kind: "gold", amount: value },
					{ x: 0, y: 0 },
				);
				const denominationCoin = denominationDrop.mesh.children[0]
					.children[0] as THREE.Mesh;
				return [
					denominationCoin.userData.goldValue,
					(
						denominationCoin.material as THREE.MeshMatcapMaterial
					).color.getHex(),
				];
			}),
		).toEqual(
			GOLD_COIN_DENOMINATIONS.map(({ value, color }) => [value, color]),
		);
		for (const clusteredCoin of clusteredCoins) {
			const material = clusteredCoin.material as THREE.MeshMatcapMaterial;
			expect(material).toBeInstanceOf(THREE.MeshMatcapMaterial);
			expect(material.matcap).toBeDefined();
		}
		expect(
			clusteredCoins.every(
				(child) => child.geometry.type === "CylinderGeometry",
			),
		).toBeTrue();
		expect(
			clusteredCoins.every(
				(child) =>
					(child.material as THREE.MeshMatcapMaterial).side ===
					THREE.DoubleSide,
			),
		).toBeTrue();
		expect(singleCoins[0].rotation.y).not.toBe(0);
		expect(COIN_SCATTER_MULTIPLIER).toBe(5);
		expect(
			clusteredCoins.every(
				(child) =>
					child.userData.displacementSpeed >= 40 &&
					child.userData.displacementSpeed < 80,
			),
		).toBeTrue();
		expect(clusteredCoins.every((child) => child.position.y === 0)).toBeTrue();
		expect(
			clusteredCoins.every((child) => child.position.z >= -COIN_BOB_AMPLITUDE),
		).toBeTrue();
		expect(
			clusteredCoins.some((child) => child.position.length() > 0),
		).toBeTrue();
	});
	test("keeps spell projectiles and drops unlit and outside dynamic shadows", () => {
		const projectile = new Projectile(
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			1,
			"hero",
			"frostOrb",
		);
		const drops = [
			new ItemDrop({ id: "gold", kind: "gold", amount: 1 }, { x: 0, y: 0 }),
			new ItemDrop(
				{ id: "scrap", kind: "scrap", rarity: "rare", amount: 1 },
				{ x: 0, y: 0 },
			),
		];
		const scene = new THREE.Scene();
		scene.add(projectile.mesh, ...drops.map((drop) => drop.mesh));
		const renderer = { shadowMap: { enabled: false, type: 0 } } as Pick<
			THREE.WebGLRenderer,
			"shadowMap"
		>;
		applySceneShadowMode(renderer, scene, "dynamic");

		for (const root of [projectile.mesh, ...drops.map((drop) => drop.mesh)]) {
			root.traverse((object) => {
				if (!(object instanceof THREE.Mesh)) return;
				expect(
					object.material instanceof THREE.MeshBasicMaterial ||
						object.material instanceof THREE.MeshMatcapMaterial,
				).toBeTrue();
				expect(object.castShadow).toBeFalse();
				expect(object.receiveShadow).toBeFalse();
			});
		}
	});
	test("billboards complete pickup presentations toward the camera", () => {
		const cameraRotation = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0.4, -0.2, 0.1),
		);
		for (const drop of [
			new ItemDrop({ id: "gold", kind: "gold", amount: 1 }, { x: 0, y: 0 }),
			new ItemDrop(
				{ id: "item", kind: "item", item: starterClub() },
				{ x: 0, y: 0 },
			),
			new ItemDrop(
				{ id: "scrap", kind: "scrap", rarity: "rare", amount: 1 },
				{ x: 0, y: 0 },
			),
		]) {
			drop.faceCamera(cameraRotation);
			expect(drop.mesh.quaternion.equals(cameraRotation)).toBeTrue();
		}
	});
	test("billboards a non-3D creep body, outline, and details as one group", () => {
		const creep = new Creep(
			{
				id: "billboard-creep",
				name: "Billboard",
				kind: "bubbleShooter",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 0, y: 0 },
			BALANCE,
			new SeededRandom(1),
		);
		const cameraRotation = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0.4, -0.2, 0.1),
		);

		creep.faceCamera(cameraRotation);

		const spriteGroup = creep.mesh.children.find(
			(child): child is THREE.Group =>
				child instanceof THREE.Group && child.children.length === 3,
		);
		expect(spriteGroup?.quaternion.equals(cameraRotation)).toBeTrue();
		expect(spriteGroup?.children.map((child) => child.type)).toEqual([
			"Mesh",
			"Mesh",
			"Mesh",
		]);
	});
	test("cancels an unresolved enemy telegraph when its source dies", () => {
		const source = { active: false };
		const attack = new AttackArea(
			"creep",
			{ x: 10, y: 10 },
			0,
			70,
			Math.PI,
			0.5,
			0.1,
			2,
			source,
		);
		attack.update(0.6);
		expect(attack.shouldResolve()).toBeFalse();
		expect(attack.active).toBeFalse();
	});
	test("cancels an unresolved enemy telegraph when its source attack is interrupted", () => {
		const source = { active: true, attackVersion: 0 };
		const attack = new AttackArea(
			"creep",
			{ x: 10, y: 10 },
			0,
			70,
			Math.PI,
			0.5,
			0.1,
			2,
			source,
		);
		attack.update(0.4);
		source.attackVersion += 1;
		expect(attack.shouldResolve()).toBeFalse();
		expect(attack.active).toBeFalse();
	});
	test("Frost stacks slow toward a resistance-scaled threshold, then slide without friction", () => {
		const hero = new Hero({ x: 50, y: 50 });
		hero.velocity = { x: 30, y: 0 };
		hero.addStatus({ kind: "freeze", remaining: 2, damagePerSecond: 0 });
		expect(hero.frozen).toBeFalse();
		expect(hero.freezeMovementMultiplier).toBeCloseTo(2 / 3);
		expect(hero.velocity.x).toBe(30);
		hero.addStatus({ kind: "freeze", remaining: 2, damagePerSecond: 0 });
		hero.addStatus({ kind: "freeze", remaining: 2, damagePerSecond: 0 });
		expect(hero.frozen).toBeTrue();
		expect(hero.velocity).toEqual({ x: 0, y: 0 });
		hero.velocity.x = 40;
		hero.slide(0.5);
		expect(hero.position.x).toBe(70);
		expect(hero.velocity.x).toBe(40);
		const frostWard = { ...starterClub(), perks: { frostResist: 0.5 } };
		const resistant = new Hero({ x: 0, y: 0 });
		resistant.configureStats(ZERO_STATS, undefined, frostWard);
		for (let index = 0; index < 8; index += 1)
			resistant.addStatus({ kind: "freeze", remaining: 4, damagePerSecond: 0 });
		expect(resistant.freezeThreshold).toBe(9);
		expect(resistant.frozen).toBeFalse();
		resistant.addStatus({ kind: "freeze", remaining: 4, damagePerSecond: 0 });
		expect(resistant.frozen).toBeTrue();
		const creep = new Creep(
			{
				id: "chilled",
				name: "Chilled",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 0, y: 0 },
			BALANCE,
			new SeededRandom(1),
		);
		creep.addStatus({ kind: "freeze", remaining: 4, damagePerSecond: 0 });
		creep.pursue({ x: 500, y: 0 }, 1, 1_000, 1_000);
		expect(creep.position.x).toBeCloseTo(48);
	});
	test("requirement-active immunity prevents matching damage and statuses", () => {
		const ward = {
			...starterClub(),
			immunities: ["frost", "fire", "poison", "bleed"] as const,
		};
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(ZERO_STATS, undefined, ward);
		expect(
			hero.receiveDamage(5, { next: () => 1 }, undefined, false, false, {
				kind: "cold",
			}),
		).toBe(0);
		hero.addStatus({ kind: "freeze", remaining: 4, damagePerSecond: 0 });
		hero.addStatus({ kind: "burn", remaining: 4, damagePerSecond: 1 });
		hero.addStatus({ kind: "poison", remaining: 4, damagePerSecond: 1 });
		hero.addStatus({ kind: "bleed", remaining: 4, damagePerSecond: 1 });
		expect(hero.statuses).toHaveLength(0);
	});
	test("Arcane Bolt explodes on impact while preserving its direct impact push", () => {
		const state = new ArenaState();
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats({ ...ZERO_STATS, strength: 10 });
		const creep = new Creep(
			{
				id: "arcane-target",
				name: "Target",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 1,
			},
			"neutral",
			"neutral",
			{ x: 20, y: 0 },
			BALANCE,
			new SeededRandom(1),
		);
		const nearby = new Creep(
			{
				id: "arcane-nearby",
				name: "Nearby",
				kind: "melee",
				level: 0,
				stats: { ...ZERO_STATS },
				mainHand: starterClub(),
				carried: [],
				isRival: false,
				xpReward: 0,
				goldReward: 0,
				seed: 2,
			},
			"neutral",
			"neutral",
			{ x: 80, y: 0 },
			BALANCE,
			new SeededRandom(2),
		);
		state.creeps.push(creep, nearby);
		const nearbyBefore = nearby.hp;
		const projectile = new Projectile(
			hero.position,
			creep.position,
			1,
			"hero",
			"arcaneBolt",
			hero,
			{ kind: "magic" },
			starterClub(),
		);
		projectile.position = { ...creep.position };
		state.projectiles.push(projectile);
		resolveCombat(state, hero, starterClub(), 500, 500, new SeededRandom(1));
		expect(creep.statuses).toHaveLength(0);
		expect(nearby.hp).toBeLessThan(nearbyBefore);
		expect(state.spellEffects).toHaveLength(1);
		const explosionEffect = state.spellEffects[0];
		expect(explosionEffect.kind).toBe("arcaneBoltExplosion");
		expect(
			explosionEffect.mesh.getObjectsByProperty("type", "PointLight"),
		).toHaveLength(0);
		explosionEffect.updateVisuals(0);
		const lightPool = new HeroSpellLightPool(new THREE.Scene());
		lightPool.sync(["arcaneBolt"], [explosionEffect], 0);
		const explosionLight = lightPool.light(
			"arcaneBoltExplosion",
		) as THREE.PointLight;
		expect(explosionLight.position.z).toBeGreaterThan(0);
		expect(explosionLight.position.x).toBe(explosionEffect.position.x);
		expect(creep.velocity.x).toBeGreaterThan(0);
		const before = creep.position.x;
		creep.pursue(hero.position, 1 / 60, 500, 500);
		expect(creep.position.x).toBeGreaterThan(before);
	});
	test("Rending Throw pierces its level-scaled target count and applies its doubled bleed", () => {
		const state = new ArenaState();
		const hero = new Hero({ x: 0, y: 0 });
		const makeCreep = (id: string) =>
			new Creep(
				{
					id,
					name: id,
					kind: "melee",
					level: 0,
					stats: { ...ZERO_STATS },
					mainHand: starterClub(),
					carried: [],
					isRival: false,
					xpReward: 0,
					goldReward: 0,
					seed: 1,
				},
				"neutral",
				"neutral",
				{ x: 20, y: 0 },
				BALANCE,
				new SeededRandom(1),
			);
		const creeps = [
			makeCreep("first"),
			makeCreep("second"),
			makeCreep("third"),
		];
		state.creeps.push(...creeps);
		state.projectiles.push(
			new Projectile(
				hero.position,
				{ x: 20, y: 0 },
				1,
				"hero",
				"rendingThrow",
				hero,
				{ kind: "physical" },
				starterClub(),
				true,
				2,
			),
		);

		resolveCombat(state, hero, starterClub(), 500, 500, new SeededRandom(1));

		expect(creeps.filter((creep) => creep.hp < creep.maxHp)).toHaveLength(2);
		expect(
			creeps.filter((creep) =>
				creep.statuses.some(
					(status) => status.kind === "bleed" && status.remaining === 18,
				),
			),
		).toHaveLength(2);
		expect(state.projectiles[0].active).toBeFalse();
	});

	test("launched projectiles advance independently", () => {
		const projectile = new Projectile({ x: 0, y: 0 }, { x: 100, y: 0 }, 1);
		projectile.update(0.1);
		expect(projectile.active).toBeTrue();
		expect(projectile.position.x).toBeGreaterThan(0);
	});

	test("does not destroy projectiles for leaving arena bounds", () => {
		const state = new ArenaState();
		const hero = new Hero({ x: 50, y: 50 });
		const projectile = new Projectile(
			{ x: 550, y: 50 },
			{ x: 650, y: 50 },
			1,
			"hero",
		);
		state.projectiles.push(projectile);
		resolveCombat(state, hero, starterClub(), 500, 500, new SeededRandom(1));
		expect(projectile.active).toBeTrue();
	});

	test("generates reproducible safe columns that block units and projectiles", () => {
		const first = generateArenaColumns(1600, 1000, 15, new SeededRandom(42));
		const second = generateArenaColumns(1600, 1000, 15, new SeededRandom(42));
		expect(first).toEqual(second);
		expect(first).toHaveLength(15);
		expect(
			new Set(first.map((column) => column.coneSides)).size,
		).toBeGreaterThan(1);
		expect(new Set(first.map((column) => column.height)).size).toBeGreaterThan(
			1,
		);
		expect(arenaObstacleConeSides(0)).toBe(3);
		expect(arenaObstacleConeSides(0.5)).toBe(5);
		expect(arenaObstacleConeSides(0.99)).toBe(7);
		const obstacleMaterial = arenaObstacleMaterial();
		expect(obstacleMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);
		expect(obstacleMaterial.roughness).toBe(0.55);
		expect(obstacleMaterial.metalness).toBe(0.35);
		const floorMaterial = arenaFloorMaterial();
		expect(floorMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);
		expect(floorMaterial.map).toBeNull();
		const map = new GameMap(new SeededRandom(42));
		map.buildMeshes();
		expect(map.columns).toHaveLength(15);
		const obstacleMeshes = map.mesh.children.filter(
			(child) =>
				child instanceof THREE.Mesh &&
				child.geometry instanceof THREE.ConeGeometry,
		);
		expect(obstacleMeshes).toHaveLength(15);
		expect(
			map.mesh.children.some(
				(child) =>
					child instanceof THREE.Mesh &&
					(child.geometry.type === "BoxGeometry" ||
						child.geometry.type === "CylinderGeometry"),
			),
		).toBeFalse();
		const floor = map.mesh.children.find(
			(child) =>
				child instanceof THREE.Mesh &&
				child.material instanceof THREE.MeshStandardMaterial,
		) as THREE.Mesh;
		expect(floor.userData.castShadow).toBeFalse();
		expect(floor.userData.receiveShadow).toBeTrue();
		expect(
			map.mesh.children.some(
				(child) =>
					child instanceof THREE.Mesh &&
					child.material instanceof THREE.MeshBasicMaterial &&
					child.material.map instanceof THREE.CanvasTexture,
			),
		).toBeFalse();
		expect(
			first.every(
				(column) => Math.hypot(column.x - 800, column.y - 500) >= 180,
			),
		).toBeTrue();
		const column = { x: 100, y: 100, radius: 30 };
		const creepCollider = {
			position: { x: 115, y: 100 },
			radius: 20,
			velocity: { x: -40, y: 10 },
		};
		expect(resolveColumnCollision(creepCollider, [column])).toBeTrue();
		expect(creepCollider.position.x).toBe(150);
		expect(creepCollider.velocity.x).toBe(0);
		expect(creepCollider.velocity.y).toBe(10);
		const hero = new Hero({ x: 115, y: 100 });
		hero.velocity.x = -40;
		hero.velocity.y = 10;
		expect(resolveColumnCollision(hero, [column])).toBeTrue();
		expect(hero.position.x).toBe(100 + column.radius + hero.radius);
		expect(hero.velocity.x).toBe(0);
		expect(hero.velocity.y).toBe(10);
		const projectile = new Projectile({ x: 100, y: 100 }, { x: 200, y: 100 });
		expect(touchesColumn(projectile, [column])).toBeTrue();
	});

	test("splits solid-unit overlap and preserves tangential movement", () => {
		const first = {
			position: { x: 0, y: 0 },
			radius: 10,
			velocity: { x: 10, y: 4 },
		};
		const second = {
			position: { x: 15, y: 0 },
			radius: 10,
			velocity: { x: 0, y: -3 },
		};
		expect(resolveUnitCollisions([first, second])).toBeTrue();
		expect(first.position.x).toBeCloseTo(-2.5);
		expect(second.position.x).toBeCloseTo(17.5);
		expect(first.velocity.x).toBeCloseTo(5);
		expect(second.velocity.x).toBeCloseTo(5);
		expect(first.velocity.y).toBe(4);
		expect(second.velocity.y).toBe(-3);
	});

	test("deterministically separates a coincident creep crowd without stacking", () => {
		const makeCrowd = () =>
			Array.from({ length: 4 }, () => ({
				position: { x: 100, y: 100 },
				radius: 16,
				velocity: { x: 0, y: 0 },
			}));
		const first = makeCrowd();
		const second = makeCrowd();
		resolveUnitCollisions(first);
		resolveUnitCollisions(second);
		expect(first).toEqual(second);
		for (let left = 0; left < first.length; left += 1)
			for (let right = left + 1; right < first.length; right += 1)
				expect(
					Math.hypot(
						first[left].position.x - first[right].position.x,
						first[left].position.y - first[right].position.y,
					),
				).toBeGreaterThanOrEqual(31.99);
	});

	test("stops melee pursuit in attack range and keeps ranged retreat bands", () => {
		const hero = { x: 0, y: 0 };
		const meleeInRange = makeCreep("melee-in-range", { x: 62, y: 0 });
		meleeInRange.pursue(hero, 0.1, 1_000, 1_000);
		expect(meleeInRange.position.x).toBe(62);
		const meleeOutside = makeCreep("melee-outside", { x: 80, y: 0 });
		meleeOutside.pursue(hero, 0.1, 1_000, 1_000);
		expect(meleeOutside.position.x).toBeLessThan(80);

		const throwingAxe = generateItem(1, "common", 91, {
			allowedClasses: ["throwingAxe"],
		});
		const rangedTooClose = makeCreep(
			"ranged-retreat",
			{ x: 100, y: 0 },
			throwingAxe,
		);
		rangedTooClose.pursue(hero, 0.1, 1_000, 1_000);
		expect(rangedTooClose.position.x).toBeGreaterThan(100);
		const rangedInRange = makeCreep(
			"ranged-stop",
			{ x: 170, y: 0 },
			throwingAxe,
		);
		rangedInRange.pursue(hero, 0.1, 1_000, 1_000);
		expect(rangedInRange.position.x).toBe(170);
		const rangedOutside = makeCreep(
			"ranged-approach",
			{ x: 230, y: 0 },
			throwingAxe,
		);
		rangedOutside.pursue(hero, 0.1, 1_000, 1_000);
		expect(rangedOutside.position.x).toBeLessThan(230);
	});

	test("cleanup and arena reset remove transient state", () => {
		const state = new ArenaState();
		const projectile = new Projectile({ x: 0, y: 0 }, { x: 1, y: 0 });
		projectile.active = false;
		state.projectiles.push(projectile);
		removeInactive(state.projectiles);
		expect(state.projectiles).toHaveLength(0);
		state.pendingPickups.add("drop");
		state.defeatedPositions.set("unit", { x: 1, y: 2 });
		state.addCombatText({
			position: { x: 1, y: 1 },
			amount: 2,
			kind: "physical",
			critical: false,
			age: 0,
			lifetime: 1,
			drift: 0,
		});
		state.clear();
		expect(state.pendingPickups.size).toBe(0);
		expect(state.defeatedPositions.size).toBe(0);
		expect(state.combatTexts).toHaveLength(0);
	});

	test("sizes ordinary combat text at sixty percent and critical text fully", () => {
		expect(combatTextScale(false)).toBe(0.6);
		expect(combatTextScale(true)).toBe(1);
	});

	test("edge spawning is reproducible with a seeded random source", () => {
		const map = new GameMap();
		expect(map.randomEdgeSpawn(new SeededRandom(123))).toEqual(
			map.randomEdgeSpawn(new SeededRandom(123)),
		);
	});

	test("pushes outside objects inward and locks entered objects to the arena", () => {
		const object = {
			position: { x: -20, y: 50 },
			radius: 10,
			enteredArena: false,
			velocity: { x: -100, y: 4 },
		};
		correctArenaBoundary(object, 100, 100, 0.5);
		expect(object.position.x).toBe(-5);
		correctArenaBoundary(object, 100, 100, 1);
		expect(object.enteredArena).toBeTrue();
		object.position.x = 0;
		correctArenaBoundary(object, 100, 100, 0.1);
		expect(object.position.x).toBe(10);
		expect(object.velocity.x).toBe(0);
		expect(object.velocity.y).toBe(4);
	});

	test("bucklers partially block with Strength and training damage stops at one", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const buckler = { ...generateBuckler(0, "common", 12), perks: {} };
		hero.configureStats(
			{ agility: 5, strength: 5, magic: 0, spirit: 0, intelligence: 0 },
			buckler,
		);
		const rolls = [1, 0];
		hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 });
		expect(hero.hp).toBe(10);
		expect(hero.rage).toBe(5);
		hero.damageFloorOne = true;
		hero.receiveDamage(100, { next: () => 1 });
		expect(hero.hp).toBe(1);
		expect(hero.active).toBeTrue();
	});

	test("caps ordinary block chance at 75% and spends rage only on successful blocks", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const buckler = { ...generateBuckler(0, "common", 12), perks: {} };
		hero.configureStats(
			{ agility: 90, strength: 90, magic: 0, spirit: 0, intelligence: 0 },
			buckler,
		);
		const hp = hero.hp;
		let rolls = [1, 0.749];
		hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 });
		expect(hero.hp).toBe(hp);
		expect(hero.rage).toBe(5);
		rolls = [1, 0.75];
		hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 });
		expect(hero.hp).toBe(hp - 10);
		hero.rage = 0;
		hero.receiveDamage(10, { next: () => 1 });
		expect(hero.hp).toBe(hp - 20);
		expect(hero.rage).toBe(2);
		hero.rage = 1;
		hero.receiveDamage(10, { next: () => 1 });
		expect(hero.rage).toBe(3);
	});
	test("Poison, Bleed, and Burn ticks cannot be blocked or dodged", () => {
		for (const kind of ["poison", "bleed", "burn"] as const) {
			const hero = new Hero({ x: 50, y: 50 });
			const buckler = {
				...generateBuckler(0, "common", 12),
				requirements: {},
				perks: { dodgeChance: 0.5 },
			};
			hero.configureStats(
				{ agility: 100, strength: 100, magic: 0, spirit: 0, intelligence: 0 },
				buckler,
			);
			hero.knownSkills.add("blocking");
			hero.rage = 10;
			hero.addStatus({ kind, remaining: 2, damagePerSecond: 4 });
			const hp = hero.hp;
			hero.compileState(1, { next: () => 0 });
			hero.updateResources(1, { next: () => 0 });
			hero.advanceEffects(1);
			expect(hero.hp).toBeCloseTo(hp - 4);
			expect(hero.rage).toBeCloseTo(8.999);
			expect(hero.lastHitDodged).toBeFalse();
		}
	});
	test("lets Katars block without Blocking or Rage cost", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const katars = {
			...generateItem(100, "unique", 103, { allowedClasses: ["katars"] }),
			requirements: {},
		};
		hero.configureStats(
			{ agility: 100, strength: 5, magic: 0, spirit: 0, intelligence: 0 },
			undefined,
			katars,
		);
		const hp = hero.hp;
		const rage = hero.rage;
		hero.receiveDamage(10, { next: () => 0.749 });
		expect(hero.hp).toBe(hp - 5);
		expect(hero.rage).toBe(rage + 1);
	});
	test("lets the Manaforged Aegis block without Rage cost", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const aegis = { ...generateBuckler(0, "unique", 12), perks: {} };
		hero.configureStats(
			{ agility: 100, strength: 100, magic: 0, spirit: 0, intelligence: 45 },
			aegis,
		);
		hero.rage = 0;
		const manaCost = hero.maxMana * 0.01;
		const mana = hero.mana;
		const hp = hero.hp;
		const rolls = [1, 0, 1, 0];
		hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 });
		hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 });
		expect(hero.hp).toBe(hp);
		expect(hero.mana).toBeCloseTo(mana - manaCost * 2);
		expect(hero.rage).toBe(2);
		hero.mana = manaCost - 0.001;
		hero.receiveDamage(10, { next: () => 1 });
		expect(hero.hp).toBe(hp - 10);
		expect(hero.mana).toBeCloseTo(manaCost - 0.001);
	});
	test("adds one block-chance percentage point per effective Blocking level", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const buckler = { ...generateBuckler(0, "common", 12), perks: {} };
		hero.configureStats({ ...ZERO_STATS, strength: 1 }, buckler);
		hero.skillLevels.set("blocking", 10);
		hero.compileState(1 / 60);
		const rage = hero.rage;
		hero.receiveDamage(5, { next: () => 0.15 });
		hero.receiveDamage(5, { next: () => 0.15 });
		expect(hero.rage).toBe(rage);
		expect(hero.hp).toBe(hero.maxHp - 8);
	});
	test("restores Penance mana from damage prevented by a successful block", () => {
		const hero = new Hero({ x: 0, y: 0 });
		const buckler = generateBuckler(0, "common", 12);
		hero.configureStats(
			{ agility: 0, strength: 100, magic: 0, spirit: 10, intelligence: 100 },
			buckler,
			starterClub(),
		);
		hero.mana = 0;
		hero.knownSkills.add("penance");
		hero.skillLevels.set("penance", 99);
		let rolls = [1, 0];
		hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 });
		expect(hero.mana).toBeGreaterThan(29);
		expect(hero.mana).toBeLessThan(60);

		hero.configureStats(
			{ agility: 0, strength: 100, magic: 0, spirit: 0, intelligence: 100 },
			buckler,
			starterClub(),
		);
		hero.mana = 0;
		hero.knownSkills.add("penance");
		hero.skillLevels.set("penance", 1);
		rolls = [1, 0];
		hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 });
		expect(hero.mana).toBeCloseTo(hero.maxMana * 0.01);
	});

	test("returns passive Thorns damage and doubles it during Reflective Surge", () => {
		const defender = new Hero({ x: 0, y: 0 });
		const attacker = new Hero({ x: 10, y: 0 });
		defender.knownSkills.add("thorns");
		defender.compileState(1 / 60);
		const random = { next: () => 1 };
		const before = attacker.hp;
		defender.receiveDamage(20, random, attacker);
		expect(attacker.hp).toBe(before - 1);
		attacker.hp = before;
		defender.reflectiveSurgeRemaining = 6;
		defender.compileState(1 / 60);
		defender.receiveDamage(20, random, attacker);
		expect(attacker.hp).toBe(before - 2.2);
	});

	test("activates Reflective Surge only in response to a non-dodged hit", () => {
		const defender = new Hero({ x: 0, y: 0 });
		const attacker = new Hero({ x: 10, y: 0 });
		defender.configureStats({ ...ZERO_STATS, strength: 10 });
		defender.knownSkills.add("thorns");
		defender.knownSkills.add("reflectiveSurge");
		defender.skillLevels.set("reflectiveSurge", 1);
		defender.rage = 4;
		defender.compileState(1 / 60);
		const before = attacker.hp;
		expect(defender.reflectiveSurgeRemaining).toBe(0);
		defender.receiveDamage(5, { next: () => 1 }, attacker, true, false, {
			kind: "physical",
			critical: false,
		});
		expect(defender.rage).toBe(3);
		expect(defender.reflectiveSurgeRemaining).toBe(5);
		expect(defender.reflectiveSurgeCooldown).toBeGreaterThan(0);
		expect(attacker.hp).toBeCloseTo(before - 0.25);
		const cooldown = defender.reflectiveSurgeCooldown;
		defender.compileState(1 / 60);
		defender.receiveDamage(5, { next: () => 1 }, attacker, true, false, {
			kind: "physical",
			critical: false,
		});
		expect(defender.rage).toBe(5);
		expect(defender.reflectiveSurgeCooldown).toBe(cooldown);
		expect(attacker.hp).toBeCloseTo(before - 0.8);
	});

	test("manually activates Reflective Surge by slot only when auto-fire is off", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const attacker = new Hero({ x: 80, y: 50 });
		hero.configureStats({ ...ZERO_STATS, strength: 10 });
		const progress = {
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS, strength: 10 },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			inventoryTiles: [],
			learnedSkills: ["reflectiveSurge" as const],
			learnedSkillLevels: { reflectiveSurge: 1 },
			universalSkills: [],
			equippedSkills: ["reflectiveSurge" as const],
			autoFireSkills: [],
		};
		const combat = new HeroCombatSystem();
		combat.syncSkills(progress, hero);
		hero.receiveDamage(1, { next: () => 1 }, attacker);
		expect(hero.reflectiveSurgeRemaining).toBe(0);
		expect(hero.rage).toBe(7);

		combat.requestSpellSlot(0, progress);
		combat.update(
			1 / 60,
			{ x: 0, y: 0 },
			hero,
			new ArenaState(),
			progress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(hero.rage).toBe(4);
		expect(hero.reflectiveSurgeRemaining).toBe(5);
		expect(hero.reflectiveSurgeCooldown).toBeGreaterThan(0);

		const cooldown = hero.reflectiveSurgeCooldown;
		const rage = hero.rage;
		combat.requestSpellSlot(0, progress);
		combat.update(
			1 / 60,
			{ x: 0, y: 0 },
			hero,
			new ArenaState(),
			progress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(hero.rage).toBe(rage);
		expect(hero.reflectiveSurgeCooldown).toBe(cooldown);
	});

	test("auto-fire Reflective Surge ignores its shortcut and triggers on hit", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const attacker = new Hero({ x: 80, y: 50 });
		hero.configureStats({ ...ZERO_STATS, strength: 10 });
		const progress = {
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS, strength: 10 },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			inventoryTiles: [],
			learnedSkills: ["reflectiveSurge" as const],
			learnedSkillLevels: { reflectiveSurge: 1 },
			universalSkills: [],
			equippedSkills: ["reflectiveSurge" as const],
			autoFireSkills: ["reflectiveSurge" as const],
		};
		const combat = new HeroCombatSystem();
		combat.requestSpellSlot(0, progress);
		combat.update(
			1 / 60,
			{ x: 0, y: 0 },
			hero,
			new ArenaState(),
			progress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(hero.reflectiveSurgeRemaining).toBe(0);
		expect(hero.rage).toBe(5);

		hero.receiveDamage(1, { next: () => 1 }, attacker);
		expect(hero.reflectiveSurgeRemaining).toBe(5);
		expect(hero.rage).toBe(4);
		expect(hero.reflectiveSurgeCooldown).toBeGreaterThan(0);
	});

	test("manually activates Rapid Regeneration at full health while auto-fire waits for missing health", () => {
		const rapidRegenProgress = (autoFire: boolean) => ({
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			inventoryTiles: [],
			learnedSkills: ["rapidRegen" as const],
			learnedSkillLevels: { rapidRegen: 1 },
			universalSkills: [],
			equippedSkills: ["rapidRegen" as const],
			autoFireSkills: autoFire ? (["rapidRegen"] as const) : [],
		});
		const hero = new Hero({ x: 50, y: 50 });
		hero.configureStats(ZERO_STATS);
		const combat = new HeroCombatSystem();
		const autoProgress = rapidRegenProgress(true);

		combat.update(
			1 / 60,
			{ x: 0, y: 0 },
			hero,
			new ArenaState(),
			autoProgress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(hero.effectRemaining("rapidRegen")).toBe(0);
		expect(hero.mana).toBe(hero.maxMana);

		const manualProgress = rapidRegenProgress(false);
		combat.requestSpellSlot(0, manualProgress);
		combat.update(
			1 / 60,
			{ x: 0, y: 0 },
			hero,
			new ArenaState(),
			manualProgress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(hero.effectRemaining("rapidRegen")).toBe(10);
		expect(hero.mana).toBe(hero.maxMana - 4);
	});

	test("allows consecutive successful Return blocks without a cooldown", () => {
		const hero = new Hero({ x: 50, y: 50 });
		const club = starterClub();
		const buckler = {
			...generateBuckler(0, "common", 12),
			perks: {},
			statBonuses: {},
			reflectionComponents: ["return" as const],
		};
		const stats = {
			agility: 100,
			strength: 100,
			magic: 0,
			spirit: 0,
			intelligence: 0,
		};
		hero.configureStats(stats, buckler, club);
		const hp = hero.hp;
		let rolls = [1, 0];
		hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 });
		expect(hero.hp).toBe(hp);
		rolls = [1, 0];
		hero.receiveDamage(10, { next: () => rolls.shift() ?? 1 });
		expect(hero.hp).toBe(hp);
	});

	test("emits typed damage, healing, and inherited shield-return numbers", () => {
		const defender = new Hero({ x: 50, y: 50 });
		const attacker = new Hero({ x: 60, y: 50 });
		const texts: CombatText[] = [];
		defender.onCombatText = (text) => texts.push(text);
		attacker.onCombatText = (text) => texts.push(text);
		defender.receiveDamage(2, { next: () => 1 }, attacker, true, false, {
			kind: "magic",
			critical: true,
		});
		defender.heal(1);
		expect(texts.map(({ kind, critical }) => ({ kind, critical }))).toEqual([
			{ kind: "magic", critical: true },
			{ kind: "healing", critical: false },
		]);
		const buckler = {
			...generateBuckler(0, "common", 12),
			perks: {},
			statBonuses: {},
			reflectionComponents: ["flat" as const],
		};
		defender.configureStats(
			{ agility: 0, strength: 1, spirit: 0, intelligence: 0 },
			buckler,
		);
		texts.length = 0;
		defender.receiveDamage(2, { next: () => 0 }, attacker, true, false, {
			kind: "fire",
			critical: true,
		});
		expect(
			texts.some(
				(text) =>
					text.kind === "fire" &&
					!text.critical &&
					text.position.x === attacker.position.x,
			),
		).toBeTrue();
	});

	test("emits dodge and block outcomes for heroes and enemies", () => {
		const hero = new Hero({ x: 0, y: 0 });
		const texts: CombatText[] = [];
		hero.onCombatText = (text) => texts.push(text);
		hero.configureStats({
			agility: 100,
			strength: 0,
			magic: 0,
			spirit: 0,
			intelligence: 0,
		});
		hero.receiveDamage(5, { next: () => 0 });
		expect(texts.at(-1)?.label).toBe("DODGE");
		const buckler = generateBuckler(0, "common", 12);
		hero.configureStats(
			{ agility: 0, strength: 100, magic: 0, spirit: 0, intelligence: 0 },
			buckler,
		);
		const rolls = [1, 0];
		hero.receiveDamage(5, { next: () => rolls.shift() ?? 1 });
		expect(texts.at(-1)?.label).toBe("BLOCK");
	});
	test("shows post-mitigation overkill damage rather than remaining target health", () => {
		const hero = new Hero({ x: 10, y: 10 });
		const texts: CombatText[] = [];
		hero.onCombatText = (text) => texts.push(text);
		hero.receiveDamage(250, { next: () => 1 });
		expect(hero.hp).toBe(0);
		expect(texts[0].amount).toBe(250);
	});
	test("expires bounded spell effects and clears them with the arena", () => {
		const state = new ArenaState();
		const effect = new SpellEffect("shockwave", { x: 5, y: 5 });
		state.spellEffects.push(effect);
		effect.update(1);
		removeInactive(state.spellEffects);
		expect(state.spellEffects).toHaveLength(0);
		state.spellEffects.push(new SpellEffect("healing", { x: 5, y: 5 }));
		state.clear();
		expect(state.spellEffects).toHaveLength(0);
	});
	test("pulses Healing's aura and delays its fading rising plus signs", () => {
		expect(healingAuraOpacity(0)).toBe(0);
		expect(healingAuraOpacity(0.25)).toBe(1);
		expect(healingAuraOpacity(1)).toBe(0);
		expect(healingPlusOpacity(0.249)).toBe(0);
		expect(healingPlusOpacity(0.25)).toBe(1);
		expect(healingPlusOpacity(1)).toBe(0);

		const effect = new SpellEffect(
			"healing",
			{ x: 5, y: 5 },
			0,
			healingRadius(99),
			undefined,
			undefined,
			true,
		);
		const lightPool = new HeroSpellLightPool(new THREE.Scene());
		effect.update(0.24);
		effect.updateVisuals(0);
		lightPool.sync(["healing"], [effect], 0);
		const group = effect.mesh.children[0];
		const uplight = lightPool.light("healing") as THREE.PointLight;
		expect(uplight).toBeInstanceOf(THREE.PointLight);
		expect(uplight.color.getHex()).toBe(0x72f2a7);
		expect(uplight.position.z).toBe(6);
		expect(uplight.distance).toBe(HEALING_MAX_RADIUS * 2);
		expect(uplight.intensity).toBeCloseTo(healingUplightIntensity(0.24));
		expect(
			group.children.some((child) => child.name === "healing-plus"),
		).toBeFalse();

		effect.update(0.01);
		effect.updateVisuals(0);
		lightPool.sync(["healing"], [effect], 0);
		expect(uplight.intensity).toBe(HEALING_UPLIGHT_INTENSITY);
		const initialPluses = group.children.filter(
			(child) => child.name === "healing-plus",
		);
		expect(initialPluses).toHaveLength(6);
		expect(
			initialPluses.every((child) => child instanceof THREE.Sprite),
		).toBeTrue();
		expect(
			initialPluses.every((child) => child.castShadow === false),
		).toBeTrue();
		const initialPositions = initialPluses.map((child) =>
			child.position.clone(),
		);
		const aura = group.children.find((child) => child.name === "healing-aura");
		expect(aura?.geometry.parameters.outerRadius).toBe(HEALING_MAX_RADIUS);
		expect(
			(aura?.material as THREE.MeshBasicMaterial | undefined)?.opacity,
		).toBe(HEALING_AURA_RING_MAX_OPACITY);
		const auraFill = group.children.find(
			(child) => child.name === "healing-aura-light",
		);
		expect(
			(auraFill?.material as THREE.MeshBasicMaterial | undefined)?.opacity,
		).toBe(HEALING_AURA_FILL_MAX_OPACITY);

		effect.update(0.25);
		effect.updateVisuals(0);
		const laterPluses = group.children.filter(
			(child) => child.name === "healing-plus",
		);
		for (let index = 0; index < laterPluses.length; index += 1) {
			expect(laterPluses[index].position.x).toBeCloseTo(
				initialPositions[index].x,
			);
			expect(laterPluses[index].position.y).toBeCloseTo(
				initialPositions[index].y,
			);
			expect(laterPluses[index].position.z).toBeGreaterThan(
				initialPositions[index].z,
			);
		}
		expect(effect.active).toBeTrue();
		effect.update(0.5);
		effect.updateVisuals(1);
		lightPool.sync(["healing"], [effect], 1);
		expect(effect.active).toBeTrue();
		expect(uplight.intensity).toBeGreaterThan(0);
		expect(healingAuraOpacity(1)).toBe(0);
		effect.update(HEALING_LIGHT_LINGER_DURATION);
		effect.updateVisuals(2);
		lightPool.sync(["healing"], [effect], 2);
		expect(uplight.intensity).toBe(0);
		expect(effect.active).toBeFalse();
		expect(HEALING_GROUND_DURATION).toBe(1);
	});
});

function makeCreep(
	id: string,
	position: Vector2,
	mainHand: ItemInstance = starterClub(),
	stats: Stats = {
		...ZERO_STATS,
		strength: 100,
		spirit: 100,
		intelligence: 100,
	},
): Creep {
	return new Creep(
		{
			id,
			name: id,
			kind: "melee",
			level: 1,
			stats,
			mainHand,
			carried: [],
			isRival: false,
			xpReward: 0,
			goldReward: 0,
			seed: 1,
		},
		"neutral",
		"neutral",
		position,
		BALANCE,
		new SeededRandom(1),
	);
}

describe("Unique rarity arena effects", () => {
	test("a Unique staff doubles Arcane Bolt's explosion radius and applies Freeze", () => {
		const uniqueStaff = generateItem(4, "unique", 1001, {
			allowedClasses: ["staff"],
		});
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(ZERO_STATS, undefined, uniqueStaff);
		const state = new ArenaState();
		const direct = makeCreep("direct", { x: 100, y: 0 });
		const nearby = makeCreep("nearby", { x: 180, y: 0 });
		const outside = makeCreep("outside", { x: 225, y: 0 });
		state.creeps.push(direct, nearby, outside);
		const projectile = new Projectile(
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			10,
			"hero",
			"arcaneBolt",
			hero,
			{ kind: "magic" },
			uniqueStaff,
			false,
			1,
		);
		projectile.position = { x: 100, y: 0 };
		state.projectiles.push(projectile);
		const directBefore = direct.hp;
		const nearbyBefore = nearby.hp;
		const outsideBefore = outside.hp;
		resolveCombat(state, hero, uniqueStaff, 500, 500, new SeededRandom(1));
		const explosion = spellPower(1) * 0.5;
		expect(direct.hp).toBeCloseTo(directBefore - (10 + explosion));
		expect(nearby.hp).toBeCloseTo(nearbyBefore - explosion);
		expect(outside.hp).toBe(outsideBefore);
		expect(projectile.active).toBeFalse();
		expect(state.spellEffects[0].kind).toBe("arcaneBoltExplosion");
		expect(
			nearby.statuses.filter((status) => status.kind === "freeze"),
		).toHaveLength(1);
		expect(nearby.statuses[0].remaining).toBe(4);
		expect(outside.statuses).toHaveLength(0);
		expect(arcaneBoltExplosionRadius(1)).toBe(50);
		expect(arcaneBoltExplosionRadius(99)).toBe(200);
	});
	test("Cleave and Bash from Unique weapons destroy enemy projectiles in their area", () => {
		for (const [skill, weaponClass, seed] of [
			["cleave", "axe", 1002],
			["bash", "club", 1004],
		] as const) {
			const uniqueWeapon = generateItem(4, "unique", seed, {
				allowedClasses: [weaponClass],
			});
			const hero = new Hero({ x: 0, y: 0 });
			hero.configureStats(ZERO_STATS, undefined, uniqueWeapon);
			const state = new ArenaState();
			const nearProjectile = new Projectile(
				{ x: 50, y: 0 },
				{ x: 50, y: 0 },
				5,
				"creep",
			);
			const farProjectile = new Projectile(
				{ x: 900, y: 0 },
				{ x: 900, y: 0 },
				5,
				"creep",
			);
			state.projectiles.push(nearProjectile, farProjectile);
			const attack = new AttackArea(
				"hero",
				{ x: 0, y: 0 },
				0,
				200,
				Math.PI / 4,
				0,
				0.3,
				5,
				hero,
				skill,
				uniqueWeapon,
			);
			state.attacks.push(attack);
			resolveCombat(state, hero, uniqueWeapon, 500, 500, new SeededRandom(1));
			expect(nearProjectile.active).toBeFalse();
			expect(farProjectile.active).toBeTrue();
		}
	});
	test("orbiting hammers follow the caster when wielded as a Unique hammer", () => {
		const hero = new Hero({ x: 50, y: 50 });
		hero.configureStats(
			{ ...ZERO_STATS, magic: 100 },
			undefined,
			starterClub(),
		);
		const hammer = Projectile.orbitingHammer(
			hero,
			0,
			5,
			{ kind: "magic" },
			0,
			2.4,
			true,
		);
		expect(hammer.position.x).toBeCloseTo(78);
		expect(hammer.position.y).toBeCloseTo(50);
		hero.position = { x: 120, y: 30 };
		hammer.update(0.1);
		const radius = 28 + (0.1 / 2.4) * 162;
		const angle = 0.1 * 5.2;
		expect(hammer.position.x).toBeCloseTo(120 + Math.cos(angle) * radius);
		expect(hammer.position.y).toBeCloseTo(30 + Math.sin(angle) * radius);
	});
	test("a Unique mace's auto Healing damages enemies by a quarter of the HP restored", () => {
		const uniqueMace = generateItem(4, "unique", 1003, {
			allowedClasses: ["mace"],
		});
		const hero = new Hero({ x: 50, y: 50 });
		hero.configureStats(
			{ ...ZERO_STATS, strength: 100, intelligence: 100 },
			undefined,
			uniqueMace,
		);
		hero.hp = hero.maxHp * 0.3;
		const state = new ArenaState();
		const near = makeCreep("near", { x: 210, y: 50 });
		const far = makeCreep("far", { x: 800, y: 50 });
		state.creeps.push(near, far);
		const restored = healingCast(
			hero.hp,
			hero.maxHp,
			hero.rage,
			hero.maxRage,
			1,
		).restoredHp;
		const nearBefore = near.hp;
		const farBefore = far.hp;
		const progress = {
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS, strength: 100, intelligence: 100 },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			mainHand: uniqueMace,
			inventoryTiles: [],
			learnedSkills: ["healing"],
			learnedSkillLevels: { healing: 1 },
			universalSkills: [],
			equippedSkills: ["healing"],
			autoFireSkills: ["healing"],
		};
		const combat = new HeroCombatSystem();
		combat.update(
			1 / 60,
			{ x: 0, y: 0 },
			hero,
			state,
			progress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(nearBefore - near.hp).toBeCloseTo(restored * 0.25);
		expect(far.hp).toBe(farBefore);
	});
	test("a Unique mace enemy's Healing damages the hero by a quarter of the HP restored", () => {
		const uniqueMace = generateItem(4, "unique", 1003, {
			allowedClasses: ["mace"],
		});
		const creep = makeCreep("healer", { x: 50, y: 50 }, uniqueMace);
		creep.knownSkills.add("healing");
		creep.skillLevels.set("healing", 1);
		creep.hp = creep.maxHp * 0.3;
		const hero = new Hero({ x: 80, y: 50 });
		hero.configureStats({ ...ZERO_STATS, strength: 100 });
		const hpBefore = creep.hp;
		const heroBefore = hero.hp;
		expect(creep.castHealing([creep], [], hero)).toBeTrue();
		const restored = creep.hp - hpBefore;
		expect(restored).toBeGreaterThan(0);
		expect(heroBefore - hero.hp).toBeCloseTo(restored * 0.25);
	});
	test("a Unique buckler radiates reflection and Thorns damage to every enemy nearby", () => {
		const uniqueBuckler = generateBuckler(4, "unique", 1005);
		expect(uniqueBuckler.reflectionComponents.length).toBeGreaterThan(0);
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(
			{
				...ZERO_STATS,
				strength: 100,
				agility: 100,
				intelligence: 100,
				spirit: 100,
			},
			uniqueBuckler,
		);
		hero.rage = 0;
		hero.reflectiveSurgeAutomatic = false;
		const reflected: number[] = [];
		hero.radialReflect = (amount) => reflected.push(amount);
		const attacker = new Hero({ x: 10, y: 0 });
		attacker.configureStats(ZERO_STATS);
		const before = hero.hp;
		hero.receiveDamage(20, { next: () => 1 }, attacker, true, false, {
			kind: "physical",
		});
		expect(reflected).toHaveLength(1);
		expect(reflected[0]).toBeCloseTo(1);
		expect(attacker.hp).toBe(attacker.maxHp);
		expect(before - hero.hp).toBeLessThan(20);
	});
	test("a Unique Voodoo Doll relic casts a 4x-radius swamp centered on and following the caster", () => {
		const uniqueVoodoo = generateRelic(4, "unique", 1001);
		expect(uniqueVoodoo.skills).toContain("voodoo");
		const hero = new Hero({ x: 50, y: 50 });
		hero.configureStats({ ...ZERO_STATS, magic: 100 }, uniqueVoodoo);
		const state = new ArenaState();
		const target = makeCreep("target", { x: 100, y: 50 });
		state.creeps.push(target);
		const progress = {
			level: 1,
			xp: 0,
			stats: { ...ZERO_STATS, magic: 100 },
			allocation: { ...DEFAULT_ALLOCATION },
			gold: 0,
			souls: 0,
			scraps: emptyScraps(),
			mainHand: starterClub(),
			offHand: uniqueVoodoo,
			inventoryTiles: [],
			learnedSkills: [],
			learnedSkillLevels: {},
			universalSkills: [],
			equippedSkills: ["swamp"],
			autoFireSkills: ["swamp"],
		};
		const combat = new HeroCombatSystem();
		combat.update(
			1,
			{ x: 0, y: 0 },
			hero,
			state,
			progress,
			BALANCE,
			new SeededRandom(1),
		);
		combat.update(
			1,
			{ x: 0, y: 0 },
			hero,
			state,
			progress,
			BALANCE,
			new SeededRandom(1),
		);
		expect(state.swamps).toHaveLength(1);
		const swamp = state.swamps[0];
		expect(swamp.radius).toBeCloseTo(
			swampRadius(effectiveSkillLevel(progress, "swamp")) * 4,
		);
		expect(swamp.position.x).toBeCloseTo(50);
		expect(swamp.position.y).toBeCloseTo(50);
		hero.position = { x: 250, y: 250 };
		swamp.update(1 / 60, state.creeps);
		expect(swamp.position.x).toBeCloseTo(250);
		expect(swamp.position.y).toBeCloseTo(250);
	});
	test("a Unique Voodoo Doll relic reduces incoming direct damage by 20% while Voodoo is active", () => {
		const uniqueVoodoo = generateRelic(4, "unique", 1001);
		const stats = {
			...ZERO_STATS,
			strength: 100,
			agility: 100,
			magic: 100,
			spirit: 100,
			intelligence: 100,
		};
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(stats, uniqueVoodoo);
		hero.rage = 0;
		hero.reflectiveSurgeAutomatic = false;
		const control = new Hero({ x: 0, y: 0 });
		control.configureStats(stats, {
			...uniqueVoodoo,
			skills: uniqueVoodoo.skills.filter((skill) => skill !== "voodoo"),
		});
		control.rage = 0;
		control.reflectiveSurgeAutomatic = false;
		const attacker = new Hero({ x: 10, y: 0 });
		attacker.configureStats(ZERO_STATS);
		const heroBefore = hero.hp;
		hero.receiveDamage(20, { next: () => 1 }, attacker, true, false, {
			kind: "physical",
		});
		const heroDamage = heroBefore - hero.hp;
		const controlBefore = control.hp;
		control.receiveDamage(20, { next: () => 1 }, attacker, true, false, {
			kind: "physical",
		});
		const controlDamage = controlBefore - control.hp;
		expect(controlDamage).toBeGreaterThan(0);
		expect(heroDamage).toBeCloseTo(controlDamage * 0.8);
	});
	test("a Unique amulet saves the first lethal direct hit each wave and grants immunity", () => {
		const uniqueAmulet = generateAccessory(4, "unique", 1007, "amulet");
		const hero = new Hero({ x: 0, y: 0 });
		hero.configureStats(
			{ ...ZERO_STATS, strength: 100, spirit: 100 },
			undefined,
			starterClub(),
			uniqueAmulet,
		);
		hero.rage = 0;
		hero.reflectiveSurgeAutomatic = false;
		hero.currentWave = 5;
		const attacker = new Hero({ x: 10, y: 0 });
		attacker.configureStats(ZERO_STATS);
		const maxHp = hero.hp;
		hero.receiveDamage(maxHp + 50, { next: () => 1 }, attacker, true, false, {
			kind: "physical",
		});
		expect(hero.hp).toBe(1);
		expect(hero.immunityRemaining).toBe(1);
		expect(hero.deathPreventionWaveUsed).toBe(5);
		hero.receiveDamage(50, { next: () => 1 }, attacker, true, false, {
			kind: "physical",
		});
		expect(hero.hp).toBe(1);
		hero.updateResources(1);
		expect(hero.immunityRemaining).toBe(0);
		hero.receiveDamage(50, { next: () => 1 }, attacker, true, false, {
			kind: "physical",
		});
		expect(hero.hp).toBe(0);
		expect(hero.active).toBeFalse();
	});
});
