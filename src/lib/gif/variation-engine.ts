import type { Frame, VariationConfig, VariationResult, MotionMask } from './types';
import { decodeGif } from './decode';
import { encodeVariation } from './encode';
import { generateDisplacementField, warpFrame, applyTemporalConsistency } from './displacement';
import { generateColorTransform, applyColorTransformToFrame } from './color-transform';
import { generateGeometryTransform, applyGeometryToFrame } from './geometry';
import { computeSilhouetteMask } from './silhouette';
import { generateReassemblyMap, applyReassemblyToFrame } from './reassemble';
import { computeMotionMask } from './temporal';
import { applyColorCollage } from './color-segmentation';

/**
 * Similarity — главный множитель для ВСЕХ эффектов.
 */
function applySimilarity(effectStrength: number, similarity: number): number {
  return (effectStrength / 100) * (similarity / 100) * 100;
}

export async function generateVariations(
  file: File,
  config: VariationConfig,
  onProgress?: (current: number, total: number) => void,
  shouldCancel?: () => boolean
): Promise<VariationResult[]> {
  const { similarity, count } = config;
  
  // Применяем Similarity ко ВСЕМ эффектам
  const geometryStrength = applySimilarity(config.geometry ?? 0, similarity);
  const colorStrength = applySimilarity(config.color ?? 0, similarity);
  const flowStrength = applySimilarity(config.flow ?? 0, similarity);
  const reassemblyStrength = applySimilarity(config.reassembly ?? 0, similarity);
  const colorSegStrength = applySimilarity(config.colorSegmentation ?? 0, similarity);
  const silhouetteStrength = applySimilarity(config.silhouette ?? 0, similarity);
  
  const allowMirror = config.mirror ?? false;
  const blockSize = config.blockSize ?? 32;
  const targetColorsMode = config.targetColorsMode ?? false;
  const targetColors = config.targetColors ?? [];

  const originalFrames = await decodeGif(file);
  if (originalFrames.length === 0) throw new Error('No frames found in GIF');

  const { width, height } = originalFrames[0]!;
  const totalFrames = originalFrames.length;

  let motionMask: MotionMask | undefined;
  if (totalFrames >= 2) {
    motionMask = computeMotionMask(originalFrames[0]!, originalFrames[1]!);
  }

  const silhouetteMask = silhouetteStrength > 0
    ? computeSilhouetteMask(originalFrames[0]!).data
    : undefined;

  const results: VariationResult[] = [];

  for (let v = 0; v < count; v++) {
    if (shouldCancel?.()) break;

    const variationSeed = Math.floor(Math.random() * 1e9) + v * 2654435761;

    const displacementField = flowStrength > 0
      ? generateDisplacementField(width, height, flowStrength, variationSeed)
      : null;

    const colorTransform = colorStrength > 0
      ? generateColorTransform(colorStrength, variationSeed)
      : null;

    const geometryTransform = geometryStrength > 0
      ? generateGeometryTransform(similarity, geometryStrength, variationSeed, allowMirror)
      : null;

    // 🆕 Передаём silhouetteMask и silhouetteStrength в generateReassemblyMap
    const reassemblyMap = reassemblyStrength > 0 && blockSize > 0
      ? generateReassemblyMap(
          width, 
          height, 
          blockSize, 
          reassemblyStrength, 
          variationSeed,
          silhouetteMask,
          silhouetteStrength
        )
      : null;

    const enabledTargets = targetColorsMode
      ? targetColors.filter((t) => t.enabled)
      : [];

    const variationFrames: Frame[] = [];

    for (let f = 0; f < totalFrames; f++) {
      const originalFrame = originalFrames[f]!;
      let currentFrame: Frame = originalFrame;

      // STEP 1: Color collage
      if (colorSegStrength > 0 && enabledTargets.length > 0) {
        const collageRgba = applyColorCollage(
          currentFrame, colorSegStrength, variationSeed, enabledTargets
        );
        currentFrame = {
          rgba: collageRgba,
          delay: currentFrame.delay,
          width: currentFrame.width,
          height: currentFrame.height,
        };
      }

      // STEP 2: Reassembly
      if (reassemblyMap) {
        const reassembledRgba = applyReassemblyToFrame(
          currentFrame, reassemblyMap, silhouetteMask, silhouetteStrength
        );
        currentFrame = {
          rgba: reassembledRgba,
          delay: currentFrame.delay,
          width: currentFrame.width,
          height: currentFrame.height,
        };
      }

      // STEP 3: Geometry
      if (geometryTransform) {
        const geoRgba = applyGeometryToFrame(currentFrame, geometryTransform, f, totalFrames);
        currentFrame = {
          rgba: geoRgba,
          delay: currentFrame.delay,
          width: currentFrame.width,
          height: currentFrame.height,
        };
      }

      // STEP 4: Displacement
      if (displacementField) {
        const modulatedField = applyTemporalConsistency(displacementField, f, totalFrames, 0);
        const warpedRgba = warpFrame(currentFrame, modulatedField, motionMask?.data);
        currentFrame = {
          rgba: warpedRgba,
          delay: currentFrame.delay,
          width: currentFrame.width,
          height: currentFrame.height,
        };
      }

      // STEP 5: Color transform
      if (colorTransform) {
        const coloredRgba = applyColorTransformToFrame(currentFrame, colorTransform);
        currentFrame = {
          rgba: coloredRgba,
          delay: currentFrame.delay,
          width: currentFrame.width,
          height: currentFrame.height,
        };
      }

      variationFrames.push({
        rgba: currentFrame.rgba,
        delay: currentFrame.delay,
        width: currentFrame.width,
        height: currentFrame.height,
      });

      if (f % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }

    const { url, bytes } = await encodeVariation(variationFrames);
    results.push({
      id: `v${v + 1}-${variationSeed}`,
      url, bytes, seed: variationSeed,
    });
    onProgress?.(v + 1, count);
    await new Promise((r) => setTimeout(r, 0));
  }

  return results;
}

export async function previewVariation(
  file: File, similarity: number, seed: number
): Promise<{ frames: Frame[]; width: number; height: number }> {
  const originalFrames = await decodeGif(file);
  if (originalFrames.length === 0) throw new Error('No frames found in GIF');

  const { width, height } = originalFrames[0]!;
  const totalFrames = originalFrames.length;
  const displacementField = generateDisplacementField(width, height, similarity, seed);
  const colorTransform = generateColorTransform(similarity, seed);
  const previewFrameCount = Math.min(8, totalFrames);
  const previewFrames: Frame[] = [];

  for (let f = 0; f < previewFrameCount; f++) {
    const originalFrame = originalFrames[f]!;
    const warpedRgba = warpFrame(originalFrame, displacementField);
    const warpedFrame: Frame = {
      rgba: warpedRgba,
      delay: originalFrame.delay,
      width: originalFrame.width,
      height: originalFrame.height,
    };
    const coloredRgba = applyColorTransformToFrame(warpedFrame, colorTransform);
    previewFrames.push({
      rgba: coloredRgba,
      delay: warpedFrame.delay,
      width: warpedFrame.width,
      height: warpedFrame.height,
    });
  }

  return { frames: previewFrames, width, height };
}
