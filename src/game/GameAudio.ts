export type GameSound = "spell" | "attack" | "goldDrop" | "creepDeath";

type AudioContextConstructor = new () => AudioContext;

export class GameAudio {
	private context?: AudioContext;
	private master?: GainNode;
	private musicScheduledUntil = 0;

	constructor(
		private readonly createContext:
			| (() => AudioContext)
			| undefined = typeof window === "undefined"
			? undefined
			: () => {
					const AudioContextClass = (window.AudioContext ??
						(
							window as typeof window & {
								webkitAudioContext?: AudioContextConstructor;
							}
						).webkitAudioContext) as AudioContextConstructor | undefined;
					if (!AudioContextClass) throw new Error("Web Audio is unavailable");
					return new AudioContextClass();
				},
	) {}

	unlock(): void {
		try {
			this.ensureContext();
			if (this.context?.state === "suspended") void this.context.resume();
		} catch {
			// Audio support is optional and must never interrupt gameplay.
		}
	}

	play(sound: GameSound): void {
		const context = this.readyContext();
		if (!context || !this.master) return;
		const now = context.currentTime;
		if (sound === "spell") {
			this.tone(330, 660, now, 0.2, 0.12, "sine");
			this.tone(495, 990, now + 0.035, 0.16, 0.07, "triangle");
		} else if (sound === "attack")
			this.tone(150, 70, now, 0.09, 0.055, "sawtooth");
		else if (sound === "goldDrop") {
			this.tone(880, 1320, now, 0.11, 0.09, "sine");
			this.tone(1175, 1760, now + 0.07, 0.13, 0.07, "sine");
		} else {
			this.tone(125, 48, now, 0.24, 0.1, "square");
			this.tone(72, 38, now + 0.04, 0.3, 0.065, "sawtooth");
		}
	}

	updateBattleMusic(active: boolean): void {
		const context = this.readyContext();
		if (!context || !this.master) return;
		if (!active) {
			this.musicScheduledUntil = context.currentTime;
			return;
		}
		if (this.musicScheduledUntil > context.currentTime + 0.6) return;
		const start = Math.max(
			context.currentTime + 0.02,
			this.musicScheduledUntil,
		);
		const notes = [55, 65.41, 73.42, 49];
		for (const [index, frequency] of notes.entries())
			this.tone(
				frequency,
				frequency * 0.995,
				start + index * 0.5,
				0.42,
				0.018,
				"triangle",
			);
		this.musicScheduledUntil = start + notes.length * 0.5;
	}

	private ensureContext(): void {
		if (this.context || !this.createContext) return;
		this.context = this.createContext();
		this.master = this.context.createGain();
		this.master.gain.value = 0.35;
		this.master.connect(this.context.destination);
	}

	private readyContext(): AudioContext | undefined {
		try {
			this.ensureContext();
			return this.context?.state === "running" ? this.context : undefined;
		} catch {
			return undefined;
		}
	}

	private tone(
		startFrequency: number,
		endFrequency: number,
		start: number,
		duration: number,
		volume: number,
		type: OscillatorType,
	): void {
		if (!this.context || !this.master) return;
		const oscillator = this.context.createOscillator();
		const gain = this.context.createGain();
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(startFrequency, start);
		oscillator.frequency.exponentialRampToValueAtTime(
			Math.max(1, endFrequency),
			start + duration,
		);
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
		oscillator.connect(gain);
		gain.connect(this.master);
		oscillator.start(start);
		oscillator.stop(start + duration + 0.01);
	}
}
