import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GIF Collection Studio — Style Profile & Series Generator" },
      {
        name: "description",
        content:
          "Upload reference GIFs, extract their visual style profile, and generate a whole collection of new looping GIF-art that shares the same character.",
      },
      { property: "og:title", content: "GIF Collection Studio" },
      {
        property: "og:description",
        content:
          "Analyze reference GIFs and generate a coherent series of new GIF-art in one click.",
      },
    ],
  }),
  component: Studio,
});

// ============================================================
// TYPES
// ============================================================
interface StyleProfile {
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
}

interface GifItem {
  id: string;
  url: string;
  bytes: number;
  system: string;
  seed: number;
}

type Stage = "idle" | "analyzing" | "ready" | "generating";

// ============================================================
// GIF ANALYZER
// ============================================================
async function analyzeGifs(files: File[]): Promise<StyleProfile> {
  const allPixels: number[][] = [];
  let totalMotion = 0;
  let totalGrain = 0;
  let totalContrast = 0;
  let totalSaturation = 0;
  let totalBrightness = 0;
  let frameCount = 0;
  let fps = 12;
  let aspect = 1;
  const thumbs: string[] = [];
  const names: string[] = [];

  for (const file of files) {
    names.push(file.name);
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Простой парсер GIF для извлечения кадров
    const frames = await decodeGifSimple(bytes);
    if (frames.length === 0) continue;

    thumbs.push(URL.createObjectURL(new Blob([buffer], { type: "image/gif" })));
    aspect = frames[0].width / frames[0].height;
    fps = Math.round(1000 / (frames[0].delay || 100));

    let prevFrame: Uint8ClampedArray | null = null;

    for (const frame of frames) {
      frameCount++;
      const { rgba, width, height } = frame;

      // Собираем пиксели для палитры
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] > 128) {
          allPixels.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
        }
      }

      // Motion: разница между кадрами
      if (prevFrame) {
        let diff = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          diff += Math.abs(rgba[i] - prevFrame[i]);
          diff += Math.abs(rgba[i + 1] - prevFrame[i + 1]);
          diff += Math.abs(rgba[i + 2] - prevFrame[i + 2]);
        }
        totalMotion += diff / (width * height * 3);
      }
      prevFrame = rgba;

      // Grain: variance соседних пикселей
      let grainSum = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = (y * width + x) * 4;
          const right = (y * width + x + 1) * 4;
          const below = ((y + 1) * width + x) * 4;
          const diff =
            Math.abs(rgba[idx] - rgba[right]) +
            Math.abs(rgba[idx] - rgba[below]);
          grainSum += diff;
        }
      }
      totalGrain += grainSum / (width * height);

      // Contrast: min/max brightness
      let minBright = 255, maxBright = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        const bright = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
        minBright = Math.min(minBright, bright);
        maxBright = Math.max(maxBright, bright);
      }
      totalContrast += (maxBright - minBright) / 255;

      // Saturation & Brightness
      let satSum = 0, brightSum = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
        satSum += s;
        brightSum += l;
      }
      totalSaturation += satSum / (width * height);
      totalBrightness += brightSum / (width * height);
    }
  }

  // Извлекаем доминантные цвета через k-means
  const palette = extractPalette(allPixels, 6);

  const n = Math.max(1, frameCount);
  return {
    palette,
    motion: Math.min(1, totalMotion / n / 50),
    grain: Math.min(1, totalGrain / n / 30),
    contrast: Math.min(1, totalContrast / n),
    saturation: Math.min(1, totalSaturation / n),
    brightness: Math.min(1, totalBrightness / n),
    fps,
    frameCount,
    sources: files.length,
    aspect,
    thumbs,
    names,
  };
}

function extractPalette(pixels: number[][], k: number): string[] {
  if (pixels.length === 0) return ["#ffffff"];

  // Простой k-means
  const centroids = pixels
    .slice(0, k)
    .map((p) => [...p]);

  for (let iter = 0; iter < 10; iter++) {
    const clusters: number[][][] = Array.from({ length: k }, () => []);

    for (const pixel of pixels) {
      let minDist = Infinity;
      let closest = 0;
      for (let i = 0; i < k; i++) {
        const dist =
          (pixel[0] - centroids[i][0]) ** 2 +
          (pixel[1] - centroids[i][1]) ** 2 +
          (pixel[2] - centroids[i][2]) ** 2;
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      }
      clusters[closest].push(pixel);
    }

    for (let i = 0; i < k; i++) {
      if (clusters[i].length === 0) continue;
      const sum = [0, 0, 0];
      for (const p of clusters[i]) {
        sum[0] += p[0];
        sum[1] += p[1];
        sum[2] += p[2];
      }
      centroids[i] = [
        sum[0] / clusters[i].length,
        sum[1] / clusters[i].length,
        sum[2] / clusters[i].length,
      ];
    }
  }

  return centroids.map(
    (c) => `#${Math.round(c[0]).toString(16).padStart(2, "0")}${Math.round(c[1]).toString(16).padStart(2, "0")}${Math.round(c[2]).toString(16).padStart(2, "0")}`
  );
}

// ============================================================
// GIF DECODER (упрощенный)
// ============================================================
async function decodeGifSimple(bytes: Uint8Array): Promise<{ rgba: Uint8ClampedArray; width: number; height: number; delay: number }[]> {
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  if (signature !== "GIF") return [];

  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const hasGlobalColorTable = (bytes[10] & 0x80) !== 0;
  const globalColorTableSize = hasGlobalColorTable ? Math.pow(2, (bytes[10] & 0x07) + 1) : 0;

  let offset = 13;
  const globalPalette: [number, number, number][] = [];
  if (hasGlobalColorTable) {
    for (let i = 0; i < globalColorTableSize; i++) {
      globalPalette.push([bytes[offset], bytes[offset + 1], bytes[offset + 2]]);
      offset += 3;
    }
  }

  const frames: { rgba: Uint8ClampedArray; width: number; height: number; delay: number }[] = [];
  let delay = 100;
  const composite = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    composite[i * 4] = 255;
    composite[i * 4 + 1] = 255;
    composite[i * 4 + 2] = 255;
    composite[i * 4 + 3] = 255;
  }

  while (offset < bytes.length) {
    const blockType = bytes[offset];

    if (blockType === 0x21) {
      const extensionLabel = bytes[offset + 1];
      if (extensionLabel === 0xf9) {
        delay = (bytes[offset + 4] | (bytes[offset + 5] << 8)) * 10;
        if (delay === 0) delay = 100;
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
      const localColorTableSize = hasLocalColorTable ? Math.pow(2, (bytes[offset + 9] & 0x07) + 1) : 0;

      offset += 10;

      const palette: [number, number, number][] = hasLocalColorTable ? [] : globalPalette;
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

      for (let y = 0; y < imgHeight; y++) {
        for (let x = 0; x < imgWidth; x++) {
          const srcIdx = y * imgWidth + x;
          const colorIdx = decoded[srcIdx];
          if (colorIdx === undefined || colorIdx >= palette.length) continue;

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
        width,
        height,
        delay,
      });
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
// GIF GENERATOR
// ============================================================
async function generateGif(
  seed: number,
  profile: StyleProfile,
  options: { size: number; frames: number }
): Promise<GifItem> {
  const { size, frames } = options;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const gif = GIFEncoder();
  const delay = Math.round(1000 / profile.fps);

  // Выбираем систему генерации на основе seed
  const systems = ["flowField", "particles", "geometric", "noise"];
  const system = systems[seed % systems.length];

  // Конвертируем палитру в RGB
  const paletteRGB = profile.palette.map((hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  });

  for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
    const t = frameIdx / frames;

    ctx.fillStyle = profile.palette[0] || "#000000";
    ctx.fillRect(0, 0, size, size);

    if (system === "flowField") {
      renderFlowField(ctx, size, t, seed, profile, paletteRGB);
    } else if (system === "particles") {
      renderParticles(ctx, size, t, seed, profile, paletteRGB);
    } else if (system === "geometric") {
      renderGeometric(ctx, size, t, seed, profile, paletteRGB);
    } else {
      renderNoise(ctx, size, t, seed, profile, paletteRGB);
    }

    const imageData = ctx.getImageData(0, 0, size, size);
    const palette = quantize(imageData.data, 256);
    const index = applyPalette(imageData.data, palette);
    gif.writeFrame(index, size, size, { palette, delay });
  }

  gif.finish();
  const bytes = gif.bytesView();
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const blob = new Blob([buf], { type: "image/gif" });

  return {
    id: `${seed}`,
    url: URL.createObjectURL(blob),
    bytes: blob.size,
    system,
    seed,
  };
}

function renderFlowField(
  ctx: CanvasRenderingContext2D,
  size: number,
  t: number,
  seed: number,
  profile: StyleProfile,
  palette: number[][]
) {
  const gridSize = Math.max(4, Math.floor(8 + profile.motion * 12));
  const cols = Math.ceil(size / gridSize);
  const rows = Math.ceil(size / gridSize);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const angle = noise(x * 0.1 + seed, y * 0.1 + seed, t * 2) * Math.PI * 2;
      const length = 2 + noise(x * 0.2 + seed + 100, y * 0.2 + seed + 100, t * 3) * gridSize * profile.motion;

      const px = x * gridSize;
      const py = y * gridSize;
      const ex = px + Math.cos(angle) * length;
      const ey = py + Math.sin(angle) * length;

      const colorIdx = Math.floor(noise(x * 0.3 + seed, y * 0.3 + seed, t) * palette.length) % palette.length;
      const [r, g, b] = palette[colorIdx];

      ctx.strokeStyle = `rgba(${r},${g},${b},${0.3 + profile.contrast * 0.5})`;
      ctx.lineWidth = 1 + profile.grain * 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  }
}

function renderParticles(
  ctx: CanvasRenderingContext2D,
  size: number,
  t: number,
  seed: number,
  profile: StyleProfile,
  palette: number[][]
) {
  const count = Math.floor(50 + profile.motion * 200);

  for (let i = 0; i < count; i++) {
    const x = noise(i * 0.1 + seed, t * 2, 0) * size;
    const y = noise(i * 0.1 + seed + 100, t * 2, 0) * size;
    const radius = 2 + noise(i * 0.2 + seed, t * 3, 0) * 8 * profile.grain;

    const colorIdx = Math.floor(noise(i * 0.3 + seed, t, 0) * palette.length) % palette.length;
    const [r, g, b] = palette[colorIdx];

    ctx.fillStyle = `rgba(${r},${g},${b},${0.5 + profile.saturation * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderGeometric(
  ctx: CanvasRenderingContext2D,
  size: number,
  t: number,
  seed: number,
  profile: StyleProfile,
  palette: number[][]
) {
  const shapes = Math.floor(5 + profile.contrast * 15);

  for (let i = 0; i < shapes; i++) {
    const x = noise(i * 0.5 + seed, t, 0) * size;
    const y = noise(i * 0.5 + seed + 50, t, 0) * size;
    const radius = 10 + noise(i * 0.3 + seed, t * 2, 0) * 40 * profile.motion;
    const rotation = noise(i * 0.2 + seed, t * 3, 0) * Math.PI * 2;

    const colorIdx = Math.floor(noise(i * 0.4 + seed, t, 0) * palette.length) % palette.length;
    const [r, g, b] = palette[colorIdx];

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillStyle = `rgba(${r},${g},${b},${0.4 + profile.brightness * 0.4})`;

    const sides = 3 + Math.floor(noise(i + seed, t, 0) * 5);
    ctx.beginPath();
    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * Math.PI * 2;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function renderNoise(
  ctx: CanvasRenderingContext2D,
  size: number,
  t: number,
  seed: number,
  profile: StyleProfile,
  palette: number[][]
) {
  const gridSize = Math.max(2, Math.floor(4 + profile.grain * 8));
  const cols = Math.ceil(size / gridSize);
  const rows = Math.ceil(size / gridSize);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const n = noise(x * 0.15 + seed, y * 0.15 + seed, t * 2);
      const colorIdx = Math.floor(n * palette.length) % palette.length;
      const [r, g, b] = palette[colorIdx];

      ctx.fillStyle = `rgba(${r},${g},${b},${0.3 + profile.contrast * 0.6})`;
      ctx.fillRect(x * gridSize, y * gridSize, gridSize, gridSize);
    }
  }
}

// Simple Perlin-like noise
function noise(x: number, y: number, z: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
  return n - Math.floor(n);
}

// ============================================================
// UI
// ============================================================
function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] tracking-widest text-white/70 uppercase">{label}</span>
        <span className="font-mono text-xs text-white">{Math.round(value * 100)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-500 transition-all duration-700"
          style={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }}
        />
      </div>
    </div>
  );
}

function Studio() {
  const [files, setFiles] = useState<File[]>([]);
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [items, setItems] = useState<GifItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(50);
  const [size, setSize] = useState(256);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const pick = useCallback((list: FileList | null) => {
    if (!list) return;
    const gifs = Array.from(list).filter(
      (f) => f.type === "image/gif" || f.name.toLowerCase().endsWith(".gif")
    );
    if (!gifs.length) {
      setError("Add at least one .gif file");
      return;
    }
    setError(null);
    setFiles(gifs.slice(0, 8));
    setProfile(null);
    setStage("idle");
  }, []);

  async function analyze() {
    if (!files.length) return;
    setStage("analyzing");
    setError(null);
    try {
      const p = await analyzeGifs(files);
      setProfile(p);
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read these GIFs");
      setStage("idle");
    }
  }

  async function generate() {
    if (!profile) return;
    cancelRef.current = false;
    setStage("generating");
    setProgress(0);
    items.forEach((i) => URL.revokeObjectURL(i.url));
    setItems([]);

    const base = Math.floor(Math.random() * 1e9);
    const frames = Math.max(12, Math.min(24, profile.frameCount || 16));
    const made: GifItem[] = [];

    for (let i = 0; i < count; i++) {
      if (cancelRef.current) break;
      const item = await generateGif(base + i * 2654435761, profile, { size, frames });
      made.push(item);
      setItems([...made]);
      setProgress((i + 1) / count);
    }

    setStage("ready");
  }

  async function downloadAll() {
    for (const item of items) {
      const a = document.createElement("a");
      a.href = item.url;
      a.download = `collection-${item.system}-${item.seed}.gif`;
      a.click();
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  const busy = stage === "analyzing" || stage === "generating";

  return (
    <main className="mx-auto max-w-6xl px-5 py-10 md:py-16 bg-[#05060c] text-white min-h-screen">
      <header className="mb-10">
        <p className="text-[11px] tracking-widest text-white/70 uppercase">
          Generative series lab
        </p>
        <h1 className="mt-2 text-4xl font-bold md:text-5xl">GIF Collection Studio</h1>
        <p className="mt-3 max-w-2xl text-white/60">
          Drop in reference GIFs, extract their style profile — palette, motion energy, grain,
          contrast — then generate a whole series of new looping GIF-art that reads as one
          collection.
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
              multiple
              className="hidden"
              onChange={(e) => pick(e.target.files)}
            />
            <p className="text-lg">Drop reference GIFs here</p>
            <p className="text-sm text-white/60">up to 8 files · they never leave your browser</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-2 rounded-md border border-white/15 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 transition"
            >
              Choose files
            </button>
            {files.length > 0 && (
              <p className="text-[11px] tracking-widest mt-2 text-white/70">
                {files.length} file{files.length > 1 ? "s" : ""} selected
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
              disabled={!files.length || busy}
              onClick={analyze}
              className="rounded-md bg-white/10 px-5 py-2.5 text-sm font-semibold hover:bg-white/15 disabled:opacity-40 transition"
            >
              {stage === "analyzing" ? "Analyzing…" : "Analyze"}
            </button>
            <button
              disabled={!profile || busy}
              onClick={generate}
              className="rounded-md bg-cyan-500/20 border border-cyan-500/50 px-5 py-2.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40 transition"
            >
              Generate {count}
            </button>
            {stage === "generating" && (
              <button
                onClick={() => (cancelRef.current = true)}
                className="rounded-md border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5 transition"
              >
                Stop
              </button>
            )}
            {items.length > 0 && stage !== "generating" && (
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

          {items.length > 0 && (
            <div>
              <p className="text-[11px] tracking-widest mb-3 text-white/70 uppercase">
                Collection · {items.length} pieces
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {items.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    download={`collection-${item.system}-${item.seed}.gif`}
                    className="group overflow-hidden rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition"
                  >
                    <img
                      src={item.url}
                      alt={`Generated ${item.system} GIF art, seed ${item.seed}`}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <span className="text-[11px] tracking-widest text-white/80">
                        {item.system}
                      </span>
                      <span className="text-[10px] text-white/60">
                        {Math.round(item.bytes / 1024)}kb
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-5 p-5 rounded-lg border border-white/10 bg-white/[0.02] h-fit">
          <h2 className="text-lg font-semibold">Style Profile</h2>

          {!profile && (
            <p className="text-sm text-white/60">
              Analyze your references to see the profile.
            </p>
          )}

          {profile && (
            <>
              <div className="flex flex-wrap gap-2">
                {profile.thumbs.map((t, i) => (
                  <img
                    key={i}
                    src={t}
                    alt={`Reference ${profile.names[i] ?? i + 1}`}
                    className="h-12 w-12 rounded-md border border-white/10 object-cover"
                  />
                ))}
              </div>

              <div>
                <p className="text-[11px] tracking-widest mb-2 text-white/70 uppercase">
                  Palette
                </p>
                <div className="flex overflow-hidden rounded-md border border-white/10">
                  {profile.palette.map((c) => (
                    <div
                      key={c}
                      className="h-9 flex-1"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Meter label="Motion" value={profile.motion} />
                <Meter label="Grain" value={profile.grain} />
                <Meter label="Contrast" value={profile.contrast} />
                <Meter label="Saturation" value={profile.saturation} />
                <Meter label="Brightness" value={profile.brightness} />
              </div>

              <dl className="grid grid-cols-2 gap-2 font-mono text-xs text-white/60">
                <div>fps · {profile.fps}</div>
                <div>frames · {profile.frameCount}</div>
                <div>sources · {profile.sources}</div>
                <div>aspect · {profile.aspect.toFixed(2)}</div>
              </dl>
            </>
          )}

          <div className="space-y-3 border-t border-white/10 pt-4">
            <label className="block">
              <span className="text-[11px] tracking-widest text-white/70 uppercase">
                Collection size · {count}
              </span>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="mt-2 w-full accent-cyan-500"
              />
            </label>
            <label className="block">
              <span className="text-[11px] tracking-widest text-white/70 uppercase">
                Resolution · {size}px
              </span>
              <input
                type="range"
                min={128}
                max={384}
                step={32}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="mt-2 w-full accent-cyan-500"
              />
            </label>
          </div>
        </aside>
      </div>
    </main>
  );
}
