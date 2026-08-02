import * as THREE from "three";
import { canvas2dContext } from "../platform/Canvas";
import { MAP_LAYER_STEP, MAP_Z } from "./render/ThreeRenderer";

export class GameMap {
	readonly width = 1600;
	readonly height = 1000;
	readonly gridSize = 50;
	readonly mesh = new THREE.Group();
	private built = false;

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

		const gridMaterial = new THREE.LineBasicMaterial({
			color: 0x16333a,
			transparent: true,
			opacity: 0.72,
			linewidth: 1,
		});
		const gridVerts: number[] = [];
		for (let x = 0; x <= this.width; x += this.gridSize) {
			gridVerts.push(
				x,
				0,
				MAP_Z + MAP_LAYER_STEP,
				x,
				this.height,
				MAP_Z + MAP_LAYER_STEP,
			);
		}
		for (let y = 0; y <= this.height; y += this.gridSize) {
			gridVerts.push(
				0,
				y,
				MAP_Z + MAP_LAYER_STEP,
				this.width,
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
		glowMesh.position.set(
			this.width / 2,
			this.height / 2,
			MAP_Z + MAP_LAYER_STEP * 2,
		);
		glowMesh.renderOrder = 2;
		this.mesh.add(glowMesh);

		const borderVerts = new Float32Array([
			0,
			0,
			MAP_Z + MAP_LAYER_STEP * 3,
			this.width,
			0,
			MAP_Z + MAP_LAYER_STEP * 3,
			this.width,
			this.height,
			MAP_Z + MAP_LAYER_STEP * 3,
			0,
			this.height,
			MAP_Z + MAP_LAYER_STEP * 3,
			0,
			0,
			MAP_Z + MAP_LAYER_STEP * 3,
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
	}

	private buildMajorGrid(): void {
		const majorGridMaterial = new THREE.LineBasicMaterial({
			color: 0x227d86,
			transparent: true,
			opacity: 0.6,
		});
		const vertices: number[] = [];
		for (let x = 0; x <= this.width; x += this.gridSize * 5)
			vertices.push(
				x,
				0,
				MAP_Z + MAP_LAYER_STEP * 1.5,
				x,
				this.height,
				MAP_Z + MAP_LAYER_STEP * 1.5,
			);
		for (let y = 0; y <= this.height; y += this.gridSize * 5)
			vertices.push(
				0,
				y,
				MAP_Z + MAP_LAYER_STEP * 1.5,
				this.width,
				y,
				MAP_Z + MAP_LAYER_STEP * 1.5,
			);
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
