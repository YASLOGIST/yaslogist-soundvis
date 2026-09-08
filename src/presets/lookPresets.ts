/**
 * Look Preset System
 * ──────────────────
 * Save / recall / share complete visual "looks" as portable JSON.
 *
 * A look captures every *aesthetic* field of `VisualSettings` while
 * deliberately excluding hardware-dependent budgets (quality, particles,
 * auto-perf) and operator UI preferences (zen, auto-hide, HUD contrast) so a
 * shared preset never breaks someone else's machine or workflow.
 *
 * Transport formats:
 *  • `.json` files   — export / import via the dock (serializeLook / parseLook)
 *  • base64url hash  — shareable URLs, `#look=…` (encodeLook / decodeLook)
 *  • localStorage    — 8-slot live bank for hot-switching during sets
 */

import { DEFAULT_SETTINGS, sanitizeSettings, type VisualSettings } from "../audio/state";

export const PRESET_VERSION = 1;
export const PRESET_SLOTS = 8;
const BANK_KEY = "yaslogist.lookbank.v1";
const MAX_NAME_LENGTH = 40;

/** Aesthetic fields captured by a look preset. */
export const LOOK_FIELDS = [
  // core look
  "palette",
  "shape",
  "liquid",
  // post-processing
  "bloom",
  "bloomProfile",
  "bloomThreshold",
  "gamma",
  "noiseLevel",
  "aberration",
  "crystallineGlitch",
  // motion & dynamics
  "intensity",
  "trails",
  "speed",
  "shake",
  "fov",
  "coreSize",
  "colorShift",
  "flux",
  "particleSize",
  "strobes",
  "strobeMode",
  "strobeSpeed",
  "softening",
  "audioProfile",
  // scene layers
  "quantumPortal",
  "neuralSynapses",
  "glitch",
  "tunnel",
  "field",
  "wireframe",
  "laser",
  "rings",
  "obelisks",
  "energyFlux",
  "vortex",
  "grid",
  "magnetic",
  "rays",
  "towers",
  "glow",
] as const satisfies readonly (keyof VisualSettings)[];

export type LookSettings = Pick<VisualSettings, (typeof LOOK_FIELDS)[number]>;

export interface LookPreset {
  /** Schema version for forward-compatible migrations. */
  version: number;
  name: string;
  /** ISO-8601 creation stamp. */
  created: string;
  settings: LookSettings;
}

/* ── extract / apply ────────────────────────────────────────────────────── */

export function extractLook(name: string, settings: VisualSettings): LookPreset {
  const src = settings as unknown as Record<string, unknown>;
  const picked = {} as Record<string, unknown>;
  for (const field of LOOK_FIELDS) picked[field] = src[field];
  return {
    version: PRESET_VERSION,
    name: normalizeName(name),
    created: new Date().toISOString(),
    settings: picked as LookSettings,
  };
}

/** Sanitised, ready-to-`patch` subset of a preset's settings (sparse — only look fields). */
export function applyLook(preset: LookPreset): Partial<VisualSettings> {
  const clean = sanitizeSettings({ ...DEFAULT_SETTINGS, ...preset.settings }) as unknown as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = {};
  for (const field of LOOK_FIELDS) out[field] = clean[field];
  return out as Partial<VisualSettings>;
}

/* ── validation ─────────────────────────────────────────────────────────── */

function normalizeName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().slice(0, MAX_NAME_LENGTH) : "";
  return name.length > 0 ? name : "UNTITLED LOOK";
}

/** Validate arbitrary parsed JSON into a `LookPreset`, or `null` if unusable. */
export function parseLook(json: unknown): LookPreset | null {
  if (!json || typeof json !== "object") return null;
  const src = json as Record<string, unknown>;
  if (src.version !== PRESET_VERSION) return null;
  if (typeof src.settings !== "object" || src.settings === null) return null;

  // Sanitise through the full settings pipeline, then keep only look fields —
  // this rejects junk values and hostile keys in one pass.
  const clean = sanitizeSettings({ ...DEFAULT_SETTINGS, ...(src.settings as object) });
  const settings = {} as Record<string, unknown>;
  for (const field of LOOK_FIELDS) settings[field] = (clean as unknown as Record<string, unknown>)[field];

  const created = typeof src.created === "string" ? src.created : new Date(0).toISOString();
  return {
    version: PRESET_VERSION,
    name: normalizeName(src.name),
    created,
    settings: settings as LookSettings,
  };
}

export function serializeLook(preset: LookPreset): string {
  return JSON.stringify(preset, null, 2);
}

/* ── share-link (base64url) transport ───────────────────────────────────── */

const HASH_PREFIX = "#look=";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function encodeLook(preset: LookPreset): string {
  const json = JSON.stringify(preset);
  return toBase64Url(new TextEncoder().encode(json));
}

export function decodeLook(encoded: string): LookPreset | null {
  const bytes = fromBase64Url(encoded.trim());
  if (!bytes) return null;
  try {
    return parseLook(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** Build a full shareable URL (or bare `#…` when no page URL is available). */
export function buildShareUrl(preset: LookPreset): string {
  const hash = `${HASH_PREFIX}${encodeLook(preset)}`;
  try {
    if (typeof location !== "undefined" && location.href && !location.href.startsWith("about:")) {
      return `${location.origin}${location.pathname}${hash}`;
    }
  } catch {
    /* opaque origin — fall through */
  }
  return hash;
}

/** Read a look preset from the current URL hash, if present. */
export function readLookFromLocation(): LookPreset | null {
  try {
    const hash = typeof location !== "undefined" ? location.hash : "";
    if (!hash.startsWith(HASH_PREFIX)) return null;
    return decodeLook(decodeURIComponent(hash.slice(HASH_PREFIX.length)));
  } catch {
    return null;
  }
}

/* ── live bank (8 localStorage slots) ───────────────────────────────────── */

export function loadBank(): (LookPreset | null)[] {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    if (!raw) return emptyBank();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return emptyBank();
    return Array.from({ length: PRESET_SLOTS }, (_, i) => parseLook(parsed[i]));
  } catch {
    return emptyBank();
  }
}

export function saveBankSlot(index: number, preset: LookPreset): void {
  if (index < 0 || index >= PRESET_SLOTS) return;
  try {
    const bank = loadBank();
    bank[index] = preset;
    localStorage.setItem(BANK_KEY, JSON.stringify(bank));
  } catch {
    /* storage disabled — non fatal */
  }
}

export function clearBankSlot(index: number): void {
  if (index < 0 || index >= PRESET_SLOTS) return;
  try {
    const bank = loadBank();
    bank[index] = null;
    localStorage.setItem(BANK_KEY, JSON.stringify(bank));
  } catch {
    /* storage disabled — non fatal */
  }
}

function emptyBank(): (LookPreset | null)[] {
  return Array.from({ length: PRESET_SLOTS }, () => null);
}
