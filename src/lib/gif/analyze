// ============================================================
// analyze.ts — расширенный анализ GIF
// ============================================================

import type { StyleProfile, StyleParams, ColorProfile, MotionProfile, TextureProfile } from "./types";

// ============================================================
// 1. ОСНОВНАЯ ФУНКЦИЯ АНАЛИЗА
// ============================================================

export async function analyzeGifs(files: File[]): Promise<StyleProfile> {
  if (!files.length) throw new Error("No files to analyze");
  
  const results = await Promise.all(files.map(analyzeSingleGif));
  
  // Агрегируем результаты
  const palette = aggregatePalettes(results.map(r => r.palette));
  const colorProfile = aggregateColorProfiles(results.map(r => r.colorProfile));
  const motionProfile = aggregateMotionProfiles(results.map(r => r.motionProfile));
  const textureProfile = aggregateTextureProfiles(results.map(r => r.textureProfile));
  const styleParams = aggregateStyleParams(results.map(r => r.styleParams));
  
  return {
    palette,
    motion: motionProfile.energy,
    grain: textureProfile.grain,
    contrast: colorProfile.contrastRatio,
    saturation: colorProfile.saturationSpread,
    brightness: colorProfile.brightnessSpread,
    fps: Math.round(results.reduce((a, r) => a + r.fps, 0) / results.length),
    frameCount: Math.round(results.reduce((a, r) => a + r.frameCount, 0) / results.length),
    sources: files.length,
    aspect: results.reduce((a, r) => a + r.aspect, 0) / results.length,
    thumbs: results.map(r => r.thumbnail),
    names: files.map(f => f.name),
    // Расширенные поля
    style: styleParams,
    color: colorProfile,
    motionProfile,
    textureProfile,
  };
}

// ============================================================
// 2. АНАЛИЗ ОДНОГО GIF
// ============================================================

interface SingleGifAnalysis {
  palette: string[];
  fps: number;
  frameCount: number;
  aspect: number;
  thumbnail: string;
  colorProfile: ColorProfile;
  motionProfile: MotionProfile;
  textureProfile: TextureProfile;
  styleParams: StyleParams;
}

async function analyzeSingleGif(file: File): Promise<SingleGifAnalysis> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    const data = imageData.data;
    
    // 2a. Палитра (цветовой профиль)
    const colorProfile = analyzeColorProfile(data, img.width, img.height);
    const palette = extractPalette(data, 8);
    
    // 2b. Движение (если есть несколько кадров — сложно без декодера,
    // пока используем имитацию на основе цвета/текстуры)
    const motionProfile = analyzeMotionProfile(data, img.width, img.height);
    
    // 2c. Текстура
    const textureProfile = analyzeTextureProfile(data, img.width, img.height);
    
    // 2d. Параметры стиля
    const styleParams = analyzeStyleParams(data, img.width, img.height, colorProfile, motionProfile, textureProfile);
    
    // 2e. Миниатюра
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = 64;
    thumbCanvas.height = 64;
    const tctx = thumbCanvas.getContext("2d")!;
    tctx.drawImage(img, 0, 0, 64, 64);
    const thumbnail = thumbCanvas.toDataURL("image/jpeg", 0.8);
    
    return {
      palette,
      fps: 24, // fallback
      frameCount: 16, // fallback
      aspect: img.width / img.height,
      thumbnail,
      colorProfile,
      motionProfile,
      textureProfile,
      styleParams,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ============================================================
// 3. АНАЛИЗ ЦВЕТА
// ============================================================

function analyzeColorProfile(data: Uint8ClampedArray, w: number, h: number): ColorProfile {
  const samples = samplePixels(data, w, h, 1000);
  const colors = samples.map(([r, g, b]) => rgbToHex(r, g, b));
  const hues = samples.map(([r, g, b]) => rgbToHue(r, g, b));
  
  // Доминантные цвета
  const frequency: Record<string, number> = {};
  for (const c of colors) frequency[c] = (frequency[c] || 0) + 1;
  const sorted = Object.entries(frequency).sort((a, b) => b[1] - a[1]);
  const dominantColors = sorted.slice(0, 4).map(([c]) => c);
  const accentColors = sorted.slice(4, 8).map(([c]) => c);
  
  // Цветовая температура
  const avgHue = hues.reduce((a, h) => a + h, 0) / hues.length;
  let temperature: "warm" | "cool" | "neutral" | "mixed";
  if (avgHue > 20 && avgHue < 60) temperature = "warm";
  else if (avgHue > 200 && avgHue < 280) temperature = "cool";
  else if (avgHue > 60 && avgHue < 200) temperature = "neutral";
  else temperature = "mixed";
  
  // Гармония (упрощённо)
  const uniqueHues = [...new Set(hues.map(h => Math.round(h / 30) * 30))];
  let harmony: ColorProfile["harmony"] = "mixed";
  if (uniqueHues.length <= 2) harmony = "monochromatic";
  else if (uniqueHues.some(h => uniqueHues.some(h2 => Math.abs(h - h2 - 180) < 30))) harmony = "complementary";
  else if (uniqueHues.length <= 4) harmony = "analogous";
  else if (uniqueHues.length <= 6) harmony = "triadic";
  
  // Контраст
  const brightnesses = samples.map(([r, g, b]) => (r + g + b) / 3);
  const avgBrightness = brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length;
  const variance = brightnesses.reduce((a, b) => a + (b - avgBrightness) ** 2, 0) / brightnesses.length;
  const contrastRatio = Math.min(1, Math.sqrt(variance) / 128);
  
  return {
    palette: dominantColors.concat(accentColors),
    dominantColors,
    accentColors,
    temperature,
    harmony,
    contrastRatio,
    saturationSpread: 0.5, // будет вычисляться из данных
    brightnessSpread: 0.5,
    hueDistribution: buildHueHistogram(hues),
  };
}

// ============================================================
// 4. АНАЛИЗ ДВИЖЕНИЯ
// ============================================================

function analyzeMotionProfile(data: Uint8ClampedArray, w: number, h: number): MotionProfile {
  // Упрощённо: используем градиенты как прокси для "движения"
  const gradients = computeGradients(data, w, h);
  const energy = Math.min(1, gradients.reduce((a, g) => a + g, 0) / (w * h * 0.1));
  
  return {
    energy,
    complexity: 0.3 + energy * 0.5,
    smoothness: 0.5 + (1 - energy) * 0.4,
    chaos: 0.3 + energy * 0.3,
    direction: 0.5,
    speedVariance: 0.3 + energy * 0.5,
    acceleration: 0.3 + energy * 0.4,
    oscillation: 0.2 + energy * 0.5,
    rotation: 0.1 + energy * 0.3,
    pulsing: 0.2 + energy * 0.6,
  };
}

// ============================================================
// 5. АНАЛИЗ ТЕКСТУРЫ
// ============================================================

function analyzeTextureProfile(data: Uint8ClampedArray, w: number, h: number): TextureProfile {
  const edges = detectEdges(data, w, h);
  const noise = estimateNoise(data, w, h);
  const grain = Math.min(1, noise * 2);
  const sharpness = Math.min(1, edges / 20);
  
  return {
    grain,
    noise,
    blur: Math.max(0, 0.3 - sharpness * 0.3),
    sharpness,
    pixelation: 0.1 + (1 - sharpness) * 0.3,
    glitch: 0.05 + (1 - sharpness) * 0.2,
    chromatic: 0.05,
    vignette: 0.1,
    bloom: 0.1 + sharpness * 0.2,
    posterize: 1 - sharpness * 0.5,
  };
}

// ============================================================
// 6. АНАЛИЗ ПАРАМЕТРОВ СТИЛЯ
// ============================================================

function analyzeStyleParams(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  color: ColorProfile,
  motion: MotionProfile,
  texture: TextureProfile
): StyleParams {
  return {
    colorVariance: color.saturationSpread * 0.6 + color.brightnessSpread * 0.4,
    motionComplexity: motion.complexity,
    shapeDensity: 0.3 + texture.grain * 0.4,
    symmetry: 0.3 + (1 - motion.chaos) * 0.4,
    noiseAmount: texture.noise,
    lineWeight: 0.3 + (1 - texture.sharpness) * 0.4,
    speed: motion.energy * 0.5 + motion.pulsing * 0.5,
    edgeSharpness: texture.sharpness,
    detailLevel: 0.3 + (1 - texture.pixelation) * 0.5,
    flow: motion.smoothness * 0.5 + (1 - motion.chaos) * 0.5,
    repetition: 0.3 + color.harmony === "monochromatic" ? 0.5 : 0.2,
  };
}

// ============================================================
// 7. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function samplePixels(data: Uint8ClampedArray, w: number, h: number, n: number): [number, number, number][] {
  const samples: [number, number, number][] = [];
  const step = Math.max(1, Math.floor((w * h) / n));
  for (let i = 0; i < data.length && samples.length < n; i += step * 4) {
    samples.push([data[i], data[i + 1], data[i + 2]]);
  }
  return samples;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(c => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHue(r: number, g: number, b: number): number {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0));
  else if (max === gf) h = (bf - rf) / d + 2;
  else h = (rf - gf) / d + 4;
  return h * 60;
}

function buildHueHistogram(hues: number[]): number[] {
  const hist = new Array(12).fill(0);
  for (const h of hues) {
    const idx = Math.min(11, Math.floor(h / 30));
    hist[idx]++;
  }
  return hist.map(v => v / hues.length);
}

function extractPalette(data: Uint8ClampedArray, n: number): string[] {
  const samples = samplePixels(data, 1, 1, 1000);
  const freq: Record<string, number> = {};
  for (const [r, g, b] of samples) {
    const hex = rgbToHex(r, g, b);
    freq[hex] = (freq[hex] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([c]) => c);
}

function computeGradients(data: Uint8ClampedArray, w: number, h: number): number[] {
  const grads: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const idxL = ((y) * w + x - 1) * 4;
      const idxR = ((y) * w + x + 1) * 4;
      const idxU = ((y - 1) * w + x) * 4;
      const idxD = ((y + 1) * w + x) * 4;
      const gx = Math.abs(data[idx] - data[idxL]) + Math.abs(data[idx] - data[idxR]);
      const gy = Math.abs(data[idx] - data[idxU]) + Math.abs(data[idx] - data[idxD]);
      grads.push((gx + gy) / 6);
    }
  }
  return grads;
}

function detectEdges(data: Uint8ClampedArray, w: number, h: number): number {
  const grads = computeGradients(data, w, h);
  return grads.reduce((a, g) => a + g, 0) / (grads.length || 1);
}

function estimateNoise(data: Uint8ClampedArray, w: number, h: number): number {
  const samples = samplePixels(data, w, h, 500);
  let noise = 0;
  for (let i = 1; i < samples.length; i++) {
    const [r1, g1, b1] = samples[i - 1];
    const [r2, g2, b2] = samples[i];
    noise += Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
  }
  return Math.min(1, noise / (samples.length * 3 * 50));
}

// ============================================================
// 8. АГРЕГАЦИЯ
// ============================================================

function aggregatePalettes(palettes: string[][]): string[] {
  const freq: Record<string, number> = {};
  for (const p of palettes) {
    for (const c of p) freq[c] = (freq[c] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([c]) => c);
}

function aggregateColorProfiles(profiles: ColorProfile[]): ColorProfile {
  // Упрощённая агрегация
  return profiles[0] || {
    palette: ["#ffffff", "#000000"],
    dominantColors: ["#ffffff"],
    accentColors: ["#000000"],
    temperature: "mixed",
    harmony: "mixed",
    contrastRatio: 0.5,
    saturationSpread: 0.5,
    brightnessSpread: 0.5,
    hueDistribution: new Array(12).fill(0.083),
  };
}

function aggregateMotionProfiles(profiles: MotionProfile[]): MotionProfile {
  const avg = (key: keyof MotionProfile) => 
    profiles.reduce((a, p) => a + (p[key] as number), 0) / profiles.length;
  
  return {
    energy: avg("energy"),
    complexity: avg("complexity"),
    smoothness: avg("smoothness"),
    chaos: avg("chaos"),
    direction: avg("direction"),
    speedVariance: avg("speedVariance"),
    acceleration: avg("acceleration"),
    oscillation: avg("oscillation"),
    rotation: avg("rotation"),
    pulsing: avg("pulsing"),
  };
}

function aggregateTextureProfiles(profiles: TextureProfile[]): TextureProfile {
  const avg = (key: keyof TextureProfile) => 
    profiles.reduce((a, p) => a + (p[key] as number), 0) / profiles.length;
  
  return {
    grain: avg("grain"),
    noise: avg("noise"),
    blur: avg("blur"),
    sharpness: avg("sharpness"),
    pixelation: avg("pixelation"),
    glitch: avg("glitch"),
    chromatic: avg("chromatic"),
    vignette: avg("vignette"),
    bloom: avg("bloom"),
    posterize: avg("posterize"),
  };
}

function aggregateStyleParams(profiles: StyleParams[]): StyleParams {
  const avg = (key: keyof StyleParams) => 
    profiles.reduce((a, p) => a + (p[key] as number), 0) / profiles.length;
  
  return {
    colorVariance: avg("colorVariance"),
    motionComplexity: avg("motionComplexity"),
    shapeDensity: avg("shapeDensity"),
    symmetry: avg("symmetry"),
    noiseAmount: avg("noiseAmount"),
    lineWeight: avg("lineWeight"),
    speed: avg("speed"),
    edgeSharpness: avg("edgeSharpness"),
    detailLevel: avg("detailLevel"),
    flow: avg("flow"),
    repetition: avg("repetition"),
  };
}
