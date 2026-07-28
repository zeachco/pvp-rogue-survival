export interface RandomSource {
	next(): number;
}

export class SeededRandom implements RandomSource {
	constructor(private seed: number) {}
	next(): number {
		this.seed |= 0;
		this.seed = (this.seed + 0x6d2b79f5) | 0;
		let value = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	}
}

export const systemRandom: RandomSource = { next: () => Math.random() };
export function randomSeed(random: RandomSource = systemRandom): number {
	return Math.floor(random.next() * 0x7fffffff);
}
