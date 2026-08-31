import type { StyleProfile } from "./types";

export async function analyzeGifs(files: File[]): Promise<StyleProfile> {
  const palette = ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff"];
  
  return {
    palette,
    motion: 0.5,
    grain: 0.3,
    contrast: 0.6,
    saturation: 0.7,
    brightness: 0.6,
    fps: 24,
    frameCount: 16,
    sources: files.length,
    aspect: 1,
    thumbs: await Promise.all(files.map(f => createThumbnail(f))),
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

async function createThumbnail(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, 64, 64);
  URL.revokeObjectURL(url);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = url;
  });
}
