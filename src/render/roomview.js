// One room's diorama, built from game.room.geo: floor plates, the bulkhead border with
// its door frames, electric walls (posts, rails, beams), pod gates, locked-door force
// fields, blocks, decor, a baked light-spill map, and the machinery around it.
// Shared pieces come from the kit; everything this file creates is disposed with it.

import * as THREE from 'three';
import { ARM, LOCK_FACE, DOOR } from '../room.js';
import { ZONES, KEY_COLORS } from '../map.js';
import { BEAM_Y, BORDER_BEAM_Y, GX, GZ, LEDGE_TOP } from './kit.js';
import { ribbonGeometry, postRibbonGeometry, fieldMaterial } from './electric.js';
import { toX, toZ, mulberry, bake, worldBox } from './util.js';
import { toTexture } from './textures.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const isBorder = (p) => p.r === 0 || p.r === 12 || p.c === 0 || p.c === 20;

export class RoomView {
  // room is game.room at build time; viewDir is the camera's fixed view direction.
  constructor(kit, room, viewDir) {
    this.kit = kit;
    this.id = room.id;
    this.zone = room.zone;
    this.geo = room.geo;
    this.group = new THREE.Group();
    this.group.name = `room-${room.id}`;
    this.own = [];
    this.locks = {};
    this.time = 0;
    this.build(room, viewDir);
  }

  mine(x) {
    this.own.push(x);
    return x;
  }

  add(obj, { cast = false, receive = false, order = 0 } = {}) {
    obj.castShadow = cast;
    obj.receiveShadow = receive;
    obj.renderOrder = order;
    obj.matrixAutoUpdate = false;
    obj.updateMatrix();
    this.group.add(obj);
    return obj;
  }

  instanced(geo, mat, items, opts = {}) {
    if (!items.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      _q.setFromAxisAngle(_up, it.ry || 0);
      _p.set(it.x, it.y || 0, it.z);
      _s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
      if (it.color !== undefined) im.setColorAt(i, _c.setScalar(1).multiplyScalar(1).set(it.color));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    this.own.push(im);
    return this.add(im, opts);
  }

  build(room, viewDir) {
    const kit = this.kit;
    const M = kit.mat;
    const G = kit.geo;
    const geo = this.geo;
    const zm = kit.zone[this.zone];
    const rnd = mulberry(1000 + this.id * 7919);
    const exits = geo.exits;

    // ---------------------------------------------------------------- machinery
    this.add(new THREE.Mesh(kit.ring.body, M.machinery), { receive: true });
    this.add(new THREE.Mesh(kit.ring.lit, M.lights));
    for (const side of ['N', 'E', 'S', 'W']) {
      if (exits[side]) continue;
      this.add(new THREE.Mesh(this.filler(side), M.machinery), { receive: true });
    }

    // ---------------------------------------------------------------- floor
    const base = new THREE.Mesh(G.flat, M.floorBase);
    base.scale.set(23, 1, 15);
    base.position.y = -0.075;
    this.add(base);

    const plates = [];
    const plate = (c, r, shade) => {
      const v = shade * (0.86 + rnd() * 0.16);
      const warm = rnd() < 0.15 ? 0.04 : 0;
      plates.push({
        x: toX(c + 0.5),
        z: toZ(r + 0.5),
        ry: Math.floor(rnd() * 4) * (Math.PI / 2),
        color: _c.setRGB(v + warm, v, v - warm * 0.5).getHex(),
      });
    };
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 21; c++) {
        const border = r === 0 || r === 12 || c === 0 || c === 20;
        if (border && geo.layout[r][c] === '#') continue;
        plate(c, r, 1);
      }
    }
    // Corridor floor out to the frame edge for each exit.
    for (const side of Object.keys(exits)) {
      const n = side === 'N' || side === 'S' ? GZ : GX;
      for (let k = 1; k <= n; k++) {
        for (let a = 0; a < 3; a++) {
          if (side === 'N') plate(9 + a, -k, 0.7);
          if (side === 'S') plate(9 + a, 12 + k, 0.7);
          if (side === 'W') plate(-k, 5 + a, 0.7);
          if (side === 'E') plate(20 + k, 5 + a, 0.7);
        }
      }
    }
    this.instanced(G.plate, M.floor, plates, { receive: true });

    // ---------------------------------------------------------------- light spill
    const spill = this.mine(this.spillTexture(room));
    this.spillMat = this.mine(new THREE.MeshBasicMaterial({
      map: spill,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    const sp = new THREE.Mesh(G.flat, this.spillMat);
    sp.scale.set(SPILL.w, 1, SPILL.h);
    sp.position.set(toX(SPILL.x0 + SPILL.w / 2), 0.004, toZ(SPILL.y0 + SPILL.h / 2));
    this.add(sp, { order: 1 });

    // ---------------------------------------------------------------- bulkhead
    const bh = kit.bulkhead(exits);
    this.add(new THREE.Mesh(bh.body, M.bulk), { cast: true, receive: true });
    this.add(new THREE.Mesh(bh.amber, M.amber));
    this.add(new THREE.Mesh(bh.red, M.red));

    // ---------------------------------------------------------------- electric walls
    const inner = [];
    const border = [];
    const emitters = [];
    const studs = [];
    const nodes = [];
    for (const p of geo.posts) {
      const onBorder = isBorder(p);
      if (onBorder) {
        const inward =
          (p.r === 0 && p.arms & ARM.S) || (p.r === 12 && p.arms & ARM.N) ||
          (p.c === 0 && p.arms & ARM.E) || (p.c === 20 && p.arms & ARM.W);
        const corner = (p.r === 0 || p.r === 12) && (p.c === 0 || p.c === 20);
        const alongH = p.r === 0 || p.r === 12 ? (p.arms & (ARM.E | ARM.W)) : 0;
        const alongV = p.c === 0 || p.c === 20 ? (p.arms & (ARM.N | ARM.S)) : 0;
        const end = !corner && (alongH === ARM.E || alongH === ARM.W || alongV === ARM.N || alongV === ARM.S);
        if (inward) emitters.push(p);
        else if (corner || end) nodes.push(p);
        continue;
      }
      const a = p.arms;
      if (a === (ARM.E | ARM.W) || a === (ARM.N | ARM.S)) studs.push(p);
      else emitters.push(p);
    }
    for (const b of geo.beams) {
      const onLine = (b.y1 === b.y2 && (b.y1 === 0.5 || b.y1 === 12.5)) || (b.x1 === b.x2 && (b.x1 === 0.5 || b.x1 === 20.5));
      const seg = { x1: toX(b.x1), z1: toZ(b.y1), x2: toX(b.x2), z2: toZ(b.y2) };
      if (onLine) border.push({ ...seg, y: BORDER_BEAM_Y });
      else inner.push({ ...seg, y: BEAM_Y });
    }

    // Rails: a low dark sill under every interior beam with a glowing line on top, so
    // the lethal line reads on the floor too.
    if (inner.length || emitters.length || studs.length) {
      const rail = [];
      const glow = [];
      for (const s of inner) {
        const x0 = Math.min(s.x1, s.x2);
        const x1 = Math.max(s.x1, s.x2);
        const z0 = Math.min(s.z1, s.z2);
        const z1 = Math.max(s.z1, s.z2);
        const w = 0.13;
        rail.push([worldBox(x0 - w, 0, z0 - w, x1 + w, 0.05, z1 + w), '#ffffff']);
        const gw = 0.028;
        glow.push([worldBox(x0 - gw, 0.05, z0 - gw, x1 + gw, 0.056, z1 + gw), '#ffffff']);
      }
      if (rail.length) {
        this.add(new THREE.Mesh(this.mine(bake(rail)), M.rail), { receive: true });
        this.add(new THREE.Mesh(this.mine(bake(glow)), zm.railGlow));
      }
    }
    const at = (p, y = 0) => ({ x: toX(p.x), y, z: toZ(p.y) });
    this.instanced(G.postBase, M.postBody, emitters.map((p) => at(p)), { cast: true, receive: true });
    this.instanced(G.postCap, zm.cap, emitters.map((p) => at(p)));
    this.instanced(G.studBase, M.postBody, studs.map((p) => at(p)), { cast: true });
    this.instanced(G.studCap, zm.cap, studs.map((p) => at(p)));
    this.instanced(G.node, zm.cap, nodes.map((p) => at(p, BORDER_BEAM_Y)));

    const ribbons = [];
    const beamGeo = (list, width) => {
      if (!list.length) return;
      const g = this.mine(ribbonGeometry(list, viewDir, width));
      ribbons.push(g);
      const mesh = new THREE.Mesh(g, zm.beam);
      mesh.frustumCulled = false;
      this.add(mesh, { order: 3 });
    };
    beamGeo(inner, 0.95);
    beamGeo(border, 0.95);
    // Crackle running up each emitter post; a lone post gets a taller, wider one.
    if (emitters.length) {
      const pts = emitters.map((p) => ({ x: toX(p.x) - viewDir.x * 0.18, z: toZ(p.y) - viewDir.z * 0.18, seed: p.c * 0.37 + p.r * 0.71 }));
      const g = this.mine(postRibbonGeometry(pts, viewDir, 0.85, 0.0, 0.8));
      const mesh = new THREE.Mesh(g, zm.beam);
      mesh.frustumCulled = false;
      this.add(mesh, { order: 3 });
    }

    // ---------------------------------------------------------------- pod gates
    if (geo.podPosts.length) {
      const segs = geo.podBeams.map((b) => ({ x1: toX(b.x1), z1: toZ(b.y1), x2: toX(b.x2), z2: toZ(b.y2), y: BEAM_Y }));
      this.instanced(G.podPost, M.podPost, geo.podPosts.map((p) => at(p)), { cast: true });
      this.instanced(G.podCap, M.podCap, geo.podPosts.map((p) => at(p)));
      if (segs.length) {
        const bar = this.mine(ribbonGeometry(segs, viewDir, 0.4));
        const glow = this.mine(ribbonGeometry(segs, viewDir, 0.75));
        const mb = new THREE.Mesh(bar, M.podBar);
        mb.frustumCulled = false;
        this.add(mb, { order: 2 });
        const mg = new THREE.Mesh(glow, M.podGlow);
        mg.frustumCulled = false;
        this.add(mg, { order: 3 });
      }
      this.podSpillMat = this.mine(new THREE.MeshBasicMaterial({
        map: this.mine(this.podSpillTexture()),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      const ps = new THREE.Mesh(G.flat, this.podSpillMat);
      ps.scale.set(SPILL.w, 1, SPILL.h);
      ps.position.set(toX(SPILL.x0 + SPILL.w / 2), 0.005, toZ(SPILL.y0 + SPILL.h / 2));
      this.add(ps, { order: 1 });
    }

    // ---------------------------------------------------------------- blocks and decor
    const kinds = { crate: [], barrel: [], terminal: [] };
    for (const b of geo.blocks) {
      const item = { x: toX(b.x), z: toZ(b.y) };
      if (b.kind === 'crate') item.ry = Math.floor(rnd() * 4) * (Math.PI / 2);
      if (b.kind === 'barrel') item.ry = rnd() * Math.PI * 2;
      kinds[b.kind].push(item);
    }
    this.instanced(G.crate, M.crate, kinds.crate, { cast: true, receive: true });
    this.instanced(G.barrel, M.barrel, kinds.barrel, { cast: true, receive: true });
    this.instanced(G.termBody, M.termBody, kinds.terminal, { cast: true, receive: true });
    this.instanced(G.termHood, M.bulk, kinds.terminal, { cast: true });
    this.instanced(G.screen, M.screen, kinds.terminal);
    const vents = [];
    const grates = [];
    for (const d of geo.decor) {
      const item = { x: toX(d.x), z: toZ(d.y), ry: Math.floor(rnd() * 4) * (Math.PI / 2) };
      (d.kind === 'vent' ? vents : grates).push(item);
    }
    this.instanced(G.decor, M.vent, vents, { receive: true });
    this.instanced(G.decor, M.grate, grates, { receive: true });

    // ---------------------------------------------------------------- locked doors
    for (const [side, lock] of Object.entries(room.locks)) {
      if (lock.open) continue;
      this.locks[side] = this.buildLock(side, lock.color, viewDir);
    }
  }

  // Machinery that closes the corridor slot on a side with no door. Cached on the kit.
  filler(side) {
    const kit = this.kit;
    kit.fillers ??= {};
    if (kit.fillers[side]) return kit.fillers[side];
    const rnd = mulberry(side.charCodeAt(0) * 31);
    const parts = [];
    const box = (x0, y0, x1, y1, h) => parts.push([worldBox(toX(x0), 0, toZ(y0), toX(x1), h, toZ(y1), 0.5), '#8a8f99', { light: 0.75 + rnd() * 0.4 }]);
    if (side === 'N' || side === 'S') {
      const y0 = side === 'N' ? -GZ : 14.8;
      const y1 = side === 'N' ? -1.8 : 13 + GZ;
      box(7.7, y0, 10.4, y1, 0.5 + rnd() * 0.8);
      box(10.6, y0, 13.3, y1, 0.4 + rnd() * 0.9);
    } else {
      const x0 = side === 'W' ? -GX : 22.8;
      const x1 = side === 'W' ? -1.8 : 21 + GX;
      box(x0, 3.7, x1, 6.4, 0.5 + rnd() * 0.8);
      box(x0, 6.6, x1, 9.3, 0.4 + rnd() * 0.9);
    }
    kit.fillers[side] = kit.keep(bake(parts));
    return kit.fillers[side];
  }

  buildLock(side, colorName, viewDir) {
    const kit = this.kit;
    const hex = KEY_COLORS[colorName]?.hex ?? '#ffffff';
    const d = DOOR[side];
    const g = new THREE.Group();
    const mat = this.mine(fieldMaterial(hex));
    const H = 1.0;
    const span = 3.3; // between the flank pillars
    const depth = LOCK_FACE - 0.04;
    // Front face (room side) and top face of the barrier volume.
    const front = new THREE.Mesh(kit.geo.quad, mat);
    front.scale.set(span, H, 1);
    front.position.set(0, H / 2, depth);
    const top = new THREE.Mesh(kit.geo.quad, mat);
    top.scale.set(span, depth + 0.1, 1);
    top.rotation.x = -Math.PI / 2;
    top.position.set(0, H, depth / 2 - 0.05);
    g.add(front, top);
    // Lock icon, turned to face the camera.
    const iconMat = this.mine(new THREE.MeshBasicMaterial({
      map: kit.tex.lock,
      color: new THREE.Color(hex).multiplyScalar(2.2),
      transparent: true,
      depthWrite: false,
    }));
    const icon = new THREE.Mesh(kit.geo.quad, iconMat);
    icon.scale.setScalar(0.62);
    // Floor glow in front of the barrier.
    const glowMat = this.mine(new THREE.MeshBasicMaterial({
      map: kit.tex.glow,
      color: new THREE.Color(hex).multiplyScalar(0.55),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    const glow = new THREE.Mesh(kit.geo.flat, glowMat);
    glow.scale.set(span + 1.4, 1, 2.4);
    glow.position.set(0, 0.006, depth + 0.3);
    g.add(glow);
    // The group's local +Z points into the room; place and turn it per side.
    const cx = toX(d.center.x);
    const cz = toZ(d.center.y);
    g.position.set(cx, 0, cz);
    g.rotation.y = { N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 }[side];
    front.renderOrder = top.renderOrder = 4;
    glow.renderOrder = 1;
    this.group.add(g);
    // The icon lives outside the turned group so it can face the camera.
    const inward = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }[side];
    icon.position.set(cx + inward[0] * (depth + 0.05), 0.62, cz + inward[1] * (depth + 0.05));
    icon.lookAt(icon.position.x - viewDir.x, icon.position.y - viewDir.y, icon.position.z - viewDir.z);
    icon.renderOrder = 5;
    this.group.add(icon);
    return { g, icon, mat, iconMat, glowMat, t: -1, done: false };
  }

  // ------------------------------------------------------------------ spill maps
  spillTexture(room) {
    const geo = this.geo;
    const [c, g, P, Q] = spillCanvas();
    const zoneHex = ZONES[this.zone]?.color ?? '#8f7bff';
    // A more saturated version of the sector color, so pools read as colored light.
    const zc = hexRgb(zoneHex);
    const lo = Math.min(...zc);
    for (let i = 0; i < 3; i++) zc[i] = Math.round(Math.min(255, (zc[i] - lo * 0.7) * 1.15));
    const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    const line = (x1, y1, x2, y2, rgb, k) => {
      const layers = [[0.9, 0.035], [0.42, 0.075], [0.16, 0.16]];
      for (const [w, a] of layers) {
        g.strokeStyle = rgba(rgb, a * k);
        g.lineWidth = w * SPILL.px;
        g.beginPath();
        g.moveTo(P(x1), Q(y1));
        g.lineTo(P(x2), Q(y2));
        g.stroke();
      }
    };
    const spot = (x, y, r, rgb, a) => {
      const gr = g.createRadialGradient(P(x), Q(y), 0, P(x), Q(y), r * SPILL.px);
      gr.addColorStop(0, rgba(rgb, a));
      gr.addColorStop(0.4, rgba(rgb, a * 0.45));
      gr.addColorStop(1, rgba(rgb, 0));
      g.fillStyle = gr;
      g.fillRect(P(x) - r * SPILL.px, Q(y) - r * SPILL.px, r * SPILL.px * 2, r * SPILL.px * 2);
    };
    g.lineCap = 'round';
    for (const b of geo.beams) {
      const onLine = (b.y1 === b.y2 && (b.y1 === 0.5 || b.y1 === 12.5)) || (b.x1 === b.x2 && (b.x1 === 0.5 || b.x1 === 20.5));
      line(b.x1, b.y1, b.x2, b.y2, zc, onLine ? 0.65 : 1);
    }
    for (const p of geo.posts) if (!isBorder(p)) spot(p.x, p.y, p.arms ? 0.8 : 1.0, zc, p.arms ? 0.07 : 0.2);
    const amber = [255, 160, 60];
    const red = [255, 40, 25];
    const green = [70, 255, 120];
    const ex = geo.exits;
    for (const x of ex.N ? [2.5, 5.5, 15.5, 18.5] : [2.5, 6.5, 10.5, 14.5, 18.5]) spot(x, 1.0, 1.7, amber, 0.07);
    for (const x of ex.S ? [2.5, 5.5, 15.5, 18.5] : [2.5, 6.5, 10.5, 14.5, 18.5]) spot(x, 12.1, 1.3, amber, 0.05);
    for (const y of ex.W ? [2.2, 10.8] : [2.2, 6.5, 10.8]) spot(1.0, y, 1.6, amber, 0.07);
    for (const y of ex.E ? [2.2, 10.8] : [2.2, 6.5, 10.8]) spot(20.0, y, 1.6, amber, 0.07);
    spot(0.9, 0.9, 1.6, amber, 0.07);
    spot(20.1, 0.9, 1.6, amber, 0.07);
    const doorSpots = {
      N: [[8.7, 0.9], [12.3, 0.9], [10.5, -0.6]],
      S: [[8.7, 12.1], [12.3, 12.1], [10.5, 13.6]],
      W: [[0.9, 4.7], [0.9, 8.3], [-0.6, 6.5]],
      E: [[20.1, 4.7], [20.1, 8.3], [21.6, 6.5]],
    };
    for (const s of Object.keys(ex)) for (const [x, y] of doorSpots[s]) spot(x, y, 1.5, red, 0.16);
    for (const b of geo.blocks) {
      if (b.kind === 'terminal') spot(b.x, b.y + 0.75, 1.2, green, 0.12);
      if (b.kind === 'crate') spot(b.x, b.y, 0.95, amber, 0.035);
    }
    for (const d of geo.decor) if (d.kind === 'grate') spot(d.x, d.y, 0.7, amber, 0.08);
    void room;
    return toTexture(c, { srgb: false });
  }

  podSpillTexture() {
    const [c, g, P, Q] = spillCanvas();
    g.lineCap = 'round';
    for (const b of this.geo.podBeams) {
      for (const [w, a] of [[0.9, 0.05], [0.4, 0.12], [0.16, 0.25]]) {
        g.strokeStyle = `rgba(255,190,30,${a})`;
        g.lineWidth = w * SPILL.px;
        g.beginPath();
        g.moveTo(P(b.x1), Q(b.y1));
        g.lineTo(P(b.x2), Q(b.y2));
        g.stroke();
      }
    }
    for (const p of this.geo.podPosts) {
      const gr = g.createRadialGradient(P(p.x), Q(p.y), 0, P(p.x), Q(p.y), 0.8 * SPILL.px);
      gr.addColorStop(0, 'rgba(255,190,30,0.15)');
      gr.addColorStop(1, 'rgba(255,190,30,0)');
      g.fillStyle = gr;
      g.fillRect(P(p.x) - SPILL.px, Q(p.y) - SPILL.px, SPILL.px * 2, SPILL.px * 2);
    }
    return toTexture(c, { srgb: false });
  }

  // ------------------------------------------------------------------ per frame
  // s: { time, dt, warn (0..1), podOn (0..1), spillGain }
  update(game, s) {
    this.time = s.time;
    const gain = s.spillGain;
    _c.setRGB(1, 1, 1);
    if (s.warn > 0) _c.lerp(WARN_TINT, s.warn * 0.6);
    this.spillMat.color.copy(_c).multiplyScalar(gain);
    if (this.podSpillMat) this.podSpillMat.color.setScalar(0.12 + 0.88 * s.podOn);
    const live = game && game.room.id === this.id ? game.room.locks : null;
    for (const side in this.locks) {
      const L = this.locks[side];
      if (L.done) continue;
      L.mat.uniforms.uTime.value = s.time;
      if (L.t < 0 && live && live[side] && live[side].open) L.t = 0;
      if (L.t >= 0) {
        L.t += s.dt;
        const k = Math.min(1, L.t / 0.6);
        L.mat.uniforms.uAlpha.value = (1 - k) * (1 + 2 * (1 - k) * k);
        L.g.scale.set(1, Math.max(0.001, 1 - k * k), 1);
        L.icon.scale.setScalar(0.62 * (1 + k * 0.7));
        L.iconMat.opacity = 1 - k;
        L.glowMat.opacity = 1 - k;
        if (k >= 1) {
          L.done = true;
          L.g.visible = false;
          L.icon.visible = false;
        }
      }
    }
  }

  // Where to put collapse sparks for a lock that just opened (world coords), or null.
  lockCenter(side) {
    const d = DOOR[side];
    if (!d) return null;
    const inward = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }[side];
    return { x: d.center.x + inward[0] * LOCK_FACE * 0.6, y: d.center.y + inward[1] * LOCK_FACE * 0.6, axis: d.axis };
  }

  dispose() {
    this.group.removeFromParent();
    for (const o of this.own) o.dispose?.();
    this.own.length = 0;
  }
}

const WARN_TINT = new THREE.Color(0.75, 0.35, 1.0);

// The spill map covers sim x -1..22, y -1..14 at 16 pixels per unit.
const SPILL = { x0: -1, y0: -1, w: 23, h: 15, px: 16 };

function spillCanvas() {
  const c = document.createElement('canvas');
  c.width = SPILL.w * SPILL.px;
  c.height = SPILL.h * SPILL.px;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'lighter';
  const P = (x) => (x - SPILL.x0) * SPILL.px;
  const Q = (y) => (y - SPILL.y0) * SPILL.px;
  return [c, g, P, Q];
}

void LEDGE_TOP;
