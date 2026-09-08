/**
 * Global, mutable, render-loop-friendly state.
 *
 * IMPORTANT: this object is intentionally *outside* of React. The audio thread
 * bridge writes into it, and `useFrame` reads from it and pushes values straight
 * into shader uniforms. No React re-renders happen inside the animation loop.
 */

export type InputMode = "synth" | "mic" | "system" | "file";

export type QualityLevel = "eco" | "balanced" | "ultra" | "godmode";

export interface Palette {
  id: string;
  name: string;
  /** [primary / laser, secondary / depth, highlight / hot-core] */
  hex: [string, string, string];
}

export const PALETTES: Palette[] = [
  { id: "laser", name: "LASER CYAN", hex: ["#00F0FF", "#0B5BFF", "#EAFCFF"] },
  { id: "acid", name: "ACID NEON", hex: ["#00FF66", "#B6FF00", "#EAFFF3"] },
  { id: "uv", name: "ULTRAVIOLET", hex: ["#7B2CBF", "#FF2E97", "#F0E2FF"] },
  { id: "mono", name: "GLITCH WHITE", hex: ["#FFFFFF", "#6E7B85", "#FFFFFF"] },
  { id: "infrared", name: "INFRARED", hex: ["#FF3B00", "#FF8A00", "#FFE7CF"] },
  { id: "toxic", name: "TOXIC MAGENTA", hex: ["#FF00A8", "#8A2BE2", "#FFD6F7"] },
  { id: "solar", name: "SOLAR GOLD", hex: ["#FFC400", "#FF4D00", "#FFF6DB"] },
  { id: "bio", name: "BIOHAZARD", hex: ["#CCFF00", "#00FFC8", "#F8FFE8"] },
  { id: "ice", name: "DEEP ICE", hex: ["#7BDFFF", "#2E5BFF", "#EAF8FF"] },
  { id: "crimson", name: "CRIMSON CHROME", hex: ["#FF0033", "#7A0C1E", "#FFE3E9"] },
  { id: "vapor", name: "NEON VAPOR", hex: ["#FF00FF", "#00FFFF", "#FFB6C1"] },
  { id: "matrix", name: "MATRIX CODE", hex: ["#00FF41", "#008F11", "#FFFFFF"] },
  { id: "cyber", name: "CYBERPUNK", hex: ["#FAFF00", "#FF003C", "#00FFFF"] },
  { id: "akita", name: "AKITA RED", hex: ["#FF0000", "#220000", "#FFFFFF"] },
  { id: "quantum", name: "QUANTUM CORE", hex: ["#4B0082", "#00CED1", "#E6E6FA"] },
  { id: "obsidian", name: "OBSIDIAN CHROME", hex: ["#111115", "#707090", "#D000FF"] },
  { id: "bismuth", name: "BISMUTH CRYSTAL", hex: ["#00F2FE", "#4FACFE", "#FF0844"] },
  { id: "gold", name: "LIQUID GOLD", hex: ["#FFD700", "#B8860B", "#FFFFFF"] },
  { id: "void", name: "VOID MATTER", hex: ["#000000", "#0011FF", "#FF0055"] },
  { id: "neon", name: "NEON PLATINUM", hex: ["#E5E4E2", "#00FFCC", "#FF00FF"] },
];

export const QUALITY_PRESETS: Record<
  QualityLevel,
  { label: string; dpr: [number, number]; marchSteps: number; particles: number }
> = {
  eco: { label: "ECO", dpr: [0.6, 0.9], marchSteps: 44, particles: 42000 },
  balanced: { label: "BALANCED", dpr: [0.85, 1.25], marchSteps: 66, particles: 90000 },
  ultra: { label: "ULTRA", dpr: [1, 2], marchSteps: 92, particles: 160000 },
  godmode: { label: "GODMODE", dpr: [1.25, 2.5], marchSteps: 128, particles: 200000 },
};

export interface AudioFrameState {
  /** 20–120 Hz — kick / sub. Drives scale pulse + camera shake. */
  sub: number;
  /** 120–400 Hz — body of the kick / low synths. */
  bass: number;
  /** 400 Hz–2.5 kHz — synth leads. Drives morph + rotation. */
  mid: number;
  /** 5–16 kHz — hats / tops. Drives bloom spikes + chroma. */
  high: number;
  /** Broadband RMS loudness 0..1 */
  level: number;
  /** Decaying impulse on detected beat (1 → 0). */
  beat: number;
  /** 0..1 how "locked in" the groove feels (beat regularity). */
  groove: number;
  /** Detected tempo. */
  bpm: number;
  /** Monotonic beat counter. */
  beats: number;
  /** Raw FFT magnitudes, normalised 0..1 (512 bins). */
  spectrum: Uint8Array;
  /** Time-domain waveform, normalised -1..1 (1024 samples). */
  waveform: Float32Array;
  /** True when a source is live and producing signal. */
  active: boolean;
  /** Seconds since engine start (audio clock). */
  time: number;
  /** User sensitivity multiplier. */
  sensitivity: number;
  synthBpm: number;
  softening: number;
  /** Beat phase 0..1 within current bar unit */
  beatPhase: number;
  /** Monotonic master beat count with fractional phase */
  masterBeat: number;
}

const BIN_COUNT = 512;
const WAVE_COUNT = 1024;

export const audioState: AudioFrameState = {
  sub: 0,
  bass: 0,
  mid: 0,
  high: 0,
  level: 0,
  beat: 0,
  groove: 0,
  bpm: 0,
  beats: 0,
  spectrum: new Uint8Array(BIN_COUNT),
  waveform: new Float32Array(WAVE_COUNT),
  active: false,
  time: 0,
  sensitivity: 1,
  synthBpm: 132,
  softening: 0.5,
  beatPhase: 0,
  masterBeat: 0,
};

export function resetAudioState() {
  audioState.sub = 0;
  audioState.bass = 0;
  audioState.mid = 0;
  audioState.high = 0;
  audioState.level = 0;
  audioState.beat = 0;
  audioState.groove = 0;
  audioState.bpm = 0;
  audioState.beats = 0;
  audioState.active = false;
  audioState.spectrum.fill(0);
  audioState.waveform.fill(0);
}

/**
 * Direct DOM bridges so the HUD can display live values without a single
 * React re-render per frame.
 */
export const hudBridge: {
  fps: HTMLElement | null;
  ms: HTMLElement | null;
  bpm: HTMLElement | null;
  bars: (HTMLElement | null)[];
  time: HTMLElement | null;
  scope: HTMLCanvasElement | null;
  wave: HTMLCanvasElement | null;
  beat: HTMLElement | null;
} = {
  fps: null,
  ms: null,
  bpm: null,
  bars: [null, null, null, null],
  time: null,
  scope: null,
  wave: null,
  beat: null,
};

/**
 * Render-side registry. Lets the HUD (outside the Canvas) talk to the WebGL
 * layer, and lets the render loop drive DOM/UI without React re-renders.
 */
export const perfBridge: {
  canvas: HTMLCanvasElement | null;
  setPixelRatio: (v: number) => void;
  basePixelRatio: number;
  particleGeometry: BufferGeometryLike | null;
  particleBudget: number;
  /** bumped whenever a layer must re-read the active palette */
  palette: { version: number; index: number };
  /** fired once per 32-beat phrase when AUTO-LOOK is armed */
  onPhrase: ((beats: number) => void) | null;
  /** live governor level, surfaced in the HUD */
  governorLevel: number;
  /** post-processing degradation tier (0 = full, 3 = raw) */
  fxTier: number;
  autoGovernor: boolean;
} = {
  fxTier: 0,
  canvas: null,
  setPixelRatio: () => {},
  basePixelRatio: 1,
  particleGeometry: null,
  particleBudget: 0,
  palette: { version: 0, index: 0 },
  onPhrase: null,
  governorLevel: 0,
  autoGovernor: true,
};

export interface BufferGeometryLike {
  setDrawRange(start: number, count: number): unknown;
}

/** Factory looks — one-tap full aesthetic recall. */
export const LOOK_PRESETS: { id: string; name: string; patch: Partial<VisualSettings> }[] = [
  {
    id: "peak",
    name: "PEAK-TIME",
    patch: {
      palette: 0,
      bloom: 1.5,
      intensity: 1.15,
      glitch: true,
      tunnel: true,
      field: true,
      strobes: true,
      towers: true,
      glow: true,
    },
  },
  {
    id: "warehouse",
    name: "WAREHOUSE",
    patch: {
      palette: 3,
      bloom: 0.95,
      intensity: 0.7,
      glitch: true,
      tunnel: true,
      field: true,
      strobes: true,
      towers: true,
      glow: false,
    },
  },
  {
    id: "acid",
    name: "ACID ROOM",
    patch: {
      palette: 1,
      bloom: 1.75,
      intensity: 1.4,
      glitch: false,
      tunnel: true,
      field: true,
      strobes: true,
      towers: true,
      glow: true,
    },
  },
  {
    id: "after",
    name: "AFTERGLOW",
    patch: {
      palette: 2,
      bloom: 2.1,
      intensity: 0.55,
      glitch: false,
      tunnel: true,
      field: true,
      strobes: false,
      towers: false,
      glow: true,
    },
  },
  {
    id: "reactor",
    name: "REACTOR",
    patch: {
      palette: 4,
      bloom: 1.65,
      intensity: 1.3,
      glitch: true,
      tunnel: true,
      field: true,
      strobes: true,
      towers: true,
      glow: true,
    },
  },
  {
    id: "ice",
    name: "CRYO",
    patch: {
      palette: 8,
      bloom: 1.8,
      intensity: 0.9,
      glitch: false,
      tunnel: true,
      field: true,
      strobes: true,
      towers: false,
      glow: true,
    },
  },
];

export const SETTINGS_KEY = "yaslogist.settings.v1";
/** Pre-rebrand storage key — migrated transparently on load. */
const LEGACY_SETTINGS_KEY = "void-reactor.settings.v1";

/**
 * Fault-tolerant JSON serialisation. Cyclic structures (WebGL objects, DOM
 * nodes, THREE geometries) are replaced with a type tag instead of throwing.
 */
export function safeStringify(value: unknown, fallback = "{}"): string {
  try {
    const out = JSON.stringify(value, (_key, val) =>
      typeof val === "object" &&
      val !== null &&
      !Array.isArray(val) &&
      Object.getPrototypeOf(val) !== Object.prototype
        ? `[${(val as object).constructor?.name ?? "object"}]`
        : val,
    );
    return typeof out === "string" ? out : fallback;
  } catch {
    return fallback;
  }
}

// QUALITY_KEYS removed as it's no longer used

/** Inclusive [min, max] sanitisation range per numeric settings field. */
const NUMERIC_RANGES: Record<string, [min: number, max: number]> = {
  palette: [0, PALETTES.length - 1],
  sensitivity: [0.1, 3],
  bloom: [0, 2.5],
  bloomThreshold: [0, 1],
  gamma: [0.5, 3],
  uiContrast: [0.2, 1],
  crystallineGlitch: [0, 3],
  intensity: [0, 1.5],
  trails: [0, 0.99],
  particleSize: [0.1, 5],
  strobeSpeed: [5, 60],
  softening: [0, 1],
  shake: [0, 3],
  speed: [0.1, 3],
  fov: [50, 130],
  aberration: [0, 3],
  flux: [0, 3],
  coreSize: [0.5, 2.5],
  colorShift: [0, 2],
  noiseLevel: [0, 3],
  shape: [0, 11],
  particles: [
    Math.min(...Object.values(QUALITY_PRESETS).map((q) => q.particles)),
    Math.max(...Object.values(QUALITY_PRESETS).map((q) => q.particles)),
  ],
};

/** Numeric fields that must land on whole numbers. */
const INTEGER_FIELDS: ReadonlySet<string> = new Set(["palette", "shape", "particles"]);

/** Allowed values per enum settings field. */
const ENUM_VALUES: Record<string, readonly string[]> = {
  quality: Object.keys(QUALITY_PRESETS),
  audioProfile: ["smooth", "standard", "dynamic", "hyper"],
  bloomProfile: ["soft", "hard", "laser"],
};

/**
 * Coerce arbitrary input (corrupted localStorage, imported JSON, shared links)
 * into a fully valid `VisualSettings`. Every field is validated against its
 * declarative spec — unknown keys are dropped, bad values fall back to
 * defaults, numbers are clamped to their documented ranges.
 */
export function sanitizeSettings(raw: unknown): VisualSettings {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: VisualSettings = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof VisualSettings)[]) {
    const value = src[key];
    const fallback = DEFAULT_SETTINGS[key];

    if (typeof fallback === "number") {
      let next = typeof value === "number" && Number.isFinite(value) ? value : fallback;
      if (INTEGER_FIELDS.has(key)) next = Math.round(next);
      const [min, max] = NUMERIC_RANGES[key] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
      (out as unknown as Record<string, number>)[key] = Math.min(max, Math.max(min, next));
    } else if (typeof fallback === "boolean") {
      if (typeof value === "boolean") (out as unknown as Record<string, boolean>)[key] = value;
    } else {
      const allowed = ENUM_VALUES[key];
      if (allowed && typeof value === "string" && allowed.includes(value)) {
        (out as unknown as Record<string, string>)[key] = value;
      }
    }
  }
  return out;
}

export function loadSettings(): VisualSettings {
  try {
    let saved = localStorage.getItem(SETTINGS_KEY);
    if (saved === null) {
      // one-time migration from the pre-rebrand key
      const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY);
      if (legacy !== null) {
        localStorage.setItem(SETTINGS_KEY, legacy);
        localStorage.removeItem(LEGACY_SETTINGS_KEY);
        saved = legacy;
      }
    }
    if (!saved) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(saved));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: VisualSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, safeStringify(s, "{}"));
  } catch {
    /* storage disabled or sandboxed iframe — non fatal */
  }
}

export interface VisualSettings {
  palette: number;
  quality: QualityLevel;
  /** input gain multiplier fed into the analysis chain */
  sensitivity: number;
  /** bloom energy 0..2 */
  bloom: number;
  /** morphing factor */
  intensity: number;
  /** motion blur/trail amount 0..1 */
  trails: number;
  /** camera shake amount */
  shake: number;
  /** global animation speed multiplier 0.1..3 */
  speed: number;
  /** camera field of view 50..130 */
  fov: number;
  /** chromatic aberration intensity 0..3 */
  aberration: number;
  /** energy flux intensity 0..3 */
  flux: number;
  /** core scale 0.5..2.5 */
  coreSize: number;
  /** color hue shift speed 0..2 */
  colorShift: number;
  /** post-processing noise level 0..3 */
  noiseLevel: number;
  /** particle budget */
  particles: number;
  /** base geometry shape index 0..5 */
  shape: number;
  /** liquid metal vertex displacement */
  liquid: boolean;
  glitch: boolean;
  tunnel: boolean;
  field: boolean;
  strobes: boolean;
  /** core wireframe */
  wireframe: boolean;
  /** laser fan */
  laser: boolean;
  /** high-tech orbital data rings */
  rings: boolean;
  /** floating monolithic obelisks */
  obelisks: boolean;
  /** Audio reactivity profile */
  audioProfile: "smooth" | "standard" | "dynamic" | "hyper";
  /** temporal low-pass filter (0 = aggressive, 1 = smooth) */
  softening: number;
  /** Bloom profile */
  bloomProfile: "soft" | "hard" | "laser";
  /** Auto hide UI after 5s */
  autoHideUi: boolean;
  /** zen mode hides all UI except minimal overlay */
  zenMode: boolean;
  /** energy flux lightning */
  energyFlux: boolean;
  /** swirling quantum vortex */
  vortex: boolean;
  /** cyber floor grid */
  grid: boolean;
  /** magnetic particles */
  magnetic: boolean;
  /** god rays */
  rays: boolean;
  /** strobe background */
  strobeMode: boolean;
  /** strobe pulse speed */
  strobeSpeed: number;
  /** particle size */
  particleSize: number;
  /** adapt resolution / march steps / draw-range to hold 60 fps */
  autoPerf: boolean;
  /** advance the palette once per 32-beat phrase */
  autoLook: boolean;
  /** circular FFT metering ring of glowing bars */
  towers: boolean;
  /** core halo + anamorphic flare + kick shockwave */
  glow: boolean;
  /** minimum luminance threshold for bloom activation 0..1 */
  bloomThreshold: number;
  /** gamma correction brightness response curve 0.5..2.5 */
  gamma: number;
  /** HUD opacity and blur contrast modifier 0.2..1.0 */
  uiContrast: number;
  /** Master clock central beat phase synchronization */
  masterClock: boolean;
  /** Crystalline glitch chromatic aberration multiplier 0..3 */
  crystallineGlitch: number;
  /** Quantum portal counter-rotating torus rings */
  quantumPortal: boolean;
  /** Neural synapses bass-triggered line bursts */
  neuralSynapses: boolean;
}

export const DEFAULT_SETTINGS: VisualSettings = {
  palette: 0,
  quality: "balanced",
  sensitivity: 1.25,
  bloom: 1.0,
  bloomThreshold: 0.15,
  gamma: 1.0,
  uiContrast: 0.8,
  masterClock: true,
  crystallineGlitch: 0,
  quantumPortal: true,
  neuralSynapses: true,
  intensity: 1.0,
  trails: 0.15,
  shake: 1.0,
  speed: 0.7,
  fov: 74,
  aberration: 1,
  flux: 1,
  coreSize: 1,
  colorShift: 0,
  noiseLevel: 1,
  shape: 0,
  liquid: false,
  particles: QUALITY_PRESETS.balanced.particles,
  glitch: true,
  tunnel: true,
  field: true,
  strobes: true,
  wireframe: true,
  laser: true,
  rings: true,
  obelisks: true,
  audioProfile: "hyper",
  softening: 0.5,
  bloomProfile: "soft",
  autoHideUi: false,
  zenMode: false,
  energyFlux: true,
  vortex: true,
  grid: true,
  magnetic: false,
  rays: true,
  strobeMode: false,
  strobeSpeed: 30.0,
  particleSize: 1.5,
  towers: true,
  glow: true,
  autoPerf: true,
  autoLook: false,
};

export const clamp = (v: number, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
