import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

export type CharacterModelKind = "hero" | "boss" | "creep" | "champion";
export type CharacterAnimationState =
	| "idle"
	| "move"
	| "attack"
	| "hit"
	| "death";

export interface CharacterAnimationSnapshot {
	time: number;
	facing: number;
	moving: boolean;
	attackVersion: number;
	attackDuration: number;
	hitVersion: number;
	dead: boolean;
	statusTint?: string;
	flash?: boolean;
	reflectiveSurge?: boolean;
}

interface CharacterModelManifest {
	path: string;
	footprint: number;
	facingOffset: number;
	baseTint: number;
	renderOrder: number;
	clips: Record<CharacterAnimationState, readonly string[]>;
}

export const CHARACTER_MODEL_MANIFESTS: Record<
	CharacterModelKind,
	CharacterModelManifest
> = {
	hero: {
		path: "/assets/models/hero.glb",
		footprint: 50,
		facingOffset: Math.PI / 2,
		baseTint: 0xc9fff2,
		renderOrder: 50,
		clips: {
			idle: ["Idle", "Look"],
			move: ["Charging", "Idle"],
			attack: ["Attack", "Charging"],
			hit: ["Hit"],
			death: ["TurnOff", "Death", "Hit"],
		},
	},
	boss: {
		path: "/assets/models/boss.glb",
		footprint: 70,
		facingOffset: Math.PI / 2,
		baseTint: 0xffd166,
		renderOrder: 40,
		clips: {
			idle: ["Idle", "Look"],
			move: ["Run", "Walk", "Idle"],
			attack: ["Attack", "AttackAuto"],
			hit: ["Hit"],
			death: ["TurnOff", "Death", "Hit"],
		},
	},
	creep: {
		path: "/assets/models/creep.glb",
		footprint: 40,
		facingOffset: Math.PI / 2,
		baseTint: 0xff6f7d,
		renderOrder: 40,
		clips: {
			idle: ["Idle", "Look"],
			move: ["Run", "Walk", "Idle"],
			attack: ["Attack", "Charge"],
			hit: ["Hit"],
			death: ["TurnOff", "Death", "Hit"],
		},
	},
	champion: {
		path: "/assets/models/champion.glb",
		footprint: 62,
		facingOffset: Math.PI / 2,
		baseTint: 0xffd166,
		renderOrder: 40,
		clips: {
			idle: ["CharacterArmature|Idle"],
			move: ["CharacterArmature|Run", "CharacterArmature|Walk"],
			attack: ["CharacterArmature|Attack", "CharacterArmature|Shoot"],
			hit: [],
			death: ["CharacterArmature|Death"],
		},
	},
};

const loader = new GLTFLoader();
const modelCache = new Map<string, Promise<GLTF>>();

function loadModel(path: string): Promise<GLTF> {
	let promise = modelCache.get(path);
	if (!promise) {
		promise = loader.loadAsync(path);
		modelCache.set(path, promise);
	}
	return promise;
}

export function matchingAnimationClip(
	clips: readonly THREE.AnimationClip[],
	aliases: readonly string[],
): THREE.AnimationClip | undefined {
	for (const alias of aliases) {
		const exact = clips.find(
			(clip) => clip.name.toLowerCase() === alias.toLowerCase(),
		);
		if (exact) return exact;
	}
	return undefined;
}

interface ModelMaterial {
	material: THREE.MeshStandardMaterial;
	color: THREE.Color;
	emissive: THREE.Color;
	map: THREE.Texture | null;
	metalness: number;
	roughness: number;
}

export class AnimatedCharacter {
	readonly root = new THREE.Group();
	private readonly manifest: CharacterModelManifest;
	private readonly actions = new Map<
		CharacterAnimationState,
		THREE.AnimationAction
	>();
	private readonly materials: ModelMaterial[] = [];
	private mixer?: THREE.AnimationMixer;
	private currentAction?: THREE.AnimationAction;
	private currentState: CharacterAnimationState = "idle";
	private lastTime?: number;
	private lastAttackVersion = 0;
	private lastHitVersion = 0;
	private loaded = false;
	private failed = false;
	private dead = false;
	private deathDuration = 1.8;
	private moving = false;

	constructor(
		readonly kind: CharacterModelKind,
		private readonly fallback?: THREE.Object3D,
	) {
		this.manifest = CHARACTER_MODEL_MANIFESTS[kind];
		if (typeof document !== "undefined") void this.load();
	}

	get modelLoaded(): boolean {
		return this.loaded;
	}

	get loadFailed(): boolean {
		return this.failed;
	}

	update(snapshot: CharacterAnimationSnapshot): void {
		const delta =
			this.lastTime === undefined ? 0 : snapshot.time - this.lastTime;
		this.lastTime = snapshot.time;
		this.root.rotation.z = snapshot.facing + this.manifest.facingOffset;
		this.moving = snapshot.moving;

		if (!this.dead && snapshot.dead) {
			this.dead = true;
			this.play("death", this.deathDuration);
		} else if (!this.dead && snapshot.hitVersion !== this.lastHitVersion) {
			this.lastHitVersion = snapshot.hitVersion;
			this.play("hit", 0.22);
		} else if (
			!this.dead &&
			snapshot.attackVersion !== this.lastAttackVersion
		) {
			this.lastAttackVersion = snapshot.attackVersion;
			this.play("attack", snapshot.attackDuration);
		} else if (!this.dead && this.currentAction === undefined) {
			this.play(snapshot.moving ? "move" : "idle");
		} else if (
			!this.dead &&
			(this.currentState === "idle" || this.currentState === "move") &&
			this.currentState !== (snapshot.moving ? "move" : "idle")
		) {
			this.play(snapshot.moving ? "move" : "idle");
		}

		this.applyTint(
			snapshot.statusTint,
			snapshot.flash ?? false,
			snapshot.reflectiveSurge ?? false,
		);
		if (delta > 0) this.mixer?.update(Math.min(delta, 0.1));
	}

	playDeath(duration = 1.2): void {
		this.deathDuration = duration;
		this.dead = true;
		this.play("death", duration);
	}

	private async load(): Promise<void> {
		try {
			const gltf = await loadModel(this.manifest.path);
			const model = cloneSkeleton(gltf.scene);
			model.rotation.x = Math.PI / 2;
			model.updateMatrixWorld(true);
			let box = new THREE.Box3().setFromObject(model);
			const size = box.getSize(new THREE.Vector3());
			const footprint = Math.max(size.x, size.y, 0.001);
			model.scale.setScalar(this.manifest.footprint / footprint);
			model.updateMatrixWorld(true);
			box = new THREE.Box3().setFromObject(model);
			const center = box.getCenter(new THREE.Vector3());
			model.position.set(-center.x, -center.y, -box.min.z);

			model.traverse((object) => {
				if (!(object instanceof THREE.Mesh)) return;
				object.renderOrder = this.manifest.renderOrder;
				object.frustumCulled = false;
				const sourceMaterials = Array.isArray(object.material)
					? object.material
					: [object.material];
				const cloned = sourceMaterials.map((source) => source.clone());
				object.material = Array.isArray(object.material) ? cloned : cloned[0];
				for (const material of cloned)
					if (material instanceof THREE.MeshStandardMaterial)
						this.materials.push({
							material,
							color: material.color.clone(),
							emissive: material.emissive.clone(),
							map: material.map,
							metalness: material.metalness,
							roughness: material.roughness,
						});
			});

			this.root.add(model);
			this.mixer = new THREE.AnimationMixer(model);
			for (const state of Object.keys(
				this.manifest.clips,
			) as CharacterAnimationState[]) {
				const clip = matchingAnimationClip(
					gltf.animations,
					this.manifest.clips[state],
				);
				if (clip) this.actions.set(state, this.mixer.clipAction(clip));
			}
			this.mixer.addEventListener("finished", (event) => {
				if (event.action !== this.currentAction) return;
				if (this.dead) return;
				this.currentAction = undefined;
				this.play(this.moving ? "move" : "idle");
			});
			this.loaded = true;
			if (this.fallback) this.fallback.visible = false;
			if (this.dead) this.play("death", this.deathDuration);
			else this.play(this.moving ? "move" : "idle");
		} catch {
			this.failed = true;
			if (this.fallback) this.fallback.visible = true;
		}
	}

	private play(state: CharacterAnimationState, duration?: number): void {
		const next = this.actions.get(state) ?? this.actions.get("idle");
		if (!next || (next === this.currentAction && state === this.currentState))
			return;
		const previous = this.currentAction;
		this.currentAction = next;
		this.currentState = state;
		next.reset().setEffectiveWeight(1);
		if (state === "idle" || state === "move") {
			next.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
			next.clampWhenFinished = false;
			next.setEffectiveTimeScale(1);
		} else {
			next.setLoop(THREE.LoopOnce, 1);
			next.clampWhenFinished = true;
			next.setEffectiveTimeScale(
				duration && duration > 0
					? Math.max(0.1, next.getClip().duration / duration)
					: 1,
			);
		}
		next.play();
		if (previous && previous !== next) previous.crossFadeTo(next, 0.12, false);
	}

	private applyTint(
		statusTint: string | undefined,
		flash: boolean,
		reflectiveSurge: boolean,
	): void {
		const tint = new THREE.Color(
			flash ? 0xffffff : (statusTint ?? this.manifest.baseTint),
		);
		for (const entry of this.materials) {
			if (flash) entry.material.color.set(0xffffff);
			else if (reflectiveSurge) entry.material.color.set(0x8a9197);
			else entry.material.color.copy(entry.color).multiply(tint);
			entry.material.emissive.copy(entry.emissive);
			if (flash) entry.material.emissive.set(0xffffff);
			const map = reflectiveSurge ? null : entry.map;
			const metalness = reflectiveSurge ? 0.9 : entry.metalness;
			const roughness = reflectiveSurge ? 0.35 : entry.roughness;
			if (
				entry.material.map !== map ||
				entry.material.metalness !== metalness ||
				entry.material.roughness !== roughness
			) {
				entry.material.map = map;
				entry.material.metalness = metalness;
				entry.material.roughness = roughness;
				entry.material.needsUpdate = true;
			}
		}
	}
}

export class AnimatedCharacterDeath {
	readonly mesh = new THREE.Group();
	active = true;
	private age = 0;
	private readonly visual: AnimatedCharacter;
	private readonly facing: number;

	constructor(
		kind: CharacterModelKind,
		position: { x: number; y: number },
		facing: number,
		readonly lifetime = 1.2,
	) {
		this.facing = facing;
		this.visual = new AnimatedCharacter(kind);
		this.mesh.add(this.visual.root);
		this.mesh.position.set(position.x, position.y, 0);
		this.visual.playDeath(lifetime);
		this.visual.update({
			time: 0,
			facing,
			moving: false,
			attackVersion: 0,
			attackDuration: 0,
			hitVersion: 0,
			dead: true,
		});
	}

	update(deltaSeconds: number): void {
		this.age += deltaSeconds;
		if (this.age >= this.lifetime) this.active = false;
	}

	updateVisuals(time: number): void {
		this.mesh.visible = this.active;
		this.visual.update({
			time,
			facing: this.facing,
			moving: false,
			attackVersion: 0,
			attackDuration: 0,
			hitVersion: 0,
			dead: true,
		});
	}
}
