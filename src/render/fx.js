// Effects driven by sim events: sparks, smoke, bright bursts, floor rings, and scorch
// marks. Fixed-size pools allocated up front; nothing here allocates per frame.
//
// Flash safety: a burst is one smooth rise and fall, and at most three big bursts start
// in any one second. Extra bursts in a chain reaction still get their sparks and smoke.

import * as THREE from 'three';
import { toX, toZ } from './util.js';

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(240.0, aSize * uScale / -mv.z);
    vColor = aColor;
    vAlpha = aAlpha;
  }
`;
const SPARK_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.0, 1.0, d);
    a = a * a;
    gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const SMOKE_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.3, 1.0, d);
    gl_FragColor = vec4(vColor, a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uR;
  uniform float uW;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float q = (d - uR) / uW;
    float a = exp(-q * q) * uAlpha;
    a *= 1.0 - smoothstep(0.92, 1.0, d);
    gl_FragColor = vec4(uColor * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class Particles {
  constructor(max, frag, blending) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    // Simulation state.
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.hot = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.attrs = [this.aPos, this.aCol, this.aSize, this.aAlpha];
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }

  // x, y, z world; v velocity; life seconds; size start/end (world units); color rgb.
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a0 = 1, grav = 0, drag = 0, hot = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.c0[i3] = r; this.c0[i3 + 1] = g; this.c0[i3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.a0[i] = a0;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.hot[i] = hot;
  }

  copy(from, to) {
    const f3 = from * 3;
    const t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.c0[t3 + k] = this.c0[f3 + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
    this.a0[to] = this.a0[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
    this.hot[to] = this.hot[from];
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.n--;
        if (i !== this.n) this.copy(this.n, i);
        continue;
      }
      const i3 = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02) {
        this.pos[i3 + 1] = 0.02;
        this.vel[i3 + 1] *= -0.35;
        this.vel[i3] *= 0.6;
        this.vel[i3 + 2] *= 0.6;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.alpha[i] = this.a0[i] * fade;
      // Hot particles start white and cool toward their color.
      const h = this.hot[i] * (1 - t) * (1 - t);
      this.col[i3] = this.c0[i3] + (1.6 - this.c0[i3]) * h;
      this.col[i3 + 1] = this.c0[i3 + 1] + (1.6 - this.c0[i3 + 1]) * h;
      this.col[i3 + 2] = this.c0[i3 + 2] + (1.6 - this.c0[i3 + 2]) * h;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    if (this.n) {
      for (const a of this.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  clear() {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// Chunks of a barrel thrown by its blast: staves, hoops, and a lid. Instanced, a fixed
// pool, simple physics (gravity, a bounce, then they settle flat and shrink away).
const _dq = new THREE.Quaternion();
const _dm = new THREE.Matrix4();
const _dp = new THREE.Vector3();
const _ds = new THREE.Vector3();
const _dx = new THREE.Vector3(1, 0, 0);
const _dy = new THREE.Vector3(0, 1, 0);

class Debris {
  constructor(root) {
    const stave = new THREE.BoxGeometry(0.11, 0.46, 0.035);
    const hoop = new THREE.TorusGeometry(0.3, 0.022, 4, 18);
    const lid = new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16);
    const red = new THREE.MeshStandardMaterial({ color: 0xa8342b, roughness: 0.55, metalness: 0.3 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3c4048, roughness: 0.4, metalness: 0.8 });
    // thin: which local axis is thinnest, so a resting piece lies flat on it.
    this.kinds = [
      { geo: stave, mat: red, max: 72, thin: 'z', half: 0.02 },
      { geo: hoop, mat: steel, max: 24, thin: 'z', half: 0.024 },
      { geo: lid, mat: red, max: 10, thin: 'y', half: 0.022 },
    ];
    this.geos = [stave, hoop, lid];
    this.mats = [red, steel];
    for (const k of this.kinds) {
      const im = new THREE.InstancedMesh(k.geo, k.mat, k.max);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < k.max; i++) im.setColorAt(i, new THREE.Color(1, 1, 1));
      im.count = 0;
      im.visible = false;
      im.frustumCulled = false;
      im.castShadow = true;
      root.add(im);
      k.im = im;
      k.n = 0;
      k.p = [];
      for (let i = 0; i < k.max; i++) {
        k.p.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), flat: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), spin: 0, life: 0, max: 1, rest: false });
      }
    }
  }

  // kind 0 stave, 1 hoop, 2 lid. World position and velocity; char 0..1 darkens it.
  spawn(kind, X, Y, Z, vx, vy, vz, spin, life, char, rnd) {
    const k = this.kinds[kind];
    if (k.n >= k.max) return;
    const i = k.n++;
    const d = k.p[i];
    d.pos.set(X, Y, Z);
    d.vel.set(vx, vy, vz);
    d.axis.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    d.spin = spin;
    d.q.setFromAxisAngle(d.axis, rnd() * Math.PI * 2);
    // Lying flat: the thin axis up, any heading.
    d.flat.setFromAxisAngle(_dy, rnd() * Math.PI * 2);
    if (k.thin === 'z') d.flat.multiply(_dq.setFromAxisAngle(_dx, -Math.PI / 2));
    d.life = life;
    d.max = life;
    d.rest = false;
    const c = 1 - 0.7 * char;
    k.im.setColorAt(i, _c3.setRGB(c, c * 0.95, c * 0.95));
    k.im.instanceColor.needsUpdate = true;
    k.im.visible = true;
  }

  update(dt) {
    const g = 11;
    for (const k of this.kinds) {
      let i = 0;
      while (i < k.n) {
        const d = k.p[i];
        d.life -= dt;
        if (d.life <= 0) {
          k.n--;
          if (i !== k.n) {
            const last = k.p[k.n];
            k.p[k.n] = d;
            k.p[i] = last;
            const col = k.im.instanceColor;
            for (let c = 0; c < 3; c++) col.array[i * 3 + c] = col.array[k.n * 3 + c];
            col.needsUpdate = true;
          }
          continue;
        }
        if (!d.rest) {
          d.vel.y -= g * dt;
          d.pos.addScaledVector(d.vel, dt);
          // Stay inside the room's walls.
          if (d.pos.x < -10 || d.pos.x > 10) { d.pos.x = Math.max(-10, Math.min(10, d.pos.x)); d.vel.x *= -0.4; }
          if (d.pos.z < -6 || d.pos.z > 6) { d.pos.z = Math.max(-6, Math.min(6, d.pos.z)); d.vel.z *= -0.4; }
          d.q.multiply(_dq.setFromAxisAngle(d.axis, d.spin * dt));
          if (d.pos.y < k.half) {
            d.pos.y = k.half;
            d.vel.y *= -0.32;
            d.vel.x *= 0.55;
            d.vel.z *= 0.55;
            d.spin *= 0.5;
            if (Math.abs(d.vel.y) < 0.6 && d.vel.x * d.vel.x + d.vel.z * d.vel.z < 0.3) d.rest = true;
          }
        } else {
          d.q.slerp(d.flat, 1 - Math.exp(-10 * dt));
        }
        const fade = Math.min(1, d.life / 0.5);
        _ds.setScalar(fade);
        _dm.compose(d.pos, d.q, _ds);
        k.im.setMatrixAt(i, _dm);
        i++;
      }
      k.im.count = k.n;
      k.im.visible = k.n > 0;
      if (k.n) k.im.instanceMatrix.needsUpdate = true;
    }
  }

  showAll(on) {
    for (const k of this.kinds) {
      k.im.visible = on || k.n > 0;
      k.im.count = on ? Math.max(1, k.n) : k.n;
    }
  }

  clear() {
    for (const k of this.kinds) {
      k.n = 0;
      k.im.count = 0;
      k.im.visible = false;
    }
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const k of this.kinds) k.im.dispose();
  }
}
const _c3 = new THREE.Color();

export class Fx {
  constructor(kit, scene) {
    this.kit = kit;
    this.root = new THREE.Group();
    this.root.name = 'fx';
    scene.add(this.root);
    this.time = 0;
    this.rm = false; // reduced motion: the renderer keeps this in step
    this.sparks = new Particles(900, SPARK_FRAG, THREE.AdditiveBlending);
    this.smoke = new Particles(220, SMOKE_FRAG, THREE.NormalBlending);
    this.sparks.points.renderOrder = 10;
    this.smoke.points.renderOrder = 9;
    this.root.add(this.smoke.points, this.sparks.points);

    // Bright bursts (camera-facing sprites).
    this.flashes = [];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.SpriteMaterial({ map: kit.tex.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 11;
      this.root.add(s);
      this.flashes.push({ s, m, t: 0, dur: 0, size: 1, color: new THREE.Color() });
    }
    this.flashTimes = [-9, -9, -9];

    // Rings on the floor: additive (light) and normal (dark ripple).
    this.rings = [];
    for (let i = 0; i < 12; i++) {
      const dark = i >= 8;
      const m = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uR: { value: 0 }, uW: { value: 0.08 }, uAlpha: { value: 0 } },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        blending: dark ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(kit.geo.flat, m);
      mesh.visible = false;
      mesh.renderOrder = dark ? 3 : 4;
      this.root.add(mesh);
      this.rings.push({ mesh, m, t: 1, dur: 1, r0: 0, r1: 1, dark, a: 1 });
    }

    // Scorch marks.
    this.scorches = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.MeshBasicMaterial({ map: kit.tex.scorch, transparent: true, depthWrite: false, opacity: 0 });
      const mesh = new THREE.Mesh(kit.geo.flat, m);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.root.add(mesh);
      this.scorches.push({ mesh, m, t: 9, dur: 9 });
    }
    this.scorchNext = 0;
    this.rand = 1;

    this.debris = new Debris(this.root);

    // Emitters keep a puff going for a while after an event (a barrel's smoke plume).
    this.emitters = [];
    for (let i = 0; i < 8; i++) this.emitters.push({ on: false, x: 0, y: 0, t: 0, dur: 0, rate: 0, acc: 0 });

    // A console's uplink hologram: a little map unfolding above the screen, and the
    // projector beam under it.
    this.holos = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.SpriteMaterial({ map: kit.tex.holo, color: HOLO.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const s = new THREE.Sprite(m);
      const bm = new THREE.SpriteMaterial({ map: kit.tex.glow, color: HOLO.clone().multiplyScalar(0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const beam = new THREE.Sprite(bm);
      s.visible = beam.visible = false;
      s.renderOrder = beam.renderOrder = 11;
      this.root.add(s, beam);
      this.holos.push({ s, m, beam, bm, t: 0, on: false });
    }
  }

  // Deterministic jitter (the sim's RNG is not ours to use, and Math.random is fine
  // here, but a tiny LCG keeps effects reproducible for screenshots).
  rnd() {
    this.rand = (this.rand * 1664525 + 1013904223) >>> 0;
    return this.rand / 4294967296;
  }

  setScale(px) {
    this.sparks.mat.uniforms.uScale.value = px;
    this.smoke.mat.uniforms.uScale.value = px;
  }

  // ------------------------------------------------------------------ primitives
  spray(x, y, h, n, color, { speed = 3, up = 2, life = 0.6, size = 0.12, grav = 6, drag = 1.5, hot = 0.8 } = {}) {
    const X = toX(x);
    const Z = toZ(y);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const s = speed * (0.35 + this.rnd() * 0.65);
      this.sparks.spawn(
        X, h, Z,
        Math.cos(a) * s, up * (0.3 + this.rnd()), Math.sin(a) * s,
        life * (0.6 + this.rnd() * 0.6), size, size * 0.4,
        color.r, color.g, color.b, 1, grav, drag, hot,
      );
    }
  }

  puff(x, y, h, n, { color = SMOKE, size = 0.5, life = 1.4, a = 0.55, spread = 0.3, rise = 0.6 } = {}) {
    const X = toX(x);
    const Z = toZ(y);
    for (let i = 0; i < n; i++) {
      const ang = this.rnd() * Math.PI * 2;
      const d = this.rnd() * spread;
      this.smoke.spawn(
        X + Math.cos(ang) * d, h + this.rnd() * 0.2, Z + Math.sin(ang) * d,
        Math.cos(ang) * 0.4, rise * (0.5 + this.rnd()), Math.sin(ang) * 0.4,
        life * (0.7 + this.rnd() * 0.5), size * 0.5, size * (1.2 + this.rnd() * 0.6),
        color.r, color.g, color.b, a, -0.2, 1.2, 0,
      );
    }
  }

  flash(x, y, h, color, size = 1.6, dur = 0.28, big = true) {
    if (big) {
      // At most three big bursts start in any one second.
      const oldest = Math.min(...this.flashTimes);
      if (this.time - oldest < 1) return;
      this.flashTimes[this.flashTimes.indexOf(oldest)] = this.time;
    }
    let f = this.flashes[0];
    for (const c of this.flashes) if (c.t >= c.dur) { f = c; break; }
    f.t = 0;
    f.dur = dur;
    f.size = size;
    f.color.copy(color);
    f.s.position.set(toX(x), h, toZ(y));
    f.s.visible = true;
  }

  ring(x, y, color, { r1 = 2, dur = 0.7, w = 0.06, a = 1, dark = false, h = 0.02 } = {}) {
    let r = null;
    for (const c of this.rings) if (c.dark === dark && c.t >= c.dur) { r = c; break; }
    if (!r) return;
    r.t = 0;
    r.dur = dur;
    r.r1 = r1;
    r.a = a;
    r.m.uniforms.uColor.value.copy(color);
    r.m.uniforms.uW.value = w;
    // The ring's leading edge stops at uR = 0.88 of the quad's half width, so this
    // scale lands it exactly on r1 (a barrel's shockwave shows the blast radius).
    r.mesh.scale.set(r1 / 0.44, 1, r1 / 0.44);
    r.mesh.position.set(toX(x), h, toZ(y));
    r.mesh.visible = true;
  }

  scorch(x, y, size = 1.4) {
    const s = this.scorches[this.scorchNext];
    this.scorchNext = (this.scorchNext + 1) % this.scorches.length;
    s.t = 0;
    s.mesh.position.set(toX(x), 0.007, toZ(y));
    s.mesh.scale.set(size, 1, size);
    s.mesh.rotation.y = this.rnd() * Math.PI * 2;
    s.mesh.visible = true;
  }

  // ------------------------------------------------------------------ composites
  explosion(x, y, color, big = 1) {
    this.flash(x, y, 0.45, color, 2.0 * big, 0.32);
    this.spray(x, y, 0.4, Math.round(26 * big), color, { speed: 4.2 * big, up: 3, life: 0.7, size: 0.13 });
    this.spray(x, y, 0.4, Math.round(10 * big), WHITE_HOT, { speed: 2.4, up: 4, life: 0.4, size: 0.09, hot: 1 });
    this.puff(x, y, 0.35, Math.round(7 * big), { size: 0.75 * big });
    this.ring(x, y, color, { r1: 1.5 * big, dur: 0.45, w: 0.1, a: 0.8 });
    this.scorch(x, y, 1.3 * big);
  }

  impact(x, y, color) {
    this.flash(x, y, 0.45, color, 0.55, 0.14, false);
    this.spray(x, y, 0.45, 7, color, { speed: 2.4, up: 1.5, life: 0.35, size: 0.08 });
  }

  sparkle(x, y, color, n = 22, h = 0.55) {
    const X = toX(x);
    const Z = toZ(y);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = 0.15 + this.rnd() * 0.35;
      this.sparks.spawn(
        X + Math.cos(a) * r, h - 0.3 + this.rnd() * 0.6, Z + Math.sin(a) * r,
        Math.cos(a) * 0.6, 1.2 + this.rnd() * 1.6, Math.sin(a) * 0.6,
        0.6 + this.rnd() * 0.6, 0.12, 0.02,
        color.r, color.g, color.b, 1, -0.5, 1.5, 0.5,
      );
    }
    this.ring(x, y, color, { r1: 1.1, dur: 0.6, w: 0.08, a: 0.9 });
  }

  // A barrier collapsing along a door: sparks spread across its span.
  barrier(x, y, axis, color) {
    for (let i = 0; i < 24; i++) {
      const o = (this.rnd() - 0.5) * 3.2;
      const px = axis === 'x' ? x + o : x;
      const py = axis === 'x' ? y : y + o;
      this.sparks.spawn(
        toX(px), 0.2 + this.rnd() * 0.8, toZ(py),
        (this.rnd() - 0.5) * 1.5, -0.5 - this.rnd(), (this.rnd() - 0.5) * 1.5,
        0.5 + this.rnd() * 0.5, 0.13, 0.03,
        color.r, color.g, color.b, 1, 4, 1, 0.6,
      );
    }
    this.flash(x, y, 0.5, color, 2.4, 0.4);
  }

  // The Shadow arriving: a dark ripple and violet smoke.
  ripple(x, y) {
    this.ring(x, y, DARK_VIOLET, { r1: 2.4, dur: 1.2, w: 0.16, a: 0.85, dark: true });
    this.ring(x, y, VIOLET, { r1: 1.8, dur: 0.9, w: 0.05, a: 0.6 });
    this.puff(x, y, 0.3, 10, { color: SHADOW_SMOKE, size: 0.9, life: 1.6, a: 0.6, spread: 0.5, rise: 0.4 });
  }

  // A barrel going up: a short white-hot core, a rolling fireball, sparks and embers, a
  // shockwave ring out to the blast radius, a dark soot ring, staves and hoops flying, a
  // smoke plume that keeps rising, and a scorch mark. The bright part lasts about a
  // fifth of a second and stays local; big bursts are limited to three a second.
  barrel(x, y, radius) {
    const X = toX(x);
    const Z = toZ(y);
    this.flash(x, y, 0.7, FIRE_CORE, 2.1, 0.2, true);
    // The fireball: orange billows that start yellow and roll up and out. Kept below
    // white so overlapping billows still read as fire, not a flash.
    for (let i = 0; i < 24; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = this.rnd() * 0.3;
      const s = 0.9 + this.rnd() * 2.2;
      this.sparks.spawn(
        X + Math.cos(a) * r, 0.3 + this.rnd() * 0.5, Z + Math.sin(a) * r,
        Math.cos(a) * s, 1.0 + this.rnd() * 2.4, Math.sin(a) * s,
        0.32 + this.rnd() * 0.32, 0.85 + this.rnd() * 0.45, 1.4 + this.rnd() * 0.6,
        FIRE.r, FIRE.g * (0.75 + this.rnd() * 0.5), FIRE.b, 0.72, -1.5, 3.0, 0.4,
      );
    }
    this.spray(x, y, 0.5, 40, SPARK_HOT, { speed: 6, up: 4, life: 0.8, size: 0.09, grav: 10, drag: 1.2, hot: 0.6 });
    for (let i = 0; i < 18; i++) {
      const a = this.rnd() * Math.PI * 2;
      const s = 0.5 + this.rnd() * 1.6;
      this.sparks.spawn(X, 0.6, Z, Math.cos(a) * s, 1.6 + this.rnd() * 1.6, Math.sin(a) * s, 1.2 + this.rnd() * 1.0, 0.07, 0.03, EMBER.r, EMBER.g, EMBER.b, 1, -0.6, 1.8, 0.4);
    }
    this.ring(x, y, SHOCK, { r1: radius, dur: 0.42, w: 0.07, a: 1 });
    this.ring(x, y, SOOT, { r1: radius * 0.85, dur: 1.4, w: 0.18, a: 0.55, dark: true });
    this.puff(x, y, 0.4, 10, { color: SMOKE_DARK, size: 1.1, life: 2.2, a: 0.6, spread: 0.6, rise: 1.0 });
    this.emit(x, y, 1.8, 8);
    this.scorch(x, y, 2.8);
    // Debris: a ring of staves, a couple of hoops, the lid.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + this.rnd() * 0.4;
      const s = 1.8 + this.rnd() * 2.4;
      this.debris.spawn(0, X + Math.cos(a) * 0.25, 0.4 + this.rnd() * 0.3, Z + Math.sin(a) * 0.25, Math.cos(a) * s, 3 + this.rnd() * 3, Math.sin(a) * s, 6 + this.rnd() * 10, 3.5 + this.rnd() * 2.5, this.rnd(), () => this.rnd());
    }
    for (let i = 0; i < 2; i++) {
      const a = this.rnd() * Math.PI * 2;
      this.debris.spawn(1, X, 0.3 + i * 0.4, Z, Math.cos(a) * 1.8, 4 + this.rnd() * 2, Math.sin(a) * 1.8, 5 + this.rnd() * 6, 4 + this.rnd() * 2, 0.4, () => this.rnd());
    }
    this.debris.spawn(2, X, 0.8, Z, (this.rnd() - 0.5) * 2, 7 + this.rnd() * 2, (this.rnd() - 0.5) * 2, 7, 4.5, 0.5, () => this.rnd());
  }

  // Keep a smoke plume rising from (x, y) for `dur` seconds at `rate` puffs a second.
  emit(x, y, dur, rate) {
    const e = this.emitters.find((m) => !m.on) ?? this.emitters[0];
    e.on = true;
    e.x = x;
    e.y = y;
    e.t = 0;
    e.dur = dur;
    e.rate = rate;
    e.acc = 0;
  }

  // Steam off the ION-SHIV (sim position, world height).
  steam(x, y, h, n = 1) {
    this.puff(x, y, h, n, { color: STEAM, size: 0.32, life: 0.9, a: 0.45, spread: 0.05, rise: 1.4 });
  }

  // A console's uplink: the hologram map unfolds above it.
  holo(x, y) {
    const H = this.holos.find((m) => !m.on) ?? this.holos[0];
    H.on = true;
    H.t = 0;
    H.x = toX(x);
    H.z = toZ(y);
    H.s.visible = H.beam.visible = true;
  }

  // A console's screen shattering: glass glints, sparks, and smoke.
  glass(x, y) {
    this.spray(x, y + 0.2, 0.7, 18, GLASS, { speed: 2.6, up: 3, life: 0.7, size: 0.07, grav: 11, hot: 0.2 });
    this.spray(x, y + 0.2, 0.7, 14, SPARK_HOT, { speed: 3.4, up: 2.5, life: 0.5, size: 0.08, grav: 9, hot: 1 });
    this.flash(x, y + 0.2, 0.7, GLASS, 0.9, 0.16, false);
    this.puff(x, y + 0.1, 0.7, 5, { color: SMOKE_DARK, size: 0.6, life: 1.4, a: 0.5, spread: 0.2, rise: 0.8 });
  }

  // For the renderer's precompile pass: every pooled mesh visible, so its shaders exist
  // before the first explosion needs them.
  showAll(on) {
    this.debris.showAll(on);
    for (const H of this.holos) H.s.visible = H.beam.visible = on || H.on;
    for (const r of this.rings) r.mesh.visible = on || r.t < r.dur;
    for (const sc of this.scorches) sc.mesh.visible = on || sc.t < sc.dur;
    for (const f of this.flashes) f.s.visible = on || f.t < f.dur;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, time) {
    this.time = time;
    for (const e of this.emitters) {
      if (!e.on) continue;
      e.t += dt;
      if (e.t >= e.dur) {
        e.on = false;
        continue;
      }
      e.acc += dt * e.rate * (1 - e.t / e.dur);
      while (e.acc >= 1) {
        e.acc -= 1;
        this.puff(e.x, e.y, 0.6, 1, { color: SMOKE_DARK, size: 1.3, life: 3.0, a: 0.45, spread: 0.35, rise: 1.1 });
      }
    }
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    for (const H of this.holos) {
      if (!H.on) continue;
      H.t += dt;
      const t = H.t;
      if (t >= 2.0) {
        H.on = false;
        H.s.visible = H.beam.visible = false;
        continue;
      }
      // Unfold over a quarter second, hold, fade; a gentle shimmer, never a blink.
      const open = smooth01(t / 0.25);
      const a = open * (1 - smooth01((t - 1.35) / 0.65));
      const shimmer = this.rm ? 1 : 0.9 + 0.1 * Math.sin(t * 8.0);
      H.m.color.copy(HOLO).multiplyScalar(1.3 * a * shimmer);
      H.bm.color.copy(HOLO).multiplyScalar(0.55 * a);
      // High enough to clear Shamus's hat while he stands at the console.
      H.s.scale.set(2.3, 1.55 * Math.max(0.05, open), 1);
      H.s.position.set(H.x, 2.2 + 0.15 * open, H.z - 0.3);
      H.beam.scale.set(0.55, 1.7, 1);
      H.beam.position.set(H.x, 1.35, H.z - 0.15);
    }
    for (const f of this.flashes) {
      if (!f.s.visible) continue;
      f.t += dt;
      if (f.t >= f.dur) {
        f.s.visible = false;
        continue;
      }
      const k = f.t / f.dur;
      // One smooth rise and fall.
      const a = Math.sin(Math.min(1, k * 2.2) * Math.PI * 0.5) * (1 - k) * (1 - k);
      f.m.color.copy(f.color).multiplyScalar(a * 1.6);
      f.s.scale.setScalar(f.size * (0.5 + k * 0.8));
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      if (r.t >= r.dur) {
        r.mesh.visible = false;
        continue;
      }
      const k = r.t / r.dur;
      const e = 1 - (1 - k) * (1 - k);
      r.m.uniforms.uR.value = 0.08 + e * 0.8;
      r.m.uniforms.uAlpha.value = r.a * (1 - k);
    }
    for (const s of this.scorches) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      if (s.t >= s.dur) {
        s.mesh.visible = false;
        continue;
      }
      const k = s.t / s.dur;
      s.m.opacity = 0.85 * (k < 0.05 ? k / 0.05 : 1 - Math.max(0, (k - 0.4) / 0.6));
    }
  }

  clear() {
    this.sparks.clear();
    this.smoke.clear();
    this.debris.clear();
    for (const e of this.emitters) e.on = false;
    for (const H of this.holos) { H.on = false; H.s.visible = H.beam.visible = false; }
    for (const f of this.flashes) { f.s.visible = false; f.t = f.dur = 0; }
    for (const r of this.rings) { r.mesh.visible = false; r.t = r.dur = 1; }
    for (const s of this.scorches) {
      s.mesh.visible = false;
      s.t = s.dur;
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.sparks.dispose();
    this.smoke.dispose();
    for (const f of this.flashes) f.m.dispose();
    for (const r of this.rings) r.m.dispose();
    for (const s of this.scorches) s.m.dispose();
    for (const H of this.holos) { H.m.dispose(); H.bm.dispose(); }
    this.debris.dispose();
  }
}

const SMOKE = new THREE.Color(0.16, 0.15, 0.16);
const SMOKE_DARK = new THREE.Color(0.1, 0.09, 0.09);
const STEAM = new THREE.Color(0.62, 0.64, 0.68);
const FIRE = new THREE.Color(1.9, 0.62, 0.09);
const FIRE_CORE = new THREE.Color(1.6, 0.95, 0.35);
const SPARK_HOT = new THREE.Color(1.9, 1.15, 0.35);
const EMBER = new THREE.Color(1.8, 0.55, 0.12);
const SHOCK = new THREE.Color(2.0, 1.2, 0.5);
const SOOT = new THREE.Color(0.04, 0.03, 0.03);
const GLASS = new THREE.Color(1.1, 1.6, 1.8);
const HOLO = new THREE.Color(0.35, 1.5, 2.0);
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const SHADOW_SMOKE = new THREE.Color(0.12, 0.05, 0.2);
const WHITE_HOT = new THREE.Color(1.5, 1.3, 0.9);
const VIOLET = new THREE.Color(0.7, 0.3, 1.2);
const DARK_VIOLET = new THREE.Color(0.06, 0.0, 0.12);
