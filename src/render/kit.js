// The kit: geometries, materials, and textures shared across rooms. Built once per
// Renderer and disposed with it. Anything per room lives in roomview.js.

import * as THREE from 'three';
import { ZONES, KEY_COLORS } from '../map.js';
import * as T from './textures.js';
import { beamMaterial, podMaterial } from './electric.js';
import { bake, worldBox, mulberry, toX, toZ } from './util.js';

// Heights in world units.
export const BEAM_Y = 0.34; // interior electric beams
export const BORDER_BEAM_Y = 0.47; // the border beam along the bulkhead ledge
export const LEDGE_TOP = 0.42;
export const WALL_TOP = 1.05;
export const PILLAR_TOP = 1.3;

// Frame size: the room plus the machinery margin. Neighboring rooms sit one frame away
// during a slide, so their corridors meet.
export const GX = 6;
export const GZ = 5;
export const FRAME_X = 21 + GX * 2;
export const FRAME_Z = 13 + GZ * 2;

export const AMBER = new THREE.Color(1.0, 0.5, 0.1);
export const DOOR_RED = new THREE.Color(1.0, 0.12, 0.08);

export function sectorColor(zone) {
  return new THREE.Color(ZONES[zone]?.color ?? '#8f7bff');
}

export function keyColor(name) {
  return new THREE.Color(KEY_COLORS[name]?.hex ?? '#ffffff');
}

export class Kit {
  constructor(gl) {
    this.gl = gl;
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    this.disposables = [];
    const keep = (x) => {
      this.disposables.push(x);
      return x;
    };
    this.keep = keep;

    // ---------------------------------------------------------------- textures
    const tex = {};
    tex.plate = keep(T.floorPlate(aniso));
    tex.steel = keep(T.steelPanel(aniso));
    tex.machinery = keep(T.machinery(aniso));
    [tex.crateSide, tex.crateSideEm] = T.crateSide().map(keep);
    tex.crateTop = keep(T.crateTop());
    tex.barrelSide = keep(T.barrelSide());
    tex.barrelTop = keep(T.barrelTop());
    tex.screen = keep(T.terminalScreen());
    [tex.termBody, tex.termBodyEm] = T.terminalBody().map(keep);
    tex.vent = keep(T.vent());
    tex.grate = keep(T.grate());
    tex.glow = keep(T.radial(128, 0, 1));
    tex.soft = keep(T.radial(64, 0, 0.6));
    tex.scorch = keep(T.scorch());
    tex.lock = keep(T.lockIcon());
    tex.keyhole = keep(T.keyholePlate());
    tex.hazard = keep(T.hazard());
    tex.holo = keep(T.holoMap());
    tex.shadow = keep(T.shadowFigure());
    this.tex = tex;

    // ---------------------------------------------------------------- materials
    const std = (o) => keep(new THREE.MeshStandardMaterial(o));
    const basic = (o) => keep(new THREE.MeshBasicMaterial(o));
    const m = {};
    m.floor = std({ map: tex.plate, color: 0x7d8696, roughness: 0.36, metalness: 0.5 });
    m.floorBase = basic({ color: 0x0b0c0f });
    m.bulk = std({ map: tex.steel, vertexColors: true, roughness: 0.5, metalness: 0.5 });
    m.machinery = std({ map: tex.machinery, vertexColors: true, color: 0x8a8e96, roughness: 0.72, metalness: 0.35 });
    m.ground = std({ map: tex.machinery, color: 0x2c2f36, roughness: 0.85, metalness: 0.2 });
    m.amber = basic({ color: AMBER.clone().multiplyScalar(2.0) });
    m.red = basic({ color: DOOR_RED.clone().multiplyScalar(1.9) });
    m.lights = basic({ vertexColors: true });
    m.postBody = std({ color: 0x4a505b, roughness: 0.32, metalness: 0.7 });
    m.rail = std({ color: 0x2c3038, roughness: 0.45, metalness: 0.6 });
    const crateSide = std({ map: tex.crateSide, emissiveMap: tex.crateSideEm, emissive: 0xffffff, emissiveIntensity: 2.4, roughness: 0.5, metalness: 0.45 });
    const crateTop = std({ map: tex.crateTop, roughness: 0.45, metalness: 0.45 });
    m.crate = [crateSide, crateSide, crateTop, crateSide, crateSide, crateSide];
    const barrelSide = std({ map: tex.barrelSide, roughness: 0.42, metalness: 0.35 });
    const barrelTop = std({ map: tex.barrelTop, roughness: 0.45, metalness: 0.35 });
    m.barrel = [barrelSide, barrelTop, barrelTop];
    m.termBody = std({ map: tex.termBody, emissiveMap: tex.termBodyEm, emissive: 0xffffff, emissiveIntensity: 2.0, roughness: 0.5, metalness: 0.45 });
    // White, so each console's instance color sets its screen's hue and brightness.
    m.screen = basic({ map: tex.screen, color: 0xffffff });
    // A pool of light on the floor in front of each console, tinted per instance.
    m.consoleGlow = basic({ map: tex.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    // The glow around a barrel whose fuse is burning, and the burn mark one leaves.
    m.scorch = basic({ map: tex.scorch, transparent: true, depthWrite: false, opacity: 0.7 });
    m.vent = std({ map: tex.vent, roughness: 0.55, metalness: 0.5 });
    m.grate = std({ map: tex.grate, roughness: 0.55, metalness: 0.5, emissiveMap: tex.grate, emissive: 0x000000 });
    m.podPost = std({ map: tex.hazard, roughness: 0.5, metalness: 0.3 });
    m.podBar = keep(podMaterial());
    m.podGlow = keep(beamMaterial('#ffc21a', 0.9));
    m.podCap = basic({ color: new THREE.Color(1.0, 0.75, 0.1).multiplyScalar(2.2) });
    m.blob = basic({ map: tex.soft, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
    this.mat = m;

    // Per-sector materials: post caps, the glow line on wall rails, and the beam shader.
    this.zone = [];
    for (let z = 1; z <= 4; z++) {
      const c = sectorColor(z);
      this.zone[z] = {
        color: c,
        cap: basic({ color: c.clone().multiplyScalar(2.4) }),
        railGlow: basic({ color: c.clone().multiplyScalar(1.6) }),
        beam: keep(beamMaterial(c, 1.0)),
      };
    }

    // ---------------------------------------------------------------- geometries
    const g = {};
    const geo = (x) => keep(x);
    g.plate = geo(new THREE.BoxGeometry(0.965, 0.08, 0.965).translate(0, -0.04, 0));
    g.postBase = geo(bake([
      [new THREE.CylinderGeometry(0.17, 0.2, 0.05, 16), '#30343c', { y: 0.025 }],
      [new THREE.CylinderGeometry(0.09, 0.12, 0.62, 12), '#5d6470', { y: 0.31 }],
      [new THREE.CylinderGeometry(0.125, 0.125, 0.07, 12), '#2a2e35', { y: BEAM_Y }],
      [new THREE.CylinderGeometry(0.11, 0.09, 0.05, 12), '#7c8494', { y: 0.6 }],
    ]));
    g.postCap = geo(bake([
      [new THREE.SphereGeometry(0.105, 14, 10), '#ffffff', { y: 0.67 }],
      [new THREE.TorusGeometry(0.135, 0.03, 6, 18), '#ffffff', { y: BEAM_Y, rx: Math.PI / 2 }],
    ]));
    g.studBase = geo(bake([
      [new THREE.CylinderGeometry(0.11, 0.14, 0.04, 10), '#30343c', { y: 0.02 }],
      [new THREE.CylinderGeometry(0.045, 0.06, BEAM_Y, 8), '#5d6470', { y: BEAM_Y / 2 }],
    ]));
    g.studCap = geo(new THREE.SphereGeometry(0.075, 10, 6).translate(0, BEAM_Y, 0));
    g.node = geo(bake([
      [new THREE.SphereGeometry(0.1, 12, 8), '#ffffff', {}],
      [new THREE.TorusGeometry(0.15, 0.025, 6, 16), '#ffffff', {}],
    ]));
    g.crate = geo(new THREE.BoxGeometry(0.84, 0.8, 0.84).translate(0, 0.4, 0));
    g.barrel = geo(new THREE.CylinderGeometry(0.34, 0.34, 0.82, 22).translate(0, 0.41, 0));
    g.termBody = geo(new THREE.BoxGeometry(0.84, 0.5, 0.72).translate(0, 0.25, 0));
    {
      // The screen sits in a slanted housing on top, tilted toward the camera (south).
      const s = new THREE.PlaneGeometry(0.66, 0.44);
      s.rotateX(-0.55);
      s.translate(0, 0.66, 0.06);
      g.screen = geo(s);
      g.termHood = geo(bake([
        [new THREE.BoxGeometry(0.78, 0.5, 0.12), '#3b4049', { y: 0.66, z: -0.08, rx: -0.55 }],
      ]));
    }
    g.decor = geo(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2).translate(0, 0.003, 0));
    g.podPost = geo(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 12).translate(0, 0.25, 0));
    g.podCap = geo(new THREE.SphereGeometry(0.075, 10, 6).translate(0, 0.53, 0));
    g.flat = geo(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    g.quad = geo(new THREE.PlaneGeometry(1, 1));
    this.geo = g;

    this.bulkCache = new Map();
    this.ring = this.buildRing();
    this.ground = this.buildGround();
  }

  // ------------------------------------------------------------------ bulkheads
  // The border walls, pillars, and lights for a room depend only on which sides have
  // doors, so there are just 16 variants; each is built once and cached.
  bulkhead(exits) {
    const key = ['N', 'E', 'S', 'W'].map((s) => (exits[s] ? s : '-')).join('');
    let v = this.bulkCache.get(key);
    if (v) return v;
    v = buildBulkhead(exits);
    this.keep(v.body);
    this.keep(v.amber);
    this.keep(v.red);
    this.bulkCache.set(key, v);
    return v;
  }

  // ------------------------------------------------------------------ machinery ring
  buildRing() {
    const rnd = mulberry(1234);
    const boxes = [];
    const lights = [];
    // Room plus bulkhead, in sim coordinates, and the frame around it.
    const inner = { x0: -1.7, y0: -1.7, x1: 22.7, y1: 14.7 };
    const outer = { x0: -GX, y0: -GZ, x1: 21 + GX, y1: 13 + GZ };
    // Corridor slots run past the frame edge so no box can intrude on a neighbor's
    // corridor during a slide.
    const slots = [
      { x0: 7.6, x1: 13.4, y0: outer.y0 - 3, y1: inner.y0 + 0.1 },
      { x0: 7.6, x1: 13.4, y0: inner.y1 - 0.1, y1: outer.y1 + 3 },
      { x0: outer.x0 - 3, x1: inner.x0 + 0.1, y0: 3.6, y1: 9.4 },
      { x0: inner.x1 - 0.1, x1: outer.x1 + 3, y0: 3.6, y1: 9.4 },
    ];
    const hits = (b, list, pad) => list.some((o) => b.x0 < o.x1 + pad && b.x1 > o.x0 - pad && b.y0 < o.y1 + pad && b.y1 > o.y0 - pad);
    const roomRect = [inner];
    for (let i = 0; i < 2400 && boxes.length < 150; i++) {
      const w = 0.7 + rnd() * 2.4;
      const d = 0.7 + rnd() * 2.0;
      const x0 = outer.x0 - 1 + rnd() * (outer.x1 - outer.x0 + 2 - w);
      const y0 = outer.y0 - 1 + rnd() * (outer.y1 - outer.y0 + 2 - d);
      const b = { x0, y0, x1: x0 + w, y1: y0 + d };
      if (hits(b, roomRect, 0.25) || hits(b, slots, 0.1) || hits(b, boxes, 0.08)) continue;
      b.h = 0.12 + rnd() * rnd() * 0.9;
      boxes.push(b);
    }
    const parts = [];
    for (const b of boxes) {
      const shade = 0.55 + rnd() * 0.45;
      const g = worldBox(toX(b.x0), 0, toZ(b.y0), toX(b.x1), b.h, toZ(b.y1), 0.5);
      parts.push([g, '#8a8f99', { light: shade }]);
      // A lamp or two on the face toward the camera, or on top.
      if (rnd() < 0.45) {
        const palette = ['#ffa040', '#ffa040', '#ff4030', '#40ff90', '#40c8ff'];
        const col = palette[Math.floor(rnd() * palette.length)];
        const n = 1 + Math.floor(rnd() * 3);
        const lw = 0.1;
        for (let k = 0; k < n; k++) {
          const lx = toX(b.x0 + 0.2 + (k + 0.5) * ((b.x1 - b.x0 - 0.4) / n));
          if (rnd() < 0.5) {
            lights.push([worldBox(lx - lw, b.h * 0.3, toZ(b.y1), lx + lw, b.h * 0.3 + 0.05, toZ(b.y1) + 0.02), col, { light: 1.1 }]);
          } else {
            lights.push([worldBox(lx - lw * 0.6, b.h, toZ(b.y0) + 0.3, lx + lw * 0.6, b.h + 0.02, toZ(b.y0) + 0.38), col, { light: 1.0 }]);
          }
        }
      }
    }
    // Conduit pipes running along the outside of the bulkhead.
    const pipe = (x0, z0, x1, z1, r, y, col) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const c = new THREE.CylinderGeometry(r, r, len, 10, 1, true);
      c.rotateZ(Math.PI / 2);
      c.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      c.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      parts.push([c, col, {}]);
    };
    pipe(toX(-1), toZ(-1.95), toX(7.2), toZ(-1.95), 0.12, 0.14, '#5b4a3a');
    pipe(toX(13.8), toZ(-1.95), toX(22), toZ(-1.95), 0.12, 0.14, '#5b4a3a');
    pipe(toX(-1), toZ(14.95), toX(7.2), toZ(14.95), 0.1, 0.12, '#4a525d');
    pipe(toX(13.8), toZ(14.95), toX(22), toZ(14.95), 0.1, 0.12, '#4a525d');
    pipe(toX(-1.95), toZ(-1), toX(-1.95), toZ(3.2), 0.1, 0.12, '#4a525d');
    pipe(toX(-1.95), toZ(9.8), toX(-1.95), toZ(14), 0.1, 0.12, '#4a525d');
    pipe(toX(22.95), toZ(-1), toX(22.95), toZ(3.2), 0.1, 0.12, '#5b4a3a');
    pipe(toX(22.95), toZ(9.8), toX(22.95), toZ(14), 0.1, 0.12, '#5b4a3a');
    const body = this.keep(bake(parts));
    const lit = this.keep(bake(lights));
    return { body, lit };
  }

  buildGround() {
    const g = this.keep(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 200, uv.getY(i) * 200);
    return g;
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
    this.bulkCache.clear();
  }
}

// ---------------------------------------------------------------------- bulkhead
// Built in sim coordinates (x right, y down) and converted with toX/toZ.
function buildBulkhead(exits) {
  const body = [];
  const amber = [];
  const red = [];
  const B = (x0, y0, x1, y1, h0, h1, list = body, col = '#8a909a', light = 1) => {
    // Sim rectangle [x0,x1] x [y0,y1], world height h0..h1.
    list.push([worldBox(toX(Math.min(x0, x1)), h0, toZ(Math.min(y0, y1)), toX(Math.max(x0, x1)), h1, toZ(Math.max(y0, y1)), 0.5), col, { light }]);
  };
  const door = {
    N: !!exits.N,
    S: !!exits.S,
    E: !!exits.E,
    W: !!exits.W,
  };
  const IN0 = 0.38; // inner ledge faces
  const IN1 = 21 - 0.38;
  const IN1Y = 13 - 0.38;
  const WALL_IN = -0.2; // tall wall inner faces
  const OUT = -1.6;

  // Horizontal sides: N at the top (small y), S at the bottom.
  const hSide = (top) => {
    const yl0 = top ? WALL_IN : 13 - WALL_IN;
    const yl1 = top ? IN0 : IN1Y;
    const yw0 = top ? OUT : 13 - OUT;
    const yw1 = top ? WALL_IN : 13 - WALL_IN;
    const wallTop = top ? WALL_TOP : 0.78;
    const has = top ? door.N : door.S;
    const spans = has ? [[-0.2, 7.75], [13.25, 21.2]] : [[-0.2, 21.2]];
    for (const [a, b] of spans) {
      B(a, yl0, b, yl1, 0, LEDGE_TOP, body, '#767c87', 1);
      // a lighter trim along the ledge edge
      B(a, yl1 - 0.05 * (top ? 1 : -1), b, yl1, LEDGE_TOP, LEDGE_TOP + 0.03, body, '#a9afb9', 1.0);
    }
    const wspans = has ? [[OUT, 7.75], [13.25, 21 - OUT]] : [[OUT, 21 - OUT]];
    for (const [a, b] of wspans) {
      B(a, yw0, b, yw1, 0, wallTop, body, '#5a606a', 1);
      B(a, yw1 - 0.22 * (top ? 1 : -1), b, yw1 + 0.03 * (top ? 1 : -1), wallTop, wallTop + 0.05, body, '#9299a4', 1);
    }
    // Amber lamps: triple bars on the wall face (north) or on its top (south).
    const xs = has ? [2.5, 5.5, 15.5, 18.5] : [2.5, 6.5, 10.5, 14.5, 18.5];
    for (const x of xs) {
      if (top) {
        for (let k = 0; k < 3; k++) {
          const y0 = 0.5 + k * 0.17;
          B(x - 0.09, WALL_IN, x + 0.09, WALL_IN + 0.03, y0, y0 + 0.1, amber);
        }
      } else {
        B(x - 0.5, 13 - WALL_IN + 0.05, x + 0.5, 13 - WALL_IN + 0.15, wallTop + 0.05, wallTop + 0.075, amber);
      }
    }
    // Small amber strip lights along the ledge top.
    for (let x = 1.5; x < 20; x += 3) {
      if (has && x > 7.2 && x < 13.8) continue;
      const yy = top ? IN0 - 0.18 : IN1Y + 0.18;
      B(x - 0.35, yy - 0.04, x + 0.35, yy + 0.04, LEDGE_TOP, LEDGE_TOP + 0.02, amber);
    }
  };
  // Vertical sides: W at the left (small x), E at the right.
  const vSide = (left) => {
    const xl0 = left ? WALL_IN : 21 - WALL_IN;
    const xl1 = left ? IN0 : IN1;
    const xw0 = left ? OUT : 21 - OUT;
    const xw1 = left ? WALL_IN : 21 - WALL_IN;
    const has = left ? door.W : door.E;
    const spans = has ? [[IN0, 3.75], [9.25, IN1Y]] : [[IN0, IN1Y]];
    for (const [a, b] of spans) {
      B(xl0, a, xl1, b, 0, LEDGE_TOP, body, '#767c87', 1);
      B(xl1 - 0.05 * (left ? 1 : -1), a, xl1, b, LEDGE_TOP, LEDGE_TOP + 0.03, body, '#a9afb9', 1.0);
    }
    const wspans = has ? [[WALL_IN, 3.75], [9.25, 13 - WALL_IN]] : [[WALL_IN, 13 - WALL_IN]];
    for (const [a, b] of wspans) {
      B(xw0, a, xw1, b, 0, WALL_TOP, body, '#5a606a', 1);
      B(xw1 - 0.22 * (left ? 1 : -1), a, xw1 + 0.03 * (left ? 1 : -1), b, WALL_TOP, WALL_TOP + 0.05, body, '#9299a4', 1);
    }
    const ys = has ? [2.2, 10.8] : [2.2, 6.5, 10.8];
    for (const y of ys) {
      for (let k = 0; k < 3; k++) {
        const h0 = 0.5 + k * 0.17;
        const fx = left ? WALL_IN : 21 - WALL_IN;
        B(fx, y - 0.09, fx + (left ? 0.03 : -0.03), y + 0.09, h0, h0 + 0.1, amber);
      }
    }
    for (let y = 2; y < 12; y += 3) {
      if (has && y > 3.4 && y < 9.6) continue;
      const xx = left ? IN0 - 0.18 : IN1 + 0.18;
      B(xx - 0.04, y - 0.35, xx + 0.04, y + 0.35, LEDGE_TOP, LEDGE_TOP + 0.02, amber);
    }
  };
  hSide(true);
  hSide(false);
  vSide(true);
  vSide(false);

  // Corner pillars with amber panels on their room-facing faces.
  const pillar = (x0, y0, x1, y1, h, col = '#666c77') => {
    B(x0, y0, x1, y1, 0, h, body, col, 1);
    B(x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, h, h + 0.06, body, '#c0c5ce', 1);
  };
  const P0 = -1.15;
  const P1 = 0.44;
  pillar(P0, P0, P1, P1, PILLAR_TOP);
  pillar(21 - P1, P0, 21 - P0, P1, PILLAR_TOP);
  pillar(P0, 13 - P1, P1, 13 - P0, PILLAR_TOP * 0.8);
  pillar(21 - P1, 13 - P1, 21 - P0, 13 - P0, PILLAR_TOP * 0.8);
  // Corner lamps facing the room (on the faces the camera can see).
  for (let k = 0; k < 3; k++) {
    const h0 = 0.55 + k * 0.22;
    B(0.08, P1, 0.28, P1 + 0.03, h0, h0 + 0.13, amber);
    B(20.72, P1, 20.92, P1 + 0.03, h0, h0 + 0.13, amber);
  }

  // Door frames: tall pillars flanking each opening, red-lit, with corridor walls
  // running out to the frame edge.
  const corridor = (side) => {
    const across = side === 'N' || side === 'S';
    // Flank pillars span [lo0, lo1] and [hi0, hi1] along the wall.
    const lo0 = across ? 7.75 : 3.75;
    const lo1 = across ? 8.85 : 4.85;
    const hi0 = across ? 12.15 : 8.15;
    const hi1 = across ? 13.25 : 9.25;
    const R = (a0, a1, d0, d1, h0, h1, list, col, light) => {
      // a along the wall, d depth from the door line outward (sim units, positive = out)
      if (side === 'N') B(a0, 0.5 - d1, a1, 0.5 - d0, h0, h1, list, col, light);
      if (side === 'S') B(a0, 12.5 + d0, a1, 12.5 + d1, h0, h1, list, col, light);
      if (side === 'W') B(0.5 - d1, a0, 0.5 - d0, a1, h0, h1, list, col, light);
      if (side === 'E') B(20.5 + d0, a0, 20.5 + d1, a1, h0, h1, list, col, light);
    };
    const ph = side === 'S' ? PILLAR_TOP * 0.8 : PILLAR_TOP;
    const inset = 0.1; // pillar faces sit just behind the border beam
    // Pillars.
    R(lo0, lo1, inset, 2.1, 0, ph, body, '#666c77', 1);
    R(hi0, hi1, inset, 2.1, 0, ph, body, '#666c77', 1);
    R(lo0 + 0.08, lo1 - 0.08, inset + 0.08, 2.02, ph, ph + 0.06, body, '#c0c5ce', 1);
    R(hi0 + 0.08, hi1 - 0.08, inset + 0.08, 2.02, ph, ph + 0.06, body, '#c0c5ce', 1);
    // Red lamps: a vertical bar on each pillar face toward the opening, a lamp on top.
    for (const d of [0.45, 1.25]) {
      R(lo1, lo1 + 0.03, d, d + 0.12, 0.2, ph - 0.2, red);
      R(hi0 - 0.03, hi0, d, d + 0.12, 0.2, ph - 0.2, red);
    }
    R(lo1 - 0.22, lo1 - 0.1, 0.25, 1.9, ph + 0.06, ph + 0.08, red);
    R(hi0 + 0.1, hi0 + 0.22, 0.25, 1.9, ph + 0.06, ph + 0.08, red);
    // A red bar on the room-facing face of each pillar.
    R(lo0 + 0.25, lo1 - 0.25, inset - 0.03, inset, ph - 0.35, ph - 0.22, red);
    R(hi0 + 0.25, hi1 - 0.25, inset - 0.03, inset, ph - 0.35, ph - 0.22, red);
    // Corridor side walls out to the frame edge, lower than the pillars.
    const far = (across ? GZ : GX) + 0.5;
    R(lo0, lo1 - 0.25, 2.1, far, 0, 0.7, body, '#6f757f', 1);
    R(hi0 + 0.25, hi1, 2.1, far, 0, 0.7, body, '#6f757f', 1);
    for (let d = 2.8; d < far - 0.3; d += 1.4) {
      R(lo1 - 0.25, lo1 - 0.22, d, d + 0.5, 0.3, 0.38, red);
      R(hi0 + 0.22, hi0 + 0.25, d, d + 0.5, 0.3, 0.38, red);
    }
  };
  for (const s of ['N', 'E', 'S', 'W']) if (door[s]) corridor(s);

  return { body: bake(body), amber: bake(amber), red: bake(red) };
}
