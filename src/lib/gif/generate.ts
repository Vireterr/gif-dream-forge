import type { GifItem, StyleProfile } from "./types";

export async function generateGif(
  seed: number,
  profile: StyleProfile,
  options: { size: number; frames: number }
): Promise<GifItem> {
  const { size, frames } = options;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Генерируем кадры
  const frameData: ImageData[] = [];
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    ctx.fillStyle = profile.palette[0] || "#000";
    ctx.fillRect(0, 0, size, size);

    const colors = profile.palette;
    const count = 5 + Math.floor(seed % 20);

    for (let i = 0; i < count; i++) {
      const x = ((seed * (i + 1) * 7 + f * 13) % size);
      const y = ((seed * (i + 1) * 11 + f * 17) % size);
      const r = 20 + ((seed * (i + 1) * 3 + f * 5) % 40);
      const color = colors[i % colors.length] || "#fff";
      
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    frameData.push(ctx.getImageData(0, 0, size, size));
  }

  // Собираем GIF
  const gif = await buildGif(frameData, frames, profile.fps || 24);
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

async function buildGif(frames: ImageData[], frameCount: number, fps: number): Promise<Blob> {
  // Простая заглушка — возвращает первый кадр как GIF
  const canvas = document.createElement("canvas");
  canvas.width = frames[0]?.width || 256;
  canvas.height = frames[0]?.height || 256;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(frames[0], 0, 0);
  
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || new Blob()), "image/gif");
  });
}
