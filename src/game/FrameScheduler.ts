export const BACKGROUND_FRAME_INTERVAL_MS = 1_000;
export const ANIMATION_FRAME_STALE_MS = 750;

export function backgroundFrameDue(
	now: number,
	lastAnimationFrameAt: number,
): boolean {
	return now - lastAnimationFrameAt >= ANIMATION_FRAME_STALE_MS;
}
