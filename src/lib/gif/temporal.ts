/**
 * Temporal consistency utilities
 * Computes motion masks and applies temporal smoothing
 */

import type { Frame, MotionMask } from './types';

/**
 * Compute a motion mask by comparing two frames
 * Returns a mask where high values indicate areas of high motion
 */
export function computeMotionMask(
  frame1: Frame,
  frame2: Frame
): MotionMask {
  const { width, height } = frame1;
  const data = new Uint8Array(width * height);
  
  const diffThreshold = 30; // Pixel difference threshold for "motion"
  const blurRadius = 2; // Simple box blur radius
  
  // First pass: compute raw differences
  const rawData = new Float32Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      let diff = 0;
      for (let c = 0; c < 3; c++) {
        const v1 = frame1.rgba[idx + c] ?? 0;
        const v2 = frame2.rgba[idx + c] ?? 0;
        diff += Math.abs(v1 - v2);
      }
      
      // Normalize to 0-255 range
      const normalizedDiff = Math.min(255, (diff / 3) * (255 / diffThreshold));
      rawData[y * width + x] = normalizedDiff;
    }
  }
  
  // Second pass: apply simple box blur to smooth the mask
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      
      for (let dy = -blurRadius; dy <= blurRadius; dy++) {
        for (let dx = -blurRadius; dx <= blurRadius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            sum += rawData[ny * width + nx] ?? 0;
            count++;
          }
        }
      }
      
      data[y * width + x] = Math.round(sum / count);
    }
  }
  
  return { data, width, height };
}

/**
 * Apply motion-aware displacement scaling
 * Reduces displacement in areas with high motion to prevent artifacts
 */
export function applyMotionAwareDisplacement(
  baseDisplacement: { dx: number; dy: number },
  motionMaskValue: number,
  reductionFactor: number = 0.5
): { dx: number; dy: number } {
  // Normalize motion value to 0-1
  const motionIntensity = motionMaskValue / 255;
  
  // Scale factor: 1.0 for no motion, (1 - reductionFactor) for max motion
  const scaleFactor = 1 - motionIntensity * reductionFactor;
  
  return {
    dx: baseDisplacement.dx * scaleFactor,
    dy: baseDisplacement.dy * scaleFactor
  };
}

/**
 * Generate a temporal modulation signal for smooth animation
 * Uses sine wave for seamless looping
 */
export function getTemporalModulation(
  frameIndex: number,
  totalFrames: number,
  amplitude: number
): number {
  const phase = (frameIndex / totalFrames) * Math.PI * 2;
  return Math.sin(phase) * amplitude;
}
