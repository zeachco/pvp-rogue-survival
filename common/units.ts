export const LOGICAL_PIXELS_PER_METER = 50;

export function pixelsToMeters(pixels: number): number {
	return pixels / LOGICAL_PIXELS_PER_METER;
}

export function metersToPixels(meters: number): number {
	return meters * LOGICAL_PIXELS_PER_METER;
}
