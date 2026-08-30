/**
 * Displacement field generation and frame warping
 */

import type { DisplacementField, Frame } from './types';
import { fbmNoise2D, mulberry32 } from '../utils/noise';

/**
 * Generate a displacement field using Perlin noise
 * The field defines how much each pixel should be displaced (dx, dy)
 */
export function generateDisplacementField(
  width: number,
  height: number,
  similarity: number,
  seed: number
): DisplacementField {
  // Higher similarity = lower amplitude (less displacement)
  // 100% -> 0-1px, 90% -> 0-3px, 75% -> 0-8px, 50% -> 0-20px
  const maxAmplitude = ((100 - similarity) / 100) * 20;
  
  // Higher similarity = lower frequency (smoother, larger displacements)
  const baseFreq = 1 + ((100 - similarity) / 100) * 4;
  
  const dx = new Float32Array(width * height);
  const dy = new Float32Array(width * height);
  
  const rand = mulberry32(seed);
  const phaseX = rand() * 1000;
  const phaseY = rand() * 1000;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x / width) * baseFreq + phaseX;
      const ny = (y / height) * baseFreq + phaseY;
      
      // Get noise values for dx and dy (using different offsets for variety)
      const noiseX = fbmNoise2D(nx, ny, 4, 2, 0.5);
      const noiseY = fbmNoise2D(nx + 5.3, ny + 2.7, 4, 2, 0.5);
      
      // Convert to -1 to 1 range and apply amplitude
      const dX = (noiseX - 0.5) * 2 * maxAmplitude;
      const dY = (noiseY - 0.5) * 2 * maxAmplitude;
      
      dx[y * width + x] = dX;
      dy[y * width + x] = dY;
    }
  }
  
  return { dx, dy, width, height };
}

/**
 * Warp a frame using bilinear interpolation based on displacement field
 */
export function warpFrame(
  sourceFrame: Frame,
  displacementField: DisplacementField,
  motionMask?: Uint8Array
): Uint8ClampedArray {
  const { rgba: srcData } = sourceFrame;
  const { width, height } = sourceFrame;
  const { dx, dy } = displacementField;
  
  const output = new Uint8ClampedArray(width * height * 4);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      // Apply motion mask to reduce displacement in moving areas
      let displacementScale = 1;
      if (motionMask) {
        const maskValue = motionMask[idx] ?? 0;
        // Reduce displacement by up to 50% in high-motion areas
        displacementScale = 1 - (maskValue / 255) * 0.5;
      }
      
      // Calculate source position with displacement
      const srcX = x + dx[idx]! * displacementScale;
      const srcY = y + dy[idx]! * displacementScale;
      
      // Clamp to bounds
      const clampedSrcX = Math.max(0, Math.min(width - 1.001, srcX));
      const clampedSrcY = Math.max(0, Math.min(height - 1.001, srcY));
      
      // Bilinear interpolation
      const x0 = Math.floor(clampedSrcX);
      const y0 = Math.floor(clampedSrcY);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);
      
      const tx = clampedSrcX - x0;
      const ty = clampedSrcY - y0;
      
      // Interpolate each channel
      for (let c = 0; c < 4; c++) {
        const p00 = srcData[(y0 * width + x0) * 4 + c] ?? 0;
        const p10 = srcData[(y0 * width + x1) * 4 + c] ?? 0;
        const p01 = srcData[(y1 * width + x0) * 4 + c] ?? 0;
        const p11 = srcData[(y1 * width + x1) * 4 + c] ?? 0;
        
        // Bilinear interpolation formula
        const value =
          p00 * (1 - tx) * (1 - ty) +
          p10 * tx * (1 - ty) +
          p01 * (1 - tx) * ty +
          p11 * tx * ty;
        
        output[idx * 4 + c] = Math.round(value);
      }
    }
  }
  
  return output;
}

/**
 * Modify displacement field with temporal consistency
 * Adds smooth sinusoidal modulation based on frame index
 */
export function applyTemporalConsistency(
  baseField: DisplacementField,
  frameIndex: number,
  totalFrames: number,
  temporalAmplitude: number
): DisplacementField {
  const { dx, dy, width, height } = baseField;
  
  // Create modulated copies
  const modulatedDx = new Float32Array(dx.length);
  const modulatedDy = new Float32Array(dy.length);
  
  // Smooth sinusoidal phase (not random!)
  const phase = (frameIndex / totalFrames) * Math.PI * 2;
  const temporalModulation = Math.sin(phase) * temporalAmplitude;
  
  for (let i = 0; i < dx.length; i++) {
    modulatedDx[i] = dx[i]! + temporalModulation;
    modulatedDy[i] = dy[i]! + temporalModulation * 0.5; // Less modulation on Y axis
  }
  
  return {
    dx: modulatedDx,
    dy: modulatedDy,
    width,
    height
  };
}
