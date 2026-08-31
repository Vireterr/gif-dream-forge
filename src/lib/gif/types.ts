export interface GifItem {
  id: string;
  url: string;
  seed: number;
  system: string;
  bytes: number;
  width: number;
  height: number;
  frames: number;
  fps: number;
  duration: number;
}

export interface StyleProfile {
  palette: string[];
  motion: number;
  grain: number;
  contrast: number;
  saturation: number;
  brightness: number;
  fps: number;
  frameCount: number;
  sources: number;
  aspect: number;
  thumbs: string[];
  names: string[];
  style: StyleParams;
  color: ColorProfile;
  motionProfile: MotionProfile;
  textureProfile: TextureProfile;
  mode?: string;
  params?: any;
  effects?: any;
}

export interface StyleParams {
  colorVariance: number;
  motionComplexity: number;
  shapeDensity: number;
  symmetry: number;
  noiseAmount: number;
  lineWeight: number;
  speed: number;
  edgeSharpness: number;
  detailLevel: number;
  flow: number;
  repetition: number;
}

export interface ColorProfile {
  palette: string[];
  dominantColors: string[];
  accentColors: string[];
  temperature: "warm" | "cool" | "neutral" | "mixed";
  harmony: "monochromatic" | "complementary" | "analogous" | "triadic" | "mixed";
  contrastRatio: number;
  saturationSpread: number;
  brightnessSpread: number;
  hueDistribution: number[];
}

export interface MotionProfile {
  energy: number;
  complexity: number;
  smoothness: number;
  chaos: number;
  direction: number;
  speedVariance: number;
  acceleration: number;
  oscillation: number;
  rotation: number;
  pulsing: number;
}

export interface TextureProfile {
  grain: number;
  noise: number;
  blur: number;
  sharpness: number;
  pixelation: number;
  glitch: number;
  chromatic: number;
  vignette: number;
  bloom: number;
  posterize: number;
}

export type GenMode = "abstract" | "geometric" | "organic" | "pixel" | "glitch" | "fluid";
export type ColorMode = "palette" | "gradient" | "random" | "profile";

export interface ColorControl {
  mode: ColorMode;
  palette: string[];
  gradientStops: { pos: number; color: string }[];
  saturation: number;
  brightness: number;
  contrast: number;
  hueShift: number;
  colorVariance: number;
  preserveAccents: boolean;
}

export interface PostEffects {
  blur: number;
  pixelate: number;
  grain: number;
  vignette: number;
  chromatic: number;
  glitch: number;
  bloom: number;
  posterize: number;
  noise: number;
  sharpen: number;
}

export interface GenParams {
  mode: GenMode;
  color: ColorControl;
  effects: PostEffects;
  speed: number;
  complexity: number;
  symmetry: number;
  density: number;
  lineWeight: number;
  flow: number;
  repetition: number;
  chaos: number;
}
