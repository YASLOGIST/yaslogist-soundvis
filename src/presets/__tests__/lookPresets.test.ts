import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, PALETTES } from "../../audio/state";
import {
  LOOK_FIELDS,
  PRESET_SLOTS,
  applyLook,
  buildShareUrl,
  clearBankSlot,
  decodeLook,
  encodeLook,
  extractLook,
  loadBank,
  parseLook,
  readLookFromLocation,
  saveBankSlot,
  serializeLook,
  type LookPreset,
} from "../lookPresets";
import { installStorage } from "../../test/helpers";

function makePreset(overrides: Partial<LookPreset["settings"]> = {}): LookPreset {
  return extractLook("TEST LOOK", {
    ...DEFAULT_SETTINGS,
    palette: 3,
    shape: 5,
    bloom: 2.2,
    glitch: false,
    ...overrides,
  });
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractLook / applyLook", () => {
  it("captures exactly the declared look fields and nothing else", () => {
    const preset = makePreset();
    expect(Object.keys(preset.settings).sort()).toEqual([...LOOK_FIELDS].sort());
    // hardware + operator preferences must never ride inside a look
    expect("quality" in preset.settings).toBe(false);
    expect("particles" in preset.settings).toBe(false);
    expect("autoPerf" in preset.settings).toBe(false);
    expect("zenMode" in preset.settings).toBe(false);
    expect("uiContrast" in preset.settings).toBe(false);
  });

  it("round-trips aesthetic values through apply", () => {
    const applied = applyLook(makePreset());
    expect(applied.palette).toBe(3);
    expect(applied.shape).toBe(5);
    expect(applied.bloom).toBe(2.2);
    expect(applied.glitch).toBe(false);
    // non-look fields stay untouched (absent from the patch)
    expect("quality" in applied).toBe(false);
  });

  it("falls back to a default name for blank names", () => {
    expect(extractLook("   ", DEFAULT_SETTINGS).name).toBe("UNTITLED LOOK");
  });

  it("truncates absurdly long names", () => {
    expect(extractLook("x".repeat(500), DEFAULT_SETTINGS).name).toHaveLength(40);
  });
});

describe("parseLook", () => {
  it("round-trips through serialize → parse", () => {
    const original = makePreset();
    const parsed = parseLook(JSON.parse(serializeLook(original)));
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe("TEST LOOK");
    expect(parsed?.settings).toEqual(original.settings);
  });

  it("rejects junk", () => {
    expect(parseLook(null)).toBeNull();
    expect(parseLook("nope")).toBeNull();
    expect(parseLook(42)).toBeNull();
    expect(parseLook({})).toBeNull();
    expect(parseLook({ version: 2, settings: {} })).toBeNull(); // future version
    expect(parseLook({ version: 1 })).toBeNull(); // missing settings
  });

  it("sanitizes hostile or corrupt settings payloads", () => {
    const parsed = parseLook({
      version: 1,
      name: "EVIL",
      settings: { bloom: 9999, palette: -40, quality: "godmode", injected: "x", liquid: "maybe" },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.settings.bloom).toBeLessThanOrEqual(2.5);
    expect(parsed?.settings.palette).toBe(0);
    expect("injected" in (parsed?.settings as object)).toBe(false);
  });

  it("keeps only known look fields even if extras are smuggled in", () => {
    const parsed = parseLook({
      version: 1,
      name: "X",
      settings: { quality: "godmode", particles: 999999, bloom: 1 },
    });
    expect(parsed?.settings).toEqual({ ...parsed?.settings, bloom: 1 });
    expect("quality" in (parsed?.settings as object)).toBe(false);
    expect("particles" in (parsed?.settings as object)).toBe(false);
  });
});

describe("share-link transport (base64url)", () => {
  it("encode → decode round-trips a preset", () => {
    const original = makePreset({ palette: 7, trails: 0.42 });
    const decoded = decodeLook(encodeLook(original));
    expect(decoded).not.toBeNull();
    expect(decoded?.name).toBe(original.name);
    expect(decoded?.settings).toEqual(original.settings);
  });

  it("produces URL-safe output without padding", () => {
    const encoded = encodeLook(makePreset());
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
  });

  it("returns null for corrupt payloads", () => {
    expect(decodeLook("!!!not-base64!!!")).toBeNull();
    expect(decodeLook("")).toBeNull();
    const validBase64 = encodeLook(makePreset());
    expect(decodeLook(validBase64.slice(0, -4))).toBeNull(); // truncated
  });

  it("builds a share URL with a #look= hash", () => {
    const url = buildShareUrl(makePreset());
    expect(url).toContain("#look=");
  });

  it("reads a look back from a real location hash", () => {
    const original = makePreset({ bloom: 1.9 });
    vi.stubGlobal("location", {
      hash: `#look=${encodeLook(original)}`,
      href: "https://x.test/",
      origin: "https://x.test",
      pathname: "/",
    });
    const read = readLookFromLocation();
    expect(read?.settings.bloom).toBe(1.9);
    vi.unstubAllGlobals();
  });

  it("returns null when the hash holds something else", () => {
    vi.stubGlobal("location", { hash: "#section-top", href: "https://x.test/" });
    expect(readLookFromLocation()).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("live preset bank", () => {
  it("starts empty with the right slot count", () => {
    const bank = loadBank();
    expect(bank).toHaveLength(PRESET_SLOTS);
    expect(bank.every((slot) => slot === null)).toBe(true);
  });

  it("stores, lists and clears slots", () => {
    saveBankSlot(2, makePreset({ palette: 6 }));
    saveBankSlot(7, makePreset({ palette: 1 }));

    let bank = loadBank();
    expect(bank[2]?.settings.palette).toBe(6);
    expect(bank[7]?.settings.palette).toBe(1);
    expect(bank[0]).toBeNull();

    clearBankSlot(2);
    bank = loadBank();
    expect(bank[2]).toBeNull();
    expect(bank[7]?.settings.palette).toBe(1);
  });

  it("ignores out-of-range slot indexes", () => {
    saveBankSlot(-1, makePreset());
    saveBankSlot(99, makePreset());
    expect(loadBank().every((slot) => slot === null)).toBe(true);
  });

  it("survives corrupted bank storage", () => {
    saveBankSlot(0, makePreset());
    localStorage.setItem("yaslogist.lookbank.v1", "{{{broken");
    expect(loadBank().every((slot) => slot === null)).toBe(true);

    localStorage.setItem("yaslogist.lookbank.v1", JSON.stringify(["not-a-preset", 42]));
    const bank = loadBank();
    expect(bank).toHaveLength(PRESET_SLOTS);
    expect(bank.every((slot) => slot === null)).toBe(true);
  });

  it("slot recall survives the schema: unknown stored shapes are rejected", () => {
    localStorage.setItem(
      "yaslogist.lookbank.v1",
      JSON.stringify([{ version: 1, name: "OK", settings: { palette: PALETTES.length - 1, bloom: 2 } }]),
    );
    const bank = loadBank();
    expect(bank[0]?.name).toBe("OK");
    expect(bank[0]?.settings.palette).toBe(PALETTES.length - 1);
    expect(bank[0]?.settings.bloom).toBe(2);
  });
});
