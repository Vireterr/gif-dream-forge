export type RGB = [number, number, number];

export interface StyleProfile {
  /** Ordered palette (dark -> light), hex strings */
  palette: string[];
  /** Dominant / background color */
  background: string;
  /** 0..1 average motion energy between frames */
  motion: number;
  /** 0..1 high-frequency detail / grain */
  grain: number;
  /** 0..1 */
  contrast: number;
  /** 0..1 */
  saturation: number;
  /** 0..1 */
  brightness: number;
  /** frames per second of the sources */
  fps: number;
  /** average frame count */
  frameCount: number;
  /** width / height */
  aspect: number;
  /** analysed source count */
  sources: number;
  /** per-source thumbnails (data urls) */
  thumbs: string[];
  /** source file names */
  names: string[];
}

export interface GifItem {
  id: string;
  seed: number;
  system: string;
  url: string;
  bytes: number;
}
