/**
 * GIF Decoder - Manual parser with LZW decompression
 */

import type { Frame, ParsedGif, GifDescriptor } from './types';

/**
 * Parse a GIF file and extract all frames as RGBA data
 */
export async function decodeGif(file: File): Promise<Frame[]> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  
  // Validate GIF signature
  const signature = String.fromCharCode(...data.slice(0, 6));
  if (!signature.startsWith('GIF')) {
    throw new Error('Not a valid GIF file');
  }
  
  const gif = parseGif(data);
  return renderFrames(gif);
}

/**
 * Parse GIF structure
 */
function parseGif(data: Uint8Array): ParsedGif {
  let offset = 0;
  
  // Skip signature (6 bytes) + logical screen descriptor (7 bytes)
  offset = 13;
  
  // Parse logical screen descriptor
  const width = data[6] | (data[7] << 8);
  const height = data[8] | (data[9] << 8);
  const packed = data[10];
  const globalColorTableFlag = (packed >> 7) & 1;
  const colorResolution = (packed >> 4) & 0b111;
  const sortFlag = (packed >> 3) & 1;
  const globalColorTableSize = packed & 0b111;
  const backgroundColorIndex = data[11];
  const pixelAspectRatio = data[12];
  
  const descriptor: GifDescriptor = {
    width,
    height,
    backgroundColorIndex,
    pixelAspectRatio
  };
  
  // Parse global color table
  if (globalColorTableFlag) {
    const globalColorTableLength = 3 * (1 << (globalColorTableSize + 1));
    const globalColorTable: number[][] = [];
    for (let i = 0; i < globalColorTableLength; i += 3) {
      globalColorTable.push([
        data[offset + i],
        data[offset + i + 1],
        data[offset + i + 2]
      ]);
    }
    descriptor.globalColorTable = globalColorTable;
    offset += globalColorTableLength;
  }
  
  // Parse blocks
  const frames: ParsedGif['frames'] = [];
  let currentDelay = 100;
  let currentDisposalType = 0;
  let left = 0, top = 0;
  
  while (offset < data.length && data[offset] !== 0x3B) {
    const blockType = data[offset];
    
    if (blockType === 0x21) {
      // Extension block
      offset++;
      const extensionLabel = data[offset];
      offset++;
      
      if (extensionLabel === 0xF9) {
        // Graphics Control Extension
        const blockSize = data[offset];
        const packed = data[offset + 1];
        currentDisposalType = (packed >> 2) & 0b111;
        currentDelay = (data[offset + 2] | (data[offset + 3] << 8)) * 10;
        offset += blockSize + 1;
      } else {
        // Skip other extensions
        while (offset < data.length && data[offset] !== 0) {
          const subBlockSize = data[offset];
          offset += subBlockSize + 1;
        }
        offset++;
      }
    } else if (blockType === 0x2C) {
      // Image descriptor
      offset++;
      left = data[offset] | (data[offset + 1] << 8);
      top = data[offset + 2] | (data[offset + 3] << 8);
      const imgWidth = data[offset + 4] | (data[offset + 5] << 8);
      const imgHeight = data[offset + 6] | (data[offset + 7] << 8);
      const imgPacked = data[offset + 8];
      const localColorTableFlag = (imgPacked >> 7) & 1;
      const interlaceFlag = (imgPacked >> 6) & 1;
      const localColorTableSize = imgPacked & 0b111;
      
      offset += 9;
      
      // Parse local color table if present
      let colorTable = descriptor.globalColorTable;
      if (localColorTableFlag) {
        const localColorTableLength = 3 * (1 << (localColorTableSize + 1));
        const localColorTable: number[][] = [];
        for (let i = 0; i < localColorTableLength; i += 3) {
          localColorTable.push([
            data[offset + i],
            data[offset + i + 1],
            data[offset + i + 2]
          ]);
        }
        colorTable = localColorTable;
        offset += localColorTableLength;
      }
      
      // Decode image data
      const lzwMinimumCodeSize = data[offset];
      offset++;
      
      const compressedData: number[] = [];
      while (offset < data.length && data[offset] !== 0) {
        const subBlockSize = data[offset];
        offset++;
        for (let i = 0; i < subBlockSize; i++) {
          compressedData.push(data[offset + i]);
        }
        offset += subBlockSize;
      }
      offset++; // Skip block terminator
      
      // Decompress using LZW
      const pixels = lzwDecode(compressedData, lzwMinimumCodeSize);
      
      // Create frame with proper positioning
      const frameData = new Uint8ClampedArray(width * height * 4);
      
      // Apply deinterlacing if needed
      let pixelIndex = 0;
      if (interlaceFlag) {
        const passes = [
          { start: 0, step: 8 },
          { start: 4, step: 8 },
          { start: 2, step: 4 },
          { start: 1, step: 2 }
        ];
        
        for (const pass of passes) {
          for (let y = pass.start; y < imgHeight; y += pass.step) {
            for (let x = 0; x < imgWidth; x++) {
              const colorIndex = pixels[pixelIndex++] ?? 0;
              const targetX = left + x;
              const targetY = top + y;
              
              if (targetX >= 0 && targetX < width && targetY >= 0 && targetY < height && colorTable) {
                const color = colorTable[colorIndex];
                const targetIndex = (targetY * width + targetX) * 4;
                frameData[targetIndex] = color[0];
                frameData[targetIndex + 1] = color[1];
                frameData[targetIndex + 2] = color[2];
                frameData[targetIndex + 3] = 255;
              }
            }
          }
        }
      } else {
        for (let y = 0; y < imgHeight; y++) {
          for (let x = 0; x < imgWidth; x++) {
            const colorIndex = pixels[pixelIndex++] ?? 0;
            const targetX = left + x;
            const targetY = top + y;
            
            if (targetX >= 0 && targetX < width && targetY >= 0 && targetY < height && colorTable) {
              const color = colorTable[colorIndex];
              const targetIndex = (targetY * width + targetX) * 4;
              frameData[targetIndex] = color[0];
              frameData[targetIndex + 1] = color[1];
              frameData[targetIndex + 2] = color[2];
              frameData[targetIndex + 3] = 255;
            }
          }
        }
      }
      
      frames.push({
        imageData: new ImageData(frameData, width, height),
        delay: currentDelay,
        disposalType: currentDisposalType,
        left,
        top,
        width: imgWidth,
        height: imgHeight
      });
      
      // Reset delay for next frame
      currentDelay = 100;
      currentDisposalType = 0;
    } else {
      // Unknown block, skip
      offset++;
    }
  }
  
  const totalDelay = frames.reduce((sum, f) => sum + f.delay, 0);
  
  return {
    descriptor,
    frames,
    totalDelay
  };
}

/**
 * LZW Decompression
 */
function lzwDecode(compressedData: number[], minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let maxCode = 1 << codeSize;
  
  const dictionary: number[][] = [];
  for (let i = 0; i < 256; i++) {
    dictionary[i] = [i];
  }
  dictionary[clearCode] = [];
  dictionary[endCode] = [];
  
  const output: number[] = [];
  let bitPosition = 0;
  let oldCode: number | null = null;
  
  function readCode(): number | null {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIndex = Math.floor(bitPosition / 8);
      const bitOffset = bitPosition % 8;
      
      if (byteIndex >= compressedData.length) {
        return null;
      }
      
      const byte = compressedData[byteIndex];
      code |= ((byte >> bitOffset) & 1) << i;
      bitPosition++;
    }
    return code;
  }
  
  while (true) {
    const code = readCode();
    if (code === null) break;
    
    if (code === clearCode) {
      dictionary.length = 0;
      for (let i = 0; i < 256; i++) {
        dictionary[i] = [i];
      }
      dictionary[clearCode] = [];
      dictionary[endCode] = [];
      codeSize = minCodeSize + 1;
      maxCode = 1 << codeSize;
      oldCode = null;
      continue;
    }
    
    if (code === endCode) {
      break;
    }
    
    let entry: number[];
    if (code < dictionary.length) {
      entry = dictionary[code];
    } else if (oldCode !== null) {
      entry = [...dictionary[oldCode], dictionary[oldCode][0]];
    } else {
      entry = [];
    }
    
    output.push(...entry);
    
    if (oldCode !== null && dictionary.length < 4096) {
      const newEntry = [...dictionary[oldCode], entry[0]];
      dictionary.push(newEntry);
      
      if (dictionary.length >= maxCode && codeSize < 12) {
        codeSize++;
        maxCode = 1 << codeSize;
      }
    }
    
    oldCode = code;
  }
  
  return output;
}

/**
 * Render parsed GIF frames to Frame[] format
 */
function renderFrames(gif: ParsedGif): Frame[] {
  const { descriptor, frames } = gif;
  const canvas = document.createElement('canvas');
  canvas.width = descriptor.width;
  canvas.height = descriptor.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  if (!ctx) {
    throw new Error('Could not create canvas context');
  }
  
  const result: Frame[] = [];
  
  for (const frame of frames) {
    // Clear or composite based on disposal type
    if (frame.disposalType === 2) {
      ctx.clearRect(0, 0, descriptor.width, descriptor.height);
    }
    
    // Draw frame
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = frame.width;
    tempCanvas.height = frame.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    if (tempCtx) {
      tempCtx.putImageData(frame.imageData, 0, 0);
      ctx.drawImage(tempCanvas, frame.left, frame.top);
    }
    
    // Get rendered frame data
    const imageData = ctx.getImageData(0, 0, descriptor.width, descriptor.height);
    
    result.push({
      rgba: imageData.data,
      delay: frame.delay,
      width: descriptor.width,
      height: descriptor.height
    });
  }
  
  return result;
}
