export type LightingMode = "off" | "hero" | "all";
export type ShadowMode = "off" | "dynamic";
export type FullscreenMode = "on" | "off";

export const FULLSCREEN_MODE_STORAGE_KEY =
	"multi-line-tower.game.fullscreen-on-start";
export const RESOLUTION_SCALE_STORAGE_KEY =
	"multi-line-tower.graphics.resolution-scale";
export const LIGHTING_MODE_STORAGE_KEY = "multi-line-tower.graphics.lighting";
export const SHADOW_MODE_STORAGE_KEY = "multi-line-tower.graphics.shadows";
export const MIN_RESOLUTION_SCALE = 0.2;
export const MAX_RESOLUTION_SCALE = 1;
export const RESOLUTION_SCALE_STEP = 0.1;

export const DEFAULT_GRAPHICS_SETTINGS = {
	fullscreenMode: "on",
	resolutionScale: 1,
	lightingMode: "all",
	shadowMode: "off",
} as const satisfies {
	fullscreenMode: FullscreenMode;
	resolutionScale: number;
	lightingMode: LightingMode;
	shadowMode: ShadowMode;
};

type GraphicsStorage = Pick<Storage, "getItem" | "setItem">;

export function loadFullscreenMode(storage: GraphicsStorage): FullscreenMode {
	try {
		if (storage.getItem(FULLSCREEN_MODE_STORAGE_KEY) === "off") return "off";
	} catch {}
	return DEFAULT_GRAPHICS_SETTINGS.fullscreenMode;
}

export function saveFullscreenMode(
	storage: GraphicsStorage,
	mode: FullscreenMode,
): void {
	try {
		storage.setItem(FULLSCREEN_MODE_STORAGE_KEY, mode);
	} catch {}
}

export function loadResolutionScale(storage: GraphicsStorage): number {
	try {
		const saved = Number(storage.getItem(RESOLUTION_SCALE_STORAGE_KEY));
		if (saved >= MIN_RESOLUTION_SCALE && saved <= MAX_RESOLUTION_SCALE)
			return saved;
	} catch {}
	return DEFAULT_GRAPHICS_SETTINGS.resolutionScale;
}

export function saveResolutionScale(
	storage: GraphicsStorage,
	scale: number,
): void {
	try {
		storage.setItem(RESOLUTION_SCALE_STORAGE_KEY, String(scale));
	} catch {}
}

export function loadLightingMode(storage: GraphicsStorage): LightingMode {
	try {
		const saved = storage.getItem(LIGHTING_MODE_STORAGE_KEY);
		if (saved === "off" || saved === "hero" || saved === "all") return saved;
	} catch {}
	return DEFAULT_GRAPHICS_SETTINGS.lightingMode;
}

export function saveLightingMode(
	storage: GraphicsStorage,
	mode: LightingMode,
): void {
	try {
		storage.setItem(LIGHTING_MODE_STORAGE_KEY, mode);
	} catch {}
}

export function loadShadowMode(storage: GraphicsStorage): ShadowMode {
	try {
		if (storage.getItem(SHADOW_MODE_STORAGE_KEY) === "dynamic")
			return "dynamic";
	} catch {}
	return DEFAULT_GRAPHICS_SETTINGS.shadowMode;
}

export function saveShadowMode(
	storage: GraphicsStorage,
	mode: ShadowMode,
): void {
	try {
		storage.setItem(SHADOW_MODE_STORAGE_KEY, mode);
	} catch {}
}
