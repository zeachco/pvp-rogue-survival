export type PlayerId = string;

export type CreepKind = "basic" | "runner" | "brute";

export interface PublicPlayer {
  id: PlayerId;
  name: string;
  score: number;
  income: number;
}

export interface ServerConfig {
  incomeIntervalMs: number;
  matchScoreGap: number;
  maxNeighbors: number;
}

export interface CreepWave {
  id: string;
  emitterId: PlayerId | "neutral";
  emitterName: string;
  targetId: PlayerId;
  creepKind: CreepKind;
  count: number;
  delayMs: number;
}

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "buyCreep"; creepKind: CreepKind }
  | { type: "creepLeaked"; emitterId: PlayerId | "neutral"; creepKind: CreepKind }
  | { type: "scoreSnapshot"; score: number; lives: number };

export type ServerMessage =
  | {
      type: "welcome";
      playerId: PlayerId;
      player: PublicPlayer;
      neighbors: PublicPlayer[];
      config: ServerConfig;
    }
  | { type: "neighbors"; neighbors: PublicPlayer[] }
  | { type: "incomingWave"; wave: CreepWave }
  | { type: "purchaseAccepted"; creepKind: CreepKind; income: number; goldSpent: number }
  | { type: "scoreAwarded"; score: number; reason: string }
  | { type: "serverNotice"; message: string };

export interface CreepDefinition {
  kind: CreepKind;
  label: string;
  cost: number;
  incomeGain: number;
  hp: number;
  speed: number;
  bounty: number;
  scoreValue: number;
  fill: string;
  outline: string;
  sides: number;
}

export const CREEP_DEFINITIONS: Record<CreepKind, CreepDefinition> = {
  basic: {
    kind: "basic",
    label: "Basic",
    cost: 18,
    incomeGain: 1,
    hp: 42,
    speed: 58,
    bounty: 5,
    scoreValue: 2,
    fill: "#62d8ff",
    outline: "#0f3444",
    sides: 4
  },
  runner: {
    kind: "runner",
    label: "Runner",
    cost: 36,
    incomeGain: 3,
    hp: 34,
    speed: 92,
    bounty: 7,
    scoreValue: 4,
    fill: "#a7ff6a",
    outline: "#24420f",
    sides: 3
  },
  brute: {
    kind: "brute",
    label: "Brute",
    cost: 62,
    incomeGain: 6,
    hp: 115,
    speed: 38,
    bounty: 12,
    scoreValue: 9,
    fill: "#ffb84f",
    outline: "#4b2b09",
    sides: 6
  }
};
