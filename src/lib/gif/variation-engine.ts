import type { Frame, VariationConfig, VariationResult, MotionMask } from './types';
import { decodeGif } from './decode';
import { encodeVariation } from './encode';
import { generateDisplacementField, warpFrame, applyTemporalConsistency } from './displacement';
import { generateColorTransform, applyColorTransformToFrame } from './color-transform';
import { generateGeometryTransform, applyGeometryToFrame } from './geometry';
import { computeSilhouetteMask } from './silhouette';
import { generateReassemblyMap, applyReassemblyToFrame } from './reassemble';
import { computeMotionMask } from './temporal';
import { moveColorRegions, moveTargetColors } from './color-segmentation';

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
  const geometryStrength = config.geometry ?? 60;
  const colorStrength = config.color ?? 60;
  const flowStrength = config.flow ?? 60;
  const allowMirror = config.mirror ?? false;
  const silhouetteStrength = config.silhouette ?? 50;
  const reassemblyStrength = config.reassembly ?? 0;
  const blockSize = config.blockSize ?? 8;
  const reassemblyMode = config.reassemblyMode ?? 'scatter';
  const colorSegStrength = config.colorSegmentation ?? 0;
  const numColors = config.numColors ?? 12;
  const targetColorsMode = config.targetColorsMode ?? false;
  const targetColors = config.targetColors ?? [];

  const originalFrames = await decodeGif(file);

  if (originalFrames.length === 0) {
    throw new Error('No frames found in GIF');
  }

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
    const flowSim = stageSimilarity(similarity, flowStrength);
    const colorSim = stageSimilarity(similarity, colorStrength);

    const displacementField = generateDisplacementField(width, height, flowSim, variationSeed);
    const colorTransform = generateColorTransform(colorSim, variationSeed);
    const geometryTransform = generateGeometryTransform(
      similarity, geometryStrength, variationSeed, allowMirror
    );

    const reassemblyMap = reassemblyStrength > 0
      ? generateReassemblyMap(width, height, blockSize, reassemblyStrength, variationSeed, reassemblyMode)
      : null;

    const temporalAmplitude = ((100 - flowSim) / 100) * 5;
    const variationFrames: Frame[] = [];

    // Prepare enabled target colors
    const enabledTargets = targetColorsMode
      ? targetColors.filter((t) => t.enabled)
      : [];

    for (let f = 0; f < totalFrames; f++) {
      const originalFrame = originalFrames[f]!;
      let currentFrame: Frame = originalFrame;

      // STEP 1: Color segmentation
      if (colorSegStrength > 0) {
        let segRgba: Uint8ClampedArray;

        if (targetColorsMode && enabledTargets.length > 0) {
          segRgba = moveTargetColors(
            currentFrame,
            colorSegStrength,
            variationSeed,
            enabledTargets
          );
        } else {
          segRgba = moveColorRegions(
            currentFrame,
            colorSegStrength,
            variationSeed,
            numColors
          );
        }

        currentFrame = {
          rgba: segRgba,
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
      const geoRgba = applyGeometryToFrame(currentFrame, geometryTransform, f, totalFrames);
      const geoFrame: Frame = {
        rgba: geoRgba,
        delay: currentFrame.delay,
        width: currentFrame.width,
        height: currentFrame.height,
      };

      // STEP 4: Displacement
      const modulatedField = applyTemporalConsistency(
        displacementField, f, totalFrames, temporalAmplitude
      );
      const warpedRgba = warpFrame(geoFrame, modulatedField, motionMask?.data);
      const warpedFrame: Frame = {
        rgba: warpedRgba,
        delay: geoFrame.delay,
        width: geoFrame.width,
        height: geoFrame.height,
      };

      // STEP 5: Color transform
      const coloredRgba = applyColorTransformToFrame(warpedFrame, colorTransform);

      variationFrames.push({
        rgba: coloredRgba,
        delay: warpedFrame.delay,
        width: warpedFrame.width,
        height: warpedFrame.height,
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
  const temporalAmplitude = ((100 - similarity) / 100) * 5;
  const previewFrameCount = Math.min(8, totalFrames);
  const previewFrames: Frame[] = [];

  for (let f = 0; f < previewFrameCount; f++) {
    const originalFrame = originalFrames[f]!;
    const modulatedField = applyTemporalConsistency(
      displacementField, f, totalFrames, temporalAmplitude
    );
    const warpedRgba = warpFrame(originalFrame, modulatedField);
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
