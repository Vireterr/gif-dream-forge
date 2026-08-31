/**
 * Variation Engine - Main orchestrator for generating GIF variations
 */

import type { Frame, VariationConfig, VariationResult, MotionMask } from './types';
import { decodeGif } from './decode';
import { encodeVariation } from './encode';
import { generateDisplacementField, warpFrame, applyTemporalConsistency } from './displacement';
import { generateColorTransform, applyColorTransformToFrame } from './color-transform';
import { generateGeometryTransform, applyGeometryToFrame } from './geometry';
import { computeSilhouetteMask, preserveSilhouette } from './silhouette';
import { generateReassemblyMap, applyReassemblyToFrame } from './reassemble';
import { computeMotionMask } from './temporal';

/** Blend a global similarity with a per-stage strength (0-100). */
function stageSimilarity(similarity: number, strength: number): number {
  return 100 - (100 - similarity) * (strength / 100);
}

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
  const geometryStrength = config.geometry ?? 60;
  const colorStrength = config.color ?? 60;
  const flowStrength = config.flow ?? 60;
  const allowMirror = config.mirror ?? false;
  const silhouetteStrength = config.silhouette ?? 50;
  const reassemblyStrength = config.reassembly ?? 0;
  const blockSize = config.blockSize ?? 8;

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

  // Silhouette / contour mask from the first frame
  const silhouetteMask = silhouetteStrength > 0
    ? computeSilhouetteMask(originalFrames[0]!).data
    : undefined;

  const results: VariationResult[] = [];
  
  // Generate each variation
  for (let v = 0; v < count; v++) {
    if (shouldCancel?.()) {
      break;
    }
    
    // Deterministic seed for this variation
    const variationSeed = Math.floor(Math.random() * 1e9) + v * 2654435761;
    
    const flowSim = stageSimilarity(similarity, flowStrength);
    const colorSim = stageSimilarity(similarity, colorStrength);

    // Generate displacement field ONCE per variation (shared base field)
    const displacementField = generateDisplacementField(width, height, flowSim, variationSeed);
    
    // Generate color transform ONCE per variation
    const colorTransform = generateColorTransform(colorSim, variationSeed);

    // Geometry / shape transform ONCE per variation
    const geometryTransform = generateGeometryTransform(
      similarity,
      geometryStrength,
      variationSeed,
      allowMirror
    );

    // 🆕 Generate reassembly map ONCE per variation (applied to all frames)
    const reassemblyMap = reassemblyStrength > 0
      ? generateReassemblyMap(width, height, blockSize, reassemblyStrength, variationSeed)
      : null;
    
    // Calculate temporal amplitude based on similarity
    const temporalAmplitude = ((100 - flowSim) / 100) * 5;
    
    // Process each frame
    const variationFrames: Frame[] = [];
    
    for (let f = 0; f < totalFrames; f++) {
      const originalFrame = originalFrames[f]!;

      // 1. 🆕 Reassembly (block/pixel shuffle) — applied FIRST
      let currentFrame: Frame = originalFrame;
      if (reassemblyMap) {
        const reassembledRgba = applyReassemblyToFrame(
          originalFrame,
          reassemblyMap,
          silhouetteMask,
          silhouetteStrength
        );
        currentFrame = {
          rgba: reassembledRgba,
          delay: originalFrame.delay,
          width: originalFrame.width,
          height: originalFrame.height
        };
      }

      // 2. Geometry / shape warp
      const geoRgba = applyGeometryToFrame(currentFrame, geometryTransform, f, totalFrames);
      const geoFrame: Frame = {
        rgba: geoRgba,
        delay: currentFrame.delay,
        width: currentFrame.width,
        height: currentFrame.height
      };

      // 3. Organic noise displacement with temporal consistency
      const modulatedField = applyTemporalConsistency(
        displacementField,
        f,
        totalFrames,
        temporalAmplitude
      );
      const warpedRgba = warpFrame(geoFrame, modulatedField, motionMask?.data);
      
      const warpedFrame: Frame = {
        rgba: warpedRgba,
        delay: geoFrame.delay,
        width: geoFrame.width,
        height: geoFrame.height
      };
      
      // 4. Color transform
      const coloredRgba = applyColorTransformToFrame(warpedFrame, colorTransform);
      
      variationFrames.push({
        rgba: coloredRgba,
        delay: warpedFrame.delay,
        width: warpedFrame.width,
        height: warpedFrame.height
      });
      
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
      delay: warpedFrame.delay,
      width: warpedFrame.width,
      height: warpedFrame.height
    });
  }
  
  return {
    frames: previewFrames,
    width,
    height
  };
}
