import { useFrame, useThree, createPortal } from "@react-three/fiber";
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Glitch,
  Noise,
  Scanline,
  Vignette,
  wrapEffect,
} from "@react-three/postprocessing";
import {
  BlendFunction,
  Effect,
  GlitchMode,
  type BloomEffect,
  type ChromaticAberrationEffect,
  type GlitchEffect,
  type NoiseEffect,
  type ScanlineEffect,
  type VignetteEffect,
} from "postprocessing";
import { limitFlash, limitPunch, limitStrobeRate } from "./safety";

const GammaShader = {
  fragmentShader: /* glsl */ `
    uniform float uGamma;
    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
      vec3 col = max(vec3(0.0), inputColor.rgb);
      outputColor = vec4(pow(col, vec3(1.0 / max(0.01, uGamma))), inputColor.a);
    }
  `,
};

class CustomGammaEffect extends Effect {
  constructor({ gamma = 1.0 } = {}) {
    super("CustomGammaEffect", GammaShader.fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([["uGamma", new THREE.Uniform(gamma)]]),
    });
  }
}

export const CustomGamma = wrapEffect(CustomGammaEffect);
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { engine } from "../audio/AudioEngine";
import { clearFault, onRenderFault } from "../ui/faultBus";
import {
  PALETTES,
  QUALITY_PRESETS,
  audioState,
  hudBridge,
  lerp,
  perfBridge,
  type VisualSettings,
} from "../audio/state";
import {
  CORE_FRAG,
  CORE_VERT,
  GLOW_FRAG,
  GLOW_VERT,
  VORTEX_VERT,
  VORTEX_FRAG,
  GRID_VERT,
  GRID_FRAG,
  BACKDROP_VERT,
  BACKDROP_FRAG,
  LASER_FRAG,
  LASER_VERT,
  RAY_VERT,
  RAY_FRAG,
  PARTICLE_FRAG,
  PARTICLE_VERT,
  RING_FRAG,
  RING_VERT,
  SHOCK_FRAG,
  SHOCK_VERT,
  TOWER_FRAG,
  TOWER_VERT,
  TUNNEL_FRAG,
  TUNNEL_VERT,
  DATARING_VERT,
  DATARING_FRAG,
  FLUX_VERT,
  FLUX_FRAG,
  PORTAL_VERT,
  PORTAL_FRAG,
} from "./shaders";

/* ------------------------------------------------------------------ utils */

function paletteColors(index: number) {
  const p = PALETTES[index % PALETTES.length];
  return p.hex.map((h) => new THREE.Color().setStyle(h, THREE.SRGBColorSpace)) as [
    THREE.Color,
    THREE.Color,
    THREE.Color,
  ];
}

type AudioUniforms = Record<
  | "uTime"
  | "uSub"
  | "uBass"
  | "uMid"
  | "uHigh"
  | "uBeat"
  | "uLevel"
  | "uColA"
  | "uColB"
  | "uColC"
  | "uWarp"
  | "uScreenPos"
  | "uIntensity"
  | "uMouse"
  | "uMagnetic"
  | "uParticleSize"
  | "uStrobeMode"
  | "uStrobeSpeed"
  | "uBeatPhase"
  | "uMasterBeat",
  THREE.IUniform
>;

function makeAudioUniforms(): AudioUniforms {
  const [a, b, c] = paletteColors(0);
  return {
    uTime: { value: 0 },
    uSub: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uBeat: { value: 0 },
    uLevel: { value: 0 },
    uWarp: { value: 0 },
    uScreenPos: { value: new THREE.Vector2() },
    uIntensity: { value: 1 },
    uMouse: { value: new THREE.Vector2() },
    uMagnetic: { value: 0 },
    uParticleSize: { value: 1.5 },
    uStrobeMode: { value: 0 },
    uStrobeSpeed: { value: 30.0 },
    uBeatPhase: { value: 0 },
    uMasterBeat: { value: 0 },
    uColA: { value: a },
    uColB: { value: b },
    uColC: { value: c },
  };
}

const GLOBAL_COLS = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
let CACHED_PALETTE = -1;
const BASE_COLS = [new THREE.Color(), new THREE.Color(), new THREE.Color()];

/** Uniform carrying palette metadata alongside its GPU value. */
type UniformWithMeta = THREE.IUniform & { userData?: { brighten: number } };

/** Writes the shared audio frame into any material that owns audio uniforms. */
function pushAudio(u: Record<string, THREE.IUniform>, time: number) {
  const s = audioState;
  if (u.uTime) u.uTime.value = time;
  if (u.uSub) u.uSub.value = s.sub;
  if (u.uBass) u.uBass.value = s.bass;
  if (u.uMid) u.uMid.value = s.mid;
  if (u.uHigh) u.uHigh.value = s.high;
  if (u.uBeat) u.uBeat.value = s.beat;
  if (u.uLevel) u.uLevel.value = s.level;
  if (u.uWarp) u.uWarp.value = s.mid * 1.0 + s.beat * 0.35;
  if (u.uBeatPhase) u.uBeatPhase.value = s.beatPhase;
  if (u.uMasterBeat) u.uMasterBeat.value = s.masterBeat;

  const meta = (u.uColA as UniformWithMeta | undefined)?.userData;
  if (u.uColA && meta) {
    u.uColA.value.copy(GLOBAL_COLS[0]).multiplyScalar(meta.brighten);
    u.uColB.value.copy(GLOBAL_COLS[1]).multiplyScalar(meta.brighten);
    u.uColC.value.copy(GLOBAL_COLS[2]).multiplyScalar(meta.brighten);
  }
}

function applyPalette(u: Record<string, THREE.IUniform>, _index: number, brighten = 1) {
  if (u.uColA) {
    (u.uColA as UniformWithMeta).userData = { brighten };
    (u.uColB as UniformWithMeta).userData = { brighten };
    (u.uColC as UniformWithMeta).userData = { brighten };
  }
}

interface SceneProps {
  settings: VisualSettings;
}

/* ============================================================ AUDIO DRIVER */

function AudioDriver({ settings }: SceneProps) {
  const vTime = useRef(0);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    vTime.current += dt * (settings.speed ?? 1);
    engine.update(dt, vTime.current, settings.audioProfile);
  });
  return null;
}

/* ============================================================ PERFORMANCE */

function PerfProbe({ settings }: SceneProps) {
  let acc = 0;
  let frames = 0;
  let worst = 0;
  useFrame((_, delta) => {
    acc += delta;
    frames += 1;
    if (delta > worst) worst = delta;
    if (acc >= 0.35) {
      const fps = frames / acc;
      if (hudBridge.fps) {
        hudBridge.fps.textContent = fps.toFixed(0);
        const bad = fps < 45;
        hudBridge.fps.style.color = bad ? "#FF3B5C" : fps < 56 ? "#FFC400" : "#00FF9C";
      }
      if (hudBridge.ms) hudBridge.ms.textContent = (worst * 1000).toFixed(1);
      if (hudBridge.bpm) hudBridge.bpm.textContent = audioState.bpm > 1 ? audioState.bpm.toFixed(0) : "--";
      if (hudBridge.time) {
        const t = audioState.time;
        hudBridge.time.textContent = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(
          Math.floor(t % 60),
        ).padStart(2, "0")}`;
      }
      acc = 0;
      frames = 0;
      worst = 0;
    }
    // level meters via direct style writes (no React churn)
    const vals = [audioState.sub, audioState.bass, audioState.mid, audioState.high];
    for (let i = 0; i < 4; i++) {
      const el = hudBridge.bars[i];
      if (el) el.style.transform = `scaleX(${Math.min(1, vals[i] * 1.15).toFixed(3)})`;
    }
    drawScope();
    drawWave();

    if (hudBridge.beat) hudBridge.beat.style.opacity = String(0.2 + audioState.beat * 0.8);

    // AUTO-LOOK → advance the palette once per 32-beat phrase
    if (settings.autoLook && perfBridge.onPhrase && audioState.beats > 0) {
      if (lastPhraseBeat !== audioState.beats) {
        lastPhraseBeat = audioState.beats;
        if (audioState.beats % 32 === 0) perfBridge.onPhrase(audioState.beats);
      }
    }

    // Animate global colors
    if (CACHED_PALETTE !== settings.palette) {
      CACHED_PALETTE = settings.palette;
      const [a, b, c] = paletteColors(settings.palette);
      BASE_COLS[0].copy(a);
      BASE_COLS[1].copy(b);
      BASE_COLS[2].copy(c);
    }
    const hueOffset = (audioState.time * 0.1 * settings.colorShift) % 1.0;
    GLOBAL_COLS[0].copy(BASE_COLS[0]);
    GLOBAL_COLS[1].copy(BASE_COLS[1]);
    GLOBAL_COLS[2].copy(BASE_COLS[2]);
    if (hueOffset > 0) {
      GLOBAL_COLS[0].offsetHSL(hueOffset, 0, 0);
      GLOBAL_COLS[1].offsetHSL(hueOffset, 0, 0);
      GLOBAL_COLS[2].offsetHSL(hueOffset, 0, 0);
    }
  });
  return null;
}

let accentHex = "#00F0FF";
let lastPhraseBeat = -1;

/** Rolling oscilloscope painted from the time-domain buffer. */
function drawWave() {
  const cv = hudBridge.wave;
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const w = cv.width;
  const h = cv.height;
  const data = audioState.waveform;
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 1.15;
  ctx.globalAlpha = 0.55 + audioState.level * 0.45;
  ctx.shadowBlur = 6;
  ctx.shadowColor = accentHex;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(data.length / w));
  for (let x = 0, i = 0; x < w; x++, i += step) {
    const v = data[i] ?? 0;
    const y = h / 2 - v * h * 0.46;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // centre rail
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}

/**
 * ADAPTIVE PERFORMANCE GOVERNOR
 * Watches frame time and quietly trades resolution / march steps / particle
 * draw-range for a locked frame rate. Operates entirely outside React.
 */
function Governor({ settings }: SceneProps) {
  const { gl } = useThree();
  const acc = useRef(0);
  const frames = useRef(0);
  const level = useRef(0);
  const cooldown = useRef(0);
  const applied = useRef(-1);

  useEffect(() => {
    level.current = 0;
    applied.current = -1;
    cooldown.current = 1.5;
  }, [settings.quality]);

  useFrame((_, delta) => {
    perfBridge.autoGovernor = settings.autoPerf;
    if (!settings.autoPerf) {
      if (applied.current !== 0) {
        applied.current = 0;
        perfBridge.governorLevel = 0;
        gl.setPixelRatio(perfBridge.basePixelRatio);
        perfBridge.particleGeometry?.setDrawRange(0, perfBridge.particleBudget);
      }
      return;
    }

    acc.current += delta;
    frames.current += 1;
    cooldown.current = Math.max(0, cooldown.current - delta);
    if (acc.current < 1.1) return;

    const fps = frames.current / acc.current;
    acc.current = 0;
    frames.current = 0;
    if (cooldown.current > 0) return;

    let next = level.current;
    if (fps < 47 && next < 3) next += 1;
    else if (fps > 58.5 && next > 0) next -= 1;
    else return;

    level.current = next;
    perfBridge.governorLevel = next;
    cooldown.current = next > 0 ? 2.4 : 1.2;

    const scale = [1, 0.84, 0.7, 0.58][next];
    gl.setPixelRatio(Math.max(0.5, perfBridge.basePixelRatio * scale));
    if (perfBridge.particleGeometry) {
      const keep = Math.floor(perfBridge.particleBudget * [1, 0.82, 0.6, 0.42][next]);
      perfBridge.particleGeometry.setDrawRange(0, keep);
    }
  });

  return null;
}

/** 64-bar logarithmic spectrum, painted straight into a 2D canvas. */
function drawScope() {
  const cv = hudBridge.scope;
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const w = cv.width;
  const h = cv.height;
  const spec = audioState.spectrum;
  const bars = 64;
  ctx.clearRect(0, 0, w, h);

  const accent = accentHex;
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, "rgba(255,255,255,0.10)");
  g.addColorStop(0.35, accent);
  g.addColorStop(1, "#FFFFFF");

  ctx.fillStyle = g;
  const bw = w / bars;
  for (let i = 0; i < bars; i++) {
    // log-ish frequency mapping so the kick doesn't dominate the whole width
    const t0 = Math.pow(i / bars, 1.7);
    const t1 = Math.pow((i + 1) / bars, 1.7);
    const a = Math.floor(t0 * spec.length * 0.78);
    const b = Math.max(a + 1, Math.floor(t1 * spec.length * 0.78));
    let peak = 0;
    for (let k = a; k < b; k++) if (spec[k] > peak) peak = spec[k];
    const v = Math.min(1, (peak / 255) * 1.35);
    const bh = Math.max(1, v * h);
    ctx.fillRect(i * bw + 0.5, h - bh, bw - 1.4, bh);
  }
}

/* ================================================================= TUNNEL */

function Tunnel({ settings }: SceneProps) {
  const { camera, size } = useThree();

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: TUNNEL_VERT,
        fragmentShader: TUNNEL_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
          uSteps: { value: QUALITY_PRESETS[settings.quality].marchSteps },
          uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(70) * 0.5) },
          uAspect: { value: 1 },
          uCamPos: { value: new THREE.Vector3() },
          uCamMat: { value: new THREE.Matrix3() },
          uGlitch: { value: 0 },
          uDetail: { value: 1 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const geometry = useMemo(() => new THREE.PlaneGeometry(2, 2), []);

  useEffect(() => {
    material.uniforms.uSteps.value = QUALITY_PRESETS[settings.quality].marchSteps;
  }, [material, settings.quality]);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette);
  }, [material, settings.palette]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const camMat = useMemo(() => new THREE.Matrix3(), []);

  useFrame(() => {
    const u = material.uniforms;
    pushAudio(u, audioState.time);
    u.uAspect.value = size.width / Math.max(1, size.height);
    // keep the ray generator perfectly aligned with the animated camera FOV
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 74;
    u.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(fov) * 0.5);
    u.uCamPos.value.copy(camera.position);
    camMat.setFromMatrix4(camera.matrixWorld);
    (u.uCamMat.value as THREE.Matrix3).copy(camMat);
    u.uGlitch.value = audioState.beat * audioState.high * 0.55 * (settings.glitch ? 1 : 0);
  });

  if (!settings.tunnel) return null;

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-1000} />;
}

/* ========================================================== PARTICLE FIELD */

function ParticleField({ settings }: SceneProps) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
          uSize: { value: 2.6 },
          uSpan: { value: 78 },
          uMorph: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const geometry = useMemo(() => {
    const count = Math.max(8000, Math.floor(settings.particles));
    const positions = new Float32Array(count * 3);
    const rand = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const SPAN = 78;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const inner = Math.random() < 0.34;
      const ang = Math.random() * Math.PI * 2;
      // radial distribution: dense inner vortex + wide outer shell
      const t = Math.random();
      const radius = inner ? 0.7 + Math.pow(t, 1.6) * 2.7 : 3.7 + Math.pow(t, 0.55) * 8.5;
      positions[i3] = Math.cos(ang) * radius;
      positions[i3 + 1] = Math.sin(ang) * radius * (0.86 + Math.random() * 0.3);
      positions[i3 + 2] = Math.random() * SPAN;
      rand[i3] = Math.random();
      rand[i3 + 1] = Math.random();
      rand[i3 + 2] = Math.random();
      seed[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geo.setDrawRange(0, count);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
    // exposed to the adaptive governor (draw-range is the cheapest quality dial)
    perfBridge.particleGeometry = geo;
    perfBridge.particleBudget = count;
    return geo;
  }, [settings.particles]);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 1.05);
  }, [material, settings.palette]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    const u = material.uniforms;
    pushAudio(u, audioState.time);
    u.uMorph.value = 0.45 + settings.intensity * 0.9;
    u.uSize.value = 1.45 + settings.bloom * 0.45;
  });

  if (!settings.field) return null;

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />;
}

/* =================================================================== CORE */

function Core({ settings }: SceneProps) {
  const solid = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CORE_VERT,
        fragmentShader: CORE_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
          uCamPos: { value: new THREE.Vector3() },
          uAmp: { value: 1 },
          uWire: { value: 0 },
          uLiquid: { value: 0 },
        },
      }),
    [],
  );

  const wire = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CORE_VERT,
        fragmentShader: CORE_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
          uCamPos: { value: new THREE.Vector3() },
          uAmp: { value: 1 },
          uWire: { value: 1 },
          uLiquid: { value: 0 },
        },
        wireframe: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const detail = settings.quality === "eco" ? 12 : settings.quality === "balanced" ? 20 : 32;
  const geometry = useMemo(() => {
    switch (settings.shape % 12) {
      case 0:
        return new THREE.IcosahedronGeometry(1.55, detail);
      case 1:
        return new THREE.TorusKnotGeometry(1.1, 0.35, detail * 4, detail);
      case 2:
        return new THREE.SphereGeometry(1.45, detail * 2, detail * 2);
      case 3:
        return new THREE.OctahedronGeometry(1.5, detail);
      case 4:
        return new THREE.DodecahedronGeometry(1.4, detail);
      case 5:
        return new THREE.TetrahedronGeometry(1.6, detail);
      case 6:
        return new THREE.ConeGeometry(1.6, 3.2, 4); // Diamond / Pyramid
      case 7:
        return new THREE.CylinderGeometry(1.6, 1.6, 3.2, 6); // Hexagonal Prism
      case 8:
        return new THREE.TorusGeometry(1.6, 0.15, detail * 2, detail * 4); // Tech Ring
      case 9:
        return new THREE.TorusKnotGeometry(1.5, 0.08, 256, 32, 3, 4); // Hyper Knot
      case 10:
        return new THREE.IcosahedronGeometry(1.6, 1); // Faceted Sphere
      case 11:
        return new THREE.OctahedronGeometry(1.6, 1); // Faceted Diamond
      default:
        return new THREE.IcosahedronGeometry(1.55, detail);
    }
  }, [detail, settings.shape]);

  const shell = useMemo(() => {
    switch (settings.shape % 12) {
      case 0:
        return new THREE.IcosahedronGeometry(2.5, 2);
      case 1:
        return new THREE.TorusKnotGeometry(1.8, 0.5, detail * 2, detail);
      case 2:
        return new THREE.SphereGeometry(2.2, detail, detail);
      case 3:
        return new THREE.OctahedronGeometry(2.4, 2);
      case 4:
        return new THREE.DodecahedronGeometry(2.3, 2);
      case 5:
        return new THREE.TetrahedronGeometry(2.5, 2);
      case 6:
        return new THREE.ConeGeometry(2.4, 4.2, 4); // Diamond / Pyramid Shell
      case 7:
        return new THREE.CylinderGeometry(2.2, 2.2, 4.2, 6); // Hexagonal Prism Shell
      case 8:
        return new THREE.TorusGeometry(2.2, 0.25, detail, detail * 2); // Tech Ring Shell
      case 9:
        return new THREE.TorusKnotGeometry(2.2, 0.15, 256, 32, 3, 4); // Hyper Knot Shell
      case 10:
        return new THREE.IcosahedronGeometry(2.4, 1); // Faceted Sphere Shell
      case 11:
        return new THREE.OctahedronGeometry(2.4, 1); // Faceted Diamond Shell
      default:
        return new THREE.IcosahedronGeometry(2.5, 2);
    }
  }, [detail, settings.shape]);

  useEffect(() => {
    applyPalette(solid.uniforms, settings.palette);
    applyPalette(wire.uniforms, settings.palette);
  }, [solid, wire, settings.palette]);

  useEffect(
    () => () => {
      geometry.dispose();
      shell.dispose();
      solid.dispose();
      wire.dispose();
    },
    [geometry, shell, solid, wire],
  );

  const group = useRef<THREE.Group>(null);
  const rot = useRef(new THREE.Vector3());
  const rotVel = useRef(new THREE.Vector3());
  const currentScale = useRef(1);

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = audioState;
    pushAudio(solid.uniforms, s.time);
    pushAudio(wire.uniforms, s.time);
    solid.uniforms.uCamPos.value.copy(camera.position);
    wire.uniforms.uCamPos.value.copy(camera.position);
    solid.uniforms.uAmp.value = 0.5 + settings.intensity * 0.8;
    wire.uniforms.uAmp.value = 0.3;
    solid.uniforms.uLiquid.value = settings.liquid ? 1 : 0;
    wire.uniforms.uLiquid.value = settings.liquid ? 1 : 0;

    // Organic rotational inertia: velocity acceleration & damping
    const targetVelX = (0.05 + s.mid * 0.45) * settings.speed;
    const targetVelY = (0.08 + s.mid * 0.65 + s.beat * 0.35) * settings.speed;
    const targetVelZ = (0.025 + s.high * 0.2) * settings.speed;

    rotVel.current.x = lerp(rotVel.current.x, targetVelX, 1 - Math.pow(0.005, dt));
    rotVel.current.y = lerp(rotVel.current.y, targetVelY, 1 - Math.pow(0.005, dt));
    rotVel.current.z = lerp(rotVel.current.z, targetVelZ, 1 - Math.pow(0.005, dt));

    rot.current.x += dt * rotVel.current.x;
    rot.current.y += dt * rotVel.current.y;
    rot.current.z += dt * rotVel.current.z;

    if (group.current) {
      group.current.rotation.set(rot.current.x, rot.current.y, rot.current.z);

      const targetScale = (1 + s.sub * 0.38 + s.beat * 0.16) * settings.coreSize;
      currentScale.current = lerp(currentScale.current, targetScale, 1 - Math.pow(0.0001, dt));
      group.current.scale.setScalar(currentScale.current);

      const levitate = Math.sin(s.time * 0.6) * 0.1 + Math.sin(s.time * 1.4) * 0.03;
      group.current.position.y = levitate;
    }
  });

  return (
    <group ref={group} position={[0, 0, -9]}>
      <mesh geometry={geometry} material={solid} renderOrder={1} />
      {settings.wireframe && <mesh geometry={shell} material={wire} renderOrder={5} />}
    </group>
  );
}

/* ========================================================== STROBE RINGS */

function StrobeRings({ settings }: SceneProps) {
  const COUNT = settings.quality === "eco" ? 16 : 30;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
          uSpan: { value: 70 },
          uSpeed: { value: 1 },
          uSpin: { value: 0.35 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const { geometry, mesh } = useMemo(() => {
    const geo = new THREE.TorusGeometry(3.45, 0.028, 3, 128);
    const phases = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) phases[i] = i / COUNT;
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    const im = new THREE.InstancedMesh(geo, material, COUNT);
    im.frustumCulled = false;
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) im.setMatrixAt(i, m);
    im.instanceMatrix.needsUpdate = true;
    return { geometry: geo, mesh: im };
  }, [COUNT, material]);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 1.2);
  }, [material, settings.palette]);

  useEffect(
    () => () => {
      geometry.dispose();
      mesh.dispose();
    },
    [geometry, mesh],
  );

  useFrame(() => {
    const u = material.uniforms;
    pushAudio(u, audioState.time);
    u.uSpeed.value = 0.7 + settings.intensity * 0.8;
    u.uSpin.value = 0.25 + audioState.mid * 1.6;
  });

  if (!settings.strobes) return null;

  return <primitive object={mesh} renderOrder={3} />;
}

/* ============================================================= LASER FAN */

function QuantumVortex({ settings }: SceneProps) {
  const COUNT = settings.quality === "eco" ? 5000 : 18000;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VORTEX_VERT,
        fragmentShader: VORTEX_FRAG,
        uniforms: makeAudioUniforms(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const rand = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const r = Math.random() * 8.0 + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 4.0;
      pos[i * 3] = r * Math.cos(theta);
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = r * Math.sin(theta);
      rand[i] = Math.random();
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
    return geo;
  }, [COUNT]);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 1.2);
  }, [material, settings.palette]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ clock, pointer }) => {
    pushAudio(material.uniforms, clock.elapsedTime);
    material.uniforms.uMouse.value.copy(pointer);
    material.uniforms.uMagnetic.value = settings.magnetic ? 1.0 : 0.0;
    material.uniforms.uParticleSize.value = settings.particleSize;
  });

  if (!settings.vortex) return null;

  return <points geometry={geometry} material={material} />;
}

function LaserFan({ settings }: SceneProps) {
  const COUNT = settings.quality === "eco" ? 20 : 44;
  const RADIUS = 2.45;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: LASER_VERT,
        fragmentShader: LASER_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
          uLength: { value: 30 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const { geometry, mesh } = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.045, 0.045, 1);
    geo.translate(0, 0, 0.5);
    const phases = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) phases[i] = Math.random();
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));

    const im = new THREE.InstancedMesh(geo, material, COUNT);
    im.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2 + Math.random() * 0.06;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
      const r = RADIUS * (0.92 + Math.random() * 0.16);
      pos.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      m.compose(pos, q, scale);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    return { geometry: geo, mesh: im };
  }, [COUNT, material]);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 1.35);
  }, [material, settings.palette]);

  useEffect(
    () => () => {
      geometry.dispose();
      mesh.dispose();
    },
    [geometry, mesh],
  );

  useFrame(() => {
    const u = material.uniforms;
    pushAudio(u, audioState.time);
    u.uLength.value = 14 + settings.intensity * 26 + audioState.beat * 12;
  });

  if (!settings.laser) return null;

  return <primitive object={mesh} renderOrder={2} />;
}

/* ======================================================== ENERGY FLUX */

function EnergyFlux({ settings }: SceneProps) {
  const COUNT = settings.quality === "eco" ? 150 : 400;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FLUX_VERT,
        fragmentShader: FLUX_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
          uFlux: { value: 1.0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const { geometry, mesh } = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.02, 0.02, 1);
    geo.translate(0, 0, 0.5);
    const rands = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT * 3; i++) rands[i] = Math.random();
    geo.setAttribute("aRand", new THREE.InstancedBufferAttribute(rands, 3));

    const im = new THREE.InstancedMesh(geo, material, COUNT);
    im.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < COUNT; i++) {
      // Random rotation over the entire sphere
      const phi = Math.acos(2.0 * Math.random() - 1.0);
      const theta = Math.random() * Math.PI * 2;
      pos.setFromSphericalCoords(1.5, phi, theta);
      // Orient the box to face outward
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize());
      m.compose(pos, q, scale);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    return { geometry: geo, mesh: im };
  }, [COUNT, material]);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 2.5);
  }, [material, settings.palette]);

  useEffect(
    () => () => {
      geometry.dispose();
      mesh.dispose();
    },
    [geometry, mesh],
  );

  useFrame(() => {
    pushAudio(material.uniforms, audioState.time);
    material.uniforms.uFlux.value = settings.flux;
  });

  if (!settings.energyFlux) return null;

  return <primitive object={mesh} renderOrder={3} />;
}

/* ======================================================== DATA RINGS */

function DataRings({ settings }: SceneProps) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: DATARING_VERT,
        fragmentShader: DATARING_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const geometry = useMemo(() => new THREE.PlaneGeometry(12, 12), []);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 1.5);
  }, [material, settings.palette]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(() => {
    pushAudio(material.uniforms, audioState.time);
    if (meshRef.current) {
      meshRef.current.rotation.x = -Math.PI / 2;
      meshRef.current.position.y = -2.2 + audioState.sub * 0.5;
      meshRef.current.rotation.z = audioState.time * 0.1;
    }
  });

  if (!settings.rings) return null;

  return <mesh ref={meshRef} geometry={geometry} material={material} renderOrder={3} />;
}

/* ======================================================== SPECTRUM TOWERS */

/** Circular FFT metering ring — 36 glowing bars driven by log-mapped bins. */
function SpectrumTowers({ settings }: SceneProps) {
  const COUNT = settings.quality === "eco" ? 24 : settings.quality === "balanced" ? 36 : 48;
  const RADIUS = 2.35;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: TOWER_VERT,
        fragmentShader: TOWER_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
          uBase: { value: -1.85 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const { geometry, mesh, levels } = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.1, 1, 0.1);
    const lv = new Float32Array(COUNT);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) seeds[i] = Math.random();
    geo.setAttribute("aLevel", new THREE.InstancedBufferAttribute(lv, 1));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));

    const im = new THREE.InstancedMesh(geo, material, COUNT);
    im.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      pos.set(Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS);
      m.compose(pos, q, one);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    return { geometry: geo, mesh: im, levels: lv };
  }, [COUNT, material]);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 1.3);
  }, [material, settings.palette]);

  useEffect(
    () => () => {
      geometry.dispose();
      mesh.dispose();
    },
    [geometry, mesh],
  );

  useFrame(() => {
    const u = material.uniforms;
    pushAudio(u, audioState.time);
    u.uBase.value = -1.85 - audioState.sub * 0.35;

    // logarithmic bin mapping so the ring reads like a proper analyser
    const spec = audioState.spectrum;
    const attr = geometry.getAttribute("aLevel") as THREE.InstancedBufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      const t0 = Math.pow(i / COUNT, 1.55);
      const t1 = Math.pow((i + 1) / COUNT, 1.55);
      const a = Math.floor(t0 * spec.length * 0.72);
      const b = Math.max(a + 1, Math.floor(t1 * spec.length * 0.72));
      let peak = 0;
      for (let k = a; k < b; k++) if (spec[k] > peak) peak = spec[k];
      const target = Math.min(1, (peak / 255) * 1.25 * audioState.sensitivity);
      // fast attack / slow release per bar
      arr[i] = target > levels[i] ? lerp(levels[i], target, 0.55) : lerp(levels[i], target, 0.12);
    }
    attr.needsUpdate = true;
  });

  if (!settings.towers) return null;

  return <primitive object={mesh} renderOrder={6} />;
}

/* ============================================================== CORE GLOW */

/** Volumetric halo + anamorphic flare + expanding kick shockwave. */
function CoreGlow({ settings }: SceneProps) {
  const halo = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        uniforms: makeAudioUniforms(),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const shock = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SHOCK_VERT,
        fragmentShader: SHOCK_FRAG,
        uniforms: { ...makeAudioUniforms(), uAge: { value: 99 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const ring = useMemo(() => new THREE.TorusGeometry(1, 0.022, 3, 128), []);
  const group = useRef<THREE.Group>(null);
  const haloMesh = useRef<THREE.Mesh>(null);
  const shockMesh = useRef<THREE.Mesh>(null);
  const lastBeat = useRef(-99);
  const beatCount = useRef(0);

  useEffect(() => {
    applyPalette(halo.uniforms, settings.palette, 1.25);
    applyPalette(shock.uniforms, settings.palette, 1.4);
  }, [halo, shock, settings.palette]);

  useEffect(
    () => () => {
      quad.dispose();
      ring.dispose();
      halo.dispose();
      shock.dispose();
    },
    [quad, ring, halo, shock],
  );

  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;

    const corePos = new THREE.Vector3(0, 0, 0);
    corePos.project(camera);
    if (halo.uniforms.uScreenPos) {
      halo.uniforms.uScreenPos.value.set(corePos.x, corePos.y);
    }

    pushAudio(halo.uniforms, t);
    pushAudio(shock.uniforms, t);

    // kick → shockwave age
    if (audioState.beats !== beatCount.current) {
      beatCount.current = audioState.beats;
      if (audioState.beat > 0.55) lastBeat.current = t;
    }
    shock.uniforms.uAge.value = t - lastBeat.current;

    if (group.current) {
      group.current.position.set(0, Math.sin(t * 0.5) * 0.12, -9);
      group.current.quaternion.copy(camera.quaternion);
    }
    if (haloMesh.current) {
      const s = 6.5 + audioState.sub * 3.4 + audioState.beat * 1.6;
      haloMesh.current.scale.setScalar(s);
    }
  });

  if (!settings.glow) return null;

  return (
    <group ref={group}>
      <mesh ref={haloMesh} geometry={quad} material={halo} frustumCulled={false} renderOrder={7} />
      <mesh ref={shockMesh} geometry={ring} material={shock} frustumCulled={false} renderOrder={8} />
    </group>
  );
}

/* ============================================================ CAMERA RIG */

function CameraRig({ settings }: SceneProps) {
  const { camera } = useThree();
  const shake = useRef(0);
  const dropPunch = useRef(0);
  const base = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const target = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = settings.fov ?? 74;
    cam.near = 0.05;
    cam.far = 220;
    cam.position.copy(base);
    cam.updateProjectionMatrix();
  }, [camera, base, settings.fov]);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = audioState;
    const t = clock.elapsedTime;

    // Detect massive RMS drop / transients (sub bass spike + beat impulse)
    const isDrop = (s.level > 0.7 && s.sub > 0.65 && s.beat > 0.75) || (s.sub > 0.85 && s.beat > 0.6);
    if (isDrop) {
      dropPunch.current = Math.max(
        dropPunch.current,
        limitPunch(22.0 * settings.intensity, settings.safeMode),
      );
    }
    dropPunch.current = lerp(dropPunch.current, 0, 1 - Math.pow(0.003, dt));

    // transient-driven camera shake (sub-bass + beat impulse) with smooth exponential decay
    shake.current = Math.max(
      shake.current * Math.pow(0.002, dt),
      (s.sub * s.sub * 1.3 + s.beat * 0.45) * settings.shake,
    );
    const amp = Math.min(shake.current * 0.28, 0.28) * (0.35 + settings.intensity * 0.45);

    // Smooth organic 3D drift (Lissajous path + sub-bass room recoil)
    const drift = 0.16 + s.mid * 0.24;
    target.set(
      base.x + Math.sin(t * 0.31) * drift + Math.cos(t * 0.67) * 0.05,
      base.y + Math.cos(t * 0.23) * drift * 0.7 + Math.sin(t * 0.53) * 0.04,
      base.z - s.sub * 0.18, // smooth sub-bass recoil for physical room feeling
    );

    // Damped interpolation for butter-smooth camera position tracking
    camera.position.lerp(target, 1 - Math.pow(0.00001, dt));

    // Damped micro-impact shake offset
    if (amp > 0.001) {
      camera.position.x += (Math.sin(t * 31.3) + Math.sin(t * 57.1)) * 0.5 * amp;
      camera.position.y += (Math.cos(t * 37.7) + Math.cos(t * 43.3)) * 0.5 * amp;
    }

    // Smooth physics-damped camera rotational sway
    const roll = Math.sin(t * 0.19) * 0.045 + Math.sin(t * 0.09) * 0.02 + s.beat * 0.02 * Math.sin(t * 29.0);
    const pitch = Math.sin(t * 0.15) * 0.035 + s.beat * 0.015;
    const yaw = Math.sin(t * 0.12) * 0.04;

    camera.rotation.z = lerp(camera.rotation.z, roll, 1 - Math.pow(0.0005, dt));
    camera.rotation.x = lerp(camera.rotation.x, pitch, 1 - Math.pow(0.0005, dt));
    camera.rotation.y = lerp(camera.rotation.y, yaw, 1 - Math.pow(0.0005, dt));

    // publish the new matrix immediately so the raymarched tunnel (which reads
    // matrixWorld) stays perfectly in sync with the mesh layers.
    camera.updateMatrixWorld();

    const cam = camera as THREE.PerspectiveCamera;
    const targetFov = (settings.fov ?? 74) + s.sub * 5.0 + s.beat * 3.0 + dropPunch.current;
    if (Math.abs(cam.fov - targetFov) > 0.01) {
      cam.fov = lerp(cam.fov, targetFov, 1 - Math.pow(0.0001, dt));
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

/* ================================================================= EFFECTS */

/**
 * POST-PROCESSING DEGRADATION LADDER
 * If the GPU pipeline faults, we rebuild the composer one tier down instead of
 * dead-ending. Tier 3 renders raw (no composer at all), which always works.
 */
const FX_TIERS = ["FULL", "CORE FX", "MINIMAL", "RAW"] as const;

function Effects({ settings }: SceneProps) {
  const [tier, setTier] = useState(0);
  const tierRef = useRef(0);
  tierRef.current = tier;

  const bloom = useRef<BloomEffect>(null);
  const chroma = useRef<ChromaticAberrationEffect>(null);
  const noise = useRef<NoiseEffect>(null);
  const vignette = useRef<VignetteEffect>(null);
  const glitch = useRef<GlitchEffect>(null);
  const scan = useRef<ScanlineEffect>(null);
  const gamma = useRef<CustomGammaEffect | null>(null);

  const glitchLeft = useRef(0);
  const dropBloomFlash = useRef(1.0);
  const strengthVec = useMemo(() => new THREE.Vector2(), []);

  // recovery: step the composer down, unfreeze the loop, keep the music playing
  useEffect(
    () =>
      onRenderFault((fault) => {
        if (tierRef.current >= FX_TIERS.length - 1) return false; // nothing left → halt
        clearFault();
        const next = Math.min(tierRef.current + 1, FX_TIERS.length - 1);
        setTier(next);
        perfBridge.fxTier = next;
        console.warn(`[VOID//REACTOR] post-processing degraded → ${FX_TIERS[next]}`, fault.message);
        return true;
      }),
    [],
  );

  useEffect(() => {
    perfBridge.fxTier = tier;
  }, [tier]);

  /** Everything below is audio-reactive uniform plumbing; never let it throw. */
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = audioState;
    if (tier > 0) return;

    // Detect massive RMS drop / transients (sub bass spike + beat impulse)
    const isDrop = (s.level > 0.7 && s.sub > 0.65 && s.beat > 0.75) || (s.sub > 0.85 && s.beat > 0.6);
    if (isDrop) {
      dropBloomFlash.current = limitFlash(3.0, settings.safeMode);
    }
    dropBloomFlash.current = lerp(dropBloomFlash.current, 1.0, 1 - Math.pow(0.006, dt));

    const b = bloom.current;
    if (b) {
      let bIntensity, bThreshold, bSmoothing, bRadius;
      const userThresh = settings.bloomThreshold ?? 0.15;

      if (settings.bloomProfile === "laser") {
        bIntensity = (0.8 + settings.bloom * 2.5) * (1.0 + s.high * 2.5 + s.beat * 1.5);
        bThreshold = Math.min(1.0, userThresh * 0.8 + 0.35 + s.level * 0.05);
        bSmoothing = 0.02;
        bRadius = 0.15;
      } else if (settings.bloomProfile === "hard") {
        bIntensity = (0.6 + settings.bloom * 1.8) * (0.8 + s.high * 2.0 + s.beat * 1.2);
        bThreshold = Math.min(1.0, userThresh * 0.8 + 0.2 + s.level * 0.1);
        bSmoothing = 0.1;
        bRadius = 0.4;
      } else {
        // Soft (default)
        bIntensity = (0.45 + settings.bloom * 1.35) * (0.65 + s.high * 1.5 + s.beat * 0.9);
        bThreshold = Math.min(1.0, userThresh * 0.8 + 0.02 + s.level * 0.06);
        bSmoothing = 0.26 + s.level * 0.1;
        bRadius = 0.72 + s.sub * 0.24;
      }

      b.intensity = bIntensity * dropBloomFlash.current;
      b.luminanceMaterial.threshold = bThreshold;
      b.luminanceMaterial.smoothing = bSmoothing;
      const rad = b as unknown as { radius?: number };
      if (typeof rad.radius === "number") rad.radius = bRadius;
    }

    const gm = gamma.current;
    if (gm && gm.uniforms) {
      const uG = gm.uniforms.get("uGamma");
      if (uG) uG.value = settings.gamma ?? 1.0;
    }

    const c = chroma.current;
    if (c) {
      const glitchMul = 1.0 + (settings.crystallineGlitch ?? 0) * 3.5;
      const crystalJitter = (settings.crystallineGlitch ?? 0) * 0.004 * (1.0 + s.high * 2.0);
      const amt =
        (0.00045 + s.high * 0.0042 + s.beat * 0.0026 * settings.intensity) * glitchMul + crystalJitter;
      (c.offset as THREE.Vector2).set(amt, amt * 0.82);
    }

    const n = noise.current;
    if (n) {
      n.blendMode.opacity.value = (0.035 + s.level * 0.05 + s.beat * 0.03) * settings.noiseLevel;
    }

    const sc = scan.current;
    if (sc) {
      const op = 0.045 + s.high * 0.09;
      (sc as unknown as { blendMode: { opacity: { value: number } } }).blendMode.opacity.value = op;
      const dens = sc as unknown as { density?: number };
      if (typeof dens.density === "number") dens.density = 1.15;
    }

    const v = vignette.current;
    if (v) {
      v.darkness = 0.72 + s.sub * 0.2;
      v.offset = 0.24 + s.level * 0.04;
    }

    // glitch bursts only on strong transients
    const g = glitch.current;
    if (g) {
      if (!settings.glitch) {
        g.mode = GlitchMode.DISABLED;
      } else {
        if (!settings.safeMode && s.beat > 0.92 && s.sub > 0.42 && glitchLeft.current <= 0) {
          glitchLeft.current = 0.14 + Math.random() * 0.12;
        }
        if (glitchLeft.current > 0) {
          glitchLeft.current -= dt;
          g.mode = GlitchMode.CONSTANT_WILD;
          strengthVec.set(0.06 * (0.4 + s.sub), 0.09 * (0.4 + s.high));
          g.strength.copy(strengthVec);
        } else if (g.mode !== GlitchMode.DISABLED) {
          g.mode = GlitchMode.DISABLED;
        }
      }
    }
  });

  // Tier 3 → no composer at all: the raw WebGL path cannot fail.
  if (tier >= 3) return null;

  // Effects are collected into an array and rendered inside the composer's
  // group, so each tier is a strict subset of the previous one.
  const nodes: React.ReactElement[] = [
    <Bloom
      key="bloom"
      ref={(r: BloomEffect | null) => {
        bloom.current = r;
      }}
      intensity={1.2}
      luminanceThreshold={0.12}
      luminanceSmoothing={0.3}
      mipmapBlur
      radius={0.8}
    />,
    <CustomGamma
      key="gamma"
      ref={(r: CustomGammaEffect | null) => {
        gamma.current = r;
      }}
      gamma={settings.gamma}
    />,
  ];

  if (tier <= 1) {
    nodes.push(
      <ChromaticAberration
        key="chroma"
        ref={(r: ChromaticAberrationEffect | null) => {
          chroma.current = r;
        }}
        offset={new THREE.Vector2(0.0006, 0.0006)}
        radialModulation
        modulationOffset={0.36}
      />,
    );
  }

  if (tier === 0) {
    nodes.push(
      <Glitch
        key="glitch"
        ref={(r: GlitchEffect | null) => {
          glitch.current = r;
        }}
        delay={new THREE.Vector2(1.2, 2.8)}
        duration={new THREE.Vector2(0.04, 0.18)}
        strength={new THREE.Vector2(0.04, 0.14)}
        ratio={0.85}
      />,
      <Scanline
        key="scan"
        ref={(r: ScanlineEffect | null) => {
          scan.current = r;
        }}
        blendFunction={BlendFunction.OVERLAY}
        density={1.15}
        opacity={0.06}
      />,
      <Noise
        key="noise"
        ref={(r: NoiseEffect | null) => {
          noise.current = r;
        }}
        premultiply
        blendFunction={BlendFunction.ADD}
        opacity={0.04}
      />,
    );
  }

  nodes.push(
    <Vignette
      key="vignette"
      ref={(r: VignetteEffect | null) => {
        vignette.current = r;
      }}
      eskil={false}
      offset={0.26}
      darkness={0.78}
    />,
  );

  return (
    <EffectComposer key={tier} multisampling={0} enableNormalPass={false} autoClear={false}>
      {nodes}
    </EffectComposer>
  );
}

/* ========================================================= MOTION BLUR FADE & BACKDROP */
function FadePlane({ settings }: SceneProps) {
  const { camera } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);

  const material = useMemo(() => {
    const u = makeAudioUniforms();
    return new THREE.ShaderMaterial({
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      uniforms: { ...u, uOpacity: { value: 1.0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }, []);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 1.0);
  }, [material, settings.palette]);

  useFrame(({ clock }) => {
    pushAudio(material.uniforms, clock.elapsedTime);
    material.uniforms.uOpacity.value = 1.0 - settings.trails;
    material.uniforms.uStrobeMode.value = settings.strobeMode ? 1.0 : 0.0;
    material.uniforms.uStrobeSpeed.value = limitStrobeRate(settings.strobeSpeed, settings.safeMode);
  });

  return createPortal(
    <mesh ref={meshRef} position={[0, 0, -5]} renderOrder={-99999}>
      <planeGeometry args={[100, 100]} />
      <primitive object={material} attach="material" />
    </mesh>,
    camera,
  );
}

function CyberGrid({ settings }: SceneProps) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GRID_VERT,
        fragmentShader: GRID_FRAG,
        uniforms: makeAudioUniforms(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 1.0);
  }, [material, settings.palette]);

  useFrame(({ clock }) => {
    pushAudio(material.uniforms, clock.elapsedTime);
  });

  if (!settings.grid) return null;

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]}>
      <planeGeometry args={[100, 100, 32, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function GodRays({ settings }: SceneProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: RAY_VERT,
      fragmentShader: RAY_FRAG,
      uniforms: makeAudioUniforms(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }, []);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 1.2);
  }, [material, settings.palette]);

  useFrame(({ clock }) => {
    pushAudio(material.uniforms, clock.elapsedTime);
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.elapsedTime * 0.2;
      meshRef.current.rotation.z = clock.elapsedTime * 0.1;
    }
  });

  if (!settings.rays) return null;

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <cylinderGeometry args={[2.5, 12.0, 30.0, 64, 1, true]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/* =================================================================== SCENE */

export default function Scene({ settings }: SceneProps) {
  const { gl } = useThree();
  const props = useMemo(() => ({ settings }), [settings]);

  useEffect(() => {
    gl.setClearColor(new THREE.Color("#000000"), 1);
    gl.autoClear = false;
    gl.toneMapping = THREE.NoToneMapping;

    // expose the WebGL surface + a React-free resolution dial
    perfBridge.canvas = gl.domElement;
    perfBridge.setPixelRatio = (v: number) => gl.setPixelRatio(v);
    const preset = QUALITY_PRESETS[settings.quality];
    perfBridge.basePixelRatio = Math.min(
      Math.max(preset.dpr[0], window.devicePixelRatio || 1),
      preset.dpr[1],
    );
    if (settings.autoPerf) gl.setPixelRatio(perfBridge.basePixelRatio);
    perfBridge.particleGeometry?.setDrawRange(0, perfBridge.particleBudget);

    // WebGL context loss (GPU reset, tab sleep, driver hiccup)
    const canvas = gl.domElement;
    const onLost = (e: Event) => {
      e.preventDefault();
      console.warn("[VOID//REACTOR] WebGL context lost — attempting restore");
    };
    const onRestored = () => {
      console.warn("[VOID//REACTOR] WebGL context restored");
      gl.setPixelRatio(perfBridge.basePixelRatio);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [gl, settings.quality, settings.autoPerf]);

  // keep the DOM accent colour in sync with the active palette
  useEffect(() => {
    const hex = PALETTES[settings.palette % PALETTES.length].hex[0];
    accentHex = hex;
    document.documentElement.style.setProperty("--accent", hex);
    document.documentElement.style.setProperty(
      "--accent-2",
      PALETTES[settings.palette % PALETTES.length].hex[1],
    );
  }, [settings.palette]);

  return (
    <>
      <AudioDriver {...props} />
      <PerfProbe {...props} />
      <Governor {...props} />
      <FadePlane {...props} />
      <CameraRig {...props} />
      <Tunnel {...props} />
      <Core {...props} />
      <Obelisks {...props} />
      <CoreGlow {...props} />
      <EnergyFlux {...props} />
      <QuantumVortex {...props} />
      {settings.laser && <LaserFan {...props} />}
      <DataRings {...props} />
      <StrobeRings {...props} />
      <CyberGrid {...props} />
      <GodRays {...props} />
      <SpectrumTowers {...props} />
      <ParticleField {...props} />
      <QuantumPortal {...props} />
      <NeuralSynapses {...props} />
      <Effects {...props} />
    </>
  );
}

/* ========================================================== QUANTUM PORTAL */

function QuantumPortal({ settings }: SceneProps) {
  const COUNT = settings.quality === "eco" ? 5 : settings.quality === "balanced" ? 7 : 9;
  const imRef = useRef<THREE.InstancedMesh>(null);
  const rotAngles = useRef<Float32Array>(new Float32Array(COUNT * 3));
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: PORTAL_VERT,
        fragmentShader: PORTAL_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
          uCamPos: { value: new THREE.Vector3() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const geometry = useMemo(() => new THREE.TorusGeometry(3.2, 0.08, 20, 80), []);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 1.2);
  }, [settings.palette, material]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const im = imRef.current;
    if (!im) return;

    pushAudio(material.uniforms, audioState.time);
    material.uniforms.uCamPos.value.copy(camera.position);

    const s = audioState;
    const angles = rotAngles.current;
    // Bind angular rotation velocity to the Highs frequency band
    const highSpd = (0.4 + s.high * 4.5 + s.beat * 2.0) * settings.speed;

    for (let i = 0; i < COUNT; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const speedMult = (0.45 + i * 0.2) * dir;

      angles[i * 3] += dt * speedMult * highSpd;
      angles[i * 3 + 1] += dt * speedMult * 0.7 * highSpd;
      angles[i * 3 + 2] += dt * speedMult * 0.5 * highSpd;

      dummy.position.set(0, 0, 0);
      dummy.rotation.set(
        angles[i * 3] + i * 0.42,
        angles[i * 3 + 1] + i * 0.31,
        angles[i * 3 + 2] + i * 0.53,
      );

      const scale = (0.7 + i * 0.25) * (1.0 + s.sub * 0.16);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();

      im.setMatrixAt(i, dummy.matrix);
    }

    im.instanceMatrix.needsUpdate = true;
  });

  if (!settings.quantumPortal) return null;

  return (
    <instancedMesh ref={imRef} args={[geometry, material, COUNT]} frustumCulled={false} renderOrder={4} />
  );
}

/* ========================================================== NEURAL SYNAPSES */

function NeuralSynapses({ settings }: SceneProps) {
  const MAX_SYNAPSES = settings.quality === "eco" ? 24 : 48;
  const lineRef = useRef<THREE.LineSegments>(null);

  // Each synapse has 2 vertices (origin and tip) = 6 floats in buffer
  const positions = useMemo(() => new Float32Array(MAX_SYNAPSES * 6), [MAX_SYNAPSES]);
  const velocities = useRef<Float32Array>(new Float32Array(MAX_SYNAPSES * 3));
  const lifespans = useRef<Float32Array>(new Float32Array(MAX_SYNAPSES));
  const maxLifespans = useRef<Float32Array>(new Float32Array(MAX_SYNAPSES));
  const cooldown = useRef(0);

  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: new THREE.Color(PALETTES[0].hex[2]),
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    geo.setAttribute("position", posAttr);
    return geo;
  }, [positions]);

  useEffect(() => {
    const col = new THREE.Color(PALETTES[settings.palette % PALETTES.length].hex[2]);
    material.color.copy(col);
  }, [settings.palette, material]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = audioState;
    const vels = velocities.current;
    const lives = lifespans.current;
    const maxLives = maxLifespans.current;
    const posArr = positions;

    cooldown.current -= dt;

    // Trigger on bass peak threshold strictly
    const isBassPeak = s.bass > 0.58 && (s.beat > 0.45 || s.sub > 0.65);
    if (isBassPeak && cooldown.current <= 0) {
      cooldown.current = 0.06;
      // Spawn burst of 2-4 synapses
      const spawnCount = 2 + Math.floor(Math.random() * 3);
      let spawned = 0;

      for (let i = 0; i < MAX_SYNAPSES && spawned < spawnCount; i++) {
        if (lives[i] <= 0) {
          const duration = 0.25 + Math.random() * 0.35;
          lives[i] = duration;
          maxLives[i] = duration;

          const theta = Math.random() * Math.PI * 2;
          const phi = (Math.random() - 0.5) * Math.PI;
          const speed = (10.0 + Math.random() * 18.0 + s.bass * 14.0) * settings.speed;

          vels[i * 3] = Math.cos(theta) * Math.cos(phi) * speed;
          vels[i * 3 + 1] = Math.sin(phi) * speed;
          vels[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * speed;

          const startRadius = 0.4 + s.sub * 0.4;
          const sx = Math.cos(theta) * Math.cos(phi) * startRadius;
          const sy = Math.sin(phi) * startRadius;
          const sz = Math.sin(theta) * Math.cos(phi) * startRadius;

          const baseIdx = i * 6;
          posArr[baseIdx] = sx;
          posArr[baseIdx + 1] = sy;
          posArr[baseIdx + 2] = sz;
          posArr[baseIdx + 3] = sx;
          posArr[baseIdx + 4] = sy;
          posArr[baseIdx + 5] = sz;

          spawned++;
        }
      }
    }

    let needsUpdate = false;

    // Advance existing synapses outward
    for (let i = 0; i < MAX_SYNAPSES; i++) {
      if (lives[i] > 0) {
        lives[i] -= dt;
        const progress = 1.0 - Math.max(0, lives[i] / maxLives[i]);
        const baseIdx = i * 6;

        // Tip travels outward along velocity
        posArr[baseIdx + 3] += vels[i * 3] * dt;
        posArr[baseIdx + 4] += vels[i * 3 + 1] * dt;
        posArr[baseIdx + 5] += vels[i * 3 + 2] * dt;

        // Tail catches up smoothly
        if (progress > 0.3) {
          posArr[baseIdx] += vels[i * 3] * dt * 0.8;
          posArr[baseIdx + 1] += vels[i * 3 + 1] * dt * 0.8;
          posArr[baseIdx + 2] += vels[i * 3 + 2] * dt * 0.8;
        }

        needsUpdate = true;

        if (lives[i] <= 0) {
          // Collapse segment
          posArr[baseIdx] = 0;
          posArr[baseIdx + 1] = 0;
          posArr[baseIdx + 2] = 0;
          posArr[baseIdx + 3] = 0;
          posArr[baseIdx + 4] = 0;
          posArr[baseIdx + 5] = 0;
        }
      }
    }

    if (needsUpdate && geometry.attributes.position) {
      (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    material.opacity = 0.4 + s.bass * 0.5 + s.beat * 0.3;
  });

  if (!settings.neuralSynapses) return null;

  return (
    <lineSegments
      ref={lineRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={5}
    />
  );
}

/* ========================================================== OBELISKS */

function Obelisks({ settings }: SceneProps) {
  const COUNT = settings.quality === "eco" ? 12 : 36;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CORE_VERT,
        fragmentShader: CORE_FRAG,
        uniforms: {
          ...makeAudioUniforms(),
          uCamPos: { value: new THREE.Vector3() },
          uAmp: { value: 0.1 },
          uWire: { value: 0 },
          uLiquid: { value: 0 },
        },
      }),
    [],
  );

  const { geometry, mesh } = useMemo(() => {
    // A tall, sharp obelisk/shard
    const geo = new THREE.CylinderGeometry(0.01, 0.25, 4.0, 4);
    const im = new THREE.InstancedMesh(geo, material, COUNT);
    im.frustumCulled = false;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2;
      const radius = 5.5 + (i % 3) * 1.5; // Staggered rings
      pos.set(Math.cos(angle) * radius, (Math.random() - 0.5) * 4.0, Math.sin(angle) * radius);

      // Point them generally towards the center or randomly tilted
      q.setFromEuler(new THREE.Euler(Math.random() * 0.4 - 0.2, -angle, Math.random() * 0.4 - 0.2));
      m.compose(pos, q, scale);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    return { geometry: geo, mesh: im };
  }, [COUNT, material]);

  useEffect(() => {
    applyPalette(material.uniforms, settings.palette, 0.8);
  }, [material, settings.palette]);

  useEffect(
    () => () => {
      geometry.dispose();
      mesh.dispose();
    },
    [geometry, mesh],
  );

  const rot = useRef(0);

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 1 / 20);
    pushAudio(material.uniforms, audioState.time);
    material.uniforms.uCamPos.value.copy(camera.position);

    rot.current += dt * (0.05 + audioState.mid * 0.2) * settings.speed;
    mesh.rotation.y = rot.current;

    // Pulse scale with bass
    const pulse = 1.0 + audioState.sub * 0.3;
    mesh.scale.set(pulse, pulse, pulse);
  });

  if (!settings.obelisks) return null;

  return <primitive object={mesh} renderOrder={4} />;
}
