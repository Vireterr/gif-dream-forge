/**
 * GIF Variation Engine — consolidated single-file module.
 *
 * Everything the main thread needs to decode a GIF, generate randomized
 * visual variations, and re-encode them, in one place. This is a straight
 * merge of the previously separate modules:
 *   types.ts, decode.ts, encode.ts, displacement.ts, color-transform.ts,
 *   geometry.ts, silhouette.ts, temporal.ts, color-segmentation.ts,
 *   utils/noise.ts (mulberry32 only), utils/color.ts (hslToRgb/rgbToHsl),
 *   and variation-engine.ts.
 *
 * `reassembly.worker.ts` is intentionally NOT merged in — it must stay a
 * separate file so `new Worker(new URL('./reassembly.worker.ts', ...))`
 * keeps working and the heavy block/stripe/geometric/organic reassembly
 * math keeps running off the main thread.
 *
 * No behavior was changed while merging — only module boundaries.
 */

// ============================================================================
// TYPES  (was: types.ts)
// ============================================================================

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

// ============================================================================
// UTILS — noise (was: utils/noise.ts, mulberry32 only — the rest of that
// file, hash/hash01/noiseAt/fbmNoise2D/perlinNoise2D, was unused dead code
// nowhere imported by the live pipeline, so it's dropped here)
// ============================================================================

/**
 * Mulberry32 PRNG for deterministic randomness
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// UTILS — color (was: utils/color.ts, hslToRgb/rgbToHsl only — the
// standalone applyColorTransform() helper from that file was unused
// elsewhere and is dropped here)
// ============================================================================

/**
 * Convert HSL to RGB
 * h: 0-360, s: 0-1, l: 0-1
 * Returns [r, g, b] each 0-255
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r1 = 0, g1 = 0, b1 = 0;

  if (h < 60) {
    r1 = c; g1 = x; b1 = 0;
  } else if (h < 120) {
    r1 = x; g1 = c; b1 = 0;
  } else if (h < 180) {
    r1 = 0; g1 = c; b1 = x;
  } else if (h < 240) {
    r1 = 0; g1 = x; b1 = c;
  } else if (h < 300) {
    r1 = x; g1 = 0; b1 = c;
  } else {
    r1 = c; g1 = 0; b1 = x;
  }

  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ];
}

/**
 * Convert RGB to HSL
 * r, g, b: 0-255
 * Returns [h, s, l] where h: 0-360, s: 0-1, l: 0-1
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return [h * 360, s, l];
}

// ============================================================================
// DECODE  (was: decode.ts)
// ============================================================================

/**
 * GIF Decoder — decodes a GIF file into fully composited RGBA frames.
 * Uses gifuct-js for parsing/LZW and canvas for frame disposal handling.
 */
export async function decodeGif(file: File): Promise<Frame[]> {
  const { parseGIF, decompressFrames } = await import("gifuct-js");
  const buffer = await file.arrayBuffer();
  const gif = parseGIF(buffer);
  const parsed = decompressFrames(gif, true);
  if (!parsed.length) throw new Error("No frames found in GIF");

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create canvas context");

  const patch = document.createElement("canvas");
  const patchCtx = patch.getContext("2d");
  if (!patchCtx) throw new Error("Could not create canvas context");

  const frames: Frame[] = [];
  let previous: ImageData | null = null;

  for (const f of parsed) {
    const disposal = f.disposalType ?? 0;
    if (disposal === 3) previous = ctx.getImageData(0, 0, width, height);

    patch.width = f.dims.width;
    patch.height = f.dims.height;
    patchCtx.putImageData(
      new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height),
      0,
      0,
    );
    ctx.drawImage(patch, f.dims.left, f.dims.top);

    const composited = ctx.getImageData(0, 0, width, height);
    frames.push({
      rgba: new Uint8ClampedArray(composited.data),
      delay: f.delay && f.delay > 0 ? f.delay : 100,
      width,
      height,
    });

    if (disposal === 2) {
      ctx.clearRect(f.dims.left, f.dims.top, f.dims.width, f.dims.height);
    } else if (disposal === 3 && previous) {
      ctx.putImageData(previous, 0, 0);
    }
  }

  return frames;
}

// ============================================================================
// ENCODE  (was: encode.ts)
// ============================================================================

/**
 * Encode frames to a GIF blob
 */
export async function encodeGif(frames: Frame[]): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const gif = GIFEncoder();

  if (frames.length === 0) {
    throw new Error('No frames to encode');
  }

  const { width, height } = frames[0]!;
  let palette: number[][] | null = null;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const rgba = frame.rgba;

    // Quantize on first frame
    if (!palette) {
      palette = quantize(rgba, 256);
    }

    // Apply palette to get indexed colors
    const indexed = applyPalette(rgba, palette);

    // Write frame with original delay
    gif.writeFrame(indexed, width, height, {
      palette: i === 0 ? palette : undefined,
      delay: frame.delay
    });

    // Yield every few frames to prevent blocking
    if (i % 4 === 3) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  gif.finish();
  const bytes = gif.bytes();

  return new Blob([bytes as unknown as BlobPart], { type: 'image/gif' });
}

/**
 * Encode a single variation and return as blob URL
 */
export async function encodeVariation(frames: Frame[]): Promise<{ blob: Blob; url: string; bytes: number }> {
  const blob = await encodeGif(frames);
  const url = URL.createObjectURL(blob);

  return {
    blob,
    url,
    bytes: blob.size
  };
}

// ============================================================================
// DISPLACEMENT  (was: displacement.ts)
// Organic flow: Perlin noise displacement. No temporal consistency —
// stable noise per variation.
// ============================================================================

function displacementFade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function displacementLerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function displacementGrad(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

class DisplacementPerlinNoise {
  private perm: Uint8Array;

  constructor(seed: number) {
    const rand = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = displacementFade(x);
    const v = displacementFade(y);
    const A = this.perm[X] + Y;
    const B = this.perm[X + 1] + Y;
    return displacementLerp(
      displacementLerp(displacementGrad(this.perm[A], x, y), displacementGrad(this.perm[B], x - 1, y), u),
      displacementLerp(displacementGrad(this.perm[A + 1], x, y - 1), displacementGrad(this.perm[B + 1], x - 1, y - 1), u),
      v
    );
  }
}

export function generateDisplacementField(
  width: number,
  height: number,
  strength: number,
  seed: number
): DisplacementField {
  const dx = new Float32Array(width * height);
  const dy = new Float32Array(width * height);

  const k = Math.max(0, Math.min(100, strength)) / 100;
  const amplitude = k * 50; // Increased amplitude
  const frequency = 0.02 + k * 0.03;

  const perlin = new DisplacementPerlinNoise(seed);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      dx[idx] = perlin.noise(x * frequency, y * frequency) * amplitude;
      dy[idx] = perlin.noise(x * frequency + 100, y * frequency + 100) * amplitude;
    }
  }

  return { dx, dy, width, height };
}

export function warpFrame(
  frame: Frame,
  field: DisplacementField,
  _motionMask?: Uint8Array
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);
  const { dx, dy } = field;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const srcX = x - dx[idx];
      const srcY = y - dy[idx];

      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const fx = srcX - x0;
      const fy = srcY - y0;

      const cx0 = Math.max(0, Math.min(width - 1, x0));
      const cx1 = Math.max(0, Math.min(width - 1, x1));
      const cy0 = Math.max(0, Math.min(height - 1, y0));
      const cy1 = Math.max(0, Math.min(height - 1, y1));

      const i00 = (cy0 * width + cx0) * 4;
      const i10 = (cy0 * width + cx1) * 4;
      const i01 = (cy1 * width + cx0) * 4;
      const i11 = (cy1 * width + cx1) * 4;

      const di = idx * 4;
      for (let c = 0; c < 4; c++) {
        const v00 = src[i00 + c];
        const v10 = src[i10 + c];
        const v01 = src[i01 + c];
        const v11 = src[i11 + c];

        const top = v00 + (v10 - v00) * fx;
        const bottom = v01 + (v11 - v01) * fx;
        out[di + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }

  return out;
}

export function applyTemporalConsistency(
  field: DisplacementField,
  _frameIndex: number,
  _totalFrames: number,
  _amplitude: number
): DisplacementField {
  // No temporal consistency — return field as-is
  return field;
}

// ============================================================================
// COLOR TRANSFORM  (was: color-transform.ts)
//
// NOTE (pre-existing, unrelated to this merge): generateColorTransform()
// returns { hueShift, saturationMul, lightnessShift, contrastMul }, but the
// ColorTransform type above declares { hueShift, saturationShift,
// lightnessShift, contrastShift, rCurve, gCurve, bCurve } — the shapes don't
// match. This mismatch already existed in the original color-transform.ts /
// types.ts and is left exactly as-is here to avoid changing behavior.
// ============================================================================

/**
 * Generate a color transform based on similarity and seed
 */
export function generateColorTransform(
  similarity: number,
  seed: number
): ColorTransform {
  const rand = mulberry32(seed);

  // Calculate variation intensity based on similarity
  // Higher similarity = smaller changes
  const intensity = (100 - similarity) / 100;

  // Deterministic random values based on seed
  const hueDirection = rand() > 0.5 ? 1 : -1;
  const satDirection = rand() > 0.5 ? 1 : -1;
  const lightDirection = rand() > 0.5 ? 1 : -1;
  const contrastDirection = rand() > 0.5 ? 1 : -1;

  return {
    // Hue shift: ±90° at 0% similarity, 0° at 100%
    hueShift: hueDirection * intensity * 90,

    // Saturation multiplier: 0.3-1.7 range
    saturationMul: 1 + satDirection * intensity * 0.7,

    // Lightness shift: ±40% at 0% similarity
    lightnessShift: lightDirection * intensity * 0.4,

    // Contrast multiplier: 0.5-1.5 range
    contrastMul: 1 + contrastDirection * intensity * 0.5
  } as unknown as ColorTransform;
}

/**
 * Apply color transform to a frame
 */
export function applyColorTransformToFrame(
  frame: Frame,
  transform: ColorTransform
): Uint8ClampedArray {
  const t = transform as unknown as {
    hueShift: number;
    saturationMul: number;
    lightnessShift: number;
    contrastMul: number;
  };
  const { rgba: srcData } = frame;
  const output = new Uint8ClampedArray(srcData.length);

  for (let i = 0; i < srcData.length; i += 4) {
    const r = srcData[i] ?? 0;
    const g = srcData[i + 1] ?? 0;
    const b = srcData[i + 2] ?? 0;
    const a = srcData[i + 3] ?? 255;

    // Skip fully transparent pixels
    if (a < 1) {
      output[i] = r;
      output[i + 1] = g;
      output[i + 2] = b;
      output[i + 3] = a;
      continue;
    }

    // Convert to HSL
    let [h, s, l] = rgbToHsl(r, g, b);

    // Apply hue shift
    h = ((h + t.hueShift) % 360 + 360) % 360;

    // Apply saturation multiplier
    s = Math.max(0, Math.min(1, s * t.saturationMul));

    // Apply lightness shift
    l = Math.max(0, Math.min(1, l + t.lightnessShift));

    // Apply contrast
    const contrastCenter = 0.5;
    l = contrastCenter + (l - contrastCenter) * t.contrastMul;
    l = Math.max(0, Math.min(1, l));

    // Convert back to RGB
    const [newR, newG, newB] = hslToRgb(h, s, l);

    output[i] = newR;
    output[i + 1] = newG;
    output[i + 2] = newB;
    output[i + 3] = a;
  }

  return output;
}

// ============================================================================
// GEOMETRY  (was: geometry.ts)
// Rotation, scale, distortion. Random values per variation, no modes.
// ============================================================================

export function generateGeometryTransform(
  similarity: number,
  strength: number,
  seed: number,
  allowMirror: boolean
) {
  const k = Math.max(0, Math.min(100, strength)) / 100;
  const rand = mulberry32((seed ^ 0x12345678) >>> 0);

  const rotation = (rand() * 2 - 1) * k * 45; // -45 to +45 degrees
  const scale = 1 + (rand() * 2 - 1) * k * 0.5; // 0.75 to 1.25
  const scaleY = 1 + (rand() * 2 - 1) * k * 0.3;
  const skewX = (rand() * 2 - 1) * k * 0.3;
  const skewY = (rand() * 2 - 1) * k * 0.3;
  const shiftX = (rand() * 2 - 1) * k * 0.2;
  const shiftY = (rand() * 2 - 1) * k * 0.2;
  const swirl = (rand() * 2 - 1) * k * 2;
  const swirlRadius = 0.3 + rand() * 0.4;
  const rippleAmp = k * 20;
  const rippleFreq = 2 + rand() * 5;
  const ripplePhase = rand() * Math.PI * 2;
  const bulge = (rand() * 2 - 1) * k * 0.5;
  const mirror = allowMirror && rand() > 0.7;
  const breathing = k * 0.2;

  return {
    rotation,
    scale,
    scaleY,
    skewX,
    skewY,
    shiftX,
    shiftY,
    swirl,
    swirlRadius,
    rippleAmp,
    rippleFreq,
    ripplePhase,
    bulge,
    mirror,
    breathing,
  };
}

export function applyGeometryToFrame(
  frame: Frame,
  transform: ReturnType<typeof generateGeometryTransform>,
  frameIndex: number,
  totalFrames: number
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);

  const cx = width / 2;
  const cy = height / 2;

  const rotRad = (transform.rotation * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  const t = frameIndex / Math.max(1, totalFrames - 1);
  const breathe = 1 + Math.sin(t * Math.PI * 2) * transform.breathing;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let dx = x - cx;
      let dy = y - cy;

      // Mirror
      if (transform.mirror) {
        dx = -dx;
      }

      // Rotation
      const rx = dx * cosR - dy * sinR;
      const ry = dx * sinR + dy * cosR;
      dx = rx;
      dy = ry;

      // Scale
      dx /= transform.scale * breathe;
      dy /= transform.scaleY * breathe;

      // Skew
      dx += dy * transform.skewX;
      dy += dx * transform.skewY;

      // Swirl
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = Math.sqrt(cx * cx + cy * cy);
      const swirlFactor = Math.max(0, 1 - dist / (maxDist * transform.swirlRadius));
      const swirlAngle = transform.swirl * swirlFactor;
      const cosS = Math.cos(swirlAngle);
      const sinS = Math.sin(swirlAngle);
      const sx = dx * cosS - dy * sinS;
      const sy = dx * sinS + dy * cosS;
      dx = sx;
      dy = sy;

      // Ripple
      const ripple = Math.sin(dist * transform.rippleFreq + transform.ripplePhase) * transform.rippleAmp;
      dx += (dx / (dist + 0.001)) * ripple;
      dy += (dy / (dist + 0.001)) * ripple;

      // Bulge
      const bulgeFactor = 1 + transform.bulge * (1 - dist / maxDist);
      dx *= bulgeFactor;
      dy *= bulgeFactor;

      // Shift
      dx += transform.shiftX * width;
      dy += transform.shiftY * height;

      // Back to pixel coordinates
      const srcX = Math.round(dx + cx);
      const srcY = Math.round(dy + cy);

      const di = (y * width + x) * 4;

      if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
        const si = (srcY * width + srcX) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
      } else {
        out[di] = 0;
        out[di + 1] = 0;
        out[di + 2] = 0;
        out[di + 3] = 0;
      }
    }
  }

  return out;
}

// ============================================================================
// SILHOUETTE  (was: silhouette.ts)
// Silhouette / contour preservation. Builds a mask of the drawing's
// structural edges and blends distorted pixels back toward the original
// there, so the overall shape stays readable while the interior can be
// freely reworked.
// ============================================================================

function silhouetteLuma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Compute a 0-255 silhouette mask: high where contours/edges live.
 */
export function computeSilhouetteMask(frame: Frame): MotionMask {
  const { rgba, width, height } = frame;
  const raw = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const l = silhouetteLuma(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0);
      const a = rgba[i + 3] ?? 255;

      const xr = Math.min(width - 1, x + 1);
      const yd = Math.min(height - 1, y + 1);
      const ir = (y * width + xr) * 4;
      const id = (yd * width + x) * 4;

      const lr = silhouetteLuma(rgba[ir] ?? 0, rgba[ir + 1] ?? 0, rgba[ir + 2] ?? 0);
      const ld = silhouetteLuma(rgba[id] ?? 0, rgba[id + 1] ?? 0, rgba[id + 2] ?? 0);

      const ar = rgba[ir + 3] ?? 255;
      const ad = rgba[id + 3] ?? 255;

      const gradient = Math.abs(l - lr) + Math.abs(l - ld);
      const alphaEdge = Math.abs(a - ar) + Math.abs(a - ad);

      raw[y * width + x] = Math.min(255, gradient * 1.6 + alphaEdge);
    }
  }

  // Dilate + blur so the protected band covers a few pixels around contours.
  const data = new Uint8Array(width * height);
  const r = 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let peak = 0;
      let sum = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const v = raw[ny * width + nx] ?? 0;
          if (v > peak) peak = v;
          sum += v;
          n++;
        }
      }
      const avg = n > 0 ? sum / n : 0;
      data[y * width + x] = Math.round(Math.min(255, peak * 0.6 + avg * 0.8));
    }
  }

  return { data, width, height };
}

/**
 * Blend the transformed frame back toward the original where the silhouette
 * mask is strong. `strength` 0-100: 0 = free deformation, 100 = contour locked.
 */
export function preserveSilhouette(
  transformed: Uint8ClampedArray,
  original: Uint8ClampedArray,
  mask: Uint8Array,
  strength: number
): Uint8ClampedArray {
  if (strength <= 0) return transformed;
  const k = Math.min(100, strength) / 100;
  const out = new Uint8ClampedArray(transformed.length);

  for (let p = 0; p < mask.length; p++) {
    const w = ((mask[p] ?? 0) / 255) * k;
    const i = p * 4;
    for (let c = 0; c < 4; c++) {
      const t = transformed[i + c] ?? 0;
      const o = original[i + c] ?? 0;
      out[i + c] = t + (o - t) * w;
    }
  }

  return out;
}

// ============================================================================
// TEMPORAL  (was: temporal.ts)
// Motion mask computation and temporal smoothing utilities.
// ============================================================================

/**
 * Compute a motion mask by comparing two frames.
 * Returns a mask where high values indicate areas of high motion.
 */
export function computeMotionMask(
  frame1: Frame,
  frame2: Frame
): MotionMask {
  const { width, height } = frame1;
  const data = new Uint8Array(width * height);

  const diffThreshold = 30; // Pixel difference threshold for "motion"
  const blurRadius = 2; // Simple box blur radius

  // First pass: compute raw differences
  const rawData = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      let diff = 0;
      for (let c = 0; c < 3; c++) {
        const v1 = frame1.rgba[idx + c] ?? 0;
        const v2 = frame2.rgba[idx + c] ?? 0;
        diff += Math.abs(v1 - v2);
      }

      // Normalize to 0-255 range
      const normalizedDiff = Math.min(255, (diff / 3) * (255 / diffThreshold));
      rawData[y * width + x] = normalizedDiff;
    }
  }

  // Second pass: apply simple box blur to smooth the mask
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;

      for (let dy = -blurRadius; dy <= blurRadius; dy++) {
        for (let dx = -blurRadius; dx <= blurRadius; dx++) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            sum += rawData[ny * width + nx] ?? 0;
            count++;
          }
        }
      }

      data[y * width + x] = Math.round(sum / count);
    }
  }

  return { data, width, height };
}

/**
 * Apply motion-aware displacement scaling.
 * Reduces displacement in areas with high motion to prevent artifacts.
 */
export function applyMotionAwareDisplacement(
  baseDisplacement: { dx: number; dy: number },
  motionMaskValue: number,
  reductionFactor: number = 0.5
): { dx: number; dy: number } {
  // Normalize motion value to 0-1
  const motionIntensity = motionMaskValue / 255;

  // Scale factor: 1.0 for no motion, (1 - reductionFactor) for max motion
  const scaleFactor = 1 - motionIntensity * reductionFactor;

  return {
    dx: baseDisplacement.dx * scaleFactor,
    dy: baseDisplacement.dy * scaleFactor
  };
}

/**
 * Generate a temporal modulation signal for smooth animation.
 * Uses sine wave for seamless looping.
 */
export function getTemporalModulation(
  frameIndex: number,
  totalFrames: number,
  amplitude: number
): number {
  const phase = (frameIndex / totalFrames) * Math.PI * 2;
  return Math.sin(phase) * amplitude;
}

// ============================================================================
// COLOR SEGMENTATION  (was: color-segmentation.ts)
// Color-based collage: selected colors are cut out as solid shapes and
// moved to new positions. Background fills old positions with average
// neighbor color. Stable across all frames.
// ============================================================================

function matchesTargetColor(
  r: number,
  g: number,
  b: number,
  target: TargetColor
): boolean {
  const dr = r - target.r;
  const dg = g - target.g;
  const db = b - target.b;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);
  const maxDist = 441;
  const threshold = (target.tolerance / 100) * maxDist;
  return dist <= threshold;
}

/**
 * Get average color of non-target neighbors (for background fill).
 */
function getAverageBackground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  isTarget: (r: number, g: number, b: number) => boolean
): { r: number; g: number; b: number; a: number } {
  let sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0;
  const r2 = radius * radius;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = (ny * width + nx) * 4;
      const nr = rgba[ni];
      const ng = rgba[ni + 1];
      const nb = rgba[ni + 2];
      const na = rgba[ni + 3];
      if (!isTarget(nr, ng, nb)) {
        sumR += nr;
        sumG += ng;
        sumB += nb;
        sumA += na;
        count++;
      }
    }
  }

  if (count === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
    a: Math.round(sumA / count),
  };
}

/**
 * Apply color collage: cut out target colors and move them.
 * Uses SAME movement for all frames (stable).
 */
export function applyColorCollage(
  frame: Frame,
  strength: number,
  seed: number,
  targets: TargetColor[]
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const k = Math.max(0, Math.min(100, strength)) / 100;
  const totalPixels = width * height;

  if (k <= 0 || targets.length === 0) return new Uint8ClampedArray(src);

  const enabledTargets = targets.filter((t) => t.enabled);
  if (enabledTargets.length === 0) return new Uint8ClampedArray(src);

  // Generate movement for each target (SAME for all frames)
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const maxDim = Math.max(width, height);
  const moveRadius = Math.max(4, Math.round(k * maxDim * 0.4));

  const movements = enabledTargets.map(() => {
    const angle = rand() * Math.PI * 2;
    const dist = (0.4 + rand() * 0.6) * moveRadius;
    return {
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist),
    };
  });

  // Build output
  const out = new Uint8ClampedArray(src);

  // For each target, find pixels and move them
  for (let t = 0; t < enabledTargets.length; t++) {
    const target = enabledTargets[t];
    const { dx, dy } = movements[t];

    const isTarget = (r: number, g: number, b: number) =>
      matchesTargetColor(r, g, b, target);

    // Find all pixels of this color
    const pixels: number[] = [];
    for (let i = 0; i < totalPixels; i++) {
      const pi = i * 4;
      const r = src[pi];
      const g = src[pi + 1];
      const b = src[pi + 2];
      const a = src[pi + 3];
      if (a < 30) continue;
      if (isTarget(r, g, b)) {
        pixels.push(i);
      }
    }

    if (pixels.length === 0) continue;

    // Fill old positions with background color
    for (const idx of pixels) {
      const x = idx % width;
      const y = (idx - x) / width;
      const bg = getAverageBackground(src, width, height, x, y, 5, isTarget);
      const di = idx * 4;
      out[di] = bg.r;
      out[di + 1] = bg.g;
      out[di + 2] = bg.b;
      out[di + 3] = bg.a;
    }

    // Place at new position
    for (const idx of pixels) {
      const ox = idx % width;
      const oy = (idx - ox) / width;
      const nx = ((ox + dx) % width + width) % width;
      const ny = ((oy + dy) % height + height) % height;
      const ni = ny * width + nx;
      const si = idx * 4;
      const di = ni * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }

  return out;
}

/**
 * Legacy function for backward compatibility.
 */
export function moveTargetColors(
  frame: Frame,
  strength: number,
  seed: number,
  targets: TargetColor[],
  _pixelSize: number = 1
): Uint8ClampedArray {
  return applyColorCollage(frame, strength, seed, targets);
}

export function moveColorRegions(
  frame: Frame,
  _strength: number,
  _seed: number,
  _numColors: number = 12,
  _pixelSize: number = 1
): Uint8ClampedArray {
  return new Uint8ClampedArray(frame.rgba);
}

// ============================================================================
// VARIATION ENGINE  (was: variation-engine.ts)
// Orchestrates the full per-frame pipeline and talks to the (separate)
// reassembly Web Worker.
// ============================================================================

// Создаем Web Worker для reassembly
let reassemblyWorker: Worker | null = null;

function getReassemblyWorker(): Worker {
  if (!reassemblyWorker) {
    reassemblyWorker = new Worker(
      new URL('./reassembly.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return reassemblyWorker;
}

/** Terminates the shared reassembly worker, if one was created. */
export function disposeReassemblyWorker() {
  reassemblyWorker?.terminate();
  reassemblyWorker = null;
}

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
  const targetColorsMode = config.targetColorsMode ?? true;
  const targetColors = config.targetColors ?? [];

  const reassemblyConfig: ReassemblyConfig = config.reassemblyConfig ?? {
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

    const enabledTargets = targetColorsMode
      ? targetColors.filter((t) => t.enabled)
      : [];

    const variationFrames: Frame[] = [];

    for (let f = 0; f < totalFrames; f++) {
      const originalFrame = originalFrames[f]!;
      let currentFrame: Frame = originalFrame;

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

      // Используем Web Worker для reassembly
      if (anyReassemblyEnabled) {
        const worker = getReassemblyWorker();
        const reassembledRgba = await new Promise<Uint8ClampedArray>((resolve) => {
          worker.onmessage = (e) => {
            resolve(new Uint8ClampedArray(e.data.rgba));
          };
          worker.postMessage({
            frame: currentFrame,
            config: reassemblyConfig,
            seed: variationSeed,
            silhouetteMask,
            silhouetteStrength,
          });
        });

        currentFrame = {
          rgba: reassembledRgba,
          delay: currentFrame.delay,
          width: currentFrame.width,
          height: currentFrame.height,
        };
      }

      if (geometryTransform) {
        const geoRgba = applyGeometryToFrame(currentFrame, geometryTransform, f, totalFrames);
        currentFrame = {
          rgba: geoRgba,
          delay: currentFrame.delay,
          width: currentFrame.width,
          height: currentFrame.height,
        };
      }

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
