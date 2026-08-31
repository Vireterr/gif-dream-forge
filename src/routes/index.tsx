import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

import { analyzeGifs } from "@/lib/gif/analyze";
import { generateGif } from "@/lib/gif/generate";
import type { GifItem, StyleProfile } from "@/lib/gif/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GIF Collection Studio — Style Profile & Series Generator" },
      {
        name: "description",
        content:
          "Upload reference GIFs, extract their visual style profile, and generate a whole collection of new looping GIF-art that shares the same character.",
      },
      { property: "og:title", content: "GIF Collection Studio" },
      {
        property: "og:description",
        content: "Analyze reference GIFs and generate a coherent series of new GIF-art in one click.",
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

function Studio() {
  const [files, setFiles] = useState<File[]>([]);
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [items, setItems] = useState<GifItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(50);
  const [size, setSize] = useState(256);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

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
      const item = await generateGif(base + i * 2654435761, profile, { size, frames });
      made.push(item);
      setItems([...made]);
      setProgress((i + 1) / count);
    }
    setStage("ready");
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
    <main className="mx-auto max-w-6xl px-5 py-10 md:py-16">
      <header className="mb-10">
        <p className="label-mono">Generative series lab</p>
        <h1 className="mt-2 text-4xl font-bold md:text-5xl">GIF Collection Studio</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Drop in reference GIFs, extract their style profile — palette, motion energy, grain, contrast — then
          generate a whole series of new looping GIF-art that reads as one collection.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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
              <p className="label-mono mb-3">
                Collection · {items.length} pieces
              </p>
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
        </aside>
      </div>
    </main>
  );
}
