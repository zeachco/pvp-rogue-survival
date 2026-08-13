import type { Vector2 } from "./types";

export const GAMEPAD_STICK_DEAD_ZONE = 0.18;
export const GAMEPAD_ORBIT_PIXELS_PER_SECOND = 240;

const SPELL_BUTTONS = [0, 1, 2, 3, 4, 5] as const;

export interface StandardGamepadLike {
	connected: boolean;
	mapping: string;
	axes: ArrayLike<number>;
	buttons: ArrayLike<{ pressed: boolean }>;
}

export interface GamepadInput {
	movement: Vector2;
	orbit: Vector2;
	pressedSpellSlots: number[];
	heldButtons: Set<number>;
}

export function applyStickDeadZone(
	x: number,
	y: number,
	deadZone = GAMEPAD_STICK_DEAD_ZONE,
): Vector2 {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
	const rawMagnitude = Math.hypot(x, y);
	if (rawMagnitude <= deadZone) return { x: 0, y: 0 };
	const magnitude = Math.min(1, rawMagnitude);
	const scaledMagnitude = (magnitude - deadZone) / (1 - deadZone);
	return {
		x: (x / rawMagnitude) * scaledMagnitude,
		y: (y / rawMagnitude) * scaledMagnitude,
	};
}

export function readStandardGamepad(
	gamepads: ArrayLike<StandardGamepadLike | null>,
	previousButtons: ReadonlySet<number>,
): GamepadInput {
	let gamepad: StandardGamepadLike | undefined;
	for (let index = 0; index < gamepads.length; index += 1) {
		const candidate = gamepads[index];
		if (candidate?.connected && candidate.mapping === "standard") {
			gamepad = candidate;
			break;
		}
	}
	if (!gamepad)
		return {
			movement: { x: 0, y: 0 },
			orbit: { x: 0, y: 0 },
			pressedSpellSlots: [],
			heldButtons: new Set(),
		};

	const movement = applyStickDeadZone(
		gamepad.axes[0] ?? 0,
		gamepad.axes[1] ?? 0,
	);
	const orbit = applyStickDeadZone(gamepad.axes[2] ?? 0, gamepad.axes[3] ?? 0);
	const heldButtons = new Set<number>();
	const pressedSpellSlots: number[] = [];
	for (const [slot, button] of SPELL_BUTTONS.entries()) {
		if (!gamepad.buttons[button]?.pressed) continue;
		heldButtons.add(button);
		if (!previousButtons.has(button)) pressedSpellSlots.push(slot);
	}
	return {
		movement: { x: movement.x, y: -movement.y },
		orbit,
		pressedSpellSlots,
		heldButtons,
	};
}
