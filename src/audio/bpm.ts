/**
 * Tempo estimation from inter-beat intervals.
 *
 * Pure, allocation-light math so it can run inside the audio callback and be
 * unit-tested without a Web Audio graph.
 *
 * The estimator folds the median interval into a musically sane octave
 * (70–180 BPM) — bare median is easily fooled by half-time feels or 16th-note
 * hi-hat triggers, which would otherwise read 64 BPM as 128 and vice versa.
 */

export interface BpmEstimate {
  bpm: number;
  /** 0..1 — interval agreement around the median (1 = perfectly locked). */
  confidence: number;
}

/** Acceptable tempo octave after folding. */
const BPM_MIN = 70;
const BPM_MAX = 180;
/** Intervals within ±TOLERANCE of the median count towards confidence. */
const TOLERANCE = 0.12;
/** Minimum samples before we trust an estimate at all. */
export const MIN_INTERVALS = 4;

/** Median of a non-empty numeric array (does not mutate the input). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Fold a raw tempo into the [BPM_MIN, BPM_MAX] octave by doubling/halving. */
export function foldBpm(bpm: number): number {
  let folded = bpm;
  while (folded < BPM_MIN) folded *= 2;
  while (folded > BPM_MAX) folded /= 2;
  return folded;
}

/**
 * Estimate tempo from recent inter-beat intervals (seconds).
 * Returns `null` when there is not enough consistent data yet.
 */
export function estimateBpm(intervals: number[]): BpmEstimate | null {
  if (intervals.length < MIN_INTERVALS) return null;

  const med = median(intervals);
  if (!(med > 0.15 && med < 2)) return null; // 30–400 BPM sanity window

  // inliers: intervals agreeing with the median — rejects phase hiccups,
  // missed beats and double-triggered kicks
  const inliers = intervals.filter((dt) => Math.abs(dt - med) <= med * TOLERANCE);
  if (inliers.length < MIN_INTERVALS) return null;

  const refined = median(inliers);
  const bpm = foldBpm(60 / refined);
  const agreement = inliers.length / intervals.length;
  // dispersion of the inliers themselves (tighter = more confident)
  const spread = inliers.reduce((acc, dt) => acc + Math.abs(dt - refined), 0) / (inliers.length * refined);
  const confidence = Math.max(0, Math.min(1, agreement * (1 - spread * 4)));

  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

/**
 * Phase-continuous beat clock advance. Integrating (instead of recomputing
 * `elapsed * bpm`) means tempo changes never jump the visual phase — the grid
 * simply accelerates or decelerates from where it is.
 */
export function advanceBeatClock(currentBeats: number, dtSeconds: number, bpm: number): number {
  if (!(bpm > 20) || !Number.isFinite(bpm)) return currentBeats;
  return currentBeats + (dtSeconds * bpm) / 60;
}
