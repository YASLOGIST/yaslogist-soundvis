import { Canvas } from "@react-three/fiber";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { engine, type AudioEngineError } from "./audio/AudioEngine";
import {
  PALETTES,
  QUALITY_PRESETS,
  audioState,
  loadSettings,
  perfBridge,
  saveSettings,
  type InputMode,
  type VisualSettings,
} from "./audio/state";
import {
  captureSupported,
  downloadBlob,
  snapshot,
  stamp,
  startRecording,
  type RecorderHandle,
} from "./media/Recorder";
import { applyLook, extractLook, loadBank, readLookFromLocation, saveBankSlot } from "./presets/lookPresets";
import Scene from "./three/Scene";
import { FaultBoundary } from "./ui/ErrorBoundary";
import { Hud, type Toast } from "./ui/Hud";
import { installFaultTraps, raiseFault } from "./ui/faultBus";

/* ── isolated 3D stage: re-renders only when settings actually change ───── */

const Stage = memo(function Stage({ settings }: { settings: VisualSettings }) {
  return (
    <Canvas
      flat
      dpr={QUALITY_PRESETS[settings.quality].dpr}
      gl={{
        antialias: false,
        alpha: false,
        stencil: false,
        depth: true,
        // required so PNG stills can read the framebuffer back
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      }}
      camera={{ position: [0, 0, 0], fov: 74, near: 0.05, far: 240 }}
      onCreated={({ gl }) => {
        gl.setClearColor(new THREE.Color("#030305"), 1);
        gl.toneMapping = THREE.NoToneMapping;
      }}
    >
      <Scene settings={settings} />
    </Canvas>
  );
});

/* ── boot gate ──────────────────────────────────────────────────────────── */

const SPECS: [string, string][] = [
  ["ENGINE", "THREE r180 · R3F 9 · GLSL3"],
  ["POST FX", "BLOOM · CHROMA · GRAIN · GLITCH"],
  ["GEOMETRY", "SDF TUNNEL · 160K PTS · FFT RING"],
  ["ANALYSIS", "FFT 1024 · 4 BAND · TRANSIENT LOCK"],
  ["LOOKS", `${PALETTES.length} PALETTES · 8 PRESET SLOTS`],
  ["CAPTURE", "60FPS WEBM + PNG STILL"],
];

function Boot({ onEnter, busy }: { onEnter: (mode: InputMode) => void; busy: boolean }) {
  return (
    <div className="vignette grain absolute inset-0 z-40 flex flex-col items-center justify-center overflow-hidden bg-[#050505] px-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)",
          backgroundSize: "58px 58px",
          maskImage: "radial-gradient(70% 60% at 50% 45%, #000 0%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(70% 60% at 50% 45%, #000 0%, transparent 100%)",
        }}
      />

      <div className="relative w-full max-w-[720px]">
        <div className="rise flex items-center gap-3">
          <span
            className="blink block h-2.5 w-2.5"
            style={{ background: "#00F0FF", boxShadow: "0 0 18px #00F0FF" }}
          />
          <span className="hud text-[10px] text-[#5c6870]">SYSTEM READY · AWAITING OPERATOR</span>
        </div>

        <h1
          className="rise mt-5 text-[12.5vw] leading-[0.9] font-bold tracking-[-0.02em] sm:text-[72px]"
          style={{ animationDelay: "60ms" }}
        >
          <span className="block">
            <span className="text-[#e9eef2]">YASLOGIST</span>
            <span className="text-[#2c3338]">//</span>
          </span>
          <span
            className="block"
            style={{
              background: "linear-gradient(96deg,#00F0FF 0%,#7B2CBF 55%,#FF2E97 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            SOUNDVIS
          </span>
        </h1>

        <p
          className="rise mt-4 max-w-[54ch] text-[11px] leading-relaxed tracking-[0.06em] text-[#8b98a1] normal-case"
          style={{ animationDelay: "120ms" }}
        >
          An ultra-high-performance audio-reactive instrument for industrial and melodic techno. Sub-bass
          drives the tunnel geometry, mids morph the field, treble ignites the bloom. Everything is
          synthesised and rendered locally — nothing is uploaded, nothing is tracked.
        </p>

        <div
          className="rise mt-7 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3"
          style={{ animationDelay: "180ms" }}
        >
          {SPECS.map(([k, v]) => (
            <div key={k} className="border-t border-white/10 pt-2">
              <div className="text-[8px] tracking-[0.22em] text-[#4a555d]">{k}</div>
              <div className="mt-1 text-[9px] leading-4 tracking-[0.1em] text-[#9fb0ba]">{v}</div>
            </div>
          ))}
        </div>

        <div className="rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "240ms" }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onEnter("synth")}
            className="btn relative overflow-hidden px-7 py-3.5 text-[11px] font-bold tracking-[0.28em] text-[#04070a]"
            style={{ background: "#00F0FF", borderColor: "#00F0FF" }}
          >
            {busy ? "INITIALISING…" : "ENTER THE VOID ▸"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onEnter("mic")}
            className="btn hud px-5 py-3.5 text-[10px]"
          >
            USE MICROPHONE
          </button>
          <span className="text-[9px] leading-4 tracking-[0.16em] text-[#4a555d]">
            AUDIO STARTS ON CLICK
            <br />
            (BROWSER AUTOPLAY POLICY)
          </span>
        </div>

        <div className="rise mt-8 flex items-center gap-2" style={{ animationDelay: "300ms" }}>
          {PALETTES.map((p) => (
            <span key={p.id} className="h-[2px] flex-1" style={{ background: p.hex[0], opacity: 0.7 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── shortcut sheet ─────────────────────────────────────────────────────── */

const KEYS: [string, string][] = [
  ["SPACE", "Play / pause the deck"],
  ["H", "Hide or show the interface"],
  ["F", "Toggle fullscreen"],
  ["1 – 9 / 0", `Palette recall (${PALETTES.length} looks)`],
  ["F1 – F8", "Recall look preset slot"],
  ["⇧ F1 – F8", "Store current look in slot"],
  ["R", "Start / stop video capture"],
  ["P", "Save a PNG still"],
  ["G", "Toggle glitch bursts"],
  ["A", "Toggle auto-performance"],
  ["L", "Toggle auto-look (32-beat phrase)"],
  ["← / →", "Seek the loaded track ±5s"],
  ["DRAG FILE", "Load MP3 / WAV / OGG / FLAC"],
];

function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute inset-0 z-50 grid place-items-center bg-[#050505]/88 px-6 backdrop-blur-md"
      aria-label="Close shortcuts"
    >
      <div className="panel bracket w-full max-w-[560px] p-6 text-left">
        <div className="hud text-[10px] text-[#5c6870]">OPERATOR SHEET</div>
        <h2 className="mt-2 text-[20px] font-bold tracking-[0.16em] text-[#e9eef2]">CONTROLS</h2>
        <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {KEYS.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-3">
              <span className="min-w-[74px] border border-white/10 bg-black/40 px-1.5 py-[3px] text-center text-[9px] tracking-[0.12em] text-[#9fb0ba]">
                {k}
              </span>
              <span className="text-[10px] leading-5 tracking-[0.06em] text-[#8b98a1] normal-case">{v}</span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[9px] leading-5 tracking-[0.14em] text-[#4a555d]">
          CLICK ANYWHERE TO CLOSE · INTERFACE AUTO-HIDES AFTER 6S OF INACTIVITY
        </p>
      </div>
    </button>
  );
}

/* ── app ────────────────────────────────────────────────────────────────── */

let toastId = 0;

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<VisualSettings>(() => {
    const base = loadSettings();
    // shared links carry a look in the URL hash (#look=…) — apply it on boot
    const shared = readLookFromLocation();
    return shared ? { ...base, ...applyLook(shared) } : base;
  });
  const [mode, setMode] = useState<InputMode | null>(null);
  const [booted, setBooted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [fileName, setFileName] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [uiHidden, setUiHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [help, setHelp] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const idleTimer = useRef<number | null>(null);
  const recorder = useRef<RecorderHandle | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const captureReady = useMemo(() => captureSupported(), []);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 6500);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  /**
   * Persisted settings patch — also feeds the audio chain immediately.
   * NOTE: side effects (storage, audio) live OUTSIDE the state updater so the
   * updater stays pure and can never throw during React's render phase.
   */
  const patch = useCallback((p: Partial<VisualSettings>) => {
    if (p.sensitivity !== undefined) audioState.sensitivity = p.sensitivity;
    setSettings((prev) => ({ ...prev, ...p }));
  }, []);

  // persistence is decoupled from the render phase and debounced
  useEffect(() => {
    const id = window.setTimeout(() => saveSettings(settings), 400);
    return () => window.clearTimeout(id);
  }, [settings]);

  /** Starts a source and reports readable errors back to the operator. */
  const startSource = useCallback(
    async (next: InputMode, file?: File) => {
      setBusy(true);
      try {
        await engine.start(next, file);
        engine.setVolume(volume);
        audioState.sensitivity = settingsRef.current.sensitivity;
        setMode(next);
        setPlaying(true);
        setFileName(next === "file" ? (file?.name ?? "") : "");
        setBooted(true);
        if (next === "mic") {
          toast({
            tone: "info",
            title: "LIVE INPUT ARMED",
            body: "Monitoring is muted to prevent feedback. Play music through your speakers or line-in.",
          });
        } else if (next === "file") {
          toast({ tone: "ok", title: "TRACK LOADED", body: file?.name });
        } else if (next === "synth") {
          toast({
            tone: "ok",
            title: "INTERNAL GENERATOR ONLINE",
            body: "132 BPM · A MINOR · PEAK-TIME LOOP",
          });
        }
      } catch (err) {
        const e = err as AudioEngineError;
        toast({
          tone: "error",
          title: e?.code?.replace(/_/g, " ") ?? "AUDIO ERROR",
          body: e?.message ?? "Unexpected audio failure.",
        });
      } finally {
        setBusy(false);
      }
    },
    [toast, volume],
  );

  const handleToggle = useCallback(() => {
    if (!mode) {
      void startSource("synth");
      return;
    }
    setPlaying(engine.togglePlay());
  }, [mode, startSource]);

  const handleVolume = useCallback((v: number) => {
    setVolume(v);
    engine.setVolume(v);
  }, []);

  /* ── capture ─────────────────────────────────────────────────────────── */
  const handleSnapshot = useCallback(() => {
    const canvas = perfBridge.canvas;
    if (!canvas) return;
    if (snapshot(canvas, `yaslogist-soundvis-${stamp()}`)) {
      toast({ tone: "ok", title: "STILL SAVED", body: "PNG written to your downloads." });
    } else {
      toast({ tone: "error", title: "CAPTURE FAILED", body: "The framebuffer could not be read." });
    }
  }, [toast]);

  const stopRecording = useCallback(() => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  }, []);

  const handleToggleRecord = useCallback(() => {
    if (recorder.current) {
      stopRecording();
      return;
    }
    const canvas = perfBridge.canvas;
    if (!canvas) return;
    const handle = startRecording(
      canvas,
      engine.audioStream,
      (s) => setRecordSeconds(s),
      (blob, ext, seconds) => {
        downloadBlob(blob, `yaslogist-soundvis-${stamp()}.${ext}`);
        toast({
          tone: "ok",
          title: "TAKE SAVED",
          body: `${ext.toUpperCase()} · ${seconds.toFixed(1)}s · ${(blob.size / 1e6).toFixed(1)} MB`,
        });
      },
      (message) => toast({ tone: "error", title: "RECORDER ERROR", body: message }),
    );
    if (handle) {
      recorder.current = handle;
      setRecordSeconds(0);
      setRecording(true);
      toast({ tone: "info", title: "RECORDING", body: "Capturing canvas + source audio." });
    }
  }, [stopRecording, toast]);

  /* stop the take if the tab goes away mid-recording */
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && recorder.current) stopRecording();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stopRecording]);

  /* ── BREATHE ANIMATION ── */
  useEffect(() => {
    let raf: number;
    let isBreathing = false;
    let cooldown = 0;

    const loop = () => {
      const now = performance.now();
      const sub = audioState.sub;

      if (sub > 0.8 && now > cooldown) {
        if (!isBreathing && containerRef.current) {
          containerRef.current.classList.remove("animate-breathe");
          // trigger reflow
          void containerRef.current.offsetWidth;
          containerRef.current.classList.add("animate-breathe");
          isBreathing = true;
          cooldown = now + 300; // wait for animation to finish
        }
      }

      if (isBreathing && now > cooldown) {
        isBreathing = false;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      toast({
        tone: "error",
        title: "FULLSCREEN BLOCKED",
        body: "The browser refused the fullscreen request.",
      });
    }
  }, [toast]);

  /* ── keyboard ────────────────────────────────────────────────────────── */
  const toggleRecordRef = useRef(handleToggleRecord);
  toggleRecordRef.current = handleToggleRecord;
  const snapshotRef = useRef(handleSnapshot);
  snapshotRef.current = handleSnapshot;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        setHelp(false);
        return;
      }
      /* look preset bank: F1–F8 recall · ⇧F1–F8 store */
      const slot = /^F([1-8])$/.exec(e.code);
      if (slot) {
        e.preventDefault();
        const index = Number(slot[1]) - 1;
        if (e.shiftKey) {
          const current = settingsRef.current;
          const preset = extractLook(
            `${PALETTES[current.palette % PALETTES.length].name} · S${current.shape + 1}`,
            current,
          );
          saveBankSlot(index, preset);
          toast({ tone: "ok", title: `SLOT ${index + 1} STORED`, body: preset.name });
        } else {
          const preset = loadBank()[index];
          if (!preset) {
            toast({
              tone: "info",
              title: `SLOT ${index + 1} EMPTY`,
              body: "Store a look with ⇧+F" + (index + 1) + ".",
            });
          } else {
            patch(applyLook(preset));
            toast({ tone: "ok", title: `LOOK ${index + 1} RECALLED`, body: preset.name });
          }
        }
        return;
      }
      switch (e.key.toLowerCase()) {
        case " ":
          e.preventDefault();
          handleToggle();
          break;
        case "h":
          setUiHidden((v) => !v);
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "r":
          toggleRecordRef.current();
          break;
        case "p":
          snapshotRef.current();
          break;
        case "?":
          setHelp((v) => !v);
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9":
          patch({ palette: Number(e.key) - 1 });
          break;
        case "0":
          patch({ palette: 9 });
          break;
        case "g":
          patch({ glitch: !settingsRef.current.glitch });
          break;
        case "a":
          patch({ autoPerf: !settingsRef.current.autoPerf });
          break;
        case "l":
          patch({ autoLook: !settingsRef.current.autoLook });
          break;
        case "arrowright":
          if (engine.transport) engine.seek(engine.transport.currentTime + 5);
          break;
        case "arrowleft":
          if (engine.transport) engine.seek(engine.transport.currentTime - 5);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleToggle, patch, toast, toggleFullscreen]);

  /* ── global fault traps (rAF / window / unhandled rejections) ────────── */
  useEffect(() => {
    const dispose = installFaultTraps();
    const onLost = () => {
      raiseFault({
        title: "GPU CONTEXT LOST",
        message: "The WebGL context was reclaimed by the driver. Remount the engine to rebuild the pipeline.",
        fatal: true,
      });
    };
    window.addEventListener("webglcontextlost", onLost);
    return () => {
      dispose();
      window.removeEventListener("webglcontextlost", onLost);
    };
  }, []);

  /* ── drag & drop ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes("Files")) setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (!f.type.startsWith("audio") && !/\.(mp3|wav|ogg|flac|m4a|aac|aiff?)$/i.test(f.name)) {
        toast({ tone: "error", title: "UNSUPPORTED FILE", body: `"${f.name}" is not an audio file.` });
        return;
      }
      void startSource("file", f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [startSource, toast]);

  /* ── transport sync + idle auto-hide ─────────────────────────────────── */
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = engine.transport;
      if (el) setPlaying(!el.paused);
      else if (mode === "synth") setPlaying(true);
    }, 300);
    return () => window.clearInterval(id);
  }, [mode]);

  useEffect(() => {
    const wake = () => {
      setUiHidden(false);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        if (audioState.active && !recorder.current) setUiHidden(true);
      }, 6000);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);

  /* ── AUTO-LOOK: phrase-locked palette advance ────────────────────────── */
  useEffect(() => {
    perfBridge.onPhrase = settings.autoLook
      ? () => {
          setSettings((prev) => {
            const next = { ...prev, palette: (prev.palette + 1) % PALETTES.length };
            saveSettings(next);
            return next;
          });
        }
      : null;
    return () => {
      perfBridge.onPhrase = null;
    };
  }, [settings.autoLook]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#050505]">
      <FaultBoundary
        onSoftFault={(f) =>
          toast({
            tone: "error",
            title: f.title,
            body: `${f.message} — visuals unaffected, continuing.`,
          })
        }
      >
        <Stage settings={settings} />
      </FaultBoundary>

      {/* CRT flavour on top of the render */}
      <div className="vignette grain pointer-events-none absolute inset-0 z-10 opacity-70 mix-blend-soft-light" />

      {booted ? (
        <Hud
          settings={settings}
          patch={patch}
          mode={mode}
          onMode={(m) => void startSource(m)}
          onFile={(f) => void startSource("file", f)}
          playing={playing}
          onToggle={handleToggle}
          volume={volume}
          onVolume={handleVolume}
          fileName={fileName}
          toasts={toasts}
          onDismiss={dismiss}
          hidden={uiHidden}
          onFullscreen={() => void toggleFullscreen()}
          onHide={() => setUiHidden(true)}
          onSnapshot={handleSnapshot}
          onToggleRecord={handleToggleRecord}
          recording={recording}
          recordSeconds={recordSeconds}
          captureReady={captureReady}
          onHelp={() => setHelp(true)}
          onToast={toast}
        />
      ) : (
        <Boot busy={busy} onEnter={(m) => void startSource(m)} />
      )}

      {booted && uiHidden ? (
        <button
          type="button"
          onClick={() => setUiHidden(false)}
          className="btn hud panel absolute bottom-4 left-1/2 z-30 -translate-x-1/2 px-3 py-2 opacity-40 hover:opacity-100"
        >
          SHOW INTERFACE [H]
        </button>
      ) : null}

      {help ? <HelpSheet onClose={() => setHelp(false)} /> : null}

      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-[#050505]/80 backdrop-blur-sm">
          <div
            className="border border-dashed px-10 py-8 text-center"
            style={{ borderColor: "var(--accent)" }}
          >
            <div className="text-[13px] font-bold tracking-[0.3em]" style={{ color: "var(--accent)" }}>
              DROP AUDIO
            </div>
            <div className="mt-2 text-[9px] tracking-[0.2em] text-[#8b98a1]">MP3 · WAV · OGG · FLAC</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
