import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { generateVariations } from "@/lib/gif/variation-engine";
import type { VariationResult } from "@/lib/gif/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GIF Variation Studio — Generate Visual Variations" },
      {
        name: "description",
        content:
          "Upload a GIF and generate multiple visual variations that preserve composition, movement, and style while introducing controlled differences.",
      },
      { property: "og:title", content: "GIF Variation Studio" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        property: "og:description",
        content: "Generate N variations of a single GIF with controlled similarity levels.",
      },
    ],
  }),
  component: GifVariationStudio,
});

type Stage = "idle" | "decoding" | "ready" | "generating";

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
  const [count, setCount] = useState(10);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<VariationResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const pickFile = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    const gifFile = Array.from(list).find(
      (f) => f.type === "image/gif" || f.name.toLowerCase().endsWith(".gif")
    );
    if (!gifFile) {
      setError("Please select a .gif file");
      return;
    }
    setError(null);
    setFile(gifFile);
    setOriginalInfo(null);
    setResults([]);
    setStage("idle");
  }, []);

  async function analyzeGif() {
    if (!file) return;
    
    setStage("decoding");
    setError(null);
    
    try {
      // Use gifuct-js for quick analysis
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
      
      // Create thumbnail from first frame
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
    
    // Revoke old URLs
    results.forEach((r) => URL.revokeObjectURL(r.url));
    setResults([]);
    
    try {
      const variationResults = await generateVariations(
        file,
        { similarity, count },
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

  async function downloadAll() {
    for (const result of results) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = `variation-${result.id}.gif`;
      a.click();
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  function getSimilarityDescription(value: number): string {
    if (value >= 95) return "Nearly identical (0-1px displacement)";
    if (value >= 85) return "Very similar (1-3px displacement)";
    if (value >= 70) return "Similar (3-8px displacement)";
    if (value >= 50) return "Moderate changes (8-15px displacement)";
    return "Significant changes (15-20px displacement)";
  }

  const busy = stage === "decoding" || stage === "generating";

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
          {/* Upload Zone */}
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
            <p className="text-sm text-muted-foreground">one file · processed entirely in your browser</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-2 rounded-md border border-border bg-surface-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              Choose file
            </button>
            {file && (
              <p className="label-mono mt-2">{file.name}</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Original Preview */}
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

          {/* Controls */}
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

          {/* Progress */}
          {stage === "generating" && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="label-mono">Generating variations</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Results Grid */}
          {results.length > 0 && (
            <div>
              <p className="label-mono mb-3">
                Generated Variations · {results.length}
              </p>
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
                      <span className="label-mono text-[0.6rem]">{result.id.split('-')[0]}</span>
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

        {/* Sidebar */}
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
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={similarity}
                    onChange={(e) => setSimilarity(Number(e.target.value))}
                    className="mt-2 w-full accent-primary"
                    disabled={stage === "generating"}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {getSimilarityDescription(similarity)}
                  </p>
                </label>
                
                <label className="block">
                  <div className="flex items-baseline justify-between">
                    <span className="label-mono">Variations · {count}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    className="mt-2 w-full accent-primary"
                    disabled={stage === "generating"}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Generate between 1 and 100 variations
                  </p>
                </label>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="label-mono mb-2">How It Works</h3>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="text-primary">1.</span>
                    <span>Perlin noise displacement field applied to all frames</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary">2.</span>
                    <span>Bilinear interpolation prevents pixelation artifacts</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary">3.</span>
                    <span>Motion mask reduces displacement in moving areas</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary">4.</span>
                    <span>Sinusoidal temporal modulation ensures smooth loops</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary">5.</span>
                    <span>HSL color transform adds variety while preserving look</span>
                  </li>
                </ul>
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
