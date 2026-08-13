import { describe, expect, test } from "bun:test";
import { GameAudio, type GameSound } from "../src/game/GameAudio";

class FakeAudioParam {
	readonly values: number[] = [];
	setValueAtTime(value: number): void {
		this.values.push(value);
	}
	exponentialRampToValueAtTime(): void {}
}

class FakeNode {
	connect(): void {}
}

class FakeGain extends FakeNode {
	readonly gain = Object.assign(new FakeAudioParam(), { value: 0 });
}

class FakeOscillator extends FakeNode {
	type: OscillatorType = "sine";
	readonly frequency = new FakeAudioParam();
	start(): void {}
	stop(): void {}
}

class FakeAudioContext {
	state: AudioContextState = "running";
	currentTime = 1;
	readonly destination = new FakeNode();
	oscillatorCount = 0;
	readonly gains: FakeGain[] = [];
	createGain(): GainNode {
		const gain = new FakeGain();
		this.gains.push(gain);
		return gain as unknown as GainNode;
	}
	createOscillator(): OscillatorNode {
		this.oscillatorCount += 1;
		return new FakeOscillator() as unknown as OscillatorNode;
	}
	async resume(): Promise<void> {
		this.state = "running";
	}
}

describe("GameAudio", () => {
	test("synthesizes every authored combat cue", () => {
		const context = new FakeAudioContext();
		const audio = new GameAudio(() => context as unknown as AudioContext);
		const sounds: GameSound[] = ["spell", "attack", "goldDrop", "creepDeath"];
		for (const sound of sounds) audio.play(sound);
		expect(context.oscillatorCount).toBe(7);
	});

	test("schedules one battle phrase at a time and tolerates missing audio", () => {
		const context = new FakeAudioContext();
		const audio = new GameAudio(() => context as unknown as AudioContext);
		audio.updateBattleMusic(true);
		audio.updateBattleMusic(true);
		expect(context.oscillatorCount).toBe(4);
		audio.updateBattleMusic(false);
		expect(context.gains[1]?.gain.values).toEqual([1, 1, 0]);
		expect(() => new GameAudio(undefined).play("attack")).not.toThrow();
	});
});
