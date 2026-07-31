import * as THREE from "three";
import { canvas2dContext } from "../platform/Canvas";
import { MAP_Z } from "./render/ThreeRenderer";

export class GameMap {
	readonly width = 1600;
	readonly height = 1000;
	readonly gridSize = 50;
	readonly mesh = new THREE.Group();
	private built = false;
	private gridMaterial?: THREE.LineBasicMaterial;
	private majorGridMaterial?: THREE.LineBasicMaterial;
	private readonly scanBands: Array<{
		mesh: THREE.Mesh;
		axis: "x" | "y";
		speed: number;
		phase: number;
	}> = [];
	private readonly laneLights: Array<{
		mesh: THREE.Mesh;
		axis: "x" | "y";
		lane: number;
		speed: number;
		phase: number;
	}> = [];
	private readonly borderLights: Array<{
		mesh: THREE.Mesh;
		speed: number;
		phase: number;
	}> = [];

	get center(): { x: number; y: number } {
		return { x: this.width / 2, y: this.height / 2 };
	}

	randomEdgeSpawn(random: { next(): number } = { next: () => Math.random() }): {
		x: number;
		y: number;
	} {
		const margin = 24;
		const edge = Math.floor(random.next() * 4);
		if (edge === 0) return { x: random.next() * this.width, y: -margin };
		if (edge === 1)
			return { x: this.width + margin, y: random.next() * this.height };
		if (edge === 2)
			return { x: random.next() * this.width, y: this.height + margin };
		return { x: -margin, y: random.next() * this.height };
	}

	buildMeshes(): void {
		if (this.built) return;
		this.built = true;

		const bg = new THREE.Mesh(
			new THREE.PlaneGeometry(this.width, this.height),
			new THREE.MeshBasicMaterial({ color: 0x0b1116 }),
		);
		bg.position.set(this.width / 2, this.height / 2, MAP_Z);
		bg.renderOrder = 0;
		this.mesh.add(bg);

		this.gridMaterial = new THREE.LineBasicMaterial({
			color: 0x16333a,
			transparent: true,
			opacity: 0.72,
			linewidth: 1,
		});
		const gridVerts: number[] = [];
		for (let x = 0; x <= this.width; x += this.gridSize) {
			gridVerts.push(x, 0, MAP_Z + 0.01, x, this.height, MAP_Z + 0.01);
		}
		for (let y = 0; y <= this.height; y += this.gridSize) {
			gridVerts.push(0, y, MAP_Z + 0.01, this.width, y, MAP_Z + 0.01);
		}
		const gridGeo = new THREE.BufferGeometry();
		gridGeo.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(gridVerts, 3),
		);
		const grid = new THREE.LineSegments(gridGeo, this.gridMaterial);
		grid.renderOrder = 1;
		this.mesh.add(grid);

		this.buildMajorGrid();

		const glowCanvas = document.createElement("canvas");
		glowCanvas.width = 512;
		glowCanvas.height = 512;
		const gctx = canvas2dContext(glowCanvas);
		const glow = gctx.createRadialGradient(256, 256, 10, 256, 256, 256);
		glow.addColorStop(0, "rgba(40,255,205,.07)");
		glow.addColorStop(1, "rgba(40,255,205,0)");
		gctx.fillStyle = glow;
		gctx.fillRect(0, 0, 512, 512);
		const glowTex = new THREE.CanvasTexture(glowCanvas);
		const glowMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(this.width, this.height),
			new THREE.MeshBasicMaterial({
				map: glowTex,
				transparent: true,
				depthWrite: false,
			}),
		);
		glowMesh.position.set(this.width / 2, this.height / 2, MAP_Z + 0.02);
		glowMesh.renderOrder = 2;
		this.mesh.add(glowMesh);

		const borderVerts = new Float32Array([
			0,
			0,
			MAP_Z + 0.03,
			this.width,
			0,
			MAP_Z + 0.03,
			this.width,
			this.height,
			MAP_Z + 0.03,
			0,
			this.height,
			MAP_Z + 0.03,
			0,
			0,
			MAP_Z + 0.03,
		]);
		const borderGeo = new THREE.BufferGeometry();
		borderGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(borderVerts, 3),
		);
		const border = new THREE.Line(
			borderGeo,
			new THREE.LineBasicMaterial({ color: 0x3affd4, linewidth: 2 }),
		);
		border.renderOrder = 3;
		this.mesh.add(border);

		this.buildScanBands();
		this.buildLaneLights();
		this.buildBorderLights();
	}

	updateVisuals(time: number): void {
		if (this.gridMaterial)
			this.gridMaterial.opacity = 0.58 + Math.sin(time * 0.7) * 0.1;
		if (this.majorGridMaterial)
			this.majorGridMaterial.opacity =
				0.55 + Math.sin(time * 0.42 + 1.2) * 0.12;

		for (const band of this.scanBands) {
			const span = band.axis === "x" ? this.width : this.height;
			const position = wrapped(time * band.speed + band.phase, span);
			if (band.axis === "x") band.mesh.position.x = position;
			else band.mesh.position.y = position;
			(band.mesh.material as THREE.MeshBasicMaterial).opacity =
				0.035 + 0.018 * Math.sin(time * 1.6 + band.phase);
		}

		for (const light of this.laneLights) {
			const span = light.axis === "x" ? this.width : this.height;
			const position = wrapped(time * light.speed + light.phase, span);
			if (light.axis === "x")
				light.mesh.position.set(position, light.lane, MAP_Z + 0.055);
			else light.mesh.position.set(light.lane, position, MAP_Z + 0.055);
			const pulse = 0.68 + Math.sin(time * 3.2 + light.phase) * 0.22;
			(light.mesh.material as THREE.MeshBasicMaterial).opacity = pulse;
		}

		const perimeter = 2 * (this.width + this.height);
		for (const light of this.borderLights) {
			const distance = wrapped(time * light.speed + light.phase, perimeter);
			const point = perimeterPoint(distance, this.width, this.height);
			light.mesh.position.set(point.x, point.y, MAP_Z + 0.07);
		}
	}

	private buildMajorGrid(): void {
		this.majorGridMaterial = new THREE.LineBasicMaterial({
			color: 0x227d86,
			transparent: true,
			opacity: 0.6,
		});
		const vertices: number[] = [];
		for (let x = 0; x <= this.width; x += this.gridSize * 5)
			vertices.push(x, 0, MAP_Z + 0.018, x, this.height, MAP_Z + 0.018);
		for (let y = 0; y <= this.height; y += this.gridSize * 5)
			vertices.push(0, y, MAP_Z + 0.018, this.width, y, MAP_Z + 0.018);
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(vertices, 3),
		);
		const lines = new THREE.LineSegments(geometry, this.majorGridMaterial);
		lines.renderOrder = 1.1;
		this.mesh.add(lines);
	}

	private buildScanBands(): void {
		const definitions = [
			{ axis: "x" as const, speed: 55, phase: 140 },
			{ axis: "y" as const, speed: 38, phase: 620 },
		];
		for (const definition of definitions) {
			const geometry =
				definition.axis === "x"
					? new THREE.PlaneGeometry(90, this.height)
					: new THREE.PlaneGeometry(this.width, 70);
			const mesh = new THREE.Mesh(
				geometry,
				new THREE.MeshBasicMaterial({
					color: 0x29ffe2,
					transparent: true,
					opacity: 0.04,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
				}),
			);
			mesh.position.set(this.width / 2, this.height / 2, MAP_Z + 0.04);
			mesh.renderOrder = 2.2;
			this.mesh.add(mesh);
			this.scanBands.push({ mesh, ...definition });
		}
	}

	private buildLaneLights(): void {
		for (let index = 0; index < 18; index += 1) {
			const axis = index % 2 === 0 ? "x" : "y";
			const mesh = new THREE.Mesh(
				new THREE.CircleGeometry(index % 3 === 0 ? 4 : 2.5, 10),
				new THREE.MeshBasicMaterial({
					color: index % 4 === 0 ? 0x8c7cff : 0x3affd4,
					transparent: true,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
				}),
			);
			mesh.renderOrder = 2.5;
			this.mesh.add(mesh);
			this.laneLights.push({
				mesh,
				axis,
				lane:
					((index * 7) %
						(axis === "x"
							? this.height / this.gridSize
							: this.width / this.gridSize)) *
					this.gridSize,
				speed: 46 + (index % 5) * 17,
				phase: index * 113,
			});
		}
	}

	private buildBorderLights(): void {
		for (let index = 0; index < 8; index += 1) {
			const mesh = new THREE.Mesh(
				new THREE.CircleGeometry(4, 12),
				new THREE.MeshBasicMaterial({
					color: index % 2 ? 0x3affd4 : 0x45a9ff,
					transparent: true,
					opacity: 0.9,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
				}),
			);
			mesh.renderOrder = 3.1;
			this.mesh.add(mesh);
			this.borderLights.push({
				mesh,
				speed: 85 + index * 6,
				phase: index * 620,
			});
		}
	}
}

export function wrapped(value: number, span: number): number {
	return ((value % span) + span) % span;
}

export function perimeterPoint(
	distance: number,
	width: number,
	height: number,
): { x: number; y: number } {
	const perimeter = 2 * (width + height);
	let offset = wrapped(distance, perimeter);
	if (offset <= width) return { x: offset, y: 0 };
	offset -= width;
	if (offset <= height) return { x: width, y: offset };
	offset -= height;
	if (offset <= width) return { x: width - offset, y: height };
	return { x: 0, y: height - (offset - width) };
}
