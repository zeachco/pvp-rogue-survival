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

export function tryRequestPointerLock(
	element: Pick<Element, "requestPointerLock">,
): void {
	try {
		void Promise.resolve(element.requestPointerLock()).catch(() => {
			// Pointer capture remains the fallback when locking is denied.
		});
	} catch {
		// Pointer capture remains the fallback when locking fails synchronously.
	}
}
