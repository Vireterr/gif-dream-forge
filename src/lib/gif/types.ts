export interface GifItem {
  id: string;
  url: string;
  seed: number;
  system: string;
  bytes: number;
  width: number;
  height: number;
  frames: number;
  fps: number;
  duration: number;
}

export interface StyleProfile {
  // === Существующие поля ===
  palette: string[];
  motion: number;
  grain: number;
  contrast: number;
  saturation: number;
  brightness: number;
  fps: number;
  frameCount: number;
  sources: number;
  aspect: number;
  thumbs: string[];
  names: string[];
  
  // === НОВЫЕ — управление стилем ===
  style: StyleParams;
  color: ColorProfile;
  motionProfile: MotionProfile;
  textureProfile: TextureProfile;
}

// ============================================================
// 2. ПАРАМЕТРЫ СТИЛЯ
// ============================================================

export interface StyleParams {
  colorVariance: number;      // 0..1 — насколько сильно цвета могут отклоняться
  motionComplexity: number;   // 0..1 — сложность движения
  shapeDensity: number;       // 0..1 — плотность форм/объектов
  symmetry: number;           // 0..1 — симметричность (0 = асимметрично)
  noiseAmount: number;        // 0..1 — количество шума/зерна
  lineWeight: number;         // 0..1 — толщина линий
  speed: number;              // 0..1 — скорость анимации
  edgeSharpness: number;      // 0..1 — резкость краёв
  detailLevel: number;        // 0..1 — уровень детализации
  flow: number;               // 0..1 — плавность/текучесть
  repetition: number;         // 0..1 — повторяемость паттернов
}

// ============================================================
// 3. ЦВЕТОВОЙ ПРОФИЛЬ
// ============================================================

export interface ColorProfile {
  palette: string[];
  dominantColors: string[];
  accentColors: string[];
  temperature: "warm" | "cool" | "neutral" | "mixed";
  harmony: "monochromatic" | "complementary" | "analogous" | "triadic" | "mixed";
  contrastRatio: number;      // 0..1
  saturationSpread: number;   // 0..1 — разброс насыщенности
  brightnessSpread: number;   // 0..1 — разброс яркости
  hueDistribution: number[];  // 0..360 — распределение оттенков (гистограмма)
}

// ============================================================
// 4. ПРОФИЛЬ ДВИЖЕНИЯ
// ============================================================

export interface MotionProfile {
  energy: number;             // 0..1 — общая энергия движения
  complexity: number;         // 0..1 — сложность траекторий
  smoothness: number;         // 0..1 — плавность
  chaos: number;              // 0..1 — хаотичность
  direction: number;          // 0..1 — направленность (0 = случайное, 1 = однонаправленное)
  speedVariance: number;      // 0..1 — вариативность скорости
  acceleration: number;       // 0..1 — резкость ускорений
  oscillation: number;        // 0..1 — колебательный характер
  rotation: number;           // 0..1 — вращательный компонент
  pulsing: number;            // 0..1 — пульсирующий характер
}

// ============================================================
// 5. ПРОФИЛЬ ТЕКСТУРЫ
// ============================================================

export interface TextureProfile {
  grain: number;              // 0..1 — зернистость
  noise: number;              // 0..1 — шумность
  blur: number;               // 0..1 — размытость
  sharpness: number;          // 0..1 — резкость
  pixelation: number;         // 0..1 — пикселизация
  glitch: number;             // 0..1 — глитч-эффекты
  chromatic: number;          // 0..1 — хроматическая аберрация
  vignette: number;           // 0..1 — виньетирование
  bloom: number;              // 0..1 — свечение
  posterize: number;          // 0..1 — постеризация (количество цветов)
}

// ============================================================
// 6. РЕЖИМЫ ГЕНЕРАЦИИ
// ============================================================

export type GenMode = 
  | "abstract"      // абстрактные формы
  | "geometric"     // геометрические фигуры
  | "organic"       // органические/природные
  | "pixel"         // пиксель-арт
  | "glitch"        // глитч-эффекты
  | "fluid";        // плавные текучие формы

export type ColorMode = "palette" | "gradient" | "random" | "profile";

// ============================================================
// 7. УПРАВЛЕНИЕ ЦВЕТОМ
// ============================================================

export interface ColorControl {
  mode: ColorMode;
  palette: string[];
  gradientStops: { pos: number; color: string }[];
  saturation: number;         // 0..1
  brightness: number;         // 0..1
  contrast: number;           // 0..1
  hueShift: number;           // -180..180
  colorVariance: number;      // 0..1
  preserveAccents: boolean;   // сохранять акцентные цвета из профиля
}

// ============================================================
// 8. ПОСТ-ЭФФЕКТЫ
// ============================================================

export interface PostEffects {
  blur: number;               // 0..1
  pixelate: number;           // 0..1
  grain: number;              // 0..1
  vignette: number;           // 0..1
  chromatic: number;          // 0..1
  glitch: number;             // 0..1
  bloom: number;              // 0..1
  posterize: number;          // 0..1 (0 = no, 1 = max)
  noise: number;              // 0..1
  sharpen: number;            // 0..1
}

// ============================================================
// 9. ПАРАМЕТРЫ ГЕНЕРАЦИИ
// ============================================================

export interface GenParams {
  mode: GenMode;
  color: ColorControl;
  effects: PostEffects;
  speed: number;
  complexity: number;
  symmetry: number;
  density: number;
  lineWeight: number;
  flow: number;
  repetition: number;
  chaos: number;
}

// ============================================================
// 10. ПРЕСЕТЫ
// ============================================================

export interface Preset {
  name: string;
  description: string;
  params: Partial<GenParams>;
  tags: string[];
  thumbnail?: string;
}

// ============================================================
// 11. СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// ============================================================

export interface StudioState {
  // Файлы и профиль
  files: File[];
  profile: StyleProfile | null;
  stage: "idle" | "analyzing" | "ready" | "generating" | "error";
  progress: number;
  error: string | null;
  items: GifItem[];
  
  // Параметры
  count: number;
  size: number;
  genMode: GenMode;
  useProfile: boolean;
  selectedPreset: string | null;
  params: GenParams;
  postEffects: PostEffects;
  
  // UI
  showAdvanced: boolean;
  showColorControl: boolean;
  showEffectsControl: boolean;
}
