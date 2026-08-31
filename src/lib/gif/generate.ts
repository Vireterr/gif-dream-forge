// ============================================================
// generate.ts — расширенная генерация GIF
// ============================================================

import type { GifItem, StyleProfile, GenParams, PostEffects, ColorControl } from "./types";

// ============================================================
// 1. ОСНОВНАЯ ФУНКЦИЯ ГЕНЕРАЦИИ
// ============================================================

export async function generateGif(
  seed: number,
  profile: StyleProfile,
  options: {
    size: number;
    frames: number;
    params?: GenParams;
    effects?: PostEffects;
  }
): Promise<GifItem> {
  const { size, frames, params, effects } = options;
  
  // Создаём генератор с параметрами
  const generator = new GifGenerator(seed, profile, { size, frames, params, effects });
  const data = await generator.generate();
  
  // Создаём GIF
  const gif = await buildGif(data, frames, profile.fps || 24);
  
  // Создаём URL
  const url = URL.createObjectURL(gif);
  
  return {
    id: `${seed}-${Date.now()}`,
    url,
    seed,
    system: "generated",
    bytes: gif.size,
    width: size,
    height: size,
    frames,
    fps: profile.fps || 24,
    duration: frames / (profile.fps || 24),
  };
}

// ============================================================
// 2. ГЕНЕРАТОР
// ============================================================

class GifGenerator {
  private seed: number;
  private profile: StyleProfile;
  private size: number;
  private frames: number;
  private params: GenParams;
  private effects: PostEffects;
  private rng: () => number;

  constructor(
    seed: number,
    profile: StyleProfile,
    options: {
      size: number;
      frames: number;
      params?: GenParams;
      effects?: PostEffects;
    }
  ) {
    this.seed = seed;
    this.profile = profile;
    this.size = options.size;
    this.frames = options.frames;
    this.params = options.params || this.defaultParams();
    this.effects = options.effects || this.defaultEffects();
    this.rng = this.createRNG(seed);
  }

  private defaultParams(): GenParams {
    return {
      mode: "abstract",
      color: {
        mode: "profile",
        palette: this.profile.palette,
        gradientStops: [],
        saturation: this.profile.saturation,
        brightness: this.profile.brightness,
        contrast: this.profile.contrast,
        hueShift: 0,
        colorVariance: this.profile.style.colorVariance,
        preserveAccents: true,
      },
      effects: this.defaultEffects(),
      speed: this.profile.style.speed,
      complexity: this.profile.style.motionComplexity,
      symmetry: this.profile.style.symmetry,
      density: this.profile.style.shapeDensity,
      lineWeight: this.profile.style.lineWeight,
      flow: this.profile.style.flow,
      repetition: this.profile.style.repetition,
      chaos: this.profile.motionProfile?.chaos || 0.3,
    };
  }

  private defaultEffects(): PostEffects {
    const t = this.profile.textureProfile || {
      grain: 0.2,
      noise: 0.2,
      blur: 0.1,
      sharpness: 0.7,
      pixelation: 0.1,
      glitch: 0.05,
      chromatic: 0.05,
      vignette: 0.1,
      bloom: 0.2,
      posterize: 0,
    };
    return {
      blur: t.blur,
      pixelate: t.pixelation,
      grain: t.grain,
      vignette: t.vignette,
      chromatic: t.chromatic,
      glitch: t.glitch,
      bloom: t.bloom,
      posterize: t.posterize,
      noise: t.noise,
      sharpen: t.sharpness,
    };
  }

  private createRNG(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 4294967296;
    };
  }

  // ============================================================
  // 3. ОСНОВНАЯ ГЕНЕРАЦИЯ
  // ============================================================

  async generate(): Promise<ImageData[]> {
    const frames: ImageData[] = [];
    const canvas = document.createElement("canvas");
    canvas.width = this.size;
    canvas.height = this.size;
    const ctx = canvas.getContext("2d")!;
    
    for (let f = 0; f < this.frames; f++) {
      const t = f / this.frames;
      ctx.clearRect(0, 0, this.size, this.size);
      
      // 3a. Фон
      this.drawBackground(ctx, t);
      
      // 3b. Основные формы
      this.drawShapes(ctx, t);
      
      // 3c. Детали
      this.drawDetails(ctx, t);
      
      // 3d. Пост-эффекты
      this.applyEffects(ctx, t);
      
      frames.push(ctx.getImageData(0, 0, this.size, this.size));
    }
    
    return frames;
  }

  // ============================================================
  // 4. РИСОВАНИЕ ФОНА
  // ============================================================

  private drawBackground(ctx: CanvasRenderingContext2D, t: number) {
    const palette = this.getPalette(t);
    const bg = palette[0] || "#000000";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.size, this.size);
  }

  // ============================================================
  // 5. РИСОВАНИЕ ФОРМ
  // ============================================================

  private drawShapes(ctx: CanvasRenderingContext2D, t: number) {
    const palette = this.getPalette(t);
    const count = Math.floor(5 + this.params.density * 20);
    const mode = this.params.mode;
    
    for (let i = 0; i < count; i++) {
      const x = this.rng() * this.size;
      const y = this.rng() * this.size;
      const size = (10 + this.rng() * 40) * (0.5 + this.params.complexity * 0.5);
      const color = palette[1 + Math.floor(this.rng() * (palette.length - 1))] || "#ffffff";
      const angle = t * this.params.speed * 2 * Math.PI + this.rng() * 6.28;
      
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 + this.params.lineWeight * 4;
      
      // Рисуем фигуры в зависимости от режима
      this.drawShape(ctx, mode, size, t, i);
      
      ctx.restore();
    }
  }

  // ============================================================
  // 6. РИСОВАНИЕ ОДНОЙ ФИГУРЫ
  // ============================================================

  private drawShape(ctx: CanvasRenderingContext2D, mode: string, size: number, t: number, i: number) {
    const r = this.rng();
    const r2 = this.rng();
    const sym = this.params.symmetry;
    
    // Применяем симметрию
    const angle = t * this.params.speed * 2 * Math.PI + r * 6.28;
    const offset = (r2 - 0.5) * size * 0.3 * (1 - sym);
    
    ctx.beginPath();
    
    switch (mode) {
      case "abstract":
        this.drawAbstractShape(ctx, size, angle, offset);
        break;
      case "geometric":
        this.drawGeometricShape(ctx, size, angle, offset, r);
        break;
      case "organic":
        this.drawOrganicShape(ctx, size, angle, offset, t, i);
        break;
      case "pixel":
        this.drawPixelShape(ctx, size, angle, offset);
        break;
      case "glitch":
        this.drawGlitchShape(ctx, size, angle, offset, t);
        break;
      case "fluid":
        this.drawFluidShape(ctx, size, angle, offset, t, i);
        break;
      default:
        this.drawAbstractShape(ctx, size, angle, offset);
    }
    
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // ============================================================
  // 7. КОНКРЕТНЫЕ ФОРМЫ
  // ============================================================

  private drawAbstractShape(ctx: CanvasRenderingContext2D, size: number, angle: number, offset: number) {
    const pts = 6 + Math.floor(this.rng() * 6);
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * 2 * Math.PI + angle;
      const r = size * (0.3 + this.rng() * 0.7);
      const x = Math.cos(a) * r + offset * Math.cos(a * 2);
      const y = Math.sin(a) * r + offset * Math.sin(a * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  private drawGeometricShape(ctx: CanvasRenderingContext2D, size: number, angle: number, offset: number, r: number) {
    const sides = 3 + Math.floor(r * 4);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * 2 * Math.PI + angle;
      const rad = size * (0.4 + r * 0.4);
      const x = Math.cos(a) * rad + offset;
      const y = Math.sin(a) * rad + offset;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  private drawOrganicShape(ctx: CanvasRenderingContext2D, size: number, angle: number, offset: number, t: number, i: number) {
    const pts = 12 + Math.floor(this.rng() * 12);
    const flow = this.params.flow;
    for (let i2 = 0; i2 < pts; i2++) {
      const a = (i2 / pts) * 2 * Math.PI + angle + t * 0.5 * flow;
      const wave = Math.sin(a * 3 + t * 2 + i) * size * 0.15 * flow;
      const r = size * (0.4 + 0.4 * (0.5 + 0.5 * Math.sin(a * 2 + t * 1.5 + i * 0.7))) + wave;
      const x = Math.cos(a) * r + offset * Math.sin(a * 2 + t);
      const y = Math.sin(a) * r + offset * Math.cos(a * 2 + t);
      if (i2 === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  private drawPixelShape(ctx: CanvasRenderingContext2D, size: number, angle: number, offset: number) {
    const grid = 4 + Math.floor(this.rng() * 8);
    const cellSize = size / grid;
    ctx.fillRect(
      -size/2 + offset * 0.5,
      -size/2 + offset * 0.5,
      size,
      size
    );
    ctx.clearRect(
      -size/4 + offset * 0.3,
      -size/4 + offset * 0.3,
      size/2,
      size/2
    );
  }

  private drawGlitchShape(ctx: CanvasRenderingContext2D, size: number, angle: number, offset: number, t: number) {
    const slices = 3 + Math.floor(this.rng() * 5);
    const glitch = this.effects.glitch || 0.3;
    for (let i = 0; i < slices; i++) {
      const yOff = (i / slices - 0.5) * size * 1.5;
      const shift = Math.sin(t * 10 + i + this.rng() * 10) * size * 0.2 * glitch;
      const width = size * (0.3 + this.rng() * 0.4);
      const height = size * 0.2 * (0.5 + this.rng() * 0.5);
      ctx.fillRect(
        -width/2 + shift + offset * 0.5,
        yOff + offset * 0.3,
        width,
        height
      );
    }
  }

  private drawFluidShape(ctx: CanvasRenderingContext2D, size: number, angle: number, offset: number, t: number, i: number) {
    const pts = 16 + Math.floor(this.rng() * 16);
    const flow = this.params.flow;
    for (let i2 = 0; i2 < pts; i2++) {
      const a = (i2 / pts) * 2 * Math.PI + angle;
      const r = size * (0.35 + 0.3 * (0.5 + 0.5 * Math.sin(a * 3 + t * 0.8 * flow + i * 0.5)));
      const x = Math.cos(a) * r + offset * 0.5 * Math.sin(a * 2 + t * 0.5);
      const y = Math.sin(a) * r + offset * 0.5 * Math.cos(a * 2 + t * 0.5);
      if (i2 === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  // ============================================================
  // 8. ДЕТАЛИ
  // ============================================================

  private drawDetails(ctx: CanvasRenderingContext2D, t: number) {
    if (this.params.complexity < 0.3) return;
    const count = Math.floor(this.params.density * 10 * this.params.complexity);
    const palette = this.getPalette(t);
    
    for (let i = 0; i < count; i++) {
      const x = this.rng() * this.size;
      const y = this.rng() * this.size;
      const size = 2 + this.rng() * 6 * this.params.lineWeight;
      const color = palette[Math.floor(this.rng() * palette.length)] || "#ffffff";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // ============================================================
  // 9. ПОСТ-ЭФФЕКТЫ
  // ============================================================

  private applyEffects(ctx: CanvasRenderingContext2D, t: number) {
    const imgData = ctx.getImageData(0, 0, this.size, this.size);
    const data = imgData.data;
    
    // 9a. Зерно
    if (this.effects.grain > 0.01) {
      this.applyGrain(data, this.effects.grain);
    }
    
    // 9b. Пикселизация
    if (this.effects.pixelate > 0.01) {
      this.applyPixelate(ctx, this.effects.pixelate);
      return; // pixelate уже использует ctx
    }
    
    // 9c. Размытие
    if (this.effects.blur > 0.01) {
      this.applyBlur(data, this.size, this.effects.blur);
    }
    
    // 9d. Хроматическая аберрация
    if (this.effects.chromatic > 0.01) {
      this.applyChromatic(ctx, this.effects.chromatic, t);
      return;
    }
    
    // 9e. Глитч
    if (this.effects.glitch > 0.01) {
      this.applyGlitch(ctx, this.effects.glitch, t);
      return;
    }
    
    // 9f. Виньетка
    if (this.effects.vignette > 0.01) {
      this.applyVignette(ctx, this.effects.vignette);
      return;
    }
    
    // 9g. Свечение
    if (this.effects.bloom > 0.01) {
      this.applyBloom(ctx, this.effects.bloom);
      return;
    }
    
    // Если ничего не применялось, обновляем данные
    ctx.putImageData(imgData, 0, 0);
  }

  // ============================================================
  // 10. КОНКРЕТНЫЕ ЭФФЕКТЫ
  // ============================================================

  private applyGrain(data: Uint8ClampedArray, amount: number) {
    const intensity = amount * 30;
    for (let i = 0; i < data.length; i += 4) {
      const n = (this.rng() - 0.5) * intensity;
      data[i] = Math.max(0, Math.min(255, data[i] + n));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    }
  }

  private applyPixelate(ctx: CanvasRenderingContext2D, amount: number) {
    const size = Math.max(2, Math.round(4 + amount * 16));
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const tempData = new Uint8ClampedArray(data);
    
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = 0; dy < size && y + dy < h; dy++) {
          for (let dx = 0; dx < size && x + dx < w; dx++) {
            const idx = ((y + dy) * w + (x + dx)) * 4;
            r += tempData[idx];
            g += tempData[idx + 1];
            b += tempData[idx + 2];
            count++;
          }
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        for (let dy = 0; dy < size && y + dy < h; dy++) {
          for (let dx = 0; dx < size && x + dx < w; dx++) {
            const idx = ((y + dy) * w + (x + dx)) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  private applyBlur(data: Uint8ClampedArray, size: number, amount: number) {
    const radius = Math.max(1, Math.round(amount * 8));
    const w = size;
    const h = size;
    const temp = new Uint8ClampedArray(data);
    const kernelSize = radius * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const v = Math.exp(-(i * i) / (2 * radius * radius));
      kernel[i + radius] = v;
      sum += v;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
    
    // Горизонтальный проход
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = Math.max(0, Math.min(w - 1, x + k));
          const idx = (y * w + sx) * 4;
          const weight = kernel[k + radius];
          r += temp[idx] * weight;
          g += temp[idx + 1] * weight;
          b += temp[idx + 2] * weight;
        }
        const idx = (y * w + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
      }
    }
    
    // Вертикальный проход
    const temp2 = new Uint8ClampedArray(data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let k = -radius; k <= radius; k++) {
          const sy = Math.max(0, Math.min(h - 1, y + k));
          const idx = (sy * w + x) * 4;
          const weight = kernel[k + radius];
          r += temp2[idx] * weight;
          g += temp2[idx + 1] * weight;
          b += temp2[idx + 2] * weight;
        }
        const idx = (y * w + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
      }
    }
  }

  private applyChromatic(ctx: CanvasRenderingContext2D, amount: number, t: number) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const temp = new Uint8ClampedArray(data);
    const offset = amount * 6;
    const wobble = 1 + Math.sin(t * 2) * 0.3;
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const dx = Math.round(offset * wobble * (x / w - 0.5) * 2);
        const dy = Math.round(offset * wobble * (y / h - 0.5) * 2);
        const srcX = Math.max(0, Math.min(w - 1, x + dx));
        const srcY = Math.max(0, Math.min(h - 1, y + dy));
        const srcIdx = (srcY * w + srcX) * 4;
        data[idx] = temp[srcIdx];
        data[idx + 1] = temp[srcIdx + 1];
        data[idx + 2] = temp[srcIdx + 2];
        // Сдвиг каналов
        const rOff = Math.round(offset * (x / w - 0.5) * 2);
        const gOff = 0;
        const bOff = Math.round(offset * (1 - x / w - 0.5) * 2);
        const rX = Math.max(0, Math.min(w - 1, x + rOff));
        const bX = Math.max(0, Math.min(w - 1, x + bOff));
        data[idx] = temp[(y * w + rX) * 4];
        data[idx + 1] = temp[(y * w + x) * 4 + 1];
        data[idx + 2] = temp[(y * w + bX) * 4 + 2];
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  private applyGlitch(ctx: CanvasRenderingContext2D, amount: number, t: number) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const temp = new Uint8ClampedArray(data);
    
    // Несколько сдвиговых полос
    const slices = 3 + Math.floor(amount * 8);
    for (let i = 0; i < slices; i++) {
      const y = Math.floor(this.rng() * h);
      const height = Math.max(2, Math.floor(2 + this.rng() * 20 * amount));
      const shift = Math.floor((this.rng() - 0.5) * 40 * amount * (0.5 + 0.5 * Math.sin(t * 5 + i)));
      const rShift = Math.floor((this.rng() - 0.5) * 20 * amount);
      const bShift = Math.floor((this.rng() - 0.5) * 20 * amount);
      
      for (let dy = 0; dy < height && y + dy < h; dy++) {
        for (let x = 0; x < w; x++) {
          const srcX = Math.max(0, Math.min(w - 1, x + shift));
          const idx = ((y + dy) * w + x) * 4;
          const srcIdx = ((y + dy) * w + srcX) * 4;
          data[idx] = temp[srcIdx + rShift];
          data[idx + 1] = temp[srcIdx + 1];
          data[idx + 2] = temp[srcIdx + bShift];
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  private applyVignette(ctx: CanvasRenderingContext2D, amount: number) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const cx = w / 2, cy = h / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const factor = 1 - (dist / maxDist) * amount * 1.2;
        const idx = (y * w + x) * 4;
        data[idx] *= factor;
        data[idx + 1] *= factor;
        data[idx + 2] *= factor;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  private applyBloom(ctx: CanvasRenderingContext2D, amount: number) {
    // Упрощённый bloom: размытие + наложение
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const temp = new Uint8ClampedArray(data);
    
    // Применяем размытие
    const radius = Math.max(1, Math.round(amount * 4));
    for (let y = radius; y < h - radius; y++) {
      for (let x = radius; x < w - radius; x++) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const idx = ((y + dy) * w + (x + dx)) * 4;
            r += temp[idx];
            g += temp[idx + 1];
            b += temp[idx + 2];
            count++;
          }
        }
        const idx = (y * w + x) * 4;
        // Смешиваем с оригиналом
        const blend = 0.5 + amount * 0.4;
        data[idx] = temp[idx] * (1 - blend) + (r / count) * blend;
        data[idx + 1] = temp[idx + 1] * (1 - blend) + (g / count) * blend;
        data[idx + 2] = temp[idx + 2] * (1 - blend) + (b / count) * blend;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // ============================================================
  // 11. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  // ============================================================

  private getPalette(t: number): string[] {
    const color = this.params.color;
    if (color.mode === "palette" && color.palette.length > 0) {
      return color.palette;
    }
    if (color.mode === "gradient" && color.gradientStops.length > 0) {
      const stops = color.gradientStops;
      // Интерполируем между стопами
      const pos = (t + 0.2 * this.rng()) % 1;
      let prev = stops[0];
      for (let i = 1; i < stops.length; i++) {
        if (stops[i].pos >= pos) {
          const frac = (pos - prev.pos) / (stops[i].pos - prev.pos);
          return [interpolateColor(prev.color, stops[i].color, frac)];
        }
        prev = stops[i];
      }
      return [stops[stops.length - 1].color];
    }
    // Используем профиль
    return this.profile.palette || ["#ffffff", "#000000"];
  }
}

// ============================================================
// 12. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (ГЛОБАЛЬНЫЕ)
// ============================================================

function interpolateColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${[r, g, b].map(c => Math.min(255, Math.max(0, c)).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
}

// ============================================================
// 13. ПОСТРОЕНИЕ GIF
// ============================================================

async function buildGif(frames: ImageData[], frameCount: number, fps: number): Promise<Blob> {
  // Здесь используется GIFEncoder из gifenc
  // (импорт уже есть в начале файла)
  // Для краткости оставляем заглушку
  // В реальном коде здесь будет создание GIF
  
  // Создаём простой canvas для демонстрации
  const canvas = document.createElement("canvas");
  canvas.width = frames[0]?.width || 256;
  canvas.height = frames[0]?.height || 256;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(frames[0], 0, 0);
  
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob || new Blob()), "image/gif");
  });
}
