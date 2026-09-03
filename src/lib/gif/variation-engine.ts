import type { Frame, VariationConfig, VariationResult, MotionMask } from './types';
import { decodeGif } from './decode';
import { encodeVariation } from './encode';
import { generateDisplacementField, warpFrame, applyTemporalConsistency } from './displacement';
import { generateColorTransform, applyColorTransformToFrame } from './color-transform';
import { generateGeometryTransform, applyGeometryToFrame } from './geometry';
import { computeSilhouetteMask } from './silhouette';
import { computeMotionMask } from './temporal';
import { applyColorCollage } from './color-segmentation';
import { applyReassemblyToFrame } from './reassemble';

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

  const geometryStrength = applySimilarity(config.geometry ?? 0, similarity);
  const colorStrength = applySimilarity(config.color ?? 0, similarity);
  const flowStrength = applySimilarity(config.flow ?? 0, similarity);
  const colorSegStrength = applySimilarity(config.colorSegmentation ?? 0, similarity);
  const silhouetteStrength = applySimilarity(config.silhouette ?? 0, similarity);

  const allowMirror = config.mirror ?? false;
  const blockSize = config.blockSize ?? 50;
  const targetColorsMode = config.targetColorsMode ?? true;
  const targetColors = config.targetColors ?? [];

  const reassemblyConfig = config.reassemblyConfig ?? {
    blocks: { enabled: false, strength: 0, size: 30 },
    stripes: { enabled: false, strength: 0, size: 15 },
    geometric: { enabled: false, strength: 0, size: 20 },
    organic: { enabled: false, strength: 0, size: 30 },
    mask: { enabled: true, strength: 50, smoothness: 50 },
    blendSmoothness: 50,
  };

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

    const anyReassemblyEnabled = reassemblyConfig.blocks.enabled ||
                                  reassemblyConfig.stripes.enabled ||
                                  reassemblyConfig.geometric.enabled ||
                                  reassemblyConfig.organic.enabled;

    const enabledTargets = target
