import * as THREE from "three";

function hash2(x: number, y: number): number {
	const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
	return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const ux = fx * fx * (3 - 2 * fx);
	const uy = fy * fy * (3 - 2 * fy);
	const a = hash2(ix, iy);
	const b = hash2(ix + 1, iy);
	const c = hash2(ix, iy + 1);
	const d = hash2(ix + 1, iy + 1);
	return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
	let value = 0;
	let amplitude = 0.5;
	for (let octave = 0; octave < 4; octave++) {
		value += amplitude * valueNoise(x, y);
		x *= 2.02;
		y *= 1.98;
		amplitude *= 0.5;
	}
	return value;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

type Rgb = { r: number; g: number; b: number };

function mix(a: Rgb, b: Rgb, t: number): Rgb {
	return {
		r: a.r + (b.r - a.r) * t,
		g: a.g + (b.g - a.g) * t,
		b: a.b + (b.b - a.b) * t,
	};
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

const STONE: Rgb = { r: 0.29, g: 0.26, b: 0.22 };
const STONE_DARK: Rgb = { r: 0.17, g: 0.15, b: 0.125 };
const STONE_WARM: Rgb = { r: 0.34, g: 0.29, b: 0.22 };
const MORTAR: Rgb = { r: 0.09, g: 0.075, b: 0.062 };
const EMBER: Rgb = { r: 0.32, g: 0.2, b: 0.09 };
const FLOOR_VIGNETTE: Rgb = { r: 0.045, g: 0.038, b: 0.03 };

export function createArenaFloorTexture(size = 1024): {
	texture: THREE.DataTexture;
	dispose: () => void;
} {
	const data = new Uint8Array(size * size * 4);
	const tiles = 10;
	const tile = size / tiles;

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const u = x / size;
			const v = y / size;
			const radius = Math.hypot(u - 0.5, v - 0.5) * 2;

			const tx = Math.floor(u * tiles);
			const ty = Math.floor(v * tiles);
			const stone = hash2(tx * 7.31, ty * 9.17);
			const grain = fbm(u * 22, v * 22);
			const mottle = fbm(u * 7 + 13.7, v * 7 + 5.3);

			let color = mix(STONE_DARK, STONE, stone * 0.85);
			color = mix(color, STONE_WARM, mottle * 0.35);
			color = mix(color, STONE_DARK, (grain - 0.5) * 0.5);

			const localX = (x - tx * tile) / tile;
			const localY = (y - ty * tile) / tile;
			const edge = Math.min(
				Math.min(localX, 1 - localX),
				Math.min(localY, 1 - localY),
			);
			const seam = 1 - smoothstep(0.012, 0.045, edge);
			color = mix(color, MORTAR, seam * 0.92);
			const crack =
				Math.abs(fbm(u * 3.1 + 31, v * 3.1 + 17) - 0.5) < 0.012 ? 0.35 : 0;
			color = mix(color, MORTAR, crack * (1 - seam) * 0.8);

			const emberGlow = smoothstep(0.92, 0.35, radius) * 0.55;
			color = mix(color, EMBER, emberGlow * (0.35 + 0.65 * mottle));
			color = mix(color, FLOOR_VIGNETTE, smoothstep(0.78, 1.02, radius));

			const index = (y * size + x) * 4;
			data[index] = Math.round(clamp01(color.r) * 255);
			data[index + 1] = Math.round(clamp01(color.g) * 255);
			data[index + 2] = Math.round(clamp01(color.b) * 255);
			data[index + 3] = 255;
		}
	}

	const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	texture.flipY = true;
	texture.needsUpdate = true;

	return {
		texture,
		dispose: () => {
			texture.dispose();
		},
	};
}
