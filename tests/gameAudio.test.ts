import { describe, expect, test } from "bun:test";
import { GameAudio, type GameSound } from "../src/game/GameAudio";

class FakeAudioParam {
	setValueAtTime(): void {}
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
	createGain(): GainNode {
		return new FakeGain() as unknown as GainNode;
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
		expect(() => new GameAudio(undefined).play("attack")).not.toThrow();
	});
});
