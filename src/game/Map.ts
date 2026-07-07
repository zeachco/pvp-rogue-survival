import type { Camera, Vector2 } from "./types";

export interface BuildPad {
  id: string;
  x: number;
  y: number;
  occupied: boolean;
}

export class GameMap {
  readonly tileSize = 56;
  readonly columns = 24;
  readonly rows = 13;
  readonly pathTiles: Vector2[] = [
    { x: 0, y: 6 },
    { x: 4, y: 6 },
    { x: 4, y: 3 },
    { x: 9, y: 3 },
    { x: 9, y: 9 },
    { x: 15, y: 9 },
    { x: 15, y: 5 },
    { x: 21, y: 5 },
    { x: 23, y: 7 }
  ];

  readonly buildPads: BuildPad[] = [
    { id: "a", x: 3, y: 4, occupied: false },
    { id: "b", x: 6, y: 2, occupied: false },
    { id: "c", x: 7, y: 6, occupied: false },
    { id: "d", x: 11, y: 7, occupied: false },
    { id: "e", x: 13, y: 10, occupied: false },
    { id: "f", x: 17, y: 7, occupied: false },
    { id: "g", x: 19, y: 4, occupied: false }
  ];

  get width(): number {
    return this.columns * this.tileSize;
  }

  get height(): number {
    return this.rows * this.tileSize;
  }

  getWaypoints(): Vector2[] {
    return this.pathTiles.map((tile) => this.tileCenter(tile.x, tile.y));
  }

  tileCenter(x: number, y: number): Vector2 {
    return {
      x: x * this.tileSize + this.tileSize / 2,
      y: y * this.tileSize + this.tileSize / 2
    };
  }

  findPadAt(world: Vector2): BuildPad | undefined {
    return this.buildPads.find((pad) => {
      if (pad.occupied) return false;
      const center = this.tileCenter(pad.x, pad.y);
      return Math.hypot(center.x - world.x, center.y - world.y) <= this.tileSize * 0.45;
    });
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    ctx.fillStyle = "#101418";
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = "#222b31";
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.columns; x += 1) {
      ctx.beginPath();
      ctx.moveTo(x * this.tileSize, 0);
      ctx.lineTo(x * this.tileSize, this.height);
      ctx.stroke();
    }
    for (let y = 0; y <= this.rows; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y * this.tileSize);
      ctx.lineTo(this.width, y * this.tileSize);
      ctx.stroke();
    }

    const waypoints = this.getWaypoints();
    ctx.strokeStyle = "#4d6268";
    ctx.lineWidth = 34;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    waypoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    ctx.strokeStyle = "#8ad8ff";
    ctx.lineWidth = 3;
    ctx.stroke();

    for (const pad of this.buildPads) {
      const center = this.tileCenter(pad.x, pad.y);
      ctx.fillStyle = pad.occupied ? "#263238" : "#182a2c";
      ctx.strokeStyle = pad.occupied ? "#4f6970" : "#3affd4";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(center.x - 18, center.y - 18, 36, 36);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }
}
