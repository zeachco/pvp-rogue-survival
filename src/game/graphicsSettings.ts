export type LightingMode = "off" | "hero" | "all";

export const LIGHTING_MODE_STORAGE_KEY = "multi-line-tower.graphics.lighting";

export const DEFAULT_GRAPHICS_SETTINGS = {
	lightingMode: "all",
} as const satisfies { lightingMode: LightingMode };

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
