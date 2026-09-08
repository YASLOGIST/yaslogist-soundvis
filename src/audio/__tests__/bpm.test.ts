import { describe, expect, it } from "vitest";
import { advanceBeatClock, estimateBpm, foldBpm, median, MIN_INTERVALS } from "../bpm";

/** Build perfect inter-beat intervals for a given BPM. */
function intervalsFor(bpm: number, count = 10): number[] {
  return Array.from({ length: count }, () => 60 / bpm);
}

describe("median", () => {
  it("handles odd and even lengths without mutating input", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    const input = [5, 2, 8];
    median(input);
    expect(input).toEqual([5, 2, 8]);
  });
});

describe("foldBpm", () => {
  it("folds into the 70-180 octave", () => {
    expect(foldBpm(320)).toBe(160); // double-time hats → halve
    expect(foldBpm(65)).toBe(130); // half-time feel → double
    expect(foldBpm(128)).toBe(128); // already inside
    expect(foldBpm(700)).toBeCloseTo(175, 5); // multiple folds
  });
});

describe("estimateBpm", () => {
  it("returns null without enough data", () => {
    expect(estimateBpm([])).toBeNull();
    expect(estimateBpm([0.5, 0.5])).toBeNull();
  });

  it("locks onto a clean 128 BPM grid", () => {
    const est = estimateBpm(intervalsFor(128));
    expect(est).not.toBeNull();
    expect(est!.bpm).toBe(128);
    expect(est!.confidence).toBeGreaterThan(0.9);
  });

  it("resists outliers (missed beats, double triggers)", () => {
    const clean = intervalsFor(132, 12);
    clean[2] = clean[2] * 2; // a missed beat
    clean[7] = clean[7] / 2; // a double trigger
    const est = estimateBpm(clean);
    expect(est).not.toBeNull();
    expect(Math.abs(est!.bpm - 132)).toBeLessThan(2);
  });

  it("folds half-time and double-time playing to the musical octave", () => {
    // kicks every other beat of 90 BPM → raw 45 BPM
    const halftime = estimateBpm(intervalsFor(45, 12));
    expect(halftime!.bpm).toBe(90);

    // 16th trigger spam at 140 BPM → raw 280 BPM
    const spam = estimateBpm(intervalsFor(280, 12));
    expect(spam!.bpm).toBe(140);
  });

  it("returns null for tempoless garbage", () => {
    expect(estimateBpm([0.2, 1.7, 0.4, 1.1, 0.9, 0.3, 1.6, 0.5])).toBeNull();
  });

  it("confidence rises with agreement", () => {
    const jittered = intervalsFor(124, 12).map((dt, i) => dt * (1 + (i % 3) * 0.01));
    const clean = estimateBpm(intervalsFor(124, 12))!;
    const noisy = estimateBpm(jittered)!;
    expect(noisy.confidence).toBeLessThan(clean.confidence);
  });

  it("exposes the minimum sample constant", () => {
    expect(MIN_INTERVALS).toBeGreaterThanOrEqual(4);
  });
});

describe("advanceBeatClock", () => {
  it("integrates beats from bpm without phase jumps", () => {
    const beats = [0, 1 / 6, 2 / 6]; // 100 BPM, 3× 100ms ticks
    const advanced = beats.reduce((acc, _) => advanceBeatClock(acc, 0.1, 100), 0);
    expect(advanced).toBeCloseTo(0.5, 6);
  });

  it("handles a tempo change smoothly (no discontinuity)", () => {
    let beats = 16; // mid-set position
    beats = advanceBeatClock(beats, 0.1, 128);
    beats = advanceBeatClock(beats, 0.1, 132);
    expect(beats).toBeGreaterThan(16);
    expect(beats).toBeLessThan(16.5);
  });

  it("ignores absurd or dead bpm values", () => {
    expect(advanceBeatClock(4, 0.5, 0)).toBe(4);
    expect(advanceBeatClock(4, 0.5, Number.NaN)).toBe(4);
  });
});
