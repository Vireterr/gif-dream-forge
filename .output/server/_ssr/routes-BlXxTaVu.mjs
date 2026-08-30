import { r as __toESM } from "../_runtime.mjs";
import { n as require_jsx_runtime, r as require_react } from "../_libs/react+tanstack__react-query.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-BlXxTaVu.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var SAMPLE = 64;
function toHex([r, g, b]) {
	return "#" + [
		r,
		g,
		b
	].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function luma([r, g, b]) {
	return (.2126 * r + .7152 * g + .0722 * b) / 255;
}
function dist(a, b) {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
async function analyzeOne(file) {
	const { parseGIF, decompressFrames } = await import("../_libs/gifuct-js+[...].mjs").then((n) => /* @__PURE__ */ __toESM(n.t()));
	const gif = parseGIF(await file.arrayBuffer());
	const frames = decompressFrames(gif, true);
	if (!frames.length) throw new Error(`${file.name}: no frames`);
	const w = gif.lsd.width;
	const h = gif.lsd.height;
	const full = document.createElement("canvas");
	full.width = w;
	full.height = h;
	const fctx = full.getContext("2d", { willReadFrequently: true });
	const patch = document.createElement("canvas");
	const pctx = patch.getContext("2d");
	const small = document.createElement("canvas");
	small.width = SAMPLE;
	small.height = SAMPLE;
	const sctx = small.getContext("2d", { willReadFrequently: true });
	const pixels = [];
	const lumas = [];
	let motionAcc = 0;
	let grainAcc = 0;
	let satAcc = 0;
	let prev = null;
	let thumb = "";
	const step = Math.max(1, Math.floor(frames.length / 12));
	let counted = 0;
	for (let i = 0; i < frames.length; i += step) {
		const f = frames[i];
		patch.width = f.dims.width;
		patch.height = f.dims.height;
		pctx.putImageData(new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height), 0, 0);
		if (f.disposalType === 2) fctx.clearRect(f.dims.left, f.dims.top, f.dims.width, f.dims.height);
		fctx.drawImage(patch, f.dims.left, f.dims.top);
		sctx.clearRect(0, 0, SAMPLE, SAMPLE);
		sctx.drawImage(full, 0, 0, SAMPLE, SAMPLE);
		const data = sctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
		if (!thumb) thumb = full.toDataURL("image/png");
		let diff = 0;
		let edge = 0;
		for (let y = 0; y < SAMPLE; y++) for (let x = 0; x < SAMPLE; x++) {
			const o = (y * SAMPLE + x) * 4;
			if (data[o + 3] < 24) continue;
			const px = [
				data[o],
				data[o + 1],
				data[o + 2]
			];
			if ((x + y) % 3 === 0) pixels.push(px);
			const l = luma(px);
			lumas.push(l);
			const mx = Math.max(px[0], px[1], px[2]);
			const mn = Math.min(px[0], px[1], px[2]);
			satAcc += mx === 0 ? 0 : (mx - mn) / mx;
			if (x + 1 < SAMPLE) {
				const n = (y * SAMPLE + x + 1) * 4;
				edge += Math.abs(data[o] - data[n]) + Math.abs(data[o + 1] - data[n + 1]) + Math.abs(data[o + 2] - data[n + 2]);
			}
			if (prev) diff += Math.abs(data[o] - prev[o]) + Math.abs(data[o + 1] - prev[o + 1]) + Math.abs(data[o + 2] - prev[o + 2]);
		}
		const n = 4096;
		if (prev) motionAcc += diff / (n * 765);
		grainAcc += edge / (n * 765);
		prev = new Uint8ClampedArray(data);
		counted++;
	}
	const totalDelay = frames.reduce((s, f) => s + (f.delay || 100), 0);
	const fps = Math.max(4, Math.min(30, 1e3 / (totalDelay / frames.length)));
	const meanL = lumas.reduce((s, v) => s + v, 0) / Math.max(1, lumas.length);
	const variance = lumas.reduce((s, v) => s + (v - meanL) ** 2, 0) / Math.max(1, lumas.length);
	return {
		pixels,
		motion: Math.min(1, motionAcc / Math.max(1, counted - 1) * 6),
		grain: Math.min(1, grainAcc / Math.max(1, counted) * 8),
		contrast: Math.min(1, Math.sqrt(variance) * 3.2),
		saturation: Math.min(1, satAcc / Math.max(1, lumas.length)),
		brightness: meanL,
		fps,
		frameCount: frames.length,
		aspect: w / h,
		thumb
	};
}
function buildPalette(pixels, count = 6) {
	const buckets = /* @__PURE__ */ new Map();
	for (const p of pixels) {
		const key = p[0] >> 4 << 8 | p[1] >> 4 << 4 | p[2] >> 4;
		const b = buckets.get(key);
		if (b) {
			b.sum[0] += p[0];
			b.sum[1] += p[1];
			b.sum[2] += p[2];
			b.n++;
		} else buckets.set(key, {
			sum: [
				p[0],
				p[1],
				p[2]
			],
			n: 1
		});
	}
	const ranked = [...buckets.values()].map((b) => ({
		c: [
			b.sum[0] / b.n,
			b.sum[1] / b.n,
			b.sum[2] / b.n
		],
		n: b.n
	})).sort((a, b) => b.n - a.n);
	const picked = [];
	for (const r of ranked) {
		if (picked.every((p) => dist(p, r.c) > 46)) picked.push(r.c);
		if (picked.length >= count) break;
	}
	let i = 0;
	while (picked.length < count && ranked.length) {
		picked.push(ranked[i % ranked.length].c);
		i++;
	}
	const background = toHex(ranked[0]?.c ?? [
		12,
		12,
		14
	]);
	picked.sort((a, b) => luma(a) - luma(b));
	return {
		palette: picked.map(toHex),
		background
	};
}
async function analyzeGifs(files) {
	const stats = [];
	for (const f of files) stats.push(await analyzeOne(f));
	const avg = (pick) => stats.reduce((s, v) => s + pick(v), 0) / stats.length;
	const { palette, background } = buildPalette(stats.flatMap((s) => s.pixels));
	return {
		palette,
		background,
		motion: avg((s) => s.motion),
		grain: avg((s) => s.grain),
		contrast: avg((s) => s.contrast),
		saturation: avg((s) => s.saturation),
		brightness: avg((s) => s.brightness),
		fps: Math.round(avg((s) => s.fps)),
		frameCount: Math.round(avg((s) => s.frameCount)),
		aspect: avg((s) => s.aspect),
		sources: stats.length,
		thumbs: stats.map((s) => s.thumb),
		names: files.map((f) => f.name)
	};
}
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = a + 1831565813 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function valueNoise(rand) {
	const grid = 8;
	const table = [];
	for (let i = 0; i < 64; i++) table.push(rand());
	const at = (x, y) => table[(y % grid + grid) % grid * grid + (x % grid + grid) % grid];
	const smooth = (t) => t * t * (3 - 2 * t);
	return (x, y) => {
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
var SYSTEMS = [
	"flow",
	"orbit",
	"shards",
	"waves",
	"strata",
	"cells"
];
function hexToRgb(hex) {
	const v = parseInt(hex.slice(1), 16);
	return [
		v >> 16 & 255,
		v >> 8 & 255,
		v & 255
	];
}
function mix(a, b, t) {
	const A = hexToRgb(a);
	const B = hexToRgb(b);
	return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}
var lerp = (a, b, t) => a + (b - a) * t;
/** Which visual systems best match the source character, used at high fidelity. */
function systemsFor(p) {
	if (p.motion > .55) return [
		"flow",
		"cells",
		"waves"
	];
	if (p.contrast > .6) return [
		"shards",
		"strata",
		"orbit"
	];
	return [
		"waves",
		"flow",
		"orbit",
		"cells"
	];
}
function makeRecipe(seed, p, fidelity = .5) {
	const f = Math.max(0, Math.min(1, fidelity));
	const rand = mulberry32(seed);
	const pool = f > .5 ? systemsFor(p) : SYSTEMS.slice();
	const system = pool[Math.floor(rand() * pool.length)];
	const maxOffset = Math.max(1, Math.round(p.palette.length * (1 - f)));
	const offset = Math.floor(rand() * maxOffset);
	const colors = p.palette.map((_, i) => p.palette[(i + offset) % p.palette.length]);
	const darkest = p.palette[0] ?? "#101014";
	const bg = f > .6 ? p.background : rand() < .7 ? darkest : mix(darkest, p.background, .5);
	const sourceSpeed = .4 + p.motion * 1.8;
	const sourceDensity = .5 + p.contrast * .8;
	return {
		system,
		rand,
		noise: valueNoise(mulberry32(seed * 7919 + 13)),
		colors,
		bg,
		speed: sourceSpeed + rand() * .5 * (1 - f),
		density: sourceDensity + rand() * .7 * (1 - f),
		scale: lerp(.6 + rand() * 1.4, 1, f),
		rot: rand() * Math.PI * 2 * (1 - f),
		grain: p.grain,
		fidelity: f
	};
}
function paint(ctx, S, t, r, p) {
	const TAU = Math.PI * 2;
	const c = (i) => r.colors[Math.abs(i) % r.colors.length];
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
			let x = seedPhase * 7.3 % 1 * S;
			let y = (seedPhase * 3.1 + .17) % 1 * S;
			ctx.strokeStyle = c(i);
			ctx.globalAlpha = .35 + .5 * (i % 5 / 5);
			ctx.beginPath();
			ctx.moveTo(x, y);
			for (let s = 0; s < 26; s++) {
				const a = r.noise(x / S * 4 * r.scale + Math.cos(t * TAU), y / S * 4 * r.scale + Math.sin(t * TAU)) * TAU * 2;
				x += Math.cos(a) * S * .02;
				y += Math.sin(a) * S * .02;
				ctx.lineTo(x, y);
			}
			ctx.stroke();
		}
	} else if (r.system === "orbit") {
		const rings = Math.round(4 + r.density * 5);
		for (let ring = 0; ring < rings; ring++) {
			const rad = (S * .08 + ring / rings * S * .42) * (1 + .06 * Math.sin(t * TAU + ring));
			const dots = 6 + ring * 4;
			for (let d = 0; d < dots; d++) {
				const a = d / dots * TAU + t * TAU * r.speed * (ring % 2 ? -1 : 1);
				const x = S / 2 + Math.cos(a) * rad;
				const y = S / 2 + Math.sin(a) * rad;
				const size = S / 60 * (.6 + (ring + d) % 3 * .5);
				ctx.fillStyle = c(ring + d);
				ctx.globalAlpha = .9;
				ctx.beginPath();
				ctx.arc(x, y, size, 0, TAU);
				ctx.fill();
			}
		}
	} else if (r.system === "shards") {
		const wedges = Math.round(6 + r.density * 8);
		for (let i = 0; i < wedges; i++) {
			const a0 = i / wedges * TAU + t * TAU * r.speed * .4;
			const a1 = a0 + TAU / wedges / (1 + i % 2);
			const rad = S * (.2 + .35 * Math.abs(Math.sin(t * TAU + i * .7)));
			ctx.fillStyle = c(i);
			ctx.globalAlpha = .55 + .35 * (i % 3 / 3);
			ctx.beginPath();
			ctx.moveTo(S / 2, S / 2);
			ctx.arc(S / 2, S / 2, rad, a0, a1);
			ctx.closePath();
			ctx.fill();
		}
	} else if (r.system === "waves") {
		const bands = Math.round(8 + r.density * 14);
		for (let i = 0; i < bands; i++) {
			const base = i / bands * S;
			ctx.fillStyle = c(i);
			ctx.globalAlpha = .8;
			ctx.beginPath();
			ctx.moveTo(0, base);
			for (let x = 0; x <= S; x += 6) {
				const amp = S * .05 * r.scale;
				const y = base + Math.sin(x / S * TAU * (1 + i % 3) * r.scale + t * TAU * r.speed + i) * amp;
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
			const shift = phase * S * .18 * (i % 2 ? 1 : -1) * r.scale;
			ctx.fillStyle = c(i);
			ctx.globalAlpha = .55 + .4 * (i % 4 / 4);
			const w = S * (.3 + .5 * Math.abs(phase));
			ctx.fillRect((S / 2 - w / 2 + shift) % S - S, y, w, h * 1.02);
			ctx.fillRect((S / 2 - w / 2 + shift) % S, y, w, h * 1.02);
		}
	} else {
		const n = Math.round(5 + r.density * 8);
		ctx.globalCompositeOperation = "lighter";
		for (let i = 0; i < n; i++) {
			const a = i / n * TAU;
			const wob = .18 + .16 * (i % 3 / 3);
			const x = S / 2 + Math.cos(a + t * TAU * r.speed * .5) * S * wob * r.scale;
			const y = S / 2 + Math.sin(a * 1.6 + t * TAU * r.speed * .5) * S * wob * r.scale;
			const rad = S * (.14 + .1 * Math.abs(Math.sin(t * TAU + i)));
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
	const grain = Math.min(.5, r.grain * .6);
	if (grain > .02) {
		const img = ctx.getImageData(0, 0, S, S);
		const d = img.data;
		const rnd = mulberry32(Math.floor(t * 1e3) + 7);
		for (let i = 0; i < d.length; i += 4) {
			const v = (rnd() - .5) * 90 * grain;
			d[i] = Math.max(0, Math.min(255, d[i] + v));
			d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + v));
			d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + v));
		}
		ctx.putImageData(img, 0, 0);
	}
	const vig = ctx.createRadialGradient(S / 2, S / 2, S * .25, S / 2, S / 2, S * .72);
	vig.addColorStop(0, "rgba(0,0,0,0)");
	vig.addColorStop(1, `rgba(0,0,0,${.25 + (1 - p.brightness) * .35})`);
	ctx.fillStyle = vig;
	ctx.fillRect(0, 0, S, S);
}
async function generateGif(seed, profile, opts) {
	const { GIFEncoder, quantize, applyPalette } = await import("../_libs/gifenc.mjs").then((n) => n.r);
	const S = opts.size;
	const recipe = makeRecipe(seed, profile);
	const canvas = document.createElement("canvas");
	canvas.width = S;
	canvas.height = S;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	const gif = GIFEncoder();
	const delay = Math.round(1e3 / Math.max(6, Math.min(24, profile.fps)));
	let palette = null;
	for (let i = 0; i < opts.frames; i++) {
		paint(ctx, S, i / opts.frames, recipe, profile);
		const data = ctx.getImageData(0, 0, S, S).data;
		if (!palette) palette = quantize(data, 128, { format: "rgb565" });
		const index = applyPalette(data, palette, "rgb565");
		gif.writeFrame(index, S, S, {
			palette: i === 0 ? palette : void 0,
			delay
		});
		if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
	}
	gif.finish();
	const bytes = gif.bytes();
	const blob = new Blob([bytes], { type: "image/gif" });
	return {
		id: `${seed}`,
		seed,
		system: recipe.system,
		url: URL.createObjectURL(blob),
		bytes: blob.size
	};
}
function Meter({ label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-baseline justify-between",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "label-mono",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "font-mono text-xs text-foreground",
			children: Math.round(value * 100)
		})]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "h-full rounded-full bg-primary transition-all duration-700",
			style: { width: `${Math.max(3, Math.min(100, value * 100))}%` }
		})
	})] });
}
function Studio() {
	const [files, setFiles] = (0, import_react.useState)([]);
	const [profile, setProfile] = (0, import_react.useState)(null);
	const [stage, setStage] = (0, import_react.useState)("idle");
	const [progress, setProgress] = (0, import_react.useState)(0);
	const [items, setItems] = (0, import_react.useState)([]);
	const [error, setError] = (0, import_react.useState)(null);
	const [count, setCount] = (0, import_react.useState)(50);
	const [size, setSize] = (0, import_react.useState)(256);
	const inputRef = (0, import_react.useRef)(null);
	const cancelRef = (0, import_react.useRef)(false);
	const pick = (0, import_react.useCallback)((list) => {
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
		const made = [];
		for (let i = 0; i < count; i++) {
			if (cancelRef.current) break;
			const item = await generateGif(base + i * 2654435761, profile, {
				size,
				frames
			});
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
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto max-w-6xl px-5 py-10 md:py-16",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "mb-10",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "label-mono",
					children: "Generative series lab"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "mt-2 text-4xl font-bold md:text-5xl",
					children: "GIF Collection Studio"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 max-w-2xl text-muted-foreground",
					children: "Drop in reference GIFs, extract their style profile — palette, motion energy, grain, contrast — then generate a whole series of new looping GIF-art that reads as one collection."
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "space-y-6",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "panel flex flex-col items-center justify-center gap-3 border-dashed p-10 text-center transition-colors hover:border-primary/60",
						onDragOver: (e) => e.preventDefault(),
						onDrop: (e) => {
							e.preventDefault();
							pick(e.dataTransfer.files);
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								ref: inputRef,
								type: "file",
								accept: "image/gif",
								multiple: true,
								className: "hidden",
								onChange: (e) => pick(e.target.files)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "font-display text-lg",
								children: "Drop reference GIFs here"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-muted-foreground",
								children: "up to 8 files · they never leave your browser"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: () => inputRef.current?.click(),
								className: "mt-2 rounded-md border border-border bg-surface-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted",
								children: "Choose files"
							}),
							files.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "label-mono mt-2",
								children: [
									files.length,
									" file",
									files.length > 1 ? "s" : "",
									" selected"
								]
							})
						]
					}),
					error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-destructive",
						children: error
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-center gap-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								disabled: !files.length || busy,
								onClick: analyze,
								className: "rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40",
								children: stage === "analyzing" ? "Analyzing…" : "Analyze"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								disabled: !profile || busy,
								onClick: generate,
								className: "glow rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity disabled:opacity-40 disabled:shadow-none",
								children: ["Generate ", count]
							}),
							stage === "generating" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: () => cancelRef.current = true,
								className: "rounded-md border border-border px-4 py-2.5 text-sm",
								children: "Stop"
							}),
							items.length > 0 && stage !== "generating" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: downloadAll,
								className: "rounded-md border border-border px-4 py-2.5 text-sm transition-colors hover:bg-muted",
								children: "Download all"
							})
						]
					}),
					stage === "generating" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "h-1.5 overflow-hidden rounded-full bg-muted",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "h-full bg-accent transition-all",
							style: { width: `${progress * 100}%` }
						})
					}),
					items.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "label-mono mb-3",
						children: [
							"Collection · ",
							items.length,
							" pieces"
						]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4",
						children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
							href: item.url,
							download: `collection-${item.system}-${item.seed}.gif`,
							className: "group overflow-hidden rounded-lg border border-border bg-surface",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
								src: item.url,
								alt: `Generated ${item.system} GIF art, seed ${item.seed}`,
								className: "aspect-square w-full object-cover",
								loading: "lazy"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-center justify-between px-2 py-1.5",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "label-mono",
									children: item.system
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "font-mono text-[0.65rem] text-muted-foreground",
									children: [Math.round(item.bytes / 1024), "kb"]
								})]
							})]
						}, item.id))
					})] })
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
				className: "panel h-fit space-y-5 p-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display text-lg",
						children: "Style Profile"
					}),
					!profile && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted-foreground",
						children: "Analyze your references to see the profile."
					}),
					profile && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "flex flex-wrap gap-2",
							children: profile.thumbs.map((t, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
								src: t,
								alt: `Reference ${profile.names[i] ?? i + 1}`,
								className: "h-12 w-12 rounded-md border border-border object-cover"
							}, i))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "label-mono mb-2",
							children: "Palette"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "flex overflow-hidden rounded-md border border-border",
							children: profile.palette.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "h-9 flex-1",
								style: { backgroundColor: c },
								title: c
							}, c))
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "space-y-3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meter, {
									label: "Motion",
									value: profile.motion
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meter, {
									label: "Grain",
									value: profile.grain
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meter, {
									label: "Contrast",
									value: profile.contrast
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meter, {
									label: "Saturation",
									value: profile.saturation
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meter, {
									label: "Brightness",
									value: profile.brightness
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
							className: "grid grid-cols-2 gap-2 font-mono text-xs text-muted-foreground",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: ["fps · ", profile.fps] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: ["frames · ", profile.frameCount] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: ["sources · ", profile.sources] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: ["aspect · ", profile.aspect.toFixed(2)] })
							]
						})
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "space-y-3 border-t border-border pt-4",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "label-mono",
								children: ["Collection size · ", count]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "range",
								min: 5,
								max: 100,
								step: 5,
								value: count,
								onChange: (e) => setCount(Number(e.target.value)),
								className: "mt-2 w-full accent-primary"
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "label-mono",
								children: [
									"Resolution · ",
									size,
									"px"
								]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "range",
								min: 128,
								max: 384,
								step: 32,
								value: size,
								onChange: (e) => setSize(Number(e.target.value)),
								className: "mt-2 w-full accent-primary"
							})]
						})]
					})
				]
			})]
		})]
	});
}
//#endregion
export { Studio as component };
