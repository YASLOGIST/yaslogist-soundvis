/**
 * Fault bus — global runtime fault trapping.
 *
 * WHY THIS EXISTS: React error boundaries only catch errors thrown during the
 * render/commit phase. Three.js throws shader-compilation and WebGL errors from
 * inside `requestAnimationFrame`, so they bypass every boundary and leave a
 * black screen. We therefore guard the animation frame loop itself, plus the
 * window error/rejection channels, and funnel everything into one sink that the
 * fault overlay listens to.
 */

export interface FaultInfo {
  title: string;
  message: string;
  detail?: string;
  /** fatal faults freeze the render loop; soft ones keep it running */
  fatal: boolean;
}

type Sink = (fault: FaultInfo) => void;
type RenderSink = (fault: FaultInfo) => boolean | void;

let sink: Sink | null = null;
/** Dedicated channel for faults thrown by the animation loop. */
let renderSink: RenderSink | null = null;
let dropFrames = false;
let installed = false;

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Faults that must never halt — or even alarm — the operator.
 * Serialisation noise, iframe storage restrictions, observer loops and
 * autoplay interruptions are all non-visual and self-recovering.
 */
const BENIGN: RegExp[] = [
  /json\.stringify/i,
  /cyclic/i,
  /circular/i,
  /resizeobserver/i,
  /aborterror/i,
  /securityerror/i,
  /the (?:user|play)[: ]|interrupted by a/i,
  /non-error promise rejection/i,
  /localstorage|sessionstorage|indexeddb/i,
  /requestfullscreen/i,
];

/** De-duplication window so a repeating throw cannot spam the operator. */
const DEDUPE_MS = 6000;
const seen = new Map<string, number>();

function isNoise(fault: FaultInfo): boolean {
  const hay = `${fault.title} ${fault.message}`.slice(0, 400);
  if (BENIGN.some((re) => re.test(hay))) return true;

  const now = performance.now();
  const last = seen.get(hay) ?? Number.NEGATIVE_INFINITY;
  seen.set(hay, now);
  if (seen.size > 24) {
    for (const [k, v] of seen) {
      if (now - v > DEDUPE_MS) seen.delete(k);
    }
  }
  return now - last < DEDUPE_MS;
}

export function raiseFault(fault: FaultInfo, freeze = false) {
  if (freeze) dropFrames = true;
  if (isNoise(fault)) return;
  if (fault.fatal) {
    // always loud so real faults are never silently swallowed
    console.error(`[VOID//REACTOR] ${fault.title}:`, fault.message, fault.detail ?? "");
  }
  try {
    sink?.(fault);
  } catch {
    /* the sink must never become the fault */
  }
}

/** Serialises a value for transport/storage without ever throwing. */
export function safeStringify(value: unknown, fallback = "{}"): string {
  try {
    const out = JSON.stringify(value, (_key, val) =>
      // strip non-serialisable / cyclic branches instead of exploding
      typeof val === "object" &&
      val !== null &&
      !Array.isArray(val) &&
      Object.getPrototypeOf(val) !== Object.prototype
        ? `[${val.constructor?.name ?? "object"}]`
        : val,
    );
    return typeof out === "string" ? out : fallback;
  } catch {
    return fallback;
  }
}

export function onFault(cb: Sink): () => void {
  sink = cb;
  return () => {
    if (sink === cb) sink = null;
  };
}

/**
 * Subscribes to animation-loop faults specifically. Returning `true` means the
 * subscriber has recovered (e.g. by degrading the pipeline) and the loop should
 * keep running instead of freezing.
 */
export function onRenderFault(cb: RenderSink): () => void {
  renderSink = cb;
  return () => {
    if (renderSink === cb) renderSink = null;
  };
}

/** Called when the operator remounts the engine. */
export function clearFault() {
  dropFrames = false;
}

/** True while the render loop is being suppressed. */
export function framesDropped() {
  return dropFrames;
}

/**
 * Installs the global traps exactly once. Returns a disposer for HMR safety.
 */
export function installFaultTraps(): () => void {
  if (installed) return () => undefined;
  installed = true;

  // 1. animation-frame guard — the critical one for WebGL/shader faults
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const guarded: typeof window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    nativeRAF((t) => {
      if (dropFrames) return; // freeze the last good frame
      try {
        cb(t);
      } catch (err) {
        const fault: FaultInfo = {
          title: "RENDER LOOP FAULT",
          message: describe(err),
          detail: err instanceof Error ? err.stack?.split("\n").slice(0, 4).join("\n") : undefined,
          fatal: true,
        };
        // Give the pipeline a chance to self-heal (degrade FX, drop a layer)
        // before freezing the frame and surfacing the halt overlay.
        let handled: boolean;
        try {
          handled = renderSink ? renderSink(fault) === true : false;
        } catch {
          handled = false;
        }
        if (!handled) {
          dropFrames = true;
          raiseFault(fault, false);
        }
      }
    });
  window.requestAnimationFrame = guarded;

  // 2. window error channel (filters out silent resource-load errors)
  const onError = (e: ErrorEvent) => {
    if (!e.message && e.target) return; // <img>/<link>/font load failure
    raiseFault({
      title: "RUNTIME FAULT",
      message: e.message || "Unknown window error",
      detail: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
      fatal: false,
    });
  };

  // 3. unhandled promise rejections (decoder, capture, storage…)
  const onRejection = (e: PromiseRejectionEvent) => {
    raiseFault({
      title: "ASYNC FAULT",
      message: describe(e.reason),
      fatal: false,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.requestAnimationFrame = nativeRAF;
    installed = false;
    dropFrames = false;
  };
}

/**
 * Wraps any callback so a throw inside it becomes a reported fault instead of
 * an uncaught exception in the render loop.
 */
export function guard<T extends (...args: never[]) => void>(fn: T, label: string): T {
  return ((...args: never[]) => {
    try {
      return fn(...args);
    } catch (err) {
      raiseFault({ title: `${label} FAULT`, message: describe(err), fatal: false });
      return undefined;
    }
  }) as T;
}
