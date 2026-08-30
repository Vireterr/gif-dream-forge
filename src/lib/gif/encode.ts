/**
 * GIF Encoder using gifenc library
 */

import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Frame } from './types';

/**
 * Encode frames to a GIF blob
 */
export async function encodeGif(frames: Frame[]): Promise<Blob> {
  const gif = GIFEncoder();
  
  if (frames.length === 0) {
    throw new Error('No frames to encode');
  }
  
  const { width, height } = frames[0]!;
  let palette: number[][] | null = null;
  
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const rgba = frame.rgba;
    
    // Quantize on first frame
    if (!palette) {
      palette = quantize(rgba, 256);
    }
    
    // Apply palette to get indexed colors
    const indexed = applyPalette(rgba, palette);
    
    // Write frame with original delay
    gif.writeFrame(indexed, width, height, {
      palette: i === 0 ? palette : undefined,
      delay: frame.delay
    });
    
    // Yield every few frames to prevent blocking
    if (i % 4 === 3) {
      await new Promise(r => setTimeout(r, 0));
    }
  }
  
  gif.finish();
  const bytes = gif.bytes();
  
  return new Blob([bytes as unknown as BlobPart], { type: 'image/gif' });
}

/**
 * Encode a single variation and return as blob URL
 */
export async function encodeVariation(frames: Frame[]): Promise<{ blob: Blob; url: string; bytes: number }> {
  const blob = await encodeGif(frames);
  const url = URL.createObjectURL(blob);
  
  return {
    blob,
    url,
    bytes: blob.size
  };
}
