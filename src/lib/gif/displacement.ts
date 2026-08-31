/**
 * Organic flow: Perlin noise displacement.
 * No temporal consistency — stable noise per variation.
 */

import type { Frame, DisplacementField } from './types';
import { mulberry32 } from '../utils/noise';

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

class PerlinNoise {
  private perm: Uint8Array;

  constructor(seed: number) {
    const rand = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = fade(x);
    const v = fade(y);
    const A = this.perm[X] + Y;
    const B = this.perm[X + 1] + Y;
    return lerp(
      lerp(grad(this.perm[A], x, y), grad(this.perm[B], x - 1, y), u),
      lerp(grad(this.perm[A + 1], x, y - 1), grad(this.perm[B + 1], x - 1, y - 1), u),
      v
    );
  }
}

export function generateDisplacementField(
  width: number,
  height: number,
  strength: number,
  seed: number
): DisplacementField {
  const dx = new Float32Array(width * height);
  const dy = new Float32Array(width * height);

  const k = Math.max(0, Math.min(100, strength)) / 100;
  const amplitude = k * 50; // Increased amplitude
  const frequency = 0.02 + k * 0.03;

  const perlin = new PerlinNoise(seed);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      dx[idx] = perlin.noise(x * frequency, y * frequency) * amplitude;
      dy[idx] = perlin.noise(x * frequency + 100, y * frequency + 100) * amplitude;
    }
  }

  return { dx, dy, width, height };
}

export function warpFrame(
  frame: Frame,
  field: DisplacementField,
  _motionMask?: Uint8Array
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);
  const { dx, dy } = field;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const srcX = x - dx[idx];
      const srcY = y - dy[idx];

      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const fx = srcX - x0;
      const fy = srcY - y0;

      const cx0 = Math.max(0, Math.min(width - 1, x0));
      const cx1 = Math.max(0, Math.min(width - 1, x1));
      const cy0 = Math.max(0, Math.min(height - 1, y0));
      const cy1 = Math.max(0, Math.min(height - 1, y1));

      const i00 = (cy0 * width + cx0) * 4;
      const i10 = (cy0 * width + cx1) * 4;
      const i01 = (cy1 * width + cx0) * 4;
      const i11 = (cy1 * width + cx1) * 4;

      const di = idx * 4;
      for (let c = 0; c < 4; c++) {
        const v00 = src[i00 + c];
        const v10 = src[i10 + c];
        const v01 = src[i01 + c];
        const v11 = src[i11 + c];

        const top = v00 + (v10 - v00) * fx;
        const bottom = v01 + (v11 - v01) * fx;
        out[di + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }

  return out;
}

export function applyTemporalConsistency(
  field: DisplacementField,
  _frameIndex: number,
  _totalFrames: number,
  _amplitude: number
): DisplacementField {
  // No temporal consistency — return field as-is
  return field;
}
