import { describe, expect, test } from "bun:test";
import {
	tryRequestPointerLock,
	trySetPointerCapture,
} from "../src/platform/PointerCapture";

describe("tryRequestPointerLock", () => {
	test("supports a Firefox-style void return", () => {
		let requestCount = 0;
		const element = {
			requestPointerLock() {
				requestCount += 1;
			},
		};

		expect(() => tryRequestPointerLock(element)).not.toThrow();
		expect(requestCount).toBe(1);
	});

	test("supports a successful Promise return", async () => {
		let requestCount = 0;
		const element = {
			requestPointerLock() {
				requestCount += 1;
				return Promise.resolve();
			},
		};

		tryRequestPointerLock(element);
		await Promise.resolve();
		expect(requestCount).toBe(1);
	});

	test("absorbs asynchronous rejection so pointer capture remains usable", async () => {
		let requestCount = 0;
		let capturedPointerId: number | undefined;
		const element = {
			requestPointerLock() {
				requestCount += 1;
				return Promise.reject(new DOMException("Denied", "NotAllowedError"));
			},
			setPointerCapture(pointerId: number) {
				capturedPointerId = pointerId;
			},
		};

		tryRequestPointerLock(element);
		expect(trySetPointerCapture(element, 17)).toBe(true);
		await Promise.resolve();
		expect(requestCount).toBe(1);
		expect(capturedPointerId).toBe(17);
	});

	test("absorbs synchronous failure so pointer capture remains usable", () => {
		let requestCount = 0;
		let capturedPointerId: number | undefined;
		const element = {
			requestPointerLock(): Promise<void> {
				requestCount += 1;
				throw new DOMException("Denied", "NotAllowedError");
			},
			setPointerCapture(pointerId: number) {
				capturedPointerId = pointerId;
			},
		};

		expect(() => tryRequestPointerLock(element)).not.toThrow();
		expect(trySetPointerCapture(element, 17)).toBe(true);
		expect(requestCount).toBe(1);
		expect(capturedPointerId).toBe(17);
	});
});

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
