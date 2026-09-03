/**
* GIF Variation Engine — consolidated single-file module.
* NO WORKER. NO MASK. Sequential pipeline.
*/

// ============================================================================
// TYPES
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
export interface ReassemblyConfig {
  blocks: ModeConfig;
  stripes: ModeConfig;
  geometric: ModeConfig;
  organic: ModeConfig;
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
// UTILS — noise
// ============================================================================
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
// UTILS — color
// ============================================================================
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s, l];
}

// ============================================================================
// DECODE
// ============================================================================
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
// ENCODE
// ============================================================================
export async function encodeGif(frames: Frame[]): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const gif = GIFEncoder();
  if (frames.length === 0) throw new Error('No frames to encode');
  const { width, height } = frames[0]!;
  let palette: number[][] | null = null;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const rgba = frame.rgba;
    if (!palette) palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    gif.writeFrame(indexed, width, height, {
      palette: i === 0 ? palette : undefined,
      delay: frame.delay
    });
    if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
  }
  gif.finish();
  const bytes = gif.bytes();
  return new Blob([bytes as unknown as BlobPart], { type: 'image/gif' });
}

export async function encodeVariation(frames: Frame[]): Promise<{ blob: Blob; url: string; bytes: number }> {
  const blob = await encodeGif(frames);
  const url = URL.createObjectURL(blob);
  return { blob, url, bytes: blob.size };
}

// ============================================================================
// DISPLACEMENT
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
  const amplitude = k * 50;
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
  return field;
}

// ============================================================================
// COLOR TRANSFORM
// ============================================================================
export function generateColorTransform(
  similarity: number,
  seed: number
): ColorTransform {
  const rand = mulberry32(seed);
  const intensity = (100 - similarity) / 100;
  const hueDirection = rand() > 0.5 ? 1 : -1;
  const satDirection = rand() > 0.5 ? 1 : -1;
  const lightDirection = rand() > 0.5 ? 1 : -1;
  const contrastDirection = rand() > 0.5 ? 1 : -1;
  return {
    hueShift: hueDirection * intensity * 90,
    saturationMul: 1 + satDirection * intensity * 0.7,
    lightnessShift: lightDirection * intensity * 0.4,
    contrastMul: 1 + contrastDirection * intensity * 0.5
  } as unknown as ColorTransform;
}

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
    if (a < 1) {
      output[i] = r;
      output[i + 1] = g;
      output[i + 2] = b;
      output[i + 3] = a;
      continue;
    }
    let [h, s, l] = rgbToHsl(r, g, b);
    h = ((h + t.hueShift) % 360 + 360) % 360;
    s = Math.max(0, Math.min(1, s * t.saturationMul));
    l = Math.max(0, Math.min(1, l + t.lightnessShift));
    const contrastCenter = 0.5;
    l = contrastCenter + (l - contrastCenter) * t.contrastMul;
    l = Math.max(0, Math.min(1, l));
    const [newR, newG, newB] = hslToRgb(h, s, l);
    output[i] = newR;
    output[i + 1] = newG;
    output[i + 2] = newB;
    output[i + 3] = a;
  }
  return output;
}

// ============================================================================
// GEOMETRY
// ============================================================================
export function generateGeometryTransform(
  similarity: number,
  strength: number,
  seed: number,
  allowMirror: boolean
) {
  const k = Math.max(0, Math.min(100, strength)) / 100;
  const rand = mulberry32((seed ^ 0x12345678) >>> 0);
  const rotation = (rand() * 2 - 1) * k * 45;
  const scale = 1 + (rand() * 2 - 1) * k * 0.5;
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
  return { rotation, scale, scaleY, skewX, skewY, shiftX, shiftY, swirl, swirlRadius, rippleAmp, rippleFreq, ripplePhase, bulge, mirror, breathing };
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
      if (transform.mirror) dx = -dx;
      const rx = dx * cosR - dy * sinR;
      const ry = dx * sinR + dy * cosR;
      dx = rx;
      dy = ry;
      dx /= transform.scale * breathe;
      dy /= transform.scaleY * breathe;
      dx += dy * transform.skewX;
      dy += dx * transform.skewY;
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
      const ripple = Math.sin(dist * transform.rippleFreq + transform.ripplePhase) * transform.rippleAmp;
      dx += (dx / (dist + 0.001)) * ripple;
      dy += (dy / (dist + 0.001)) * ripple;
      const bulgeFactor = 1 + transform.bulge * (1 - dist / maxDist);
      dx *= bulgeFactor;
      dy *= bulgeFactor;
      dx += transform.shiftX * width;
      dy += transform.shiftY * height;
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
// SILHOUETTE
// ============================================================================
function silhouetteLuma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

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
// TEMPORAL
// ============================================================================
export function computeMotionMask(
  frame1: Frame,
  frame2: Frame
): MotionMask {
  const { width, height } = frame1;
  const data = new Uint8Array(width * height);
  const diffThreshold = 30;
  const blurRadius = 2;
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
      const normalizedDiff = Math.min(255, (diff / 3) * (255 / diffThreshold));
      rawData[y * width + x] = normalizedDiff;
    }
  }
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

export function applyMotionAwareDisplacement(
  baseDisplacement: { dx: number; dy: number },
  motionMaskValue: number,
  reductionFactor: number = 0.5
): { dx: number; dy: number } {
  const motionIntensity = motionMaskValue / 255;
  const scaleFactor = 1 - motionIntensity * reductionFactor;
  return {
    dx: baseDisplacement.dx * scaleFactor,
    dy: baseDisplacement.dy * scaleFactor
  };
}

export function getTemporalModulation(
  frameIndex: number,
  totalFrames: number,
  amplitude: number
): number {
  const phase = (frameIndex / totalFrames) * Math.PI * 2;
  return Math.sin(phase) * amplitude;
}

// ============================================================================
// COLOR SEGMENTATION
// ============================================================================
function matchesTargetColor(r: number, g: number, b: number, target: TargetColor): boolean {
  const dr = r - target.r;
  const dg = g - target.g;
  const db = b - target.b;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);
  const maxDist = 441;
  const threshold = (target.tolerance / 100) * maxDist;
  return dist <= threshold;
}

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
  const out = new Uint8ClampedArray(src);
  for (let t = 0; t < enabledTargets.length; t++) {
    const target = enabledTargets[t];
    const { dx, dy } = movements[t];
    const isTarget = (r: number, g: number, b: number) =>
      matchesTargetColor(r, g, b, target);
    const pixels: number[] = [];
    for (let i = 0; i < totalPixels; i++) {
      const pi = i * 4;
      const r = src[pi];
      const g = src[pi + 1];
      const b = src[pi + 2];
      const a = src[pi + 3];
      if (a < 30) continue;
      if (isTarget(r, g, b)) pixels.push(i);
    }
    if (pixels.length === 0) continue;
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
// REASSEMBLY — sequential pipeline (NO MASK, NO WORKER)
// ============================================================================

function applyBlocksMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): void {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const blockSize = Math.max(4, Math.round(Math.min(width, height) * percent));
  const cols = Math.max(1, Math.ceil(width / blockSize));
  const rows = Math.max(1, Math.ceil(height / blockSize));
  const maxMove = Math.max(1, Math.round(k * Math.max(cols, rows) * 0.8));
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      if (rand() < 0.7 + k * 0.3) {
        const x0 = bx * blockSize;
        const y0 = by * blockSize;
        const x1 = Math.min(width, x0 + blockSize);
        const y1 = Math.min(height, y0 + blockSize);
        const w = x1 - x0;
        const h = y1 - y0;
        const angle = rand() * Math.PI * 2;
        const dist = (0.3 + rand() * 0.7) * maxMove;
        const ox = Math.round(Math.cos(angle) * dist);
        const oy = Math.round(Math.sin(angle) * dist);
        const pixels = new Uint8ClampedArray(w * h * 4);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const si = (y * width + x) * 4;
            const di = ((y - y0) * w + (x - x0)) * 4;
            pixels[di] = src[si];
            pixels[di + 1] = src[si + 1];
            pixels[di + 2] = src[si + 2];
            pixels[di + 3] = src[si + 3];
          }
        }
        const newX = ((x0 + ox * blockSize) % width + width) % width;
        const newY = ((y0 + oy * blockSize) % height + height) % height;
        for (let ly = 0; ly < h; ly++) {
          for (let lx = 0; lx < w; lx++) {
            const dx = ((newX + lx) % width + width) % width;
            const dy = ((newY + ly) % height + height) % height;
            const di = (dy * width + dx) * 4;
            const si = (ly * w + lx) * 4;
            out[di] = pixels[si];
            out[di + 1] = pixels[si + 1];
            out[di + 2] = pixels[si + 2];
            out[di + 3] = pixels[si + 3];
          }
        }
      }
    }
  }
}

function applyStripesMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): void {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(2, Math.min(50, sizePercent)) / 100;
  const stripeWidth = Math.max(2, Math.round(Math.min(width, height) * percent));
  const maxOffset = Math.round(k * Math.max(width, height) * 0.5);
  const isHorizontal = rand() > 0.5;
  const baseDim = isHorizontal ? height : width;
  let pos = 0;
  while (pos < baseDim) {
    const thickness = Math.max(1, Math.round(stripeWidth * (0.7 + rand() * 0.6)));
    const end = Math.min(baseDim, pos + thickness);
    const offset = Math.round((rand() * 2 - 1) * maxOffset);
    if (offset !== 0) {
      if (isHorizontal) {
        for (let y = pos; y < end; y++) {
          for (let x = 0; x < width; x++) {
            const si = (y * width + x) * 4;
            const newX = ((x + offset) % width + width) % width;
            const di = (y * width + newX) * 4;
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = src[si + 3];
          }
        }
      } else {
        for (let x = pos; x < end; x++) {
          for (let y = 0; y < height; y++) {
            const si = (y * width + x) * 4;
            const newY = ((y + offset) % height + height) % height;
            const di = (newY * width + x) * 4;
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = src[si + 3];
          }
        }
      }
    }
    pos = end;
  }
}

function applyGeometricMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): void {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(3, Math.min(40, sizePercent)) / 100;
  const baseSize = Math.max(8, Math.round(Math.min(width, height) * percent));
  const maxMove = Math.round(k * baseSize * 1.5);
  const numShapes = Math.max(5, Math.round((width * height) / (baseSize * baseSize) * 0.5));
  interface Shape { cx: number; cy: number; size: number; type: number; rotation: number; ox: number; oy: number }
  const shapes: Shape[] = [];
  for (let i = 0; i < numShapes; i++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const size = baseSize * (0.6 + rand() * 0.8);
    const types = [1, 2, 3];
    const type = types[Math.floor(rand() * 3)];
    const rotation = rand() * Math.PI * 2;
    const angle = rand() * Math.PI * 2;
    const dist = (0.3 + rand() * 0.7) * maxMove;
    shapes.push({ cx, cy, size, type, rotation, ox: Math.round(Math.cos(angle) * dist), oy: Math.round(Math.sin(angle) * dist) });
  }
  const isInside = (px: number, py: number, s: Shape) => {
    const cos = Math.cos(-s.rotation);
    const sin = Math.sin(-s.rotation);
    const pdx = px - s.cx;
    const pdy = py - s.cy;
    const rx = Math.abs(pdx * cos - pdy * sin);
    const ry = Math.abs(pdx * sin + pdy * cos);
    if (s.type === 1) {
      const h = s.size * 1.2;
      if (ry < -h / 2 || ry > h / 2) return false;
      return Math.abs(rx) <= (s.size / 2) * (1 - (ry + h / 2) / h);
    }
    if (s.type === 2) return (rx / s.size + ry / s.size) <= 1;
    if (s.type === 3) return rx <= s.size * 0.866 && ry <= s.size * 0.5 && (rx * 0.5 + ry * 0.866) <= s.size * 0.866;
    return false;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const s of shapes) {
        if (isInside(x, y, s)) {
          const newX = ((x + s.ox) % width + width) % width;
          const newY = ((y + s.oy) % height + height) % height;
          const si = (y * width + x) * 4;
          const di = (newY * width + newX) * 4;
          out[di] = src[si];
          out[di + 1] = src[si + 1];
          out[di + 2] = src[si + 2];
          out[di + 3] = src[si + 3];
          break;
        }
      }
    }
  }
}

function applyOrganicMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): void {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const baseCellSize = Math.max(10, Math.round(Math.min(width, height) * percent));
  const numCells = Math.max(3, Math.round((width * height) / (baseCellSize * baseCellSize) * 0.7));
  const maxMove = Math.round(k * baseCellSize * 1.5);
  interface VCell { cx: number; cy: number; ox: number; oy: number }
  const vcells: VCell[] = [];
  for (let i = 0; i < numCells; i++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const angle = rand() * Math.PI * 2;
    const dist = (0.3 + rand() * 0.7) * maxMove;
    vcells.push({ cx, cy, ox: Math.round(Math.cos(angle) * dist), oy: Math.round(Math.sin(angle) * dist) });
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < vcells.length; i++) {
        const dx = x - vcells[i].cx;
        const dy = y - vcells[i].cy;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }
      const cell = vcells[nearestIdx];
      const newX = ((x + cell.ox) % width + width) % width;
      const newY = ((y + cell.oy) % height + height) % height;
      const si = (y * width + x) * 4;
      const di = (newY * width + newX) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
}

// ГЛАВНАЯ ФУНКЦИЯ: последовательное применение режимов
export function applyReassemblyToFrame(
  frame: Frame,
  _blockSize: number,
  config: ReassemblyConfig,
  seed: number,
  silhouetteMask?: Uint8Array,
  silhouetteStrength = 0
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  let current = new Uint8ClampedArray(src);

  // 1. Блоки
  if (config.blocks.enabled && config.blocks.strength > 0) {
    const next = new Uint8ClampedArray(current.length);
    next.set(current);
    applyBlocksMode(current, next, width, height, config.blocks.size, config.blocks.strength, seed);
    current = next;
  }

  // 2. Полосы
  if (config.stripes.enabled && config.stripes.strength > 0) {
    const next = new Uint8ClampedArray(current.length);
    next.set(current);
    applyStripesMode(current, next, width, height, config.stripes.size, config.stripes.strength, seed + 1);
    current = next;
  }

  // 3. Геометрия
  if (config.geometric.enabled && config.geometric.strength > 0) {
    const next = new Uint8ClampedArray(current.length);
    next.set(current);
    applyGeometricMode(current, next, width, height, config.geometric.size, config.geometric.strength, seed + 2);
    current = next;
  }

  // 4. Органика
  if (config.organic.enabled && config.organic.strength > 0) {
    const next = new Uint8ClampedArray(current.length);
    next.set(current);
    applyOrganicMode(current, next, width, height, config.organic.size, config.organic.strength, seed + 3);
    current = next;
  }

  // Защита силуэта
  if (silhouetteMask && silhouetteStrength > 0) {
    current = preserveSilhouette(current, src, silhouetteMask, silhouetteStrength);
  }

  return current;
}

// ============================================================================
// VARIATION ENGINE
// ============================================================================
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
      // Прямой вызов (без Worker)
      if (anyReassemblyEnabled) {
        const reassembledRgba = applyReassemblyToFrame(
          currentFrame,
          50,
          reassemblyConfig,
          variationSeed,
          silhouetteMask,
          silhouetteStrength
        );
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
