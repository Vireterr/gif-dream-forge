/**
 * Geometry transformations: rotation, scale, distortion.
 * Random values per variation, no modes.
 */

import type { Frame, GeometryTransform } from './types';
import { mulberry32 } from '../utils/noise';

export function generateGeometryTransform(
  similarity: number,
  strength: number,
  seed: number,
  allowMirror: boolean
): GeometryTransform {
  const k = Math.max(0, Math.min(100, strength)) / 100;
  const rand = mulberry32((seed ^ 0x12345678) >>> 0);

  const rotation = (rand() * 2 - 1) * k * 45; // -45 to +45 degrees
  const scale = 1 + (rand() * 2 - 1) * k * 0.5; // 0.75 to 1.25
  const scaleY = 1 + (rand() * 2 - 1) * k * 0.3;
  const skewX = (rand() * 2 - 1) * k * 0.3;
  const skewY = (rand() * 2 - 1) * k * 0.3;
  const shiftX = (rand() * 2 - 1) * k * 0.2;
  const shiftY = (rand() * 2 - 1) * k * 0.2;
  const swirl = (rand() * 2 - 1) * k * 2;
  const swirlRadius = 0.3 + rand() * 0.4;
  const rippleAmp = k * 20;
  const rippleFreq = 2 + rand() * 5;
  const ripplePhase = rand() * Math.PI * 2;
  const bulge = (rand() * 2 - 1) * k * 0.5;
  const mirror = allowMirror && rand() > 0.7;
  const breathing = k * 0.2;

  return {
    rotation,
    scale,
    scaleY,
    skewX,
    skewY,
    shiftX,
    shiftY,
    swirl,
    swirlRadius,
    rippleAmp,
    rippleFreq,
    ripplePhase,
    bulge,
    mirror,
    breathing,
  };
}

export function applyGeometryToFrame(
  frame: Frame,
  transform: GeometryTransform,
  frameIndex: number,
  totalFrames: number
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);

  const cx = width / 2;
  const cy = height / 2;

  const rotRad = (transform.rotation * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  const t = frameIndex / Math.max(1, totalFrames - 1);
  const breathe = 1 + Math.sin(t * Math.PI * 2) * transform.breathing;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let dx = x - cx;
      let dy = y - cy;

      // Mirror
      if (transform.mirror) {
        dx = -dx;
      }

      // Rotation
      const rx = dx * cosR - dy * sinR;
      const ry = dx * sinR + dy * cosR;
      dx = rx;
      dy = ry;

      // Scale
      dx /= transform.scale * breathe;
      dy /= transform.scaleY * breathe;

      // Skew
      dx += dy * transform.skewX;
      dy += dx * transform.skewY;

      // Swirl
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = Math.sqrt(cx * cx + cy * cy);
      const swirlFactor = Math.max(0, 1 - dist / (maxDist * transform.swirlRadius));
      const swirlAngle = transform.swirl * swirlFactor;
      const cosS = Math.cos(swirlAngle);
      const sinS = Math.sin(swirlAngle);
      const sx = dx * cosS - dy * sinS;
      const sy = dx * sinS + dy * cosS;
      dx = sx;
      dy = sy;

      // Ripple
      const ripple = Math.sin(dist * transform.rippleFreq + transform.ripplePhase) * transform.rippleAmp;
      dx += (dx / (dist + 0.001)) * ripple;
      dy += (dy / (dist + 0.001)) * ripple;

      // Bulge
      const bulgeFactor = 1 + transform.bulge * (1 - dist / maxDist);
      dx *= bulgeFactor;
      dy *= bulgeFactor;

      // Shift
      dx += transform.shiftX * width;
      dy += transform.shiftY * height;

      // Back to pixel coordinates
      const srcX = Math.round(dx + cx);
      const srcY = Math.round(dy + cy);

      const di = (y * width + x) * 4;

      if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
        const si = (srcY * width + srcX) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
      } else {
        out[di] = 0;
        out[di + 1] = 0;
        out[di + 2] = 0;
        out[di + 3] = 0;
      }
    }
  }

  return out;
}
