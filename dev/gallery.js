// Renderer gallery: a real game from the sim, plus (in showcase mode) one of every actor
// injected into the state so every mesh and effect can be seen and screenshotted.
//
// URL parameters:
//   room=<id>        start room (default 0)
//   mode=show|live   show: injected actors (default); live: the real sim with cheats on
//   q=auto|high|medium|low   quality
//   rm=1             reduced motion
//   shadow=enter|chase|stunned|dying   show the Shadow in that state
//   warn=1           the Shadow warning pulse
//   freeze=1         robots frozen
//   shield=1         Shamus shielded
//   item=key:blue | keyhole:green | mystery | life | none
//   pose=walk|aim|idle|dying   Shamus pose (default walk)
//   hud=1            outline the HUD panel area
//   info=0           hide the info panel
//
// Keys: arrows/WASD move, Space fire (live mode), N/P next/previous room (cut),
// D go through a door (slide), 1-9 and 0 fire effects, Q cycle quality, M reduced
// motion, F switch show/live, I cycle item, H cycle Shadow state, W toggle warning.

import { createGame, stepGame, enterRoom, killPlayer, DT } from '../src/sim/game.js';
import { ROOMS, OPPOSITE } from '../src/map.js';
import { Renderer } from '../src/render/renderer.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const info = document.getElementById('info');
if (params.get('info') === '0') info.classList.add('hidden');
if (params.get('hud') === '1') document.getElementById('hudbox').hidden = false;

const state = {
  mode: params.get('mode') || 'show',
  quality: params.get('q') || 'auto',
  rm: params.get('rm') === '1',
  shadow: params.get('shadow') || '',
  warn: params.get('warn') === '1',
  freeze: params.get('freeze') === '1',
  shield: params.get('shield') === '1',
  item: params.get('item') || '',
  pose: params.get('pose') || 'walk',
};

let game = makeGame(Number(params.get('room') || 0));
const renderer = new Renderer(canvas, { quality: state.quality, reducedMotion: state.rm });
renderer.resize();
window.addEventListener('resize', () => renderer.resize());

function makeGame(room) {
  const g = createGame({ seed: 7, cheats: { invuln: true, noShadow: true, noFoes: state.mode === 'show' } });
  if (room) enterRoom(g, room, null);
  return g;
}

// ---------------------------------------------------------------- input
const held = new Set();
const pending = [];
window.addEventListener('keydown', (e) => {
  held.add(e.key);
  const k = e.key.toLowerCase();
  if (k === 'n') goRoom((game.room.id + 1) % 128);
  if (k === 'p') goRoom((game.room.id + 127) % 128);
  if (k === 'd') goDoor();
  if (k === 'q') {
    const order = ['auto', 'high', 'medium', 'low'];
    state.quality = order[(order.indexOf(state.quality) + 1) % order.length];
    renderer.setQuality(state.quality);
  }
  if (k === 'm') {
    state.rm = !state.rm;
    renderer.setReducedMotion(state.rm);
  }
  if (k === 'f') {
    state.mode = state.mode === 'show' ? 'live' : 'show';
    game.cheats.noFoes = state.mode === 'show';
    enterRoom(game, game.room.id, null);
  }
  if (k === 'i') {
    const order = ['key:blue', 'keyhole:green', 'mystery', 'life', 'key:cyan', 'keyhole:purple', 'none', ''];
    state.item = order[(order.indexOf(state.item) + 1) % order.length];
  }
  if (k === 'h') {
    const order = ['', 'enter', 'chase', 'stunned', 'dying'];
    state.shadow = order[(order.indexOf(state.shadow) + 1) % order.length];
    if (state.shadow === 'enter') fire('shadowEnter', { x: 10.5, y: 2 });
  }
  if (k === 'w') state.warn = !state.warn;
  if (k >= '0' && k <= '9') effect(k);
  if (e.key === ' ') e.preventDefault();
});
window.addEventListener('keyup', (e) => held.delete(e.key));

function input() {
  const h = (...ks) => ks.some((k) => held.has(k));
  return {
    x: (h('ArrowRight', 'd', 'D') ? 1 : 0) - (h('ArrowLeft', 'a', 'A') ? 1 : 0),
    y: (h('ArrowDown', 's', 'S') ? 1 : 0) - (h('ArrowUp', 'w', 'W') && state.mode === 'live' ? 1 : 0),
    fire: h(' '),
  };
}

function fire(type, data = {}) {
  pending.push({ type, ...data });
}

function goRoom(id) {
  enterRoom(game, id, null);
}

function goDoor() {
  const sides = Object.keys(game.room.geo.exits);
  if (!sides.length) return;
  const side = sides[Math.floor(Math.random() * sides.length)];
  const to = ROOMS[game.room.id].exits[side];
  fire('roomExit', { side, to });
  enterRoom(game, to, OPPOSITE[side]);
}

function effect(k) {
  const p = game.player;
  const foes = game.foes;
  const any = foes[0] || { x: 13.5, y: 2.5, type: 'droid' };
  switch (k) {
    case '1': fire('foeDie', { x: any.x, y: any.y, foe: any.type, points: 50, chain: false, by: 'shot' }); break;
    case '2': fire('pickup', { kind: 'key', color: 'blue', x: p.x + 1, y: p.y }); break;
    case '3': state.warn = true; fire('shadowWarn'); break;
    case '4': state.shadow = 'enter'; fire('shadowEnter', { x: 10.5, y: 2 }); break;
    case '5': fire('roomClear', { points: 150 }); break;
    case '6': state.freeze = !state.freeze; if (state.freeze) fire('mystery', { outcome: 'freeze', points: 0, x: p.x, y: p.y }); break;
    case '7': {
      for (const side in game.room.locks) {
        game.room.locks[side].open = true;
        fire('doorOpen', { side, color: game.room.locks[side].color });
      }
      break;
    }
    case '8': if (game.mode === 'play') killPlayer(game, 'wall'); break;
    case '9': state.shield = !state.shield; break;
    case '0': p.invulnT = 3; break;
    default: break;
  }
}

// ---------------------------------------------------------------- showcase actors
// Shapes follow docs/DESIGN.md. Positions suit room 0 but work anywhere open enough.
const T0 = performance.now();
function inject(g, t) {
  const foes = g.foes;
  foes.length = 0;
  // Droid: walks a row, pausing and aiming.
  const dph = (t * 0.35) % 2;
  const dx = dph < 1 ? 12.5 + dph * 4 : 16.5 - (dph - 1) * 4;
  const dstate = (t % 4) < 1 ? 'aim' : 'walk';
  foes.push({ id: 9001, type: 'droid', x: dstate === 'aim' ? 14.5 : dx, y: 2.5, face: dstate === 'aim' ? 2 : dph < 1 ? 0 : 4, state: dstate, t: t % 1, hp: 1 });
  // Drone: whirls in a circle.
  const a = t * 2.2;
  foes.push({ id: 9002, type: 'drone', x: 18 + Math.cos(a) * 1.0, y: 4.2 + Math.sin(a) * 1.0, face: 0, state: 'whirl', t, hp: 1 });
  // Jumper: crouch, hop, land, back and forth.
  const jc = t % 2.4;
  let jx = 12.5;
  let js = 'crouch';
  let jt = jc;
  const dirJ = Math.floor(t / 2.4) % 2 === 0;
  const from = dirJ ? 12.5 : 15.5;
  const to = dirJ ? 15.5 : 12.5;
  if (jc < 1.2) { js = 'crouch'; jx = from; jt = jc; }
  else if (jc < 1.6) { js = 'hop'; jt = jc - 1.2; jx = from + (to - from) * ((jc - 1.2) / 0.4); }
  else { js = 'land'; jx = to; jt = jc - 1.6; }
  foes.push({ id: 9003, type: 'jumper', x: jx, y: 10.5, face: to > from ? 0 : 4, state: js, t: jt, dur: js === 'hop' ? 0.4 : 0.6, hp: 1 });
  // Sniffer: trots around a rectangle.
  const per = 14;
  const s = (t * 1.6) % per;
  let sx, sy, sf;
  if (s < 4) { sx = 7.5 + s; sy = 4.5; sf = 0; }
  else if (s < 7) { sx = 11.5; sy = 4.5 + (s - 4); sf = 2; }
  else if (s < 11) { sx = 11.5 - (s - 7); sy = 7.5; sf = 4; }
  else { sx = 7.5; sy = 7.5 - (s - 11); sf = 6; }
  foes.push({ id: 9004, type: 'sniffer', x: sx, y: sy, face: sf, state: 'track', t, hp: (t % 10) < 5 ? 2 : 1 });
  // Warden: turns and fires bursts.
  const wf = Math.floor(t / 1.2) % 8;
  foes.push({ id: 9005, type: 'warden', x: 17.5, y: 10.5, face: wf, state: (t % 1.2) > 0.8 ? 'burst' : 'scan', t: t % 1.2, hp: 1 });

  // Shots fly from Shamus; bolts from the droid and warden.
  g.shots.length = 0;
  const p = g.player;
  for (let i = 0; i < 2; i++) {
    const k = ((t * 1.3 + i * 0.5) % 1);
    const ang = ((p.face ?? 0) * Math.PI) / 4;
    g.shots.push({ id: 9100 + i + Math.floor(t * 1.3 + i * 0.5) * 10, x: p.x + Math.cos(ang) * (0.6 + k * 6), y: p.y + Math.sin(ang) * (0.6 + k * 6), dx: Math.cos(ang), dy: Math.sin(ang), t: k });
  }
  g.bolts.length = 0;
  const bk = (t * 0.9) % 1;
  g.bolts.push({ id: 9200 + Math.floor(t * 0.9), x: 14.5, y: 3 + bk * 7, vx: 0, vy: 6, t: bk, from: 'droid' });
  const wa = (wf * Math.PI) / 4;
  const wk = (t * 1.5) % 1;
  g.bolts.push({ id: 9300 + Math.floor(t * 1.5), x: 17.5 + Math.cos(wa) * (0.6 + wk * 4), y: 10.5 + Math.sin(wa) * (0.6 + wk * 4), vx: Math.cos(wa) * 8, vy: Math.sin(wa) * 8, t: wk, from: 'warden' });
}

function applyOverrides(g, t) {
  const p = g.player;
  if (state.mode === 'show') {
    inject(g, t);
    // Shamus walks a small loop unless keys move him.
    if (!held.size && g.mode === 'play') {
      const fixed = g.room.id === 0;
      if (state.pose === 'walk' && fixed) {
        const a = t * 0.9;
        const nx = 8.6 + Math.cos(a) * 1.0;
        const ny = 6.5 + Math.sin(a) * 1.0;
        const dx = nx - p.x;
        const dy = ny - p.y;
        p.walk += Math.hypot(dx, dy);
        p.face = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
        p.x = nx;
        p.y = ny;
        p.moving = true;
        p.aiming = false;
      } else if (state.pose === 'aim') {
        p.moving = false;
        p.aiming = true;
        p.face = 0;
      } else {
        p.moving = false;
        p.aiming = false;
      }
    }
  }
  if (state.pose === 'dying' && g.mode === 'play') killPlayer(g, 'wall');
  p.shieldT = state.shield ? 5 : Math.min(p.shieldT, 0);
  g.freezeT = state.freeze ? 3 : 0;
  if (state.warn) g.room.warned = true;
  // Shadow.
  if (state.shadow) {
    const sh = g.shadow && g.shadow.fake ? g.shadow : (g.shadow = { fake: true, x: 10.5, y: 2.2, state: 'enter', t: 0, stunT: 0, hp: null });
    if (sh.state !== state.shadow) { sh.state = state.shadow; sh.t = 0; }
    sh.t += DT;
    if (sh.state === 'chase') {
      const dx = p.x - sh.x;
      const dy = p.y - sh.y;
      const d = Math.hypot(dx, dy);
      if (d > 2) { sh.x += (dx / d) * 0.8 * DT; sh.y += (dy / d) * 0.8 * DT; }
    }
  } else if (g.shadow && g.shadow.fake) g.shadow = null;
  // Item.
  if (state.item) {
    if (state.item === 'none') g.item = null;
    else {
      const [kind, color] = state.item.split(':');
      const spot = g.room.geo.itemSpot || g.room.geo.keyholeSpot || { x: 13.5, y: 6.5 };
      g.item = { kind, color: color || null, x: spot.x, y: spot.y, hidden: false, used: false };
    }
  }
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let acc = 0;
const frameEvents = [];
const perf = { dts: [], cpu: [], gpu: [], n: 0 };
window.__perf = perf;

// GPU time per frame from a timer query (one in flight at a time).
const glc = renderer.gl.getContext();
const tq = glc.getExtension('EXT_disjoint_timer_query_webgl2');
let query = null;
let queryOpen = false;
function gpuBegin() {
  if (!tq || query) return;
  query = glc.createQuery();
  glc.beginQuery(tq.TIME_ELAPSED_EXT, query);
  queryOpen = true;
}
function gpuEnd() {
  if (queryOpen) glc.endQuery(tq.TIME_ELAPSED_EXT);
  queryOpen = false;
}
function gpuPoll() {
  if (!query || queryOpen) return;
  if (!glc.getQueryParameter(query, glc.QUERY_RESULT_AVAILABLE)) return;
  if (!glc.getParameter(tq.GPU_DISJOINT_EXT)) perf.gpu.push(glc.getQueryParameter(query, glc.QUERY_RESULT) / 1e6);
  if (perf.gpu.length > 300) perf.gpu.shift();
  glc.deleteQuery(query);
  query = null;
}

function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;
  let steps = 0;
  const t = (now - T0) / 1000;
  while (acc >= DT && steps < 5) {
    const inp = input();
    if (state.mode === 'show') {
      game.foes.length = 0;
      game.shots.length = 0;
      game.bolts.length = 0;
      if (game.shadow && game.shadow.fake) game.shadow = null;
    }
    const keepShadow = state.shadow;
    stepGame(game, state.mode === 'show' && !held.size ? { x: 0, y: 0, fire: false } : inp);
    frameEvents.push(...game.events);
    applyOverrides(game, t);
    void keepShadow;
    acc -= DT;
    steps++;
  }
  if (steps === 5) acc = 0;
  if (game.mode === 'gameover') game = makeGame(game.room.id);
  frameEvents.push(...pending);
  pending.length = 0;
  gpuPoll();
  gpuBegin();
  const c0 = performance.now();
  renderer.render(game, frameEvents, dt);
  const c1 = performance.now();
  gpuEnd();
  frameEvents.length = 0;
  perf.dts.push(dt * 1000);
  perf.cpu.push(c1 - c0);
  if (perf.dts.length > 600) { perf.dts.shift(); perf.cpu.shift(); }
  perf.n++;
  if (perf.n % 20 === 0) showInfo();
  requestAnimationFrame(frame);
}

function avg(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

function showInfo() {
  const r = renderer;
  const g = r.gl;
  info.textContent =
    `room ${game.room.id} (zone ${game.room.zone})  mode ${state.mode}\n` +
    `quality ${state.quality} -> tier ${r.tier}  rm ${state.rm}\n` +
    `buffer ${g.domElement.width}x${g.domElement.height} (${((g.domElement.width * g.domElement.height) / 1e6).toFixed(2)} MP)\n` +
    `frame ${avg(perf.dts.slice(-120)).toFixed(1)} ms  cpu ${avg(perf.cpu.slice(-120)).toFixed(2)} ms  gpu ${avg(perf.gpu.slice(-60)).toFixed(2)} ms  calls ${g.info.render.calls}  tris ${g.info.render.triangles}\n` +
    `N/P room  D door  Q quality  M motion  F show/live  I item  H shadow  W warn\n` +
    `1 boom 2 pickup 3 warn 4 shadow 5 clear 6 freeze 7 door 8 die 9 shield 0 invuln`;
}

// Hooks for Playwright.
window.dev = {
  renderer,
  get game() { return game; },
  state,
  fire,
  effect,
  room(id, side = null) {
    if (side) {
      const from = game.room.id;
      fire('roomExit', { side: OPPOSITE[side], to: id });
      void from;
    }
    enterRoom(game, id, side);
  },
  door: goDoor,
  perf() {
    const d = perf.dts.slice(-180);
    const c = perf.cpu.slice(-180);
    const sorted = [...d].sort((x, y) => x - y);
    const gp = perf.gpu.slice(-90);
    return { frame: avg(d), p95: sorted[Math.floor(sorted.length * 0.95)] || 0, cpu: avg(c), gpu: avg(gp), gpuMax: Math.max(0, ...gp), tier: renderer.tier, calls: renderer.gl.info.render.calls, tris: renderer.gl.info.render.triangles, buffer: [renderer.gl.domElement.width, renderer.gl.domElement.height] };
  },
};

requestAnimationFrame(frame);
