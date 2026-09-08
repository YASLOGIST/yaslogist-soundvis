/**
 * DemoSynth — a fully procedural peak-time / industrial techno generator.
 *
 * Why: a visualizer is useless without signal. Instead of shipping audio assets
 * we synthesise a deterministic 132 BPM loop directly on the Web Audio graph:
 *   · pitched-sub kick with transient click
 *   · 16th-note acid bassline (saw → resonant LP with envelope + slide)
 *   · noisy industrial hats / claps from a white-noise buffer
 *   · detuned chord stabs feeding a feedback delay (dub techno vibe)
 *   · long noise sweeps every 8 bars for build-ups
 */

const LOOKAHEAD = 0.12; // seconds scheduled ahead of the audio clock
const TICK = 25; // scheduler interval (ms)

interface Deferred {
  stop(): void;
}

export class DemoSynth {
  private ctx: AudioContext;
  private out: GainNode;
  private noise: AudioBuffer;
  private timer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private bpm = 132;

  setBPM(bpm: number) {
    this.bpm = Math.max(60, Math.min(200, bpm));
  }

  getBPM() {
    return this.bpm;
  }
  private running_ = false;
  private delay: DelayNode;
  private delayFb: GainNode;
  private delayFilter: BiquadFilterNode;
  private nodes = new Set<AudioScheduledSourceNode>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.0;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(this.out);

    // dub-style feedback delay bus
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = (60 / this.bpm) * 0.75;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.38;
    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = "lowpass";
    this.delayFilter.frequency.value = 2400;
    this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delayFilter.connect(comp);

    this.noise = this.createNoise();
  }

  get output(): AudioNode {
    return this.out;
  }

  get running(): boolean {
    return this.running_;
  }

  private createNoise(): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Minor pentatonic-ish acid line, 16 steps per bar. */
  private static PATTERN = [0, -1, 12, 0, 7, -1, 3, 5, 0, 12, -1, 7, 10, -1, 3, 0];

  start() {
    if (this.running_) return;
    this.running_ = true;
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.out.gain.linearRampToValueAtTime(0.9, this.ctx.currentTime + 0.6);
    this.timer = window.setInterval(() => this.scheduler(), TICK);
  }

  stop() {
    this.running_ = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.0001, t + 0.25);
    this.nodes.forEach((n) => {
      try {
        n.stop(t + 0.3);
      } catch {
        /* already stopped */
      }
    });
    this.nodes.clear();
  }

  dispose() {
    this.stop();
    try {
      this.out.disconnect();
    } catch {
      /* noop */
    }
  }

  private scheduler() {
    if (!this.running_) return;
    const spb = 60 / this.bpm / 4; // 16th note
    while (this.nextNoteTime < this.ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  private track(node: AudioScheduledSourceNode, stopAt: number) {
    node.stop(stopAt);
    node.onended = () => this.nodes.delete(node);
    this.nodes.add(node);
  }

  private playStep(step: number, t: number) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);

    if (s16 % 4 === 0) this.kick(t, s16 === 0 ? 1 : 0.92);
    if (s16 === 14 && bar % 4 === 3) this.kick(t, 0.7);

    if (s16 === 4 || s16 === 12) this.clap(t, s16 === 12 ? 0.85 : 0.6);

    // hats: offbeat 8ths + ghost 16ths
    if (s16 % 4 === 2) this.hat(t, 0.55, true);
    else if (s16 % 2 === 1) this.hat(t, 0.28, false);
    if (bar % 2 === 1 && s16 === 15) this.hat(t, 0.4, true);

    // acid bass
    const note = DemoSynth.PATTERN[s16];
    if (note >= 0) {
      const accent = s16 % 4 === 0 ? 1 : 0.72;
      const freq = 55 * Math.pow(2, note / 12);
      this.acid(t, freq, accent, s16 % 8 > 5);
    }

    // chord stab every 2 bars
    if (s16 === 0 && bar % 2 === 0) this.stab(t);
    if (s16 === 10 && bar % 4 === 2) this.stab(t, 0.5);

    // riser sweep each 8-bar phrase
    if (step === 48) this.sweep(t, 3.6);
  }

  // ── instruments ───────────────────────────────────────────────────────────

  private kick(t: number, vel: number) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;

    osc.type = "sine";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.055);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.32);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vel * 1.05, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);

    osc.connect(gain);
    gain.connect(shaper);
    shaper.connect(this.out);
    osc.start(t);
    this.track(osc, t + 0.45);

    // metallic transient
    const click = ctx.createBufferSource();
    click.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1600;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(vel * 0.32, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    click.connect(hp);
    hp.connect(cg);
    cg.connect(this.out);
    click.start(t, Math.random());
    this.track(click, t + 0.05);
  }

  private hat(t: number, vel: number, open: boolean) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1.4;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7200;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 10500;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    const dur = open ? 0.16 : 0.035;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(this.out);
    src.start(t, Math.random());
    this.track(src, t + dur + 0.02);
  }

  private clap(t: number, vel: number) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1750;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.55, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.out);
    src.start(t, Math.random());
    this.track(src, t + 0.2);
  }

  private acid(t: number, freq: number, vel: number, slide: boolean) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(slide ? freq * 0.72 : freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.045);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 13;
    const peak = 380 + vel * 1500 + Math.random() * 500;
    lp.frequency.setValueAtTime(peak * 1.6, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(180, peak * 0.28), t + 0.14);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.26, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);

    osc.connect(lp);
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.delay);
    osc.start(t);
    this.track(osc, t + 0.2);
  }

  private stab(t: number, vel = 1) {
    const ctx = this.ctx;
    const base = 110;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3600, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.15, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);

    [0, 7, 12, 15].forEach((semi, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 === 0 ? "sawtooth" : "square";
      o.frequency.value = base * Math.pow(2, semi / 12);
      o.detune.value = (i - 1.5) * 8;
      o.connect(lp);
      o.start(t);
      this.track(o, t + 0.8);
    });
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.delay);
  }

  private sweep(t: number, dur: number) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.out);
    src.start(t);
    this.track(src as AudioScheduledSourceNode, t + dur + 0.2);
  }
}

export type { Deferred };
