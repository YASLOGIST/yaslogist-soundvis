import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { clearFault, framesDropped, onFault, raiseFault, type FaultInfo } from "./faultBus";

interface Props {
  children: ReactNode;
  /** non-fatal faults are reported as a toast instead of halting the show */
  onSoftFault?: (fault: FaultInfo) => void;
}

interface State {
  fault: FaultInfo | null;
  nonce: number;
}

/**
 * Single recovery surface for the whole experience.
 *
 * Catches BOTH classes of failure:
 *  · React render/commit errors  → via the boundary lifecycle
 *  · WebGL / shader / loop errors → via the global fault bus (rAF trap)
 *
 * The last rendered frame stays on screen (the loop is frozen, not cleared) and
 * the operator can remount the visual engine without losing the audio deck.
 */
export class FaultBoundary extends Component<Props, State> {
  state: State = { fault: null, nonce: 0 };
  unsubscribe: (() => void) | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      fault: {
        title: "RENDER PIPELINE FAULT",
        message: error.message || "An unexpected render error occurred.",
        detail: error.stack?.split("\n").slice(1, 4).join("\n"),
        fatal: true,
      },
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[VOID//REACTOR]", error, info.componentStack);
  }

  componentDidMount() {
    this.unsubscribe = onFault((fault) => {
      // Only a *fatal* (render-loop) fault deserves to stop the show. Anything
      // else is reported, logged and the visuals keep running.
      if (!fault.fatal) {
        console.warn(`[VOID//REACTOR] ${fault.title}:`, fault.message);
        this.props.onSoftFault?.(fault);
        return;
      }
      this.setState((s) => (s.fault ? s : { fault, nonce: s.nonce }));
    });
  }

  componentWillUnmount() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Remounts the subtree; also used by the overlay's engine restart. */
  private remount = () => {
    clearFault();
    this.setState((s) => ({ fault: null, nonce: s.nonce + 1 }));
  };

  /** Soft faults keep the last frame alive — the operator can just carry on. */
  private dismiss = () => {
    if (framesDropped()) {
      raiseFault(
        { title: "FROZEN", message: "The render loop is frozen until the engine is remounted.", fatal: false },
      );
      return;
    }
    this.setState({ fault: null });
  };

  render() {
    const { fault, nonce } = this.state;
    if (!fault) return this.props.children;

    return (
      <div className="absolute inset-0 z-[60] grid place-items-center bg-[#050505]/88 px-6 backdrop-blur-md">
        <div className="panel bracket w-full max-w-[540px] p-6">
          <div className="flex items-center gap-2">
            <span className="block h-2 w-2" style={{ background: "#FF3B5C", boxShadow: "0 0 12px #FF3B5C" }} />
            <span className="hud text-[10px] text-[#FF3B5C]">{fault.title}</span>
          </div>
          <h2 className="mt-3 text-[19px] font-bold tracking-[0.14em] text-[#e9eef2]">
            VISUAL ENGINE HALTED
          </h2>
          <p className="mt-2 text-[11px] leading-relaxed text-[#8b98a1] normal-case">
            The GPU pipeline threw an exception. Audio is untouched — remount the visual engine to
            continue, or reload for a clean session.
          </p>
          <pre className="no-scrollbar mt-3 max-h-28 overflow-auto border border-white/10 bg-black/60 p-2 text-[9px] leading-4 whitespace-pre-wrap text-[#6d7a84]">
            {fault.message}
            {fault.detail ? `\n\n${fault.detail}` : ""}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.remount}
              className="btn hud px-4 py-2.5 text-[10px]"
              style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#04070a" }}
            >
              REMOUNT ENGINE
            </button>
            {!fault.fatal ? (
              <button type="button" onClick={this.dismiss} className="btn hud px-4 py-2.5 text-[10px]">
                DISMISS
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn hud px-4 py-2.5 text-[10px]"
            >
              HARD RELOAD
            </button>
          </div>
          <p className="mt-4 text-[9px] tracking-[0.16em] text-[#4a555d]">
            SESSION {nonce.toString().padStart(3, "0")} · AUDIO BUS UNAFFECTED
          </p>
        </div>
      </div>
    );
  }
}

/** Hook form for function components that want to report a fault. */
export function useFaultReporter() {
  useEffect(() => {
    const onUnhandled = (e: PromiseRejectionEvent) => {
      raiseFault({ title: "ASYNC FAULT", message: String(e.reason), fatal: false });
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, []);
}
