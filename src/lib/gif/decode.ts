/**
 * GIF Decoder — decodes a GIF file into fully composited RGBA frames.
 * Uses gifuct-js for parsing/LZW and canvas for frame disposal handling.
 */

import type { Frame } from "./types";

export async function decodeGif(file: File): Promise<Frame[]> {
  const { parseGIF, decompressFrames } = await import("gifuct-js");
  const buffer = await file.arrayBuffer();
  const gif = parseGIF(buffer);
  const parsed = decompressFrames(gif, true);
  if (!parsed.length) throw new Error("No frames found in GIF");

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create canvas context");

  const patch = document.createElement("canvas");
  const patchCtx = patch.getContext("2d");
  if (!patchCtx) throw new Error("Could not create canvas context");

  const frames: Frame[] = [];
  let previous: ImageData | null = null;

  for (const f of parsed) {
    const disposal = f.disposalType ?? 0;
    if (disposal === 3) previous = ctx.getImageData(0, 0, width, height);

    patch.width = f.dims.width;
    patch.height = f.dims.height;
    patchCtx.putImageData(
      new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height),
      0,
      0,
    );
    ctx.drawImage(patch, f.dims.left, f.dims.top);

    const composited = ctx.getImageData(0, 0, width, height);
    frames.push({
      rgba: new Uint8ClampedArray(composited.data),
      delay: f.delay && f.delay > 0 ? f.delay : 100,
      width,
      height,
    });

    if (disposal === 2) {
      ctx.clearRect(f.dims.left, f.dims.top, f.dims.width, f.dims.height);
    } else if (disposal === 3 && previous) {
      ctx.putImageData(previous, 0, 0);
    }
  }

  return frames;
}
