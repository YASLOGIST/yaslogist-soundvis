import { describe, expect, it } from "vitest";
import {
  SAFE_CHROMA_SCALE,
  SAFE_FLASH_CEIL,
  SAFE_PUNCH_SCALE,
  SAFE_STROBE_HZ,
  SAFE_STROBE_RATE,
  limitFlash,
  limitPunch,
  limitStrobeRate,
} from "../safety";

describe("flash limiter", () => {
  it("caps drop flash at the safety ceiling when armed", () => {
    expect(limitFlash(3.0, true)).toBe(SAFE_FLASH_CEIL);
    expect(SAFE_FLASH_CEIL).toBeLessThan(2); // the unsafe spike is 3.0
  });

  it("leaves the flash untouched when disarmed", () => {
    expect(limitFlash(3.0, false)).toBe(3.0);
    expect(limitFlash(1.1, false)).toBe(1.1);
  });

  it("never deepens an existing flash when armed", () => {
    expect(limitFlash(1.1, true)).toBe(1.1); // below the ceiling → unchanged
  });
});

describe("punch limiter", () => {
  it("dampens FOV punches when armed", () => {
    const raw = 22 * 1.2; // full-intensity drop punch
    expect(limitPunch(raw, true)).toBeCloseTo(raw * SAFE_PUNCH_SCALE, 6);
    expect(limitPunch(raw, true)).toBeLessThan(9);
  });

  it("is a passthrough when disarmed", () => {
    expect(limitPunch(22, false)).toBe(22);
  });
});

describe("strobe limiter", () => {
  it("expresses the ceiling consistently in Hz and rad/s", () => {
    expect(SAFE_STROBE_RATE).toBeCloseTo(SAFE_STROBE_HZ * Math.PI * 2, 6);
  });

  it("caps the background strobe rate when armed", () => {
    expect(limitStrobeRate(60, true)).toBe(SAFE_STROBE_RATE);
    expect(limitStrobeRate(SAFE_STROBE_RATE / 2, true)).toBe(SAFE_STROBE_RATE / 2);
  });

  it("is a passthrough when disarmed", () => {
    expect(limitStrobeRate(60, false)).toBe(60);
  });

  it("default settings strobe (30 rad/s ≈ 4.8 Hz) exceeds the ceiling and gets capped", () => {
    expect(30 / (Math.PI * 2)).toBeGreaterThan(SAFE_STROBE_HZ);
    expect(limitStrobeRate(30, true)).toBe(SAFE_STROBE_RATE);
  });
});

describe("chroma scale constant", () => {
  it("reduces but does not eliminate chroma flutter", () => {
    expect(SAFE_CHROMA_SCALE).toBeGreaterThan(0);
    expect(SAFE_CHROMA_SCALE).toBeLessThan(1);
  });
});
