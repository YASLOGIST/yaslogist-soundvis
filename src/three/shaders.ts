/**
 * ============================================================================
 *  SHADER LIBRARY — Industrial / Peak-Time Techno Visualizer
 * ============================================================================
 *  All shaders are audio-uniform driven. Every uniform is written from a single
 *  `useFrame` pass, so the GPU never waits on React.
 * ============================================================================
 */

/** Ashima / Ian McEwan 3D simplex noise (public domain). */
export const SIMPLEX_3D = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm3(vec3 p){
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++){
    s += a * snoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return s;
}
`;

/* ==========================================================================
 * 1. RAYMARCHED FRACTAL TUNNEL (fullscreen NDC quad)
 * ========================================================================== */

export const TUNNEL_VERT = /* glsl */ `
varying vec2 vNdc;
void main(){
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}
`;

export const TUNNEL_FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uSub;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;
uniform float uLevel;
uniform vec3  uColA;
uniform vec3  uColB;
uniform vec3  uColC;
uniform float uSteps;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3  uCamPos;
uniform mat3  uCamMat;
uniform float uDetail;
uniform float uGlitch;
uniform float uWarp;

varying vec2 vNdc;

const float MAX_DIST = 62.0;
const int   MAX_STEPS = 104;

mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float sdBox(vec3 p, vec3 b, float r){
  vec3 q = abs(p) - b;
  return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

/**
 * Signed distance field of an infinite brutalist tunnel.
 * The field is measured from *inside* the open volume, so every term is
 * positive along the camera ray.
 */
float mapScene(vec3 p, out float mat){
  float z = p.z + uTime * (2.2 + uSub * 9.0 + uBeat * 4.0);

  // ── bending spine (mids fold the tunnel around the drop) ────────────────
  float warp = 0.30 + uWarp * 0.95;
  vec3 q = p;
  q.xy += vec2(
    sin(p.z * 0.105 + uTime * 0.37),
    cos(p.z * 0.083 - uTime * 0.29)
  ) * warp;

  // ── breathing radius (kick) ────────────────────────────────────────────
  float r = 3.45
          + 0.40 * sin(z * 0.17)
          + 0.22 * sin(z * 0.53 + 1.7)
          + uSub * 1.05
          + uBass * 0.45;
  float radial = length(q.xy) - r;
  float dWall  = -radial;                    // inside distance to the shell

  mat = 0.0;

  // ── radial girders : 14 I-beams wrapped around the circumference ────────
  float ang = atan(q.y, q.x);
  float sectors = 14.0;
  float tau = 6.28318530718;
  float sec = floor((ang / tau + 0.5) * sectors);
  float aF  = (sec + 0.5) / sectors * tau - 3.14159265359;
  vec2 dir  = vec2(cos(aF), sin(aF));
  float tan_ = dot(q.xy, vec2(-dir.y, dir.x));
  float radialL = dot(q.xy, dir) - r;
  float zg = mod(z, 3.4) - 1.7;
  float dGirder = sdBox(vec3(radialL + 0.34, tan_, zg), vec3(0.30, 0.10, 0.10), 0.035);
  // vertical conduit hugging each girder
  float dPipe = sdBox(vec3(radialL + 0.06, tan_, zg), vec3(0.06, 0.045, 1.55), 0.03);

  // ── floor deck + plating ────────────────────────────────────────────────
  float deckY = -r * 0.74;
  float dDeck = q.y - deckY;
  float plate = max(dDeck, -sdBox(vec3(mod(q.x, 2.2) - 1.1, mod(z, 2.2) - 1.1, 0.0),
                                  vec3(0.92, 0.92, 0.6), 0.06));
  dDeck = min(dDeck, plate);

  // ── far-end monolith (rotating fractal slab) ────────────────────────────
  vec3 m = q;
  m.xy = rot2(z * 0.22 + uTime * 0.25) * m.xy;
  m.xz = rot2(z * 0.13 - uTime * 0.17) * m.xz;
  vec3 mp = vec3(m.xy, mod(m.z + 24.0, 24.0) - 12.0);
  float mono = sdBox(mp, vec3(1.05 + uBass * 0.55, 1.05 + uBass * 0.55, 0.35), 0.12);
  mono = max(mono, -(sdBox(mp, vec3(0.62, 0.62, 1.4), 0.05)));

  float d = dWall;
  mat = 0.0;
  if (dGirder < d) { d = dGirder; mat = 1.0; }
  if (dPipe   < d) { d = dPipe;   mat = 2.0; }
  if (dDeck   < d) { d = dDeck;   mat = 3.0; }
  if (mono    < d) { d = mono;    mat = 4.0; }
  return d * 0.74;   // relax for the repeating (non-lipschitz) terms
}

vec3 calcNormal(vec3 p, float mat){
  vec2 e = vec2(0.0022, 0.0);
  float m;
  float d1 = mapScene(p + e.xyy, m);
  float d2 = mapScene(p - e.xyy, m);
  float d3 = mapScene(p + e.yxy, m);
  float d4 = mapScene(p - e.yxy, m);
  float d5 = mapScene(p + e.yyx, m);
  float d6 = mapScene(p - e.yyx, m);
  return normalize(vec3(d1 - d2, d3 - d4, d5 - d6));
}

float hash(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 shadeScene(vec3 p, vec3 rd, float mat, float t){
  vec3 n = calcNormal(p, mat);
  vec3 v = -rd;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.2);

  float z = p.z + uTime * (2.2 + uSub * 9.0 + uBeat * 4.0);
  float ang = atan(p.y, p.x);

  // base brushed-steel albedo
  vec3 alb = vec3(0.030, 0.032, 0.036);
  float grain = hash(floor(p.xy * 42.0) + floor(z * 3.0));
  alb *= 0.75 + grain * 0.55;

  if (mat > 0.5 && mat < 1.5) alb = vec3(0.045, 0.047, 0.052);           // girder
  if (mat > 1.5 && mat < 2.5) alb = uColA * 0.16;                        // conduit
  if (mat > 2.5 && mat < 3.5) alb = vec3(0.022, 0.023, 0.026);           // deck
  if (mat > 3.5)              alb = vec3(0.014, 0.015, 0.018);           // monolith

  // ── lights ─────────────────────────────────────────────────────────────
  vec3 l1 = normalize(vec3(0.45, 0.85, 0.35));
  vec3 l2 = normalize(vec3(-0.7, -0.45, -0.55));
  float diff  = max(dot(n, l1), 0.0);
  float diff2 = max(dot(n, l2), 0.0);
  vec3 h1 = normalize(l1 + v);
  vec3 h2 = normalize(l2 + v);
  float spec  = pow(max(dot(n, h1), 0.0), 90.0);
  float spec2 = pow(max(dot(n, h2), 0.0), 34.0);

  vec3 col = alb * (0.30 + diff * 0.55) + alb * diff2 * 0.20;
  col += uColC * spec * (0.55 + uHigh * 1.9);
  col += uColB * spec2 * 0.30;
  col += uColA * fres * (0.55 + uMid * 1.6 + uBeat * 0.9);

  // ── emissive racing stripes along the shell ────────────────────────────
  float stripe = pow(0.5 + 0.5 * sin(z * 1.35 - uTime * 5.4), 34.0);
  float ringBand = smoothstep(0.86, 1.0, sin(ang * 7.0 + z * 0.35));
  col += uColA * stripe * (0.55 + uSub * 2.6 + uBeat * 2.2) * (1.2 - mat * 0.18);
  col += uColC * ringBand * 0.06 * (0.4 + uHigh * 2.2);

  // deck grid glow
  if (mat > 2.5 && mat < 3.5) {
    vec2 g = abs(fract(vec2(p.x, z) * 0.45) - 0.5);
    float line = smoothstep(0.47, 0.5, max(g.x, g.y));
    col += uColB * line * (0.5 + uMid * 2.4) * 0.9;
    // reflection sheen toward the tunnel centre
    col += uColA * pow(1.0 - ndv, 5.0) * 0.25 * (0.4 + uLevel);
  }

  // monolith pulsing core
  if (mat > 3.5) {
    float vein = smoothstep(0.35, 0.0, abs(fract(p.y * 0.9 + z * 0.15) - 0.5));
    col += uColA * vein * (0.35 + uMid * 3.0);
    col += uColC * fres * (1.2 + uBeat * 3.0);
  }

  // panel seams
  float seam = smoothstep(0.965, 1.0, abs(sin(ang * 14.0)));
  col *= 0.86 + 0.14 * seam;

  return col;
}

void main(){
  vec2 ndc = vNdc;

  // transient digital tear
  if (uGlitch > 0.001) {
    float band = floor(ndc.y * 26.0 + uTime * 12.0);
    float shift = (hash(vec2(band, floor(uTime * 24.0))) - 0.5) * uGlitch * 0.22;
    ndc.x += shift;
  }

  vec3 rd = normalize(uCamMat * vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0));
  vec3 ro = uCamPos;

  float t = 0.04;
  float d = 0.0;
  float mat = 0.0;
  float glow = 0.0;
  float hit = 0.0;
  vec3 p = ro;

  for (int i = 0; i < MAX_STEPS; i++){
    if (float(i) >= uSteps || t > MAX_DIST) break;
    p = ro + rd * t;
    d = mapScene(p, mat);
    glow += 0.0072 / (0.045 + d * d * 1.9);
    if (d < 0.0022 * t + 0.0012) { hit = 1.0; break; }
    t += d;
  }

  vec3 col;
  float fog = exp(-t * 0.043);

  if (hit > 0.5) {
    col = shadeScene(p, rd, mat, t) * fog;
  } else {
    col = vec3(0.0);
    // faint horizon haze at the end of the tunnel
    col += uColB * 0.035 * pow(max(0.0, -rd.z), 3.0);
  }

  // accumulated proximity glow → volumetric halo around the geometry
  col += (uColA * 0.55 + uColB * 0.45) * glow * (0.055 + uLevel * 0.16 + uBeat * 0.10);

  // kick flash from the centre of the tunnel
  float core = exp(-length(ndc) * 2.6);
  col += mix(uColA, uColC, 0.35) * core * (uSub * 0.35 + uBeat * 0.55);

  // treble sparkle noise
  col += uColC * pow(hash(ndc * 512.0 + uTime), 42.0) * uHigh * 0.9;

  // filmic-ish curve + deep black floor
  col = max(col, vec3(0.0));
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);

  gl_FragColor = vec4(col, 1.0);
  // NOTE: no colorspace_fragment include on purpose. postprocessing owns the
  // output encoding, and three's linearToOutputTexel call is an identity for the
  // composer's linear render target. Dropping it removes a fragile dependency.
}
`;

/* ==========================================================================
 * 2. MASSIVE POINT CLOUD (100k+) — 3D simplex displacement
 * ========================================================================== */

export const PARTICLE_VERT = /* glsl */ `
precision highp float;

attribute vec3  aRand;    // 0..1 per component
attribute float aSeed;

uniform float uTime;
uniform float uSub;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;
uniform float uSize;
uniform float uSpan;
uniform float uMorph;
uniform vec3  uColA;
uniform vec3  uColB;
uniform vec3  uColC;

varying vec3  vCol;
varying float vFade;
varying float vHot;

${SIMPLEX_3D}

mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main(){
  vec3 pos = position;

  // ── forward flight, wrapping around the camera (kick-driven velocity) ───
  // The camera looks down -Z, so the wrapped depth is negated.
  float span = uSpan;
  float speed = 3.0 + uSub * 26.0 + uBeat * 10.0;
  float zi = -mod(pos.z + span * 0.08 - uTime * speed, span) + span * 0.08;

  // differential rotation → vortex (mids control angular velocity)
  float radius = length(pos.xy);
  float sw = uTime * (0.10 + uMid * 0.55) * (1.0 + 9.0 / (radius + 2.0));
  vec2 rot = rot2(sw + aSeed * 0.8) * pos.xy;
  pos = vec3(rot, zi);

  // ── simplex-noise morph field (mids) ────────────────────────────────────
  vec3 np = pos * 0.14 + vec3(0.0, 0.0, uTime * 0.16);
  float n = snoise(np);
  float n2 = snoise(np * 2.7 + 11.3);
  vec3 dir = normalize(vec3(pos.xy, 0.0) + 0.0001);
  pos += dir * n * (0.55 + uMid * 7.5) * uMorph;
  pos += vec3(n2, snoise(np * 1.9 + 31.7), snoise(np * 2.3 - 17.3))
       * (0.25 + uHigh * 3.4);

  // ── kick shockwave: radial shell kick ───────────────────────────────────
  float wave = sin(radius * 0.55 - uTime * 9.0);
  pos += dir * max(0.0, wave) * uBeat * 2.4;

  // treble micro-jitter
  pos += (aRand - 0.5) * uHigh * 1.9;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float depth = -mv.z;

  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(
    uSize * (0.35 + aRand.z * 0.9) * (1.0 + uHigh * 2.2 + uBeat * 1.1)
    * (60.0 / max(1.0, depth)),
    0.6, 18.0
  );

  // ── colour ─────────────────────────────────────────────────────────────
  float mixv = clamp(0.5 + 0.5 * n, 0.0, 1.0);
  vec3 c = mix(uColA, uColB, mixv);
  vHot = pow(clamp(aRand.x * uHigh * 3.4 + n2 * 0.5 + 0.15, 0.0, 1.0), 2.0);
  c = mix(c, uColC, vHot);
  vCol = c;

  vFade = smoothstep(span * 0.9, span * 0.15, depth)
        * smoothstep(0.2, 3.2, depth)
        * (0.35 + aRand.y * 0.65);
}
`;

export const PARTICLE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uHigh;
varying vec3  vCol;
varying float vFade;
varying float vHot;

void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  float soft = exp(-r2 * 13.0);
  float core = exp(-r2 * 46.0);
  vec3 col = vCol * (soft * 1.15 + core * 1.9 * (0.6 + vHot));
  col += vec3(1.0) * core * vHot * uHigh * 0.7;
  float a = soft * vFade;
  if (a < 0.004) discard;
  // AdditiveBlending already multiplies by alpha — do not pre-multiply twice.
  gl_FragColor = vec4(col, a);
}
`;

/* ==========================================================================
 * 3. CORE — noise-displaced SDF-style sphere with procedural metal shading
 * ========================================================================== */

export const CORE_VERT = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uSub;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;
uniform float uAmp;

varying vec3 vNormal;
varying vec3 vWorld;
varying float vNoise;

${SIMPLEX_3D}

vec3 displace(vec3 p){
  float t = uTime * 0.32;
  float n = fbm3(p * (0.85 + uMid * 0.9) + vec3(0.0, t, -t * 0.6));
  float ribs = sin(p.y * 9.0 + uTime * 2.4) * 0.06;
  float amp = uAmp * (0.16 + uMid * 0.62 + uBass * 0.32);
  vec3 dir = normalize(p);
  return p + dir * (n * amp + ribs * (0.4 + uBeat));
}

void main(){
  vec3 dp = displace(position);
  vec3 nrm = normalize(position);

  vec3 ta = normalize(cross(nrm, vec3(0.0, 1.0, 0.017)));
  vec3 tb = normalize(cross(nrm, ta));
  float e = 0.06;
  vec3 p1 = displace(normalize(position + ta * e) * length(position));
  vec3 p2 = displace(normalize(position + tb * e) * length(position));
  vec3 n = normalize(cross(p1 - dp, p2 - dp));
  if (dot(n, nrm) < 0.0) n = -n;

  vNoise = n.x * 0.5 + 0.5;
  vec4 wp = modelMatrix * vec4(dp, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const CORE_FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uSub;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;
uniform vec3  uCamPos;
uniform vec3  uColA;
uniform vec3  uColB;
uniform vec3  uColC;
uniform float uWire;

varying vec3 vNormal;
varying vec3 vWorld;
varying float vNoise;

void main(){
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCamPos - vWorld);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.6);

  vec3 l1 = normalize(vec3(0.55, 0.9, 0.4));
  vec3 l2 = normalize(vec3(-0.8, -0.35, -0.7));
  float diff  = max(dot(n, l1), 0.0);
  float diff2 = max(dot(n, l2), 0.0);
  float spec  = pow(max(dot(n, normalize(l1 + v)), 0.0), 120.0);
  float spec2 = pow(max(dot(n, normalize(l2 + v)), 0.0), 26.0);

  vec3 alb = mix(vec3(0.020, 0.022, 0.026), vec3(0.055, 0.058, 0.065), vNoise);

  vec3 col = alb * (0.35 + diff * 0.6) + alb * diff2 * 0.25;
  col += uColC * spec * (0.7 + uHigh * 2.4);
  col += uColB * spec2 * 0.35;
  col += uColA * fres * (0.85 + uMid * 2.2 + uBeat * 1.4);

  // acid veins following the noise field
  float vein = smoothstep(0.62, 0.78, abs(vNoise - 0.5) * 2.0);
  col += mix(uColA, uColB, 0.5) * vein * (0.25 + uMid * 2.4);

  // machined scan bands
  float band = 0.86 + 0.14 * sin(vWorld.y * 34.0 - uTime * 6.0);
  col *= band;

  if (uWire > 0.5) {
    col = mix(uColA, uColC, fres) * (0.55 + uHigh * 2.6 + uBeat * 1.6);
  }

  col = max(col, vec3(0.0));
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ==========================================================================
 * 4. STROBE RINGS — instanced, additive, depth-faded
 * ========================================================================== */

export const RING_VERT = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uSub;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;
uniform float uSpan;
uniform float uSpeed;

varying float vFade;
varying float vHot;
varying vec2  vUv;

attribute float aPhase;

void main(){
  vUv = uv;
  vec3 pos = position;

  float phase = fract(uTime * uSpeed * (0.06 + uSub * 0.16) + aPhase);
  // stays inside the raymarched shell (tunnel radius ≈ 3.45)
  float scale = 0.30 + phase * 0.60 + uSub * 0.10 + uBeat * 0.06;
  pos.xy *= scale;
  pos.z = -phase * uSpan;

  vHot = pow(1.0 - abs(phase - 0.5) * 2.0, 3.0) + uBeat * 0.6;
  vFade = (1.0 - phase) * smoothstep(0.0, 0.08, phase);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vFade *= smoothstep(uSpan, uSpan * 0.15, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const RING_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uColA;
uniform vec3  uColC;
uniform float uMid;
uniform float uHigh;
varying float vFade;
varying float vHot;
varying vec2  vUv;

uniform float uTime;
uniform float uSpin;

void main(){
  // soft tube cross-section
  float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
  // rotating dash pattern — classic strobe gate
  float dash = step(0.5, fract(vUv.x * 28.0 + uTime * uSpin));
  float a = edge * vFade * (0.35 + vHot * 0.9) * (0.30 + 0.70 * dash);
  if (a < 0.004) discard;
  vec3 col = mix(uColA, uColC, clamp(vHot * 0.8, 0.0, 1.0)) * (0.7 + uHigh * 2.2 + uMid);
  gl_FragColor = vec4(col * 1.7, a);
}
`;

/* ==========================================================================
 * 5. LASER FAN — instanced beams
 * ========================================================================== */

export const LASER_VERT = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uSub;
uniform float uMid;
uniform float uBeat;
uniform float uLength;
uniform float uFan;

varying float vFade;
varying float vTip;

attribute float aPhase;

void main(){
  vec3 pos = position;

  // per-beam strobe phase
  float ph = fract(aPhase + uTime * (0.35 + uMid * 1.4));
  float on = step(0.52 + uBeat * 0.28, sin(aPhase * 37.0 + uTime * (2.0 + uMid * 9.0)) * 0.5 + 0.5);
  float len = uLength * (0.35 + ph * 0.9) * (0.6 + uSub * 0.9 + uBeat * 0.8);
  // the camera looks down -Z, so beams are projected forward (negative Z)
  pos.z *= -len;

  vTip = clamp(-pos.z / max(0.001, len), 0.0, 1.0);
  vFade = on * (0.25 + ph * 0.75) * (0.35 + uSub * 0.9 + uBeat);

  #ifdef USE_INSTANCING
    vec4 local = instanceMatrix * vec4(pos, 1.0);
  #else
    vec4 local = vec4(pos, 1.0);
  #endif

  vec4 mv = modelViewMatrix * local;
  vFade *= smoothstep(70.0, 8.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const LASER_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uColA;
uniform vec3  uColC;
varying float vFade;
varying float vTip;

void main(){
  float a = vFade * (1.0 - vTip * 0.85);
  if (a < 0.004) discard;
  vec3 col = mix(uColA, uColC, vTip * 0.7) * 2.2;
  gl_FragColor = vec4(col, a);
}
`;

/* ==========================================================================
 * 6. SPECTRUM TOWERS — instanced FFT metering ring
 * ========================================================================== */

export const TOWER_VERT = /* glsl */ `
precision highp float;

attribute float aLevel;
attribute float aSeed;

uniform float uTime;
uniform float uSub;
uniform float uMid;
uniform float uBeat;
uniform float uBase;

varying float vH;
varying float vLevel;
varying float vY;

void main(){
  vec3 pos = position;

  float h = 0.10 + aLevel * (0.9 + uMid * 2.4 + uSub * 1.6 + uBeat * 1.1);
  pos.y *= h;
  pos.y += h * 0.5 + uBase;
  pos.xz *= 1.0 + aSeed * 0.0;

  vH = clamp(aLevel * 1.5, 0.0, 1.0);
  vLevel = aLevel;
  vY = clamp(pos.y / max(0.001, 3.4), 0.0, 1.0);

  #ifdef USE_INSTANCING
    vec4 local = instanceMatrix * vec4(pos, 1.0);
  #else
    vec4 local = vec4(pos, 1.0);
  #endif

  vec4 mv = modelViewMatrix * local;
  vH *= smoothstep(46.0, 4.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const TOWER_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uColA;
uniform vec3  uColB;
uniform vec3  uColC;
uniform float uHigh;
uniform float uTime;

varying float vH;
varying float vLevel;
varying float vY;

void main(){
  if (vLevel < 0.004) discard;
  // hot tip → cool base, with a bright cap that blooms on the highs
  vec3 col = mix(uColB, uColA, vH);
  float cap = smoothstep(0.86, 1.0, vY);
  col = mix(col, uColC, cap * (0.45 + uHigh * 0.9));
  col *= 0.85 + vLevel * 2.4;

  float a = (0.22 + vLevel * 0.95) * (0.55 + vH * 0.65);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * 1.35, a);
}
`;

/* ==========================================================================
 * 7. CORE GLOW — halo, anamorphic flare, kick shockwave
 * ========================================================================== */

export const GLOW_VERT = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GLOW_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uColA;
uniform vec3  uColC;
uniform float uTime;
uniform float uSub;
uniform float uHigh;
uniform float uBeat;
uniform float uLevel;

varying vec2 vUv;

void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);

  // volumetric halo
  float halo = exp(-r * r * 3.1);
  // hot nucleus
  float nucleus = exp(-r * r * 26.0);
  // anamorphic horizontal streak
  float streak = exp(-abs(p.y) * 26.0) * exp(-abs(p.x) * 3.6);
  // vertical pulse blade
  float blade = exp(-abs(p.x) * 34.0) * exp(-abs(p.y) * 8.5);

  float amt = 0.30 + uSub * 0.95 + uBeat * 0.85 + uLevel * 0.30;

  vec3 col = uColA * (halo * 0.85 + streak * 1.6 * amt)
           + uColC * (nucleus * 1.9 + blade * 0.9 * amt);

  float a = halo * 0.42 + nucleus + (streak + blade * 0.5) * amt * 0.75;
  a *= 0.28 + uLevel * 0.72;
  a *= smoothstep(1.0, 0.72, r);          // hard square-edge kill
  if (a < 0.004) discard;

  gl_FragColor = vec4(col * (0.85 + uHigh * 1.7), a);
}
`;

export const SHOCK_VERT = /* glsl */ `
precision highp float;

uniform float uAge;
uniform float uSub;

varying float vFade;

void main(){
  vec3 pos = position;
  float s = 0.55 + uAge * 7.5 * (0.6 + uSub * 0.8);
  pos.xy *= s;
  pos.z *= 1.0 + uAge * 0.4;

  vFade = exp(-uAge * 2.9) * smoothstep(0.0, 0.015, uAge) * (0.4 + uSub * 0.9);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const SHOCK_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uColA;
uniform vec3  uColC;
uniform float uHigh;

varying float vFade;

void main(){
  float a = vFade * 0.85;
  if (a < 0.004) discard;
  vec3 col = mix(uColC, uColA, 0.45) * (1.6 + uHigh * 2.4);
  gl_FragColor = vec4(col, a);
}
`;
