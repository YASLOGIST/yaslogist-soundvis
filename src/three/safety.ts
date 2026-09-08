/**
 * Photosensitive safety limiter.
 *
 * Flash rates above ~3 Hz and large sudden luminance steps are a known trigger
 * for photosensitive epilepsy (Harding & Jeavons guidance). When SAFE mode is
 * armed these helpers cap the engine's strobe frequency, clamp drop flashes,
 * dampen camera punches and suppress full-screen glitch bursts — while keeping
 * the visual *character* of the show intact.
 */

/** Hard ceiling for background strobe oscillations (Hz). */
export const SAFE_STROBE_HZ = 3;
/** Same ceiling expressed as angular rate (rad/s) for `sin(t * rate)` shaders. */
export const SAFE_STROBE_RATE = SAFE_STROBE_HZ * Math.PI * 2;
/** Maximum drop flash multiplier (the unsafe path spikes to 3.0). */
export const SAFE_FLASH_CEIL = 1.25;
/** Scale applied to the drop FOV punch (degrees). */
export const SAFE_PUNCH_SCALE = 0.3;
/** Scale applied to chromatic-aberration flutter spikes. */
export const SAFE_CHROMA_SCALE = 0.5;

/**
 * Clamp a strobe angular rate (`sin(uTime * rate)` style) so the perceived
 * flash frequency never exceeds `SAFE_STROBE_HZ`.
 */
export function limitStrobeRate(rateRadPerSec: number, safeMode: boolean): number {
  return safeMode ? Math.min(rateRadPerSec, SAFE_STROBE_RATE) : rateRadPerSec;
}

/** Clamp a transient flash multiplier (bloom flare, strobe flash, …). */
export function limitFlash(flash: number, safeMode: boolean): number {
  return safeMode ? Math.min(flash, SAFE_FLASH_CEIL) : flash;
}

/** Scale a camera FOV punch. */
export function limitPunch(punch: number, safeMode: boolean): number {
  return safeMode ? punch * SAFE_PUNCH_SCALE : punch;
}
