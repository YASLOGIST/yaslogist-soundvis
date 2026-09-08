import { advanceBeatClock, estimateBpm } from "./bpm";
import { DemoSynth } from "./DemoSynth";
import { audioState, clamp, lerp, resetAudioState, type InputMode } from "./state";

export interface AudioEngineError {
  code:
    | "NOT_SUPPORTED"
    | "MIC_DENIED"
    | "MIC_UNAVAILABLE"
    | "SYSTEM_DENIED"
    | "SYSTEM_NO_AUDIO"
    | "FILE_DECODE"
    | "CONTEXT_FAILED"
    | "UNKNOWN";
  message: string;
}

const FFT_SIZE = 1024; // as specified → 512 frequency bins
const SMOOTHING = 0.82; // as specified

// Band edges in Hz. Resolution = sampleRate / fftSize (≈46.9 Hz @ 48 kHz).
const BANDS = {
  sub: [20, 120] as const,
  bass: [120, 400] as const,
  mid: [400, 2500] as const,
  high: [5000, 16000] as const,
};

type BandKey = keyof typeof BANDS;

export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private inputGain: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private silentSink: GainNode | null = null;

  private freqData = new Uint8Array(512);
  private floatFreq = new Float32Array(512);
  private timeData = new Float32Array(1024);

  private bandHistory: Record<BandKey, number[]> = { sub: [], bass: [], mid: [], high: [] };
  private smoothed: Record<BandKey, number> = { sub: 0, bass: 0, mid: 0, high: 0 };
  private beatTimes: number[] = [];
  private lastBeatAt = -1;
  private beatEnergy = 0;
  private adaptiveMax = 0.25;
  /** Phase-continuous musical clock in beats — tempo changes never jump it. */
  private beatClock = 0;
  /** Last tempo estimate with confidence, for AUTO-BPM display. */
  bpmConfidence = 0;

  private stream: MediaStream | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private mediaEl: HTMLAudioElement | null = null;
  private sourceNode: AudioNode | null = null;
  private objectUrl: string | null = null;
  private synth: DemoSynth | null = null;

  mode: InputMode | null = null;
  fileMeta = { name: "", duration: 0 };
  /** Desired monitor level (0..1). Suppressed for capture-only sources. */
  volume = 0.85;
  private monitorEnabled = true;
  onError: ((err: AudioEngineError) => void) | null = null;

  // ── context lifecycle ────────────────────────────────────────────────────

  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        throw this.fail("NOT_SUPPORTED", "Web Audio API is not supported in this browser.");
      }
      try {
        this.ctx = new Ctor({ latencyHint: "interactive" });
      } catch {
        throw this.fail("CONTEXT_FAILED", "Could not create the AudioContext.");
      }
    }
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        throw this.fail("CONTEXT_FAILED", "AudioContext was blocked — tap anywhere to retry.");
      }
    }
    if (!this.analyser) this.buildGraph();
    return this.ctx;
  }

  private buildGraph() {
    const ctx = this.ctx!;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = SMOOTHING;
    this.analyser.minDecibels = -95;
    this.analyser.maxDecibels = -12;

    this.inputGain = ctx.createGain();
    this.inputGain.gain.value = 1;

    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 0.85;

    // keeps the analyser pulling even for non-monitorable sources (mic),
    // while staying completely silent (no feedback loop).
    this.silentSink = ctx.createGain();
    this.silentSink.gain.value = 0;
    this.silentSink.connect(ctx.destination);

    this.inputGain.connect(this.analyser);
    this.analyser.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);
    this.analyser.connect(this.silentSink);
  }

  /**
   * Microphone / line-in monitoring is disabled to prevent feedback howl.
   * The desired volume is remembered so switching back re-applies it.
   */
  setSynthBPM(bpm: number) {
    if (this.synth) {
      this.synth.setBPM(bpm);
    }
  }

  setMonitoring(on: boolean) {
    this.monitorEnabled = on;
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.monitorGain || !this.ctx) return;
    const target = this.monitorEnabled ? clamp(this.volume, 0, 1) : 0.0001;
    this.monitorGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.monitorGain.gain.setTargetAtTime(Math.max(0.0001, target), this.ctx.currentTime, 0.05);
  }

  private disconnectSource() {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        /* noop */
      }
      this.sourceNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.synth) {
      this.synth.dispose();
      this.synth = null;
    }
    if (this.mediaEl) {
      this.mediaEl.pause();
      this.mediaEl.src = "";
      this.mediaEl = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  // ── input modes ──────────────────────────────────────────────────────────

  async start(mode: InputMode, file?: File): Promise<void> {
    const ctx = await this.ensureContext();
    this.disconnectSource();
    resetAudioState();
    this.beatTimes = [];
    this.beatClock = 0;
    this.bpmConfidence = 0;
    this.mode = mode;

    switch (mode) {
      case "synth": {
        this.synth = new DemoSynth(ctx);
        this.sourceNode = this.synth.output;
        this.sourceNode.connect(this.inputGain!);
        this.synth.start();
        this.setMonitoring(true);
        break;
      }
      case "mic": {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw this.fail("NOT_SUPPORTED", "Microphone capture is unavailable (needs HTTPS).");
        }
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            video: false,
          });
        } catch (err) {
          const name = (err as DOMException)?.name ?? "";
          if (name === "NotAllowedError" || name === "SecurityError") {
            throw this.fail("MIC_DENIED", "Microphone permission denied. Enable it in the browser bar.");
          }
          if (name === "NotFoundError" || name === "OverconstrainedError") {
            throw this.fail("MIC_UNAVAILABLE", "No input device found.");
          }
          throw this.fail("MIC_UNAVAILABLE", "Microphone could not be started.");
        }
        const src = ctx.createMediaStreamSource(this.stream);
        this.sourceNode = src;
        src.connect(this.inputGain!);
        this.setMonitoring(false);
        break;
      }
      case "system": {
        const md = navigator.mediaDevices as MediaDevices & {
          getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
        };
        if (!md?.getDisplayMedia) {
          throw this.fail("NOT_SUPPORTED", "System-audio capture is not supported by this browser.");
        }
        try {
          this.stream = await md.getDisplayMedia({ video: true, audio: true });
        } catch {
          throw this.fail("SYSTEM_DENIED", "Screen/System-audio share was cancelled or blocked.");
        }
        if (this.stream.getAudioTracks().length === 0) {
          this.stream.getTracks().forEach((t) => t.stop());
          this.stream = null;
          throw this.fail(
            "SYSTEM_NO_AUDIO",
            'No audio track shared. Re-select the tab and tick "Share tab audio".',
          );
        }
        this.stream.getAudioTracks()[0].addEventListener("ended", () => {
          this.onError?.({
            code: "SYSTEM_NO_AUDIO",
            message: "System-audio share ended.",
          });
        });
        const src = ctx.createMediaStreamSource(this.stream);
        this.sourceNode = src;
        src.connect(this.inputGain!);
        this.setMonitoring(false);
        break;
      }
      case "file": {
        if (!file) throw this.fail("FILE_DECODE", "No file provided.");
        const el = new Audio();
        el.preload = "auto";
        el.loop = true;
        el.crossOrigin = "anonymous";
        this.objectUrl = URL.createObjectURL(file);
        el.src = this.objectUrl;
        this.mediaEl = el;
        await new Promise<void>((resolve, reject) => {
          const ok = () => resolve();
          const bad = () =>
            reject(this.fail("FILE_DECODE", `Could not decode "${file.name}". Try MP3/WAV/OGG/FLAC.`));
          el.addEventListener("loadedmetadata", ok, { once: true });
          el.addEventListener("error", bad, { once: true });
          window.setTimeout(() => (el.readyState >= 1 ? resolve() : bad()), 12000);
        });
        const src = ctx.createMediaElementSource(el);
        this.sourceNode = src;
        src.connect(this.inputGain!);
        this.setMonitoring(true);
        try {
          await el.play();
        } catch {
          /* autoplay guard — user can press play in the transport */
        }
        this.fileMeta = { name: file.name, duration: el.duration || 0 };
        break;
      }
    }
    audioState.active = true;
  }

  stop() {
    this.disconnectSource();
    this.mode = null;
    audioState.active = false;
    resetAudioState();
  }

  // ── transport (file mode) ────────────────────────────────────────────────

  get transport(): HTMLAudioElement | null {
    return this.mediaEl;
  }

  /**
   * A MediaStream carrying the analysed source signal — used by the video
   * recorder so captures include the music, whatever the input mode is.
   */
  get audioStream(): MediaStream | null {
    if (!this.ctx || !this.analyser) return null;
    if (!this.streamDest) {
      this.streamDest = this.ctx.createMediaStreamDestination();
      try {
        this.analyser.connect(this.streamDest);
      } catch {
        return null;
      }
    }
    return this.streamDest.stream;
  }

  togglePlay(): boolean {
    const el = this.mediaEl;
    if (!el) {
      if (this.mode === "synth") {
        if (this.synth?.running) {
          this.synth.stop();
          audioState.active = false;
          return false;
        }
        if (this.synth) {
          this.synth.start();
          audioState.active = true;
          return true;
        }
        void this.start("synth");
        return true;
      }
      return false;
    }
    if (el.paused) {
      void el.play().catch(() => undefined);
      return true;
    }
    el.pause();
    return false;
  }

  seek(t: number) {
    const el = this.mediaEl;
    if (el && Number.isFinite(el.duration)) el.currentTime = clamp(t, 0, el.duration);
  }

  setVolume(v: number) {
    this.volume = clamp(v);
    this.applyVolume();
  }

  setInputGain(v: number) {
    if (this.inputGain && this.ctx) {
      this.inputGain.gain.setTargetAtTime(clamp(v, 0.05, 8), this.ctx.currentTime, 0.05);
    }
  }

  // ── per-frame analysis ───────────────────────────────────────────────────

  /** Band energy 0..1 with log-scaled bin weighting. */
  private bandEnergy(fromHz: number, toHz: number): number {
    const ctx = this.ctx;
    if (!ctx || !this.analyser) return 0;
    const nyquist = ctx.sampleRate / 2;
    const bins = this.analyser.frequencyBinCount;
    const lo = clamp(Math.floor((fromHz / nyquist) * bins), 0, bins - 1);
    const hi = clamp(Math.ceil((toHz / nyquist) * bins), lo + 1, bins);
    let sum = 0;
    let weight = 0;
    for (let i = lo; i < hi; i++) {
      // perceptual tilt: lift the low bins which carry far less energy per bin
      const w = 1 + (i / bins) * 1.6;
      const v = this.freqData[i] / 255;
      sum += v * v * w;
      weight += w;
    }
    return weight > 0 ? Math.sqrt(sum / weight) : 0;
  }

  update(
    dt: number,
    elapsed: number,
    profile: "smooth" | "standard" | "dynamic" | "hyper" = "dynamic",
  ): void {
    // apply smooth beat decay
    if (audioState.beat > 0) {
      audioState.beat = Math.max(0, audioState.beat - dt * 4.5);
    }

    if (!this.analyser) {
      audioState.beat *= 0.9;
      audioState.time = elapsed;
      return;
    }

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getFloatFrequencyData(this.floatFreq);
    this.analyser.getFloatTimeDomainData(this.timeData);

    const wf = audioState.waveform;
    let rms = 0;
    const stride = Math.max(1, Math.floor(this.timeData.length / wf.length));
    for (let i = 0; i < wf.length; i++) {
      const v = this.timeData[i * stride] ?? 0;
      wf[i] = v;
      rms += v * v;
    }
    rms = Math.sqrt(rms / wf.length);

    // Profile-based AGC (Automatic Gain Control)
    const targetMax = Math.max(0.035, rms * (profile === "hyper" ? 4.5 : profile === "smooth" ? 2.5 : 3.5));
    const agcRelease = profile === "hyper" ? 0.003 : profile === "smooth" ? 0.001 : 0.0015;
    const agcAttack = profile === "hyper" ? 0.15 : profile === "smooth" ? 0.04 : 0.08;
    this.adaptiveMax = lerp(
      this.adaptiveMax,
      targetMax,
      targetMax < this.adaptiveMax ? agcAttack : agcRelease,
    );

    const sens = audioState.sensitivity * (profile === "hyper" ? 1.4 : profile === "smooth" ? 1.1 : 1.25);
    const raw: Record<BandKey, number> = {
      sub: this.bandEnergy(BANDS.sub[0], BANDS.sub[1]),
      bass: this.bandEnergy(BANDS.bass[0], BANDS.bass[1]),
      mid: this.bandEnergy(BANDS.mid[0], BANDS.mid[1]),
      high: this.bandEnergy(BANDS.high[0], BANDS.high[1]),
    };

    // per-band attack / release envelopes based on profile
    let attack: Record<BandKey, number>;
    let release: Record<BandKey, number>;

    if (profile === "smooth") {
      attack = { sub: 0.25, bass: 0.2, mid: 0.15, high: 0.25 };
      release = { sub: 0.05, bass: 0.04, mid: 0.03, high: 0.03 };
    } else if (profile === "hyper") {
      attack = { sub: 0.85, bass: 0.75, mid: 0.65, high: 0.85 };
      release = { sub: 0.25, bass: 0.2, mid: 0.15, high: 0.15 };
    } else if (profile === "standard") {
      attack = { sub: 0.45, bass: 0.35, mid: 0.25, high: 0.4 };
      release = { sub: 0.1, bass: 0.08, mid: 0.06, high: 0.05 };
    } else {
      // dynamic (default)
      attack = { sub: 0.55, bass: 0.45, mid: 0.35, high: 0.5 };
      release = { sub: 0.12, bass: 0.1, mid: 0.08, high: 0.07 };
    }

    (Object.keys(raw) as BandKey[]).forEach((k) => {
      const target = clamp((raw[k] / this.adaptiveMax) * sens);
      const prev = this.smoothed[k];
      let coeff = target > prev ? attack[k] : release[k];

      // Apply frequency softening (0 = aggressive/instant, 1 = extremely smooth)
      const soft = audioState.softening;
      // map soft (0..1) to a multiplier for the interpolation coefficient
      // 0 -> coeff * 4.0 (very fast)
      // 1 -> coeff * 0.1 (very slow)
      const mult = soft < 0.5 ? lerp(4.0, 1.0, soft * 2.0) : lerp(1.0, 0.1, (soft - 0.5) * 2.0);
      coeff *= mult;

      this.smoothed[k] = lerp(prev, target, clamp(coeff * (dt * 60), 0, 1));
      // rolling history for transient detection
      const hist = this.bandHistory[k];
      hist.push(raw[k]);
      if (hist.length > 48) hist.shift();
    });

    audioState.sub = this.smoothed.sub;
    audioState.bass = this.smoothed.bass;
    audioState.mid = this.smoothed.mid;
    audioState.high = this.smoothed.high;
    audioState.level = clamp(rms * 2.6 * sens);
    audioState.time = elapsed;
    const activeBpm = audioState.bpm > 40 ? audioState.bpm : audioState.synthBpm || 132;
    this.beatClock = advanceBeatClock(this.beatClock, dt, activeBpm);
    audioState.masterBeat = this.beatClock;
    audioState.beatPhase = this.beatClock % 1.0;

    // spectrum mirror for the HUD (already 0..255)
    audioState.spectrum.set(this.freqData.subarray(0, audioState.spectrum.length));

    // ── beat detection on the sub/kick band ────────────────────────────────
    const hist = this.bandHistory.sub;
    const n = hist.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += hist[i];
    mean = n ? mean / n : 0;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (hist[i] - mean) ** 2;
    variance = n ? variance / n : 0;

    const energy = raw.sub;
    this.beatEnergy = lerp(this.beatEnergy, energy, 0.4);
    const now = this.ctx?.currentTime ?? 0;
    const threshold = mean * (1.15 - clamp(variance * 15, 0, 0.28)) + 0.008;
    const sinceLast = now - this.lastBeatAt;

    if (energy > threshold && energy > 0.035 && sinceLast > 0.18) {
      audioState.beat = 1;
      audioState.beats += 1;
      if (this.lastBeatAt > 0) {
        this.beatTimes.push(sinceLast);
        if (this.beatTimes.length > 16) this.beatTimes.shift();
        const estimate = estimateBpm(this.beatTimes);
        if (estimate) {
          this.bpmConfidence = estimate.confidence;
          // only steering when reasonably locked — avoids drunken tempo drift
          if (estimate.confidence > 0.55) {
            audioState.bpm = audioState.bpm ? lerp(audioState.bpm, estimate.bpm, 0.2) : estimate.bpm;
          }
        }
      }
      this.lastBeatAt = now;
    } else if (sinceLast > 2.5) {
      audioState.bpm = lerp(audioState.bpm, 0, 0.05);
      this.bpmConfidence = Math.max(0, this.bpmConfidence - dt * 0.5);
    }

    audioState.beat = Math.max(0, audioState.beat - dt * 2.9);
    audioState.groove = clamp(1 - variance * 30) * (this.beatTimes.length > 4 ? 1 : 0.35);
  }

  private fail(code: AudioEngineError["code"], message: string): Error & { code: string } {
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    return err;
  }
}

export const engine = new AudioEngine();
