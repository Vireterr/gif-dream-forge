import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import type { VariationResult, TargetColor, ReassemblyConfig } from "../lib/gif/engine";
import { generateVariations } from "../lib/gif/engine";

type Stage = "idle" | "decoding" | "ready" | "generating";

const PRESET_COLORS: Array<{ name: string; r: number; g: number; b: number }> = [
  { name: "Красный", r: 220, g: 30, b: 30 },
  { name: "Малиновый", r: 220, g: 20, b: 60 },
  { name: "Синий", r: 30, g: 60, b: 220 },
  { name: "Жёлтый", r: 240, g: 220, b: 30 },
  { name: "Зелёный", r: 30, g: 180, b: 60 },
  { name: "Фиолетовый", r: 140, g: 40, b: 200 },
  { name: "Оранжевый", r: 240, g: 130, b: 30 },
  { name: "Белый", r: 240, g: 240, b: 240 },
  { name: "Чёрный", r: 20, g: 20, b: 20 },
];

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

let colorIdCounter = 0;
function makeColor(r: number, g: number, b: number, tolerance = 25, enabled = true): TargetColor {
  return { id: `c${++colorIdCounter}`, r, g, b, tolerance, enabled };
}

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
    frames: number; width: number; height: number;
    duration: number; fps: number; thumb?: string;
  } | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [similarity, setSimilarity] = useState(50);
  const [geometry, setGeometry] = useState(80);
  const [color, setColor] = useState(80);
  const [flow, setFlow] = useState(70);
  const [blockSize, setBlockSize] = useState(50);
  const [silhouette, setSilhouette] = useState(50);
  const [colorSegmentation, setColorSegmentation] = useState(80);
  const [targetColorsMode, setTargetColorsMode] = useState(true);
  const [targetColors, setTargetColors] = useState<TargetColor[]>([
    makeColor(220, 20, 60, 40, true),
  ]);
  const [mirror, setMirror] = useState(false);
  const [count, setCount] = useState(10);

  const [reassemblyConfig, setReassemblyConfig] = useState<ReassemblyConfig>({
    blocks: { enabled: true, strength: 70, size: 30 },
    stripes: { enabled: false, strength: 70, size: 15 },
    geometric: { enabled: false, strength: 70, size: 20 },
    organic: { enabled: false, strength: 70, size: 30 },
    mask: { enabled: true, strength: 50, smoothness: 50 },
    blendSmoothness: 50,
  });

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
      if (!frames.length) throw new Error("No frames found in GIF");

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
            new ImageData(
              new Uint8ClampedArray(frames[0].patch),
              frames[0].dims.width,
              frames[0].dims.height
            ),
            0, 0
          );
          ctx.drawImage(patchCanvas, 0, 0, canvas.width, canvas.height);
        }
      }

      setOriginalInfo({
        frames: frames.length, width, height,
        duration: totalDelay, fps,
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
          blockSize,
          silhouette,
          colorSegmentation,
          targetColorsMode,
          targetColors,
          reassemblyConfig,
        },
        (current, total) => setProgress(current / total),
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

  function addPresetColor(preset: typeof PRESET_COLORS[number]) {
    setTargetColors((prev) => [...prev, makeColor(preset.r, preset.g, preset.b, 40, true)]);
  }

  function addCustomColor() {
    setTargetColors((prev) => [...prev, makeColor(128, 128, 128, 40, true)]);
  }

  function updateColor(id: string, patch: Partial<TargetColor>) {
    setTargetColors((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }

  function removeColor(id: string) {
    setTargetColors((prev) => prev.filter((c) => c.id !== id));
  }

  function updateMode(mode: 'blocks' | 'stripes' | 'geometric' | 'organic', field: 'enabled' | 'strength' | 'size', value: boolean | number) {
    setReassemblyConfig((prev) => ({
      ...prev,
      [mode]: { ...prev[mode], [field]: value },
    }));
  }

  function updateMask(field: 'enabled' | 'strength' | 'smoothness', value: boolean | number) {
    setReassemblyConfig((prev) => ({
      ...prev,
      mask: { ...prev.mask, [field]: value },
    }));
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-10 md:py-16">
      <header className="mb-10">
        <p className="label-mono">Visual variation generator</p>
        <h1 className="mt-2 text-4xl font-bold md:text-5xl">GIF Variation Studio</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Upload a single GIF to generate multiple visual variations.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
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
            <p className="text-sm text-muted-foreground">
              one file · processed entirely in your browser
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-2 rounded-md border border-border bg-surface-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              Choose file
            </button>
            {file && <p className="label-mono mt-2">{file.name}</p>}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {originalInfo && (
            <div className="panel p-5">
              <p className="label-mono mb-3">Original GIF</p>
              <div className="flex items-start gap-4">
                {originalInfo.thumb && (
                  <img
                    src={originalInfo.thumb}
                    alt="Original GIF preview"
                    className="rounded-md border border-border"
                    style={{ width: originalInfo.width > 320 ? 320 : originalInfo.width }}
                  />
                )}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
                  <div>Size</div>
                  <div className="text-foreground">{originalInfo.width}×{originalInfo.height}px</div>
                  <div>Frames</div>
                  <div className="text-foreground">{originalInfo.frames}</div>
                  <div>Duration</div>
                  <div className="text-foreground">{(originalInfo.duration / 1000).toFixed(2)}s</div>
                  <div>FPS</div>
                  <div className="text-foreground">{originalInfo.fps}</div>
                </dl>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled={!file || busy}
              onClick={analyzeGif}
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
            >
              {stage === "decoding" ? "Analyzing…" : "Analyze GIF"}
            </button>
            <button
              disabled={!originalInfo || busy}
              onClick={generate}
              className="glow rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity disabled:opacity-40 disabled:shadow-none"
            >
              Generate {count} Variations
            </button>
            {stage === "generating" && (
              <button
                onClick={() => (cancelRef.current = true)}
                className="rounded-md border border-border px-4 py-2.5 text-sm"
              >
                Stop
              </button>
            )}
            {results.length > 0 && stage !== "generating" && (
              <button
                onClick={downloadAll}
                className="rounded-md border border-border px-4 py-2.5 text-sm transition-colors hover:bg-muted"
              >
                Download All
              </button>
            )}
          </div>

          {stage === "generating" && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="label-mono">Generating variations</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-accent transition-all" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div>
              <p className="label-mono mb-3">Generated Variations · {results.length}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {results.map((result) => (
                  <a
                    key={result.id}
                    href={result.url}
                    download={`variation-${result.id}.gif`}
                    className="group overflow-hidden rounded-lg border border-border bg-surface"
                  >
                    <img
                      src={result.url}
                      alt={`Variation ${result.id}`}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <span className="label-mono text-[0.6rem]">{result.id.split("-")[0]}</span>
                      <span className="font-mono text-[0.6rem] text-muted-foreground">
                        {Math.round(result.bytes / 1024)}kb
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="panel h-fit space-y-5 p-5">
          <h2 className="font-display text-lg">Settings</h2>

          {!originalInfo && (
            <p className="text-sm text-muted-foreground">
              Analyze a GIF to configure generation settings.
            </p>
          )}

          {originalInfo && (
            <>
              <div className="space-y-3">
                <label className="block">
                  <div className="flex items-baseline justify-between">
                    <span className="label-mono">Similarity · {similarity}%</span>
                  </div>
                  <input
                    type="range" min={0} max={100} step={5}
                    value={similarity}
                    onChange={(e) => setSimilarity(Number(e.target.value))}
                    className="mt-2 w-full accent-primary"
                    disabled={stage === "generating"}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {getSimilarityDescription(similarity)}
                  </p>
                </label>

                {([
                  ["Geometry / shape", geometry, setGeometry, "Random rotation, scale, skew, swirl"],
                  ["Color shift", color, setColor, "Hue, saturation, lightness and contrast drift"],
                  ["Organic flow", flow, setFlow, "Perlin noise displacement"],
                ] as const).map(([label, value, setter, hint]) => (
                  <label key={label} className="block">
                    <span className="label-mono">{label} · {value}%</span>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={value}
                      onChange={(e) => setter(Number(e.target.value))}
                      className="mt-2 w-full accent-accent"
                      disabled={stage === "generating"}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
                  </label>
                ))}

                <div className="border-t border-border pt-3">
                  <h3 className="label-mono mb-3 text-sm font-semibold">🎨 Коллаж по цвету</h3>

                  <label className="block">
                    <span className="label-mono">Сила перемещения · {colorSegmentation}%</span>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={colorSegmentation}
                      onChange={(e) => setColorSegmentation(Number(e.target.value))}
                      className="mt-2 w-full accent-accent"
                      disabled={stage === "generating"}
                    />
                  </label>

                  <label className="flex items-center justify-between mt-3">
                    <span className="label-mono text-sm">Выбранные цвета</span>
                    <input
                      type="checkbox"
                      checked={targetColorsMode}
                      onChange={(e) => setTargetColorsMode(e.target.checked)}
                      disabled={stage === "generating"}
                      className="accent-primary"
                    />
                  </label>

                  {targetColorsMode && (
                    <div className="mt-3 space-y-2">
                      <div>
                        <p className="label-mono text-xs mb-2">Быстрый выбор:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {PRESET_COLORS.map((preset) => (
                            <button
                              key={preset.name}
                              onClick={() => addPresetColor(preset)}
                              disabled={stage === "generating"}
                              title={`Добавить: ${preset.name}`}
                              className="h-7 w-7 rounded-md border border-border transition-transform hover:scale-110 disabled:opacity-40"
                              style={{ backgroundColor: rgbToHex(preset.r, preset.g, preset.b) }}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="label-mono text-xs">Выбрано: {targetColors.length}</p>
                          <button
                            onClick={addCustomColor}
                            disabled={stage === "generating"}
                            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
                          >
                            + Добавить свой
                          </button>
                        </div>

                        {targetColors.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-2"
                          >
                            <input
                              type="color"
                              value={rgbToHex(c.r, c.g, c.b)}
                              onChange={(e) => {
                                const rgb = hexToRgb(e.target.value);
                                updateColor(c.id, rgb);
                              }}
                              disabled={stage === "generating"}
                              className="h-8 w-8 cursor-pointer rounded border border-border"
                            />
                            <input
                              type="checkbox"
                              checked={c.enabled}
                              onChange={(e) => updateColor(c.id, { enabled: e.target.checked })}
                              disabled={stage === "generating"}
                              className="accent-primary"
                            />
                            <div className="flex-1">
                              <input
                                type="range"
                                min={5}
                                max={80}
                                step={5}
                                value={c.tolerance}
                                onChange={(e) => updateColor(c.id, { tolerance: Number(e.target.value) })}
                                className="w-full accent-accent"
                                disabled={stage === "generating"}
                              />
                              <p className="text-[0.65rem] text-muted-foreground">
                                Допуск: {c.tolerance}%
                              </p>
                            </div>
                            <button
                              onClick={() => removeColor(c.id)}
                              disabled={stage === "generating"}
                              className="rounded px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-border pt-3">
                  <h3 className="label-mono mb-3 text-sm font-semibold">🧱 Рандом-редактор</h3>

                  {/* BLOCKS */}
                  <div className="mb-3 rounded-md border border-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={reassemblyConfig.blocks.enabled}
                          onChange={(e) => updateMode('blocks', 'enabled', e.target.checked)}
                          disabled={stage === "generating"}
                          className="accent-accent"
                        />
                        <span className="label-mono text-sm">🔲 Блоки</span>
                      </label>
                      <span className="font-mono text-xs text-muted-foreground">
                        {reassemblyConfig.blocks.strength}%
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={reassemblyConfig.blocks.strength}
                      onChange={(e) => updateMode('blocks', 'strength', Number(e.target.value))}
                      className="w-full accent-accent"
                      disabled={stage === "generating" || !reassemblyConfig.blocks.enabled}
                    />
                    <div className="mt-2">
                      <div className="flex items-baseline justify-between">
                        <span className="label-mono text-xs">Размер блока · {reassemblyConfig.blocks.size}%</span>
                      </div>
                      <input
                        type="range" min={5} max={80} step={1}
                        value={reassemblyConfig.blocks.size}
                        onChange={(e) => updateMode('blocks', 'size', Number(e.target.value))}
                        className="mt-1 w-full accent-primary"
                        disabled={stage === "generating" || !reassemblyConfig.blocks.enabled}
                      />
                    </div>
                  </div>

                  {/* STRIPES */}
                  <div className="mb-3 rounded-md border border-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={reassemblyConfig.stripes.enabled}
                          onChange={(e) => updateMode('stripes', 'enabled', e.target.checked)}
                          disabled={stage === "generating"}
                          className="accent-accent"
                        />
                        <span className="label-mono text-sm"> Полосы</span>
                      </label>
                      <span className="font-mono text-xs text-muted-foreground">
                        {reassemblyConfig.stripes.strength}%
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={reassemblyConfig.stripes.strength}
                      onChange={(e) => updateMode('stripes', 'strength', Number(e.target.value))}
                      className="w-full accent-accent"
                      disabled={stage === "generating" || !reassemblyConfig.stripes.enabled}
                    />
                    <div className="mt-2">
                      <div className="flex items-baseline justify-between">
                        <span className="label-mono text-xs">Ширина полосы · {reassemblyConfig.stripes.size}%</span>
                      </div>
                      <input
                        type="range" min={2} max={50} step={1}
                        value={reassemblyConfig.stripes.size}
                        onChange={(e) => updateMode('stripes', 'size', Number(e.target.value))}
                        className="mt-1 w-full accent-primary"
                        disabled={stage === "generating" || !reassemblyConfig.stripes.enabled}
                      />
                    </div>
                  </div>

                  {/* GEOMETRIC */}
                  <div className="mb-3 rounded-md border border-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={reassemblyConfig.geometric.enabled}
                          onChange={(e) => updateMode('geometric', 'enabled', e.target.checked)}
                          disabled={stage === "generating"}
                          className="accent-accent"
                        />
                        <span className="label-mono text-sm">🔷 Геометрия</span>
                      </label>
                      <span className="font-mono text-xs text-muted-foreground">
                        {reassemblyConfig.geometric.strength}%
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={reassemblyConfig.geometric.strength}
                      onChange={(e) => updateMode('geometric', 'strength', Number(e.target.value))}
                      className="w-full accent-accent"
                      disabled={stage === "generating" || !reassemblyConfig.geometric.enabled}
                    />
                    <div className="mt-2">
                      <div className="flex items-baseline justify-between">
                        <span className="label-mono text-xs">Размер фигур · {reassemblyConfig.geometric.size}%</span>
                      </div>
                      <input
                        type="range" min={3} max={40} step={1}
                        value={reassemblyConfig.geometric.size}
                        onChange={(e) => updateMode('geometric', 'size', Number(e.target.value))}
                        className="mt-1 w-full accent-primary"
                        disabled={stage === "generating" || !reassemblyConfig.geometric.enabled}
                      />
                    </div>
                  </div>

                  {/* ORGANIC */}
                  <div className="mb-3 rounded-md border border-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={reassemblyConfig.organic.enabled}
                          onChange={(e) => updateMode('organic', 'enabled', e.target.checked)}
                          disabled={stage === "generating"}
                          className="accent-accent"
                        />
                        <span className="label-mono text-sm">🫧 Произвольные</span>
                      </label>
                      <span className="font-mono text-xs text-muted-foreground">
                        {reassemblyConfig.organic.strength}%
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={reassemblyConfig.organic.strength}
                      onChange={(e) => updateMode('organic', 'strength', Number(e.target.value))}
                      className="w-full accent-accent"
                      disabled={stage === "generating" || !reassemblyConfig.organic.enabled}
                    />
                    <div className="mt-2">
                      <div className="flex items-baseline justify-between">
                        <span className="label-mono text-xs">Размер капель · {reassemblyConfig.organic.size}%</span>
                      </div>
                      <input
                        type="range" min={5} max={80} step={1}
                        value={reassemblyConfig.organic.size}
                        onChange={(e) => updateMode('organic', 'size', Number(e.target.value))}
                        className="mt-1 w-full accent-primary"
                        disabled={stage === "generating" || !reassemblyConfig.organic.enabled}
                      />
                    </div>
                  </div>

                  {/* Blend smoothness */}
                  <label className="block mt-3">
                    <span className="label-mono">Плавность смешения · {reassemblyConfig.blendSmoothness}%</span>
                    <input
                      type="range" min={1} max={100} step={1}
                      value={reassemblyConfig.blendSmoothness}
                      onChange={(e) => setReassemblyConfig((prev) => ({ ...prev, blendSmoothness: Number(e.target.value) }))}
                      className="mt-2 w-full accent-primary"
                      disabled={stage === "generating"}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Simplex Noise — как плавно режимы перетекают друг в друга
                    </p>
                  </label>

                  {/* МАСКА */}
                  <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3">
                    <h4 className="label-mono mb-2 text-sm font-semibold">🎭 Маска (зоны режимов)</h4>
                    <label className="flex items-center justify-between mb-2">
                      <span className="label-mono text-sm">Включить маску</span>
                      <input
                        type="checkbox"
                        checked={reassemblyConfig.mask.enabled}
                        onChange={(e) => updateMask('enabled', e.target.checked)}
                        disabled={stage === "generating"}
                        className="accent-primary"
                      />
                    </label>
                    <label className="block mb-2">
                      <span className="label-mono text-xs">Сила маски · {reassemblyConfig.mask.strength}%</span>
                      <input
                        type="range" min={0} max={100} step={5}
                        value={reassemblyConfig.mask.strength}
                        onChange={(e) => updateMask('strength', Number(e.target.value))}
                        className="mt-1 w-full accent-primary"
                        disabled={stage === "generating" || !reassemblyConfig.mask.enabled}
                      />
                    </label>
                    <label className="block">
                      <span className="label-mono text-xs">Плавность маски · {reassemblyConfig.mask.smoothness}%</span>
                      <input
                        type="range" min={1} max={100} step={1}
                        value={reassemblyConfig.mask.smoothness}
                        onChange={(e) => updateMask('smoothness', Number(e.target.value))}
                        className="mt-1 w-full accent-primary"
                        disabled={stage === "generating" || !reassemblyConfig.mask.enabled}
                      />
                    </label>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={mirror}
                      onChange={(e) => setMirror(e.target.checked)}
                      disabled={stage === "generating"}
                      className="accent-primary"
                    />
                    <span>Allow mirrored variations</span>
                  </label>

                  <label className="block">
                    <div className="flex items-baseline justify-between">
                      <span className="label-mono">Variations · {count}</span>
                    </div>
                    <input
                      type="range" min={1} max={100} step={1}
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                      className="mt-2 w-full accent-primary"
                      disabled={stage === "generating"}
                    />
                  </label>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: GifVariationStudio,
});
