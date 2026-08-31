/**
 * Geometry / shape transformation for GIF variations.
 * Inverse-mapped affine warp (rotate, scale, skew, shift, mirror) plus
 * non-linear swirl and ripple distortions, resampled bilinearly.
 */

import type { Frame, GeometryTransform } from './types';
import { mulberry32 } from '../utils/noise';

function signed(rand: () => number): number {
  return rand() * 2 - 1;
}

/**
 * Build a geometry transform. `similarity` (0-100) sets the global closeness to
 * the reference; `strength` (0-100) scales how much of the allowed budget the
 * geometry stage actually uses.
 */
export function generateGeometryTransform(
  similarity: number,
  strength: number,
  seed: number,
  allowMirror: boolean
): GeometryTransform {
  const rand = mulberry32((seed ^ 0x5bf03635) >>> 0);
  const budget = ((100 - similarity) / 100) * (strength / 100);

  return {
    rotation: signed(rand) * budget * 18,          // degrees
    scale: 1 + signed(rand) * budget * 0.22,       // uniform zoom
    scaleY: 1 + signed(rand) * budget * 0.14,      // extra vertical stretch
    skewX: signed(rand) * budget * 0.18,
    skewY: signed(rand) * budget * 0.12,
    shiftX: signed(rand) * budget * 0.1,           // fraction of width
    shiftY: signed(rand) * budget * 0.1,
    swirl: signed(rand) * budget * 1.6,            // radians at centre
    swirlRadius: 0.45 + rand() * 0.45,             // fraction of half-diagonal
    rippleAmp: Math.abs(signed(rand)) * budget * 0.05,
    rippleFreq: 2 + rand() * 6,
    ripplePhase: rand() * Math.PI * 2,
    bulge: signed(rand) * budget * 0.35,
    mirror: allowMirror && budget > 0.08 && rand() > 0.72,
    breathing: budget * 0.35,
  };
}

function sampleBilinear(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  outIdx: number
) {
  const cx = Math.max(0, Math.min(width - 1.001, x));
  const cy = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = cx - x0;
  const ty = cy - y0;

  for (let c = 0; c < 4; c++) {
    const p00 = src[(y0 * width + x0) * 4 + c] ?? 0;
    const p10 = src[(y0 * width + x1) * 4 + c] ?? 0;
    const p01 = src[(y1 * width + x0) * 4 + c] ?? 0;
    const p11 = src[(y1 * width + x1) * 4 + c] ?? 0;
    out[outIdx + c] =
      p00 * (1 - tx) * (1 - ty) +
      p10 * tx * (1 - ty) +
      p01 * (1 - tx) * ty +
      p11 * tx * ty;
  }
}

/**
 * Apply the geometry transform to one frame. Frame index/total drive a smooth
 * looping "breathing" modulation so animation stays flicker-free.
 */
export function applyGeometryToFrame(
  frame: Frame,
  t: GeometryTransform,
  frameIndex: number,
  totalFrames: number
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);

  const loop = totalFrames > 0 ? (frameIndex / totalFrames) * Math.PI * 2 : 0;
  const breathe = 1 + Math.sin(loop) * t.breathing * 0.08;
  const swirlLoop = t.swirl * (1 + Math.sin(loop) * t.breathing * 0.3);

  const cx = width / 2;
  const cy = height / 2;
  const halfDiag = Math.hypot(cx, cy);

  // Inverse affine: destination -> source
  const rad = (-t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const invScaleX = 1 / (t.scale * breathe);
  const invScaleY = 1 / (t.scale * t.scaleY * breathe);

  const shiftX = t.shiftX * width;
  const shiftY = t.shiftY * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let px = x - cx - shiftX;
      let py = y - cy - shiftY;

      // rotation (inverse)
      let rx = px * cos - py * sin;
      let ry = px * sin + py * cos;

      // scale (inverse)
      rx *= invScaleX;
      ry *= invScaleY;

      // skew (inverse-ish, small values)
      rx -= ry * t.skewX;
      ry -= rx * t.skewY;

      // radial: swirl + bulge
      const dist = Math.hypot(rx, ry);
      const norm = halfDiag > 0 ? dist / halfDiag : 0;

      if (t.swirl !== 0 && norm < t.swirlRadius) {
        const falloff = 1 - norm / t.swirlRadius;
        const angle = swirlLoop * falloff * falloff;
        const sa = Math.sin(angle);
        const ca = Math.cos(angle);
        const nx = rx * ca - ry * sa;
        const ny = rx * sa + ry * ca;
        rx = nx;
        ry = ny;
      }

      if (t.bulge !== 0 && dist > 0.001) {
        const k = 1 + t.bulge * (1 - norm) * (1 - norm);
        rx /= k;
        ry /= k;
      }

      // ripple (wave distortion)
      if (t.rippleAmp > 0) {
        const amp = t.rippleAmp * Math.min(width, height);
        rx += Math.sin(ry / height * Math.PI * t.rippleFreq + t.ripplePhase + loop) * amp;
        ry += Math.cos(rx / width * Math.PI * t.rippleFreq + t.ripplePhase - loop) * amp * 0.6;
      }

      let sx = rx + cx;
      const sy = ry + cy;
      if (t.mirror) sx = width - 1 - sx;

      sampleBilinear(src, width, height, sx, sy, out, (y * width + x) * 4);
    }
  }

  return out;
}
