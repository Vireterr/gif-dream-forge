import type { StyleProfile } from "./types";

export async function analyzeGifs(files: File[]): Promise<StyleProfile> {
  const results = await Promise.all(files.map(analyzeSingleGif));
  
  // Агрегируем
  const palette = aggregatePalette(results.map(r => r.palette));
  
  return {
    palette,
    motion: results.reduce((a, r) => a + r.motion, 0) / results.length,
    grain: results.reduce((a, r) => a + r.grain, 0) / results.length,
    contrast: results.reduce((a, r) => a + r.contrast, 0) / results.length,
    saturation: results.reduce((a, r) => a + r.saturation, 0) / results.length,
    brightness: results.reduce((a, r) => a + r.brightness, 0) / results.length,
    fps: 24,
    frameCount: 16,
    sources: files.length,
    aspect: 1,
    thumbs: results.map(r => r.thumb),
    names: files.map(f => f.name),
    style: {
      colorVariance: 0.4,
      motionComplexity: 0.5,
      shapeDensity: 0.5,
      symmetry: 0.3,
      noiseAmount: 0.3,
      lineWeight: 0.5,
      speed: 0.5,
      edgeSharpness: 0.6,
      detailLevel: 0.5,
      flow: 0.4,
      repetition: 0.3,
    },
    color: {
      palette,
      dominantColors: palette.slice(0, 3),
      accentColors: palette.slice(3),
      temperature: "mixed",
      harmony: "mixed",
      contrastRatio: 0.6,
      saturationSpread: 0.5,
      brightnessSpread: 0.5,
      hueDistribution: new Array(12).fill(0.083),
    },
    motionProfile: {
      energy: 0.5,
      complexity: 0.5,
      smoothness: 0.6,
      chaos: 0.4,
      direction: 0.5,
      speedVariance: 0.4,
      acceleration: 0.4,
      oscillation: 0.5,
      rotation: 0.3,
      pulsing: 0.4,
    },
    textureProfile: {
      grain: 0.3,
      noise: 0.3,
      blur: 0.1,
      sharpness: 0.7,
      pixelation: 0.1,
      glitch: 0.05,
      chromatic: 0.05,
      vignette: 0.1,
      bloom: 0.2,
      posterize: 0,
    },
  };
}

async function analyzeSingleGif(file: File) {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  URL.revokeObjectURL(url);
  
  // Палитра
  const palette = extractPalette(data, 8);
  
  // Метрики
  const brightness = calcBrightness(data);
  const contrast = calcContrast(data);
  const saturation = calcSaturation(data);
  const grain = calcGrain(data);
  const motion = calcMotion(data, img.width, img.height);
  
  // Миниатюра
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = 64;
  thumbCanvas.height = 64;
  const tctx = thumbCanvas.getContext("2d")!;
  tctx.drawImage(img, 0, 0, 64, 64);
  const thumb = thumbCanvas.toDataURL("image/jpeg", 0.8);
  
  return { palette, brightness, contrast, saturation, grain, motion, thumb };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = url;
  });
}

function extractPalette(data: Uint8ClampedArray, n: number): string[] {
  const freq: Record<string, number> = {};
  const step = Math.max(1, Math.floor(data.length / 4 / 500));
  for (let i = 0; i < data.length; i += step * 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`;
    freq[hex] = (freq[hex] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([c]) => c);
}

function calcBrightness(data: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return sum / (data.length / 4) / 255;
}

function calcContrast(data: Uint8ClampedArray): number {
  const brightnesses: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    brightnesses.push((data[i] + data[i + 1] + data[i + 2]) / 3);
  }
  const avg = brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length;
  const variance = brightnesses.reduce((a, b) => a + (b - avg) ** 2, 0) / brightnesses.length;
  return Math.min(1, Math.sqrt(variance) / 128);
}

function calcSaturation(data: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    sum += max - min;
  }
  return Math.min(1, (sum / (data.length / 4)) / 255);
}

function calcGrain(data: Uint8ClampedArray): number {
  let diff = 0;
  const step = 4;
  for (let i = 0; i < data.length - step * 4; i += step * 4) {
    diff += Math.abs(data[i] - data[i + step * 4]);
    diff += Math.abs(data[i + 1] - data[i + step * 4 + 1]);
    diff += Math.abs(data[i + 2] - data[i + step * 4 + 2]);
  }
  const n = data.length / 4 / 3;
  return Math.min(1, diff / n / 30);
}

function calcMotion(_data: Uint8ClampedArray, _w: number, _h: number): number {
  // Заглушка — в реальности нужно анализировать несколько кадров
  return 0.5;
}

function aggregatePalette(palettes: string[][]): string[] {
  const freq: Record<string, number> = {};
  for (const p of palettes) {
    for (const c of p) freq[c] = (freq[c] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([c]) => c);
}
