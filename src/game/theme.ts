import * as THREE from "three";

export const THEME = {
	clearColor: 0x0a0908,
	fogDensity: 0.00045,
	ambientLight: 0x8a93a8,
	keyLight: 0xffd9a8,

	floorStone: 0x4a4238,
	floorMortar: 0x171310,
	floorEmber: 0x1a120a,
	seamMinor: 0x1c1712,
	seamMajor: 0x2a2119,
	rimRing: 0x241d16,
	pillarStone: 0x57504a,
	trapStone: 0x4a443c,
	chainIron: 0x3a3a40,
	torchWood: 0x2e2620,
	torchFlame: 0xffa03c,
	torchFlameCore: 0xffd9a0,
	torchEmber: 0xff7a2d,
	torchLight: 0xff9a3c,

	heroBody: 0xd8c9a8,
	heroAccent: 0xffb454,
	heroLight: 0xffe8c2,
	outline: 0x14100c,

	creepBody: 0xc74b52,
	creepStroke: 0x2a1216,
	championBody: 0xe8a84c,
	bossBody: 0xb03038,
	cloneBody: 0x9a6fd0,
	roleLightChampion: 0xffc06a,
	roleLightBoss: 0xff3348,
	roleLightClone: 0xb98cff,
	bubbleEye: 0xcfe8ff,
} as const;

let gradientMap: THREE.DataTexture | undefined;

export function toonGradientMap(): THREE.DataTexture {
	if (!gradientMap) {
		const steps = [0.4, 0.65, 0.85, 1];
		const data = new Uint8Array(steps.length * 4);
		for (let i = 0; i < steps.length; i++) {
			const value = Math.round(steps[i] * 255);
			data[i * 4] = value;
			data[i * 4 + 1] = value;
			data[i * 4 + 2] = value;
			data[i * 4 + 3] = 255;
		}
		const texture = new THREE.DataTexture(
			data,
			steps.length,
			1,
			THREE.RGBAFormat,
		);
		texture.magFilter = THREE.NearestFilter;
		texture.minFilter = THREE.NearestFilter;
		texture.generateMipmaps = false;
		texture.needsUpdate = true;
		gradientMap = texture;
	}
	return gradientMap;
}

export function toonMaterial(
	color: number,
	options: {
		emissive?: number;
		emissiveIntensity?: number;
		transparent?: boolean;
		opacity?: number;
		side?: THREE.Side;
	} = {},
): THREE.MeshToonMaterial {
	return new THREE.MeshToonMaterial({
		color,
		emissive: options.emissive ?? 0x000000,
		emissiveIntensity: options.emissiveIntensity ?? 1,
		transparent: options.transparent ?? false,
		opacity: options.opacity ?? 1,
		side: options.side ?? THREE.FrontSide,
		gradientMap: toonGradientMap(),
	});
}
