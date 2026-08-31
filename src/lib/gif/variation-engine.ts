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

function stageSimilarity(similarity: number, strength: number): number {
  return 100 - (100 - similarity) * (strength / 100);
}

export async function generateVariations(
  file: File,
  config: VariationConfig,
  onProgress?: (current: number, total: number) => void,
  shouldCancel?: () => boolean
): Promise<VariationResult[]> {
  const { similarity, count } = config;
  const geometryStrength = config.geometry ?? 0;
  const colorStrength = config.color ?? 0;
  const flowStrength = config.flow ?? 0;
  const allowMirror = config.mirror ?? false;
  const silhouetteStrength = config.silhouette ?? 0;
  const reassemblyStrength = config.reassembly ?? 0;
  const blockSize = config.blockSize ?? 32;
  const colorSegStrength = config.colorSegmentation ?? 0;
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

    // 🆕 FIX: Если strength=0, эффект не применяется вообще
    const flowSim = flowStrength > 0 ? stageSimilarity(similarity, flowStrength) : 100;
    const colorSim = colorStrength > 0 ? stageSimilarity(similarity, colorStrength) : 100;

    // 🆕 FIX: Displacement только если flow > 0
    const displacementField = flowStrength > 0
      ? generateDisplacementField(width, height, flowSim, variationSeed)
      : null;

    // 🆕 FIX: Color transform только если color > 0
    const colorTransform = colorStrength > 0
      ? generateColorTransform(colorSim, variationSeed)
      : null;

    // 🆕 FIX: Geometry только если geometry > 0
    const geometryTransform = geometryStrength > 0
      ? generateGeometryTransform(similarity, geometryStrength, variationSeed, allowMirror)
      : null;

    const reassemblyMap = reassemblyStrength > 0 && blockSize > 0
      ? generateReassemblyMap(width, height, blockSize, reassemblyStrength, variationSeed)
      : null;

    const enabledTargets = targetColorsMode
      ? targetColors.filter((t) => t.enabled)
      : [];

    const variationFrames: Frame[] = [];

    for (let f = 0; f < totalFrames; f++) {
      const originalFrame = originalFrames[f]!;
      let currentFrame: Frame = originalFrame;

      // STEP 1: Color collage (только если включено)
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

      // STEP 2: Reassembly (только если включено)
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

      // STEP 3: Geometry (только если включено)
      if (geometryTransform) {
        const geoRgba = applyGeometryToFrame(currentFrame, geometryTransform, f, totalFrames);
        currentFrame = {
          rgba: geoRgba,
          delay: currentFrame.delay,
          width: currentFrame.width,
          height: currentFrame.height,
        };
      }

      // STEP 4: Displacement (только если включено)
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

      // STEP 5: Color transform (только если включено)
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
