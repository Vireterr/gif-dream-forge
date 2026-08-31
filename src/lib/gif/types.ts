export interface Frame {
  rgba: Uint8ClampedArray;
  delay: number;
  width: number;
  height: number;
}

export interface VariationConfig {
  similarity: number;
  count: number;
  geometry?: number;
  color?: number;
  flow?: number;
  mirror?: boolean;
  silhouette?: number;
  reassembly?: number;
  blockSize?: number;
  reassemblyMode?: 'scatter' | 'flow' | 'swap' | 'vortex';
  colorSegmentation?: number;
  numColors?: number;
}

export interface ReassemblyMap {
  blockSize: number;
  cols: number;
  rows: number;
  offsetX: Int16Array;
  offsetY: Int16Array;
  flags: Uint8Array;
}

export interface GeometryTransform {
  rotation: number;
  scale: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  shiftX: number;
  shiftY: number;
  swirl: number;
  swirlRadius: number;
  rippleAmp: number;
  rippleFreq: number;
  ripplePhase: number;
  bulge: number;
  mirror: boolean;
  breathing: number;
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
export interface ReassemblyMap {
  blockSize: number;
  cols: number;
  rows: number;
  offsetX: Int16Array;
  offsetY: Int16Array;
  flags: Uint8Array;
  blocks?: Array<{ x: number;
}
