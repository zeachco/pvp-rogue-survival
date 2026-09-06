import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type RandomSource, systemRandom } from "../../common/random";
import { createArenaFloorTexture } from "./render/ArenaFloorTexture";
import { MAP_LAYER_STEP, MAP_Z } from "./render/ThreeRenderer";
import { THEME, toonMaterial } from "./theme";
import type { Vector2 } from "./types";

export const ARENA_DIAMETER = 1500;
export const ARENA_RADIUS = ARENA_DIAMETER / 2;

export interface ArenaColumn extends Vector2 {
	radius: number;
	coneSides: number;
	height: number;
}

export function arenaObstacleConeSides(value: number): number {
	return 3 + Math.min(4, Math.floor(value * 5));
}

export function arenaObstacleMaterial(): THREE.MeshToonMaterial {
	return toonMaterial(THEME.pillarStone);
}

export function arenaFloorMaterial(): THREE.MeshToonMaterial {
	const { texture, dispose } = createArenaFloorTexture();
	const material = toonMaterial(0xffffff);
	material.map = texture;
	material.emissive.set(THEME.floorEmber);
	material.emissiveMap = texture;
	material.userData.dispose = dispose;
	material.emissiveIntensity = 0.35;
	const uniforms = { uTime: { value: 0 } };
	material.userData.floorUniforms = uniforms;
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = uniforms.uTime;
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", "#include <common>\nuniform float uTime;")
			.replace(
				"#include <map_fragment>",
				[
					"#include <map_fragment>",
					"#ifdef USE_MAP",
					"{",
					"	float floorD = length(vMapUv - 0.5) * 2.0;",
					"	float floorWave = sin(floorD * 9.0 - uTime * 0.45) * 0.5 + 0.5;",
					"	diffuseColor.rgb += vec3(0.02, 0.012, 0.005) * floorWave * (1.0 - floorD);",
					"}",
					"#endif",
				].join("\n"),
			);
	};
	return material;
}

export interface ColumnCollider {
	position: Vector2;
	radius: number;
	velocity?: Vector2;
}

export function generateArenaColumns(
	width: number,
	height: number,
	count: number,
	random: RandomSource,
): ArenaColumn[] {
	const columns: ArenaColumn[] = [];
	const center = { x: width / 2, y: height / 2 };
	const arenaRadius = Math.min(width, height) / 2;
	for (
		let attempt = 0;
		columns.length < count && attempt < count * 100;
		attempt++
	) {
		const radius = 26 + random.next() * 14;
		const angle = random.next() * Math.PI * 2;
		const radialDistance =
			Math.sqrt(random.next()) * (arenaRadius - 100 - radius);
		const candidate = {
			x: center.x + Math.cos(angle) * radialDistance,
			y: center.y + Math.sin(angle) * radialDistance,
			radius,
		};
		if (Math.hypot(candidate.x - center.x, candidate.y - center.y) < 180)
			continue;
		if (
			columns.some(
				(column) =>
					Math.hypot(candidate.x - column.x, candidate.y - column.y) <
					candidate.radius + column.radius + 70,
			)
		)
			continue;
		columns.push({
			...candidate,
			coneSides: arenaObstacleConeSides(random.next()),
			height: 82 + random.next() * 54,
		});
	}
	return columns;
}

export function resolveColumnCollision(
	object: ColumnCollider,
	columns: readonly Pick<ArenaColumn, "x" | "y" | "radius">[],
): boolean {
	let collided = false;
	for (const column of columns) {
		const dx = object.position.x - column.x;
		const dy = object.position.y - column.y;
		const minimumDistance = object.radius + column.radius;
		const distance = Math.hypot(dx, dy);
		if (distance >= minimumDistance) continue;
		collided = true;
		const normalX = distance > 0 ? dx / distance : 1;
		const normalY = distance > 0 ? dy / distance : 0;
		object.position.x = column.x + normalX * minimumDistance;
		object.position.y = column.y + normalY * minimumDistance;
		if (object.velocity) {
			const inwardSpeed =
				object.velocity.x * normalX + object.velocity.y * normalY;
			if (inwardSpeed < 0) {
				object.velocity.x -= normalX * inwardSpeed;
				object.velocity.y -= normalY * inwardSpeed;
			}
		}
	}
	return collided;
}

export function touchesColumn(
	object: Pick<ColumnCollider, "position" | "radius">,
	columns: readonly Pick<ArenaColumn, "x" | "y" | "radius">[],
): boolean {
	return columns.some(
		(column) =>
			Math.hypot(object.position.x - column.x, object.position.y - column.y) <=
			object.radius + column.radius,
	);
}

export class GameMap {
	readonly width = ARENA_DIAMETER;
	readonly height = ARENA_DIAMETER;
	readonly radius = ARENA_RADIUS;
	readonly gridSize = 50;
	readonly mesh = new THREE.Group();
	readonly columns: readonly ArenaColumn[];
	private built = false;
	private floorUniforms?: { uTime: { value: number } };
	private flames: {
		flame: THREE.Mesh;
		core: THREE.Mesh;
		phase: number;
		x: number;
		y: number;
	}[] = [];
	private emberMesh?: THREE.InstancedMesh;
	private emberSeeds: {
		torch: number;
		offset: number;
		speed: number;
		drift: number;
	}[] = [];
	private bladePivot?: THREE.Group;
	private readonly emberMatrix = new THREE.Matrix4();
	private readonly emberPosition = new THREE.Vector3();
	private readonly emberScale = new THREE.Vector3();
	private readonly emberQuaternion = new THREE.Quaternion();

	constructor(random: RandomSource = systemRandom) {
		this.columns = generateArenaColumns(this.width, this.height, 15, random);
	}

	get center(): { x: number; y: number } {
		return { x: this.width / 2, y: this.height / 2 };
	}

	update(time: number, camera?: THREE.PerspectiveCamera): void {
		if (this.floorUniforms) this.floorUniforms.uTime.value = time;
		for (const entry of this.flames) {
			const flicker =
				1 +
				0.12 * Math.sin(time * 8.7 + entry.phase) +
				0.05 * Math.sin(time * 15.3 + entry.phase * 2);
			entry.flame.scale.set(1, flicker, 1);
			entry.core.scale.set(1, flicker * 0.94, 1);
		}
		if (this.emberMesh && this.flames.length) {
			if (camera) this.emberQuaternion.copy(camera.quaternion);
			for (let i = 0; i < this.emberSeeds.length; i++) {
				const seed = this.emberSeeds[i];
				const torch = this.flames[seed.torch];
				const cycle =
					((time * seed.speed + seed.offset) % (Math.PI * 2)) / (Math.PI * 2);
				const rise = 10 + cycle * 46;
				const sway = Math.sin(time * 2.2 + seed.offset) * seed.drift * cycle;
				this.emberPosition.set(torch.x + sway, torch.y, 44 + rise);
				const scale = 1 - cycle * 0.8;
				this.emberScale.set(scale, scale, scale);
				this.emberMatrix.compose(
					this.emberPosition,
					this.emberQuaternion,
					this.emberScale,
				);
				this.emberMesh.setMatrixAt(i, this.emberMatrix);
			}
			this.emberMesh.instanceMatrix.needsUpdate = true;
		}
		if (this.bladePivot)
			this.bladePivot.rotation.z = 0.8 * Math.sin(time * 0.9);
	}

	randomEdgeSpawn(random: { next(): number } = { next: () => Math.random() }): {
		x: number;
		y: number;
	} {
		const angle = random.next() * Math.PI * 2;
		const distance = this.radius + 24;
		return {
			x: this.center.x + Math.cos(angle) * distance,
			y: this.center.y + Math.sin(angle) * distance,
		};
	}

	buildMeshes(): void {
		if (this.built) return;
		this.built = true;

		const floorMaterial = arenaFloorMaterial();
		this.floorUniforms = floorMaterial.userData.floorUniforms;
		const bg = new THREE.Mesh(
			new THREE.CircleGeometry(this.radius, 128),
			floorMaterial,
		);
		bg.position.set(this.width / 2, this.height / 2, MAP_Z);
		bg.renderOrder = 0;
		bg.userData.castShadow = false;
		bg.userData.receiveShadow = true;
		this.mesh.add(bg);

		const gridMaterial = new THREE.LineBasicMaterial({
			color: THEME.seamMinor,
			transparent: true,
			opacity: 0.5,
			linewidth: 1,
		});
		const gridVerts: number[] = [];
		for (let x = 0; x <= this.width; x += this.gridSize) {
			const halfSpan = Math.sqrt(
				Math.max(0, this.radius ** 2 - (x - this.center.x) ** 2),
			);
			gridVerts.push(
				x,
				this.center.y - halfSpan,
				MAP_Z + MAP_LAYER_STEP,
				x,
				this.center.y + halfSpan,
				MAP_Z + MAP_LAYER_STEP,
			);
		}
		for (let y = 0; y <= this.height; y += this.gridSize) {
			const halfSpan = Math.sqrt(
				Math.max(0, this.radius ** 2 - (y - this.center.y) ** 2),
			);
			gridVerts.push(
				this.center.x - halfSpan,
				y,
				MAP_Z + MAP_LAYER_STEP,
				this.center.x + halfSpan,
				y,
				MAP_Z + MAP_LAYER_STEP,
			);
		}
		const gridGeo = new THREE.BufferGeometry();
		gridGeo.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(gridVerts, 3),
		);
		const grid = new THREE.LineSegments(gridGeo, gridMaterial);
		grid.renderOrder = 1;
		this.mesh.add(grid);

		this.buildMajorGrid();
		this.buildPillars();
		this.buildTorchRing();
		this.buildChains();
		this.buildTraps();

		const borderPoints = Array.from({ length: 128 }, (_, index) => {
			const angle = (index / 128) * Math.PI * 2;
			return new THREE.Vector3(
				this.center.x + Math.cos(angle) * this.radius,
				this.center.y + Math.sin(angle) * this.radius,
				MAP_Z + MAP_LAYER_STEP * 3,
			);
		});
		const border = new THREE.LineLoop(
			new THREE.BufferGeometry().setFromPoints(borderPoints),
			new THREE.LineBasicMaterial({ color: THEME.rimRing, linewidth: 2 }),
		);
		border.renderOrder = 3;
		this.mesh.add(border);
	}

	private buildPillars(): void {
		for (const column of this.columns) {
			const sides = column.coneSides;
			const baseHeight = 12;
			const bodyHeight = column.height * 0.78;
			const capHeight = column.height * 0.22;
			const base = new THREE.CylinderGeometry(
				column.radius * 1.3,
				column.radius * 1.5,
				baseHeight,
				sides,
			);
			base.translate(0, 0, baseHeight / 2);
			const body = new THREE.CylinderGeometry(
				column.radius * 0.9,
				column.radius * 1.15,
				bodyHeight,
				sides,
			);
			body.translate(0, 0, baseHeight + bodyHeight / 2);
			const cap = new THREE.CylinderGeometry(
				column.radius * 0.65,
				column.radius * 0.95,
				capHeight,
				sides,
			);
			cap.translate(0, 0, baseHeight + bodyHeight + capHeight / 2);
			const geometry = mergeGeometries([base, body, cap]);
			base.dispose();
			body.dispose();
			cap.dispose();
			const material = arenaObstacleMaterial();
			const tint = 0.9 + ((((column.x + column.y * 2) % 23) + 23) % 23) / 110;
			material.color.multiplyScalar(tint);
			const pillar = new THREE.Mesh(geometry, material);
			pillar.position.set(column.x, column.y, MAP_Z);
			pillar.renderOrder = 2;
			pillar.userData.obstacle = true;
			this.mesh.add(pillar);
		}
	}

	private buildTorchRing(): void {
		const count = 12;
		const ringRadius = this.radius + 24;
		const flameMaterial = new THREE.MeshBasicMaterial({
			color: THEME.torchFlame,
		});
		const coreMaterial = new THREE.MeshBasicMaterial({
			color: THEME.torchFlameCore,
		});
		for (let i = 0; i < count; i++) {
			const angle = (i / count) * Math.PI * 2;
			const x = this.center.x + Math.cos(angle) * ringRadius;
			const y = this.center.y + Math.sin(angle) * ringRadius;
			const post = new THREE.CylinderGeometry(3.4, 4.6, 26, 6);
			post.translate(0, 0, 13);
			const bowl = new THREE.CylinderGeometry(7.5, 3.6, 9, 6);
			bowl.translate(0, 0, 30.5);
			const staticGeometry = mergeGeometries([post, bowl]);
			post.dispose();
			bowl.dispose();
			const torch = new THREE.Mesh(
				staticGeometry,
				toonMaterial(THEME.torchWood),
			);
			torch.position.set(x, y, MAP_Z);
			torch.renderOrder = 2;
			this.mesh.add(torch);

			const flame = new THREE.Mesh(
				new THREE.ConeGeometry(6, 18, 7),
				flameMaterial,
			);
			flame.position.set(x, y, 44);
			flame.renderOrder = 4;
			this.mesh.add(flame);
			const core = new THREE.Mesh(
				new THREE.ConeGeometry(3, 10, 6),
				coreMaterial,
			);
			core.position.set(x, y, 41);
			core.renderOrder = 4;
			this.mesh.add(core);
			this.flames.push({ flame, core, phase: i * 0.9, x, y });
		}
		for (let i = 0; i < count; i += 2) {
			const angle = (i / count) * Math.PI * 2;
			const light = new THREE.PointLight(THEME.torchLight, 2.2, 170, 1);
			light.position.set(
				this.center.x + Math.cos(angle) * ringRadius,
				this.center.y + Math.sin(angle) * ringRadius,
				48,
			);
			this.mesh.add(light);
		}
		const emberGeometry = new THREE.PlaneGeometry(5, 9);
		const emberMaterial = new THREE.MeshBasicMaterial({
			color: THEME.torchEmber,
			transparent: true,
			opacity: 0.85,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		this.emberMesh = new THREE.InstancedMesh(emberGeometry, emberMaterial, 48);
		this.emberMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.emberMesh.renderOrder = 5;
		for (let i = 0; i < 48; i++) {
			this.emberSeeds.push({
				torch: i % count,
				offset: (i / 48) * Math.PI * 2,
				speed: 0.35 + (i % 7) * 0.06,
				drift: 6 + (i % 5) * 3,
			});
		}
		this.mesh.add(this.emberMesh);
	}

	private buildChains(): void {
		const count = 12;
		const ringRadius = this.radius + 24;
		const postTop = 30;
		const linkGeometries: THREE.BufferGeometry[] = [];
		for (let i = 0; i < count; i++) {
			const startAngle = (i / count) * Math.PI * 2;
			const endAngle = ((i + 1) / count) * Math.PI * 2;
			const links = 6;
			for (let l = 0; l < links; l++) {
				const t = (l + 0.5) / links;
				const angle = startAngle + (endAngle - startAngle) * t;
				const sag = Math.sin(Math.PI * t) * 14;
				const x = this.center.x + Math.cos(angle) * ringRadius;
				const y = this.center.y + Math.sin(angle) * ringRadius;
				const z = postTop - sag;
				const link = new THREE.BoxGeometry(7, 7, 11);
				link.applyMatrix4(
					new THREE.Matrix4().makeRotationZ(angle + Math.PI / 2),
				);
				link.translate(x, y, z);
				linkGeometries.push(link);
			}
		}
		const chainGeometry = mergeGeometries(linkGeometries);
		linkGeometries.forEach((geometry) => geometry.dispose());
		const chain = new THREE.Mesh(chainGeometry, toonMaterial(THEME.chainIron));
		chain.renderOrder = 2;
		this.mesh.add(chain);
	}

	private buildTraps(): void {
		const spikeMaterial = toonMaterial(THEME.trapStone);
		const spikePits = [
			{ angle: (25 * Math.PI) / 180, distance: 230 },
			{ angle: (205 * Math.PI) / 180, distance: 260 },
		];
		for (const pit of spikePits) {
			const x = this.center.x + Math.cos(pit.angle) * pit.distance;
			const y = this.center.y + Math.sin(pit.angle) * pit.distance;
			const geometries: THREE.BufferGeometry[] = [];
			const ring = new THREE.TorusGeometry(34, 6, 5, 18);
			ring.rotateX(Math.PI / 2);
			ring.translate(x, y, MAP_Z + 2);
			geometries.push(ring);
			for (let i = 0; i < 8; i++) {
				const a = (i / 8) * Math.PI * 2;
				const spike = new THREE.ConeGeometry(4.5, 24 + (i % 3) * 5, 5);
				spike.translate(x + Math.cos(a) * 20, y + Math.sin(a) * 20, MAP_Z + 12);
				geometries.push(spike);
			}
			const pitGeometry = mergeGeometries(geometries);
			geometries.forEach((geometry) => geometry.dispose());
			const mesh = new THREE.Mesh(pitGeometry, spikeMaterial);
			mesh.renderOrder = 2;
			mesh.userData.decorative = true;
			this.mesh.add(mesh);
		}
		const bladeAngle = (330 * Math.PI) / 180;
		const bladeX = this.center.x + Math.cos(bladeAngle) * 380;
		const bladeY = this.center.y + Math.sin(bladeAngle) * 380;
		const post = new THREE.CylinderGeometry(4, 5.5, 108, 6);
		post.translate(0, 0, 54);
		const postMesh = new THREE.Mesh(post, toonMaterial(THEME.torchWood));
		postMesh.position.set(bladeX, bladeY, MAP_Z);
		postMesh.renderOrder = 2;
		postMesh.userData.decorative = true;
		this.mesh.add(postMesh);
		this.bladePivot = new THREE.Group();
		this.bladePivot.position.set(bladeX, bladeY, MAP_Z + 108);
		const blade = new THREE.BoxGeometry(8, 7, 64);
		blade.translate(34, 0, 0);
		const bladeMesh = new THREE.Mesh(blade, toonMaterial(THEME.chainIron));
		bladeMesh.renderOrder = 3;
		bladeMesh.userData.decorative = true;
		this.bladePivot.add(bladeMesh);
		this.mesh.add(this.bladePivot);
	}

	private buildMajorGrid(): void {
		const majorGridMaterial = new THREE.LineBasicMaterial({
			color: THEME.seamMajor,
			transparent: true,
			opacity: 0.55,
		});
		const vertices: number[] = [];
		for (let x = 0; x <= this.width; x += this.gridSize * 5) {
			const halfSpan = Math.sqrt(
				Math.max(0, this.radius ** 2 - (x - this.center.x) ** 2),
			);
			vertices.push(
				x,
				this.center.y - halfSpan,
				MAP_Z + MAP_LAYER_STEP * 1.5,
				x,
				this.center.y + halfSpan,
				MAP_Z + MAP_LAYER_STEP * 1.5,
			);
		}
		for (let y = 0; y <= this.height; y += this.gridSize * 5) {
			const halfSpan = Math.sqrt(
				Math.max(0, this.radius ** 2 - (y - this.center.y) ** 2),
			);
			vertices.push(
				this.center.x - halfSpan,
				y,
				MAP_Z + MAP_LAYER_STEP * 1.5,
				this.center.x + halfSpan,
				y,
				MAP_Z + MAP_LAYER_STEP * 1.5,
			);
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(vertices, 3),
		);
		const lines = new THREE.LineSegments(geometry, majorGridMaterial);
		lines.renderOrder = 1.1;
		this.mesh.add(lines);
	}
}
