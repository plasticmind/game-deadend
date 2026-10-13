// Electric walls, pod gates, and locked-door force fields: small custom shaders plus the
// ribbon geometry they draw on. Every animation here is smooth value noise drifting at a
// few hertz, so the crackle shimmers without ever strobing.

import * as THREE from 'three';

const NOISE = /* glsl */ `
  float hash11(float n) { return fract(sin(n) * 43758.5453123); }
  float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f) * 2.0 - 1.0;
  }
`;

const RIBBON_VERT = /* glsl */ `
  attribute vec2 aRib;     // x: distance along the beam in world units, y: -1..1 across
  attribute float aSeed;
  varying vec2 vRib;
  varying float vSeed;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vRib = aRib;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

// The lethal beam: a white-hot core, a soft halo in the sector color, and three
// filaments that wander along it.
const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vRib;
  varying float vSeed;
  ${NOISE}
  void main() {
    float x = vRib.x;
    float y = vRib.y;
    float t = uTime;
    float ay = abs(y);
    float core = exp(-ay * 12.0);
    float halo = exp(-ay * 4.6) * 0.14;
    float fil = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float s = vSeed * 13.7 + fi * 7.31;
      // A slow wander, a zigzag, and a fine jitter: lightning, drifting smoothly.
      float off = vnoise(x * (1.8 + fi * 0.7) + s + t * (1.1 + fi * 0.35)) * 0.42
                + vnoise(x * 8.0 - t * 2.0 + s * 2.0) * 0.2
                + vnoise(x * 22.0 + t * 2.6 + s) * 0.07;
      float w = 0.06 + 0.015 * fi;
      float life = 0.5 + 0.5 * vnoise(x * 1.1 - t * 0.8 + s * 3.0);
      fil += (1.0 - smoothstep(0.0, w, abs(y - off))) * life * (0.95 - fi * 0.2);
    }
    float shimmer = 0.9 + 0.1 * vnoise(x * 0.7 + t * 1.6 + vSeed * 5.0);
    vec3 col = uColor * (core * 1.3 + halo + fil * 1.6) * shimmer * uIntensity;
    col += vec3(1.0) * exp(-ay * 30.0) * 0.5 * uIntensity;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Pod gate bar: yellow and black stripes drifting along the bar, bright when on.
const POD_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOn;
  varying vec2 vRib;
  varying float vSeed;
  void main() {
    float ay = abs(vRib.y);
    float band = 1.0 - smoothstep(0.32, 0.42, ay);
    if (band <= 0.001) discard;
    float s = step(0.5, fract(vRib.x * 2.6 + vRib.y * 0.25 - uTime * 0.35));
    vec3 yellow = vec3(1.0, 0.72, 0.05) * mix(0.45, 1.6, uOn);
    vec3 dark = vec3(0.02, 0.018, 0.015);
    vec3 col = mix(dark, yellow, s);
    float edge = smoothstep(0.26, 0.4, ay);
    col = mix(col, yellow * 0.7, edge * 0.5);
    gl_FragColor = vec4(col, band * mix(0.4, 0.97, uOn));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Force field across a locked door: vertical energy curtain in the lock color.
const FIELD_VERT = /* glsl */ `
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const FIELD_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float x = vUv.x * 6.0;
    float y = vUv.y;
    float t = uTime;
    float streak = 0.5 + 0.5 * vnoise(x * 3.0 + vnoise(y * 2.0 - t * 0.6) * 1.5 + t * 0.3);
    float scan = 0.5 + 0.5 * sin(y * 38.0 - t * 3.0);
    float hex = abs(fract(x * 1.5 + step(0.5, fract(y * 5.0)) * 0.5) - 0.5);
    float grid = smoothstep(0.42, 0.5, hex) + smoothstep(0.44, 0.5, abs(fract(y * 5.0) - 0.5));
    float edgeY = smoothstep(0.0, 0.12, y) * (1.0 - smoothstep(0.75, 1.0, y));
    float rim = exp(-y * 18.0) * 1.6 + exp(-(1.0 - y) * 30.0) * 0.6;
    float sides = exp(-vUv.x * 22.0) + exp(-(1.0 - vUv.x) * 22.0);
    float a = (0.22 + streak * 0.3 + scan * 0.12 + grid * 0.28) * edgeY + rim + sides * 0.8;
    gl_FragColor = vec4(uColor * a * uAlpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function beamMaterial(color, intensity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
    },
    vertexShader: RIBBON_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function podMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOn: { value: 1 } },
    vertexShader: RIBBON_VERT,
    fragmentShader: POD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function fieldMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
    vertexShader: FIELD_VERT,
    fragmentShader: FIELD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const _axis = new THREE.Vector3();
const _side = new THREE.Vector3();

// Build camera-facing ribbons for a list of horizontal segments. Each segment is
// { x1, z1, x2, z2, y } in world units. The ribbon rotates about its own axis to face
// `viewDir` (the fixed camera direction), so a beam along X stands up toward the camera
// and a beam along Z lies flat. `width` is the full ribbon width.
export function ribbonGeometry(segments, viewDir, width, extend = 0) {
  const n = segments.length;
  const pos = new Float32Array(n * 12);
  const rib = new Float32Array(n * 8);
  const seed = new Float32Array(n * 4);
  const idx = new Uint32Array(n * 6);
  const h = width / 2;
  for (let i = 0; i < n; i++) {
    const s = segments[i];
    _axis.set(s.x2 - s.x1, 0, s.z2 - s.z1);
    const len = _axis.length();
    _axis.divideScalar(len || 1);
    _side.crossVectors(_axis, viewDir).normalize().multiplyScalar(h);
    const ax = s.x1 - _axis.x * extend;
    const az = s.z1 - _axis.z * extend;
    const bx = s.x2 + _axis.x * extend;
    const bz = s.z2 + _axis.z * extend;
    const y = s.y;
    const p = i * 12;
    pos[p] = ax - _side.x; pos[p + 1] = y - _side.y; pos[p + 2] = az - _side.z;
    pos[p + 3] = ax + _side.x; pos[p + 4] = y + _side.y; pos[p + 5] = az + _side.z;
    pos[p + 6] = bx + _side.x; pos[p + 7] = y + _side.y; pos[p + 8] = bz + _side.z;
    pos[p + 9] = bx - _side.x; pos[p + 10] = y - _side.y; pos[p + 11] = bz - _side.z;
    // Distance along: continuous across neighboring segments of one straight line.
    const alongX = Math.abs(_axis.x) > 0.5;
    const a0 = alongX ? Math.min(ax, bx) : Math.min(az, bz) + 50;
    const a1 = a0 + len + extend * 2;
    const flip = alongX ? ax > bx : az > bz;
    const u0 = flip ? a1 : a0;
    const u1 = flip ? a0 : a1;
    const r = i * 8;
    rib[r] = u0; rib[r + 1] = -1;
    rib[r + 2] = u0; rib[r + 3] = 1;
    rib[r + 4] = u1; rib[r + 5] = 1;
    rib[r + 6] = u1; rib[r + 7] = -1;
    const sd = s.seed ?? (alongX ? s.z1 * 0.37 : s.x1 * 0.53 + 0.2);
    seed[i * 4] = seed[i * 4 + 1] = seed[i * 4 + 2] = seed[i * 4 + 3] = sd;
    const v = i * 4;
    const k = i * 6;
    idx[k] = v; idx[k + 1] = v + 1; idx[k + 2] = v + 2;
    idx[k + 3] = v; idx[k + 4] = v + 2; idx[k + 5] = v + 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRib', new THREE.BufferAttribute(rib, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// Vertical camera-facing ribbons standing on points: crackle running up an emitter post.
// points: [{ x, z, seed }] in world units.
export function postRibbonGeometry(points, viewDir, width, y0, y1) {
  const n = points.length;
  const pos = new Float32Array(n * 12);
  const rib = new Float32Array(n * 8);
  const seed = new Float32Array(n * 4);
  const idx = new Uint32Array(n * 6);
  _axis.set(0, 1, 0);
  _side.crossVectors(_axis, viewDir).normalize().multiplyScalar(width / 2);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const o = i * 12;
    pos[o] = p.x - _side.x; pos[o + 1] = y0; pos[o + 2] = p.z - _side.z;
    pos[o + 3] = p.x + _side.x; pos[o + 4] = y0; pos[o + 5] = p.z + _side.z;
    pos[o + 6] = p.x + _side.x; pos[o + 7] = y1; pos[o + 8] = p.z + _side.z;
    pos[o + 9] = p.x - _side.x; pos[o + 10] = y1; pos[o + 11] = p.z - _side.z;
    const u0 = 200 + p.seed * 7.0;
    const u1 = u0 + (y1 - y0) * 1.6;
    const r = i * 8;
    rib[r] = u0; rib[r + 1] = -1;
    rib[r + 2] = u0; rib[r + 3] = 1;
    rib[r + 4] = u1; rib[r + 5] = 1;
    rib[r + 6] = u1; rib[r + 7] = -1;
    seed[i * 4] = seed[i * 4 + 1] = seed[i * 4 + 2] = seed[i * 4 + 3] = p.seed;
    const v = i * 4;
    const k = i * 6;
    idx[k] = v; idx[k + 1] = v + 1; idx[k + 2] = v + 2;
    idx[k + 3] = v; idx[k + 4] = v + 2; idx[k + 5] = v + 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRib', new THREE.BufferAttribute(rib, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}
