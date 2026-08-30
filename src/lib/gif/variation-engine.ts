/**
 * Variation Engine - Main orchestrator for generating GIF variations
 */

import type { Frame, VariationConfig, VariationResult, DisplacementField, ColorTransform, MotionMask } from './types';
import { decodeGif } from './decode';
import { encodeVariation } from './encode';
import { generateDisplacementField, warpFrame, applyTemporalConsistency } from './displacement';
import { generateColorTransform, applyColorTransformToFrame } from './color-transform';
import { computeMotionMask, getTemporalModulation } from './temporal';

/**
 * Generate N variations of a GIF
 */
export async function generateVariations(
  file: File,
  config: VariationConfig,
  onProgress?: (current: number, total: number) => void,
  shouldCancel?: () => boolean
): Promise<VariationResult[]> {
  const { similarity, count } = config;
  
  // Decode original GIF
  const originalFrames = await decodeGif(file);
  
  if (originalFrames.length === 0) {
    throw new Error('No frames found in GIF');
  }
  
  const { width, height } = originalFrames[0]!;
  const totalFrames = originalFrames.length;
  
  // Compute motion mask once (compare first two frames)
  let motionMask: MotionMask | undefined;
  if (totalFrames >= 2) {
    motionMask = computeMotionMask(originalFrames[0]!, originalFrames[1]!);
  }
  
  const results: VariationResult[] = [];
  
  // Generate each variation
  for (let v = 0; v < count; v++) {
    if (shouldCancel?.()) {
      break;
    }
    
    // Deterministic seed for this variation
    const variationSeed = Math.floor(Math.random() * 1e9) + v * 2654435761;
    
    // Generate displacement field ONCE per variation (shared base field)
    const baseFreq = 1 + ((100 - similarity) / 100) * 4;
    const displacementField = generateDisplacementField(width, height, similarity, variationSeed);
    
    // Generate color transform ONCE per variation
    const colorTransform = generateColorTransform(similarity, variationSeed);
    
    // Calculate temporal amplitude based on similarity
    const temporalAmplitude = ((100 - similarity) / 100) * 5;
    
    // Process each frame
    const variationFrames: Frame[] = [];
    
    for (let f = 0; f < totalFrames; f++) {
      const originalFrame = originalFrames[f]!;
      
      // Apply temporal consistency modulation
      const modulatedField = applyTemporalConsistency(
        displacementField,
        f,
        totalFrames,
        temporalAmplitude
      );
      
      // Warp frame using displacement field and motion mask
      const warpedRgba = warpFrame(originalFrame, modulatedField, motionMask?.data);
      
      // Create warped frame with same dimensions and delay
      const warpedFrame: Frame = {
        rgba: warpedRgba,
        delay: originalFrame.delay,
        width: originalFrame.width,
        height: originalFrame.height
      };
      
      // Apply color transform
      const coloredRgba = applyColorTransformToFrame(warpedFrame, colorTransform);
      
      // Create final frame
      const finalFrame: Frame = {
        rgba: coloredRgba,
        delay: originalFrame.delay,
        width: originalFrame.width,
        height: originalFrame.height
      };
      
      variationFrames.push(finalFrame);
      
      // Yield every few frames to prevent blocking
      if (f % 4 === 3) {
        await new Promise(r => setTimeout(r, 0));
      }
    }
    
    // Encode variation
    const { url, bytes } = await encodeVariation(variationFrames);
    
    results.push({
      id: `v${v + 1}-${variationSeed}`,
      url,
      bytes,
      seed: variationSeed
    });
    
    onProgress?.(v + 1, count);
    
    // Yield between variations
    await new Promise(r => setTimeout(r, 0));
  }
  
  return results;
}

/**
 * Preview a single variation without encoding
 * Useful for showing a preview before generating all variations
 */
export async function previewVariation(
  file: File,
  similarity: number,
  seed: number
): Promise<{ frames: Frame[]; width: number; height: number }> {
  const originalFrames = await decodeGif(file);
  
  if (originalFrames.length === 0) {
    throw new Error('No frames found in GIF');
  }
  
  const { width, height } = originalFrames[0]!;
  const totalFrames = originalFrames.length;
  
  // Generate displacement field
  const baseFreq = 1 + ((100 - similarity) / 100) * 4;
  const displacementField = generateDisplacementField(width, height, similarity, seed);
  
  // Generate color transform
  const colorTransform = generateColorTransform(similarity, seed);
  
  // Calculate temporal amplitude
  const temporalAmplitude = ((100 - similarity) / 100) * 5;
  
  // Process frames (limit to first 8 for preview)
  const previewFrameCount = Math.min(8, totalFrames);
  const previewFrames: Frame[] = [];
  
  for (let f = 0; f < previewFrameCount; f++) {
    const originalFrame = originalFrames[f]!;
    
    // Apply temporal consistency
    const modulatedField = applyTemporalConsistency(
      displacementField,
      f,
      totalFrames,
      temporalAmplitude
    );
    
    // Warp frame
    const warpedRgba = warpFrame(originalFrame, modulatedField);
    
    const warpedFrame: Frame = {
      rgba: warpedRgba,
      delay: originalFrame.delay,
      width: originalFrame.width,
      height: originalFrame.height
    };
    
    // Apply color transform
    const coloredRgba = applyColorTransformToFrame(warpedFrame, colorTransform);
    
    previewFrames.push({
      rgba: coloredRgba,
      delay: originalFrame.delay,
      width: originalFrame.width,
      height: originalFrame.height
    });
  }
  
  return {
    frames: previewFrames,
    width,
    height
  };
}
