export type LightingMode = "off" | "hero" | "all";

export const DEFAULT_GRAPHICS_SETTINGS = {
	lightingMode: "off",
} as const satisfies { lightingMode: LightingMode };
