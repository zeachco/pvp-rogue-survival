export interface Vector2 {
  x: number;
  y: number;
}

export interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlayerState {
  id: string;
  name: string;
  score: number;
  waveNumber: number;
  lives: number;
  gold: number;
  income: number;
}
