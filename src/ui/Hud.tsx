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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1">
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

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const isFile = mode === "file" && !!engine.transport;
  const progress = isFile && duration ? (time / duration) * 100 : 0;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        data-active={playing}
        className="btn grid h-9 w-9 shrink-0 place-items-center"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <span className="flex gap-[3px]">
            <span className="block h-3 w-[3px] bg-current" />
            <span className="block h-3 w-[3px] bg-current" />
          </span>
        ) : (
          <span className="ml-[2px] block h-0 w-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-current" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-[9px] tracking-[0.16em] text-[#5c6870] uppercase">
          <span className="truncate">{fileName || (mode === "synth" ? "INTERNAL SYNTH · 132 BPM" : mode ?? "IDLE")}</span>
          <span className="tabular-nums">
            {isFile ? `${fmt(time)} / ${fmt(duration)}` : fmt(time)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={progress}
          style={{ ["--pct" as string]: `${progress}%` }}
          onChange={(e) => seek(parseFloat(e.target.value))}
          aria-label="Seek"
          className={isFile ? "" : "pointer-events-none opacity-40"}
        />
      </div>

      <div className="hidden w-20 shrink-0 sm:block">
        <Label right={`${Math.round(volume * 100)}`}>VOL</Label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          style={{ ["--pct" as string]: `${volume * 100}%` }}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          aria-label="Volume"
        />
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

  // the governor runs outside React — poll its level at a human rate
  useEffect(() => {
    const id = window.setInterval(() => setGovernor(perfBridge.governorLevel), 500);
    return () => window.clearInterval(id);
  }, []);

  const pickFile = useCallback(() => fileInput.current?.click(), []);

  useEffect(() => {
    if (mode === "file" && fileName) setHint(`DECK LOADED · ${fileName.toUpperCase()}`);
    else if (mode === "mic") setHint("LIVE INPUT — MONITORING MUTED TO PREVENT FEEDBACK");
    else if (mode === "system") setHint("SYSTEM BUS CAPTURED");
    else if (mode === "synth") setHint("INTERNAL GENERATOR ONLINE — DROP AN AUDIO FILE ANYWHERE");
  }, [mode, fileName]);

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

      <div
        className={`fade-ui pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3 sm:p-5 ${
          hidden ? "ui-hidden" : ""
        }`}
      >
        {/* ── top row ──────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3">
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
                    FFT 1024 · SMOOTH 0.82 · WEBGL2
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden md:block">
              <Readouts />
            </div>
          </div>

          <div className="pointer-events-auto rise flex items-center gap-2">
            {/* palette switcher — 10 looks in a 5×2 grid */}
            <div className="panel grid grid-cols-5 gap-1 p-1">
              {PALETTES.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.name}
                  onClick={() => patch({ palette: i })}
                  data-active={settings.palette === i}
                  className="btn grid h-7 w-7 place-items-center"
                >
                  <span
                    className="block h-3.5 w-3.5"
                    style={{
                      background: `linear-gradient(135deg, ${p.hex[0]} 0%, ${p.hex[0]} 45%, ${p.hex[1]} 46%, ${p.hex[1]} 100%)`,
                      boxShadow: settings.palette === i ? `0 0 10px ${p.hex[0]}` : "none",
                    }}
                  />
                </button>
              ))}
            </div>
            <div className="panel flex items-center gap-1 p-1">
              <button
                type="button"
                onClick={onToggleRecord}
                disabled={!captureReady}
                data-active={recording}
                className="btn hud flex items-center gap-1.5 px-2 py-[6px] text-[9px] disabled:opacity-30"
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
                className="btn hud px-2 py-[6px] text-[9px]"
                title="Save PNG still (P)"
              >
                PNG
              </button>
              <button type="button" onClick={onHelp} className="btn hud px-2 py-[6px] text-[9px]" title="Shortcuts (?)">
                ?
              </button>
            </div>
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

        {/* ── mobile readouts ─────────────────────────────────────────── */}
        <div className="pointer-events-auto md:hidden">
          <Readouts />
        </div>

        {/* ── bottom console ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="pointer-events-auto rise hidden items-center gap-2 md:flex">
            <div className="panel px-2.5 py-1 text-[9px] tracking-[0.2em] text-[#5c6870]">{hint}</div>
            <div className="panel px-2.5 py-1 text-[9px] tracking-[0.2em] text-[#5c6870]">
              SPACE PLAY · H UI · F FULL · 1-4 PALETTE
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            {/* left: analysis */}
            <div className="panel bracket rise flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-end">
              <div className="shrink-0">
                <Label right={`${audioState.spectrum.length} BIN`}>SPECTRUM</Label>
                <canvas
                  ref={(el) => {
                    hudBridge.scope = el;
                  }}
                  width={320}
                  height={54}
                  className="mt-1.5 block h-[54px] w-full max-w-[320px] border border-white/5 bg-black/50"
                />
              </div>

              <div className="hidden shrink-0 md:block">
                <Label right="TIME DOMAIN">SCOPE</Label>
                <canvas
                  ref={(el) => {
                    hudBridge.wave = el;
                  }}
                  width={150}
                  height={54}
                  className="mt-1.5 block h-[54px] w-[150px] border border-white/5 bg-black/50"
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    ref={(el) => {
                      hudBridge.beat = el;
                    }}
                    className="block h-2 w-2 rounded-full"
                    style={{ background: "var(--accent)", boxShadow: "0 0 12px var(--accent)", opacity: 0.2 }}
                  />
                  <span className="text-[9px] tracking-[0.2em] text-[#5c6870]">
                    {settings.autoPerf ? "AUTO-PERF ARMED" : "MANUAL PERF"}
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

            {/* right: controls */}
            <div className="panel bracket rise flex flex-col gap-3 p-3">
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[9px] tracking-[0.2em] text-[#5c6870]">LOOK</span>
                {LOOK_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => patch(p.patch)}
                    className="btn hud px-2 py-[5px] text-[9px]"
                    title={`Recall the ${p.name.toLowerCase()} aesthetic`}
                  >
                    {p.name}
                  </button>
                ))}
                <span className="mx-1 h-4 w-px bg-white/10" />
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

              <div className="h-px w-full bg-white/8" />

              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[9px] tracking-[0.2em] text-[#5c6870]">SRC</span>
                {SOURCES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.hint}
                    onClick={() => onMode(s.id)}
                    data-active={mode === s.id}
                    className="btn hud px-2 py-[5px] text-[9px]"
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={pickFile}
                  className="btn hud px-2 py-[5px] text-[9px]"
                  title="Load an audio file"
                >
                  ↧ LOAD
                </button>
              </div>

              <div className="h-px w-full bg-white/8" />

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <Slider
                  label="SENS"
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
                  label="BLOOM"
                  value={settings.bloom}
                  min={0}
                  max={2.5}
                  step={0.05}
                  display={settings.bloom.toFixed(2)}
                  onChange={(v) => patch({ bloom: v })}
                />
                <Slider
                  label="MORPH"
                  value={settings.intensity}
                  min={0}
                  max={1.5}
                  step={0.05}
                  display={settings.intensity.toFixed(2)}
                  onChange={(v) => patch({ intensity: v })}
                />
                <Slider
                  label="PARTICLES"
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
                <div className="space-y-1">
                  <Label>LAYERS</Label>
                  <div className="flex flex-wrap gap-1">
                    <Toggle label="TUN" on={settings.tunnel} onClick={() => patch({ tunnel: !settings.tunnel })} />
                    <Toggle label="PTS" on={settings.field} onClick={() => patch({ field: !settings.field })} />
                    <Toggle label="STR" on={settings.strobes} onClick={() => patch({ strobes: !settings.strobes })} />
                    <Toggle label="EQ" on={settings.towers} onClick={() => patch({ towers: !settings.towers })} />
                    <Toggle label="FLR" on={settings.glow} onClick={() => patch({ glow: !settings.glow })} />
                    <Toggle label="GLT" on={settings.glitch} onClick={() => patch({ glitch: !settings.glitch })} />
                  </div>
                </div>
              </div>

              <div className="h-px w-full bg-white/8" />
              <Transport
                playing={playing}
                onToggle={onToggle}
                volume={volume}
                onVolume={onVolume}
                fileName={fileName}
                mode={mode}
              />
            </div>
          </div>
        </div>
      </div>

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
