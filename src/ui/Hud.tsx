import { memo, useCallback, useEffect, useRef, useState } from "react";
import { engine } from "../audio/AudioEngine";
import {
  LOOK_PRESETS,
  PALETTES,
  QUALITY_PRESETS,
  audioState,
  hudBridge,
  perfBridge,
  type InputMode,
  type QualityLevel,
  type VisualSettings,
} from "../audio/state";

export interface Toast {
  id: number;
  tone: "error" | "info" | "ok";
  title: string;
  body?: string;
}

interface HudProps {
  settings: VisualSettings;
  patch: (p: Partial<VisualSettings>) => void;
  mode: InputMode | null;
  onMode: (m: InputMode) => void;
  onFile: (f: File) => void;
  playing: boolean;
  onToggle: () => void;
  volume: number;
  onVolume: (v: number) => void;
  fileName: string;
  toasts: Toast[];
  onDismiss: (id: number) => void;
  hidden: boolean;
  onFullscreen: () => void;
  onHide: () => void;
  onSnapshot: () => void;
  onToggleRecord: () => void;
  recording: boolean;
  recordSeconds: number;
  captureReady: boolean;
  onHelp: () => void;
}

/* ── small building blocks ──────────────────────────────────────────────── */

function Label({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[9px] tracking-[0.2em] text-[#6d7a84] uppercase">
      <span>{children}</span>
      {right ? <span className="text-[#9fb0ba] tabular-nums">{right}</span> : null}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  tooltip,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
  tooltip?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="group relative space-y-0.5">
      {tooltip && (
        <div className="pointer-events-none absolute bottom-full left-0 mb-1.5 w-[190px] opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-50">
          <div className="bg-[#04070a]/95 border border-[#00f0ff]/30 text-[#e9eef2] p-2 text-[9px] leading-tight tracking-wider shadow-[0_4px_12px_rgba(0,240,255,0.2)] backdrop-blur-md">
            {tooltip}
          </div>
        </div>
      )}
      <Label right={display}>{label}</Label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--pct" as string]: `${pct}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={on}
      className="btn hud px-2 py-[5px] text-[9px]"
    >
      {label}
    </button>
  );
}

/* ── readouts ───────────────────────────────────────────────────────────── */

function Readouts() {
  return (
    <div className="flex items-stretch divide-x divide-white/10 border border-white/10 bg-black/40">
      {(
        [
          ["FPS", "fps"],
          ["MS", "ms"],
          ["BPM", "bpm"],
          ["T+", "time"],
        ] as const
      ).map(([label, key]) => (
        <div key={key} className="min-w-[52px] px-2.5 py-1.5">
          <div className="text-[8px] tracking-[0.22em] text-[#5c6870]">{label}</div>
          <div
            ref={(el) => {
              if (key === "fps") hudBridge.fps = el;
              else if (key === "ms") hudBridge.ms = el;
              else if (key === "bpm") hudBridge.bpm = el;
              else hudBridge.time = el;
            }}
            className="text-[13px] leading-4 font-medium tabular-nums text-[#e9eef2]"
          >
            --
          </div>
        </div>
      ))}
    </div>
  );
}


function SidebarSpectrum({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const data = audioState.spectrum; 
      
      const bars = 64;
      const barHeight = canvas.height / bars;
      
      for (let i = 0; i < bars; i++) {
        const val = data[i * 3]; 
        const w = (val / 255) * canvas.width;
        
        ctx.fillStyle = `hsla(${180 + i * 2}, 100%, 60%, 0.6)`;
        // Draw from bottom to top
        ctx.fillRect(0, canvas.height - i * barHeight - barHeight + 1, w, barHeight - 1);
      }
      
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;

  return (
    <div className="absolute left-0 top-0 bottom-0 w-20 sm:w-24 pointer-events-none flex flex-col justify-center z-40 opacity-50 mix-blend-screen pl-2">
      <canvas ref={canvasRef} width={64} height={512} className="w-12 sm:w-16 max-h-[65vh] h-[360px] sm:h-[512px]" />
    </div>
  );
}

function Meters() {
  const names = ["SUB", "BASS", "MID", "HIGH"];
  const colors = ["#FF3B5C", "#FFB300", "#00F0FF", "#00FF9C"];
  return (
    <div className="space-y-[5px]">
      {names.map((n, i) => (
        <div key={n} className="flex items-center gap-2">
          <span className="w-[26px] text-[8px] tracking-[0.18em] text-[#5c6870]">{n}</span>
          <div className="meter-track h-[3px] flex-1">
            <div
              ref={(el) => {
                hudBridge.bars[i] = el;
              }}
              className="meter-fill h-full"
              style={{ background: colors[i], boxShadow: `0 0 10px -1px ${colors[i]}` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── file transport ─────────────────────────────────────────────────────── */

function Transport({
  playing,
  onToggle,
  volume,
  onVolume,
  fileName,
  mode,
}: {
  playing: boolean;
  onToggle: () => void;
  volume: number;
  onVolume: (v: number) => void;
  fileName: string;
  mode: InputMode | null;
}) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      const el = engine.transport;
      if (el) {
        setTime(el.currentTime);
        setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      } else {
        setTime(audioState.time);
        setDuration(0);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const seek = (v: number) => {
    if (engine.transport && duration) engine.seek((v / 100) * duration);
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) return "00:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? "Pause" : "Play"}
          className="btn grid h-7 w-7 shrink-0 place-items-center font-mono text-[11px]"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="min-w-0 leading-tight">
          <div className="text-[10px] font-bold tracking-[0.18em] text-[#e9eef2]">
            <span className="truncate">{fileName || (mode === "synth" ? `INTERNAL SYNTH · ${Math.round(audioState.synthBpm)} BPM` : mode ?? "IDLE")}</span>
          </div>
          <div className="text-[8px] tracking-[0.16em] text-[#5c6870]">
            {duration > 0 ? `${fmt(time)} / ${fmt(duration)}` : "LIVE DECK"}
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center gap-2">
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={duration > 0 ? (time / duration) * 100 : 0}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!duration}
          aria-label="Seek"
          className="flex-1 opacity-70 hover:opacity-100 disabled:opacity-20"
          style={{
            ["--pct" as any]: `${duration > 0 ? (time / duration) * 100 : 0}%`,
          }}
        />
        <div className="flex items-center gap-1.5">
          <Label right={`${Math.round(volume * 100)}`}>VOL</Label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            aria-label="Volume"
            className="w-16 opacity-70 hover:opacity-100"
            style={{
              ["--pct" as any]: `${volume * 100}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── HUD root ───────────────────────────────────────────────────────────── */

const FX_LABELS = ["FULL", "CORE", "MINIMAL", "RAW"];

const SOURCES: { id: InputMode; label: string; hint: string }[] = [
  { id: "synth", label: "SYNTH", hint: "Internal generator — zero setup" },
  { id: "mic", label: "MIC", hint: "Live microphone / line input" },
  { id: "system", label: "SYSTEM", hint: "Share a tab or the whole desktop" },
  { id: "file", label: "FILE", hint: "MP3 / WAV / OGG / FLAC" },
];

function HudInner({
  settings,
  patch,
  mode,
  onMode,
  onFile,
  playing,
  onToggle,
  volume,
  onVolume,
  fileName,
  toasts,
  onDismiss,
  hidden,
  onFullscreen,
  onHide,
  onSnapshot,
  onToggleRecord,
  recording,
  recordSeconds,
  captureReady,
  onHelp,
}: HudProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [governor, setGovernor] = useState(0);
  const [hint, setHint] = useState<string>("INTERNAL GENERATOR ONLINE — DROP AN AUDIO FILE ANYWHERE");
  const [isIdle, setIsIdle] = useState(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIsIdle(false);
      clearTimeout(timeout);
      if (settings.autoHideUi) {
        timeout = setTimeout(() => setIsIdle(true), 5000);
      }
    };
    
    if (settings.autoHideUi) wake();
    
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('touchstart', wake);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('touchstart', wake);
      clearTimeout(timeout);
    };
  }, [settings.autoHideUi]);

  // the governor runs outside React — poll its level at a human rate
  useEffect(() => {
    const id = window.setInterval(() => setGovernor(perfBridge.governorLevel), 500);
    return () => window.clearInterval(id);
  }, []);

  const pickFile = useCallback(() => fileInput.current?.click(), []);

  useEffect(() => {
    const c = settings.uiContrast ?? 0.8;
    const op = (0.35 + c * 0.60).toFixed(2);
    const blurVal = `${Math.round(4 + c * 20)}px`;
    document.documentElement.style.setProperty("--ui-opacity", op);
    document.documentElement.style.setProperty("--ui-blur", blurVal);
  }, [settings.uiContrast]);

  useEffect(() => {
    if (mode === "file" && fileName) setHint(`DECK LOADED · ${fileName.toUpperCase()}`);
    else if (mode === "mic") setHint("LIVE INPUT — MONITORING MUTED TO PREVENT FEEDBACK");
    else if (mode === "system") setHint("SYSTEM BUS CAPTURED");
    else if (mode === "synth") setHint("INTERNAL GENERATOR ONLINE — DROP AN AUDIO FILE ANYWHERE");
  }, [mode, fileName]);

  const randomizeScene = useCallback(() => {
    const bloomProfiles = ["soft", "hard", "laser"] as const;
    const newPalette = Math.floor(Math.random() * PALETTES.length);
    const newShape = Math.floor(Math.random() * 12);
    const newProfile = bloomProfiles[Math.floor(Math.random() * bloomProfiles.length)];
    const newParticleSize = +(0.8 + Math.random() * 2.5).toFixed(1);
    const newIntensity = +(0.4 + Math.random() * 0.8).toFixed(2);
    const newBloom = +(0.6 + Math.random() * 1.4).toFixed(2);
    const newSoftening = +(0.2 + Math.random() * 0.6).toFixed(2);
    
    patch({
      palette: newPalette,
      shape: newShape,
      bloomProfile: newProfile,
      particleSize: newParticleSize,
      intensity: newIntensity,
      bloom: newBloom,
      softening: newSoftening,
      quantumPortal: Math.random() > 0.3,
      neuralSynapses: Math.random() > 0.3,
      liquid: Math.random() > 0.5,
      wireframe: Math.random() > 0.4,
      vortex: Math.random() > 0.3,
      energyFlux: Math.random() > 0.4,
      grid: Math.random() > 0.3,
      rays: Math.random() > 0.4,
      rings: Math.random() > 0.5,
      towers: Math.random() > 0.4,
    });

    setHint(`SCENE RANDOMIZED · PALETTE #${newPalette + 1} · SHAPE #${newShape + 1}`);
  }, [patch]);

  const [dockOpen, setDockOpen] = useState(true);

  if (settings.zenMode) {
    return (
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3 font-mono text-[9px] sm:text-[10px] text-white/80 bg-black/40 backdrop-blur-2xl px-3 py-1.5 border border-cyan-500/20 rounded-full tracking-widest uppercase shadow-[0_0_20px_rgba(0,240,255,0.15)] pointer-events-auto">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-cyan-400 animate-pulse rounded-full shadow-[0_0_8px_#00F0FF]" />
          <span>FPS: <span ref={(el) => { hudBridge.fps = el; }}>--</span></span>
        </div>
        <div className="w-px h-3 bg-white/20" />
        <span>{mode === "synth" ? `SYNTH ${Math.round(audioState.synthBpm)}` : mode ?? "IDLE"}</span>
        <div className="w-px h-3 bg-white/20" />
        <button 
          onClick={() => patch({ zenMode: false })}
          className="hover:text-cyan-300 text-cyan-400 font-bold px-1.5 py-0.5 transition-colors cursor-pointer"
          title="Exit Zen Mode (Z)"
        >
          [EXIT ZEN]
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      {/* ── Main Viewport HUD Overlays ── */}
      <div
        className={`fade-ui pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3 sm:p-5 transition-opacity duration-700 ${
          hidden ? "ui-hidden" : isIdle && settings.autoHideUi ? "opacity-0" : "opacity-100"
        }`}
      >
        <SidebarSpectrum active={!hidden && (!isIdle || !settings.autoHideUi) && !settings.zenMode} />

        {/* Top Header Row */}
        <div className="flex items-start justify-between gap-3">
          {/* Top Left: Logo & Readouts */}
          <div className="pointer-events-auto rise flex items-stretch gap-3">
            <div className="panel bracket relative px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className="blink block h-2 w-2"
                  style={{ background: "var(--accent)", boxShadow: "0 0 12px var(--accent)" }}
                />
                <div className="leading-none">
                  <div className="text-[12px] font-bold tracking-[0.32em] text-[#e9eef2]">
                    VOID<span className="text-[#4a555d]">//</span>REACTOR
                  </div>
                  <div className="mt-1 text-[8px] tracking-[0.24em] text-[#5c6870]">
                    FFT 1024 · ULTRA SMOOTH · WEBGL2
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden md:block">
              <Readouts />
            </div>
          </div>

          {/* Top Right Action Bar */}
          <div className="pointer-events-auto rise flex items-center gap-1.5 flex-wrap justify-end">
            <div className="panel flex items-center gap-1 p-1">
              <button
                type="button"
                onClick={onToggleRecord}
                disabled={!captureReady}
                data-active={recording}
                className="btn hud flex items-center gap-1.5 px-2.5 py-[6px] text-[9px] disabled:opacity-30"
                title={captureReady ? "Record performance (R)" : "MediaRecorder unavailable"}
              >
                <span
                  className={recording ? "blink block h-1.5 w-1.5 rounded-full" : "block h-1.5 w-1.5 rounded-full"}
                  style={{ background: recording ? "#FF3B5C" : "currentColor" }}
                />
                {recording ? `${recordSeconds.toFixed(1)}S` : "REC"}
              </button>
              <button
                type="button"
                onClick={onSnapshot}
                className="btn hud px-2.5 py-[6px] text-[9px]"
                title="Save PNG still (P)"
              >
                PNG
              </button>
              <button type="button" onClick={onHelp} className="btn hud px-2 py-[6px] text-[9px]" title="Shortcuts (?)">
                ?
              </button>
            </div>
            <button
              type="button"
              onClick={() => patch({ zenMode: true })}
              className="btn hud panel px-2.5 py-[7px] text-cyan-400 hover:text-cyan-300"
              title="Zen Mode (Hide all UI for performance)"
            >
              👁 ZEN
            </button>
            <button
              type="button"
              onClick={() => setDockOpen(!dockOpen)}
              data-active={dockOpen}
              className="btn hud panel px-2.5 py-[7px]"
              title="Toggle Control Dock"
            >
              ◫ DOCK
            </button>
            <button type="button" onClick={onFullscreen} className="btn hud panel px-2.5 py-[7px]" title="Fullscreen (F)">
              ⛶
            </button>
            <button
              type="button"
              onClick={onHide}
              className="btn hud panel hidden px-2.5 py-[7px] sm:block"
              title="Hide interface (H)"
            >
              HIDE <span className="text-[#4a555d]">[H]</span>
            </button>
          </div>
        </div>

        {/* Mobile Readouts Bar */}
        <div className="pointer-events-auto md:hidden">
          <Readouts />
        </div>

        {/* Bottom Left Real-Time Audio Analysis Console */}
        <div className="flex flex-col gap-3 max-w-[min(540px,calc(100vw-340px))] pointer-events-auto">
          <div className="rise hidden items-center gap-2 md:flex">
            <div className="panel px-2.5 py-1 text-[9px] tracking-[0.2em] text-[#5c6870] truncate">{hint}</div>
          </div>

          <div className="panel bracket rise flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-end">
            <div className="shrink-0">
              <Label right={`${audioState.spectrum.length} BIN`}>SPECTRUM</Label>
              <canvas
                ref={(el) => {
                  hudBridge.scope = el;
                }}
                width={320}
                height={50}
                className="mt-1 block h-[50px] w-full max-w-[320px] border border-white/5 bg-black/50"
              />
            </div>

            <div className="hidden shrink-0 lg:block">
              <Label right="TIME DOMAIN">SCOPE</Label>
              <canvas
                ref={(el) => {
                  hudBridge.wave = el;
                }}
                width={140}
                height={50}
                className="mt-1 block h-[50px] w-[140px] border border-white/5 bg-black/50"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span
                  ref={(el) => {
                    hudBridge.beat = el;
                  }}
                  className="block h-2 w-2 rounded-full"
                  style={{ background: "var(--accent)", boxShadow: "0 0 12px var(--accent)", opacity: 0.2 }}
                />
                <span className="text-[9px] tracking-[0.2em] text-[#5c6870]">
                  {settings.autoPerf ? "AUTO-PERF" : "MANUAL"}
                  {perfBridge.fxTier > 0 ? (
                    <span style={{ color: "#FFC400" }}> · FX:{FX_LABELS[perfBridge.fxTier] ?? "RAW"}</span>
                  ) : null}
                </span>
                <span className="ml-auto flex items-center gap-2 text-[9px] tracking-[0.2em] text-[#5c6870]">
                  <span className="hidden sm:inline">GOV</span>
                  <span className="flex gap-[3px]">
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className="block h-2 w-[3px]"
                        style={{
                          background: i < governor ? "var(--accent)" : "rgba(255,255,255,0.15)",
                        }}
                      />
                    ))}
                  </span>
                </span>
              </div>
              <Meters />
            </div>
          </div>
        </div>
      </div>

      {/* ── Collapsed Dock Minimal Trigger Tab ── */}
      {!dockOpen && !hidden && !settings.zenMode && (
        <button
          type="button"
          onClick={() => setDockOpen(true)}
          className="fixed right-3 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1.5 rounded-l-xl border border-cyan-500/30 bg-black/60 px-2 py-3.5 backdrop-blur-2xl transition-all duration-300 hover:border-cyan-400 hover:bg-cyan-950/40 hover:shadow-[0_0_20px_rgba(0,240,255,0.3)] text-cyan-300 cursor-pointer pointer-events-auto group"
          title="Expand Visualizer Controls Dock"
        >
          <span className="font-mono text-[9px] [writing-mode:vertical-lr] tracking-[0.28em] group-hover:text-white uppercase font-bold">
            CONTROLS ◀
          </span>
        </button>
      )}

      {/* ── Collapsible Floating Glassmorphism Dock ── */}
      {dockOpen && !hidden && !settings.zenMode && (
        <div className="fixed right-4 top-1/2 -translate-y-1/2 max-h-[85vh] w-72 bg-black/40 backdrop-blur-2xl border border-cyan-500/20 rounded-2xl p-5 overflow-y-auto z-50 custom-scrollbar pointer-events-auto flex flex-col gap-4 shadow-[0_8px_32px_rgba(0,0,0,0.8),0_0_20px_rgba(0,240,255,0.08)]">
          {/* Dock Header */}
          <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#00F0FF]" />
              <span className="text-[11px] font-bold tracking-[0.22em] text-[#e9eef2] uppercase">
                VOID // CONTROLS
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={randomizeScene}
                className="btn hud px-2 py-[3px] text-[8.5px] !text-[#00F0FF] border border-[#00F0FF]/40 bg-[#00F0FF]/15 hover:bg-[#00F0FF]/35 active:scale-95 transition-transform"
                title="Randomize scene aesthetics"
              >
                🔀 RANDOM
              </button>
              <button
                type="button"
                onClick={() => setDockOpen(false)}
                className="btn hud px-1.5 py-[3px] text-[9px] text-[#8b98a1] hover:text-white"
                title="Collapse Dock"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Aesthetic Look Presets */}
          <div className="space-y-1.5">
            <Label>LOOK PRESETS</Label>
            <div className="flex flex-wrap gap-1">
              {LOOK_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => patch(p.patch)}
                  className="btn hud px-2 py-[4px] text-[8.5px]"
                  title={`Recall the ${p.name.toLowerCase()} aesthetic`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 pt-1">
              <Toggle
                label="AUTO-PERF"
                on={settings.autoPerf}
                onClick={() => patch({ autoPerf: !settings.autoPerf })}
              />
              <Toggle
                label="AUTO-LOOK"
                on={settings.autoLook}
                onClick={() => patch({ autoLook: !settings.autoLook })}
              />
            </div>
          </div>

          {/* Palette Switcher Grid */}
          <div className="space-y-1.5">
            <Label right={`${settings.palette + 1}/${PALETTES.length}`}>PALETTE</Label>
            <div className="grid grid-cols-5 gap-1 max-h-[110px] overflow-y-auto custom-scrollbar p-1 bg-black/40 border border-white/5 rounded-lg">
              {PALETTES.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.name}
                  onClick={() => patch({ palette: i })}
                  data-active={settings.palette === i}
                  className="btn grid h-6 w-full place-items-center rounded-sm"
                >
                  <span
                    className="block h-3.5 w-3.5 rounded-[1px]"
                    style={{
                      background: `linear-gradient(135deg, ${p.hex[0]} 0%, ${p.hex[0]} 45%, ${p.hex[1]} 46%, ${p.hex[1]} 100%)`,
                      boxShadow: settings.palette === i ? `0 0 8px ${p.hex[0]}` : "none",
                    }}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Audio Input Source */}
          <div className="space-y-1.5">
            <Label>AUDIO SOURCE</Label>
            <div className="flex flex-wrap gap-1">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.hint}
                  onClick={() => onMode(s.id)}
                  data-active={mode === s.id}
                  className="btn hud px-2 py-[4px] text-[8.5px]"
                >
                  {s.label}
                </button>
              ))}
              <button
                type="button"
                onClick={pickFile}
                className="btn hud px-2 py-[4px] text-[8.5px]"
                title="Load an audio file"
              >
                ↧ LOAD
              </button>
              {mode === "synth" && (
                <button
                  type="button"
                  title="Tap to set synthesizer BPM"
                  onClick={() => {
                    const now = performance.now();
                    const g = window as any;
                    if (!g._tapTimes) g._tapTimes = [];
                    const times = g._tapTimes;
                    times.push(now);
                    if (times.length > 5) times.shift();

                    if (times.length >= 2) {
                      const intervals = [];
                      for (let i = 1; i < times.length; i++) {
                        intervals.push(times[i] - times[i - 1]);
                      }
                      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                      const bpm = 60000 / avg;
                      if (bpm > 40 && bpm < 300) {
                        audioState.synthBpm = Math.round(bpm);
                        import("../audio/AudioEngine").then((m) =>
                          m.engine.setSynthBPM(audioState.synthBpm),
                        );
                      }
                    }
                  }}
                  className="btn hud px-2 py-[4px] text-[8.5px] !text-[#00F0FF] border border-[#00F0FF]/30 bg-[#00F0FF]/10 hover:bg-[#00F0FF]/30"
                >
                  TAP BPM
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 pt-1">
              <span className="text-[8px] tracking-[0.16em] text-[#5c6870]">MIC EQ:</span>
              {["smooth", "standard", "dynamic", "hyper"].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => patch({ audioProfile: p as any })}
                  data-active={settings.audioProfile === p}
                  className="btn hud px-1.5 py-[2px] text-[7.5px]"
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px w-full bg-cyan-500/15" />

          {/* Dynamics & Reactivity */}
          <div className="space-y-2">
            <Label>DYNAMICS & REACTIVITY</Label>
            <Slider
              label="SENS"
              tooltip="Input gain multiplier fed into the audio analysis pipeline."
              value={settings.sensitivity}
              min={0.2}
              max={3}
              step={0.05}
              display={settings.sensitivity.toFixed(2)}
              onChange={(v) => {
                patch({ sensitivity: v });
                audioState.sensitivity = v;
              }}
            />
            <Slider
              label="SOFTENING"
              tooltip="Temporal low-pass filter on audio analysis data. 0.0 = sharp/aggressive beats; 1.0 = smooth/fluid morphing."
              value={settings.softening}
              min={0.0}
              max={1.0}
              step={0.05}
              display={settings.softening.toFixed(2)}
              onChange={(v) => patch({ softening: v })}
            />
            <Slider
              label="SPEED"
              tooltip="Time step multiplier (uTime). Accelerates all trigonometric fragment routines."
              value={settings.speed}
              min={0.1}
              max={3}
              step={0.05}
              display={settings.speed.toFixed(2)}
              onChange={(v) => patch({ speed: v })}
            />
            <Slider
              label="SHAKE"
              tooltip="Camera projection matrix displacement amplitude."
              value={settings.shake}
              min={0}
              max={3}
              step={0.05}
              display={settings.shake.toFixed(2)}
              onChange={(v) => patch({ shake: v })}
            />
            <Slider
              label="UI CONTRAST"
              tooltip="HUD panel background opacity & backdrop blur intensity."
              value={settings.uiContrast}
              min={0.2}
              max={1.0}
              step={0.05}
              display={settings.uiContrast.toFixed(2)}
              onChange={(v) => patch({ uiContrast: v })}
            />
          </div>

          <div className="h-px w-full bg-cyan-500/15" />

          {/* Post-Processing (Post-FX) */}
          <div className="space-y-2">
            <Label>POST-PROCESSING (POST-FX)</Label>
            <Slider
              label="BLOOM"
              tooltip="Global post-processing bloom energy multiplier."
              value={settings.bloom}
              min={0}
              max={2.5}
              step={0.05}
              display={settings.bloom.toFixed(2)}
              onChange={(v) => patch({ bloom: v })}
            />
            <Slider
              label="BLM THRESH"
              tooltip="Minimum luminance threshold for bloom activation."
              value={settings.bloomThreshold}
              min={0.0}
              max={1.0}
              step={0.02}
              display={settings.bloomThreshold.toFixed(2)}
              onChange={(v) => patch({ bloomThreshold: v })}
            />
            <Slider
              label="GAMMA"
              tooltip="Adjusts non-linear brightness response curve."
              value={settings.gamma}
              min={0.5}
              max={2.5}
              step={0.05}
              display={settings.gamma.toFixed(2)}
              onChange={(v) => patch({ gamma: v })}
            />
            <Slider
              label="CRYSTAL GLITCH"
              tooltip="Crystalline chromatic aberration prism distortion."
              value={settings.crystallineGlitch}
              min={0.0}
              max={3.0}
              step={0.05}
              display={settings.crystallineGlitch.toFixed(2)}
              onChange={(v) => patch({ crystallineGlitch: v })}
            />
            <div className="flex flex-col gap-[3px]">
              <div className="text-[8.5px] tracking-[0.15em] text-[#5c6870]">BLOOM PROFILE</div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="btn hud flex-1 py-[3px] text-[8px]"
                  onClick={() => patch({ bloomProfile: "soft" })}
                  data-active={settings.bloomProfile === "soft"}
                >
                  SOFT
                </button>
                <button
                  type="button"
                  className="btn hud flex-1 py-[3px] text-[8px]"
                  onClick={() => patch({ bloomProfile: "hard" })}
                  data-active={settings.bloomProfile === "hard"}
                >
                  HARD
                </button>
                <button
                  type="button"
                  className="btn hud flex-1 py-[3px] text-[8px]"
                  onClick={() => patch({ bloomProfile: "laser" })}
                  data-active={settings.bloomProfile === "laser"}
                >
                  LASER
                </button>
              </div>
            </div>
            <Slider
              label="ABERR"
              tooltip="Radial chromatic aberration RGB offset intensity."
              value={settings.aberration}
              min={0}
              max={3}
              step={0.05}
              display={settings.aberration.toFixed(2)}
              onChange={(v) => patch({ aberration: v })}
            />
            <Slider
              label="NOISE"
              tooltip="Analog CRT film grain overlay opacity multiplier."
              value={settings.noiseLevel}
              min={0}
              max={3}
              step={0.05}
              display={settings.noiseLevel.toFixed(2)}
              onChange={(v) => patch({ noiseLevel: v })}
            />
            <Slider
              label="TRAIL"
              tooltip="Adjusts frame-buffer retention and smearing."
              value={settings.trails}
              min={0}
              max={0.99}
              step={0.01}
              display={settings.trails.toFixed(2)}
              onChange={(v) => patch({ trails: v })}
            />
            <Slider
              label="STRB SPD"
              tooltip="LFO frequency (Hz) for the background strobe gate."
              value={settings.strobeSpeed}
              min={10}
              max={60}
              step={1}
              display={settings.strobeSpeed.toFixed(0)}
              onChange={(v) => patch({ strobeSpeed: v })}
            />
          </div>

          <div className="h-px w-full bg-cyan-500/15" />

          {/* Geometry & Rendering */}
          <div className="space-y-2">
            <Label>GEOMETRY & RENDERING</Label>
            <Slider
              label="MORPH"
              tooltip="Core 3D vertex noise displacement amplitude."
              value={settings.intensity}
              min={0}
              max={1.5}
              step={0.05}
              display={settings.intensity.toFixed(2)}
              onChange={(v) => patch({ intensity: v })}
            />
            <Slider
              label="FLUX"
              tooltip="Lightning line sprout amplitude & treble sensitivity."
              value={settings.flux}
              min={0}
              max={3}
              step={0.05}
              display={settings.flux.toFixed(2)}
              onChange={(v) => patch({ flux: v })}
            />
            <Slider
              label="CORE"
              tooltip="Scale factor for the central geometry mesh."
              value={settings.coreSize}
              min={0.5}
              max={2.5}
              step={0.05}
              display={settings.coreSize.toFixed(2)}
              onChange={(v) => patch({ coreSize: v })}
            />
            <Slider
              label="COLOR"
              tooltip="Palette hue rotation speed across 3D space."
              value={settings.colorShift}
              min={0}
              max={2}
              step={0.05}
              display={settings.colorShift.toFixed(2)}
              onChange={(v) => patch({ colorShift: v })}
            />
            <Slider
              label="FOV"
              tooltip="Perspective camera field of view in degrees."
              value={settings.fov}
              min={50}
              max={130}
              step={1}
              display={settings.fov.toFixed(0)}
              onChange={(v) => patch({ fov: v })}
            />
            <Slider
              label="PTCL SIZ"
              tooltip="Vertex shader point size multiplier."
              value={settings.particleSize}
              min={0.1}
              max={5.0}
              step={0.1}
              display={settings.particleSize.toFixed(1)}
              onChange={(v) => patch({ particleSize: v })}
            />
            <Slider
              label="PARTICLES"
              tooltip="Total active particle count in GPU buffer."
              value={settings.particles}
              min={10000}
              max={200000}
              step={5000}
              display={`${Math.round(settings.particles / 1000)}K`}
              onChange={(v) => patch({ particles: v })}
            />
            <div className="space-y-1">
              <Label>QUALITY</Label>
              <div className="flex gap-1">
                {(Object.keys(QUALITY_PRESETS) as QualityLevel[]).map((q) => (
                  <Toggle
                    key={q}
                    label={QUALITY_PRESETS[q].label}
                    on={settings.quality === q}
                    onClick={() =>
                      patch({ quality: q, particles: QUALITY_PRESETS[q].particles })
                    }
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="h-px w-full bg-cyan-500/15" />

          {/* Interactive 3D Layers */}
          <div className="space-y-1.5">
            <Label>3D SCENE LAYERS</Label>
            <div className="flex flex-wrap gap-1">
              <Toggle
                label="Q-POR"
                on={settings.quantumPortal}
                onClick={() => patch({ quantumPortal: !settings.quantumPortal })}
              />
              <Toggle
                label="N-SYN"
                on={settings.neuralSynapses}
                onClick={() => patch({ neuralSynapses: !settings.neuralSynapses })}
              />
              <Toggle
                label="SHP"
                on={settings.shape > 0}
                onClick={() => patch({ shape: (settings.shape + 1) % 12 })}
              />
              <Toggle
                label="LQD"
                on={settings.liquid}
                onClick={() => patch({ liquid: !settings.liquid })}
              />
              <Toggle
                label="FLX"
                on={settings.energyFlux}
                onClick={() => patch({ energyFlux: !settings.energyFlux })}
              />
              <Toggle
                label="VRX"
                on={settings.vortex}
                onClick={() => patch({ vortex: !settings.vortex })}
              />
              <Toggle
                label="GRD"
                on={settings.grid}
                onClick={() => patch({ grid: !settings.grid })}
              />
              <Toggle
                label="MAG"
                on={settings.magnetic}
                onClick={() => patch({ magnetic: !settings.magnetic })}
              />
              <Toggle
                label="RAY"
                on={settings.rays}
                onClick={() => patch({ rays: !settings.rays })}
              />
              <Toggle
                label="STRB"
                on={settings.strobeMode}
                onClick={() => patch({ strobeMode: !settings.strobeMode })}
              />
              <Toggle
                label="OBS"
                on={settings.obelisks}
                onClick={() => patch({ obelisks: !settings.obelisks })}
              />
              <Toggle
                label="M-CLK"
                on={settings.masterClock}
                onClick={() => patch({ masterClock: !settings.masterClock })}
              />
              <Toggle
                label="AUTO-HIDE"
                on={settings.autoHideUi}
                onClick={() => patch({ autoHideUi: !settings.autoHideUi })}
              />
              <Toggle
                label="TUN"
                on={settings.tunnel}
                onClick={() => patch({ tunnel: !settings.tunnel })}
              />
              <Toggle
                label="COR"
                on={settings.wireframe}
                onClick={() => patch({ wireframe: !settings.wireframe })}
              />
              <Toggle
                label="RNG"
                on={settings.rings}
                onClick={() => patch({ rings: !settings.rings })}
              />
              <Toggle
                label="PTS"
                on={settings.field}
                onClick={() => patch({ field: !settings.field })}
              />
              <Toggle
                label="LSR"
                on={settings.laser}
                onClick={() => patch({ laser: !settings.laser })}
              />
              <Toggle
                label="STR"
                on={settings.strobes}
                onClick={() => patch({ strobes: !settings.strobes })}
              />
              <Toggle
                label="EQ"
                on={settings.towers}
                onClick={() => patch({ towers: !settings.towers })}
              />
              <Toggle
                label="FLR"
                on={settings.glow}
                onClick={() => patch({ glow: !settings.glow })}
              />
              <Toggle
                label="GLT"
                on={settings.glitch}
                onClick={() => patch({ glitch: !settings.glitch })}
              />
            </div>
          </div>

          <div className="h-px w-full bg-cyan-500/15" />

          {/* Deck Transport Bar */}
          <Transport
            playing={playing}
            onToggle={onToggle}
            volume={volume}
            onVolume={onVolume}
            fileName={fileName}
            mode={mode}
          />

          <div className="h-px w-full bg-cyan-500/15" />

          {/* Dedicated VJ Snapshot Utility Button */}
          <button
            type="button"
            onClick={() => {
              const canvas = perfBridge.canvas;
              if (!canvas) return;
              try {
                const url = canvas.toDataURL("image/png");
                const a = document.createElement("a");
                a.href = url;
                a.download = "yaslogist-soundvis-preview.png";
                document.body.appendChild(a);
                a.click();
                a.remove();
              } catch (err) {
                console.error("Snapshot capture error:", err);
              }
            }}
            className="w-full py-2.5 px-3 rounded-xl border border-cyan-400/40 bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 hover:from-cyan-500/35 hover:via-blue-500/35 hover:to-purple-500/35 active:scale-[0.98] transition-all duration-200 text-cyan-300 font-bold text-[10px] tracking-[0.2em] uppercase flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(0,240,255,0.15)] cursor-pointer"
            title="Capture WebGL canvas preview for promo and GitHub README"
          >
            <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#00F0FF]" />
            <span>[CAPTURE SNAPSHOT]</span>
          </button>
        </div>
      )}

      {/* ── recording frame ────────────────────────────────────────────── */}
      {recording ? (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div
            className="absolute inset-0 border-2"
            style={{ borderColor: "rgba(255,59,92,0.55)" }}
          />
          <div className="absolute top-3 left-1/2 -translate-x-1/2 border border-[#FF3B5C]/60 bg-black/60 px-3 py-1">
            <span className="hud text-[9px] text-[#FF3B5C]">
              ● REC {recordSeconds.toFixed(1)}S · 60FPS
            </span>
          </div>
        </div>
      ) : null}

      {/* ── toasts ─────────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute top-20 right-3 z-30 flex w-[min(340px,calc(100vw-24px))] flex-col gap-2 sm:right-5">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onDismiss(t.id)}
            className="panel rise pointer-events-auto border-l-2 p-3 text-left"
            style={{
              borderLeftColor:
                t.tone === "error" ? "#FF3B5C" : t.tone === "ok" ? "#00FF9C" : "var(--accent)",
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="block h-1.5 w-1.5"
                style={{
                  background:
                    t.tone === "error" ? "#FF3B5C" : t.tone === "ok" ? "#00FF9C" : "var(--accent)",
                }}
              />
              <span className="hud text-[10px] text-[#e9eef2]">{t.title}</span>
            </div>
            {t.body ? (
              <p className="mt-1.5 text-[10px] leading-relaxed tracking-normal normal-case text-[#8b98a1]">
                {t.body}
              </p>
            ) : null}
          </button>
        ))}
      </div>
    </>
  );
}

export const Hud = memo(HudInner);
