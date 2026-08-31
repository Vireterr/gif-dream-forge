import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

import { analyzeGifs } from "@/lib/gif/analyze";
import { generateGif } from "@/lib/gif/generate";
import type { GifItem, StyleProfile, GenMode, GenParams, PostEffects } from "@/lib/gif/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GIF Collection Studio — Style Profile & Series Generator" },
      {
        name: "description",
        content:
          "Upload reference GIFs, extract their visual style profile, and generate a whole collection of new looping GIF-art that shares the same character.",
      },
    ],
  }),
  component: Studio,
});

type Stage = "idle" | "analyzing" | "ready" | "generating";

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-mono">{label}</span>
        <span className="font-mono text-xs text-foreground">{Math.round(value * 100)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-700"
          style={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================
// ПРЕСЕТЫ
// ============================================================

const PRESETS: Record<string, Partial<GenParams>> = {
  dreamy: {
    mode: "organic",
    color: {
      mode: "gradient",
      palette: [],
      gradientStops: [
        { pos: 0, color: "#f472b6" },
        { pos: 0.5, color: "#a78bfa" },
        { pos: 1, color: "#60a5fa" },
      ],
      saturation: 0.7,
      brightness: 0.8,
      contrast: 0.4,
      hueShift: 0,
      colorVariance: 0.3,
      preserveAccents: true,
    },
    effects: {
      blur: 0.3,
      pixelate: 0,
      grain: 0.2,
      vignette: 0.3,
      chromatic: 0.1,
      glitch: 0,
      bloom: 0.4,
      posterize: 0,
      noise: 0.2,
      sharpen: 0.3,
    },
    speed: 0.5,
    complexity: 0.6,
    symmetry: 0.3,
    density: 0.5,
    lineWeight: 0.4,
    flow: 0.7,
    repetition: 0.3,
    chaos: 0.2,
  },
  cyber: {
    mode: "glitch",
    color: {
      mode: "palette",
      palette: ["#ff00ff", "#00ffff", "#ff0080", "#00ff80", "#ffffff"],
      gradientStops: [],
      saturation: 0.9,
      brightness: 0.9,
      contrast: 0.8,
      hueShift: 0,
      colorVariance: 0.2,
      preserveAccents: true,
    },
    effects: {
      blur: 0,
      pixelate: 0.1,
      grain: 0.3,
      vignette: 0.4,
      chromatic: 0.5,
      glitch: 0.7,
      bloom: 0.2,
      posterize: 0.1,
      noise: 0.2,
      sharpen: 0.8,
    },
    speed: 0.8,
    complexity: 0.7,
    symmetry: 0.5,
    density: 0.6,
    lineWeight: 0.3,
    flow: 0.4,
    repetition: 0.5,
    chaos: 0.6,
  },
  retro: {
    mode: "pixel",
    color: {
      mode: "palette",
      palette: ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ffffff"],
      gradientStops: [],
      saturation: 0.6,
      brightness: 0.7,
      contrast: 0.7,
      hueShift: 0,
      colorVariance: 0.4,
      preserveAccents: true,
    },
    effects: {
      blur: 0,
      pixelate: 0.6,
      grain: 0.4,
      vignette: 0.2,
      chromatic: 0,
      glitch: 0,
      bloom: 0.1,
      posterize: 0.3,
      noise: 0.3,
      sharpen: 0.6,
    },
    speed: 0.4,
    complexity: 0.5,
    symmetry: 0.4,
    density: 0.7,
    lineWeight: 0.6,
    flow: 0.3,
    repetition: 0.4,
    chaos: 0.3,
  },
  organic: {
    mode: "organic",
    color: {
      mode: "gradient",
      palette: [],
      gradientStops: [
        { pos: 0, color: "#84cc16" },
        { pos: 0.5, color: "#22d3ee" },
        { pos: 1, color: "#fde047" },
      ],
      saturation: 0.6,
      brightness: 0.7,
      contrast: 0.5,
      hueShift: 0,
      colorVariance: 0.4,
      preserveAccents: true,
    },
    effects: {
      blur: 0.2,
      pixelate: 0,
      grain: 0.3,
      vignette: 0.2,
      chromatic: 0.05,
      glitch: 0,
      bloom: 0.3,
      posterize: 0,
      noise: 0.3,
      sharpen: 0.4,
    },
    speed: 0.3,
    complexity: 0.7,
    symmetry: 0.2,
    density: 0.6,
    lineWeight: 0.5,
    flow: 0.8,
    repetition: 0.2,
    chaos: 0.2,
  },
  abstract: {
    mode: "abstract",
    color: {
      mode: "palette",
      palette: ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff"],
      gradientStops: [],
      saturation: 0.8,
      brightness: 0.8,
      contrast: 0.9,
      hueShift: 0,
      colorVariance: 0.5,
      preserveAccents: true,
    },
    effects: {
      blur: 0.1,
      pixelate: 0,
      grain: 0.2,
      vignette: 0.1,
      chromatic: 0.2,
      glitch: 0.1,
      bloom: 0.2,
      posterize: 0,
      noise: 0.2,
      sharpen: 0.7,
    },
    speed: 0.6,
    complexity: 0.9,
    symmetry: 0.6,
    density: 0.5,
    lineWeight: 0.4,
    flow: 0.5,
    repetition: 0.4,
    chaos: 0.5,
  },
};

// ============================================================
// ОСНОВНОЙ КОМПОНЕНТ
// ============================================================

function Studio() {
  // Состояние
  const [files, setFiles] = useState<File[]>([]);
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [items, setItems] = useState<GifItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(50);
  const [size, setSize] = useState(256);
  const [genMode, setGenMode] = useState<GenMode>("abstract");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  // Параметры
  const [params, setParams] = useState<GenParams>({
    mode: "abstract",
    color: {
      mode: "palette",
      palette: ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff"],
      gradientStops: [],
      saturation: 0.8,
      brightness: 0.7,
      contrast: 0.7,
      hueShift: 0,
      colorVariance: 0.4,
      preserveAccents: true,
    },
    effects: {
      blur: 0,
      pixelate: 0,
      grain: 0.2,
      vignette: 0.1,
      chromatic: 0,
      glitch: 0,
      bloom: 0,
      posterize: 0,
      noise: 0.2,
      sharpen: 0.5,
    },
    speed: 0.5,
    complexity: 0.6,
    symmetry: 0.3,
    density: 0.5,
    lineWeight: 0.5,
    flow: 0.5,
    repetition: 0.3,
    chaos: 0.3,
  });

  const [postEffects, setPostEffects] = useState<PostEffects>({
    blur: 0,
    pixelate: 0,
    grain: 0.2,
    vignette: 0.1,
    chromatic: 0,
    glitch: 0,
    bloom: 0,
    posterize: 0,
    noise: 0.2,
    sharpen: 0.5,
  });

  const pick = useCallback((list: FileList | null) => {
    if (!list) return;
    const gifs = Array.from(list).filter((f) => f.type === "image/gif" || f.name.toLowerCase().endsWith(".gif"));
    if (!gifs.length) {
      setError("Add at least one .gif file");
      return;
    }
    setError(null);
    setFiles(gifs.slice(0, 8));
    setProfile(null);
    setStage("idle");
  }, []);

  async function analyze() {
    if (!files.length) return;
    setStage("analyzing");
    setError(null);
    try {
      const p = await analyzeGifs(files);
      setProfile(p);
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read these GIFs");
      setStage("idle");
    }
  }

  async function generate() {
    if (!profile) return;
    cancelRef.current = false;
    setStage("generating");
    setProgress(0);
    items.forEach((i) => URL.revokeObjectURL(i.url));
    setItems([]);
    const base = Math.floor(Math.random() * 1e9);
    const frames = Math.max(12, Math.min(24, profile.frameCount || 16));
    const made: GifItem[] = [];
    for (let i = 0; i < count; i++) {
      if (cancelRef.current) break;
      // Передаём параметры в generateGif
      const item = await generateGif(
        base + i * 2654435761,
        { ...profile, mode: genMode, params, effects: postEffects },
        { size, frames }
      );
      made.push(item);
      setItems([...made]);
      setProgress((i + 1) / count);
    }
    setStage("ready");
  }

  function applyPreset(name: string) {
    const preset = PRESETS[name];
    if (!preset) return;
    setSelectedPreset(name);
    setParams((prev) => ({
      ...prev,
      ...preset,
      color: { ...prev.color, ...(preset.color || {}) },
      effects: { ...prev.effects, ...(preset.effects || {}) },
    }));
    if (preset.mode) setGenMode(preset.mode);
  }

  async function downloadAll() {
    for (const item of items) {
      const a = document.createElement("a");
      a.href = item.url;
      a.download = `collection-${item.system}-${item.seed}.gif`;
      a.click();
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  const busy = stage === "analyzing" || stage === "generating";

  return (
    <main className="mx-auto max-w-7xl px-5 py-10 md:py-16">
      <header className="mb-10">
        <p className="label-mono">Generative series lab</p>
        <h1 className="mt-2 text-4xl font-bold md:text-5xl">GIF Collection Studio</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Drop in reference GIFs, extract their style profile — palette, motion energy, grain, contrast — then
          generate a whole series of new looping GIF-art that reads as one collection.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ============ ОСНОВНАЯ ОБЛАСТЬ ============ */}
        <section className="space-y-6">
          <div
            className="panel flex flex-col items-center justify-center gap-3 border-dashed p-10 text-center transition-colors hover:border-primary/60"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/gif"
              multiple
              className="hidden"
              onChange={(e) => pick(e.target.files)}
            />
            <p className="font-display text-lg">Drop reference GIFs here</p>
            <p className="text-sm text-muted-foreground">up to 8 files · they never leave your browser</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-2 rounded-md border border-border bg-surface-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              Choose files
            </button>
            {files.length > 0 && (
              <p className="label-mono mt-2">
                {files.length} file{files.length > 1 ? "s" : ""} selected
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled={!files.length || busy}
              onClick={analyze}
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
            >
              {stage === "analyzing" ? "Analyzing…" : "Analyze"}
            </button>
            <button
              disabled={!profile || busy}
              onClick={generate}
              className="glow rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity disabled:opacity-40 disabled:shadow-none"
            >
              Generate {count}
            </button>
            {stage === "generating" && (
              <button
                onClick={() => (cancelRef.current = true)}
                className="rounded-md border border-border px-4 py-2.5 text-sm"
              >
                Stop
              </button>
            )}
            {items.length > 0 && stage !== "generating" && (
              <button
                onClick={downloadAll}
                className="rounded-md border border-border px-4 py-2.5 text-sm transition-colors hover:bg-muted"
              >
                Download all
              </button>
            )}
          </div>

          {stage === "generating" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
          )}

          {items.length > 0 && (
            <div>
              <p className="label-mono mb-3">Collection · {items.length} pieces</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {items.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    download={`collection-${item.system}-${item.seed}.gif`}
                    className="group overflow-hidden rounded-lg border border-border bg-surface"
                  >
                    <img
                      src={item.url}
                      alt={`Generated ${item.system} GIF art, seed ${item.seed}`}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <span className="label-mono">{item.system}</span>
                      <span className="font-mono text-[0.65rem] text-muted-foreground">
                        {Math.round(item.bytes / 1024)}kb
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ============ ПРАВАЯ ПАНЕЛЬ ============ */}
        <aside className="panel h-fit space-y-5 p-5">
          <h2 className="font-display text-lg">Style Profile</h2>
          {!profile && <p className="text-sm text-muted-foreground">Analyze your references to see the profile.</p>}
          {profile && (
            <>
              <div className="flex flex-wrap gap-2">
                {profile.thumbs.map((t, i) => (
                  <img
                    key={i}
                    src={t}
                    alt={`Reference ${profile.names[i] ?? i + 1}`}
                    className="h-12 w-12 rounded-md border border-border object-cover"
                  />
                ))}
              </div>
              <div>
                <p className="label-mono mb-2">Palette</p>
                <div className="flex overflow-hidden rounded-md border border-border">
                  {profile.palette.map((c) => (
                    <div key={c} className="h-9 flex-1" style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <Meter label="Motion" value={profile.motion} />
                <Meter label="Grain" value={profile.grain} />
                <Meter label="Contrast" value={profile.contrast} />
                <Meter label="Saturation" value={profile.saturation} />
                <Meter label="Brightness" value={profile.brightness} />
              </div>
              <dl className="grid grid-cols-2 gap-2 font-mono text-xs text-muted-foreground">
                <div>fps · {profile.fps}</div>
                <div>frames · {profile.frameCount}</div>
                <div>sources · {profile.sources}</div>
                <div>aspect · {profile.aspect.toFixed(2)}</div>
              </dl>
            </>
          )}

          <div className="space-y-3 border-t border-border pt-4">
            <label className="block">
              <span className="label-mono">Collection size · {count}</span>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="mt-2 w-full accent-primary"
              />
            </label>
            <label className="block">
              <span className="label-mono">Resolution · {size}px</span>
              <input
                type="range"
                min={128}
                max={384}
                step={32}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="mt-2 w-full accent-primary"
              />
            </label>
          </div>

          {/* ============ РЕЖИМ ГЕНЕРАЦИИ ============ */}
          <div className="space-y-2 border-t border-border pt-4">
            <p className="label-mono">Generation mode</p>
            <div className="grid grid-cols-3 gap-1">
              {(["abstract", "geometric", "organic", "pixel", "glitch", "fluid"] as GenMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setGenMode(mode);
                    setSelectedPreset(null);
                  }}
                  className={`rounded border px-2 py-1 text-xs capitalize transition ${
                    genMode === mode ? "border-primary bg-primary/20" : "border-border hover:bg-muted"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* ============ ПРЕСЕТЫ ============ */}
          <div className="space-y-2 border-t border-border pt-4">
            <p className="label-mono">Quick presets</p>
            <div className="grid grid-cols-2 gap-1">
              {Object.keys(PRESETS).map((name) => (
                <button
                  key={name}
                  onClick={() => applyPreset(name)}
                  className={`rounded border px-2 py-1 text-xs capitalize transition ${
                    selectedPreset === name ? "border-accent bg-accent/20" : "border-border hover:bg-muted"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* ============ РАСШИРЕННЫЕ НАСТРОЙКИ ============ */}
          <div className="border-t border-border pt-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="label-mono w-full text-left hover:text-primary"
            >
              {showAdvanced ? "▼ Advanced settings" : "▶ Advanced settings"}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="label-mono">Speed · {params.speed.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={params.speed}
                    onChange={(e) => setParams((p) => ({ ...p, speed: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <label className="block">
                  <span className="label-mono">Complexity · {params.complexity.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={params.complexity}
                    onChange={(e) => setParams((p) => ({ ...p, complexity: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <label className="block">
                  <span className="label-mono">Symmetry · {params.symmetry.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={params.symmetry}
                    onChange={(e) => setParams((p) => ({ ...p, symmetry: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <label className="block">
                  <span className="label-mono">Density · {params.density.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={params.density}
                    onChange={(e) => setParams((p) => ({ ...p, density: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <label className="block">
                  <span className="label-mono">Line weight · {params.lineWeight.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={params.lineWeight}
                    onChange={(e) => setParams((p) => ({ ...p, lineWeight: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>

                <hr className="border-border" />

                <p className="label-mono">Post-effects</p>
                <label className="block">
                  <span className="label-mono">Blur · {postEffects.blur.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={postEffects.blur}
                    onChange={(e) => setPostEffects((p) => ({ ...p, blur: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <label className="block">
                  <span className="label-mono">Pixelate · {postEffects.pixelate.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={postEffects.pixelate}
                    onChange={(e) => setPostEffects((p) => ({ ...p, pixelate: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <label className="block">
                  <span className="label-mono">Grain · {postEffects.grain.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={postEffects.grain}
                    onChange={(e) => setPostEffects((p) => ({ ...p, grain: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <label className="block">
                  <span className="label-mono">Vignette · {postEffects.vignette.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={postEffects.vignette}
                    onChange={(e) => setPostEffects((p) => ({ ...p, vignette: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <label className="block">
                  <span className="label-mono">Chromatic · {postEffects.chromatic.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={postEffects.chromatic}
                    onChange={(e) => setPostEffects((p) => ({ ...p, chromatic: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <label className="block">
                  <span className="label-mono">Glitch · {postEffects.glitch.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={postEffects.glitch}
                    onChange={(e) => setPostEffects((p) => ({ ...p, glitch: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <label className="block">
                  <span className="label-mono">Bloom · {postEffects.bloom.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={postEffects.bloom}
                    onChange={(e) => setPostEffects((p) => ({ ...p, bloom: parseFloat(e.target.value) }))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
