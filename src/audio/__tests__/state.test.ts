import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  PALETTES,
  QUALITY_PRESETS,
  SETTINGS_KEY,
  clamp,
  loadSettings,
  lerp,
  sanitizeSettings,
  saveSettings,
  type VisualSettings,
} from "../state";
const LEGACY_SETTINGS_KEY = "void-reactor.settings.v1";
import { installStorage } from "../../test/helpers";

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("math helpers", () => {
  it("clamps values into range", () => {
    expect(clamp(1.4)).toBe(1);
    expect(clamp(-0.2)).toBe(0);
    expect(clamp(0.5)).toBe(0.5);
    expect(clamp(10, 0, 5)).toBe(5);
  });

  it("lerps linearly", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(2, 6, 0)).toBe(2);
    expect(lerp(2, 6, 1)).toBe(6);
  });
});

describe("sanitizeSettings", () => {
  it("returns defaults for garbage input", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("hack")).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("accepts a fully valid settings object unchanged", () => {
    const valid: VisualSettings = { ...DEFAULT_SETTINGS };
    expect(sanitizeSettings(valid)).toEqual(valid);
  });

  it("drops unknown keys instead of passing them through", () => {
    const out = sanitizeSettings({ ...DEFAULT_SETTINGS, injected: "<script>" }) as unknown as Record<
      string,
      unknown
    >;
    expect("injected" in out).toBe(false);
  });

  it("clamps numbers to their documented ranges", () => {
    const out = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      bloom: 99,
      sensitivity: -5,
      fov: 999,
      trails: 2,
      palette: 999,
      shape: -20,
      particles: 10_000_000,
    });
    expect(out.bloom).toBe(2.5);
    expect(out.sensitivity).toBe(0.1);
    expect(out.fov).toBe(130);
    expect(out.trails).toBe(0.99);
    expect(out.palette).toBe(PALETTES.length - 1);
    expect(out.shape).toBe(0);
    expect(out.particles).toBe(Math.max(...Object.values(QUALITY_PRESETS).map((q) => q.particles)));
  });

  it("rounds integer fields", () => {
    const out = sanitizeSettings({ ...DEFAULT_SETTINGS, palette: 3.7, shape: 1.2 });
    expect(out.palette).toBe(4);
    expect(out.shape).toBe(1);
  });

  it("rejects non-finite numbers", () => {
    const out = sanitizeSettings({ ...DEFAULT_SETTINGS, bloom: Number.NaN, speed: Number.POSITIVE_INFINITY });
    expect(out.bloom).toBe(DEFAULT_SETTINGS.bloom);
    expect(out.speed).toBe(DEFAULT_SETTINGS.speed);
  });

  it("rejects type-mismatched values instead of coercing strings", () => {
    const out = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      bloom: "1.5",
      glitch: "yes",
      masterClock: 1,
      quality: 3,
    });
    expect(out.bloom).toBe(DEFAULT_SETTINGS.bloom);
    expect(out.glitch).toBe(DEFAULT_SETTINGS.glitch);
    expect(out.masterClock).toBe(DEFAULT_SETTINGS.masterClock);
    expect(out.quality).toBe(DEFAULT_SETTINGS.quality);
  });

  it("validates enum fields against their allowed sets", () => {
    const bad = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      quality: "bogus",
      audioProfile: "extreme",
      bloomProfile: "plaid",
    });
    expect(bad.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(bad.audioProfile).toBe(DEFAULT_SETTINGS.audioProfile);
    expect(bad.bloomProfile).toBe(DEFAULT_SETTINGS.bloomProfile);

    const good = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      quality: "godmode",
      audioProfile: "dynamic",
      bloomProfile: "laser",
    });
    expect(good.quality).toBe("godmode");
    expect(good.audioProfile).toBe("dynamic");
    expect(good.bloomProfile).toBe("laser");
  });

  it("keeps valid boolean fields", () => {
    const out = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      glitch: false,
      zenMode: true,
      neuralSynapses: false,
    });
    expect(out.glitch).toBe(false);
    expect(out.zenMode).toBe(true);
    expect(out.neuralSynapses).toBe(false);
  });
});

describe("loadSettings / saveSettings", () => {
  it("returns defaults when storage is empty", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists and restores settings", () => {
    saveSettings({ ...DEFAULT_SETTINGS, palette: 5, bloom: 1.75 });
    const restored = loadSettings();
    expect(restored.palette).toBe(5);
    expect(restored.bloom).toBe(1.75);
  });

  it("sanitizes corrupted storage contents", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ bloom: "explode", palette: 9999 }));
    const restored = loadSettings();
    expect(restored.bloom).toBe(DEFAULT_SETTINGS.bloom);
    expect(restored.palette).toBe(PALETTES.length - 1);
    // everything unspecified falls back to defaults
    expect(restored.speed).toBe(DEFAULT_SETTINGS.speed);
  });

  it("migrates the pre-rebrand storage key transparently", () => {
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify({ palette: 4, glitch: false }));
    const restored = loadSettings();
    expect(restored.palette).toBe(4);
    expect(restored.glitch).toBe(false);
    // migrated forward, legacy entry retired
    expect(localStorage.getItem(SETTINGS_KEY)).not.toBeNull();
    expect(localStorage.getItem(LEGACY_SETTINGS_KEY)).toBeNull();
  });

  it("survives invalid JSON in storage", () => {
    localStorage.setItem(SETTINGS_KEY, "{not json!!");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
