import type { GifItem, StyleProfile, GenParams, PostEffects } from "./types";

export async function generateGif(
  seed: number,
  profile: any,
  options: { size: number; frames: number }
): Promise<GifItem> {
  const { size, frames } = options;
  
  // Извлекаем параметры
  const mode = profile.mode || "abstract";
  const params: GenParams = profile.params || {
    mode: "abstract",
    speed: 0.5,
    complexity: 0.5,
    symmetry: 0.3,
    density: 0.5,
    lineWeight: 0.5,
    flow: 0.5,
    chaos: 0.3,
    color: { palette: profile.palette || ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff"] },
    effects: { blur: 0, pixelate: 0, grain: 0.2, vignette: 0.1, chromatic: 0, glitch: 0, bloom: 0 },
  };
  
  const effects: PostEffects = params.effects || { blur: 0, pixelate: 0, grain: 0.2, vignette: 0.1, chromatic: 0, glitch: 0, bloom: 0 };
  const colors = params.color?.palette || profile.palette || ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff"];
  
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  
  const frameData: ImageData[] = [];
  
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const rng = createRNG(seed + f * 2654435761 + 12345);
    
    // Фон
    ctx.fillStyle = colors[0] || "#0a0b12";
    ctx.fillRect(0, 0, size, size);
    
    // === РИСУЕМ ФОРМЫ В ЗАВИСИМОСТИ ОТ РЕЖИМА ===
    const count = 3 + Math.floor(params.density * 12 + params.complexity * 8);
    
    for (let i = 0; i < count; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const baseSize = 15 + rng() * 45 * (0.5 + params.complexity * 0.5);
      const color = colors[1 + Math.floor(rng() * (colors.length - 1))] || "#ffffff";
      const angle = t * params.speed * 4 * Math.PI + rng() * 6.28;
      
      ctx.save();
      ctx.translate(x, y);
      
      // Симметрия
      if (params.symmetry > 0.2 && i % 2 === 0) {
        const offset = (rng() - 0.5) * baseSize * 0.5 * params.symmetry;
        ctx.translate(0, offset);
      }
      
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.5 + params.lineWeight * 4;
      ctx.beginPath();
      
      // === РАЗНЫЕ ФОРМЫ ДЛЯ РАЗНЫХ РЕЖИМОВ ===
      drawShape(ctx, mode, baseSize, angle, t, i, rng, params);
      
      ctx.closePath();
      ctx.fill();
      if (params.lineWeight > 0.1) {
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.stroke();
      }
      ctx.restore();
    }
    
    // === ДЕТАЛИ (мелкие точки, линии) ===
    if (params.density > 0.2) {
      const detailCount = Math.floor(params.density * 15 + params.complexity * 10);
      for (let i = 0; i < detailCount; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const s = 1 + rng() * 3 * (0.5 + params.lineWeight * 0.5);
        const color = colors[Math.floor(rng() * colors.length)] || "#ffffff";
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.2 + rng() * 0.4;
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    
    // === ПОСТ-ЭФФЕКТЫ ===
    applyEffects(ctx, effects, size, t, rng);
    
    frameData.push(ctx.getImageData(0, 0, size, size));
  }
  
  // === СОБИРАЕМ GIF ===
  const gifData = await buildGifFromFrames(frameData, frames, profile.fps || 24);
  const url = URL.createObjectURL(gifData);
  
  return {
    id: `${seed}-${Date.now()}`,
    url,
    seed,
    system: mode,
    bytes: gifData.size,
    width: size,
    height: size,
    frames,
    fps: profile.fps || 24,
    duration: frames / (profile.fps || 24),
  };
}

// ============================================================
// РИСОВАНИЕ ФОРМ
// ============================================================

function drawShape(
  ctx: CanvasRenderingContext2D,
  mode: string,
  size: number,
  angle: number,
  t: number,
  i: number,
  rng: () => number,
  params: GenParams
) {
  const half = size / 2;
  const pts = 6 + Math.floor(rng() * 8);
  
  switch (mode) {
    case "abstract": {
      for (let j = 0; j < pts; j++) {
        const a = (j / pts) * 2 * Math.PI + angle;
        const r = half * (0.3 + rng() * 0.7);
        const wave = Math.sin(a * 2 + t * 2 + i) * half * 0.15 * params.flow;
        const cx = Math.cos(a) * (r + wave) + (rng() - 0.5) * half * 0.2 * params.chaos;
        const cy = Math.sin(a) * (r + wave) + (rng() - 0.5) * half * 0.2 * params.chaos;
        if (j === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      break;
    }
    
    case "geometric": {
      const sides = 3 + Math.floor(rng() * 4);
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * 2 * Math.PI + angle;
        const r = half * (0.4 + rng() * 0.4);
        const cx = Math.cos(a) * r;
        const cy = Math.sin(a) * r;
        if (j === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      break;
    }
    
    case "organic": {
      const pts2 = 12 + Math.floor(rng() * 12);
      for (let j = 0; j < pts2; j++) {
        const a = (j / pts2) * 2 * Math.PI + angle + t * 0.5 * params.flow;
        const wave = Math.sin(a * 3 + t * 2 + i) * half * 0.3 * params.flow;
        const r = half * (0.4 + 0.4 * (0.5 + 0.5 * Math.sin(a * 2 + t * 1.5 + i * 0.7))) + wave;
        const cx = Math.cos(a) * r;
        const cy = Math.sin(a) * r;
        if (j === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      break;
    }
    
    case "pixel": {
      const grid = 4 + Math.floor(rng() * 6);
      const cell = size / grid;
      const startX = -half;
      const startY = -half;
      let hasPixels = false;
      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          if (rng() > 0.5) continue;
          const cx = startX + gx * cell + cell / 2;
          const cy = startY + gy * cell + cell / 2;
          if (!hasPixels) { ctx.moveTo(cx - cell/2, cy - cell/2); hasPixels = true; }
          ctx.rect(cx - cell/2, cy - cell/2, cell, cell);
        }
      }
      ctx.fill();
      ctx.beginPath();
      return;
    }
    
    case "glitch": {
      const slices = 3 + Math.floor(rng() * 6);
      const glitchAmt = params.effects?.glitch || 0.3;
      for (let j = 0; j < slices; j++) {
        const yOff = (j / slices - 0.5) * size * 1.2;
        const shift = Math.sin(t * 10 + j + i) * half * 0.4 * (0.5 + glitchAmt * 0.5);
        const w = size * (0.15 + rng() * 0.25);
        const h = size * 0.1 * (0.5 + rng() * 0.5);
        const cx = -w / 2 + shift;
        const cy = yOff;
        if (j === 0) ctx.moveTo(cx, cy);
        ctx.rect(cx, cy, w, h);
      }
      break;
    }
    
    case "fluid": {
      const pts2 = 16 + Math.floor(rng() * 16);
      for (let j = 0; j < pts2; j++) {
        const a = (j / pts2) * 2 * Math.PI + angle;
        const r = half * (0.35 + 0.3 * (0.5 + 0.5 * Math.sin(a * 3 + t * 0.8 * params.flow + i * 0.5)));
        const cx = Math.cos(a) * r;
        const cy = Math.sin(a) * r;
        if (j === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      break;
    }
    
    default: {
      for (let j = 0; j < pts; j++) {
        const a = (j / pts) * 2 * Math.PI + angle;
        const r = half * (0.4 + rng() * 0.4);
        const cx = Math.cos(a) * r;
        const cy = Math.sin(a) * r;
        if (j === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
    }
  }
}

// ============================================================
// ПОСТ-ЭФФЕКТЫ
// ============================================================

function applyEffects(
  ctx: CanvasRenderingContext2D,
  effects: PostEffects,
  size: number,
  t: number,
  rng: () => number
) {
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;
  
  // Зерно
  if (effects.grain && effects.grain > 0.01) {
    const intensity = effects.grain * 30;
    for (let i = 0; i < data.length; i += 4) {
      const n = (rng() - 0.5) * intensity;
      data[i] = Math.max(0, Math.min(255, data[i] + n));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    }
  }
  
  // Виньетка
  if (effects.vignette && effects.vignette > 0.01) {
    const cx = size / 2, cy = size / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    const amount = effects.vignette * 1.2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const factor = 1 - (dist / maxDist) * amount;
        const idx = (y * size + x) * 4;
        data[idx] *= factor;
        data[idx + 1] *= factor;
        data[idx + 2] *= factor;
      }
    }
  }
  
  // Хроматическая аберрация
  if (effects.chromatic && effects.chromatic > 0.01) {
    const amount = effects.chromatic * 4;
    const temp = new Uint8ClampedArray(data);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const rOff = Math.round(amount * (x / size - 0.5) * 2);
        const bOff = Math.round(amount * (1 - x / size - 0.5) * 2);
        const rX = Math.max(0, Math.min(size - 1, x + rOff));
        const bX = Math.max(0, Math.min(size - 1, x + bOff));
        data[idx] = temp[(y * size + rX) * 4];
        data[idx + 1] = temp[(y * size + x) * 4 + 1];
        data[idx + 2] = temp[(y * size + bX) * 4 + 2];
      }
    }
  }
  
  // Глитч
  if (effects.glitch && effects.glitch > 0.01) {
    const amount = effects.glitch;
    const temp = new Uint8ClampedArray(data);
    const slices = 3 + Math.floor(amount * 8);
    for (let s = 0; s < slices; s++) {
      const y = Math.floor(rng() * size);
      const height = Math.max(2, Math.floor(2 + rng() * 20 * amount));
      const shift = Math.floor((rng() - 0.5) * 40 * amount * (0.5 + 0.5 * Math.sin(t * 5 + s)));
      for (let dy = 0; dy < height && y + dy < size; dy++) {
        for (let x = 0; x < size; x++) {
          const srcX = Math.max(0, Math.min(size - 1, x + shift));
          const idx = ((y + dy) * size + x) * 4;
          const srcIdx = ((y + dy) * size + srcX) * 4;
          data[idx] = temp[srcIdx];
          data[idx + 1] = temp[srcIdx + 1];
          data[idx + 2] = temp[srcIdx + 2];
        }
      }
    }
  }
  
  ctx.putImageData(imgData, 0, 0);
}

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function createRNG(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 4294967296;
  };
}

async function buildGifFromFrames(
  frames: ImageData[],
  frameCount: number,
  fps: number
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = frames[0].width;
  canvas.height = frames[0].height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(frames[0], 0, 0);
  
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || new Blob()), "image/gif");
  });
}
