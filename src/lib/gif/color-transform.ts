/**
 * Color transformation for GIF variations
 */

import type { ColorMode, ColorTransform, Frame } from './types';
import { rgbToHsl, hslToRgb } from '../utils/color';
import { mulberry32 } from '../utils/noise';

const MODES: ColorMode[] = [
  'shift',
  'shift',
  'duotone',
  'posterize',
  'channel-rotate',
  'solarize',
  'gradient-tint',
];

/**
 * Generate a color transform based on similarity, depth and seed
 * @param depth 0..1 — how adventurous the palette treatment may be
 */
export function generateColorTransform(
  similarity: number,
  seed: number,
  depth = 0
): ColorTransform {
  const rand = mulberry32(seed);

  // Calculate variation intensity based on similarity
  // Higher similarity = smaller changes
  const intensity = (100 - similarity) / 100;
  const boost = 1 + depth * 1.5;

  // Deterministic random values based on seed
  const hueDirection = rand() > 0.5 ? 1 : -1;
  const satDirection = rand() > 0.5 ? 1 : -1;
  const lightDirection = rand() > 0.5 ? 1 : -1;
  const contrastDirection = rand() > 0.5 ? 1 : -1;

  // Exotic modes only unlock as depth rises
  const modePool = depth < 0.25 ? MODES.slice(0, 2) : depth < 0.6 ? MODES.slice(0, 5) : MODES;
  const mode = modePool[Math.floor(rand() * modePool.length)] ?? 'shift';

  return {
    hueShift: hueDirection * Math.min(180, intensity * 90 * boost),
    saturationMul: Math.max(0, 1 + satDirection * intensity * 0.7 * boost),
    lightnessShift: lightDirection * intensity * 0.4,
    contrastMul: Math.max(0.2, 1 + contrastDirection * intensity * 0.5 * boost),
    mode,
    tintHue: rand() * 360,
    tintHue2: rand() * 360,
    tintMix: 0.25 + depth * 0.65,
    posterizeLevels: Math.max(2, Math.round(9 - depth * 6)),
  };
}

/**
 * Apply color transform to a frame
 */
export function applyColorTransformToFrame(
  frame: Frame,
  transform: ColorTransform
): Uint8ClampedArray {
  const { rgba: srcData, width, height } = frame;
  const output = new Uint8ClampedArray(srcData.length);
  const levels = transform.posterizeLevels;

  for (let i = 0; i < srcData.length; i += 4) {
    const r = srcData[i] ?? 0;
    const g = srcData[i + 1] ?? 0;
    const b = srcData[i + 2] ?? 0;
    const a = srcData[i + 3] ?? 255;

    // Skip fully transparent pixels
    if (a < 1) {
      output[i] = r;
      output[i + 1] = g;
      output[i + 2] = b;
      output[i + 3] = a;
      continue;
    }

    // Convert to HSL
    let [h, s, l] = rgbToHsl(r, g, b);

    switch (transform.mode) {
      case 'duotone': {
        // Map luminance between two hues
        const t = l;
        const hueA = transform.tintHue;
        const hueB = transform.tintHue2;
        const blended = hueA + ((((hueB - hueA) % 360) + 540) % 360 - 180) * t;
        h = ((blended % 360) + 360) % 360;
        s = Math.max(0, Math.min(1, 0.35 + t * 0.5)) * (0.5 + transform.tintMix);
        break;
      }
      case 'posterize': {
        h = ((h + transform.hueShift) % 360 + 360) % 360;
        l = Math.round(l * (levels - 1)) / (levels - 1);
        s = Math.round(s * (levels - 1)) / (levels - 1);
        break;
      }
      case 'channel-rotate': {
        h = ((h + 120 * (1 + Math.round(transform.tintHue / 180))) % 360 + 360) % 360;
        s = Math.max(0, Math.min(1, s * transform.saturationMul));
        break;
      }
      case 'solarize': {
        h = ((h + transform.hueShift) % 360 + 360) % 360;
        if (l > 0.5) l = 1 - l;
        s = Math.max(0, Math.min(1, s * (transform.saturationMul + 0.2)));
        break;
      }
      case 'gradient-tint': {
        const px = (i / 4) % width;
        const py = Math.floor(i / 4 / height === 0 ? 0 : i / 4 / width);
        const gradient = (px / Math.max(1, width) + py / Math.max(1, height)) * 0.5;
        const target = transform.tintHue + gradient * 120;
        h = ((h * (1 - transform.tintMix) + target * transform.tintMix) % 360 + 360) % 360;
        s = Math.max(0, Math.min(1, s * transform.saturationMul));
        break;
      }
      default: {
        h = ((h + transform.hueShift) % 360 + 360) % 360;
        s = Math.max(0, Math.min(1, s * transform.saturationMul));
      }
    }

    // Apply lightness shift
    l = Math.max(0, Math.min(1, l + transform.lightnessShift));

    // Apply contrast
    const contrastCenter = 0.5;
    l = contrastCenter + (l - contrastCenter) * transform.contrastMul;
    l = Math.max(0, Math.min(1, l));

    // Convert back to RGB
    const [newR, newG, newB] = hslToRgb(h, s, l);

    output[i] = newR;
    output[i + 1] = newG;
    output[i + 2] = newB;
    output[i + 3] = a;
  }

  return output;
}
