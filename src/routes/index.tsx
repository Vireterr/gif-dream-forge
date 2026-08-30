import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GIF Variation Studio" },
      { name: "description", content: "Upload a GIF and generate multiple visual variations while preserving its identity." },
    ],
  }),
  component: Studio,
});

// ============================================================
// TYPES
// ============================================================
interface Frame {
  rgba: Uint8ClampedArray;
  delay: number;
  width: number;
  height: number;
}

interface VariationResult {
  id: string;
  url: string;
  bytes: number;
}

interface DisplacementField {
  dx: Float32Array;
  dy: Float32Array;
}

// ============================================================
// NOISE
// ============================================================
function hash(n: number): number {
  n = n | 0;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b) | 0;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b) | 0;
  n = (n ^ (n >>> 16)) | 0;
  return 1 - ((n & 0x7fffffff) / 1073741823.5);
}

const NOISE_TABLE_SIZE = 4096;
const noiseTable = new Float32Array(NOISE_TABLE_SIZE);
for (let i = 0; i < NOISE_TABLE_SIZE; i++) noiseTable[i] = hash(i);

function noiseAt(n: number): number {
  return noiseTable[((n % NOISE_TABLE_SIZE) + NOISE_TABLE_SIZE) % NOISE_TABLE_SIZE];
}

function perlinNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const n00 = noiseAt(ix + iy * 57 + seed);
  const n10 = noiseAt(ix + 1 + iy * 57 + seed);
  const n01 = noiseAt(ix + (iy + 1) * 57 + seed);
  const n11 = noiseAt(ix + 1 + (iy + 1) * 57 + seed);
  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return nx0 + (nx1 - nx0) * uy;
}

function fbmNoise2D(x: number, y: number, seed: number, octaves = 4): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += perlinNoise2D(x * frequency, y * frequency, seed + i * 1000) * amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}

function detRand(seed: number, offset: number): number {
  const x = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ============================================================
// GIF DECODER (с disposal method и прозрачностью)
// ============================================================
async function decodeGif(file: File): Promise<Frame[]> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  if (signature !== "GIF") throw new Error("Not a valid GIF file");

  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const hasGlobalColorTable = (bytes[10] & 0x80) !== 0;
  const globalColorTableSize = hasGlobalColorTable
    ? Math.pow(2, (bytes[10] & 0x07) + 1)
    : 0;

  let offset = 13;
  const globalPalette: [number, number, number][] = [];
  if (hasGlobalColorTable) {
    for (let i = 0; i < globalColorTableSize; i++) {
      globalPalette.push([bytes[offset], bytes[offset + 1], bytes[offset + 2]]);
      offset += 3;
    }
  }

  const frames: Frame[] = [];
  let delay = 100;
  let transparentIndex = -1;
  let disposalMethod = 0;

  const composite = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    composite[i * 4] = 255;
    composite[i * 4 + 1] = 255;
    composite[i * 4 + 2] = 255;
    composite[i * 4 + 3] = 255;
  }

  let previousComposite: Uint8ClampedArray | null = null;

  while (offset < bytes.length) {
    const blockType = bytes[offset];

    if (blockType === 0x21) {
      const extensionLabel = bytes[offset + 1];

      if (extensionLabel === 0xf9) {
        const packed = bytes[offset + 3];
        disposalMethod = (packed >> 2) & 0x07;
        const hasTransparency = (packed & 0x01) !== 0;
        delay = (bytes[offset + 4] | (bytes[offset + 5] << 8)) * 10;
        if (delay === 0) delay = 100;
        transparentIndex = hasTransparency ? bytes[offset + 6] : -1;
      }

      offset += 2;
      while (offset < bytes.length && bytes[offset] !== 0) {
        offset += bytes[offset] + 1;
      }
      if (offset < bytes.length) offset++;
    } else if (blockType === 0x2c) {
      const imgLeft = bytes[offset + 1] | (bytes[offset + 2] << 8);
      const imgTop = bytes[offset + 3] | (bytes[offset + 4] << 8);
      const imgWidth = bytes[offset + 5] | (bytes[offset + 6] << 8);
      const imgHeight = bytes[offset + 7] | (bytes[offset + 8] << 8);
      const hasLocalColorTable = (bytes[offset + 9] & 0x80) !== 0;
      const localColorTableSize = hasLocalColorTable
        ? Math.pow(2, (bytes[offset + 9] & 0x07) + 1)
        : 0;

      offset += 10;

      const palette: [number, number, number][] = hasLocalColorTable
        ? []
        : globalPalette;
      if (hasLocalColorTable) {
        for (let i = 0; i < localColorTableSize; i++) {
          palette.push([bytes[offset], bytes[offset + 1], bytes[offset + 2]]);
          offset += 3;
        }
      }

      const lzwMinCodeSize = bytes[offset];
      offset++;

      const lzwData: number[] = [];
      while (offset < bytes.length && bytes[offset] !== 0) {
        const blockSize = bytes[offset];
        for (let i = 0; i < blockSize; i++) {
          lzwData.push(bytes[offset + 1 + i]);
        }
        offset += blockSize + 1;
      }
      if (offset < bytes.length) offset++;

      const decoded = decodeLZW(lzwData, lzwMinCodeSize);

      if (disposalMethod === 3) {
        previousComposite = new Uint8ClampedArray(composite);
      }

      for (let y = 0; y < imgHeight; y++) {
        for (let x = 0; x < imgWidth; x++) {
          const srcIdx = y * imgWidth + x;
          const colorIdx = decoded[srcIdx];

          if (colorIdx === undefined || colorIdx >= palette.length) continue;
          if (colorIdx === transparentIndex) continue;

          const [r, g, b] = palette[colorIdx];
          const dstX = imgLeft + x;
          const dstY = imgTop + y;

          if (dstX < 0 || dstX >= width || dstY < 0 || dstY >= height) continue;

          const dstIdx = (dstY * width + dstX) * 4;
          composite[dstIdx] = r;
          composite[dstIdx + 1] = g;
          composite[dstIdx + 2] = b;
          composite[dstIdx + 3] = 255;
        }
      }

      frames.push({
        rgba: new Uint8ClampedArray(composite),
        delay,
        width,
        height,
      });

      if (disposalMethod === 2) {
        for (let y = 0; y < imgHeight; y++) {
          for (let x = 0; x < imgWidth; x++) {
            const dstX = imgLeft + x;
            const dstY = imgTop + y;
            if (dstX < 0 || dstX >= width || dstY < 0 || dstY >= height) continue;
            const dstIdx = (dstY * width + dstX) * 4;
            composite[dstIdx] = 255;
            composite[dstIdx + 1] = 255;
            composite[dstIdx + 2] = 255;
            composite[dstIdx + 3] = 255;
          }
        }
      } else if (disposalMethod === 3 && previousComposite) {
        composite.set(previousComposite);
      }
    } else if (blockType === 0x3b) {
      break;
    } else {
      offset++;
    }
  }

  return frames;
}

function decodeLZW(data: number[], minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let codeMask = (1 << codeSize) - 1;

  const dictionary: Map<number, number[]> = new Map();
  for (let i = 0; i < clearCode; i++) dictionary.set(i, [i]);

  const output: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let dataIdx = 0;

  function readCode(): number {
    while (bitCount < codeSize) {
      if (dataIdx >= data.length) return -1;
      bitBuffer |= data[dataIdx++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuffer & codeMask;
    bitBuffer >>= codeSize;
    bitCount -= codeSize;
    return code;
  }

  let code = readCode();
  if (code !== clearCode) return output;

  code = readCode();
  if (code === eoiCode) return output;

  let previous = dictionary.get(code) || [];
  output.push(...previous);

  while (true) {
    code = readCode();
    if (code === -1) break;

    if (code === clearCode) {
      dictionary.clear();
      for (let i = 0; i < clearCode; i++) dictionary.set(i, [i]);
      codeSize = minCodeSize + 1;
      codeMask = (1 << codeSize) - 1;

      code = readCode();
      if (code === eoiCode) break;

      previous = dictionary.get(code) || [];
      output.push(...previous);
      continue;
    }

    if (code === eoiCode) break;

    let entry: number[];
    if (dictionary.has(code)) {
      entry = dictionary.get(code)!;
    } else if (code === dictionary.size) {
      entry = [...previous, previous[0]];
    } else {
      break;
    }

    output.push(...entry);

    if (dictionary.size < 4096) {
      dictionary.set(dictionary.size, [...previous, entry[0]]);
      if (dictionary.size > codeMask && codeSize < 12) {
        codeSize++;
        codeMask = (1 << codeSize) - 1;
      }
    }

    previous = entry;
  }

  return output;
}

// ============================================================
// GIF ENCODER
// ============================================================
async function encodeGif(frames: Frame[]): Promise<Blob> {
  const gif = GIFEncoder();

  for (const frame of frames) {
    const { rgba, width, height, delay } = frame;
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, width, height, { palette, delay });
  }

  gif.finish();

  const bytes = gif.bytesView();
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);

  return new Blob([buf], { type: "image/gif" });
}

// ============================================================
// DISPLACEMENT + WARP (УСИЛЕННЫЙ)
// ============================================================
function generateDisplacementField(
  width: number,
  height: number,
  seed: number,
  amplitude: number,
  frequency: number
): DisplacementField {
  const dx = new Float32Array(width * height);
  const dy = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      dx[idx] = (fbmNoise2D(x * frequency, y * frequency, seed) - 0.5) * 2 * amplitude;
      dy[idx] =
        (fbmNoise2D(x * frequency, y * frequency, seed + 10000) - 0.5) * 2 * amplitude;
    }
  }

  return { dx, dy };
}

function warpFrame(
  source: Uint8ClampedArray,
  dx: Float32Array,
  dy: Float32Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const srcX = x + dx[idx];
      const srcY = y + dy[idx];

      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      const fx = srcX - x0;
      const fy = srcY - y0;

      const cx0 = Math.max(0, Math.min(width - 1, x0));
      const cy0 = Math.max(0, Math.min(height - 1, y0));
      const cx1 = Math.max(0, Math.min(width - 1, x1));
      const cy1 = Math.max(0, Math.min(height - 1, y1));

      const idx00 = (cy0 * width + cx0) * 4;
      const idx10 = (cy0 * width + cx1) * 4;
      const idx01 = (cy1 * width + cx0) * 4;
      const idx11 = (cy1 * width + cx1) * 4;

      const dstIdx = idx * 4;

      for (let c = 0; c < 4; c++) {
        const v00 = source[idx00 + c];
        const v10 = source[idx10 + c];
        const v01 = source[idx01 + c];
        const v11 = source[idx11 + c];

        const v0 = v00 + (v10 - v00) * fx;
        const v1 = v01 + (v11 - v01) * fx;
        output[dstIdx + c] = Math.round(v0 + (v1 - v0) * fy);
      }
    }
  }

  return output;
}

// ============================================================
// BLOCK SHUFFLE (УСИЛЕННЫЙ — большие блоки)
// ============================================================
function blockShuffle(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  seed: number,
  similarity: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(source);

  // УСИЛЕНО: от 8 до 40 пикселей (было 4-20)
  const blockSize = Math.max(8, Math.floor(((100 - similarity) / 100) * 40));
  if (blockSize < 8) return output;

  const blocksX = Math.floor(width / blockSize);
  const blocksY = Math.floor(height / blockSize);
  const totalBlocks = blocksX * blocksY;

  if (totalBlocks < 4) return output;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const r = detRand(seed, by * blocksX + bx);
      if (r > 0.4) continue; // 40% блоков переставляются (было 30%)

      const otherBx = Math.floor(detRand(seed, by * blocksX + bx + 1000) * blocksX);
      const otherBy = Math.floor(detRand(seed, by * blocksX + bx + 2000) * blocksY);

      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const x1 = bx * blockSize + dx;
          const y1 = by * blockSize + dy;
          const x2 = otherBx * blockSize + dx;
          const y2 = otherBy * blockSize + dy;

          if (x1 >= width || y1 >= height || x2 >= width || y2 >= height) continue;

          const idx1 = (y1 * width + x1) * 4;
          const idx2 = (y2 * width + x2) * 4;

          for (let c = 0; c < 4; c++) {
            const temp = output[idx1 + c];
            output[idx1 + c] = output[idx2 + c];
            output[idx2 + c] = temp;
          }
        }
      }
    }
  }

  return output;
}

// ============================================================
// SWIRL (УСИЛЕННЫЙ — больший угол)
// ============================================================
function swirl(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  seed: number,
  similarity: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height * 4);

  // УСИЛЕНО: до 3π (было 2π)
  const maxAngle = ((100 - similarity) / 100) * Math.PI * 3;
  if (maxAngle < 0.1) return new Uint8ClampedArray(source);

  const cx = width * (0.3 + detRand(seed, 0) * 0.4);
  const cy = height * (0.3 + detRand(seed, 1) * 0.4);
  // УСИЛЕНО: радиус до 50% (было 20-50%)
  const radius = Math.min(width, height) * (0.3 + detRand(seed, 2) * 0.2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > radius) {
        const idx = (y * width + x) * 4;
        output[idx] = source[idx];
        output[idx + 1] = source[idx + 1];
        output[idx + 2] = source[idx + 2];
        output[idx + 3] = source[idx + 3];
      } else {
        const angle = (1 - dist / radius) * maxAngle;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const srcX = Math.round(cx + dx * cos - dy * sin);
        const srcY = Math.round(cy + dx * sin + dy * cos);

        const clampedX = Math.max(0, Math.min(width - 1, srcX));
        const clampedY = Math.max(0, Math.min(height - 1, srcY));

        const srcIdx = (clampedY * width + clampedX) * 4;
        const dstIdx = (y * width + x) * 4;

        output[dstIdx] = source[srcIdx];
        output[dstIdx + 1] = source[srcIdx + 1];
        output[dstIdx + 2] = source[srcIdx + 2];
        output[dstIdx + 3] = source[srcIdx + 3];
      }
    }
  }

  return output;
}

// ============================================================
// EDGE DISTORT (УСИЛЕННЫЙ)
// ============================================================
function distortEdges(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  seed: number,
  similarity: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(source);
  // УСИЛЕНО: до 8 пикселей (было 4)
  const maxEdgeShift = Math.floor(((100 - similarity) / 100) * 8);
  if (maxEdgeShift < 1) return output;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const right = (y * width + x + 1) * 4;
      const below = ((y + 1) * width + x) * 4;

      const diffR =
        Math.abs(source[idx] - source[right]) +
        Math.abs(source[idx + 1] - source[right + 1]) +
        Math.abs(source[idx + 2] - source[right + 2]);
      const diffB =
        Math.abs(source[idx] - source[below]) +
        Math.abs(source[idx + 1] - source[below + 1]) +
        Math.abs(source[idx + 2] - source[below + 2]);

      if (diffR > 60 || diffB > 60) {
        const dx = Math.floor((detRand(seed, idx + 100) - 0.5) * 2 * maxEdgeShift);
        const dy = Math.floor((detRand(seed, idx + 200) - 0.5) * 2 * maxEdgeShift);
        const srcIdx = ((y + dy) * width + (x + dx)) * 4;

        output[idx] = source[srcIdx];
        output[idx + 1] = source[srcIdx + 1];
        output[idx + 2] = source[srcIdx + 2];
      }
    }
  }

  return output;
}

// ============================================================
// TEMPORAL CONSISTENCY
// ============================================================
function computeMotionMask(frames: Frame[]): Uint8Array {
  if (frames.length < 2) {
    return new Uint8Array(frames[0].width * frames[0].height);
  }

  const width = frames[0].width;
  const height = frames[0].height;
  const mask = new Uint8Array(width * height);
  const threshold = 30;

  const frame1 = frames[0].rgba;
  const frame2 = frames[1].rgba;

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const diff =
      Math.abs(frame1[idx] - frame2[idx]) +
      Math.abs(frame1[idx + 1] - frame2[idx + 1]) +
      Math.abs(frame1[idx + 2] - frame2[idx + 2]);

    mask[i] = diff > threshold ? 1 : 0;
  }

  return mask;
}

function applyTemporalConsistency(
  displacement: Float32Array,
  motionMask: Uint8Array,
  frameIndex: number,
  totalFrames: number,
  temporalAmplitude: number
): Float32Array {
  const result = new Float32Array(displacement.length);
  const temporalPhase = (frameIndex / totalFrames) * Math.PI * 2;
  const temporalFactor = Math.sin(temporalPhase) * temporalAmplitude;

  for (let i = 0; i < displacement.length; i++) {
    const motion = motionMask[i];
    const motionReduction = motion * 0.15;
    result[i] = displacement[i] * (1 - motionReduction) + temporalFactor;
  }

  return result;
}

// ============================================================
// VARIATION ENGINE (УСИЛЕННЫЕ ПАРАМЕТРЫ)
// ============================================================
async function generateVariations(
  frames: Frame[],
  similarity: number,
  count: number,
  onProgress?: (progress: number) => void,
  onCancel?: () => boolean
): Promise<VariationResult[]> {
  const motionMask = computeMotionMask(frames);

  // УСИЛЕНО: амплитуда до 50px (было 35)
  const displacementAmplitude = ((100 - similarity) / 100) * 50;
  // УСИЛЕНО: частота до 0.25 (было 0.15) — более детальные искажения
  const displacementFrequency = 0.05 + ((100 - similarity) / 100) * 0.2;
  const temporalAmplitude = displacementAmplitude * 0.15;

  const results: VariationResult[] = [];

  for (let i = 0; i < count; i++) {
    if (onCancel && onCancel()) break;

    const seed = Math.floor(Math.random() * 1e9);
    const variationFrames: Frame[] = [];

    const baseField = generateDisplacementField(
      frames[0].width,
      frames[0].height,
      seed,
      displacementAmplitude,
      displacementFrequency
    );

    for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
      const originalFrame = frames[frameIdx];

      const dx = applyTemporalConsistency(
        baseField.dx,
        motionMask,
        frameIdx,
        frames.length,
        temporalAmplitude
      );

      const dy = applyTemporalConsistency(
        baseField.dy,
        motionMask,
        frameIdx,
        frames.length,
        temporalAmplitude
      );

      // 1. Warp (displacement)
      const warped = warpFrame(
        originalFrame.rgba,
        dx,
        dy,
        originalFrame.width,
        originalFrame.height
      );

      // 2. Block shuffle (перестановка блоков)
      const shuffled = blockShuffle(
        warped,
        originalFrame.width,
        originalFrame.height,
        seed,
        similarity
      );

      // 3. Swirl (закручивание)
      const swirled = swirl(
        shuffled,
        originalFrame.width,
        originalFrame.height,
        seed + 5000,
        similarity
      );

      // 4. Edge distort (искажение контуров)
      const distorted = distortEdges(
        swirled,
        originalFrame.width,
        originalFrame.height,
        seed + 10000,
        similarity
      );

      variationFrames.push({
        rgba: new Uint8ClampedArray(distorted),
        delay: originalFrame.delay,
        width: originalFrame.width,
        height: originalFrame.height,
      });
    }

    const blob = await encodeGif(variationFrames);

    results.push({
      id: `variation_${String(i + 1).padStart(2, "0")}`,
      url: URL.createObjectURL(blob),
      bytes: blob.size,
    });

    if (onProgress) onProgress((i + 1) / count);

    await new Promise((r) => setTimeout(r, 0));
  }

  return results;
}

// ============================================================
// UI
// ============================================================
type Stage = "idle" | "decoding" | "ready" | "generating";

function Studio() {
  const [file, setFile] = useState<File | null>(null);
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [variations, setVariations] = useState<VariationResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [similarity, setSimilarity] = useState(75);
  const [count, setCount] = useState(10);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const pick = useCallback((list: FileList | null) => {
    if (!list) return;
    const gif = Array.from(list).find(
      (f) => f.type === "image/gif" || f.name.toLowerCase().endsWith(".gif")
    );
    if (!gif) {
      setError("Please select a .gif file");
      return;
    }
    setError(null);
    setFile(gif);
    setFrames(null);
    setStage("idle");
  }, []);

  async function decode() {
    if (!file) return;
    setStage("decoding");
    setError(null);
    try {
      const decodedFrames = await decodeGif(file);
      if (decodedFrames.length === 0) {
        throw new Error("No frames decoded — the GIF may be corrupted");
      }
      setFrames(decodedFrames);
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decode this GIF");
      setStage("idle");
    }
  }

  async function generate() {
    if (!frames) return;
    cancelRef.current = false;
    setStage("generating");
    setProgress(0);
    variations.forEach((v) => URL.revokeObjectURL(v.url));
    setVariations([]);

    try {
      const results = await generateVariations(
        frames,
        similarity,
        count,
        (progress) => {
          if (cancelRef.current) throw new Error("Cancelled");
          setProgress(progress);
        },
        () => cancelRef.current
      );
      setVariations(results);
      setStage("ready");
    } catch (e) {
      if (e instanceof Error && e.message === "Cancelled") {
        setStage("ready");
      } else {
        setError(e instanceof Error ? e.message : "Generation failed");
        setStage("ready");
      }
    }
  }

  async function downloadAll() {
    for (const variation of variations) {
      const a = document.createElement("a");
      a.href = variation.url;
      a.download = `${variation.id}.gif`;
      a.click();
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  const busy = stage === "decoding" || stage === "generating";

  const similarityLabel =
    similarity === 100
      ? "Minimal changes"
      : similarity >= 90
      ? "Very close variation"
      : similarity >= 75
      ? "Noticeable variation"
      : similarity >= 50
      ? "Moderate variation"
      : "Free variation";

  return (
    <main className="mx-auto max-w-6xl px-5 py-10 md:py-16 bg-[#05060c] text-white min-h-screen">
      <header className="mb-10">
        <p className="text-[11px] tracking-widest text-white/70 uppercase">
          GIF Variation Studio
        </p>
        <h1 className="mt-2 text-4xl font-bold md:text-5xl">
          Create Visual Variations
        </h1>
        <p className="mt-3 max-w-2xl text-white/60">
          Upload a GIF and generate multiple variations that preserve its visual
          identity while changing its shape. Colors stay the same — only form
          transforms.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-6">
          <div
            className="flex flex-col items-center justify-center gap-3 border border-white/10 border-dashed p-10 text-center bg-white/[0.02] rounded-lg"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/gif"
              className="hidden"
              onChange={(e) => pick(e.target.files)}
            />
            <p className="text-lg">Drop a GIF here</p>
            <p className="text-sm text-white/60">one file · processed locally</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-2 rounded-md border border-white/15 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 transition"
            >
              Choose file
            </button>
            {file && (
              <p className="text-[11px] tracking-widest mt-2 text-white/70">
                {file.name}
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled={!file || busy}
              onClick={decode}
              className="rounded-md bg-white/10 px-5 py-2.5 text-sm font-semibold hover:bg-white/15 disabled:opacity-40 transition"
            >
              {stage === "decoding" ? "Decoding…" : "Decode GIF"}
            </button>
            <button
              disabled={!frames || busy}
              onClick={generate}
              className="rounded-md bg-cyan-500/20 border border-cyan-500/50 px-5 py-2.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40 transition"
            >
              Generate {count} Variations
            </button>
            {stage === "generating" && (
              <button
                onClick={() => (cancelRef.current = true)}
                className="rounded-md border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5 transition"
              >
                Stop
              </button>
            )}
            {variations.length > 0 && stage !== "generating" && (
              <button
                onClick={downloadAll}
                className="rounded-md border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5 transition"
              >
                Download all
              </button>
            )}
          </div>

          {stage === "generating" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-cyan-500 transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}

          {variations.length > 0 && (
            <div>
              <p className="text-[11px] tracking-widest mb-3 text-white/70 uppercase">
                Variations · {variations.length} files
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {variations.map((variation) => (
                  <a
                    key={variation.id}
                    href={variation.url}
                    download={`${variation.id}.gif`}
                    className="group overflow-hidden rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition"
                  >
                    <img
                      src={variation.url}
                      alt={`Variation ${variation.id}`}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <span className="text-[11px] tracking-widest text-white/80">
                        {variation.id}
                      </span>
                      <span className="text-[10px] text-white/60">
                        {Math.round(variation.bytes / 1024)}kb
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-5 p-5 rounded-lg border border-white/10 bg-white/[0.02] h-fit">
          <h2 className="text-lg font-semibold">Settings</h2>

          {frames && (
            <div className="space-y-2">
              <p className="text-[11px] tracking-widest text-white/70 uppercase">
                Source GIF
              </p>
              <dl className="grid grid-cols-2 gap-2 text-xs text-white/60">
                <div>frames · {frames.length}</div>
                <div>
                  size · {frames[0].width}×{frames[0].height}
                </div>
                <div>
                  duration ·{" "}
                  {(
                    frames.reduce((sum, f) => sum + f.delay, 0) / 1000
                  ).toFixed(1)}
                  s
                </div>
                <div>fps · {Math.round(1000 / frames[0].delay)}</div>
              </dl>
            </div>
          )}

          <div className="space-y-4 border-t border-white/10 pt-4">
            <label className="block">
              <span className="text-[11px] tracking-widest text-white/70 uppercase">
                Similarity · {similarity}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={similarity}
                onChange={(e) => setSimilarity(Number(e.target.value))}
                className="mt-2 w-full accent-cyan-500"
              />
              <p className="mt-1 text-xs text-white/60">{similarityLabel}</p>
            </label>

            <label className="block">
              <span className="text-[11px] tracking-widest text-white/70 uppercase">
                Number of variations · {count}
              </span>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="mt-2 w-full accent-cyan-500"
              />
            </label>
          </div>

          <div className="border-t border-white/10 pt-4">
            <p className="text-[11px] tracking-widest mb-2 text-white/70 uppercase">
              How it works
            </p>
            <ul className="space-y-1 text-xs text-white/60">
              <li>• Displacement fields (Perlin noise)</li>
              <li>• Bilinear interpolation warping</li>
              <li>• Block shuffle (shape change)</li>
              <li>• Swirl distortion (shape change)</li>
              <li>• Edge distortion (contour change)</li>
              <li>• Temporal consistency (no flicker)</li>
              <li>• Colors preserved from original</li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
