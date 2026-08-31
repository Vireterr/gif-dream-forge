/**
 * Color transformation for GIF variations
 */

import type { ColorTransform, Frame } from './types';
import { rgbToHsl, hslToRgb } from '../utils/color';
import { mulberry32 } from '../utils/noise';

/**
 * Generate a color transform based on similarity and seed
 */
export function generateColorTransform(
  similarity: number,
  seed: number
): ColorTransform {
  const rand = mulberry32(seed);
  
  // Calculate variation intensity based on similarity
  // Higher similarity = smaller changes
  const intensity = (100 - similarity) / 100;
  
  // Deterministic random values based on seed
  const hueDirection = rand() > 0.5 ? 1 : -1;
  const satDirection = rand() > 0.5 ? 1 : -1;
  const lightDirection = rand() > 0.5 ? 1 : -1;
  const contrastDirection = rand() > 0.5 ? 1 : -1;
  
  return {
    // Hue shift: ±90° at 0% similarity, 0° at 100%
    hueShift: hueDirection * intensity * 90,
    
    // Saturation multiplier: 0.3-1.7 range
    saturationMul: 1 + satDirection * intensity * 0.7,
    
    // Lightness shift: ±40% at 0% similarity
    lightnessShift: lightDirection * intensity * 0.4,
    
    // Contrast multiplier: 0.5-1.5 range
    contrastMul: 1 + contrastDirection * intensity * 0.5
  };
}

/**
 * Apply color transform to a frame
 */
export function applyColorTransformToFrame(
  frame: Frame,
  transform: ColorTransform
): Uint8ClampedArray {
  const { rgba: srcData } = frame;
  const output = new Uint8ClampedArray(srcData.length);
  
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
    
    // Apply hue shift
    h = ((h + transform.hueShift) % 360 + 360) % 360;
    
    // Apply saturation multiplier
    s = Math.max(0, Math.min(1, s * transform.saturationMul));
    
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
