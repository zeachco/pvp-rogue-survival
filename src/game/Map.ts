import * as THREE from "three";
import { type RandomSource, systemRandom } from "../../common/random";
import { MAP_LAYER_STEP, MAP_Z } from "./render/ThreeRenderer";
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

export function arenaObstacleMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0x173c45,
		roughness: 0.55,
		metalness: 0.35,
	});
}

export function arenaFloorMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0x0b1116,
		roughness: 0.9,
		metalness: 0.08,
	});
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

	constructor(random: RandomSource = systemRandom) {
		this.columns = generateArenaColumns(this.width, this.height, 15, random);
	}

	get center(): { x: number; y: number } {
		return { x: this.width / 2, y: this.height / 2 };
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

		const bg = new THREE.Mesh(
			new THREE.CircleGeometry(this.radius, 128),
			arenaFloorMaterial(),
		);
		bg.position.set(this.width / 2, this.height / 2, MAP_Z);
		bg.renderOrder = 0;
		bg.userData.castShadow = false;
		bg.userData.receiveShadow = true;
		this.mesh.add(bg);

		const gridMaterial = new THREE.LineBasicMaterial({
			color: 0x16333a,
			transparent: true,
			opacity: 0.72,
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
		this.buildColumns();

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
			new THREE.LineBasicMaterial({ color: 0x3affd4, linewidth: 2 }),
		);
		border.renderOrder = 3;
		this.mesh.add(border);
	}

	private buildColumns(): void {
		for (const column of this.columns) {
			const geometry = new THREE.ConeGeometry(
				column.radius,
				column.height,
				column.coneSides,
			);
			const body = new THREE.Mesh(geometry, arenaObstacleMaterial());
			body.rotation.x = Math.PI / 2;
			body.position.set(column.x, column.y, column.height / 2);
			this.mesh.add(body);
		}
	}

	private buildMajorGrid(): void {
		const majorGridMaterial = new THREE.LineBasicMaterial({
			color: 0x227d86,
			transparent: true,
			opacity: 0.6,
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
