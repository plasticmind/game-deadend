// Everything that moves, drawn from sim state each frame: Shamus, the five robot types
// (and their brass armor), the Shadow, shots, bolts, and the room's item. Meshes are
// built once from primitives and pooled by type; robots are matched to sim foes by id.

import * as THREE from 'three';
import { bake, toX, toZ, yawOf, approach, approachAngle, clamp01, smooth } from './util.js';
import { KEY_COLORS } from '../map.js';

const TAU = Math.PI * 2;
const ICE = new THREE.Color(0.55, 0.8, 1.0);
// The ION-SHIV's glow from cold to overheated.
const SHIV_COOL = new THREE.Color(0.6, 1.4, 3.2);
const SHIV_WARM = new THREE.Color(2.9, 1.25, 0.28);
const SHIV_HOT = new THREE.Color(3.2, 0.38, 0.14);
const ROBOT_SCALE = { droid: 1.75, drone: 1.65, jumper: 1.7, sniffer: 1.65, warden: 1.55 };
// Brass means armor: every brass piece on a robot is one more hit it can take. Armored
// robots are also a little bigger.
const BRASS = '#d9a441';
const BRASS_DARK = '#9c6a24';
const BRASS_GLOW = new THREE.Color(0.2, 0.12, 0.03);
const ARMORED_SCALE = 1.1;
// An opening in a dome's front (+x), for helmets and shells that leave the eyes clear.
const shell = (r, gap, theta = Math.PI / 2) => new THREE.SphereGeometry(r, 20, 10, Math.PI + gap / 2, TAU - gap, 0, theta);

const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const cyl = (rt, rb, h, s = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const sph = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

function glowBasic(r, g, b) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
}

function mesh(geo, mat, { cast = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  return m;
}

// ---------------------------------------------------------------------- shared shaders
const STREAK_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const STREAK_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float u = clamp(vUv.x, 0.0, 1.0);
    float v = min(1.0, abs(vUv.y - 0.5) * 2.0);
    float body = u * sqrt(u) * smoothstep(1.0, 0.9, u) + smoothstep(0.86, 0.97, u) * (1.0 - smoothstep(0.97, 1.0, u));
    float core = exp(-v * v * 10.0);
    float c2 = core * core;
    vec3 c = uColor * core * body * 1.5 + vec3(1.0) * c2 * c2 * core * body * 0.9;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The Shadow is drawn as the hub art draws him: a flat figure on a card that leans back
// toward the camera, so his hat, cloak, and reaching claw read from straight above.
// The sheet (textures.js shadowFigure) holds the silhouette in red and the eyes in blue.
const SHADOW_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSway;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    // The cloak's hem sways; the hat stays put.
    float k = (1.0 - uv.y) * (1.0 - uv.y);
    p.x += sin(uTime * 1.7 + uv.y * 5.0) * 0.07 * k * uSway;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const SHADOW_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uStun;
  uniform float uDissolve;
  uniform float uEyes;
  varying vec2 vUv;
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float body = t.r;
    // Blurred copies of the silhouette from the mip chain: one for the rim, a wider one
    // for the violet backlight.
    float soft = texture2D(uMap, vUv, 1.4).r;
    float wide = texture2D(uMap, vUv, 3.6).r;
    // The backlight fades out before the card's edges, so the card itself never shows.
    float frame = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
    float n = n2(vUv * vec2(9.0, 13.0) + vec2(0.0, -uTime * 0.7));
    float nf = n2(vUv * vec2(24.0, 32.0) + vec2(uTime * 0.5, 0.0));
    // Smoky edges: noise eats into the silhouette near its border, drifting slowly.
    float edgeZone = 1.0 - abs(soft * 2.0 - 1.0);
    float a = smoothstep(0.3, 0.6, body - (n - 0.5) * 0.55 * edgeZone);
    if (uDissolve > 0.0) a *= step(uDissolve, n * 0.65 + nf * 0.25 + vUv.y * 0.1);
    float rim = clamp((body - soft) * 2.6 - 0.3, 0.0, 1.0);
    vec3 base = mix(vec3(0.016, 0.005, 0.03), vec3(0.17, 0.16, 0.24), uStun);
    base += vec3(0.025, 0.0, 0.05) * n;
    vec3 rimC = mix(vec3(0.75, 0.32, 1.7), vec3(1.0, 1.0, 1.5), uStun);
    vec3 col = base + rimC * rim;
    float glow = clamp(wide * 1.3, 0.0, 1.0) * (1.0 - a) * (0.55 + 0.45 * n) * (1.0 - uDissolve) * frame;
    float eye = t.b * uEyes;
    col = mix(col, vec3(3.8, 2.8, 0.45), clamp(eye * 1.5, 0.0, 1.0));
    float alpha = a * 0.97 + glow * 0.5;
    col = mix(vec3(0.42, 0.16, 0.95), col, a / max(alpha, 0.001));
    alpha = max(alpha, clamp(eye, 0.0, 1.0));
    gl_FragColor = vec4(col, alpha * uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
// His long shadow on the floor: the same silhouette, flattened and stretched away from
// the key light.
const CAST_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float s = texture2D(uMap, vUv, 1.5).r;
    float fade = 1.0 - vUv.y * 0.55;
    gl_FragColor = vec4(0.02, 0.0, 0.04, s * fade * 0.62 * uAlpha);
  }
`;
const CAST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const BUBBLE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  void main() {
    float fr = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
    float fres = fr * fr * sqrt(fr);
    float bands = 0.5 + 0.5 * sin(vObj.y * 18.0 - uTime * 2.0);
    vec3 c = uColor * (fres * 1.4 + 0.08 + bands * 0.06);
    gl_FragColor = vec4(c * uAlpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const BUBBLE_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  void main() {
    vObj = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

// ---------------------------------------------------------------------- Shamus
function buildShamus(kit) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, transparent: true });
  const visorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 2.6), transparent: true });
  const shivMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 3.2), transparent: true });
  const COAT = '#c98a3e';
  const body = bake([
    [lathe([[0.25, 0.16], [0.252, 0.19], [0.21, 0.3], [0.17, 0.42], [0.163, 0.5], [0.155, 0.57], [0.128, 0.612], [0.06, 0.64]]), COAT],
    [box(0.02, 0.4, 0.035), '#7a4a22', { x: 0.17, y: 0.39, rz: -0.12 }],
    [cyl(0.172, 0.172, 0.045, 16, true), '#3a2412', { y: 0.43 }],
    [box(0.03, 0.05, 0.06), '#d8b060', { x: 0.172, y: 0.43 }],
    [cyl(0.155, 0.112, 0.08, 14, true), '#b47838', { y: 0.63 }],
    [cyl(0.05, 0.05, 0.08, 10), '#6d7684', { y: 0.67 }],
    [sph(0.105, 16, 12), '#a7b1bf', { y: 0.735 }],
    [box(0.05, 0.05, 0.16), '#3a414c', { x: 0.075, y: 0.735 }],
  ]);
  const hatGeo = bake([
    [cyl(0.26, 0.262, 0.024, 24), '#73492a', { y: 0 }],
    [new THREE.TorusGeometry(0.255, 0.014, 6, 28), '#5a381f', { y: 0.008, rx: Math.PI / 2 }],
    [cyl(0.124, 0.124, 0.038, 16), '#24160c', { y: 0.026 }],
    [cyl(0.1, 0.122, 0.14, 16), '#86592f', { y: 0.08 }],
    [cyl(0.06, 0.1, 0.012, 16), '#6a4528', { y: 0.153 }],
  ]);
  const legGeo = bake([
    [cyl(0.048, 0.042, 0.33, 8), '#2d3342', { y: -0.165 }],
    [box(0.13, 0.05, 0.08), '#1c1612', { x: 0.03, y: -0.335 }],
  ]);
  const armGeo = bake([
    [cyl(0.046, 0.04, 0.27, 8), '#c07d3a', { y: -0.135 }],
    [cyl(0.048, 0.048, 0.04, 8), '#9c6430', { y: -0.25 }],
    [sph(0.042, 8, 6), '#9aa4b2', { y: -0.29 }],
  ]);
  const shivGeo = bake([
    [box(0.05, 0.08, 0.04), '#22262d', { y: -0.31, x: -0.01 }],
    [box(0.05, 0.2, 0.05), '#3d4655', { y: -0.4 }],
    [box(0.07, 0.05, 0.07), '#596476', { y: -0.36 }],
  ]);
  const shivGlowGeo = bake([
    [sph(0.034, 10, 8), '#ffffff', { y: -0.51 }],
    [new THREE.TorusGeometry(0.036, 0.011, 6, 14), '#ffffff', { y: -0.44, rx: Math.PI / 2 }],
  ]);
  const visorGeo = box(0.03, 0.028, 0.15).translate(0.1, 0.742, 0);

  const root = new THREE.Group();
  const scaler = new THREE.Group();
  scaler.scale.setScalar(1.75);
  root.add(scaler);
  const pose = new THREE.Group();
  scaler.add(pose);
  pose.add(mesh(body, mat));
  pose.add(mesh(visorGeo, visorMat, { cast: false }));
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(0, 0.36, -0.075);
  legR.position.set(0, 0.36, 0.075);
  legL.add(mesh(legGeo, mat));
  legR.add(mesh(legGeo, mat));
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(0, 0.578, -0.168);
  armR.position.set(0, 0.578, 0.168);
  armL.add(mesh(armGeo, mat));
  armR.add(mesh(armGeo, mat), mesh(shivGeo, mat), mesh(shivGlowGeo, shivMat, { cast: false }));
  // A halo at the muzzle so the shiv's heat reads from up above, and a marker the
  // renderer reads for where steam and sparks come out.
  const haloMat = new THREE.SpriteMaterial({ map: kit.tex.glow, color: SHIV_COOL.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const halo = new THREE.Sprite(haloMat);
  halo.position.set(0, -0.5, 0);
  halo.scale.setScalar(0.18);
  halo.renderOrder = 6;
  armR.add(halo);
  const tip = new THREE.Object3D();
  tip.position.set(0, -0.53, 0);
  armR.add(tip);
  pose.add(legL, legR, armL, armR);
  const hat = new THREE.Group();
  hat.add(mesh(hatGeo, mat));
  scaler.add(hat);

  const bubbleMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.4, 0.9, 1.4) }, uAlpha: { value: 1 }, uTime: { value: 0 } },
    vertexShader: BUBBLE_VERT,
    fragmentShader: BUBBLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.8, 28, 18), bubbleMat);
  bubble.position.y = 0.62;
  bubble.renderOrder = 6;
  root.add(bubble);

  const blob = new THREE.Mesh(kit.geo.flat, kit.mat.blob);
  blob.scale.set(1.05, 1, 1.05);
  blob.position.y = 0.012;
  root.add(blob);

  // A soft warm pool of light under him so he is easy to find on any floor.
  const poolMat = new THREE.MeshBasicMaterial({ map: kit.tex.glow, color: new THREE.Color(0.42, 0.26, 0.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pool = new THREE.Mesh(kit.geo.flat, poolMat);
  pool.scale.set(1.9, 1, 1.9);
  pool.position.y = 0.013;
  pool.renderOrder = 2;
  root.add(pool);

  const boostMat = new THREE.MeshBasicMaterial({ map: kit.tex.glow, color: new THREE.Color(1.2, 0.8, 0.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const boost = new THREE.Mesh(kit.geo.flat, boostMat);
  boost.scale.set(1.1, 1, 1.1);
  boost.position.y = 0.014;
  boost.renderOrder = 2;
  root.add(boost);

  const mats = [mat, visorMat, shivMat];
  return {
    pool, poolMat, halo, haloMat, tip, shivMat,
    root, pose, legL, legR, armL, armR, hat, bubble, bubbleMat, boost, boostMat, mat, mats,
    yaw: 0, legA: 0, armLA: 0, armRA: 0, aim: 0, dyingT: -1,
    geos: [body, hatGeo, legGeo, armGeo, shivGeo, shivGlowGeo, visorGeo, bubble.geometry],
    dispose() {
      for (const g of this.geos) g.dispose();
      for (const m of [...mats, bubbleMat, boostMat, poolMat, haloMat]) m.dispose();
    },
  };
}

// ---------------------------------------------------------------------- robots
function robotParts() {
  const P = {};
  // Robo-Droid: white dome on four short legs, one red eye.
  P.droid = {
    body: bake([
      [new THREE.SphereGeometry(0.25, 18, 10, 0, TAU, 0, Math.PI / 2), '#eef1f4', { y: 0.29 }],
      [cyl(0.258, 0.232, 0.09, 18), '#6c7480', { y: 0.25 }],
      [new THREE.SphereGeometry(0.232, 16, 6, 0, TAU, Math.PI / 2, Math.PI / 2), '#3a3f48', { y: 0.21, sy: 0.55 }],
      [cyl(0.105, 0.105, 0.07, 16), '#1d2026', { x: 0.205, y: 0.37, rz: Math.PI / 2 }],
      [cyl(0.03, 0.04, 0.07, 8), '#9aa3b0', { y: 0.56 }],
      [new THREE.TorusGeometry(0.2, 0.018, 6, 24), '#d03a30', { y: 0.39, rx: Math.PI / 2 }],
    ]),
    eye: sph(0.08, 12, 8).translate(0.235, 0.37, 0),
    leg: bake([
      [cyl(0.034, 0.028, 0.24, 8), '#8d96a3', { y: -0.12 }],
      [sph(0.048, 8, 6), '#3a3f48', { y: -0.245 }],
    ]),
    // Brass plating: a helmet open at the eye, a band, and shoulder plates.
    armor: bake([
      [shell(0.272, 1.4), BRASS, { y: 0.29 }],
      [new THREE.TorusGeometry(0.262, 0.032, 6, 28), BRASS_DARK, { y: 0.25, rx: Math.PI / 2 }],
      [box(0.13, 0.09, 0.05), BRASS, { y: 0.31, z: 0.275 }],
      [box(0.13, 0.09, 0.05), BRASS, { y: 0.31, z: -0.275 }],
    ]),
  };
  // Whirling Drone: spinning disc-top with blades, cyan glow.
  P.drone = {
    body: bake([
      [cyl(0.11, 0.16, 0.16, 14), '#2f343c', { y: 0 }],
      [new THREE.SphereGeometry(0.12, 12, 8, 0, TAU, 0, Math.PI / 2), '#c9d2dc', { y: 0.08 }],
      [cyl(0.3, 0.3, 0.045, 24), '#8892a0', { y: -0.02 }],
      [cyl(0.1, 0.06, 0.06, 12), '#22262c', { y: -0.09 }],
    ]),
    rim: new THREE.TorusGeometry(0.3, 0.022, 6, 32).rotateX(Math.PI / 2).translate(0, -0.02, 0),
    rotor: bake([0, 1, 2].map((i) => [box(0.46, 0.018, 0.09), '#eef3f8', { x: Math.cos((i * TAU) / 3) * 0.25, z: -Math.sin((i * TAU) / 3) * 0.25, ry: (i * TAU) / 3, y: 0.15 }])),
  };
  // Snap-Jumper: squat spring-legged frog bot, green.
  const coil = new THREE.TubeGeometry(
    new (class extends THREE.Curve {
      getPoint(t, out = new THREE.Vector3()) {
        const a = t * TAU * 4;
        return out.set(Math.cos(a) * 0.045, -t * 0.2, Math.sin(a) * 0.045);
      }
    })(),
    48, 0.012, 5, false,
  );
  P.jumper = {
    body: bake([
      [sph(0.24, 18, 12), '#45b04f', { y: 0.0, sx: 1.18, sy: 0.7 }],
      [sph(0.2, 14, 10), '#b3df70', { x: 0.05, y: -0.05, sy: 0.45, sz: 0.85 }],
      [box(0.26, 0.04, 0.2), '#2c7334', { x: -0.06, y: 0.16 }],
      [sph(0.078, 12, 8), '#f2f5e6', { x: 0.13, y: 0.15, z: 0.1 }],
      [sph(0.078, 12, 8), '#f2f5e6', { x: 0.13, y: 0.15, z: -0.1 }],
      [cyl(0.03, 0.03, 0.18, 8), '#2c7334', { x: 0.15, y: -0.1, z: 0.12, rz: 0.3 }],
      [cyl(0.03, 0.03, 0.18, 8), '#2c7334', { x: 0.15, y: -0.1, z: -0.12, rz: 0.3 }],
    ]),
    eyes: bake([
      [sph(0.036, 8, 6), '#ffffff', { x: 0.195, y: 0.16, z: 0.1 }],
      [sph(0.036, 8, 6), '#ffffff', { x: 0.195, y: 0.16, z: -0.1 }],
    ]),
    spring: bake([
      [coil, '#c8d0d8'],
      [box(0.13, 0.03, 0.09), '#2c7334', { x: 0.02, y: -0.215 }],
    ]),
    // Brass plating: a shell over the back, open at the eyes, with a ridge on top.
    armor: bake([
      [shell(0.262, 1.7, 1.25), BRASS, { sx: 1.18, sy: 0.74 }],
      [box(0.3, 0.05, 0.07), BRASS_DARK, { x: -0.08, y: 0.2 }],
    ]),
  };
  // Sniffer: low hound bot with a long sensor snout, violet. Armored front.
  P.sniffer = {
    body: bake([
      [new THREE.CapsuleGeometry(0.125, 0.34, 6, 12), '#9a7fe0', { y: 0.27, rz: Math.PI / 2 }],
      [cyl(0.05, 0.07, 0.36, 10), '#b9b2c8', { x: 0.4, y: 0.25, rz: Math.PI / 2 + 0.08 }],
      [box(0.14, 0.03, 0.05), '#3e3260', { x: 0.12, y: 0.42, z: 0.06, rx: 0.4 }],
      [box(0.14, 0.03, 0.05), '#3e3260', { x: 0.12, y: 0.42, z: -0.06, rx: -0.4 }],
      [cyl(0.012, 0.012, 0.26, 6), '#5b5470', { x: -0.33, y: 0.38, rz: 0.7 }],
    ]),
    armor: bake([
      [new THREE.SphereGeometry(0.16, 14, 10, 0, Math.PI, 0, Math.PI), BRASS, { x: 0.12, y: 0.29, ry: -Math.PI / 2, sx: 1.05, sz: 1.2 }],
      [box(0.05, 0.16, 0.24), BRASS_DARK, { x: 0.27, y: 0.29 }],
    ]),
    tip: bake([
      [sph(0.05, 10, 8), '#ffffff', { x: 0.59, y: 0.235 }],
      [sph(0.025, 8, 6), '#ffffff', { x: -0.42, y: 0.47 }],
    ]),
    leg: bake([
      [cyl(0.03, 0.026, 0.19, 8), '#5b5470', { y: -0.095 }],
      [box(0.07, 0.03, 0.05), '#2b2638', { x: 0.015, y: -0.195 }],
    ]),
  };
  // Warden: turret on a pedestal, orange.
  P.warden = {
    base: bake([
      [cyl(0.36, 0.41, 0.1, 20), '#3a3f48', { y: 0.05 }],
      [cyl(0.2, 0.26, 0.34, 16), '#5a616d', { y: 0.27 }],
      [cyl(0.24, 0.22, 0.06, 16), '#2a2e35', { y: 0.45 }],
    ]),
    ring: new THREE.TorusGeometry(0.24, 0.022, 6, 24).rotateX(Math.PI / 2).translate(0, 0.32, 0),
    head: bake([
      [sph(0.24, 18, 12), '#e37b2a', { sx: 1.12, sy: 0.72 }],
      [cyl(0.12, 0.15, 0.06, 14), '#99491a', { y: 0.16 }],
      [box(0.2, 0.12, 0.34), '#b8601f', { x: -0.06, y: -0.02 }],
      [cyl(0.036, 0.036, 0.36, 10), '#2b2f36', { x: 0.28, z: 0.08, rz: Math.PI / 2 }],
      [cyl(0.036, 0.036, 0.36, 10), '#2b2f36', { x: 0.28, z: -0.08, rz: Math.PI / 2 }],
    ]),
    glow: bake([
      [box(0.03, 0.04, 0.2), '#ffffff', { x: 0.255, y: 0.06 }],
      [sph(0.03, 8, 6), '#ffffff', { x: 0.465, z: 0.08 }],
      [sph(0.03, 8, 6), '#ffffff', { x: 0.465, z: -0.08 }],
    ]),
    // Brass, one piece per extra hit, shaped for the camera up above: a collar around
    // the base (the last to go) and a cap over the head (the first).
    collar: bake([
      [new THREE.TorusGeometry(0.43, 0.055, 8, 32), BRASS, { y: 0.1, rx: Math.PI / 2 }],
      [cyl(0.47, 0.47, 0.03, 32, true), BRASS_DARK, { y: 0.06 }],
    ]),
    cap: bake([
      [new THREE.SphereGeometry(0.258, 20, 10, 0, TAU, 0, 1.25), BRASS, { sx: 1.12, sy: 0.8 }],
      [new THREE.TorusGeometry(0.275, 0.02, 6, 32), BRASS_DARK, { y: 0.065, rx: Math.PI / 2, sx: 1.08 }],
      [sph(0.05, 10, 8), BRASS_DARK, { y: 0.21 }],
    ]),
  };
  return P;
}

function buildRobot(type, P, M, kit) {
  const root = new THREE.Group();
  const sized = new THREE.Group();
  sized.scale.setScalar(ROBOT_SCALE[type]);
  root.add(sized);
  const inner = new THREE.Group();
  sized.add(inner);
  const v = { type, root, sized, inner, id: -1, seen: 0, x: 0, z: 0, vx: 0, vz: 0, yaw: 0, state: '', stateT: 0, spawnT: 0, phase: 0, hitT: 0, hpLast: 0 };
  const p = P[type];
  if (type === 'droid') {
    inner.add(mesh(p.body, M.robot));
    inner.add(mesh(p.eye, M.droidEye, { cast: false }));
    v.plating = mesh(p.armor, M.brass);
    v.plating.visible = false;
    inner.add(v.plating);
    v.legs = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const hip = new THREE.Group();
      hip.position.set(Math.cos(a) * 0.14, 0.24, -Math.sin(a) * 0.14);
      hip.rotation.y = a;
      const leg = new THREE.Group();
      leg.rotation.z = 0.55;
      leg.add(mesh(p.leg, M.robot));
      hip.add(leg);
      inner.add(hip);
      v.legs.push(leg);
    }
  } else if (type === 'drone') {
    const hover = new THREE.Group();
    hover.position.y = 0.42;
    hover.add(mesh(p.body, M.robot));
    hover.add(mesh(p.rim, M.droneGlow, { cast: false }));
    const rotor = new THREE.Group();
    rotor.add(mesh(p.rotor, M.robot));
    hover.add(rotor);
    inner.add(hover);
    v.hover = hover;
    v.rotor = rotor;
    const glow = new THREE.Mesh(kit.geo.flat, M.droneFloor);
    glow.scale.set(1.1, 1, 1.1);
    glow.position.y = 0.013;
    glow.renderOrder = 2;
    root.add(glow);
  } else if (type === 'jumper') {
    const body = new THREE.Group();
    body.position.y = 0.26;
    body.add(mesh(p.body, M.robot));
    body.add(mesh(p.eyes, M.jumperEye, { cast: false }));
    v.plating = mesh(p.armor, M.brass);
    v.plating.visible = false;
    body.add(v.plating);
    inner.add(body);
    v.body = body;
    v.springs = [];
    for (const z of [0.15, -0.15]) {
      const s = new THREE.Group();
      s.position.set(-0.12, 0.24, z);
      s.add(mesh(p.spring, M.robot));
      inner.add(s);
      v.springs.push(s);
    }
  } else if (type === 'sniffer') {
    inner.add(mesh(p.body, M.robot));
    const armor = mesh(p.armor, M.brass);
    inner.add(armor);
    v.armor = armor;
    inner.add(mesh(p.tip, M.snifferTip, { cast: false }));
    v.legs = [];
    for (const [x, z] of [[0.17, 0.1], [0.17, -0.1], [-0.17, 0.1], [-0.17, -0.1]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.2, z);
      leg.add(mesh(p.leg, M.robot));
      inner.add(leg);
      v.legs.push(leg);
    }
  } else if (type === 'warden') {
    inner.add(mesh(p.base, M.robot));
    inner.add(mesh(p.ring, M.wardenGlow, { cast: false }));
    const head = new THREE.Group();
    head.position.y = 0.6;
    const recoil = new THREE.Group();
    recoil.add(mesh(p.head, M.robot));
    recoil.add(mesh(p.glow, M.wardenGlow, { cast: false }));
    // plates[i] stays on while the warden has more than i + 1 hits left.
    const collar = mesh(p.collar, M.brass);
    inner.add(collar);
    const cap = mesh(p.cap, M.brass);
    recoil.add(cap);
    v.plates = [collar, cap];
    head.add(recoil);
    inner.add(head);
    v.head = head;
    v.recoil = recoil;
  }
  const tellAt = { droid: [0.3, 0.37, 0], warden: [0.48, 0.6, 0], jumper: [0.22, 0.42, 0] }[type];
  if (tellAt) {
    const sp = new THREE.Sprite(M.tell[type]);
    sp.position.set(...tellAt);
    sp.visible = false;
    sp.renderOrder = 6;
    (type === 'warden' ? v.recoil : inner).add(sp);
    if (type === 'warden') sp.position.set(0.48, 0, 0);
    v.tellSprite = sp;
  }
  const blob = new THREE.Mesh(kit.geo.flat, kit.mat.blob);
  const bs = (type === 'warden' ? 1.0 : type === 'drone' ? 0.6 : 0.8) * ROBOT_SCALE[type];
  blob.scale.set(bs, 1, bs);
  blob.position.y = 0.011;
  root.add(blob);
  root.visible = false;
  return v;
}

// ---------------------------------------------------------------------- the Shadow
// Card size in room units (the sheet is 2:3). The hem is about as wide as his reach.
const SHADOW_H = 3.3;
const SHADOW_W = 2.2;
const SHADOW_LEAN = 0.44; // radians the card leans back toward the camera
// Eyes on the sheet (pixels of 256 x 384), for the glow sprites.
const EYE_PX = [[122, 118], [150, 118]];
// The key light comes from the north-east, so his shadow falls to the south-west.
const CAST_DIR = Math.atan2(7, -5);
const CAST_LEN = 2.6;

function buildShadow(kit) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: kit.tex.shadow },
      uTime: { value: 0 },
      uAlpha: { value: 1 },
      uStun: { value: 0 },
      uDissolve: { value: 0 },
      uEyes: { value: 1 },
      uSway: { value: 1 },
    },
    vertexShader: SHADOW_VERT,
    fragmentShader: SHADOW_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cardGeo = new THREE.PlaneGeometry(SHADOW_W, SHADOW_H).translate(0, SHADOW_H / 2, 0);
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.x = -SHADOW_LEAN;
  const roll = new THREE.Group();
  const flip = new THREE.Group();
  root.add(tilt);
  tilt.add(roll);
  roll.add(flip);
  const body = new THREE.Mesh(cardGeo, mat);
  body.renderOrder = 7;
  flip.add(body);

  // Eye glows on top of the painted eyes, for bloom and for the Low tier.
  const glowMat = new THREE.SpriteMaterial({ map: kit.tex.glow, color: new THREE.Color(1.8, 1.35, 0.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const glows = [];
  for (const [px, py] of EYE_PX) {
    const g = new THREE.Sprite(glowMat);
    g.position.set((px / 256 - 0.5) * SHADOW_W, (1 - py / 384) * SHADOW_H, 0.02);
    g.scale.setScalar(0.24);
    g.renderOrder = 9;
    flip.add(g);
    glows.push(g);
  }
  // Stun stars circling the hat.
  const starMat = new THREE.SpriteMaterial({ map: kit.tex.glow, color: new THREE.Color(2.0, 1.9, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const stars = [];
  for (let i = 0; i < 4; i++) {
    const st = new THREE.Sprite(starMat);
    st.scale.setScalar(0.2);
    st.renderOrder = 9;
    flip.add(st);
    stars.push(st);
  }
  // A violet pool under him and his long shadow across the floor.
  const blobMat = new THREE.MeshBasicMaterial({ map: kit.tex.soft, color: new THREE.Color(0.12, 0.0, 0.22), transparent: true, opacity: 0.7, depthWrite: false });
  const blob = new THREE.Mesh(kit.geo.flat, blobMat);
  blob.scale.set(1.9, 1, 1.9);
  blob.position.y = 0.012;
  root.add(blob);
  const castMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: kit.tex.shadow }, uAlpha: { value: 1 } },
    vertexShader: CAST_VERT,
    fragmentShader: CAST_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const castGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
  const cast = new THREE.Mesh(castGeo, castMat);
  cast.rotation.y = CAST_DIR;
  cast.renderOrder = 2;
  root.add(cast);
  root.visible = false;
  return {
    root, body, mat, tilt, roll, flip, glows, glowMat, stars, starMat, blobMat, blob, cast, castMat,
    yaw: 0, face: 1, lean: 0, state: '', stateT: 0, gone: 1, fade: 0,
    dispose() {
      cardGeo.dispose();
      castGeo.dispose();
      for (const m of [mat, glowMat, starMat, blobMat, castMat]) m.dispose();
    },
  };
}

// ---------------------------------------------------------------------- items
function buildItems(kit) {
  const items = {};
  const glowFloor = (color) => {
    const m = new THREE.MeshBasicMaterial({ map: kit.tex.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const g = new THREE.Mesh(kit.geo.flat, m);
    g.scale.set(1.6, 1, 1.6);
    g.position.y = 0.012;
    g.renderOrder = 2;
    return [g, m];
  };
  const spriteGlow = (color, s) => {
    const m = new THREE.SpriteMaterial({ map: kit.tex.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sp = new THREE.Sprite(m);
    sp.scale.setScalar(s);
    sp.renderOrder = 6;
    return [sp, m];
  };

  // Key: a chunky glowing key that floats and turns.
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.3, metalness: 0.6 });
    const geo = bake([
      [new THREE.TorusGeometry(0.11, 0.042, 10, 22), '#ffffff', { x: -0.17 }],
      [box(0.32, 0.065, 0.065), '#ffffff', { x: 0.07 }],
      [box(0.055, 0.11, 0.06), '#ffffff', { x: 0.17, y: -0.07 }],
      [box(0.055, 0.08, 0.06), '#ffffff', { x: 0.08, y: -0.055 }],
    ]);
    const root = new THREE.Group();
    const spin = new THREE.Group();
    spin.position.y = 0.55;
    const k = mesh(geo, mat);
    k.rotation.x = -0.5;
    spin.add(k);
    spin.scale.setScalar(1.65);
    root.add(spin);
    const [floor, floorMat] = glowFloor(new THREE.Color(1, 1, 1));
    const [halo, haloMat] = spriteGlow(new THREE.Color(1, 1, 1), 0.6);
    halo.position.y = 0.55;
    root.add(floor, halo);
    items.key = {
      root, spin, mats: [mat, floorMat, haloMat], geos: [geo],
      color(c) {
        mat.color.copy(c);
        mat.emissive.copy(c);
        floorMat.color.copy(c).multiplyScalar(0.6);
        haloMat.color.copy(c).multiplyScalar(0.3);
      },
    };
  }
  // Keyhole: a pedestal with a lock plate in its color, dim once used.
  {
    const frame = new THREE.MeshStandardMaterial({ color: 0x5a616d, roughness: 0.35, metalness: 0.7 });
    const face = new THREE.MeshStandardMaterial({ color: 0x1a1c20, emissiveMap: kit.tex.keyhole, emissive: 0xffffff, emissiveIntensity: 2.6, roughness: 0.4, metalness: 0.4 });
    const ped = bake([
      [cyl(0.3, 0.35, 0.1, 20), '#3a3f48', { y: 0.05 }],
      [cyl(0.13, 0.17, 0.44, 14), '#6a7280', { y: 0.32 }],
      [cyl(0.2, 0.15, 0.06, 14), '#3a3f48', { y: 0.56 }],
    ]);
    const plateGeo = box(0.46, 0.46, 0.08);
    const root = new THREE.Group();
    root.add(mesh(ped, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 })));
    root.scale.setScalar(1.15);
    const plate = new THREE.Mesh(plateGeo, [frame, frame, frame, frame, face, frame]);
    plate.castShadow = true;
    plate.position.y = 0.84;
    plate.rotation.x = -0.45;
    root.add(plate);
    const [floor, floorMat] = glowFloor(new THREE.Color(1, 1, 1));
    floor.scale.set(1.8, 1, 1.8);
    root.add(floor);
    const pedMat = root.children[0].material;
    items.keyhole = {
      root, plate, face, mats: [frame, face, pedMat, floorMat], geos: [ped, plateGeo], base: new THREE.Color(),
      color(c) {
        this.base.copy(c);
        face.emissive.copy(c);
        floorMat.color.copy(c).multiplyScalar(0.6);
      },
    };
  }
  // Mystery: a glowing question mark that pulses.
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffc21a, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.3 });
    const r = 0.13;
    const geo = bake([
      [new THREE.TorusGeometry(r, 0.048, 10, 26, Math.PI * 1.45).rotateZ(-Math.PI / 2), '#ffffff', { y: 0.13 }],
      [cyl(0.048, 0.048, 0.1, 10), '#ffffff', { y: 0.13 - r - 0.04 }],
      [sph(0.058, 12, 8), '#ffffff', { y: 0.13 - r - 0.19 }],
    ]);
    const root = new THREE.Group();
    const spin = new THREE.Group();
    spin.position.y = 0.55;
    const q = mesh(geo, mat);
    q.rotation.x = -0.35;
    spin.add(q);
    root.add(spin);
    const [floor, floorMat] = glowFloor(new THREE.Color(1.0, 0.75, 0.15).multiplyScalar(0.7));
    const [halo, haloMat] = spriteGlow(new THREE.Color(1.0, 0.7, 0.2).multiplyScalar(0.22), 0.6);
    halo.position.y = 0.55;
    spin.scale.setScalar(1.6);
    root.add(floor, halo);
    items.mystery = { root, spin, mat, halo, haloMat, mats: [mat, floorMat, haloMat], geos: [geo], color() {} };
  }
  // Life: a green bubbling canister.
  {
    const glass = new THREE.MeshStandardMaterial({ color: 0xa8ffcc, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0.1, depthWrite: false });
    const liquid = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 2.0, 0.6) });
    const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7 });
    const capsGeo = bake([
      [cyl(0.175, 0.175, 0.07, 18), '#8a929e', { y: 0.035 }],
      [cyl(0.175, 0.175, 0.07, 18), '#8a929e', { y: 0.5 }],
      [cyl(0.07, 0.09, 0.05, 12), '#5b636f', { y: 0.56 }],
    ]);
    const glassGeo = cyl(0.15, 0.15, 0.4, 18, true).translate(0, 0.27, 0);
    const liquidGeo = cyl(0.12, 0.12, 0.32, 14).translate(0, 0.24, 0);
    const bubbleGeo = sph(0.022, 6, 4);
    const root = new THREE.Group();
    const spin = new THREE.Group();
    spin.position.y = 0.12;
    spin.scale.setScalar(1.3);
    spin.add(mesh(capsGeo, metal), mesh(liquidGeo, liquid, { cast: false }));
    const gm = new THREE.Mesh(glassGeo, glass);
    gm.renderOrder = 5;
    spin.add(gm);
    const bubbles = [];
    const bubbleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.4, 1.4) });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(bubbleGeo, bubbleMat);
      b.userData.phase = i / 6;
      b.userData.a = i * 2.4;
      spin.add(b);
      bubbles.push(b);
    }
    root.add(spin);
    const [floor, floorMat] = glowFloor(new THREE.Color(0.2, 1.0, 0.4).multiplyScalar(0.6));
    root.add(floor);
    items.life = { root, spin, bubbles, mats: [glass, liquid, metal, bubbleMat, floorMat], geos: [capsGeo, glassGeo, liquidGeo, bubbleGeo], color() {} };
  }
  for (const it of Object.values(items)) it.root.visible = false;
  return items;
}

// ---------------------------------------------------------------------- the layer
export class Actors {
  constructor(kit, scene) {
    this.kit = kit;
    this.root = new THREE.Group();
    this.root.name = 'actors';
    scene.add(this.root);
    this.time = 0;

    const M = {
      robot: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 }),
      // A little warm glow keeps brass reading as brass on the Low tier, which has no
      // environment map for the metal to reflect.
      brass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.65, emissive: BRASS_GLOW.clone() }),
      droidEye: glowBasic(3.2, 0.25, 0.18),
      droneGlow: glowBasic(0.3, 2.4, 3.0),
      droneFloor: new THREE.MeshBasicMaterial({ map: kit.tex.glow, color: new THREE.Color(0.15, 0.9, 1.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      jumperEye: glowBasic(2.2, 2.8, 0.5),
      snifferTip: glowBasic(1.9, 0.9, 3.2),
      wardenGlow: glowBasic(3.2, 1.2, 0.2),
    };
    const tell = (r, g, b) => new THREE.SpriteMaterial({ map: kit.tex.glow, color: new THREE.Color(r, g, b), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    M.tell = { droid: tell(2.6, 0.3, 0.2), warden: tell(2.6, 1.0, 0.2), jumper: tell(1.4, 2.4, 0.4) };
    this.M = M;
    this.glowBase = {};
    for (const k of ['droidEye', 'droneGlow', 'jumperEye', 'snifferTip', 'wardenGlow']) this.glowBase[k] = M[k].color.clone();
    this.parts = robotParts();
    this.pools = { droid: [], drone: [], jumper: [], sniffer: [], warden: [] };
    this.byId = new Map();
    this.active = [];
    this.frame = 0;

    this.shamus = buildShamus(kit);
    this.root.add(this.shamus.root);
    // World position of the ION-SHIV's muzzle, updated every frame.
    this.shivTip = new THREE.Vector3();
    this.shadow = buildShadow(kit);
    this.root.add(this.shadow.root);
    this.items = buildItems(kit);
    for (const it of Object.values(this.items)) this.root.add(it.root);
    this.itemKey = '';

    // Shots and bolts.
    this.streakGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const streakMat = (r, g, b) => new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(r, g, b) } },
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shotMat = streakMat(0.5, 1.1, 3.4);
    this.boltMat = streakMat(3.4, 0.9, 0.2);
    this.shotHead = new THREE.SpriteMaterial({ map: kit.tex.glow, color: new THREE.Color(0.6, 1.1, 2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.boltHead = new THREE.SpriteMaterial({ map: kit.tex.glow, color: new THREE.Color(2.2, 0.9, 0.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.shots = this.makeStreaks(4, this.shotMat, this.shotHead, 1.3, 0.24, 0.42);
    this.bolts = this.makeStreaks(16, this.boltMat, this.boltHead, 0.8, 0.24, 0.36);

    // Prebuild a few of each robot so the first room never stalls on construction.
    for (const t of Object.keys(this.pools)) for (let i = 0; i < 2; i++) this.pools[t].push(this.newRobot(t));
  }

  makeStreaks(n, mat, headMat, len, width, headScale) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const s = new THREE.Mesh(this.streakGeo, mat);
      s.scale.set(len, 1, width);
      s.position.x = -len / 2;
      s.renderOrder = 6;
      const h = new THREE.Sprite(headMat);
      h.scale.setScalar(headScale);
      h.renderOrder = 6;
      g.add(s, h);
      g.visible = false;
      this.root.add(g);
      list.push({ g, id: -1, seen: 0 });
    }
    return { list, byId: new Map() };
  }

  newRobot(type) {
    const v = buildRobot(type, this.parts, this.M, this.kit);
    this.root.add(v.root);
    return v;
  }

  // Everything visible to the renderer's precompile pass.
  showAll(on) {
    for (const t of Object.keys(this.pools)) for (const v of this.pools[t]) v.root.visible = on;
    this.shadow.root.visible = on;
    for (const it of Object.values(this.items)) it.root.visible = on;
    for (const s of this.shots.list) s.g.visible = on;
    for (const s of this.bolts.list) s.g.visible = on;
    this.shamus.root.visible = on;
    this.shamus.bubble.visible = on;
  }

  // Drop all robots and transient views, for a room change.
  reset() {
    for (let i = 0; i < this.active.length; i++) {
      const v = this.active[i];
      v.root.visible = false;
      v.id = -1;
      this.pools[v.type].push(v);
    }
    this.active.length = 0;
    this.byId.clear();
    for (const s of this.shots.list) { s.g.visible = false; s.id = -1; }
    for (const s of this.bolts.list) { s.g.visible = false; s.id = -1; }
    this.shots.byId.clear();
    this.bolts.byId.clear();
    this.shadow.root.visible = false;
    this.shadow.state = '';
    this.shadow.fade = 0;
  }

  // ------------------------------------------------------------------ per frame
  // o: { dt, time, rm (reduced motion), zoneColor }
  update(game, o) {
    this.frame++;
    this.time = o.time;
    this.updateShamus(game, o);
    this.updateRobots(game, o);
    this.updateShadow(game, o);
    this.updateStreaks(this.shots, game.shots, 0.5, o);
    this.updateStreaks(this.bolts, game.bolts, 0.42, o);
    this.updateItem(game, o);
  }

  // Robots near (x, y) flinch: used for foeHit.
  flinch(x, y) {
    let best = null;
    let bd = 1.2;
    for (const v of this.active) {
      const d = Math.hypot(v.sx - x, v.sy - y);
      if (d < bd) { bd = d; best = v; }
    }
    if (best) best.hitT = 0.18;
  }

  updateShamus(game, o) {
    const S = this.shamus;
    const p = game.player;
    const dt = o.dt;
    const dying = game.mode === 'dying' || (!p.alive && game.mode !== 'gameover');
    const show = game.mode !== 'gameover' && (p.alive || dying);
    S.root.visible = show;
    if (!show) return;
    S.root.position.set(toX(p.x), 0, toZ(p.y));
    // Mouse aiming turns him to the exact angle; otherwise he faces one of eight ways.
    const yaw = p.freeAim ? -Math.atan2(p.aimY, p.aimX) : yawOf(p.face);
    S.yaw = approachAngle(S.yaw, yaw, p.freeAim ? 24 : 16, dt);
    S.root.rotation.y = S.yaw;

    const phase = p.walk * (TAU / 0.8);
    const moving = p.moving && !dying;
    const aiming = (p.aiming || p.freeAim) && !dying;
    S.aim = approach(S.aim, aiming ? 1 : 0, 22, dt);
    const swing = moving ? Math.sin(phase) : 0;
    const legT = moving ? 0.6 * swing : aiming ? 0.18 : 0;
    S.legA = approach(S.legA, legT, moving ? 30 : 12, dt);
    S.legL.rotation.z = S.legA;
    S.legR.rotation.z = -S.legA;
    const armSwing = moving ? 0.45 * swing : 0;
    S.armLA = approach(S.armLA, aiming ? 0.35 : -armSwing, 18, dt);
    S.armRA = approach(S.armRA, armSwing, 18, dt);
    S.armL.rotation.z = S.armLA;
    S.armR.rotation.z = S.armRA * (1 - S.aim) + (Math.PI / 2) * S.aim;
    S.armR.rotation.x = -0.12 * S.aim;
    const bob = moving && !o.rm ? Math.abs(Math.sin(phase)) * 0.035 : 0;
    S.pose.position.y = bob;
    S.pose.rotation.z = moving ? -0.06 : 0;

    // Death: a jolt, a collapse backward, the hat popping off, then a fade.
    let alpha = 1;
    if (dying) {
      const t = p.deadT;
      const k = smooth((t - 0.12) / 0.55);
      S.pose.rotation.z = -1.45 * k;
      S.pose.position.y = -0.04 * k;
      S.pose.position.x = -0.12 * k;
      const h = clamp01((t - 0.05) / 0.65);
      S.hat.position.set(-0.55 * h, 0.8 + Math.sin(h * Math.PI) * 0.45 - 0.78 * h, 0.12 * h);
      S.hat.rotation.set(1.2 * h, 0, -1.4 * h);
      alpha = 1 - smooth((t - 0.95) / 0.6);
      S.mat.emissive.setRGB(0.4, 0.8, 1.6).multiplyScalar(Math.max(0, 1 - t / 0.35));
    } else {
      S.pose.position.x = 0;
      S.hat.position.set(-0.8 * Math.sin(S.pose.rotation.z), 0.8 + bob / 1.75, 0);
      S.hat.rotation.set(0, 0, S.pose.rotation.z);
      S.mat.emissive.setRGB(0, 0, 0);
    }
    // Invulnerable after a respawn: a smooth 2.5 Hz fade, never a hard blink.
    if (!dying && p.invulnT > 0) alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.cos(o.time * TAU * 2.5));
    for (const m of S.mats) m.opacity = alpha;
    S.poolMat.opacity = alpha;
    // Shield bubble.
    const sh = p.shieldT > 0 && !dying;
    S.bubble.visible = sh;
    if (sh) {
      S.bubbleMat.uniforms.uTime.value = o.time;
      S.bubbleMat.uniforms.uAlpha.value = Math.min(1, p.shieldT / 1.0);
    }
    S.boost.visible = !!p.boost && !dying;
    if (S.boost.visible) S.boostMat.opacity = 0.55 + (o.rm ? 0 : 0.15 * Math.sin(o.time * 3));

    // Heat: the glow runs from blue through orange to red. Overheated, it sputters in a
    // slow swell (about 1.2 Hz, steady with reduced motion) until the sim cools it.
    const heat = clamp01(p.heat ?? 0);
    const c = S.shivMat.color;
    if (p.overheatT > 0) {
      c.copy(SHIV_HOT).multiplyScalar(o.rm ? 0.6 : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(o.time * TAU * 1.2)));
    } else if (heat < 0.55) {
      c.copy(SHIV_COOL).lerp(SHIV_WARM, smooth(heat / 0.55));
    } else {
      c.copy(SHIV_WARM).lerp(SHIV_HOT, smooth((heat - 0.55) / 0.45));
    }
    S.haloMat.color.copy(c).multiplyScalar(0.55);
    S.haloMat.opacity = alpha;
    S.halo.scale.setScalar(0.17 + 0.2 * Math.max(heat, p.overheatT > 0 ? 1 : 0));
    S.root.updateMatrixWorld(true);
    S.tip.getWorldPosition(this.shivTip);
  }

  updateRobots(game, o) {
    const frame = this.frame;
    const freeze = game.freezeT > 0 ? Math.min(1, game.freezeT / 0.5) : 0;
    this.applyFreeze(freeze);
    const foes = game.foes;
    for (let i = 0; i < foes.length; i++) {
      const f = foes[i];
      let v = this.byId.get(f.id);
      if (!v || v.type !== f.type) {
        if (v) this.release(v);
        const pool = this.pools[f.type];
        if (!pool) continue;
        v = pool.length ? pool.pop() : this.newRobot(f.type);
        v.id = f.id;
        v.spawnT = 0;
        v.sx = f.x;
        v.sy = f.y;
        v.vx = v.vz = 0;
        v.yaw = yawOf(f.face ?? 0);
        v.state = f.state;
        v.stateT = 0;
        v.hitT = 0;
        v.hpLast = f.hp;
        v.sized.scale.setScalar(ROBOT_SCALE[f.type] * (f.armored ? ARMORED_SCALE : 1));
        this.byId.set(f.id, v);
        this.active.push(v);
      }
      v.seen = frame;
      this.animateRobot(v, f, o, freeze);
    }
    for (let i = this.active.length - 1; i >= 0; i--) if (this.active[i].seen !== frame) this.release(this.active[i]);
  }

  release(v) {
    v.root.visible = false;
    this.byId.delete(v.id);
    v.id = -1;
    this.pools[v.type].push(v);
    const i = this.active.indexOf(v);
    if (i >= 0) {
      this.active[i] = this.active[this.active.length - 1];
      this.active.pop();
    }
  }

  applyFreeze(k) {
    const M = this.M;
    if (k === this.lastFreeze) return;
    this.lastFreeze = k;
    M.robot.color.setRGB(1, 1, 1).lerp(ICE, k);
    M.robot.emissive.setRGB(0.12, 0.3, 0.55).multiplyScalar(k);
    M.brass.color.setRGB(1, 1, 1).lerp(ICE, k);
    M.brass.emissive.copy(BRASS_GLOW).lerp(M.robot.emissive, k);
    for (const key in this.glowBase) M[key].color.copy(this.glowBase[key]).lerp(ICE, k * 0.8);
  }

  animateRobot(v, f, o, freeze) {
    const dt = o.dt;
    const frozen = freeze > 0;
    v.root.visible = true;
    const nx = f.x;
    const ny = f.y;
    const dx = nx - v.sx;
    const dy = ny - v.sy;
    v.sx = nx;
    v.sy = ny;
    if (dt > 0) {
      v.vx = approach(v.vx, dx / dt, 10, dt);
      v.vz = approach(v.vz, dy / dt, 10, dt);
    }
    const speed = Math.hypot(v.vx, v.vz);
    if (f.state !== v.state) {
      v.state = f.state;
      v.stateT = 0;
    } else v.stateT += dt;
    v.spawnT += dt;
    v.hitT = Math.max(0, v.hitT - dt);
    v.root.position.set(toX(nx), 0, toZ(ny));
    v.yaw = approachAngle(v.yaw, yawOf(f.face ?? 0), v.type === 'warden' ? 8 : 12, dt);
    const grow = smooth(v.spawnT / 0.3);
    const flinch = v.hitT > 0 ? 1 + 0.18 * Math.sin((v.hitT / 0.18) * Math.PI) : 1;
    v.inner.scale.setScalar(Math.max(0.001, grow * flinch));
    const st = typeof f.state === 'string' ? f.state : '';
    const t = this.time + f.id * 1.7;
    // Brass plating stays on until it has taken its hit.
    if (v.plating) v.plating.visible = !!f.armored && f.hp > 1;
    const anim = frozen ? 0 : 1;
    if (!frozen) v.phase += dt * (2 + speed * 6);
    v.tell = 0;

    if (v.type === 'droid') {
      v.root.rotation.y = v.yaw;
      const walk = Math.min(1, speed / 1.2) * anim;
      for (let i = 0; i < 4; i++) {
        const leg = v.legs[i];
        const ph = v.phase + (i % 2 ? Math.PI : 0);
        leg.rotation.z = 0.55 + Math.sin(ph) * 0.28 * walk;
      }
      v.inner.position.y = o.rm ? 0 : Math.abs(Math.sin(v.phase)) * 0.025 * walk;
      v.tell = st === 'aim' ? smooth(f.dur > 0 ? f.t / f.dur : v.stateT / 0.5) : 0;
    } else if (v.type === 'drone') {
      v.root.rotation.y = 0;
      v.rotor.rotation.y -= dt * 16 * anim;
      v.hover.position.y = 0.42 + (o.rm || frozen ? 0 : Math.sin(t * 3.1) * 0.04);
      v.hover.rotation.z = -clamp(v.vx * 0.06, 0.3);
      v.hover.rotation.x = clamp(v.vz * 0.06, 0.3);
    } else if (v.type === 'jumper') {
      v.root.rotation.y = v.yaw;
      let sq = 1;
      let lift = 0;
      const prog = f.dur > 0 ? clamp01(f.t / f.dur) : -1;
      if (/crouch|wind|prep|charge|aim/.test(st)) sq = 1 - 0.28 * smooth(prog >= 0 ? Math.min(1, prog * 4) : v.stateT / 0.25) - (prog > 0.8 ? 0.06 * smooth((prog - 0.8) / 0.2) : 0);
      else if (/hop|jump|leap|air/.test(st)) {
        const k = prog >= 0 ? prog : clamp01(v.stateT / 0.34);
        lift = Math.sin(k * Math.PI) * 0.55;
        sq = 1.12 - 0.12 * k;
      } else if (/land/.test(st)) sq = 0.8 + 0.2 * smooth(v.stateT / 0.15);
      else if (speed > 2.5) {
        // Moving fast without a hop state: assume it is mid-hop.
        lift = 0.3;
        sq = 1.1;
      } else sq = 1 + (o.rm || frozen ? 0 : Math.sin(t * 2.2) * 0.03);
      v.tell = st === 'land' && f.zap ? smooth(prog >= 0 ? prog : v.stateT / 0.45) : 0;
      v.body.position.y = 0.26 * sq + lift;
      v.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      for (const s of v.springs) {
        s.scale.y = Math.max(0.35, sq + lift * 1.6);
        s.position.y = 0.24 * sq + lift;
      }
    } else if (v.type === 'sniffer') {
      v.root.rotation.y = v.yaw;
      const walk = Math.min(1, speed / 1.0) * anim;
      for (let i = 0; i < 4; i++) v.legs[i].rotation.z = Math.sin(v.phase * 1.4 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.5 * walk;
      v.inner.rotation.y = o.rm ? 0 : Math.sin(t * 2.4) * 0.05 * anim;
      // Armor plate falls away once it has absorbed a hit.
      v.armor.visible = f.hp === undefined || f.hp > 1;
    } else if (v.type === 'warden') {
      v.root.rotation.y = 0;
      v.head.rotation.y = v.yaw;
      // One brass piece per hit left past the last: three hits show both, one none.
      for (let i = 0; i < v.plates.length; i++) v.plates[i].visible = (f.hp ?? 1) - 1 > i;
      const firing = /fire|burst|shoot/.test(st);
      v.tell = st === 'aim' ? smooth(f.dur > 0 ? f.t / f.dur : v.stateT / 0.55) : 0;
      v.recoil.position.x = firing && !frozen ? -0.05 * Math.abs(Math.sin(v.stateT * 14)) : 0;
    }
    // Telegraph: a glow at the eye or muzzle that swells before a robot fires.
    if (v.tellSprite) {
      const k = frozen ? 0 : v.tell;
      v.tellSprite.visible = k > 0.01;
      if (k > 0.01) v.tellSprite.scale.setScalar(0.2 + 0.55 * k);
    }
  }

  updateShadow(game, o) {
    const S = this.shadow;
    const s = game.shadow;
    const dt = o.dt;
    const U = S.mat.uniforms;
    if (!s) {
      // He left (room change) or never came: fade quickly.
      if (S.root.visible) {
        S.fade -= dt * 4;
        if (S.fade <= 0) S.root.visible = false;
        else {
          U.uAlpha.value = S.fade;
          S.castMat.uniforms.uAlpha.value = S.fade;
        }
      }
      S.state = '';
      return;
    }
    S.root.visible = true;
    if (s.state !== S.state) {
      S.state = s.state;
      S.stateT = 0;
    } else S.stateT += dt;
    const p = game.player;
    // Face Shamus: the painted figure reaches right, so mirror it when he is to the left.
    const want = p.x < s.x - 0.05 ? -1 : p.x > s.x + 0.05 ? 1 : S.face;
    S.face = approach(S.face, want, 12, dt);
    S.flip.scale.x = Math.abs(S.face) < 0.06 ? 0.06 * Math.sign(S.face || 1) : S.face;
    U.uTime.value = o.time;
    U.uSway.value = o.rm ? 0.2 : 1;
    let alpha = 1;
    let stun = 0;
    let dissolve = 0;
    let eyes = 1;
    let rise = 0;
    let lean = 0;
    const prog = s.dur > 0 ? clamp01(s.t / s.dur) : -1;
    if (s.state === 'enter') {
      // He rises out of the floor and fades in; the eyes open last.
      const k = smooth(prog >= 0 ? prog : S.stateT / 0.9);
      alpha = 0.25 + 0.75 * k;
      rise = (1 - k) * -1.6;
      eyes = smooth(prog >= 0 ? (prog - 0.35) / 0.65 : (S.stateT - 0.3) / 0.6);
    } else if (s.state === 'stunned') {
      stun = 1;
      eyes = 0.3;
    } else if (s.state === 'dying') {
      const k = prog >= 0 ? prog : clamp01(S.stateT / 1.6);
      dissolve = smooth(k);
      eyes = 1 - smooth((k - 0.65) / 0.35);
    } else if (s.state === 'charge') {
      // Rearing back (still), then leaning hard into the rush; eyes blaze.
      const rushing = Math.abs(s.vx || 0) + Math.abs(s.vy || 0) > 0.01;
      lean = rushing ? 0.3 : -0.18 * smooth(S.stateT / 0.3);
      eyes = 1.8;
    } else if (s.state === 'chase') {
      lean = 0.08;
    }
    // Lean toward where he is going (screen left or right), in the card's own plane.
    const dir = Math.sign((s.vx || 0) || (p.x - s.x)) || 1;
    S.lean = approach(S.lean, lean * dir, 10, dt);
    S.roll.rotation.z = -S.lean;
    const bob = o.rm ? 0 : Math.sin(o.time * 1.6) * 0.05;
    S.root.position.set(toX(s.x), rise + bob, toZ(s.y));
    S.fade = alpha;
    U.uAlpha.value = alpha;
    U.uStun.value = approach(U.uStun.value, stun, 8, dt);
    U.uDissolve.value = dissolve;
    U.uEyes.value = Math.min(1, eyes);
    S.glowMat.opacity = Math.min(1, eyes) * alpha;
    S.glows[0].scale.setScalar(0.24 * Math.max(1, eyes));
    S.glows[1].scale.setScalar(0.24 * Math.max(1, eyes));
    // The floor pieces stay on the floor while he rises out of it.
    const floorY = 0.012 - S.root.position.y;
    S.blob.position.y = floorY;
    S.cast.position.y = floorY + 0.001;
    S.cast.scale.set(SHADOW_W * S.flip.scale.x, 1, CAST_LEN * (0.4 + 0.6 * (1 + rise / 1.6)));
    S.blobMat.opacity = 0.7 * alpha * (1 - dissolve);
    S.castMat.uniforms.uAlpha.value = alpha * (1 - dissolve);
    const stunned = s.state === 'stunned';
    for (let i = 0; i < S.stars.length; i++) {
      const st = S.stars[i];
      st.visible = stunned;
      if (!stunned) continue;
      const a = (o.rm ? 0 : o.time * 2.5) + (i * TAU) / S.stars.length;
      st.position.set(Math.cos(a) * 0.55, SHADOW_H * 0.97, Math.sin(a) * 0.3);
    }
  }

  updateStreaks(pool, list, y, o) {
    const frame = this.frame;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      let v = pool.byId.get(s.id);
      if (!v) {
        v = null;
        for (const c of pool.list) if (c.id === -1) { v = c; break; }
        if (!v) continue;
        v.id = s.id;
        pool.byId.set(s.id, v);
      }
      v.seen = frame;
      const dx = s.dx ?? s.vx ?? 1;
      const dy = s.dy ?? s.vy ?? 0;
      v.g.visible = true;
      v.g.position.set(toX(s.x), y, toZ(s.y));
      v.g.rotation.y = -Math.atan2(dy, dx);
    }
    for (const v of pool.list) {
      if (v.id !== -1 && v.seen !== frame) {
        pool.byId.delete(v.id);
        v.id = -1;
        v.g.visible = false;
      }
    }
    void o;
  }

  updateItem(game, o) {
    const it = game.item;
    const key = it ? `${it.kind}:${it.color ?? ''}` : '';
    if (key !== this.itemKey) {
      for (const v of Object.values(this.items)) v.root.visible = false;
      this.itemKey = key;
      if (it && this.items[it.kind]) {
        const view = this.items[it.kind];
        const hex = it.color ? KEY_COLORS[it.color]?.hex ?? '#ffffff' : '#ffffff';
        view.color(new THREE.Color(hex));
      }
    }
    if (!it) return;
    const view = this.items[it.kind];
    if (!view) return;
    view.root.visible = !it.hidden;
    if (it.hidden) return;
    view.root.position.set(toX(it.x), 0, toZ(it.y));
    const t = o.time;
    const bob = o.rm ? 0 : Math.sin(t * 2.2) * 0.06;
    if (it.kind === 'keyhole') {
      const dim = it.used ? 0.12 : 1;
      view.face.emissiveIntensity = approach(view.face.emissiveIntensity, 2.6 * dim, 6, o.dt);
      view.mats[3].opacity = dim;
      return;
    }
    // The question mark sways to face the camera so it always reads; others turn.
    view.spin.rotation.y = it.kind === 'mystery' ? Math.sin(t * 1.2) * 0.45 : t * 1.3;
    view.spin.position.y = (it.kind === 'life' ? 0.12 : 0.5) + bob;
    if (it.kind === 'mystery') {
      // A slow 1 Hz glow pulse.
      const k = 0.5 + 0.5 * Math.sin(t * TAU * 0.9);
      view.mat.emissiveIntensity = 0.8 + 0.7 * k;
      view.halo.scale.setScalar(0.55 + 0.15 * k);
    }
    if (it.kind === 'life') {
      for (const b of view.bubbles) {
        const ph = (b.userData.phase + t * 0.45) % 1;
        b.position.set(Math.cos(b.userData.a) * 0.06, 0.1 + ph * 0.28, Math.sin(b.userData.a) * 0.06);
        b.scale.setScalar(0.6 + ph * 0.8);
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
    const geos = new Set();
    const mats = new Set();
    this.root.traverse((o) => {
      if (o.geometry && o.geometry !== this.kit.geo.flat) geos.add(o.geometry);
      if (o.material) for (const m of [].concat(o.material)) mats.add(m);
    });
    for (const g of geos) g.dispose();
    for (const m of mats) if (!Object.values(this.kit.mat).includes(m)) m.dispose();
    this.shamus.dispose();
    this.shadow.dispose();
  }
}

function clamp(v, m) {
  return v < -m ? -m : v > m ? m : v;
}
