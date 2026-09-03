export interface Frame {
  rgba: Uint8ClampedArray;
  delay: number;
  width: number;
  height: number;
}

export interface DisplacementField {
  dx: Float32Array;
  dy: Float32Array;
  width: number;
  height: number;
}

export interface ColorTransform {
  hueShift: number;
  saturationShift: number;
  lightnessShift: number;
  contrastShift: number;
  rCurve: Float32Array;
  gCurve: Float32Array;
  bCurve: Float32Array;
}

export interface GeometryTransform {
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  swirlAmount: number;
  swirlCenterX: number;
  swirlCenterY: number;
}

export interface MotionMask {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface ReassemblyMap {
  blockSize: number;
  cols: number;
  rows: number;
  offsetX: Int16Array;
  offsetY: Int16Array;
  flags: Uint8Array;
}

export interface SilhouetteMask {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface TargetColor {
  id: string;
  r: number;
  g: number;
  b: number;
  tolerance: number;
  enabled: boolean;
}

export type ReassemblyMode = 'blocks' | 'stripes' | 'geometric' | 'organic';

export interface ModeConfig {
  enabled: boolean;
  strength: number;
  size: number;
}

export interface MaskConfig {
  enabled: boolean;
  strength: number;
  smoothness: number;
}

export interface ReassemblyConfig {
  blocks: ModeConfig;
  stripes: ModeConfig;
  geometric: ModeConfig;
  organic: ModeConfig;
  mask: MaskConfig;
  blendSmoothness: number;
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
  reassemblyConfig?: ReassemblyConfig;
  colorSegmentation?: number;
  numColors?: number;
  targetColorsMode?: boolean;
  targetColors?: TargetColor[];
}

export interface VariationResult {
  id: string;
  url: string;
  bytes: number;
  seed: number;
}
