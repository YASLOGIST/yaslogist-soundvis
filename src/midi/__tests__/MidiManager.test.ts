import { describe, expect, it } from "vitest";
import { DEFAULT_CC_MAP, DEFAULT_PAD_MAP, scaleCc, type MidiAction } from "../MidiManager";
import { DEFAULT_SETTINGS, SETTING_RANGES, type VisualSettings } from "../../audio/state";

describe("DEFAULT_CC_MAP", () => {
  it("maps eight unique controllers to numeric settings", () => {
    expect(DEFAULT_CC_MAP).toHaveLength(8);
    const ccs = DEFAULT_CC_MAP.map(([cc]) => cc);
    expect(new Set(ccs).size).toBe(8);
    for (const [, key] of DEFAULT_CC_MAP) {
      expect(typeof DEFAULT_SETTINGS[key]).toBe("number");
      expect(SETTING_RANGES[key]).toBeDefined();
    }
  });

  it("uses the 20-27 macro row so it never fights common CCs (mod-wheel etc.)", () => {
    for (const [cc] of DEFAULT_CC_MAP) {
      expect(cc).toBeGreaterThanOrEqual(20);
      expect(cc).toBeLessThanOrEqual(27);
    }
  });
});

describe("scaleCc", () => {
  it("maps 0..127 onto each setting's sanitised range", () => {
    for (const [, key] of DEFAULT_CC_MAP) {
      const [min, max] = SETTING_RANGES[key];
      expect(scaleCc(key, 0)).toBeCloseTo(min, 5);
      expect(scaleCc(key, 127)).toBeCloseTo(max, 5);
      expect(scaleCc(key, 64)).toBeGreaterThanOrEqual(min);
      expect(scaleCc(key, 64)).toBeLessThanOrEqual(max);
    }
  });

  it("clamps out-of-range raw values instead of throwing", () => {
    expect(scaleCc("bloom", -5)).toBeCloseTo(SETTING_RANGES.bloom[0], 5);
    expect(scaleCc("bloom", 999)).toBeCloseTo(SETTING_RANGES.bloom[1], 5);
  });
});

describe("DEFAULT_PAD_MAP", () => {
  it("assigns unique notes to all 8 preset slots plus core actions", () => {
    const notes = DEFAULT_PAD_MAP.map(([note]) => note);
    expect(new Set(notes).size).toBe(notes.length);
    const slots = DEFAULT_PAD_MAP.filter(([, a]) => typeof a === "object") as [
      number,
      { presetSlot: number },
    ][];
    expect(slots).toHaveLength(8);
    expect(slots.map(([, a]) => a.presetSlot).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const actions = new Set(DEFAULT_PAD_MAP.filter(([, a]) => typeof a === "string").map(([, a]) => a));
    expect(actions).toEqual(new Set<MidiAction>(["paletteNext", "palettePrev", "zenToggle", "safeToggle"]));
  });

  it("keeps pads inside the classic 36-47 controller row", () => {
    for (const [note] of DEFAULT_PAD_MAP) {
      expect(note).toBeGreaterThanOrEqual(36);
      expect(note).toBeLessThanOrEqual(47);
    }
  });
});

describe("setting ranges sanity", () => {
  it("every MIDI-macro field has a valid ascending range", () => {
    for (const [, key] of DEFAULT_CC_MAP) {
      const [min, max] = SETTING_RANGES[key];
      expect(min).toBeLessThan(max);
      expect(Number.isFinite(min)).toBe(true);
      expect(Number.isFinite(max)).toBe(true);
    }
  });

  it("safe mode participates in settings defaults as a boolean", () => {
    const key: keyof VisualSettings = "safeMode";
    expect(typeof DEFAULT_SETTINGS[key]).toBe("boolean");
  });
});
