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
  const pixelSize = config.pixelSize ?? 1;  // ← НОВОЕ

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
