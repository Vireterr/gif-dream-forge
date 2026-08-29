import type { RGB, StyleProfile } from "./types";

const SAMPLE = 64; // analysis resolution

function toHex([r, g, b]: RGB) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

function luma([r, g, b]: RGB) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function dist(a: RGB, b: RGB) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

interface SourceStats {
  pixels: RGB[];
  motion: number;
  grain: number;
  contrast: number;
  saturation: number;
  brightness: number;
  fps: number;
  frameCount: number;
  aspect: number;
  thumb: string;
}

async function analyzeOne(file: File): Promise<SourceStats> {
  const { parseGIF, decompressFrames } = await import("gifuct-js");
  const buffer = await file.arrayBuffer();
  const gif = parseGIF(buffer);
  const frames = decompressFrames(gif, true);
  if (!frames.length) throw new Error(`${file.name}: no frames`);

  const w = gif.lsd.width;
  const h = gif.lsd.height;

  const full = document.createElement("canvas");
  full.width = w;
  full.height = h;
  const fctx = full.getContext("2d", { willReadFrequently: true })!;

  const patch = document.createElement("canvas");
  const pctx = patch.getContext("2d")!;

  const small = document.createElement("canvas");
  small.width = SAMPLE;
  small.height = SAMPLE;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;

  const pixels: RGB[] = [];
  const lumas: number[] = [];
  let motionAcc = 0;
  let grainAcc = 0;
  let satAcc = 0;
  let prev: Uint8ClampedArray | null = null;
  let thumb = "";

  const step = Math.max(1, Math.floor(frames.length / 12));
  let counted = 0;

  for (let i = 0; i < frames.length; i += step) {
    const f = frames[i];
    patch.width = f.dims.width;
    patch.height = f.dims.height;
    pctx.putImageData(new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height), 0, 0);
    if (f.disposalType === 2) fctx.clearRect(f.dims.left, f.dims.top, f.dims.width, f.dims.height);
    fctx.drawImage(patch, f.dims.left, f.dims.top);

    sctx.clearRect(0, 0, SAMPLE, SAMPLE);
    sctx.drawImage(full, 0, 0, SAMPLE, SAMPLE);
    const data = sctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
    if (!thumb) thumb = full.toDataURL("image/png");

    let diff = 0;
    let edge = 0;
    for (let y = 0; y < SAMPLE; y++) {
      for (let x = 0; x < SAMPLE; x++) {
        const o = (y * SAMPLE + x) * 4;
        if (data[o + 3] < 24) continue;
        const px: RGB = [data[o], data[o + 1], data[o + 2]];
        if ((x + y) % 3 === 0) pixels.push(px);
        const l = luma(px);
        lumas.push(l);
        const mx = Math.max(px[0], px[1], px[2]);
        const mn = Math.min(px[0], px[1], px[2]);
        satAcc += mx === 0 ? 0 : (mx - mn) / mx;
        if (x + 1 < SAMPLE) {
          const n = (y * SAMPLE + x + 1) * 4;
          edge += Math.abs(data[o] - data[n]) + Math.abs(data[o + 1] - data[n + 1]) + Math.abs(data[o + 2] - data[n + 2]);
        }
        if (prev) {
          diff += Math.abs(data[o] - prev[o]) + Math.abs(data[o + 1] - prev[o + 1]) + Math.abs(data[o + 2] - prev[o + 2]);
        }
      }
    }
    const n = SAMPLE * SAMPLE;
    if (prev) motionAcc += diff / (n * 765);
    grainAcc += edge / (n * 765);
    prev = new Uint8ClampedArray(data);
    counted++;
  }

  const totalDelay = frames.reduce((s, f) => s + (f.delay || 100), 0);
  const fps = Math.max(4, Math.min(30, 1000 / (totalDelay / frames.length)));
  const meanL = lumas.reduce((s, v) => s + v, 0) / Math.max(1, lumas.length);
  const variance = lumas.reduce((s, v) => s + (v - meanL) ** 2, 0) / Math.max(1, lumas.length);

  return {
    pixels,
    motion: Math.min(1, (motionAcc / Math.max(1, counted - 1)) * 6),
    grain: Math.min(1, (grainAcc / Math.max(1, counted)) * 8),
    contrast: Math.min(1, Math.sqrt(variance) * 3.2),
    saturation: Math.min(1, satAcc / Math.max(1, lumas.length)),
    brightness: meanL,
    fps,
    frameCount: frames.length,
    aspect: w / h,
    thumb,
  };
}

function buildPalette(pixels: RGB[], count = 6): { palette: string[]; background: string } {
  const buckets = new Map<number, { sum: RGB; n: number }>();
  for (const p of pixels) {
    const key = ((p[0] >> 4) << 8) | ((p[1] >> 4) << 4) | (p[2] >> 4);
    const b = buckets.get(key);
    if (b) {
      b.sum[0] += p[0];
      b.sum[1] += p[1];
      b.sum[2] += p[2];
      b.n++;
    } else {
      buckets.set(key, { sum: [p[0], p[1], p[2]], n: 1 });
    }
  }
  const ranked = [...buckets.values()]
    .map((b) => ({ c: [b.sum[0] / b.n, b.sum[1] / b.n, b.sum[2] / b.n] as RGB, n: b.n }))
    .sort((a, b) => b.n - a.n);

  const picked: RGB[] = [];
  for (const r of ranked) {
    if (picked.every((p) => dist(p, r.c) > 46)) picked.push(r.c);
    if (picked.length >= count) break;
  }
  let i = 0;
  while (picked.length < count && ranked.length) {
    picked.push(ranked[i % ranked.length].c);
    i++;
  }
  const background = toHex(ranked[0]?.c ?? [12, 12, 14]);
  picked.sort((a, b) => luma(a) - luma(b));
  return { palette: picked.map(toHex), background };
}

export async function analyzeGifs(files: File[]): Promise<StyleProfile> {
  const stats: SourceStats[] = [];
  for (const f of files) stats.push(await analyzeOne(f));

  const avg = (pick: (s: SourceStats) => number) => stats.reduce((s, v) => s + pick(v), 0) / stats.length;
  const allPixels = stats.flatMap((s) => s.pixels);
  const { palette, background } = buildPalette(allPixels);

  return {
    palette,
    background,
    motion: avg((s) => s.motion),
    grain: avg((s) => s.grain),
    contrast: avg((s) => s.contrast),
    saturation: avg((s) => s.saturation),
    brightness: avg((s) => s.brightness),
    fps: Math.round(avg((s) => s.fps)),
    frameCount: Math.round(avg((s) => s.frameCount)),
    aspect: avg((s) => s.aspect),
    sources: stats.length,
    thumbs: stats.map((s) => s.thumb),
    names: files.map((f) => f.name),
  };
}
