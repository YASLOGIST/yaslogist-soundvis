# YASLOGIST SOUNDVIS — Audio-Reactive VJ Engine

![YASLOGIST SOUNDVIS promo render](./yaslogist-soundvis-preview.png)

> **YASLOGIST SOUNDVIS** is an ultra-high-performance, standalone, hardware-accelerated **audio-reactive 3D visualizer and live VJ performance engine** engineered for industrial, acid, and melodic techno. Built with WebGL2, Three.js, React Three Fiber, custom GLSL shaders, and real-time Web Audio API signal processing.

*The image above is a stylised promo render of the engine's aesthetic — fire up `npm run dev` for the real thing.*

---

## ⚡ Overview & First Principles

YASLOGIST SOUNDVIS is architected for zero-latency, stutter-free 60+ FPS performance during live electronic music performances, stage projections, and VJ sets.

Everything is computed and rendered **100% client-side** in real-time — with **zero external assets, zero network calls, zero tracking, and zero GC pressure**. Even the UI typeface (JetBrains Mono) is bundled and inlined, so the production build is a **single self-contained `index.html`** that runs off-grid, in airplane mode, off a USB stick.

```
                           ┌────────────────────────────────────────┐
                           │          Audio Input Source            │
                           │  (Internal Synth / Mic / Sys / File)   │
                           └───────────────────┬────────────────────┘
                                               │
                                               ▼
                           ┌────────────────────────────────────────┐
                           │      Web Audio API Signal Graph        │
                           │  FFT 1024 · 4-Band Splitting · RMS     │
                           └───────────────────┬────────────────────┘
                                               │
                         ┌─────────────────────┴─────────────────────┐
                         │                                           │
                         ▼                                           ▼
             ┌────────────────────────┐                 ┌─────────────────────────┐
             │ Global Mutable State   │                 │ Direct DOM HUD Bridge   │
             │ (audioState - No React)│                 │ (hudBridge - 0 Re-render│
             └───────────┬────────────┘                 └─────────────────────────┘
                         │
                         ▼
             ┌────────────────────────┐
             │ R3F Frame Loop (GPU)   │
             │ 3D SDF / GLSL Shaders  │
             └────────────────────────┘
```

---

## 🏛️ System Architecture

* **React 19 & React Three Fiber (R3F)**: Declarative scene hierarchy with strictly decoupled animation loops.
* **Three.js (r180)**: Native WebGL2 rendering pipeline with instanced meshes, custom shader materials, and dynamic buffer geometries.
* **Custom GLSL 3.0 Shaders**: Ashima 3D Simplex noise, FBM, raymarched signed distance field (SDF) infinite tunnels, and cosmic plasma fragment routines.
* **Zero React Loop Overhead**: The audio engine writes directly to typed numeric arrays in `audioState`; `useFrame` pipes values directly to `ShaderMaterial.uniforms` and GPU instance matrices.
* **Post-Processing Pipeline**: Multi-stage `postprocessing` effect composer featuring Bloom, Chromatic Aberration, Vignette, Film Grain, Scanlines, and Hardware-Protected Auto-Recovery fallback tiers.

---

## 🌟 Core Features & Hyper-Dimensional FX

### 1. 🎛️ Glassmorphism HUD Control Dock
* **Collapsible Floating Dock**: Sleek cyberpunk aesthetic with strict Tailwind CSS glassmorphism (`backdrop-blur-2xl`, subtle cyan glow, custom thin scrollbar).
* **Zen Mode (`👁 ZEN`)**: Complete UI collapse into a minimal trigger badge, leaving the viewport **100% clean and unobstructed** for live stage visual projections.
* **Live Analysis Console**: Real-time FFT spectrum analyzer, time-domain oscilloscope, and transient sub/bass/mid/high VU meters.

### 2. 🌀 Quantum Portal (Custom GLSL Plasma)
* Multi-ring instanced torus geometry that counter-rotates dynamically.
* Angular rotation speed is locked to the **Highs** frequency band (5 kHz – 16 kHz), accelerating violently on hi-hat and cymbal strikes.
* Driven by a custom GLSL fragment shader simulating harmonic cosmic plasma flow and luminescent Fresnel rim edge glow.

### 3. ⚡ Neural Synapses
* Radial filament burst system built with `THREE.LineSegments`.
* Strictly triggered upon **Bass & Sub** transient peak thresholds (> 0.58), shooting randomized high-velocity energy paths outward from the singularity core.

### 4. 💥 The "Drop" Impact Dynamics
* Real-time broadband RMS and sub-bass surge detector.
* When a massive drop or heavy transient hits:
  * **Camera FOV Punch**: Instantly explodes the perspective field of view outward (+22°) and spring-damps back into groove.
  * **3x Bloom Flare**: Supercharges global luminescent bloom by 300% for an explosive visual flash.

### 5. 💎 Crystalline Glitch
* Global chromatic aberration pass with prismatic RGB dispersion, high-frequency audio flutter, and interactive intensity control.

### 6. ⏱️ Master Clock Synchronization
* Synchronizes visual animation phases, particle orbits, and synth patterns to a central BPM phase (0.0 … 1.0) for razor-sharp temporal alignment.

### 7. 🎨 20 Curated Color Palettes & 12 Base Geometries
* Includes *Laser Cyan*, *Acid Neon*, *Ultraviolet*, *Glitch White*, *Infrared*, *Toxic Magenta*, *Solar Gold*, *Biohazard*, *Matrix Code*, *Liquid Gold*, *Void Matter*, and more.
* 12 morphable geometric shapes including Icosahedrons, Torus Knots, Octahedrons, Hyper-Cubes, and Liquid Metal vertex displacement.

### 8. 💾 Look Preset Bank (Save / Recall / Share)
* **8 live slots** capture the *entire aesthetic state* — palette, geometry, post-FX, motion, and every scene layer — while deliberately excluding machine-specific settings (quality, particle budgets) and operator preferences (zen mode, HUD contrast).
* **Hot-switch during sets**: click a slot to recall, `⇧`-click to overwrite, `alt`-click to clear, or use the <kbd>F1</kbd>–<kbd>F8</kbd> keys (<kbd>⇧</kbd>+<kbd>F1</kbd>–<kbd>F8</kbd> to store).
* **Portable presets**: export/import looks as `.json` files, or copy a **share link** that encodes the full look into the URL (`#look=…`) — perfect for trading looks with other performers.
* All imported/shared data is sanitised through a hardened validator, so a hostile preset file can do nothing beyond… looking ugly.

### 9. 🎹 Built-In Procedural 132 BPM Acid Techno Synthesizer
* Dual-oscillator pitched sub-bass kick drum, 303 resonant acid bassline, industrial 909-style closed/open hats, and analog noise sweep generator.
* Live Tap-BPM tempo calculator and frequency profile EQ curve selector (*Smooth*, *Standard*, *Dynamic*, *Hyper*).

---

## 📸 Snapshot & Promo Capture Utility

* **`[PNG]`**: Reads the active WebGL framebuffer (`preserveDrawingBuffer: true`) and downloads a pristine full-resolution lossless PNG still.
* **60 FPS Video Recorder**: Built-in MediaRecorder engine muxes real-time WebGL video with the source audio stream into `.webm` / `.mp4` performance clips.

---

## 🚀 Setup & Installation

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm** (or pnpm / yarn)

### Quickstart

```bash
# 1. Clone or navigate to the repository
cd yaslogist-soundvis

# 2. Install dependencies
npm install

# 3. Start development server (with Vite HMR)
npm run dev

# 4. Open in your browser
# => http://localhost:5173
```

### Production Build

```bash
# Type-check and compile single-file distribution bundle
npm run build

# Preview production build locally
npm run preview
```

> The production build compiles into a **single self-contained `dist/index.html`** file via `vite-plugin-singlefile`. It can be run locally off-grid or deployed instantly to Cloudflare Pages, Vercel, Netlify, or GitHub Pages.

### Engineering & Quality Gates

The repo ships with a full toolchain — all enforced in CI (`.github/workflows/ci.yml`):

```bash
npm run typecheck     # strict TypeScript, no emit
npm run lint          # ESLint (typescript-eslint + react-hooks)
npm run format        # Prettier
npm run format:check
npm test              # Vitest — sanitizer + preset-system unit tests
npm run build         # typecheck-gated single-file production bundle
```

* `sanitizeSettings()` validates **every** persisted/imported field against a declarative spec (ranges, enums, integer fields, type matching) — corrupted `localStorage` or malicious preset files can never crash the render loop.
* Existing users are migrated transparently from the legacy `void-reactor.settings.v1` storage key.

---

## ⌨️ Keyboard Shortcuts & Hotkeys

| Key | Action |
| :--- | :--- |
| <kbd>SPACE</kbd> | Toggle Play / Pause Audio Source |
| <kbd>H</kbd> | Toggle HUD Interface Visibility |
| <kbd>Z</kbd> | Toggle Zen Performance Mode |
| <kbd>F</kbd> | Toggle Fullscreen Mode |
| <kbd>1</kbd> – <kbd>9</kbd> / <kbd>0</kbd> | Quick-Select Palette (first 10 of 20) |
| <kbd>F1</kbd> – <kbd>F8</kbd> | Recall Look Preset Slot 1–8 |
| <kbd>⇧</kbd> + <kbd>F1</kbd> – <kbd>F8</kbd> | Store Current Look into Slot |
| <kbd>P</kbd> | Capture Instant PNG Snapshot |
| <kbd>R</kbd> | Start / Stop 60 FPS Video Recording |
| <kbd>G</kbd> | Toggle Glitch Bursts |
| <kbd>A</kbd> | Toggle Auto-Performance Governor |
| <kbd>L</kbd> | Toggle Auto-Look (32-beat phrase palette advance) |
| <kbd>←</kbd> / <kbd>→</kbd> | Seek the Loaded Track ±5s |
| <kbd>?</kbd> | Open Shortcuts & System Diagnostics Sheet |

---

## ⚙️ Hardware Optimization

Optimized for **Apple Silicon (M1/M2/M3/M4, Metal)** and modern dedicated GPUs (NVIDIA RTX / AMD Radeon):
* Adaptive performance governor automatically balances render resolution, particle draw-range, and post-FX passes to maintain locked **60+ FPS**.
* Native FP32 vector math and branchless GLSL fragment routines.

---

## 📄 License & Attribution

Architected & Engineered by **Ahmed Yasser (YASLOGIST)**.
Released under the **MIT License**. JetBrains Mono is bundled under the **SIL Open Font License** (`src/assets/fonts/OFL.txt`).
