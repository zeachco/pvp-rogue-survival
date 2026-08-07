export type LightingMode = "off" | "hero" | "all";
export type ShadowMode = "off" | "dynamic";

export const LIGHTING_MODE_STORAGE_KEY = "multi-line-tower.graphics.lighting";
export const SHADOW_MODE_STORAGE_KEY = "multi-line-tower.graphics.shadows";

export const DEFAULT_GRAPHICS_SETTINGS = {
	lightingMode: "all",
	shadowMode: "off",
} as const satisfies { lightingMode: LightingMode; shadowMode: ShadowMode };

type GraphicsStorage = Pick<Storage, "getItem" | "setItem">;

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
