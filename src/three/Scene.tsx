import { useFrame, useThree } from "@react-three/fiber";
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Glitch,
  Noise,
  Scanline,
  Vignette,
} from "@react-three/postprocessing";
import {
  BlendFunction,
  GlitchMode,
  type BloomEffect,
  type ChromaticAberrationEffect,
  type GlitchEffect,
  type NoiseEffect,
  type ScanlineEffect,
  type VignetteEffect,
} from "postprocessing";
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
  LASER_FRAG,
  LASER_VERT,
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
} from "./shaders";

/* ------------------------------------------------------------------ utils */

function paletteColors(index: number) {
  const p = PALETTES[index % PALETTES.length];
  return p.hex.map(
    (h) => new THREE.Color().setStyle(h, THREE.SRGBColorSpace),
  ) as [THREE.Color, THREE.Color, THREE.Color];
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
  | "uIntensity",
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
    uIntensity: { value: 1 },
    uColA: { value: a },
    uColB: { value: b },
    uColC: { value: c },
  };
}

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
}

function applyPalette(
  u: Record<string, THREE.IUniform>,
  index: number,
  brighten = 1,
) {
  const [a, b, c] = paletteColors(index);
  if (u.uColA) u.uColA.value.copy(a).multiplyScalar(brighten);
  if (u.uColB) u.uColB.value.copy(b).multiplyScalar(brighten);
  if (u.uColC) u.uColC.value.copy(c).multiplyScalar(brighten);
}

interface SceneProps {
  settings: VisualSettings;
}

/* ============================================================ AUDIO DRIVER */

function AudioDriver() {
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    engine.update(dt, state.clock.elapsedTime);
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
          uTanHalfFov: { value: Math.tan((THREE.MathUtils.degToRad(70) * 0.5)) },
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

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

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

  return (
    <mesh
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-1000}
    />
  );
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
      const radius = inner
        ? 0.7 + Math.pow(t, 1.6) * 2.7
        : 3.7 + Math.pow(t, 0.55) * 8.5;
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
        },
        wireframe: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const detail = settings.quality === "eco" ? 12 : settings.quality === "balanced" ? 20 : 28;
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1.55, detail), [detail]);
  const shell = useMemo(() => new THREE.IcosahedronGeometry(2.5, 2), []);

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

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = audioState;
    pushAudio(solid.uniforms, s.time);
    pushAudio(wire.uniforms, s.time);
    solid.uniforms.uCamPos.value.copy(camera.position);
    wire.uniforms.uCamPos.value.copy(camera.position);
    solid.uniforms.uAmp.value = 0.5 + settings.intensity * 0.8;
    wire.uniforms.uAmp.value = 0.3;

    // procedural rotation speeds driven by the mids
    rot.current.x += dt * (0.06 + s.mid * 0.55);
    rot.current.y += dt * (0.09 + s.mid * 0.85 + s.beat * 0.5);
    rot.current.z += dt * (0.03 + s.high * 0.22);

    if (group.current) {
      group.current.rotation.set(rot.current.x, rot.current.y, rot.current.z);
      const pulse = 1 + s.sub * 0.42 + s.beat * 0.18;
      group.current.scale.setScalar(pulse);
      group.current.position.y = Math.sin(s.time * 0.5) * 0.12;
    }
  });

  return (
    <group ref={group} position={[0, 0, -9]}>
      <mesh geometry={geometry} material={solid} renderOrder={1} />
      <mesh geometry={shell} material={wire} renderOrder={5} />
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

  if (!settings.strobes) return null;

  return <primitive object={mesh} renderOrder={2} />;
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
      <mesh
        ref={shockMesh}
        geometry={ring}
        material={shock}
        frustumCulled={false}
        renderOrder={8}
      />
    </group>
  );
}

/* ============================================================ CAMERA RIG */

function CameraRig({ settings }: SceneProps) {
  const { camera } = useThree();
  const shake = useRef(0);
  const base = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const target = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = 74;
    cam.near = 0.05;
    cam.far = 220;
    cam.position.copy(base);
    cam.updateProjectionMatrix();
  }, [camera, base]);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = audioState;
    const t = clock.elapsedTime;

    // transient-driven camera shake (sub-bass + beat impulse)
    shake.current = Math.max(shake.current * Math.pow(0.0025, dt), s.sub * s.sub * 1.6 + s.beat * 0.55);
    // hard-clamped so the camera can never leave the raymarched volume
    const amp = Math.min(shake.current * 0.34, 0.32) * (0.35 + settings.intensity * 0.45);

    const drift = 0.18 + s.mid * 0.28;
    target.set(
      base.x + Math.sin(t * 0.37) * drift + Math.sin(t * 23.1) * amp,
      base.y + Math.cos(t * 0.29) * drift * 0.6 + Math.sin(t * 27.7) * amp,
      base.z,
    );
    camera.position.lerp(target, 1 - Math.pow(0.0001, dt));

    // roll: slow industrial sway + snappy hit rotation
    const roll =
      Math.sin(t * 0.23) * 0.06 +
      Math.sin(t * 0.11) * 0.03 +
      s.beat * 0.035 * Math.sin(t * 41.0) +
      s.high * 0.012 * Math.sin(t * 61.0);
    camera.rotation.z = roll;
    camera.rotation.x = Math.sin(t * 0.19) * 0.045 + s.beat * 0.02;
    camera.rotation.y = Math.sin(t * 0.157) * 0.05;
    // publish the new matrix immediately so the raymarched tunnel (which reads
    // matrixWorld) stays perfectly in sync with the mesh layers.
    camera.updateMatrixWorld();

    const cam = camera as THREE.PerspectiveCamera;
    const fov = 72 + s.sub * 6 + s.beat * 3.5;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = lerp(cam.fov, fov, 1 - Math.pow(0.001, dt));
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

  const glitchLeft = useRef(0);
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

    const b = bloom.current;
    if (b) {
      b.intensity = (0.45 + settings.bloom * 1.35) * (0.65 + s.high * 1.5 + s.beat * 0.9);
      b.luminanceMaterial.threshold = 0.09 + s.level * 0.06;
      b.luminanceMaterial.smoothing = 0.26 + s.level * 0.1;
      const rad = b as unknown as { radius?: number };
      if (typeof rad.radius === "number") rad.radius = 0.72 + s.sub * 0.24;
    }

    const c = chroma.current;
    if (c) {
      const amt = 0.00045 + s.high * 0.0042 + s.beat * 0.0026 * settings.intensity;
      (c.offset as THREE.Vector2).set(amt, amt * 0.82);
    }

    const n = noise.current;
    if (n) {
      n.blendMode.opacity.value = 0.035 + s.level * 0.05 + s.beat * 0.03;
    }

    const sc = scan.current;
    if (sc) {
      const op = 0.045 + s.high * 0.09;
      (sc as unknown as { blendMode: { opacity: { value: number } } }).blendMode.opacity.value = op;
      const dens = (sc as unknown as { density?: number });
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
        if (s.beat > 0.92 && s.sub > 0.42 && glitchLeft.current <= 0) {
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
      ref={(r: any) => { bloom.current = r as any; }}
      intensity={1.2}
      luminanceThreshold={0.12}
      luminanceSmoothing={0.3}
      mipmapBlur
      radius={0.8}
    />,
  ];

  if (tier <= 1) {
    nodes.push(
      <ChromaticAberration
        key="chroma"
        ref={(r: any) => { chroma.current = r as any; }}
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
        ref={(r: any) => { glitch.current = r as any; }}
        delay={new THREE.Vector2(1.2, 2.8)}
        duration={new THREE.Vector2(0.04, 0.18)}
        strength={new THREE.Vector2(0.04, 0.14)}
        ratio={0.85}
      />,
      <Scanline key="scan" ref={(r: any) => { scan.current = r as any; }} blendFunction={BlendFunction.OVERLAY} density={1.15} opacity={0.06} />,
      <Noise key="noise" ref={(r: any) => { noise.current = r as any; }} premultiply blendFunction={BlendFunction.ADD} opacity={0.04} />,
    );
  }

  nodes.push(<Vignette key="vignette" ref={(r: any) => { vignette.current = r as any; }} eskil={false} offset={0.26} darkness={0.78} />);

  return (
    <EffectComposer key={tier} multisampling={0} enableNormalPass={false}>
      {nodes}
    </EffectComposer>
  );
}

/* =================================================================== SCENE */

export default function Scene({ settings }: SceneProps) {
  const { gl } = useThree();
  const props = useMemo(() => ({ settings }), [settings]);

  useEffect(() => {
    gl.setClearColor(new THREE.Color("#030305"), 1);
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
    document.documentElement.style.setProperty("--accent-2", PALETTES[settings.palette % PALETTES.length].hex[1]);
  }, [settings.palette]);

  return (
    <>
      <AudioDriver />
      <PerfProbe {...props} />
      <Governor {...props} />
      <CameraRig {...props} />
      <Tunnel {...props} />
      <Core {...props} />
      <CoreGlow {...props} />
      <LaserFan {...props} />
      <StrobeRings {...props} />
      <SpectrumTowers {...props} />
      <ParticleField {...props} />
      <Effects {...props} />
    </>
  );
}
