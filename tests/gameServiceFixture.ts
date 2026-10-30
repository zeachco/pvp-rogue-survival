import { BALANCE } from "../common/balance";
import type { RandomSource } from "../common/random";
import { GameService, type GameServiceOptions } from "../server/GameService";

export class FixedRandom implements RandomSource {
	constructor(private readonly value = 0) {}
	next(): number {
		return this.value;
	}
}
export function makeGameService(
	repository: GameServiceOptions["repository"],
	options: Partial<Omit<GameServiceOptions, "repository">> = {},
): GameService {
	return new GameService({
		balance: BALANCE,
		random: new FixedRandom(),
		send: () => {},
		...options,
		repository,
	});
}
