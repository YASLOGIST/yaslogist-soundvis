#!/usr/bin/env python3
"""
YASLOGIST SOUNDVIS — social / Open Graph media generator.

Renders the engine's signature look (deep-space tunnel, quantum portal ring
stack, hot icosahedral core, neural-synapse filaments, live HUD chrome) into
two brand assets:

  public/og-animated.gif   animated Open Graph hero / README loop
  public/og-image.png      static poster (Open Graph fallback)

The clip is a mathematically perfect loop: exactly 11 beats @ 132 BPM in
5.0 s at 25 fps. Every oscillator completes an integer number of cycles per
loop, so the last frame joins the first with zero seams.

Requirements:
  python3.10+ · pillow · numpy · fonttools + brotli (to unpack the bundled
  JetBrains Mono variable font; falls back gracefully without them)

Usage:
  python3 scripts/generate_og.py               # full render
  python3 scripts/generate_og.py --probe-only  # render just the poster frame
"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# ─────────────────────────────────────────────────────────────────────────────
# Brand constants
# ─────────────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
FONT_SRC = ROOT / "src/assets/fonts/jetbrains-mono-latin-wght-normal.woff2"

FPS = 25
BEAT_HZ = 132 / 60.0          # the built-in synth's native tempo
BEATS = 11                    # exact beats per loop → seamless
LOOP_T = BEATS / BEAT_HZ      # 5.0 s
BEAT_DUR = 1.0 / BEAT_HZ
DROP_BEAT = 8                 # mid-loop climax (t ≈ 3.636 s, frame 91)
DROP_T = DROP_BEAT * BEAT_DUR + 0.14 * BEAT_DUR  # poster instant (peak flare)

# Palettes lifted verbatim from src/audio/state.ts (LASER CYAN ↔ ULTRAVIOLET)
LASER_CYAN = ((0, 240, 255), (11, 91, 255), (234, 252, 255))
ULTRAVIOLET = ((123, 44, 191), (255, 46, 151), (240, 226, 255))

INK = (3, 3, 5)               # matches gl.setClearColor("#030305")
CHIP_BG = (7, 10, 16, 200)
DIM = (120, 150, 172)
WHITE = (240, 250, 255)
TAU = math.tau

# ─────────────────────────────────────────────────────────────────────────────
# Math helpers
# ─────────────────────────────────────────────────────────────────────────────


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if v < lo else hi if v > hi else v


def mix(a, b, m: float):
    return tuple(int(round(a[i] + (b[i] - a[i]) * m)) for i in range(3))


def scaled(color, k: float):
    return tuple(max(0, min(255, int(round(c * k)))) for c in color)


def beat_env(t: float, decay: float = 3.4) -> float:
    """Kick envelope — 1.0 at each beat onset, exp decay between beats."""
    p = (t * BEAT_HZ) % 1.0
    e = math.exp(-decay * p)
    if int(t * BEAT_HZ) % 4 == 0:
        e *= 1.12  # downbeat accent
    return min(e, 1.18)


def drop_flash(t: float, decay: float = 5.2) -> float:
    """One-shot flash envelope starting at the drop beat."""
    tau = (t - DROP_BEAT * BEAT_DUR) % LOOP_T
    return math.exp(-decay * tau / BEAT_DUR) if tau < BEAT_DUR * 2 else 0.0


def snare_env(t: float) -> float:
    """Accent envelope on the backbeats (2, 6, 10)."""
    beat = (t * BEAT_HZ) % BEATS
    d = min(abs(beat - c) for c in (2.0, 6.0, 10.0))
    return math.exp(-7.0 * min(d, BEATS - d))


def rotate(x, y, z, rx, ry):
    cy, sy = math.cos(ry), math.sin(ry)
    x, z = x * cy + z * sy, -x * sy + z * cy
    cx_, sx = math.cos(rx), math.sin(rx)
    y, z = y * cx_ - z * sx, y * sx + z * cx_
    return x, y, z


# ─────────────────────────────────────────────────────────────────────────────
# Icosahedron (core geometry, mirrored from Scene.tsx's hero shape)
# ─────────────────────────────────────────────────────────────────────────────

PHI = (1 + math.sqrt(5)) / 2
_raw = []
for _s1 in (-1, 1):
    for _s2 in (-1, 1):
        _raw += [(_s1, _s2 * PHI, 0.0), (0.0, _s1, _s2 * PHI), (_s1 * PHI, 0.0, _s2)]
_n = math.sqrt(1 + PHI * PHI)
ICO_V = [(x / _n, y / _n, z / _n) for x, y, z in _raw]
_edge = min(
    math.dist(ICO_V[i], ICO_V[j])
    for i in range(len(ICO_V))
    for j in range(i + 1, len(ICO_V))
)
ICO_E = tuple(
    (i, j)
    for i in range(len(ICO_V))
    for j in range(i + 1, len(ICO_V))
    if abs(math.dist(ICO_V[i], ICO_V[j]) - _edge) < 1e-6
)
_edge_set = {tuple(sorted(e)) for e in ICO_E}
ICO_F = tuple(
    (a, b, c)
    for a in range(len(ICO_V))
    for b in range(a + 1, len(ICO_V))
    for c in range(b + 1, len(ICO_V))
    if (a, b) in _edge_set and (a, c) in _edge_set and (b, c) in _edge_set
)

# ─────────────────────────────────────────────────────────────────────────────
# Fonts — unpack the bundled JetBrains Mono variable font into static weights
# ─────────────────────────────────────────────────────────────────────────────

_fonts: dict[tuple[int, int], ImageFont.FreeTypeFont] = {}


def _ttf(weight: int) -> str | None:
    out = Path(tempfile.gettempdir()) / f"yaslogist-jbm-{weight}.ttf"
    if out.exists():
        return str(out)
    try:
        from fontTools.ttLib import TTFont
        from fontTools.varLib.instancer import instantiateVariableFont

        f = TTFont(str(FONT_SRC))
        instantiateVariableFont(f, {"wght": weight}, inplace=True)
        f.save(str(out))
        return str(out)
    except Exception:
        return None


def font(weight: int, size: int):
    key = (weight, max(4, size))
    if key not in _fonts:
        path = _ttf(weight)
        _fonts[key] = ImageFont.truetype(path, key[1]) if path else ImageFont.load_default()
    return _fonts[key]


def measure(draw: ImageDraw.ImageDraw, text: str, fnt, tracking: float = 2.0) -> float:
    return (sum(draw.textlength(ch, font=fnt) for ch in text)
            + tracking * max(0, len(text) - 1))


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, fnt, fill, tracking: float = 2.0,
            center: bool = False) -> float:
    widths = [draw.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + tracking * max(0, len(text) - 1)
    x, y = xy
    if center:
        x -= total / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += w + tracking
    return total


# ─────────────────────────────────────────────────────────────────────────────
# Render context — resolution-independent scene drawing
# ─────────────────────────────────────────────────────────────────────────────


class Ctx:
    """Holds the working buffers and draws glow primitives at 1/GS scale."""

    GS = 3  # glow buffer operates at 1/3 res → soft pro-bloom, fast

    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.u = h / 630.0                        # all layout units derive from this
        self.cx, self.cy = w / 2.0, h * (300 / 630)
        self.unit = h / 630 * 104.0               # → px scale for 3D projection
        self.main = Image.new("RGB", (w, h), INK)
        self.glow_img = Image.new("RGB", (max(4, w // self.GS), max(4, h // self.GS)), (0, 0, 0))
        self.g = ImageDraw.Draw(self.glow_img)
        self.hot_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.hot = ImageDraw.Draw(self.hot_img)

    # scaled glow primitives --------------------------------------------------
    def g_line(self, pts, fill, width=1, joint=None):
        s = [(x / self.GS, y / self.GS) for x, y in pts]
        self.g.line(s, fill=fill, width=max(1, int(width / self.GS)), joint=joint)

    def g_ellipse(self, x0, y0, x1, y1, fill):
        gs = self.GS
        self.g.ellipse([x0 / gs, y0 / gs, x1 / gs, y1 / gs], fill=fill)

    def g_point(self, x, y, fill):
        self.g.point((x / self.GS, y / self.GS), fill=fill)

    # 3D projection ------------------------------------------------------------
    def project(self, x, y, z, scale=1.0, f=6.0):
        k = f / (f - z)
        return (self.cx + x * k * self.unit * scale, self.cy + y * k * self.unit * scale, k)

    # compositing ---------------------------------------------------------------
    def composite(self) -> Image.Image:
        glow_big = self.glow_img.filter(ImageFilter.GaussianBlur(2.0 * self.u)).resize(
            (self.w, self.h), Image.BICUBIC)
        halo = glow_big.filter(ImageFilter.GaussianBlur(5.0 * self.u))
        img = ImageChops.add(self.main, halo)
        img = ImageChops.add(img, glow_big.point(lambda v: int(v * 0.78)))
        img = Image.alpha_composite(img.convert("RGBA"), self.hot_img)
        return img


# ─────────────────────────────────────────────────────────────────────────────
# Static stage dressing — starfield
# ─────────────────────────────────────────────────────────────────────────────

import random

STAR_R = 660.0
_stars = []
_r = random.Random(1337)
for _ in range(150):
    wrap = _r.choice((1, 1, 1, 2))
    _stars.append(
        dict(ang=_r.uniform(0, TAU), r0=_r.uniform(60, STAR_R),
             drift=wrap * STAR_R / LOOP_T, k=_r.randint(3, 6),
             phase=_r.uniform(0, TAU), mag=_r.uniform(0.25, 1.0))
    )


def draw_stars(c: Ctx, t: float):
    for s in _stars:
        r = (s["r0"] + s["drift"] * t) % STAR_R
        if r < 74:
            continue
        fade = clamp((r - 74) / 120) * clamp(1 - (r - STAR_R + 90) / 90)
        tw = 0.55 + 0.45 * math.sin(TAU * s["k"] * t / LOOP_T + s["phase"])
        b = s["mag"] * fade * tw * 1.25
        if b <= 0.02:
            continue
        x = c.cx + math.cos(s["ang"]) * r * (c.w / 1200.0)  # star spread tracks aspect
        y = c.cy + math.sin(s["ang"]) * r * 0.62
        c.g_point(x, y, scaled((212, 232, 255), b))


def draw_nebula(c: Ctx, t: float, p1, p2, env: float):
    """Ultra-soft background clouds so the corners never sit at dead black."""
    for k, (ox, oy, rad, col, amp) in enumerate((
            (-0.52, -0.30, 300, p2, 0.075),
            (0.58, 0.22, 340, p1, 0.060),
            (0.10, -0.62, 260, p2, 0.050),
            (-0.30, 0.55, 320, p1, 0.055))):
        breathe = 0.85 + 0.30 * math.sin(TAU * (k + 2) * t / LOOP_T + k)
        r_ = rad * c.u
        x = c.cx + ox * c.w * 0.5
        y = c.cy + oy * c.h * 0.5
        c.g_ellipse(x - r_, y - r_, x + r_, y + r_,
                    scaled(col, amp * breathe * (1 + 0.4 * env)))

# ─────────────────────────────────────────────────────────────────────────────
# Tunnel — chamfered neon squares flying toward the camera
# ─────────────────────────────────────────────────────────────────────────────

RING_COUNT = 9
_meta_rng = random.Random(4242)
_ring_meta = []
for i in range(RING_COUNT):
    arms = _meta_rng.sample(range(4), k=_meta_rng.choice((2, 2, 3)))
    _ring_meta.append(
        dict(arms=arms, span=_meta_rng.uniform(0.16, 0.30), off=_meta_rng.uniform(0, TAU),
             spin=_meta_rng.choice((-2, -1, 1, 2)), beat_phase=(i % 4) * 0.25)
    )


def _chamfered_square(cx, cy, radius, theta, chamfer=0.16):
    corners = []
    for k in range(4):
        a = theta + math.pi / 4 + k * math.pi / 2
        corners.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
    pts = []
    for k in range(4):
        p, q = corners[k], corners[(k + 1) % 4]
        pts.append((p[0] + (q[0] - p[0]) * chamfer, p[1] + (q[1] - p[1]) * chamfer))
        pts.append((p[0] + (q[0] - p[0]) * (1 - chamfer), p[1] + (q[1] - p[1]) * (1 - chamfer)))
    return pts


def draw_tunnel(c: Ctx, t: float, p1, p2, env: float):
    u = c.u
    for i in range(RING_COUNT):
        m = _ring_meta[i]
        d = ((i / RING_COUNT) + 3.0 * t / LOOP_T) % 1.0  # depth 0 far → 1 near
        radius = (30.0 + 800.0 * d ** 2.2) * u
        theta = m["spin"] * TAU * t / LOOP_T * 0.5 + i * 0.12 + m["off"]
        lvl = 0.62 + 0.55 * math.exp(-3.4 * (((t * BEAT_HZ) + m["beat_phase"]) % 1.0))
        b = d ** 1.1 * lvl * (0.58 + 0.32 * env)
        if b <= 0.03:
            continue
        pts = _chamfered_square(c.cx, c.cy, radius, theta)
        wline = max(u, (1 + 4 * d) * u)
        col = scaled(p2 if i % 2 else p1, b)
        c.g_line(pts + [pts[0]], col, wline + 5 * u, "curve")
        if d > 0.4:
            c.hot.line(pts + [pts[0]], fill=scaled(mix(p1, WHITE, 0.55), b * 0.8),
                       width=max(1, int(u)), joint="curve")
        # neon "light bar" segments riding select edges
        for arm in m["arms"]:
            a0 = theta + math.pi / 4 + arm * math.pi / 2
            am = a0 + math.pi / 2
            bx, by = c.cx + radius * math.cos(a0), c.cy + radius * math.sin(a0)
            ex, ey = c.cx + radius * math.cos(am), c.cy + radius * math.sin(am)
            u0, u1 = 0.5 - m["span"], 0.5 + m["span"]
            seg = [(bx + (ex - bx) * u0, by + (ey - by) * u0),
                   (bx + (ex - bx) * u1, by + (ey - by) * u1)]
            c.g_line(seg, scaled(p1, min(b * 1.9, 1.0)), wline + 6 * u)
            if d > 0.4:
                c.hot.line(seg, fill=scaled(WHITE, min(b * 1.35, 1.0)), width=max(1, int(u)))


# ─────────────────────────────────────────────────────────────────────────────
# Quantum portal — tilted, counter-rotating ring stack
# ─────────────────────────────────────────────────────────────────────────────

PORTAL = (
    dict(R=1.22, tilt=1.12, spin=2, which=0),
    dict(R=1.52, tilt=-0.94, spin=-3, which=1),
    dict(R=1.84, tilt=1.38, spin=1, which=0),
)


def draw_portal(c: Ctx, t: float, p1, p2, highs: float):
    u = c.u
    for j, ring in enumerate(PORTAL):
        ang = ring["spin"] * TAU * t / LOOP_T + j * 0.9
        rx = ring["tilt"] + 0.16 * math.sin(TAU * 2 * t / LOOP_T + j)
        yaw = 0.35 * math.sin(TAU * t / LOOP_T + j)
        base = (p1, p2)[ring["which"]]
        level = 0.82 + 0.5 * highs

        def pt(a):
            x, y, z = ring["R"] * math.cos(a), 0.0, ring["R"] * math.sin(a)
            x, y, z = rotate(x, y, z, rx, yaw)
            px, py, _ = c.project(x, y, z, scale=1.16)
            return px, py

        pts = [pt(k / 128 * TAU + ang) for k in range(129)]
        c.g_line(pts, scaled(base, 0.50 * level), 20 * u, "curve")
        c.g_line(pts, scaled(base, 1.05 * level), 6 * u, "curve")
        c.hot.line(pts, fill=scaled(mix(base, WHITE, 0.62), 0.62 * level),
                   width=max(1, int(u)))
        for u0 in (ang * 1.7, ang * 1.7 + 2.62):  # orbiting dash accents
            seg = [pt(u0 + k / 9 * 0.42) for k in range(10)]
            c.g_line(seg, scaled(WHITE, 1.0 * level), 9 * u)
            c.hot.line(seg, fill=scaled(WHITE, level), width=max(1, int(u)))


# ─────────────────────────────────────────────────────────────────────────────
# Neural synapses — radial filament bursts fired per beat
# ─────────────────────────────────────────────────────────────────────────────

BURSTS = [(b * BEAT_DUR, 30 if b == DROP_BEAT else (16 if b % 2 == 0 else 10))
          for b in range(BEATS)]


def draw_filaments(c: Ctx, t: float, p1, p2):
    u = c.u
    for ts, k in BURSTS:
        tau = (t - ts) % LOOP_T
        if tau >= BEAT_DUR:
            continue
        frac = tau / BEAT_DUR
        rng = random.Random(int(ts * 1000))
        r0 = 88 * u  # launch just outside the core silhouette, never across it
        for i in range(k):
            ang = TAU * i / k + rng.uniform(-0.13, 0.13)
            speed = rng.uniform(150, 500) * u
            r = speed * (1 - (1 - frac) ** 2.4)
            bright = (1 - frac) ** 1.6
            col = p1 if i % 3 else mix(p1, WHITE, 0.65)
            x0 = c.cx + math.cos(ang) * r0
            y0 = c.cy + math.sin(ang) * r0
            x1 = c.cx + math.cos(ang) * (r0 + r)
            y1 = c.cy + math.sin(ang) * (r0 + r)
            c.g_line([(x0, y0), (x1, y1)], scaled(col, min(bright * 1.5, 1.0)), 6 * u)
            if bright > 0.5:
                tip = [(x1 - math.cos(ang) * 30 * u, y1 - math.sin(ang) * 30 * u), (x1, y1)]
                c.hot.line(tip, fill=scaled(WHITE, bright), width=max(1, int(u)))


# ─────────────────────────────────────────────────────────────────────────────
# Core — corona bloom + wireframe icosahedron with translucent body
# ─────────────────────────────────────────────────────────────────────────────


def draw_core(c: Ctx, t: float, p1, p2, env: float, flash: float):
    u = c.u
    for rr, k in ((150, 0.075), (106, 0.12), (72, 0.21), (46, 0.36), (26, 0.62)):
        amp = k * (0.55 + 0.5 * env + 1.1 * flash)
        r_ = rr * u * (1 + 0.28 * flash)
        c.g_ellipse(c.cx - r_, c.cy - r_, c.cx + r_, c.cy + r_,
                    scaled(mix(p2, p1, 0.35), min(amp, 1.15)))
    if flash > 0.02:
        fr = 165 * u * flash
        c.g_ellipse(c.cx - fr, c.cy - fr, c.cx + fr, c.cy + fr,
                    scaled(WHITE, min(0.36 * flash, 0.5)))

    scale = 0.92 * (1 + 0.055 * env + 0.22 * flash)
    ry = TAU * 2 * t / LOOP_T
    rx = 0.42 + 0.20 * math.sin(TAU * 3 * t / LOOP_T)
    proj, zbuf = [], []
    for x, y, z in ICO_V:
        xr, yr, zr = rotate(x * scale, y * scale, z * scale, rx, ry)
        px, py, _ = c.project(xr, yr, zr)
        proj.append((px, py))
        zbuf.append(zr)

    # translucent faces, back-to-front — gives the wireframe a solid glass body
    skin = Image.new("RGBA", (c.w, c.h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(skin)
    for f in sorted(ICO_F, key=lambda f: sum(zbuf[i] for i in f)):
        zm = sum(zbuf[i] for i in f) / 3
        alpha = int(clamp(30 + zm * 30, 10, 78))
        sd.polygon([proj[i] for i in f], fill=(10, 14, 22, alpha))
    c.hot_img.alpha_composite(skin)

    for i, j in ICO_E:
        zm = 0.72 + 0.5 * clamp(zbuf[i] + 1.62) / 3.24
        seg = [proj[i], proj[j]]
        c.g_line(seg, scaled(p1, 0.6 * zm * (0.72 + 0.4 * env)), 7 * u)
        c.hot.line(seg, fill=scaled(WHITE, 0.72 * zm), width=max(1, int(round(u))))
    for i, (px, py) in enumerate(proj):
        a = 0.5 + 0.5 * clamp(zbuf[i] + 1.62) / 3.24
        r_ = (1.7 + 1.2 * env) * u
        c.hot.ellipse([px - r_, py - r_, px + r_, py + r_],
                      fill=scaled(mix(p2, WHITE, 0.7), a))


# ─────────────────────────────────────────────────────────────────────────────
# HUD chrome
# ─────────────────────────────────────────────────────────────────────────────


def chip(c: Ctx, d, x0, y0, x1, y1, p1, radius=10):
    u = c.u
    r_ = radius * u
    d.rounded_rectangle([x0, y0, x1, y1], radius=r_, fill=CHIP_BG)
    d.rounded_rectangle([x0, y0, x1, y1], radius=r_,
                        outline=scaled(p1, 0.32) + (70,), width=max(1, int(round(u))))
    d.rectangle([x0 + 6 * u, y0, x0 + 26 * u, y0 + 3 * u],
                fill=scaled(p1, 0.9) + (235,))


def F(c: Ctx, weight: int, px: float):
    return font(weight, int(round(px * c.u)))


def hud_geometry(c: Ctx):
    u = c.u
    return u


def draw_brand(c: Ctx, d, t, p1, env):
    u = hud_geometry(c)
    x0, y0, x1, y1 = 28 * u, 26 * u, 352 * u, 92 * u
    chip(c, d, x0, y0, x1, y1, p1)
    s = 16 * u
    d.rectangle([46 * u, (45) * u, 46 * u + s, 45 * u + s],
                fill=scaled(p1, 0.35 + 0.65 * env))
    tracked(d, (78 * u, 37 * u), "YASLOGIST // SOUNDVIS", F(c, 700, 21), WHITE, 3.0 * u)
    tracked(d, (78 * u, 66 * u), "AUDIO-REACTIVE VJ ENGINE", F(c, 400, 10.5), DIM, 2.4 * u)


def draw_status(c: Ctx, d, t, p1, p2):
    u = hud_geometry(c)
    w_ = c.w
    x0, y0, x1, y1 = w_ - 294 * u, 26 * u, w_ - 28 * u, 92 * u
    chip(c, d, x0, y0, x1, y1, p1)
    right = x1 - 18 * u
    beat = int(t * BEAT_HZ) % BEATS
    p = (t * BEAT_HZ) % 1.0
    blink = 0.45 + 0.55 * math.exp(-3.0 * p)
    tracked(d, (x0 + 18 * u, 40 * u), "TEMPO", F(c, 400, 9.5), DIM, 2.0 * u)
    f_t = F(c, 700, 17)
    wdt = measure(d, "132 BPM", f_t, 2.0 * u)
    tracked(d, (right - wdt, 38 * u), "132 BPM", f_t, WHITE, 2.0 * u)
    tracked(d, (x0 + 18 * u, 64 * u), "● LIVE", F(c, 700, 10.5),
            scaled(p2, blink), 1.8 * u)
    s = f"PH {beat:02d}/11"
    f_s = F(c, 400, 10.5)
    w2 = measure(d, s, f_s, 1.6 * u)
    tracked(d, (right - w2, 66 * u), s, f_s, mix(p1, WHITE, 0.3), 1.6 * u)


def draw_title(c: Ctx, d, t, p1, p2, env):
    u = hud_geometry(c)
    cx, by = c.cx, 452 * u
    f_t = F(c, 700, 32)
    tw = measure(d, "YASLOGIST SOUNDVIS", f_t, 8.0 * u)
    d.rounded_rectangle([cx - tw / 2 - 26 * u, by - 16 * u, cx + tw / 2 + 26 * u,
                         by + 58 * u], radius=14 * u, fill=(4, 6, 10, 88))
    tracked(d, (cx, by - 6 * u), "YASLOGIST SOUNDVIS", f_t, WHITE, 8.0 * u,
            center=True)
    tracked(d, (cx, by + 32 * u), "RAYMARCHED SDF TUNNEL · 160K PARTICLES · ZERO NETWORK",
            F(c, 400, 10), DIM, 2.4 * u, center=True)
    lw = (64 + 116 * env) * u
    d.line([cx - lw / 2, by + 56 * u, cx + lw / 2, by + 56 * u],
           fill=scaled(p1, 0.85), width=max(1, int(round(2 * u))))


def draw_spectrum(c: Ctx, d, t, p1, env, drop):
    u = hud_geometry(c)
    x0, y0, x1, y1 = 28 * u, 520 * u, 368 * u, 604 * u
    chip(c, d, x0, y0, x1, y1, p1, 12)
    n = 21
    bw = (x1 - x0 - 40 * u) / n
    for i in range(n):
        shelf = 0.30 + 0.70 * math.exp(-i / 5.6)
        live = 0.5 + 0.5 * math.sin(TAU * (5 + i % 3) * t / LOOP_T + i * 1.61)
        v = (0.35 * shelf + 0.65 * live * shelf) * (0.42 + 0.62 * env) \
            + 0.30 * drop * (1 - i / n)
        v = clamp(v, 0.04, 1.0)
        h_ = v * (y1 - y0 - 34 * u)
        bx = x0 + 20 * u + i * bw
        top = y1 - 14 * u - h_
        col = mix(p1, WHITE, 0.55 * v)
        d.rectangle([bx, top, bx + bw * 0.56, y1 - 14 * u], fill=col)
        d.rectangle([bx, top - 2 * u, bx + bw * 0.56, top], fill=scaled(WHITE, v))


def draw_scope(c: Ctx, d, t, p1, env):
    u = hud_geometry(c)
    x0, y0, x1, y1 = 384 * u, 520 * u, 596 * u, 604 * u
    chip(c, d, x0, y0, x1, y1, p1, 12)
    mid = (y0 + y1) / 2
    for gy in np.arange(y0 + 10 * u, y1 - 9 * u, 12 * u):
        d.line([x0 + 12 * u, gy, x1 - 12 * u, gy], fill=(70, 90, 110, 38), width=1)
    amp = (y1 - y0) / 2 - 14 * u
    gain = 0.36 + 0.74 * env
    pts = []
    for i in range(85):
        uu = i / 84
        y = (0.62 * math.sin(TAU * (3 * uu + 11 * t / LOOP_T))
             + 0.28 * math.sin(TAU * (7 * uu - 17 * t / LOOP_T))
             + 0.10 * math.sin(TAU * (13 * uu + 5 * t / LOOP_T)))
        pts.append((x0 + 14 * u + uu * (x1 - x0 - 28 * u), mid + y * amp * gain))
    d.line(pts, fill=mix(p1, WHITE, 0.25), width=max(1, int(round(2 * u))))
    pts2 = [(px, mid - (py - mid) * 0.28) for px, py in pts]
    d.line(pts2, fill=scaled(p1, 0.30), width=1)


def draw_meters(c: Ctx, d, t, p1, p2):
    u = hud_geometry(c)
    x0, y0, x1, y1 = c.w - 228 * u, 520 * u, c.w - 28 * u, 604 * u
    chip(c, d, x0, y0, x1, y1, p1, 12)
    beat = (t * BEAT_HZ) % BEATS
    sub = math.exp(-2.1 * (beat % 1.0))
    mid_v = snare_env(t)
    high = 0.5 + 0.5 * math.sin(TAU * 7 * t / LOOP_T + math.sin(TAU * 3 * t / LOOP_T))
    for i, (name, v, col) in enumerate((("SUB", sub, p1), ("MID", mid_v, p2),
                                        ("HI", high, p1))):
        bx = x0 + 26 * u + i * 56 * u
        h_ = clamp(v, 0.03, 1.0) * (y1 - y0 - 40 * u)
        d.rectangle([bx, y1 - 22 * u - h_, bx + 14 * u, y1 - 22 * u],
                    fill=scaled(col, 0.9))
        d.rectangle([bx, y1 - 22 * u - h_ - 2 * u, bx + 14 * u, y1 - 22 * u - h_],
                    fill=scaled(WHITE, clamp(v)))
        tracked(d, (bx - 3 * u, y1 - 16 * u), name, F(c, 400, 8.5), DIM, 1.0 * u)


# ─────────────────────────────────────────────────────────────────────────────
# Grade — vignette, scanlines, faint film noise, chroma split
# ─────────────────────────────────────────────────────────────────────────────

_grades: dict[tuple[int, int], tuple[np.ndarray, np.ndarray, np.ndarray]] = {}


def grade_assets(w: int, h: int):
    key = (w, h)
    if key not in _grades:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        rad = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
        vig = (1.0 - 0.34 * np.clip(rad, 0, 1.35) ** 2.2).astype(np.float32)
        scan = np.where((yy % 2) == 0, 0.93, 1.0).astype(np.float32)
        noise = np.random.default_rng(7).normal(0, 1, (h, w)).astype(np.float32)
        _grades[key] = (vig, scan, noise)
    return _grades[key]


def grade(img: Image.Image, flash: float, t: float, chroma: float = 1.0) -> np.ndarray:
    w, h = img.size
    vig, scan, noise = grade_assets(w, h)
    arr = np.asarray(img, dtype=np.float32) * 1.10
    arr *= (vig * scan)[..., None]
    arr += noise[..., None] * (2.1 * (h / 630))
    arr += np.array((2.0, 4.0, 8.0), dtype=np.float32) * (1.0 - arr / 255.0) * (14.0 / 255.0)
    if flash > 0.01:
        arr += flash * 18.0
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    dx = int(round((6 * flash + 3 * snare_env(t)) * chroma))
    if dx > 0:
        dx = min(dx, 10)
        arr[..., 0] = np.roll(arr[..., 0], dx, axis=1)
        arr[..., 2] = np.roll(arr[..., 2], -dx, axis=1)
    return arr


# ─────────────────────────────────────────────────────────────────────────────
# Frame assembly
# ─────────────────────────────────────────────────────────────────────────────


def render_frame(w: int, h: int, t: float, chroma: float = 1.0) -> Image.Image:
    m = 0.5 - 0.5 * math.cos(TAU * t / LOOP_T)      # palette journey, loop-closed
    p1 = mix(LASER_CYAN[0], ULTRAVIOLET[0], m)
    p2 = mix(LASER_CYAN[1], ULTRAVIOLET[1], m)
    env = beat_env(t)
    flash = drop_flash(t)
    highs = clamp(0.45 + 0.45 * math.sin(TAU * 9 * t / LOOP_T) + 0.35 * snare_env(t))

    c = Ctx(w, h)
    draw_nebula(c, t, p1, p2, env)
    draw_stars(c, t)
    draw_tunnel(c, t, p1, p2, env)
    draw_filaments(c, t, p1, p2)
    draw_portal(c, t, p1, p2, highs)
    draw_core(c, t, p1, p2, env, flash)
    img = c.composite()

    d = ImageDraw.Draw(img, "RGBA")  # alpha-blend the HUD glass panels
    draw_brand(c, d, t, p1, env)
    draw_status(c, d, t, p1, p2)
    draw_title(c, d, t, p1, p2, env)
    draw_spectrum(c, d, t, p1, env, flash)
    draw_scope(c, d, t, p1, env)
    draw_meters(c, d, t, p1, p2)

    return Image.fromarray(grade(img.convert("RGB"), flash, t, chroma), "RGB")


# ─────────────────────────────────────────────────────────────────────────────
# Drivers
# ─────────────────────────────────────────────────────────────────────────────


def build_palette(frames_idx: list[int], w: int, h: int, colors: int = 128,
                  fps: int = FPS) -> Image.Image:
    """Median-cut palette from a stride of downsampled frames (stable colors)."""
    tiles = []
    for i in frames_idx:
        t = i / fps
        fr = render_frame(w, h, t).resize((240, 126), Image.BILINEAR)
        tiles.append(np.asarray(fr))
    strip = Image.fromarray(np.concatenate(tiles, axis=1), "RGB")
    return strip.quantize(colors=min(colors, 256), method=Image.MEDIANCUT)


def save_optimized_gif(frames_rgb: list[Image.Image], palette: Image.Image,
                       out: Path, duration_ms: int, tol: int = 8,
                       keyframes: set[int] | None = None) -> None:
    """Inter-frame GIF delta encoder (exact, no re-quantisation).

    All frames share one global palette; palette index 0 is reserved as
    transparent. Frame 0 (and every index in `keyframes`) is stored opaque.
    Every other frame stores only the pixels whose RGB moved more than `tol`
    since the previous frame — unchanged pixels stay transparent and composite
    over the accumulated canvas (`disposal=1`, "keep canvas"). Keyframes reset
    the accumulation chain so sub-threshold transitions can never ghost.
    Unlike `convert -layers Optimize`, changed regions keep full palette
    precision: no speckle, no posterisation on flash frames.
    """
    n_colors = int(np.max(np.asarray(palette))) + 1  # entries actually used
    base = palette.getpalette()[: n_colors * 3]
    accessor = [0, 0, 0] + base[: (min(n_colors, 255) - 1) * 3]
    accessor += [0] * (768 - len(accessor))

    q_frames: list[np.ndarray] = []
    prev_rgb: np.ndarray | None = None
    for i, rgb in enumerate(frames_rgb):
        q = np.asarray(rgb.quantize(palette=palette, dither=Image.NONE),
                       dtype=np.uint16) + 1  # shift: 0 stays free for transparency
        cur = np.asarray(rgb, dtype=np.int16)
        if prev_rgb is not None and not (keyframes and i in keyframes):
            moved = np.abs(cur - prev_rgb).max(axis=2) > tol
            q = np.where(moved, q, np.uint16(0))
        q_frames.append(q.astype(np.uint8))
        prev_rgb = cur

    pil_frames = []
    for a in q_frames:
        im = Image.fromarray(a, "P")
        im.putpalette(accessor)
        pil_frames.append(im)
    pil_frames[0].save(out, save_all=True, append_images=pil_frames[1:],
                       duration=duration_ms, loop=0, disposal=1,
                       transparency=0, optimize=True)


def gifsicle_postpass(path: Path, lossy: int = 45) -> None:
    """Optional extra squeeze when a real gifsicle binary is on PATH."""
    gifsicle = shutil.which("gifsicle")
    if not gifsicle:
        return
    tmp = path.with_suffix(".squeezed.gif")
    try:
        subprocess.run([gifsicle, "-O3", f"--lossy={lossy}", str(path), "-o", str(tmp)],
                       check=True, timeout=900, capture_output=True)
        if tmp.exists() and 0 < tmp.stat().st_size < path.stat().st_size:
            tmp.replace(path)
    except Exception:
        tmp.unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=None,
                    help="GIF frame count (default: fps × loop seconds — keep the "
                         "default to preserve the perfect beat loop)")
    ap.add_argument("--fps", type=int, default=20,
                    help="GIF frame rate (fps × 5 s loop ⇒ 100 frames at 20)")
    ap.add_argument("--width", type=int, default=1200)
    ap.add_argument("--height", type=int, default=630)
    ap.add_argument("--gif-width", type=int, default=1000,
                    help="GIF pass width (height keeps the 1.905:1 OG ratio); "
                         "the PNG poster always renders at --width × --height")
    ap.add_argument("--tol", type=int, default=20,
                    help="inter-frame delta threshold 0-255 (higher = smaller file)")
    ap.add_argument("--chroma", type=float, default=0.0,
                    help="crystalline-glitch RGB split strength in the GIF pass; "
                         "0 keeps the loop clean under delta encoding — the "
                         "static poster keeps the signature split")
    ap.add_argument("--lossy", type=int, default=45,
                    help="optional gifsicle --lossy level (only when gifsicle is on PATH)")
    ap.add_argument("--colors", type=int, default=96, help="GIF palette size (≤255)")
    ap.add_argument("--out-gif", default=str(PUBLIC / "og-animated.gif"))
    ap.add_argument("--out-png", default=str(PUBLIC / "og-image.png"))
    ap.add_argument("--probe-only", action="store_true",
                    help="render a handful of probe frames + the poster, skip the GIF")
    args = ap.parse_args()

    w, h = args.width, args.height
    PUBLIC.mkdir(exist_ok=True)

    # ── static poster: drop-peak frame, supersampled 2× ──────────────────────
    t0 = time.time()
    poster = render_frame(w * 2, h * 2, DROP_T, chroma=0.5).resize((w, h), Image.LANCZOS)
    poster.save(args.out_png, optimize=True)
    print(f"poster  {args.out_png}  {Path(args.out_png).stat().st_size / 1e6:.2f} MB "
          f"({time.time() - t0:.1f}s)")

    if args.probe_only:
        for i in (0, 30, 60):
            render_frame(w, h, i / FPS).save(f"/tmp/og-probe-{i:03d}.png")
        print("probes  /tmp/og-probe-000.png /tmp/og-probe-030.png /tmp/og-probe-060.png")
        return

    # ── animated GIF ─────────────────────────────────────────────────────────
    fps = args.fps
    gw, gh = args.gif_width, round(args.gif_width * h / w)
    n = args.frames or int(round(fps * LOOP_T))
    if not math.isclose(n / fps, LOOP_T, abs_tol=0.021):
        print(f"warning: frames/fps={n / fps:.3f}s breaks the perfect loop "
              f"(want {LOOP_T:.3f}s)", file=sys.stderr)
    palette = build_palette(sorted(set(np.linspace(0, n - 1, 12, dtype=int).tolist())),
                            gw, gh, colors=min(args.colors, 255), fps=fps)

    frames_rgb = []
    t0 = time.time()
    for i in range(n):
        frames_rgb.append(render_frame(gw, gh, i / fps, chroma=args.chroma))
        if (i + 1) % 25 == 0:
            dt = time.time() - t0
            print(f"  frame {i + 1:>3}/{n}  ({dt:.0f}s, {dt / (i + 1) * (n - i - 1):.0f}s left)")
    out_gif = Path(args.out_gif)
    keyframes = {i for i in range(n) if drop_flash(i / fps) > 0.2}
    save_optimized_gif(frames_rgb, palette, out_gif,
                       duration_ms=round(1000 / fps), tol=args.tol,
                       keyframes=keyframes)
    gifsicle_postpass(out_gif, lossy=args.lossy)
    print(f"gif     {out_gif}  {out_gif.stat().st_size / 1e6:.2f} MB "
          f"({n} frames, {len(keyframes)} keyframes)")


if __name__ == "__main__":
    main()
