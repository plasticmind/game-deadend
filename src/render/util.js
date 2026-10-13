// Small helpers shared by the renderer modules: sim-to-world mapping, seeded random,
// vertex-colored part baking, and boxes with world-scaled UVs.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Sim x runs right, sim y runs down. World X = x - 10.5, world Z = y - 6.5, Y is up.
export const toX = (x) => x - 10.5;
export const toZ = (y) => y - 6.5;

// Facing 0..7 clockwise from east (y down) to a world yaw for an object whose local
// forward is +X.
export const yawOf = (face) => -(face * Math.PI) / 4;

export function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
// Exponential approach that is frame-rate independent.
export const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// Shortest-arc angle approach.
export function approachAngle(cur, target, rate, dt) {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + d * (1 - Math.exp(-rate * dt));
}

const _c = new THREE.Color();

// Give a geometry a flat vertex color (hex in sRGB, stored linear).
export function paint(geo, color, scale = 1) {
  _c.set(color).multiplyScalar(scale);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// Place a primitive: t = { x, y, z, rx, ry, rz, sx, sy, sz, s }.
export function place(geo, t = {}) {
  _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
  _q.setFromEuler(_e);
  const s = t.s ?? 1;
  _s.set((t.sx ?? 1) * s, (t.sy ?? 1) * s, (t.sz ?? 1) * s);
  _p.set(t.x || 0, t.y || 0, t.z || 0);
  _m.compose(_p, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

// Normalize a geometry to indexed position/normal/uv(/color) so mergeGeometries accepts it.
function normalize(geo, withColor) {
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  for (const k of Object.keys(geo.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv' && !(withColor && k === 'color')) geo.deleteAttribute(k);
  }
  geo.morphAttributes = {};
  return geo;
}

// Bake [geometry, color, transform] parts into one vertex-colored geometry.
export function bake(parts) {
  const geos = [];
  for (const [g, color, t] of parts) {
    place(g, t);
    paint(g, color, t?.light ?? 1);
    geos.push(normalize(g, true));
  }
  const out = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return out;
}

// Merge plain geometries (no colors).
export function mergePlain(geos) {
  const list = geos.map((g) => normalize(g, false));
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return out;
}

// A box from (x0, y0, z0) to (x1, y1, z1) in world units with UVs scaled to world size,
// so a tiling panel texture keeps the same density on every face. `uvScale` is texture
// repeats per world unit.
export function worldBox(x0, y0, z0, x1, y1, z1, uvScale = 0.5) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    if (ny > 0.5) uv.setXY(i, px * uvScale, pz * uvScale);
    else if (nx > 0.5) uv.setXY(i, pz * uvScale, py * uvScale);
    else uv.setXY(i, px * uvScale, py * uvScale);
  }
  return g;
}

export function hexColor(hex) {
  return new THREE.Color(hex);
}
