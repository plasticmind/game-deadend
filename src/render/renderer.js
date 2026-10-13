// Dead End's Three.js renderer. It only reads sim state (docs/DESIGN.md, "Renderer API"):
//
//   const r = new Renderer(canvas, { quality: 'auto', reducedMotion });
//   r.render(game, events, dtReal);   // every animation frame
//   r.resize();                       // reads the canvas's client size
//   r.setQuality('auto' | 'high' | 'medium' | 'low');
//   r.setReducedMotion(bool);
//   r.dispose();
//
// A fixed, steep perspective camera frames the whole room. The room scene is rebuilt
// when game.room.id or game.room.serial changes; on roomExit the old room slides out
// and the new one in (a cut with reduced motion).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { KEY_COLORS } from '../map.js';
import { Kit, FRAME_X, FRAME_Z, sectorColor, AMBER } from './kit.js';
import { RoomView } from './roomview.js';
import { Actors } from './actors.js';
import { Fx } from './fx.js';
import { approach, smooth, clamp01, toX, toZ } from './util.js';

const PITCH = THREE.MathUtils.degToRad(57);
const FOV = 30;
// Fit margins in NDC units (a 2-unit tall screen): sides, bottom, and extra room at the
// top for the HUD panel.
const MARGIN = { side: 0.035, bottom: 0.04, top: 0.1 };
// The box the camera fits: the room with its bulkhead and a little machinery.
const FIT = { x: 12.5, z0: -8.4, z1: 8.5, y: 1.3 };
// Mouse aiming reads the cursor on a plane at the height of the robots' bodies, so the
// point under the cursor is the robot you see there.
const AIM_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);

// Pixel budgets cap the drawing buffer. Within the budget the buffer may exceed the
// device pixel ratio (up to `ss` times it), which antialiases high and medium more
// cheaply than MSAA on a half-float target. Low renders straight to the canvas with the
// context's own MSAA and no environment map.
const TIERS = {
  high: { budget: 4.0e6, ss: 1.5, bloom: true, bloomScale: 0.55, shadows: true, shadowSize: 2048, soft: true, samples: 0, env: true },
  medium: { budget: 2.5e6, ss: 1.25, bloom: true, bloomScale: 0.45, shadows: true, shadowSize: 1024, soft: false, samples: 0, env: true },
  low: { budget: 1.2e6, ss: 1, bloom: false, bloomScale: 0, shadows: false, shadowSize: 512, soft: false, samples: 0, env: false },
};
const ORDER = ['high', 'medium', 'low'];

const SLIDE_TIME = 0.32;
const WARN_HZ = 1.0; // the Shadow warning pulse (at most 1.5 Hz)
const VIOLET = new THREE.Color(0.55, 0.3, 1.0);
const HEMI_SKY = new THREE.Color(0xe6ecff);
const KEY_INTENSITY = 3.0;
const HEMI_INTENSITY = 0.9;

const FOE_COLORS = {
  droid: new THREE.Color(1.6, 0.45, 0.3),
  drone: new THREE.Color(0.4, 1.4, 1.8),
  jumper: new THREE.Color(0.7, 1.6, 0.4),
  sniffer: new THREE.Color(1.1, 0.6, 1.8),
  warden: new THREE.Color(1.8, 0.8, 0.25),
};
const C = {
  shot: new THREE.Color(0.5, 0.9, 2.0),
  bolt: new THREE.Color(2.0, 0.7, 0.2),
  white: new THREE.Color(1.4, 1.4, 1.5),
  amber: new THREE.Color(1.6, 0.9, 0.3),
  pod: new THREE.Color(1.8, 1.3, 0.2),
  violet: new THREE.Color(1.0, 0.45, 1.8),
  gold: new THREE.Color(1.8, 1.3, 0.3),
  green: new THREE.Color(0.4, 1.8, 0.6),
  cyan: new THREE.Color(0.4, 1.5, 1.9),
  ice: new THREE.Color(0.8, 1.3, 1.8),
  dust: new THREE.Color(0.35, 0.33, 0.32),
  vanish: new THREE.Color(0.2, 0.08, 0.3),
  smear: new THREE.Color(0.16, 0.04, 0.26),
};

const VIGNETTE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const VIGNETTE_FRAG = /* glsl */ `
  uniform float uBase;
  uniform float uWarn;
  uniform vec3 uWarnColor;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p * vec2(0.8, 1.0));
    float v = smoothstep(0.55, 1.4, d);
    vec3 col = uWarnColor * 0.18 * uWarn;
    float a = v * (uBase + uWarn * 0.6);
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
  }
`;

export class Renderer {
  constructor(canvas, { quality = 'auto', reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.rm = !!reducedMotion;
    const gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    if (!gl.capabilities.isWebGL2) throw new Error('WebGL2 is required');
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.08;
    gl.setClearColor(0x07080c, 1);
    this.gl = gl;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080c);
    const pmrem = new THREE.PMREMGenerator(gl);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.28;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 2, 220);
    this.viewDir = new THREE.Vector3(0, -Math.sin(PITCH), -Math.cos(PITCH));
    this.camBase = new THREE.Vector3(0, 30, 20);
    this.camOffset = new THREE.Vector3();
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(0, 0, 0);
    this.camQuat = this.camera.quaternion.clone();

    // Lights: warm key with shadows, hemisphere, and a sector-tinted fill.
    this.hemi = new THREE.HemisphereLight(HEMI_SKY, 0x2a2233, HEMI_INTENSITY);
    this.key = new THREE.DirectionalLight(0xffd4a0, KEY_INTENSITY);
    this.key.position.set(7, 15, -5);
    this.key.target.position.set(0, 0, 0);
    const sc = this.key.shadow.camera;
    sc.left = -15;
    sc.right = 15;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 2;
    sc.far = 40;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.025;
    this.fill = new THREE.DirectionalLight(0x8f7bff, 0.55);
    this.fill.position.set(-9, 7, 10);
    this.scene.add(this.hemi, this.key, this.key.target, this.fill);

    this.vignette = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { uBase: { value: 0.32 }, uWarn: { value: 0 }, uWarnColor: { value: VIOLET.clone() } },
        vertexShader: VIGNETTE_VERT,
        fragmentShader: VIGNETTE_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.vignette.frustumCulled = false;
    this.vignette.renderOrder = 1000;
    this.scene.add(this.vignette);

    this.kit = new Kit(gl);
    this.ground = new THREE.Mesh(this.kit.ground, this.kit.mat.ground);
    this.ground.position.y = -0.02;
    this.ground.receiveShadow = false;
    this.scene.add(this.ground);
    this.actors = new Actors(this.kit, this.scene);
    this.fx = new Fx(this.kit, this.scene);

    this.view = null; // current RoomView
    this.oldView = null; // the room sliding out
    this.roomId = -1;
    this.serial = -1;
    this.slide = null;
    this.time = 0;
    this.warn = 0; // 0..1 ramp while the Shadow is coming
    this.warnT = 0;
    this.warnOn = false;
    this.podOn = 1;
    this.clearT = -1;
    this.shake = 0;
    this.shakeT = 0;
    this.compiled = false;
    this.amberBase = this.kit.mat.amber.color.clone();
    this.sectorFill = new THREE.Color();
    this._c = new THREE.Color();
    this._ao = { dt: 0, time: 0, rm: false };
    this._ws = { time: 0, dt: 0, warn: 0, podOn: 1, spillGain: 1 };

    this.quality = 'auto';
    this.tier = 'high';
    this.perf = { t: -1, sum: 0, n: 0, since: 0 };
    this.size = { w: 0, h: 0, pr: 1 };
    this.composer = null;
    this.setQuality(quality);
  }

  // ------------------------------------------------------------------ public API
  setQuality(q) {
    this.quality = ORDER.includes(q) ? q : 'auto';
    this.applyTier(this.quality === 'auto' ? 'high' : this.quality);
  }

  setReducedMotion(on) {
    this.rm = !!on;
    if (this.rm) {
      this.shake = 0;
      if (this.slide) this.endSlide();
    }
  }

  resize() {
    const c = this.canvas;
    const w = Math.max(1, c.clientWidth || c.width || 1);
    const h = Math.max(1, c.clientHeight || c.height || 1);
    const T = TIERS[this.tier];
    const dpr = window.devicePixelRatio || 1;
    // Cap the drawing buffer by a pixel budget rather than trusting devicePixelRatio.
    const pr = Math.max(0.5, Math.min(dpr * T.ss, Math.sqrt(T.budget / (w * h))));
    this.size = { w, h, pr };
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitCamera();
    // Particle sizes are in world units; convert with the projection scale.
    this.fx.setScale(h * pr * 0.5 * this.camera.projectionMatrix.elements[5]);
  }

  render(game, events, dtReal) {
    if (!game || !game.room) return;
    const c = this.canvas;
    if (c.clientWidth !== this.size.w || c.clientHeight !== this.size.h) this.resize();
    const dt = Math.min(0.1, Math.max(0, dtReal || 0));
    this.time += dt;
    this.autoQuality(dtReal);

    this.syncRoom(game, events);
    this.handleEvents(game, events);
    this.updateWorld(game, dt);
    const ao = this._ao;
    ao.dt = dt;
    ao.time = this.time;
    ao.rm = this.rm;
    // Precompiling shows every actor and then hides them all, so it must come before
    // this frame's actor update, or the frame draws without Shamus and the item.
    if (!this.compiled) this.precompile();
    this.actors.update(game, ao);
    this.fx.update(dt, this.time);
    this.updateCamera(dt);

    if (this.composer) this.composer.render(dt);
    else this.gl.render(this.scene, this.camera);
  }

  // The room point (in cells) under a screen point (client pixels), for mouse aiming.
  // It uses the camera as last drawn, so it stays right during slides and shakes.
  screenToRoom(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const pick = (this._pick ||= { ndc: new THREE.Vector2(), ray: new THREE.Raycaster(), hit: new THREE.Vector3() });
    pick.ndc.set(((clientX - r.left) / r.width) * 2 - 1, 1 - ((clientY - r.top) / r.height) * 2);
    pick.ray.setFromCamera(pick.ndc, this.camera);
    if (!pick.ray.ray.intersectPlane(AIM_PLANE, pick.hit)) return null;
    // toX and toZ in reverse.
    return { x: pick.hit.x + 10.5, y: pick.hit.z + 6.5 };
  }

  dispose() {
    this.view?.dispose();
    this.oldView?.dispose();
    this.view = this.oldView = null;
    this.actors.dispose();
    this.fx.dispose();
    this.kit.dispose();
    this.ground.removeFromParent();
    this.vignette.geometry.dispose();
    this.vignette.material.dispose();
    this.envTex.dispose();
    this.disposeComposer();
    this.gl.dispose();
  }

  // ------------------------------------------------------------------ quality
  applyTier(tier) {
    this.tier = tier;
    const T = TIERS[tier];
    const gl = this.gl;
    gl.shadowMap.enabled = T.shadows;
    gl.shadowMap.type = T.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.key.castShadow = T.shadows;
    this.scene.environment = T.env ? this.envTex : null;
    this.hemi.userData.boost = T.env ? 1 : 1.25;
    if (this.key.shadow.mapSize.x !== T.shadowSize) {
      this.key.shadow.mapSize.set(T.shadowSize, T.shadowSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.disposeComposer();
    if (T.bloom) {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: T.samples });
      const composer = new EffectComposer(gl, target);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.32, 0.9);
      const setSize = bloom.setSize.bind(bloom);
      bloom.setSize = (w, h) => setSize(Math.max(8, Math.round(w * T.bloomScale)), Math.max(8, Math.round(h * T.bloomScale)));
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.bloom = bloom;
    }
    // Shadow and light changes need new shader programs.
    this.scene.traverse((o) => {
      if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true;
    });
    this.compiled = false;
    this.perf = { t: -1, sum: 0, n: 0, since: 0 };
    this.size.w = -1;
    this.resize();
  }

  disposeComposer() {
    if (!this.composer) return;
    for (const p of this.composer.passes) p.dispose?.();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer = null;
    this.bloom = null;
  }

  // 'auto' starts high and steps down when frames stay slow for two seconds.
  autoQuality(dtReal) {
    if (this.quality !== 'auto') return;
    const P = this.perf;
    if (!(dtReal > 0) || dtReal > 0.25) return; // hidden tab or a one-off hitch
    P.since += dtReal;
    P.t += dtReal;
    if (P.t < 0) return; // settle after a change
    P.sum += dtReal;
    P.n++;
    if (P.t < 2) return;
    const avg = P.sum / P.n;
    P.t = 0;
    P.sum = 0;
    P.n = 0;
    const i = ORDER.indexOf(this.tier);
    if (avg > 1 / 50 && i < ORDER.length - 1 && P.since > 3) this.applyTier(ORDER[i + 1]);
  }

  precompile() {
    this.actors.showAll(true);
    try {
      this.gl.compile(this.scene, this.camera);
    } finally {
      this.actors.showAll(false);
      this.actors.itemKey = '!';
    }
    this.compiled = true;
  }

  // ------------------------------------------------------------------ camera
  fitCamera() {
    const cam = this.camera;
    cam.quaternion.copy(this.camQuat);
    const sp = Math.sin(PITCH);
    const cp = Math.cos(PITCH);
    const pts = [];
    for (const x of [-FIT.x, FIT.x]) for (const z of [FIT.z0, FIT.z1]) for (const y of [0, FIT.y]) pts.push(new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    let tz = 0;
    let dist = 40;
    const place = (d) => {
      cam.position.set(0, d * sp, tz + d * cp);
      cam.updateMatrixWorld(true);
    };
    const ext = () => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of pts) {
        v.copy(p).project(cam);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
      return { x0, x1, y0, y1 };
    };
    const want = (1 - MARGIN.top + (-1 + MARGIN.bottom)) / 2;
    for (let iter = 0; iter < 4; iter++) {
      let lo = 4;
      let hi = 300;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        place(mid);
        const e = ext();
        const fits = e.x1 <= 1 - MARGIN.side && e.x0 >= -1 + MARGIN.side && e.y1 - e.y0 <= 2 - MARGIN.top - MARGIN.bottom;
        if (fits) hi = mid;
        else lo = mid;
      }
      dist = hi;
      place(dist);
      const e = ext();
      const center = (e.y0 + e.y1) / 2;
      const visH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      tz -= ((center - want) * (visH / 2)) / sp;
    }
    place(dist);
    this.camBase.copy(cam.position);
  }

  updateCamera(dt) {
    const cam = this.camera;
    cam.position.copy(this.camBase).add(this.camOffset);
    if (this.shake > 0 && !this.rm) {
      this.shakeT += dt;
      const s = this.shake;
      cam.position.x += Math.sin(this.shakeT * 53) * s;
      cam.position.z += Math.cos(this.shakeT * 47) * s;
      this.shake = Math.max(0, s - dt * 0.5);
    }
    if (this.slide) {
      const S = this.slide;
      S.t += dt;
      const k = smooth(S.t / SLIDE_TIME);
      cam.position.x += S.ox * (1 - k);
      cam.position.z += S.oz * (1 - k);
      if (S.t >= SLIDE_TIME) this.endSlide();
    }
  }

  endSlide() {
    this.slide = null;
    if (this.oldView) {
      this.oldView.dispose();
      this.oldView = null;
    }
  }

  // ------------------------------------------------------------------ rooms
  syncRoom(game, events) {
    const room = game.room;
    if (room.id === this.roomId && room.serial === this.serial) return;
    let exitSide = null;
    for (let i = 0; i < events.length; i++) if (events[i].type === 'roomExit') exitSide = events[i].side;
    const sameRoom = room.id === this.roomId && this.view;
    this.serial = room.serial;
    this.fx.clear();
    this.actors.reset();
    this.warnOn = false;
    this.warn = 0;
    this.clearT = -1;
    this.perf.t = Math.min(this.perf.t, -0.5);
    if (sameRoom && !exitSide) {
      // A respawn: same layout. Rebuild only if a lock changed underneath us.
      const v = this.view;
      let stale = false;
      for (const side in room.locks) if (!room.locks[side].open !== !!(v.locks[side] && !v.locks[side].done)) stale = true;
      if (!stale) return;
    }
    if (this.slide) this.endSlide();
    const old = this.view;
    this.view = new RoomView(this.kit, room, this.viewDir);
    this.scene.add(this.view.group);
    this.roomId = room.id;
    const fill = sectorColor(room.zone);
    this.sectorFill.copy(fill);
    this.fill.color.copy(fill);
    if (!old) return;
    if (exitSide && !this.rm) {
      const dir = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[exitSide];
      const ox = -dir[0] * FRAME_X;
      const oz = -dir[1] * FRAME_Z;
      old.group.position.set(ox, 0, oz);
      this.oldView = old;
      this.slide = { t: 0, ox, oz };
    } else {
      old.dispose();
    }
  }

  updateWorld(game, dt) {
    const room = game.room;
    const kit = this.kit;
    // Beams shimmer on their own clock.
    for (let z = 1; z <= 4; z++) kit.zone[z].beam.uniforms.uTime.value = this.time;
    // Pod gates fade on and off over about a tenth of a second.
    this.podOn = approach(this.podOn, room.podOn ? 1 : 0, 28, dt);
    kit.mat.podBar.uniforms.uTime.value = this.time;
    kit.mat.podBar.uniforms.uOn.value = this.podOn;
    kit.mat.podGlow.uniforms.uTime.value = this.time;
    kit.mat.podGlow.uniforms.uIntensity.value = 0.04 + 0.4 * this.podOn;
    kit.mat.podCap.color.setRGB(1.0, 0.75, 0.1).multiplyScalar(0.5 + 1.8 * this.podOn);

    // The Shadow's warning: a slow violet pulse in the light and a vignette, from the
    // warning until the room changes.
    if (room.warned || game.shadow) this.warnOn = true;
    this.warn = approach(this.warn, this.warnOn ? 1 : 0, 1.2, dt);
    if (this.warn > 0.001) this.warnT += dt;
    else this.warnT = 0;
    const hz = this.rm ? WARN_HZ * 0.5 : WARN_HZ;
    const pulse = 0.5 - 0.5 * Math.cos(this.warnT * Math.PI * 2 * hz);
    const w = this.warn * (0.35 + 0.65 * pulse);
    this.hemi.color.copy(HEMI_SKY).lerp(VIOLET, 0.5 * w);
    this.hemi.intensity = HEMI_INTENSITY * (this.hemi.userData.boost ?? 1) * (1 - 0.22 * w);
    this.key.intensity = KEY_INTENSITY * (1 - 0.3 * w);
    this.fill.color.copy(this.sectorFill).lerp(VIOLET, w);
    this.fill.intensity = 0.55 + 1.1 * w;
    this.vignette.material.uniforms.uWarn.value = w;

    // Room-clear flourish: the amber lamps swell once and settle.
    let amber = 1;
    if (this.clearT >= 0) {
      this.clearT += dt;
      const k = clamp01(this.clearT / 1.4);
      amber = 1 + 1.4 * Math.sin(k * Math.PI);
      if (k >= 1) this.clearT = -1;
    }
    kit.mat.amber.color.copy(this.amberBase).multiplyScalar(amber);

    // The lair Shadow's charge leaves a violet smear.
    const sh = game.shadow;
    if (sh && sh.state === 'charge' && (sh.vx || sh.vy) && !this.rm) {
      this.fx.puff(sh.x, sh.y, 0.5 + Math.random() * 1.2, 2, { color: C.smear, size: 0.8, life: 0.45, a: 0.5, spread: 0.25, rise: 0.1 });
    }

    const s = this._ws;
    s.time = this.time;
    s.dt = dt;
    s.warn = w;
    s.podOn = this.podOn;
    this.view?.update(game, s);
    this.oldView?.update(null, s);
  }

  // ------------------------------------------------------------------ events
  handleEvents(game, events) {
    const fx = this.fx;
    const room = game.room;
    const zoneColor = this._c.copy(this.kit.zone[room.zone].color).multiplyScalar(1.6);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'fire': {
          const a = e.dx !== undefined ? Math.atan2(e.dy, e.dx) : (e.face * Math.PI) / 4;
          const x = e.x + Math.cos(a) * 0.55;
          const y = e.y + Math.sin(a) * 0.55;
          fx.flash(x, y, 0.55, C.shot, 0.6, 0.12, false);
          break;
        }
        case 'boltFire':
          fx.flash(e.x, e.y, 0.45, C.bolt, 0.55, 0.14, false);
          break;
        case 'shotHit': {
          const col = e.what === 'wall' ? zoneColor
            : e.what === 'block' ? C.amber
            : e.what === 'pod' ? C.pod
            : e.what === 'shadow' ? C.violet
            : e.what === 'lock' ? this.lockColor(room)
            : C.white;
          fx.impact(e.x, e.y, col);
          break;
        }
        case 'foeHit':
          this.actors.flinch(e.x, e.y);
          fx.impact(e.x, e.y, C.white);
          fx.spray(e.x, e.y, 0.4, 10, FOE_COLORS[e.foe] ?? C.white, { speed: 2.6, life: 0.5, size: 0.1 });
          break;
        case 'foeDie':
          fx.explosion(e.x, e.y, FOE_COLORS[e.foe] ?? C.amber, e.chain ? 0.85 : 1);
          if (!this.rm) this.kick(0.05);
          break;
        case 'boltHit':
          if (e.what !== 'fizzle') fx.impact(e.x, e.y, e.what === 'shield' ? C.cyan : e.what === 'freeze' ? C.ice : C.bolt);
          break;
        case 'foeHop':
          fx.puff(e.x, e.y, 0.05, 3, { color: C.dust, size: 0.35, life: 0.6, a: 0.35, spread: 0.2, rise: 0.2 });
          break;
        case 'roomClear':
          this.clearT = 0;
          fx.ring(game.player.x, game.player.y, C.gold, { r1: 6, dur: 1.3, w: 0.05, a: 0.8 });
          fx.sparkle(game.player.x, game.player.y, C.gold, 26, 0.6);
          break;
        case 'playerDie': {
          const col = e.cause === 'wall' ? zoneColor
            : e.cause === 'pod' ? C.pod
            : e.cause === 'bolt' ? C.bolt
            : e.cause === 'shadow' ? C.violet
            : C.white;
          fx.flash(e.x, e.y, 0.55, col, 2.4, 0.4);
          fx.spray(e.x, e.y, 0.5, 34, col, { speed: 3.5, up: 3.5, life: 0.9, size: 0.12 });
          fx.puff(e.x, e.y, 0.4, 6, { size: 0.7 });
          this.kick(0.14);
          break;
        }
        case 'respawn':
          fx.sparkle(game.player.x, game.player.y, C.cyan, 24, 0.5);
          break;
        case 'pickup': {
          const col = e.kind === 'key' ? this.keyCol(e.color) : e.kind === 'life' ? C.green : C.gold;
          fx.sparkle(e.x, e.y, col, 28, 0.55);
          break;
        }
        case 'mystery':
          if (e.outcome === 'freeze') {
            fx.ring(e.x, e.y, C.ice, { r1: 8, dur: 1.0, w: 0.04, a: 0.9 });
            fx.sparkle(e.x, e.y, C.ice, 30, 0.6);
          } else if (e.outcome === 'shield') fx.sparkle(e.x, e.y, C.cyan, 30, 0.6);
          else if (e.outcome === 'life') fx.sparkle(e.x, e.y, C.green, 30, 0.6);
          break;
        case 'extraLife':
          fx.sparkle(game.player.x, game.player.y, C.green, 18, 0.7);
          break;
        case 'keyUse':
          fx.sparkle(e.x, e.y, this.keyCol(e.color), 30, 0.85);
          break;
        case 'doorOpen': {
          const c = this.view?.lockCenter(e.side);
          if (c) fx.barrier(c.x, c.y, c.axis, this.keyCol(e.color));
          break;
        }
        case 'doorLocked':
          if (game.item) fx.ring(game.item.x, game.item.y, this.keyCol(e.color), { r1: 1.0, dur: 0.6, w: 0.08, a: 0.8 });
          break;
        case 'shadowWarn':
          this.warnOn = true;
          break;
        case 'shadowEnter':
          fx.ripple(e.x, e.y);
          break;
        case 'shadowBlink':
          if (e.fromX !== undefined) fx.ripple(e.fromX, e.fromY);
          fx.ripple(e.x, e.y);
          break;
        case 'shadowStun':
          fx.impact(e.x, e.y, C.violet);
          fx.ring(e.x, e.y, C.violet, { r1: 1.2, dur: 0.5, w: 0.08, a: 0.8 });
          break;
        case 'shadowHurt':
          fx.flash(e.x, e.y, 1.2, C.violet, 1.6, 0.3);
          fx.spray(e.x, e.y, 1.0, 20, C.violet, { speed: 3, up: 2, life: 0.7 });
          break;
        case 'shadowDefeat':
          fx.explosion(e.x, e.y, C.violet, 2);
          fx.ripple(e.x, e.y);
          this.kick(0.12);
          break;
        case 'itemsVanish':
          if (game.item) fx.puff(game.item.x, game.item.y, 0.4, 8, { color: C.vanish, size: 0.6, life: 1.0, a: 0.6 });
          break;
        case 'win':
          fx.sparkle(game.player.x, game.player.y, C.gold, 40, 0.8);
          fx.ring(game.player.x, game.player.y, C.gold, { r1: 8, dur: 1.6, w: 0.05, a: 0.9 });
          break;
        default:
          break;
      }
    }
  }

  kick(s) {
    if (this.rm) return;
    this.shake = Math.max(this.shake, s);
    this.shakeT = 0;
  }

  keyCol(name) {
    return this._k.set(KEY_COLORS[name]?.hex ?? '#ffffff').multiplyScalar(1.5);
  }

  lockColor(room) {
    for (const side in room.locks) if (!room.locks[side].open) return this.keyCol(room.locks[side].color);
    return C.white;
  }

  get _k() {
    this.__k ??= new THREE.Color();
    return this.__k;
  }
}

// Exported for dev pages.
export { TIERS, toX, toZ, AMBER };
