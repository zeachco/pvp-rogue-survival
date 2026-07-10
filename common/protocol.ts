export type PlayerId = string;
export type CreepKind = "melee" | "bubbleShooter";

export interface PublicPlayer {
  id: PlayerId;
  name: string;
  score: number;
  waveNumber: number;
}

export interface ServerConfig {
  matchScoreGap: number;
  maxNeighbors: number;
  waveIntervalMs: number;
}

export interface CreepWaveGroup {
  emitterId: PlayerId | "neutral";
  emitterName: string;
  creepKind: CreepKind;
  count: number;
}

export interface CreepWave {
  id: string;
  targetId: PlayerId;
  waveNumber: number;
  creeps: CreepWaveGroup[];
  delayMs: number;
  spawnIntervalMs: number;
}

export type ClientMessage =
  | { type: "join"; name: string; sessionId?: PlayerId }
  | { type: "creepKilled"; creepKind: CreepKind }
  | { type: "scoreSnapshot"; score: number; health: number };

export type ServerMessage =
  | { type: "welcome"; playerId: PlayerId; player: PublicPlayer; neighbors: PublicPlayer[]; config: ServerConfig }
  | { type: "neighbors"; neighbors: PublicPlayer[] }
  | { type: "incomingWave"; wave: CreepWave }
  | { type: "scoreAwarded"; score: number; reason: string }
  | { type: "serverNotice"; message: string };

export interface CreepDefinition {
  kind: CreepKind;
  label: string;
  hp: number;
  maxSpeed: number;
  acceleration: number;
  bounty: number;
  scoreValue: number;
  radius: number;
  fill: string;
  outline: string;
}

export const CREEP_DEFINITIONS: Record<CreepKind, CreepDefinition> = {
  melee: {
    kind: "melee", label: "Melee", hp: 56, maxSpeed: 82, acceleration: 240,
    bounty: 6, scoreValue: 2, radius: 16, fill: "#ff6f7d", outline: "#501721"
  },
  bubbleShooter: {
    kind: "bubbleShooter", label: "Bubble shooter", hp: 42, maxSpeed: 66, acceleration: 180,
    bounty: 9, scoreValue: 4, radius: 18, fill: "#8c7cff", outline: "#261c61"
  }
};
