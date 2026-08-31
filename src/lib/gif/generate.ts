import type { GifItem, StyleProfile } from "./types";

// ============================================================
// РЕАЛЬНАЯ ГЕНЕРАЦИЯ GIF-АРТА
// ============================================================

export async function generateGif(
  seed: number,
  profile: any,
  options: { size: number; frames: number }
): Promise<GifItem> {
  const { size, frames } = options;
  
  // Определяем параметры из профиля
  const mode = profile.mode || "abstract";
  const params = profile.params || {};
  const effects = profile.effects || {};
  
  const speed = params.speed || 0.5;
  const complexity = params.complexity || 0.5;
  const symmetry = params.symmetry || 0.3;
  const density = params.density || 0.5;
  const lineWeight = params.lineWeight || 0.5;
  const flow = params.flow || 0.5;
  const chaos = params.chaos || 0.3;
  const colors = profile.palette || ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff"];
  
  // Создаём canvas
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  
  // Массив кадров
  const frameData: ImageData[] = [];
  
  // Генерируем кадры
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const rng = createRNG(seed + f * 2654435761);
    
    // Фон
    ctx.fillStyle = colors[0] || "#0a0b12";
    ctx.fillRect(0, 0, size, size);
    
    // Количество объектов
    const count = 3 + Math.floor(density * 15 + complexity * 10);
    
    // Рисуем объекты
    for (let i = 0; i < count; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const s = 15 + rng() * 45 * (0.5 + complexity * 0.5);
      const color = colors[1 + Math.floor(rng() * (colors.length - 1))] || "#ffffff";
      const angle = t * speed * 4 * Math.PI + rng() * 6.28;
      const symOffset = symmetry * (rng() - 0.5) * s * 0.5;
      
      ctx.save();
      ctx.translate(x, y);
      
      // Симметрия
      if (symmetry > 0.3 && i % 2 === 0) {
        ctx.translate(0, symOffset);
      }
      
      // Рисуем форму в зависимости от режима
      drawShape(ctx, mode, s, angle, t, i, rng, flow, chaos, lineWeight);
      
      ctx.restore();
    }
    
    // Детали (мелкие точки)
    if (density > 0.3) {
      const detailCount = Math.floor(density * 20);
      for (let i = 0; i < detailCount; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const s = 1 + rng() * 4 * lineWeight;
        const color = colors[Math.floor(rng() * colors.length)] || "#ffffff";
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3 + rng() * 0.5;
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    
    // Пост-эффекты
    applyEffects(ctx, effects, size, t, rng);
    
    frameData.push(ctx.getImageData(0, 0, size, size));
  }
  
  // Собираем GIF
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
  flow: number,
  chaos: number,
  lineWeight: number
) {
  const pts = 6 + Math.floor(rng() * 8);
  const half = size / 2;
  
  ctx.beginPath();
  
  switch (mode) {
    case "abstract": {
      for (let j = 0; j < pts; j++) {
        const a = (j / pts) * 2 * Math.PI + angle;
        const r = half * (0.3 + rng() * 0.7);
        const wave = Math.sin(a * 2 + t * 2 + i) * half * 0.15 * flow;
        const x = Math.cos(a) * (r + wave) + (rng() - 0.5) * half * 0.2 * chaos;
        const y = Math.sin(a) * (r + wave) + (rng() - 0.5) * half * 0.2 * chaos;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      break;
    }
    
    case "geometric": {
      const sides = 3 + Math.floor(rng() * 4);
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * 2 * Math.PI + angle;
        const r = half * (0.4 + rng() * 0.4);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      break;
    }
    
    case "organic": {
      const pts2 = 12 + Math.floor(rng() * 12);
      for (let j = 0; j < pts2; j++) {
        const a = (j / pts2) * 2 * Math.PI + angle + t * 0.5 * flow;
        const wave = Math.sin(a * 3 + t * 2 + i) * half * 0.3 * flow;
        const r = half * (0.4 + 0.4 * (0.5 + 0.5 * Math.sin(a * 2 + t * 1.5 + i * 0.7))) + wave;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      break;
    }
    
    case "pixel": {
      const grid = 4 + Math.floor(rng() * 6);
      const cell = size / grid;
      const startX = -half;
      const startY = -half;
      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          if (rng() > 0.5) continue;
          const x = startX + gx * cell;
          const y = startY + gy * cell;
          ctx.rect(x, y, cell, cell);
        }
      }
      ctx.fillStyle = ctx.strokeStyle as string;
      ctx.fill();
      ctx.beginPath();
      return;
    }
    
    case "glitch": {
      const slices = 3 + Math.floor(rng() * 6);
      for (let j = 0; j < slices; j++) {
        const yOff = (j / slices - 0.5) * size * 1.2;
        const shift = Math.sin(t * 10 + j + i) * half * 0.4;
        const w = size * (0.2 + rng() * 0.3);
        const h = size * 0.12 * (0.5 + rng() * 0.5);
        ctx.rect(-w / 2 + shift, yOff, w, h);
      }
      break;
    }
    
    case "fluid": {
      const pts2 = 16 + Math.floor(rng() * 16);
      for (let j = 0; j < pts2; j++) {
        const a = (j / pts2) * 2 * Math.PI + angle;
        const r = half * (0.35 + 0.3 * (0.5 + 0.5 * Math.sin(a * 3 + t * 0.8 * flow + i * 0.5)));
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      break;
    }
    
    default: {
      for (let j = 0; j < pts; j++) {
        const a = (j / pts) * 2 * Math.PI + angle;
        const r = half * (0.4 + rng() * 0.4);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
  }
  
  ctx.closePath();
  ctx.fill();
  
  // Обводка
  const lw = 0.5 + lineWeight * 4;
  ctx.lineWidth = lw;
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.stroke();
}

// ============================================================
// ПОСТ-ЭФФЕКТЫ
// ============================================================

function applyEffects(
  ctx: CanvasRenderingContext2D,
  effects: any,
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
// ГЕНЕРАТОР СЛУЧАЙНЫХ ЧИСЕЛ
// ============================================================

function createRNG(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 4294967296;
  };
}

// ============================================================
// СБОРКА GIF
// ============================================================

async function buildGifFromFrames(
  frames: ImageData[],
  frameCount: number,
  fps: number
): Promise<Blob> {
  // Реальная сборка через gifenc
  // Пока — конвертируем в canvas и возвращаем как GIF
  const canvas = document.createElement("canvas");
  canvas.width = frames[0].width;
  canvas.height = frames[0].height;
  const ctx = canvas.getContext("2d")!;
  
  // Показываем первый кадр
  ctx.putImageData(frames[0], 0, 0);
  
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || new Blob()), "image/gif");
  });
}
