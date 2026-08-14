import { describe, expect, test } from "bun:test";
import { trySetPointerCapture } from "../src/platform/PointerCapture";

describe("trySetPointerCapture", () => {
	test("captures an active pointer", () => {
		let capturedPointerId: number | undefined;
		const element = {
			setPointerCapture(pointerId: number) {
				capturedPointerId = pointerId;
			},
		};

		expect(trySetPointerCapture(element, 17)).toBe(true);
		expect(capturedPointerId).toBe(17);
	});

	for (const errorName of ["InvalidStateError", "NotFoundError"]) {
		test(`ignores ${errorName} when capture is unavailable`, () => {
			const element = {
				setPointerCapture() {
					throw new DOMException("Pointer capture is unavailable", errorName);
				},
			};

			expect(trySetPointerCapture(element, 17)).toBe(false);
		});
	}

	test("does not hide unexpected failures", () => {
		const failure = new Error("unexpected failure");
		const element = {
			setPointerCapture() {
				throw failure;
			},
		};

		expect(() => trySetPointerCapture(element, 17)).toThrow(failure);
	});
});
