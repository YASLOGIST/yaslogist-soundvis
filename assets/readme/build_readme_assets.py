#!/usr/bin/env python3
"""
YASLOGIST SOUNDVIS — README visual system renderer.

Produces (all deterministic, seamless loops):
  assets/readme/yaslogist-hero.gif     animated cinematic hero (8.0 s loop, 96 frames)
  assets/readme/yaslogist-hero.png     static poster (peak-composition frame)
  assets/readme/yaslogist-signature.png closing YASLOGIST wordmark (static)
  assets/readme/yaslogist-divider.png  luminous section divider (static)

Requirements: python3.10+, pillow, numpy, fonttools, brotli
Usage:        python3 assets/readme/build_readme_assets.py
"""
from __future__ import annotations

import math
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "assets" / "readme"
FONT_SRC = ROOT / "src/assets/fonts/jetbrains-mono-latin-wght-normal.woff2"

W, H = 1200, 450           # 8:3 master, displayed at width=100%
N_FRAMES = 96              # 96 frames × 80 ms = 7.68 s seamless loop
FRAME_MS = 80
SS = 1                     # supersampling disabled for GIF; geometry is antialiased by blur

CYAN = (0, 240, 255)
BLUE = (11, 91, 255)
VIOLET = (123, 44, 191)
MAGENTA = (255, 46, 151)
ICE = (234, 252, 255)
INK = (3, 4, 9)
DIM = (120, 150, 172)
WHITE = (240, 250, 255)

TAU = math.tau

# ─────────────────────────────────────────────────────────────────────────────
# Fonts: instance the bundled JetBrains Mono variable font at real weights
# ─────────────────────────────────────────────────────────────────────────────
_font_cache: dict[tuple[int, int], ImageFont.FreeTypeFont] = {}
_tmpdir = tempfile.mkdtemp(prefix="yas-readme-")


def font(weight: int, size: int) -> ImageFont.FreeTypeFont:
    key = (weight, size)
    if key in _font_cache:
        return _font_cache[key]
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    path = Path(_tmpdir) / f"jbm-{weight}.ttf"
    if not path.exists():
        f = TTFont(str(FONT_SRC))
        inst = instantiateVariableFont(f, {"wght": weight}, inplace=False)
        inst.flavor = None
        inst.save(str(path))
    _font_cache[key] = ImageFont.truetype(str(path), size)
    return _font_cache[key]


# ─────────────────────────────────────────────────────────────────────────────
# Geometry: icosahedron (same construction as the engine's hero core)
# ─────────────────────────────────────────────────────────────────────────────
PHI = (1 + math.sqrt(5)) / 2
_raw = []
for s1 in (-1, 1):
    for s2 in (-1, 1):
        _raw += [(s1, s2 * PHI, 0.0), (0.0, s1, s2 * PHI), (s1 * PHI, 0.0, s2)]
_n = math.sqrt(1 + PHI * PHI)
ICO_V = [np.array(v) / _n for v in _raw]
_edge = min(
    float(np.linalg.norm(ICO_V[i] - ICO_V[j]))
    for i in range(12)
    for j in range(i + 1, 12)
)
ICO_E = [
    (i, j)
    for i in range(12)
    for j in range(i + 1, 12)
    if abs(float(np.linalg.norm(ICO_V[i] - ICO_V[j])) - _edge) < 1e-6
]


def rot(v: np.ndarray, rx: float, ry: float, rz: float) -> np.ndarray:
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    x, y, z = v
    y, z = y * cx - z * sx, y * sx + z * cx
    x, z = x * cy + z * sy, -x * sy + z * cy
    x, y = x * cz - y * sz, x * sz + y * cz
    return np.array([x, y, z])


def project(v: np.ndarray, cx: float, cy: float, f: float, cam: float = 3.2) -> tuple[float, float, float]:
    z = v[2] + cam
    s = f / z
    return cx + v[0] * s, cy - v[1] * s, z


def ring_points(radius: float, tilt_x: float, tilt_y: float, spin: float, n: int = 160):
    pts = []
    for k in range(n + 1):
        a = TAU * k / n + spin
        v = rot(np.array([math.cos(a), math.sin(a), 0.0]) * radius, tilt_x, tilt_y, 0.0)
        pts.append(v)
    return pts


# ─────────────────────────────────────────────────────────────────────────────
# Background: deep-space gradient + breathing haze (periodic in p)
# ─────────────────────────────────────────────────────────────────────────────
_yy, _xx = np.mgrid[0:H, 0:W].astype(np.float32)
_nx = (_xx - W / 2) / (H / 2)
_ny = (_yy - H / 2) / (H / 2)
_r = np.sqrt(_nx * _nx + _ny * _ny)


def background(p: float) -> np.ndarray:
    breathe = 0.5 + 0.5 * math.sin(TAU * p)
    base = np.zeros((H, W, 3), np.float32)
    base[:] = np.array(INK, np.float32)
    # vertical gradient toward the floor
    g = np.clip((_yy / H), 0, 1)[..., None]
    base += g * np.array([4, 6, 14], np.float32)
    # cyan haze, offset slowly (camera drift)
    dx = 0.12 * math.sin(TAU * p)
    h1 = np.exp(-((_nx - dx + 0.55) ** 2 * 2.2 + (_ny + 0.15) ** 2 * 2.6))
    h2 = np.exp(-((_nx + dx - 0.55) ** 2 * 2.2 + (_ny - 0.1) ** 2 * 2.6))
    base += h1[..., None] * np.array(BLUE, np.float32) * (0.10 + 0.04 * breathe)
    base += h2[..., None] * np.array(VIOLET, np.float32) * (0.12 + 0.04 * (1 - breathe))
    # core halo behind the hero
    core = np.exp(-(_r * _r) * 3.2)
    base += core[..., None] * np.array(CYAN, np.float32) * (0.08 + 0.03 * breathe)
    return base


# ─────────────────────────────────────────────────────────────────────────────
# Drawing layers
# ─────────────────────────────────────────────────────────────────────────────
HERO_CX, HERO_CY, HERO_F = W * 0.62, H * 0.50, 300.0


def draw_floor(d: ImageDraw.ImageDraw, p: float) -> None:
    """Perspective floor grid scrolling toward the camera (integer cycles per loop)."""
    horizon = H * 0.66
    for i in range(14):
        z = ((i + p * 14) % 14) / 14.0
        depth = 0.08 + z * z * 2.2
        y = horizon + (H - horizon) * (depth - 0.08) / 2.3
        alpha = int(70 * min(1, z * 2.2) * (1 - z * 0.6))
        d.line([(0, y), (W, y)], fill=(*CYAN, alpha), width=1)
    for k in range(-10, 11):
        x0 = W / 2 + k * 90
        d.line([(W / 2 + k * 9, horizon), (x0 * 1.0 + (x0 - W / 2) * 0.0, H)], fill=(*BLUE, 42), width=1)


def draw_rings(d: ImageDraw.ImageDraw, p: float) -> None:
    """Three quantum-portal rings rotating on different tilts (integer spin per loop)."""
    specs = [
        (1.25, 1.10, 0.25, +1, CYAN),
        (1.60, 0.55, -0.60, -2, MAGENTA),
        (2.00, 1.35, 0.90, +1, BLUE),
    ]
    for radius, tx, ty, k, col in specs:
        spin = TAU * k * p + radius * 0.01
        pts = ring_points(radius, tx + 0.15 * math.sin(TAU * p), ty, spin)
        proj = [project(v, HERO_CX, HERO_CY, HERO_F) for v in pts]
        xy = [(x, y) for x, y, _ in proj]
        d.line(xy, fill=(*col, 170), width=2, joint="curve")
        # a travelling highlight segment on each ring
        seg_start = int((p * k % 1.0) * 160) % 160
        seg = [xy[(seg_start + j) % 160] for j in range(22)]
        d.line(seg, fill=(*ICE, 255), width=3, joint="curve")


def draw_tick_marks(d: ImageDraw.ImageDraw, p: float) -> None:
    """Measurement ticks around the outer ring — coordinate markers."""
    for i in range(72):
        a = TAU * i / 72 + TAU * p * 0.5
        r0 = 262 if i % 6 else 252
        r1 = 272
        x0 = HERO_CX + math.cos(a) * r0 * 0.92
        y0 = HERO_CY + math.sin(a) * r0 * 0.42
        x1 = HERO_CX + math.cos(a) * r1 * 0.92
        y1 = HERO_CY + math.sin(a) * r1 * 0.42
        d.line([(x0, y0), (x1, y1)], fill=(*DIM, 120 if i % 6 else 200), width=1)


def draw_core(d: ImageDraw.ImageDraw, p: float, beat: float) -> list[tuple[float, float]]:
    """Icosahedral core: rotating wireframe with travelling signal pulses on edges."""
    rx = TAU * p
    ry = TAU * 2 * p
    rz = 0.2 * math.sin(TAU * p)
    scale = 118 + 9 * beat
    projected = []
    for v in ICO_V:
        q = rot(v * scale / 100.0, rx * 0.5, ry, rz)
        projected.append(project(q, HERO_CX, HERO_CY, HERO_F))
    for i, j in ICO_E:
        a, b = projected[i], projected[j]
        d.line([(a[0], a[1]), (b[0], b[1])], fill=(*CYAN, 150), width=2)
    # traveling pulses — one per edge, phase-offset around the loop
    for idx, (i, j) in enumerate(ICO_E):
        s = (p * 2 + idx / len(ICO_E)) % 1.0
        a, b = projected[i], projected[j]
        x = a[0] + (b[0] - a[0]) * s
        y = a[1] + (b[1] - a[1]) * s
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(*ICE, 255))
    for x, y, _ in projected:
        d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(*ICE, 230), width=1)
    return [(x, y) for x, y, _ in projected]


def draw_particles(d: ImageDraw.ImageDraw, p: float) -> None:
    """Particle trails on three orbital bands (each completes integer turns)."""
    rng = np.random.default_rng(7)
    for band, (r, turns, col) in enumerate([(300, 1, CYAN), (340, -2, VIOLET), (380, 3, BLUE)]):
        for k in range(38):
            base = rng.uniform(0, TAU)
            a = base + TAU * turns * p
            zoff = math.sin(a * 2 + band) * 14
            x = HERO_CX + math.cos(a) * r * 0.92
            y = HERO_CY + math.sin(a) * r * 0.36 + zoff
            size = 1 + (k % 3 == 0)
            d.ellipse([x - size, y - size, x + size, y + size], fill=(*col, 210))


def draw_scan(d: ImageDraw.ImageDraw, p: float) -> None:
    y = (p * H) % H
    d.line([(0, y), (W, y)], fill=(*CYAN, 38), width=2)


def draw_eq(d: ImageDraw.ImageDraw, p: float, beat: float) -> None:
    """Bottom-left spectrum bars; 16 beats per loop (120 BPM) drive the envelope."""
    x0, y_base = 46, H - 52
    n = 26
    for i in range(n):
        phase = TAU * (p * 16) + i * 0.45
        lvl = 0.22 + 0.38 * (0.5 + 0.5 * math.sin(phase)) * (0.7 + 0.5 * beat)
        lvl += 0.12 * (0.5 + 0.5 * math.sin(TAU * p * 4 + i * 0.9))
        lvl = min(lvl, 1.0)
        h = 8 + 56 * lvl
        x = x0 + i * 9
        col = CYAN if i < n * 0.6 else MAGENTA
        d.rectangle([x, y_base - h, x + 5, y_base], fill=(*col, 215))


def draw_trace(d: ImageDraw.ImageDraw, p: float) -> None:
    """Bottom-right transmission trace — a periodic sine composition."""
    x0, x1 = 400, 740
    yc = H - 46
    pts = []
    for k in range(120):
        t = k / 119
        y = (
            math.sin(TAU * (t * 2 + p)) * 14
            + math.sin(TAU * (t * 5 - p * 2)) * 6
            + math.sin(TAU * (t * 9 + p * 3)) * 2.5
        )
        pts.append((x0 + (x1 - x0) * t, yc + y))
    d.line(pts, fill=(*CYAN, 230), width=2, joint="curve")
    head = pts[int((p % 1) * 119)]
    d.ellipse([head[0] - 3, head[1] - 3, head[0] + 3, head[1] + 3], fill=(*ICE, 255))


def hud_text(d: ImageDraw.ImageDraw) -> None:
    """Static typographic identity — never occluded by moving layers."""
    # top-left project chip
    d.rounded_rectangle([34, 30, 470, 96], radius=8, fill=(7, 10, 16, 215), outline=(*CYAN, 60))
    d.rectangle([52, 52, 62, 62], fill=(*CYAN, 255))
    d.text((76, 40), "YASLOGIST // SOUNDVIS", font=font(700, 26), fill=(*WHITE, 255))
    d.text((78, 73), "AUDIO-REACTIVE 3D VISUALIZER · LIVE VJ ENGINE", font=font(400, 13), fill=(*DIM, 255))

    # top-right status panel
    d.rounded_rectangle([W - 300, 30, W - 34, 96], radius=8, fill=(7, 10, 16, 215), outline=(*CYAN, 60))
    d.text((W - 280, 42), "SOURCE", font=font(400, 12), fill=(*DIM, 255))
    d.text((W - 280, 60), "SYNTH · MIC · FILE", font=font(600, 15), fill=(*ICE, 255))
    d.text((W - 280, 78), "RAYMARCHED · WEBGL2", font=font(400, 11), fill=(*DIM, 255))


def signature(d: ImageDraw.ImageDraw, p: float) -> None:
    """Persistent YASLOGIST signature, bottom-right, always visible."""
    x, y = W - 34, H - 34
    d.rounded_rectangle([W - 300, H - 98, W - 34, H - 30], radius=8, fill=(7, 10, 16, 220), outline=(*CYAN, 70))
    shimmer = 0.5 + 0.5 * math.sin(TAU * p)
    col = tuple(int(c * (0.86 + 0.14 * shimmer)) for c in WHITE)
    d.text((W - 280, H - 84), "YASLOGIST", font=font(700, 22), fill=(*col, 255))
    d.text((W - 280, H - 56), "yaslogist.com", font=font(400, 12), fill=(*CYAN, 255))
    d.line([(W - 46, H - 84), (W - 46, H - 44)], fill=(*CYAN, 180), width=2)


def glow(layer: Image.Image) -> Image.Image:
    """Bloom: a blurred copy of the RGBA layer composited beneath the sharp layer."""
    blur = layer.filter(ImageFilter.GaussianBlur(9))
    arr = np.asarray(blur, np.float32)
    arr[..., 3] *= 0.85
    halo = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return Image.alpha_composite(halo, layer)


def compose(p: float) -> Image.Image:
    beat = math.exp(-3.4 * ((p * 16) % 1.0))  # kick envelope, 16 beats per loop
    base = Image.fromarray(np.clip(background(p), 0, 255).astype(np.uint8), "RGB").convert("RGBA")

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    draw_floor(d, p)
    draw_rings(d, p)
    draw_tick_marks(d, p)
    draw_core(d, p, beat)
    draw_particles(d, p)
    draw_scan(d, p)
    draw_eq(d, p, beat)
    draw_trace(d, p)

    base = Image.alpha_composite(base, glow(layer))
    fg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fg)
    hud_text(fd)
    signature(fd, p)
    base = Image.alpha_composite(base, fg)
    return base.convert("RGB")


# ─────────────────────────────────────────────────────────────────────────────
# Static assets
# ─────────────────────────────────────────────────────────────────────────────
def render_signature(path: Path) -> None:
    w, h = 900, 180
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=16, fill=(7, 10, 16, 235), outline=(*CYAN, 90), width=2)
    d.rectangle([44, 66, 56, 78], fill=(*CYAN, 255))
    d.text((78, 52), "YASLOGIST", font=font(700, 64), fill=(*WHITE, 255))
    d.text((80, 128), "PERMANENT CREATIVE SIGNATURE · yaslogist.com", font=font(400, 22), fill=(*DIM, 255))
    d.line([(78, 116), (w - 60, 116)], fill=(*CYAN, 120), width=1)
    img.save(path, optimize=True)


def render_divider(path: Path) -> None:
    w, h = 1200, 24
    x = np.linspace(-1, 1, w)
    line = np.exp(-(x * x) * 18.0)
    arr = np.zeros((h, w, 4), np.uint8)
    for row in range(h):
        fall = math.exp(-((row - h / 2) ** 2) / 1.2)
        a = (line * fall * 255).astype(np.uint8)
        col = np.array(CYAN, np.float32)
        arr[row, :, :3] = np.clip(col * (line[:, None] * fall), 0, 255).astype(np.uint8)
        arr[row, :, 3] = a
    Image.fromarray(arr, "RGBA").save(path, optimize=True)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    frames = [compose(i / N_FRAMES) for i in range(N_FRAMES)]

    poster = frames[int(N_FRAMES * 0.5)]
    poster.save(OUT / "yaslogist-hero.png", optimize=True)

    # Palette: quantise every frame against one shared adaptive palette for stable colour
    sheet = Image.new("RGB", (W, H * 4))
    for k, idx in enumerate([0, 24, 48, 72]):
        sheet.paste(frames[idx], (0, H * k))
    palette_img = sheet.quantize(colors=240, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q = [f.quantize(palette=palette_img, dither=Image.Dither.NONE) for f in frames]
    q[0].save(
        OUT / "yaslogist-hero.gif",
        save_all=True,
        append_images=q[1:],
        duration=FRAME_MS,
        loop=0,
        optimize=False,
        disposal=1,
    )

    render_signature(OUT / "yaslogist-signature.png")
    render_divider(OUT / "yaslogist-divider.png")
    print("wrote", sorted(p.name for p in OUT.iterdir()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
