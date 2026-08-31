import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import type { VariationResult } from "../lib/gif/types";
import type { ReassemblyMode } from "../lib/gif/reassemble";
import { generateVariations } from "../lib/gif/variation-engine";

type Stage = "idle" | "decoding" | "ready" | "generating";

function getSimilarityDescription(similarity: number): string {
  if (similarity >= 90) return "Minimal changes, almost identical";
  if (similarity >= 70) return "Subtle variations, same character";
  if (similarity >= 50) return "Noticeable differences, same style";
  if (similarity >= 30) return "Creative reinterpretation";
  return "Radical transformation";
}

function GifVariationStudio() {
  const [file, setFile] = useState<File | null>(null);
  const [originalInfo, setOriginalInfo] = useState<{
    frames: number;
    width: number;
    height: number;
    duration: number;
    fps: number;
    thumb?: string;
  } | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [similarity, setSimilarity] = useState(75);
  const [geometry, setGeometry] = useState(65);
  const [color, setColor] = useState(55);
  const [flow, setFlow] = useState(60);
  const [reassembly, setReassembly] = useState(50);
  const [blockSize, setBlockSize] = useState(4);
  const [silhouette, setSilhouette] = useState(70);
  const [reassemblyMode, setReassemblyMode] = useState<ReassemblyMode>('scatter');
  const [mirror, setMirror] = useState(false);
  const [count, setCount] = useState(10);

  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<VariationResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const busy = stage === "decoding" || stage === "generating";

  function pickFile(files: FileList | null) {
    if (!files || !files[0]) return;
    const f = files[0];
    if (f.type !== "image/gif") {
      setError("Please select a GIF file");
      return;
    }
    setFile(f);
    setOriginalInfo(null);
    setResults([]);
    setError(null);
    setStage("idle");
  }

  async function analyzeGif() {
    if (!file) return;

    setStage("decoding");
    setError(null);

    try {
      const { parseGIF, decompressFrames } = await import("gifuct-js");
      const buffer = await file.arrayBuffer();
      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);

      if (!frames.length) {
        throw new Error("No frames found in GIF");
      }

      const width = gif.lsd.width;
      const height = gif.lsd.height;
      const totalDelay = frames.reduce((s, f) => s + (f.delay || 100), 0);
      const fps = Math.max(4, Math.min(30, 1000 / (totalDelay / frames.length)));

      const canvas = document.createElement("canvas");
      canvas.width = Math.min(320, width);
      canvas.height = Math.min(240, height);
      const ctx = canvas.getContext("2d");

      if (ctx && frames[0]) {
        const patchCanvas = document.createElement("canvas");
        patchCanvas.width = frames[0].dims.width;
        patchCanvas.height = frames[0].dims.height;
        const patchCtx = patchCanvas.getContext("2d");

        if (patchCtx) {
          patchCtx.putImageData(
            new ImageData(new Uint8ClampedArray(frames[0].patch), frames[0].dims.width, frames[0].dims.height),
            0,
            0
          );
          ctx.drawImage(patchCanvas, 0, 0, canvas.width, canvas.height);
        }
      }

      setOriginalInfo({
        frames: frames.length,
        width,
        height,
        duration: totalDelay,
        fps,
        thumb: canvas.toDataURL("image/png"),
      });

      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this GIF");
      setStage("idle");
    }
  }

  async function generate() {
    if (!file || !originalInfo) return;

    cancelRef.current = false;
    setStage("generating");
    setProgress(0);

    results.forEach((r) => URL.revokeObjectURL(r.url));
    setResults([]);

    try {
      const variationResults = await generateVariations(
        file,
        {
          similarity,
          count,
          geometry,
          color,
          flow,
          mirror,
          reassembly,
          blockSize,
          silhouette,
          reassemblyMode,
        },
        (current, total) => {
          setProgress(current / total);
        },
        () => cancelRef.current
      );

      setResults(variationResults);
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setStage("ready");
    }
  }

  function downloadAll() {
    results.forEach((result) => {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = `variation-${result.id}.gif`;
      a.click();
    });
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-10 md:py-16">
      <header className="mb-10">
        <p className="label-mono">Visual variation generator</p>
        <h1 className="mt-2 text-4xl font-bold md:text-5xl">GIF Variation Studio</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Upload a single GIF to generate multiple visual variations. Each variation preserves the original's
          composition, movement timing, and character while introducing controlled differences through pixel
          displacement and color transformation.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-6">
          <div
            className="panel flex flex-col items-center justify-center gap-3 border-dashed p-10 text-center transition-colors hover:border-primary/60"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(e.dataTransfer.files);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/gif"
              className="hidden"
              onChange={(e) => pickFile(e.target.files)}
            />
            <p className="font-display text-lg">Drop a GIF here</p>
            <p className="text-sm text-muted-foreground">one file · processed entirely in your browser
