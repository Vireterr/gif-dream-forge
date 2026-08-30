export interface Frame {
  rgba: Uint8ClampedArray;
  delay: number;
  width: number;
  height: number;
}

export interface VariationConfig {
  similarity: number; // 0-100
  count: number;      // 1-100
}

export interface VariationResult {
  id: string;
  url: string;
  bytes: number;
  seed: number;
}

export interface DisplacementField {
  dx: Float32Array;
  dy: Float32Array;
  width: number;
  height: number;
}

export interface ColorTransform {
  hueShift: number;
  saturationMul: number;
  lightnessShift: number;
  contrastMul: number;
}

export interface MotionMask {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * GIF parsing types
 */
export interface GifDescriptor {
  width: number;
  height: number;
  globalColorTable?: number[][];
  backgroundColorIndex?: number;
  pixelAspectRatio?: number;
}

export interface GifFrame {
  imageData: ImageData;
  delay: number;
  disposalType?: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ParsedGif {
  descriptor: GifDescriptor;
  frames: GifFrame[];
  totalDelay: number;
}
