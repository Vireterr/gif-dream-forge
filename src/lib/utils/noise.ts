/**
 * Noise functions for procedural generation
 * Based on Perlin noise implementation
 */

// Precomputed permutation table (4096 entries)
const noiseTable = new Uint8Array(4096);

// Initialize noise table with pseudo-random values
function initNoiseTable() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  
  // Shuffle
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  
  // Fill 4096 table
  for (let i = 0; i < 4096; i++) {
    noiseTable[i] = p[i & 255];
  }
}

initNoiseTable();

/**
 * Fast hash function for integer coordinates
 */
export function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return h ^ (h >> 16);
}

/**
 * Hash to 0-1 range
 */
export function hash01(x: number, y: number): number {
  return (hash(x, y) & 0xffffff) / 0x1000000;
}

/**
 * Smoothstep interpolation
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 2D value noise at given coordinates
 */
export function noiseAt(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  
  const sx = smoothstep(xf);
  const sy = smoothstep(yf);
  
  const tl = hash01(xi, yi);
  const tr = hash01(xi + 1, yi);
  const bl = hash01(xi, yi + 1);
  const br = hash01(xi + 1, yi + 1);
  
  const top = tl + (tr - tl) * sx;
  const bottom = bl + (br - bl) * sx;
  
  return top + (bottom - top) * sy;
}

/**
 * Fractal Brownian Motion - multiple octaves of noise
 */
export function fbmNoise2D(x: number, y: number, octaves: number = 4, lacunarity: number = 2, persistence: number = 0.5): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noiseAt(x * frequency, y * frequency);
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  
  return value / maxValue;
}

/**
 * Generate 2D Perlin noise field
 * Returns displacement vectors (dx, dy) for each pixel
 */
export function perlinNoise2D(
  width: number,
  height: number,
  baseFreqX: number,
  baseFreqY: number,
  seed: number
): { dx: Float32Array; dy: Float32Array } {
  const dx = new Float32Array(width * height);
  const dy = new Float32Array(width * height);
  
  // Deterministic random based on seed
  const rand = mulberry32(seed);
  const phaseX = rand() * 1000;
  const phaseY = rand() * 1000;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x / width) * baseFreqX + phaseX;
      const ny = (y / height) * baseFreqY + phaseY;
      
      // Get noise values for dx and dy
      const noiseX = fbmNoise2D(nx, ny, 4, 2, 0.5);
      const noiseY = fbmNoise2D(nx + 5.3, ny + 2.7, 4, 2, 0.5);
      
      // Convert to -1 to 1 range
      const dX = (noiseX - 0.5) * 2;
      const dY = (noiseY - 0.5) * 2;
      
      dx[y * width + x] = dX;
      dy[y * width + x] = dY;
    }
  }
  
  return { dx, dy };
}

/**
 * Mulberry32 PRNG for deterministic randomness
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
