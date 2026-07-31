export function canvas2dContext(
	canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
	const context = canvas.getContext("2d");
	if (!context) throw new Error("2D canvas rendering is unavailable.");
	return context;
}
