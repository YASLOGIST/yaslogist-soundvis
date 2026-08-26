/**
 * Global, mutable, render-loop-friendly state.
 *
 * IMPORTANT: this object is intentionally *outside* of React. The audio thread
 * bridge writes into it, and `useFrame` reads from it and pushes values straight
 * into shader uniforms. No React re-renders happen inside the animation loop.
 */

export type InputMode = "synth" | "mic" | "system" | "file";

export type QualityLevel = "eco" | "balanced" | "ultra";

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
];

export const QUALITY_PRESETS: Record<
  QualityLevel,
  { label: string; dpr: [number, number]; marchSteps: number; particles: number }
> = {
  eco: { label: "ECO", dpr: [0.6, 0.9], marchSteps: 44, particles: 42000 },
  balanced: { label: "BALANCED", dpr: [0.85, 1.25], marchSteps: 66, particles: 90000 },
  ultra: { label: "ULTRA", dpr: [1, 2], marchSteps: 92, particles: 160000 },
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
    patch: { palette: 0, bloom: 1.5, intensity: 1.15, glitch: true, tunnel: true, field: true, strobes: true, towers: true, glow: true },
  },
  {
    id: "warehouse",
    name: "WAREHOUSE",
    patch: { palette: 3, bloom: 0.95, intensity: 0.7, glitch: true, tunnel: true, field: true, strobes: true, towers: true, glow: false },
  },
  {
    id: "acid",
    name: "ACID ROOM",
    patch: { palette: 1, bloom: 1.75, intensity: 1.4, glitch: false, tunnel: true, field: true, strobes: true, towers: true, glow: true },
  },
  {
    id: "after",
    name: "AFTERGLOW",
    patch: { palette: 2, bloom: 2.1, intensity: 0.55, glitch: false, tunnel: true, field: true, strobes: false, towers: false, glow: true },
  },
  {
    id: "reactor",
    name: "REACTOR",
    patch: { palette: 4, bloom: 1.65, intensity: 1.3, glitch: true, tunnel: true, field: true, strobes: true, towers: true, glow: true },
  },
  {
    id: "ice",
    name: "CRYO",
    patch: { palette: 8, bloom: 1.8, intensity: 0.9, glitch: false, tunnel: true, field: true, strobes: true, towers: false, glow: true },
  },
];

export const SETTINGS_KEY = "void-reactor.settings.v1";

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

const QUALITY_KEYS: QualityLevel[] = ["eco", "balanced", "ultra"];

export function loadSettings(fallback: VisualSettings): VisualSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<VisualSettings>;
    const merged: VisualSettings = { ...fallback, ...parsed };
    // defensive: never trust persisted shapes
    if (!QUALITY_KEYS.includes(merged.quality)) merged.quality = fallback.quality;
    if (!Number.isFinite(merged.particles)) merged.particles = fallback.particles;
    merged.particles = Math.min(200000, Math.max(10000, Math.round(merged.particles)));
    merged.palette = Math.abs(Math.round(merged.palette)) % PALETTES.length;
    merged.sensitivity = Math.min(3, Math.max(0.2, merged.sensitivity));
    merged.bloom = Math.min(2.5, Math.max(0, merged.bloom));
    merged.intensity = Math.min(1.5, Math.max(0, merged.intensity));
    return merged;
  } catch {
    return fallback;
  }
}

export function saveSettings(s: VisualSettings) {
  try {
    // safeStringify can never throw — even on cyclic or exotic values
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
  /** morph / warp aggression 0..1.5 */
  intensity: number;
  /** particle budget */
  particles: number;
  glitch: boolean;
  tunnel: boolean;
  field: boolean;
  strobes: boolean;
  /** adapt resolution / march steps / draw-range to hold 60 fps */
  autoPerf: boolean;
  /** advance the palette once per 32-beat phrase */
  autoLook: boolean;
  /** circular FFT metering ring of glowing bars */
  towers: boolean;
  /** core halo + anamorphic flare + kick shockwave */
  glow: boolean;
}

export const DEFAULT_SETTINGS: VisualSettings = {
  palette: 0,
  quality: "balanced",
  sensitivity: 1.25,
  bloom: 1.15,
  intensity: 1,
  particles: QUALITY_PRESETS.balanced.particles,
  glitch: true,
  tunnel: true,
  field: true,
  strobes: true,
  towers: true,
  glow: true,
  autoPerf: true,
  autoLook: false,
};

export const clamp = (v: number, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
