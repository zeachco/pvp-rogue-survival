import * as THREE from "three";

const FLOOR_BASE = { r: 0.052, g: 0.08, b: 0.1 };

function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / norm;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const textureCache = new Map<number, THREE.DataTexture>();

export function createArenaFloorTexture(size = 1024): THREE.DataTexture {
  const cached = textureCache.get(size);
  if (cached) return cached;
  const data = new Uint8Array(size * size * 4);
  let o = 0;
  for (let py = 0; py < size; py++) {
    const v = (py + 0.5) / size;
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;

      const mottle = fbm(u * 7, v * 7, 4);
      const warp = fbm(u * 2.6 + 13.1, v * 2.6 + 7.7, 3);
      const stain = fbm(u * 3.4 + warp * 1.6, v * 3.4 + warp * 1.6, 3);

      const m = 0.86 + (mottle - 0.5) * 0.5;
      const s = (stain - 0.5) * 0.16;
      const ring = (Math.sin(d * Math.PI * 12) * 0.5 + 0.5) * 0.5;
      const center = smoothstep(0.55, 0, d);
      const vignette = 1 - smoothstep(0.7, 1, d) * 0.55;

      const r = (FLOOR_BASE.r * m + s * 0.9) * vignette;
      const g =
        (FLOOR_BASE.g * m + s + ring * 0.016 + center * 0.02) * vignette;
      const b =
        (FLOOR_BASE.b * m + s * 1.05 + ring * 0.02 + center * 0.026) * vignette;

      data[o++] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      data[o++] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      data[o++] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      data[o++] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  textureCache.set(size, texture);
  return texture;
}
