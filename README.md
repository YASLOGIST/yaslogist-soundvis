# VOID // REACTOR

An ultra-high-performance, standalone **audio-reactive 3D visualizer** engineered for
industrial / melodic techno. Raymarched SDF tunnel, a 160 000-point simplex-noise cloud,
real-time FFT band isolation and a transient-locked post-processing pipeline.

Everything is synthesised and rendered **locally** — no assets, no network, no tracking.

---

## Install & run

```bash
npm install          # three, @react-three/fiber, @react-three/postprocessing, postprocessing
npm run dev          # http://localhost:5173
npm run build        # single-file production bundle → dist/index.html
npm run preview      # serve the production bundle
```

> The production build is inlined into **one self-contained `dist/index.html`** by
> `vite-plugin-singlefile` — drop it on any static host or open it from disk.

---

## Architecture

```
src/
├─ audio/
│  ├─ AudioEngine.ts    Web Audio graph: dual input, FFT 1024, band isolation,
│  │                    adaptive normalisation, transient/beat detection, BPM lock
│  ├─ DemoSynth.ts      Procedural 132 BPM peak-time techno generator
│  │                    (pitched-sub kick, 303 acid line, industrial hats, dub stabs)
│  └─ state.ts          Mutable, React-free frame state + palettes + quality presets
├─ three/
│  ├─ Scene.tsx         Layer components, camera rig, adaptive governor, post FX
│  └─ shaders.ts        All GLSL: simplex noise, SDF raymarcher, particle morph,
│                       procedural metal shading, strobe + laser instancing
├─ media/Recorder.ts    MediaRecorder capture (canvas video + Web Audio muxed)
├─ ui/
│  ├─ Hud.tsx           Floating console — zero re-renders in the animation loop
│  └─ ErrorBoundary.tsx Render-pipeline fault isolation
└─ App.tsx              Shell: boot gate, capture, presets, drag & drop, shortcuts
```

### Data flow (why it never stutters)

```
AnalyserNode ──▶ AudioEngine.update()  ──▶ audioState (plain mutable object)
                                               │
              useFrame (once per frame) ───────┘
                                               ▼
                      shader uniforms + DOM style writes
```

* **Zero React state inside the animation loop.** The analyser writes into a module-level
  `audioState` object; `useFrame` copies those values straight into `ShaderMaterial.uniforms`.
* HUD meters, the spectrum, the oscilloscope, the FPS/BPM readouts and the beat lamp are
  written **directly to DOM nodes** through `hudBridge` — no reconciliation, no GC pressure.
* All GPU buffers are pre-allocated once; nothing is created per frame except a handful of
  reusable `Vector2`/`Matrix3` scratch objects.

---

## Audio analysis

| Band | Range | Drives |
|------|-------|--------|
| Sub / kick | 20 – 120 Hz | tunnel radius pulse, camera shake, radial shockwave, glitch bursts |
| Bass | 120 – 400 Hz | monolith scale, shell brightness, cone sheen |
| Mids / synths | 400 – 2500 Hz | noise displacement, mesh morph, vortex + rotation speed |
| Highs / tops | 5 – 16 kHz | bloom spikes, chromatic aberration, particle velocity, sparkle |

* `AnalyserNode` with `fftSize = 1024`, `smoothingTimeConstant = 0.82`.
* Bands are read from `Uint8Array` FFT data with a perceptual low-bin tilt;
  the waveform comes from `Float32Array` time-domain data.
* **Adaptive normalisation** tracks the rolling RMS so a quiet microphone drives the scene
  exactly as hard as a mastered track.
* **Beat detection** compares the sub-band against a 48-frame rolling mean, weighted by
  variance, with a 220 ms refractory window; median inter-onset interval → live BPM.
* Attack/release envelopes per band (fast attack, slow release) keep motion punchy but
  free of flicker.

## Visual pipeline

1. **Raymarched SDF tunnel** — fullscreen NDC quad, inside-measured distance field:
   14 radial I-beams, conduits, plated floor deck with a glowing grid, and a rotating
   fractal monolith gate every 24 units. Proximity-glow accumulation fakes volumetrics.
   Triplanar-ish panel seams, brushed-steel grain, ACES-fitted tone curve.
2. **Point cloud** — up to 160 000 points, custom GLSL vertex shader: 3D simplex
   displacement field, differential vortex rotation, kick shockwave shell, treble
   micro-jitter, additive soft sprites with depth fade.
3. **Core** — noise-displaced icosphere with analytically re-derived normals, procedural
   metal shading (dual specular lobes, fresnel rim, acid veins, machined scan bands) plus
   an additive wireframe shell.
4. **Strobes & lasers** — instanced additive rings (rotating dash pattern) and a 44-beam
   laser fan, both phase-locked to the sub-band.
5. **Post** — mipmap Bloom → Glitch (transient-gated `CONSTANT_WILD` bursts) →
   Chromatic Aberration → Scanline → premultiplied Grain → Vignette.
   Every parameter is audio-modulated per frame.

## Performance

* **AUTO-PERF governor** — watches the frame rate once per 1.1 s and quietly trades
  device pixel ratio and particle draw-range (4 levels) to hold 60 fps, then steps back up.
  Runs entirely outside React.
* Three quality presets (ECO / BALANCED / ULTRA) set DPR clamps, march steps and the
  particle budget; core tessellation and instance counts follow.
* `antialias: false`, `stencil: false`, no shadow maps, no post-processing normal pass,
  `multisampling: 0`, HDR half-float composer targets.

## Inputs

| Mode | Notes |
|------|-------|
| **SYNTH** | Built-in generator — instant, no permissions, deterministic 132 BPM loop |
| **MIC** | `getUserMedia` with AGC/NS/EC off; monitoring muted to prevent feedback |
| **SYSTEM** | `getDisplayMedia` tab/desktop audio with explicit "no audio track" detection |
| **FILE** | Object-URL `MediaElementSource`; loop, seek, volume, drag & drop |

Every failure path is handled and surfaced as a toast: permission denial, missing device,
cancelled share, missing audio track, decode failure and unsupported APIs.

## Capture

* **REC** — `MediaRecorder` at 60 fps, VP9/Opus (VP8/MP4 fallback), ~14 Mbps, with the
  source audio muxed in from a `MediaStreamAudioDestinationNode` tapped off the analyser,
  so the exported clip always contains the music.
* **PNG** — lossless still straight from the framebuffer (`preserveDrawingBuffer: true`).

## Shortcuts

`SPACE` play/pause · `H` hide UI · `F` fullscreen · `1-4` palette · `R` record ·
`P` PNG · `G` glitch · `A` auto-perf · `L` auto-look · `←/→` seek · `?` sheet

Drop an audio file anywhere to load it. The interface auto-hides after 6 s of inactivity.
