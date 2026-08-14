const EXPECTED_POINTER_CAPTURE_ERRORS = new Set([
	"InvalidStateError",
	"NotFoundError",
]);

export function trySetPointerCapture(
	element: Pick<Element, "setPointerCapture">,
	pointerId: number,
): boolean {
	try {
		element.setPointerCapture(pointerId);
		return true;
	} catch (error) {
		if (
			error instanceof DOMException &&
			EXPECTED_POINTER_CAPTURE_ERRORS.has(error.name)
		)
			return false;
		throw error;
	}
}
