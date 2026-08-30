/**
 * Color conversion utilities
 */

/**
 * Convert HSL to RGB
 * h: 0-360, s: 0-1, l: 0-1
 * Returns [r, g, b] each 0-255
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  
  let r1 = 0, g1 = 0, b1 = 0;
  
  if (h < 60) {
    r1 = c; g1 = x; b1 = 0;
  } else if (h < 120) {
    r1 = x; g1 = c; b1 = 0;
  } else if (h < 180) {
    r1 = 0; g1 = c; b1 = x;
  } else if (h < 240) {
    r1 = 0; g1 = x; b1 = c;
  } else if (h < 300) {
    r1 = x; g1 = 0; b1 = c;
  } else {
    r1 = c; g1 = 0; b1 = x;
  }
  
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ];
}

/**
 * Convert RGB to HSL
 * r, g, b: 0-255
 * Returns [h, s, l] where h: 0-360, s: 0-1, l: 0-1
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  
  return [h * 360, s, l];
}

/**
 * Apply color transform to a pixel
 */
export function applyColorTransform(
  r: number,
  g: number,
  b: number,
  hueShift: number,
  saturationMul: number,
  lightnessShift: number,
  contrastMul: number
): [number, number, number] {
  let [h, s, l] = rgbToHsl(r, g, b);
  
  // Apply hue shift
  h = ((h + hueShift) % 360 + 360) % 360;
  
  // Apply saturation multiplier
  s = Math.max(0, Math.min(1, s * saturationMul));
  
  // Apply lightness shift
  l = Math.max(0, Math.min(1, l + lightnessShift));
  
  // Apply contrast
  const contrastCenter = 0.5;
  l = contrastCenter + (l - contrastCenter) * contrastMul;
  l = Math.max(0, Math.min(1, l));
  
  return hslToRgb(h, s, l);
}
