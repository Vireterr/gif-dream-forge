import { r as __toESM } from "../_runtime.mjs";
import { n as require_jsx_runtime, r as require_react } from "../_libs/react+tanstack__react-query.mjs";
import { i as nt, n as ct, t as H } from "../_libs/gifenc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/gif-variation-studio-v-1ELoIf.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
/**
* Parse a GIF file and extract all frames as RGBA data
*/
async function decodeGif(file) {
	const buffer = await file.arrayBuffer();
	const data = new Uint8Array(buffer);
	if (!String.fromCharCode(...data.slice(0, 6)).startsWith("GIF")) throw new Error("Not a valid GIF file");
	return renderFrames(parseGif(data));
}
/**
* Parse GIF structure
*/
function parseGif(data) {
	let offset = 0;
	offset = 13;
	const width = data[6] | data[7] << 8;
	const height = data[8] | data[9] << 8;
	const packed = data[10];
	const globalColorTableFlag = packed >> 7 & 1;
	packed >> 4 & 7;
	packed >> 3 & 1;
	const globalColorTableSize = packed & 7;
	const descriptor = {
		width,
		height,
		backgroundColorIndex: data[11],
		pixelAspectRatio: data[12]
	};
	if (globalColorTableFlag) {
		const globalColorTableLength = 3 * (1 << globalColorTableSize + 1);
		const globalColorTable = [];
		for (let i = 0; i < globalColorTableLength; i += 3) globalColorTable.push([
			data[offset + i],
			data[offset + i + 1],
			data[offset + i + 2]
		]);
		descriptor.globalColorTable = globalColorTable;
		offset += globalColorTableLength;
	}
	const frames = [];
	let currentDelay = 100;
	let currentDisposalType = 0;
	let left = 0, top = 0;
	while (offset < data.length && data[offset] !== 59) {
		const blockType = data[offset];
		if (blockType === 33) {
			offset++;
			const extensionLabel = data[offset];
			offset++;
			if (extensionLabel === 249) {
				const blockSize = data[offset];
				currentDisposalType = data[offset + 1] >> 2 & 7;
				currentDelay = (data[offset + 2] | data[offset + 3] << 8) * 10;
				offset += blockSize + 1;
			} else {
				while (offset < data.length && data[offset] !== 0) {
					const subBlockSize = data[offset];
					offset += subBlockSize + 1;
				}
				offset++;
			}
		} else if (blockType === 44) {
			offset++;
			left = data[offset] | data[offset + 1] << 8;
			top = data[offset + 2] | data[offset + 3] << 8;
			const imgWidth = data[offset + 4] | data[offset + 5] << 8;
			const imgHeight = data[offset + 6] | data[offset + 7] << 8;
			const imgPacked = data[offset + 8];
			const localColorTableFlag = imgPacked >> 7 & 1;
			const interlaceFlag = imgPacked >> 6 & 1;
			const localColorTableSize = imgPacked & 7;
			offset += 9;
			let colorTable = descriptor.globalColorTable;
			if (localColorTableFlag) {
				const localColorTableLength = 3 * (1 << localColorTableSize + 1);
				const localColorTable = [];
				for (let i = 0; i < localColorTableLength; i += 3) localColorTable.push([
					data[offset + i],
					data[offset + i + 1],
					data[offset + i + 2]
				]);
				colorTable = localColorTable;
				offset += localColorTableLength;
			}
			const lzwMinimumCodeSize = data[offset];
			offset++;
			const compressedData = [];
			while (offset < data.length && data[offset] !== 0) {
				const subBlockSize = data[offset];
				offset++;
				for (let i = 0; i < subBlockSize; i++) compressedData.push(data[offset + i]);
				offset += subBlockSize;
			}
			offset++;
			const pixels = lzwDecode(compressedData, lzwMinimumCodeSize);
			const frameData = new Uint8ClampedArray(width * height * 4);
			let pixelIndex = 0;
			if (interlaceFlag) for (const pass of [
				{
					start: 0,
					step: 8
				},
				{
					start: 4,
					step: 8
				},
				{
					start: 2,
					step: 4
				},
				{
					start: 1,
					step: 2
				}
			]) for (let y = pass.start; y < imgHeight; y += pass.step) for (let x = 0; x < imgWidth; x++) {
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
			else for (let y = 0; y < imgHeight; y++) for (let x = 0; x < imgWidth; x++) {
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
			frames.push({
				imageData: new ImageData(frameData, width, height),
				delay: currentDelay,
				disposalType: currentDisposalType,
				left,
				top,
				width: imgWidth,
				height: imgHeight
			});
			currentDelay = 100;
			currentDisposalType = 0;
		} else offset++;
	}
	return {
		descriptor,
		frames,
		totalDelay: frames.reduce((sum, f) => sum + f.delay, 0)
	};
}
/**
* LZW Decompression
*/
function lzwDecode(compressedData, minCodeSize) {
	const clearCode = 1 << minCodeSize;
	const endCode = clearCode + 1;
	let codeSize = minCodeSize + 1;
	let maxCode = 1 << codeSize;
	const dictionary = [];
	for (let i = 0; i < 256; i++) dictionary[i] = [i];
	dictionary[clearCode] = [];
	dictionary[endCode] = [];
	const output = [];
	let bitPosition = 0;
	let oldCode = null;
	function readCode() {
		let code = 0;
		for (let i = 0; i < codeSize; i++) {
			const byteIndex = Math.floor(bitPosition / 8);
			const bitOffset = bitPosition % 8;
			if (byteIndex >= compressedData.length) return null;
			const byte = compressedData[byteIndex];
			code |= (byte >> bitOffset & 1) << i;
			bitPosition++;
		}
		return code;
	}
	while (true) {
		const code = readCode();
		if (code === null) break;
		if (code === clearCode) {
			dictionary.length = 0;
			for (let i = 0; i < 256; i++) dictionary[i] = [i];
			dictionary[clearCode] = [];
			dictionary[endCode] = [];
			codeSize = minCodeSize + 1;
			maxCode = 1 << codeSize;
			oldCode = null;
			continue;
		}
		if (code === endCode) break;
		let entry;
		if (code < dictionary.length) entry = dictionary[code];
		else if (oldCode !== null) entry = [...dictionary[oldCode], dictionary[oldCode][0]];
		else entry = [];
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
function renderFrames(gif) {
	const { descriptor, frames } = gif;
	const canvas = document.createElement("canvas");
	canvas.width = descriptor.width;
	canvas.height = descriptor.height;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("Could not create canvas context");
	const result = [];
	for (const frame of frames) {
		if (frame.disposalType === 2) ctx.clearRect(0, 0, descriptor.width, descriptor.height);
		const tempCanvas = document.createElement("canvas");
		tempCanvas.width = frame.width;
		tempCanvas.height = frame.height;
		const tempCtx = tempCanvas.getContext("2d");
		if (tempCtx) {
			tempCtx.putImageData(frame.imageData, 0, 0);
			ctx.drawImage(tempCanvas, frame.left, frame.top);
		}
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
/**
* GIF Encoder using gifenc library
*/
/**
* Encode frames to a GIF blob
*/
async function encodeGif(frames) {
	const gif = ct();
	if (frames.length === 0) throw new Error("No frames to encode");
	const { width, height } = frames[0];
	let palette = null;
	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i];
		const rgba = frame.rgba;
		if (!palette) palette = H(rgba, 256);
		const indexed = nt(rgba, palette);
		gif.writeFrame(indexed, width, height, {
			palette: i === 0 ? palette : void 0,
			delay: frame.delay
		});
		if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
	}
	gif.finish();
	const bytes = gif.bytes();
	return new Blob([bytes], { type: "image/gif" });
}
/**
* Encode a single variation and return as blob URL
*/
async function encodeVariation(frames) {
	const blob = await encodeGif(frames);
	return {
		blob,
		url: URL.createObjectURL(blob),
		bytes: blob.size
	};
}
/**
* Noise functions for procedural generation
* Based on Perlin noise implementation
*/
var noiseTable = /* @__PURE__ */ new Uint8Array(4096);
function initNoiseTable() {
	const p = /* @__PURE__ */ new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[p[i], p[j]] = [p[j], p[i]];
	}
	for (let i = 0; i < 4096; i++) noiseTable[i] = p[i & 255];
}
initNoiseTable();
/**
* Fast hash function for integer coordinates
*/
function hash(x, y) {
	let h = x * 374761393 + y * 668265263;
	h = (h ^ h >> 13) * 1274126177;
	return h ^ h >> 16;
}
/**
* Hash to 0-1 range
*/
function hash01(x, y) {
	return (hash(x, y) & 16777215) / 16777216;
}
/**
* Smoothstep interpolation
*/
function smoothstep(t) {
	return t * t * (3 - 2 * t);
}
/**
* 2D value noise at given coordinates
*/
function noiseAt(x, y) {
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
	return top + (bl + (br - bl) * sx - top) * sy;
}
/**
* Fractal Brownian Motion - multiple octaves of noise
*/
function fbmNoise2D(x, y, octaves = 4, lacunarity = 2, persistence = .5) {
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
* Mulberry32 PRNG for deterministic randomness
*/
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
/**
* Generate a displacement field using Perlin noise
* The field defines how much each pixel should be displaced (dx, dy)
*/
function generateDisplacementField(width, height, similarity, seed) {
	const maxAmplitude = (100 - similarity) / 100 * 20;
	const baseFreq = 1 + (100 - similarity) / 100 * 4;
	const dx = new Float32Array(width * height);
	const dy = new Float32Array(width * height);
	const rand = mulberry32(seed);
	const phaseX = rand() * 1e3;
	const phaseY = rand() * 1e3;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const nx = x / width * baseFreq + phaseX;
		const ny = y / height * baseFreq + phaseY;
		const noiseX = fbmNoise2D(nx, ny, 4, 2, .5);
		const noiseY = fbmNoise2D(nx + 5.3, ny + 2.7, 4, 2, .5);
		const dX = (noiseX - .5) * 2 * maxAmplitude;
		const dY = (noiseY - .5) * 2 * maxAmplitude;
		dx[y * width + x] = dX;
		dy[y * width + x] = dY;
	}
	return {
		dx,
		dy,
		width,
		height
	};
}
/**
* Warp a frame using bilinear interpolation based on displacement field
*/
function warpFrame(sourceFrame, displacementField, motionMask) {
	const { rgba: srcData } = sourceFrame;
	const { width, height } = sourceFrame;
	const { dx, dy } = displacementField;
	const output = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const idx = y * width + x;
		let displacementScale = 1;
		if (motionMask) displacementScale = 1 - (motionMask[idx] ?? 0) / 255 * .5;
		const srcX = x + dx[idx] * displacementScale;
		const srcY = y + dy[idx] * displacementScale;
		const clampedSrcX = Math.max(0, Math.min(width - 1.001, srcX));
		const clampedSrcY = Math.max(0, Math.min(height - 1.001, srcY));
		const x0 = Math.floor(clampedSrcX);
		const y0 = Math.floor(clampedSrcY);
		const x1 = Math.min(x0 + 1, width - 1);
		const y1 = Math.min(y0 + 1, height - 1);
		const tx = clampedSrcX - x0;
		const ty = clampedSrcY - y0;
		for (let c = 0; c < 4; c++) {
			const p00 = srcData[(y0 * width + x0) * 4 + c] ?? 0;
			const p10 = srcData[(y0 * width + x1) * 4 + c] ?? 0;
			const p01 = srcData[(y1 * width + x0) * 4 + c] ?? 0;
			const p11 = srcData[(y1 * width + x1) * 4 + c] ?? 0;
			const value = p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty) + p01 * (1 - tx) * ty + p11 * tx * ty;
			output[idx * 4 + c] = Math.round(value);
		}
	}
	return output;
}
/**
* Modify displacement field with temporal consistency
* Adds smooth sinusoidal modulation based on frame index
*/
function applyTemporalConsistency(baseField, frameIndex, totalFrames, temporalAmplitude) {
	const { dx, dy, width, height } = baseField;
	const modulatedDx = new Float32Array(dx.length);
	const modulatedDy = new Float32Array(dy.length);
	const phase = frameIndex / totalFrames * Math.PI * 2;
	const temporalModulation = Math.sin(phase) * temporalAmplitude;
	for (let i = 0; i < dx.length; i++) {
		modulatedDx[i] = dx[i] + temporalModulation;
		modulatedDy[i] = dy[i] + temporalModulation * .5;
	}
	return {
		dx: modulatedDx,
		dy: modulatedDy,
		width,
		height
	};
}
/**
* Color conversion utilities
*/
/**
* Convert HSL to RGB
* h: 0-360, s: 0-1, l: 0-1
* Returns [r, g, b] each 0-255
*/
function hslToRgb(h, s, l) {
	h = (h % 360 + 360) % 360;
	s = Math.max(0, Math.min(1, s));
	l = Math.max(0, Math.min(1, l));
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(h / 60 % 2 - 1));
	const m = l - c / 2;
	let r1 = 0, g1 = 0, b1 = 0;
	if (h < 60) {
		r1 = c;
		g1 = x;
		b1 = 0;
	} else if (h < 120) {
		r1 = x;
		g1 = c;
		b1 = 0;
	} else if (h < 180) {
		r1 = 0;
		g1 = c;
		b1 = x;
	} else if (h < 240) {
		r1 = 0;
		g1 = x;
		b1 = c;
	} else if (h < 300) {
		r1 = x;
		g1 = 0;
		b1 = c;
	} else {
		r1 = c;
		g1 = 0;
		b1 = x;
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
function rgbToHsl(r, g, b) {
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
		s = l > .5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
				break;
			case g:
				h = ((b - r) / d + 2) / 6;
				break;
			case b: h = ((r - g) / d + 4) / 6;
		}
	}
	return [
		h * 360,
		s,
		l
	];
}
/**
* Generate a color transform based on similarity and seed
*/
function generateColorTransform(similarity, seed) {
	const rand = mulberry32(seed);
	const intensity = (100 - similarity) / 100;
	const hueDirection = rand() > .5 ? 1 : -1;
	const satDirection = rand() > .5 ? 1 : -1;
	const lightDirection = rand() > .5 ? 1 : -1;
	const contrastDirection = rand() > .5 ? 1 : -1;
	return {
		hueShift: hueDirection * intensity * 90,
		saturationMul: 1 + satDirection * intensity * .7,
		lightnessShift: lightDirection * intensity * .4,
		contrastMul: 1 + contrastDirection * intensity * .5
	};
}
/**
* Apply color transform to a frame
*/
function applyColorTransformToFrame(frame, transform) {
	const { rgba: srcData } = frame;
	const output = new Uint8ClampedArray(srcData.length);
	for (let i = 0; i < srcData.length; i += 4) {
		const r = srcData[i] ?? 0;
		const g = srcData[i + 1] ?? 0;
		const b = srcData[i + 2] ?? 0;
		const a = srcData[i + 3] ?? 255;
		if (a < 1) {
			output[i] = r;
			output[i + 1] = g;
			output[i + 2] = b;
			output[i + 3] = a;
			continue;
		}
		let [h, s, l] = rgbToHsl(r, g, b);
		h = ((h + transform.hueShift) % 360 + 360) % 360;
		s = Math.max(0, Math.min(1, s * transform.saturationMul));
		l = Math.max(0, Math.min(1, l + transform.lightnessShift));
		const contrastCenter = .5;
		l = contrastCenter + (l - contrastCenter) * transform.contrastMul;
		l = Math.max(0, Math.min(1, l));
		const [newR, newG, newB] = hslToRgb(h, s, l);
		output[i] = newR;
		output[i + 1] = newG;
		output[i + 2] = newB;
		output[i + 3] = a;
	}
	return output;
}
/**
* Compute a motion mask by comparing two frames
* Returns a mask where high values indicate areas of high motion
*/
function computeMotionMask(frame1, frame2) {
	const { width, height } = frame1;
	const data = new Uint8Array(width * height);
	const diffThreshold = 30;
	const blurRadius = 2;
	const rawData = new Float32Array(width * height);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const idx = (y * width + x) * 4;
		let diff = 0;
		for (let c = 0; c < 3; c++) {
			const v1 = frame1.rgba[idx + c] ?? 0;
			const v2 = frame2.rgba[idx + c] ?? 0;
			diff += Math.abs(v1 - v2);
		}
		const normalizedDiff = Math.min(255, diff / 3 * (255 / diffThreshold));
		rawData[y * width + x] = normalizedDiff;
	}
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		let sum = 0;
		let count = 0;
		for (let dy = -2; dy <= blurRadius; dy++) for (let dx = -2; dx <= blurRadius; dx++) {
			const nx = x + dx;
			const ny = y + dy;
			if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
				sum += rawData[ny * width + nx] ?? 0;
				count++;
			}
		}
		data[y * width + x] = Math.round(sum / count);
	}
	return {
		data,
		width,
		height
	};
}
/**
* Generate N variations of a GIF
*/
async function generateVariations(file, config, onProgress, shouldCancel) {
	const { similarity, count } = config;
	const originalFrames = await decodeGif(file);
	if (originalFrames.length === 0) throw new Error("No frames found in GIF");
	const { width, height } = originalFrames[0];
	const totalFrames = originalFrames.length;
	let motionMask;
	if (totalFrames >= 2) motionMask = computeMotionMask(originalFrames[0], originalFrames[1]);
	const results = [];
	for (let v = 0; v < count; v++) {
		if (shouldCancel?.()) break;
		const variationSeed = Math.floor(Math.random() * 1e9) + v * 2654435761;
		1 + (100 - similarity) / 100 * 4;
		const displacementField = generateDisplacementField(width, height, similarity, variationSeed);
		const colorTransform = generateColorTransform(similarity, variationSeed);
		const temporalAmplitude = (100 - similarity) / 100 * 5;
		const variationFrames = [];
		for (let f = 0; f < totalFrames; f++) {
			const originalFrame = originalFrames[f];
			const finalFrame = {
				rgba: applyColorTransformToFrame({
					rgba: warpFrame(originalFrame, applyTemporalConsistency(displacementField, f, totalFrames, temporalAmplitude), motionMask?.data),
					delay: originalFrame.delay,
					width: originalFrame.width,
					height: originalFrame.height
				}, colorTransform),
				delay: originalFrame.delay,
				width: originalFrame.width,
				height: originalFrame.height
			};
			variationFrames.push(finalFrame);
			if (f % 4 === 3) await new Promise((r) => setTimeout(r, 0));
		}
		const { url, bytes } = await encodeVariation(variationFrames);
		results.push({
			id: `v${v + 1}-${variationSeed}`,
			url,
			bytes,
			seed: variationSeed
		});
		onProgress?.(v + 1, count);
		await new Promise((r) => setTimeout(r, 0));
	}
	return results;
}
function GifVariationStudio() {
	const [file, setFile] = (0, import_react.useState)(null);
	const [originalInfo, setOriginalInfo] = (0, import_react.useState)(null);
	const [stage, setStage] = (0, import_react.useState)("idle");
	const [similarity, setSimilarity] = (0, import_react.useState)(75);
	const [count, setCount] = (0, import_react.useState)(10);
	const [progress, setProgress] = (0, import_react.useState)(0);
	const [results, setResults] = (0, import_react.useState)([]);
	const [error, setError] = (0, import_react.useState)(null);
	const inputRef = (0, import_react.useRef)(null);
	const cancelRef = (0, import_react.useRef)(false);
	const pickFile = (0, import_react.useCallback)((list) => {
		if (!list || list.length === 0) return;
		const gifFile = Array.from(list).find((f) => f.type === "image/gif" || f.name.toLowerCase().endsWith(".gif"));
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
			const { parseGIF, decompressFrames } = await import("../_libs/gifuct-js+[...].mjs").then((n) => /* @__PURE__ */ __toESM(n.t()));
			const gif = parseGIF(await file.arrayBuffer());
			const frames = decompressFrames(gif, true);
			if (!frames.length) throw new Error("No frames found in GIF");
			const width = gif.lsd.width;
			const height = gif.lsd.height;
			const totalDelay = frames.reduce((s, f) => s + (f.delay || 100), 0);
			const fps = Math.max(4, Math.min(30, 1e3 / (totalDelay / frames.length)));
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
					patchCtx.putImageData(new ImageData(new Uint8ClampedArray(frames[0].patch), frames[0].dims.width, frames[0].dims.height), 0, 0);
					ctx.drawImage(patchCanvas, 0, 0, canvas.width, canvas.height);
				}
			}
			setOriginalInfo({
				frames: frames.length,
				width,
				height,
				duration: totalDelay,
				fps,
				thumb: canvas.toDataURL("image/png")
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
			const variationResults = await generateVariations(file, {
				similarity,
				count
			}, (current, total) => {
				setProgress(current / total);
			}, () => cancelRef.current);
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
	function getSimilarityDescription(value) {
		if (value >= 95) return "Nearly identical (0-1px displacement)";
		if (value >= 85) return "Very similar (1-3px displacement)";
		if (value >= 70) return "Similar (3-8px displacement)";
		if (value >= 50) return "Moderate changes (8-15px displacement)";
		return "Significant changes (15-20px displacement)";
	}
	const busy = stage === "decoding" || stage === "generating";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto max-w-7xl px-5 py-10 md:py-16",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "mb-10",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "label-mono",
					children: "Visual variation generator"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "mt-2 text-4xl font-bold md:text-5xl",
					children: "GIF Variation Studio"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 max-w-2xl text-muted-foreground",
					children: "Upload a single GIF to generate multiple visual variations. Each variation preserves the original's composition, movement timing, and character while introducing controlled differences through pixel displacement and color transformation."
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "space-y-6",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "panel flex flex-col items-center justify-center gap-3 border-dashed p-10 text-center transition-colors hover:border-primary/60",
						onDragOver: (e) => e.preventDefault(),
						onDrop: (e) => {
							e.preventDefault();
							pickFile(e.dataTransfer.files);
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								ref: inputRef,
								type: "file",
								accept: "image/gif",
								className: "hidden",
								onChange: (e) => pickFile(e.target.files)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "font-display text-lg",
								children: "Drop a GIF here"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-muted-foreground",
								children: "one file · processed entirely in your browser"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: () => inputRef.current?.click(),
								className: "mt-2 rounded-md border border-border bg-surface-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted",
								children: "Choose file"
							}),
							file && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "label-mono mt-2",
								children: file.name
							})
						]
					}),
					error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-destructive",
						children: error
					}),
					originalInfo && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "panel p-5",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "label-mono mb-3",
							children: "Original GIF"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-start gap-4",
							children: [originalInfo.thumb && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
								src: originalInfo.thumb,
								alt: "Original GIF preview",
								className: "rounded-md border border-border",
								style: { width: originalInfo.width > 320 ? 320 : originalInfo.width }
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
								className: "grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "Size" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "text-foreground",
										children: [
											originalInfo.width,
											"×",
											originalInfo.height,
											"px"
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "Frames" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-foreground",
										children: originalInfo.frames
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "Duration" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "text-foreground",
										children: [(originalInfo.duration / 1e3).toFixed(2), "s"]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "FPS" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-foreground",
										children: originalInfo.fps
									})
								]
							})]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-center gap-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								disabled: !file || busy,
								onClick: analyzeGif,
								className: "rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40",
								children: stage === "decoding" ? "Analyzing…" : "Analyze GIF"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								disabled: !originalInfo || busy,
								onClick: generate,
								className: "glow rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity disabled:opacity-40 disabled:shadow-none",
								children: [
									"Generate ",
									count,
									" Variations"
								]
							}),
							stage === "generating" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: () => cancelRef.current = true,
								className: "rounded-md border border-border px-4 py-2.5 text-sm",
								children: "Stop"
							}),
							results.length > 0 && stage !== "generating" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: downloadAll,
								className: "rounded-md border border-border px-4 py-2.5 text-sm transition-colors hover:bg-muted",
								children: "Download All"
							})
						]
					}),
					stage === "generating" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mb-2 flex items-center justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "label-mono",
							children: "Generating variations"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "font-mono text-xs text-muted-foreground",
							children: [Math.round(progress * 100), "%"]
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "h-1.5 overflow-hidden rounded-full bg-muted",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "h-full bg-accent transition-all",
							style: { width: `${progress * 100}%` }
						})
					})] }),
					results.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "label-mono mb-3",
						children: ["Generated Variations · ", results.length]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
						children: results.map((result) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
							href: result.url,
							download: `variation-${result.id}.gif`,
							className: "group overflow-hidden rounded-lg border border-border bg-surface",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
								src: result.url,
								alt: `Variation ${result.id}`,
								className: "aspect-square w-full object-cover",
								loading: "lazy"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-center justify-between px-2 py-1.5",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "label-mono text-[0.6rem]",
									children: result.id.split("-")[0]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "font-mono text-[0.6rem] text-muted-foreground",
									children: [Math.round(result.bytes / 1024), "kb"]
								})]
							})]
						}, result.id))
					})] })
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
				className: "panel h-fit space-y-5 p-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display text-lg",
						children: "Settings"
					}),
					!originalInfo && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted-foreground",
						children: "Analyze a GIF to configure generation settings."
					}),
					originalInfo && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "space-y-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "flex items-baseline justify-between",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "label-mono",
										children: [
											"Similarity · ",
											similarity,
											"%"
										]
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "range",
									min: 0,
									max: 100,
									step: 5,
									value: similarity,
									onChange: (e) => setSimilarity(Number(e.target.value)),
									className: "mt-2 w-full accent-primary",
									disabled: stage === "generating"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-1 text-xs text-muted-foreground",
									children: getSimilarityDescription(similarity)
								})
							]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "flex items-baseline justify-between",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "label-mono",
										children: ["Variations · ", count]
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "range",
									min: 1,
									max: 100,
									step: 1,
									value: count,
									onChange: (e) => setCount(Number(e.target.value)),
									className: "mt-2 w-full accent-primary",
									disabled: stage === "generating"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-1 text-xs text-muted-foreground",
									children: "Generate between 1 and 100 variations"
								})
							]
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "border-t border-border pt-4",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "label-mono mb-2",
							children: "How It Works"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
							className: "space-y-2 text-xs text-muted-foreground",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "flex gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-primary",
										children: "1."
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Perlin noise displacement field applied to all frames" })]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "flex gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-primary",
										children: "2."
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Bilinear interpolation prevents pixelation artifacts" })]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "flex gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-primary",
										children: "3."
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Motion mask reduces displacement in moving areas" })]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "flex gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-primary",
										children: "4."
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Sinusoidal temporal modulation ensures smooth loops" })]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "flex gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-primary",
										children: "5."
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "HSL color transform adds variety while preserving look" })]
								})
							]
						})]
					})] })
				]
			})]
		})]
	});
}
//#endregion
export { GifVariationStudio as component };
