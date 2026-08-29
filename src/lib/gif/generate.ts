import type { GifItem, StyleProfile } from "./types";

/* ---------- deterministic randomness ---------- */

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

function valueNoise(rand: () => number) {
  const grid = 8;
  const table: number[] = [];
  for (let i = 0; i < grid * grid; i++) table.push(rand());
  const at = (x: number, y: number) => table[(((y % grid) + grid) % grid) * grid + (((x % grid) + grid) % grid)]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

/* ---------- recipes ---------- */

export const SYSTEMS = ["flow", "orbit", "shards", "waves", "strata", "cells"] as const;
export type System = (typeof SYSTEMS)[number];

interface Recipe {
  system: System;
  rand: () => number;
  noise: (x: number, y: number) => number;
  colors: string[];
  bg: string;
  speed: number;
  density: number;
  scale: number;
  rot: number;
  grain: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mix(a: string, b: string, t: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(
    A[2] + (B[2] - A[2]) * t,
  )})`;
}

export function makeRecipe(seed: number, p: StyleProfile): Recipe {
  const rand = mulberry32(seed);
  const system = SYSTEMS[Math.floor(rand() * SYSTEMS.length)]!;
  // rotate the palette so each piece reads as a sibling, not a clone
  const offset = Math.floor(rand() * p.palette.length);
  const colors = p.palette.map((_, i) => p.palette[(i + offset) % p.palette.length]!);
  const darkest = p.palette[0] ?? "#101014";
  const bg = rand() < 0.7 ? darkest : mix(darkest, p.background, 0.5).replace("rgb", "rgb");
  return {
    system,
    rand,
    noise: valueNoise(mulberry32(seed * 7919 + 13)),
    colors,
    bg,
    speed: 0.4 + p.motion * 1.8 + rand() * 0.5,
    density: 0.5 + p.contrast * 0.8 + rand() * 0.7,
    scale: 0.6 + rand() * 1.4,
    rot: rand() * Math.PI * 2,
    grain: p.grain,
  };
}

/* ---------- frame painters (t in 0..1, seamless loop) ---------- */

function paint(ctx: CanvasRenderingContext2D, S: number, t: number, r: Recipe, p: StyleProfile) {
  const TAU = Math.PI * 2;
  const c = (i: number) => r.colors[Math.abs(i) % r.colors.length]!;

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = r.bg;
  ctx.fillRect(0, 0, S, S);

  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(r.rot);
  ctx.translate(-S / 2, -S / 2);

  if (r.system === "flow") {
    const lines = Math.round(70 * r.density);
    ctx.lineWidth = Math.max(1, S / 170) * (1 + r.density);
    for (let i = 0; i < lines; i++) {
      const seedPhase = i / lines;
      let x = ((seedPhase * 7.3) % 1) * S;
      let y = ((seedPhase * 3.1 + 0.17) % 1) * S;
      ctx.strokeStyle = c(i);
      ctx.globalAlpha = 0.35 + 0.5 * ((i % 5) / 5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 26; s++) {
        const n = r.noise((x / S) * 4 * r.scale + Math.cos(t * TAU), (y / S) * 4 * r.scale + Math.sin(t * TAU));
        const a = n * TAU * 2;
        x += Math.cos(a) * S * 0.02;
        y += Math.sin(a) * S * 0.02;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (r.system === "orbit") {
    const rings = Math.round(4 + r.density * 5);
    for (let ring = 0; ring < rings; ring++) {
      const rad = (S * 0.08 + (ring / rings) * S * 0.42) * (1 + 0.06 * Math.sin(t * TAU + ring));
      const dots = 6 + ring * 4;
      for (let d = 0; d < dots; d++) {
        const a = (d / dots) * TAU + t * TAU * r.speed * (ring % 2 ? -1 : 1);
        const x = S / 2 + Math.cos(a) * rad;
        const y = S / 2 + Math.sin(a) * rad;
        const size = (S / 60) * (0.6 + ((ring + d) % 3) * 0.5);
        ctx.fillStyle = c(ring + d);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
      }
    }
  } else if (r.system === "shards") {
    const wedges = Math.round(6 + r.density * 8);
    for (let i = 0; i < wedges; i++) {
      const a0 = (i / wedges) * TAU + t * TAU * r.speed * 0.4;
      const a1 = a0 + TAU / wedges / (1 + (i % 2));
      const rad = S * (0.2 + 0.35 * Math.abs(Math.sin(t * TAU + i * 0.7)));
      ctx.fillStyle = c(i);
      ctx.globalAlpha = 0.55 + 0.35 * ((i % 3) / 3);
      ctx.beginPath();
      ctx.moveTo(S / 2, S / 2);
      ctx.arc(S / 2, S / 2, rad, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
  } else if (r.system === "waves") {
    const bands = Math.round(8 + r.density * 14);
    for (let i = 0; i < bands; i++) {
      const base = (i / bands) * S;
      ctx.fillStyle = c(i);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, base);
      for (let x = 0; x <= S; x += 6) {
        const amp = S * 0.05 * r.scale;
        const y =
          base + Math.sin((x / S) * TAU * (1 + (i % 3)) * r.scale + t * TAU * r.speed + i) * amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(S, base + S / bands);
      ctx.lineTo(0, base + S / bands);
      ctx.closePath();
      ctx.fill();
    }
  } else if (r.system === "strata") {
    const blocks = Math.round(10 + r.density * 16);
    for (let i = 0; i < blocks; i++) {
      const h = S / blocks;
      const y = i * h;
      const phase = Math.sin(t * TAU + i * 1.7);
      const shift = phase * S * 0.18 * (i % 2 ? 1 : -1) * r.scale;
      ctx.fillStyle = c(i);
      ctx.globalAlpha = 0.55 + 0.4 * ((i % 4) / 4);
      const w = S * (0.3 + 0.5 * Math.abs(phase));
      ctx.fillRect(((S / 2 - w / 2 + shift) % S) - S, y, w, h * 1.02);
      ctx.fillRect((S / 2 - w / 2 + shift) % S, y, w, h * 1.02);
    }
  } else {
    // cells — soft metaball-ish glow field
    const n = Math.round(5 + r.density * 8);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const wob = 0.18 + 0.16 * ((i % 3) / 3);
      const x = S / 2 + Math.cos(a + t * TAU * r.speed * 0.5) * S * wob * r.scale;
      const y = S / 2 + Math.sin(a * 1.6 + t * TAU * r.speed * 0.5) * S * wob * r.scale;
      const rad = S * (0.14 + 0.1 * Math.abs(Math.sin(t * TAU + i)));
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, c(i + 2));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.restore();
  ctx.globalAlpha = 1;

  // shared "collection" finish: grain + vignette inherited from the sources
  const grain = Math.min(0.5, r.grain * 0.6);
  if (grain > 0.02) {
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    const rnd = mulberry32(Math.floor(t * 1000) + 7);
    for (let i = 0; i < d.length; i += 4) {
      const v = (rnd() - 0.5) * 90 * grain;
      d[i] = Math.max(0, Math.min(255, d[i]! + v));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + v));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + v));
    }
    ctx.putImageData(img, 0, 0);
  }
  const vig = ctx.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S * 0.72);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, `rgba(0,0,0,${0.25 + (1 - p.brightness) * 0.35})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, S, S);
}

/* ---------- encoding ---------- */

export interface GenerateOptions {
  size: number;
  frames: number;
}

export async function generateGif(
  seed: number,
  profile: StyleProfile,
  opts: GenerateOptions,
): Promise<GifItem> {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const S = opts.size;
  const recipe = makeRecipe(seed, profile);

  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const gif = GIFEncoder();
  const delay = Math.round(1000 / Math.max(6, Math.min(24, profile.fps)));
  let palette: number[][] | null = null;

  for (let i = 0; i < opts.frames; i++) {
    paint(ctx, S, i / opts.frames, recipe, profile);
    const data = ctx.getImageData(0, 0, S, S).data;
    if (!palette) palette = quantize(data, 128, { format: "rgb565" });
    const index = applyPalette(data, palette, "rgb565");
    gif.writeFrame(index, S, S, { palette: i === 0 ? palette : undefined, delay });
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  const bytes = gif.bytes();
  const blob = new Blob([bytes as unknown as BlobPart], { type: "image/gif" });

  return {
    id: `${seed}`,
    seed,
    system: recipe.system,
    url: URL.createObjectURL(blob),
    bytes: blob.size,
  };
}
