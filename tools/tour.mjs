#!/usr/bin/env node
// Autopilot: play the real sim with real inputs (no teleporting) along the winning
// route, from room 0 to the Shadow's lair, and beat him there by shooting.
//
//   node tools/tour.mjs               the winning route (every key and keyhole on the way)
//   node tools/tour.mjs --all         visit all 128 rooms, then win the lair
//   node tools/tour.mjs --seed 7 --skill 2 --verbose
//   node tools/tour.mjs --show 12     print room 12 with the planner's walkable points
//
// Robots and the Shadow are off (cheats noFoes and noShadow) until the lair, where the
// Shadow comes back for the fight. The pilot plans on a 0.25-unit grid of points where
// Shamus's body clears every wall (the same rule tools/check-rooms.mjs uses), follows
// the path with 8-direction inputs, never takes a step that would touch a wall, and
// waits for pod gates. It prints one line per room and exits non-zero on any failure,
// naming the room, the target, and the player's position.

import { pathToFileURL } from 'node:url';
import { ROOMS, LOCKS, LAIR_ROOM, lockOn } from '../src/map.js';
import { getRoom } from '../src/rooms/index.js';
import { W, H, CELL, WALL_HALF, DOOR, LOCK_FACE, wallDistance, blockAt, lineClear } from '../src/room.js';
import { createGame, stepGame, enterRoom, previewMove, DT } from '../src/sim/game.js';
import { PLAYER } from '../src/sim/tuning.js';
import { UNIT, DIRS } from '../src/sim/core.js';

// ------------------------------------------------------------------ the planning grid

const STEP = 0.25;
const NX = Math.round(W / STEP) + 1;
const NY = Math.round(H / STEP) + 1;
const BODY = PLAYER.wallRadius + 0.08; // plan with this much body (check-rooms does too)
const LETHAL = WALL_HALF + PLAYER.wallRadius;
const STEP_MARGIN = 0.03; // the pilot never steps closer than LETHAL + this to a wall
const POD_ZONE = LETHAL + 0.14; // points this close to a gate need it to be off

const navCache = new Map();

// The walkable points of the current room, given which locks are open.
export function navFor(game) {
  const room = game.room;
  const geo = room.geo;
  let key = `${geo.id}`;
  for (const side in room.locks) key += room.locks[side].open ? side.toLowerCase() : side;
  const hit = navCache.get(key);
  if (hit && hit.geo === geo) return hit;
  const n = NX * NY;
  const safe = new Uint8Array(n);
  const cost = new Float32Array(n);
  const pod = new Uint8Array(n);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const x = i * STEP;
      const y = j * STEP;
      const k = j * NX + i;
      if (x < 0.25 || y < 0.25 || x > W - 0.25 || y > H - 0.25) continue;
      const wd = wallDistance(geo, x, y, CELL.WALL) - WALL_HALF;
      if (wd < BODY) continue;
      if (blockAt(geo, x, y, PLAYER.radius + 0.04)) continue;
      if (inLock(room, x, y)) continue;
      safe[k] = 1;
      // Prefer the middle of corridors: extra cost near walls and blocks.
      let c = 0;
      if (wd < 0.55) c += 1.2;
      else if (wd < 0.8) c += 0.4;
      if (blockAt(geo, x, y, PLAYER.radius + 0.25)) c += 0.5;
      if (geo.podPosts.length && wallDistance(geo, x, y, CELL.POD) < POD_ZONE) {
        pod[k] = 1;
        c += 0.6;
      }
      cost[k] = c;
    }
  }
  const nav = { geo, key, safe, cost, pod };
  navCache.set(key, nav);
  return nav;
}

// Shamus's center can't get this far into a closed lock's doorway.
function inLock(room, x, y) {
  for (const side in room.locks) {
    const lock = room.locks[side];
    if (lock.open) continue;
    const d = DOOR[side];
    const a = d.axis === 'x' ? x : y;
    if (a <= d.min - 0.2 || a >= d.max + 0.2) continue;
    const stop = LOCK_FACE + PLAYER.radius;
    if (side === 'N' && y < d.line + stop) return true;
    if (side === 'S' && y > d.line - stop) return true;
    if (side === 'W' && x < d.line + stop) return true;
    if (side === 'E' && x > d.line - stop) return true;
  }
  return false;
}

export function nearestPoint(nav, x, y, maxR = 0.6) {
  let best = -1;
  let bd = Infinity;
  const i0 = Math.max(0, Math.floor((x - maxR) / STEP));
  const i1 = Math.min(NX - 1, Math.ceil((x + maxR) / STEP));
  const j0 = Math.max(0, Math.floor((y - maxR) / STEP));
  const j1 = Math.min(NY - 1, Math.ceil((y + maxR) / STEP));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * NX + i;
      if (!nav.safe[k]) continue;
      const d = Math.hypot(i * STEP - x, j * STEP - y);
      if (d < bd && d <= maxR) { bd = d; best = k; }
    }
  }
  return best;
}

// Cheapest path between two grid points (8-connected, no corner cutting), as a list of
// {x, y, pod}. null if there is none.
export function plan(nav, from, to) {
  const n = NX * NY;
  const dist = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new Heap(n);
  dist[from] = 0;
  heap.push(from, 0);
  while (heap.size) {
    const k = heap.pop();
    if (k === to) break;
    const i = k % NX;
    const j = (k - i) / NX;
    for (let o = 0; o < 8; o++) {
      const di = DIRS[o][0];
      const dj = DIRS[o][1];
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
      const kk = jj * NX + ii;
      if (!nav.safe[kk]) continue;
      if (di && dj && (!nav.safe[j * NX + ii] || !nav.safe[jj * NX + i])) continue;
      const len = di && dj ? Math.SQRT2 : 1;
      const nd = dist[k] + len * (1 + nav.cost[kk]);
      if (nd < dist[kk]) {
        dist[kk] = nd;
        prev[kk] = k;
        heap.push(kk, nd);
      }
    }
  }
  if (dist[to] === Infinity) return null;
  const out = [];
  for (let k = to; k >= 0; k = prev[k]) {
    const i = k % NX;
    out.push({ x: i * STEP, y: ((k - i) / NX) * STEP, pod: nav.pod[k] === 1 });
  }
  return out.reverse();
}

class Heap {
  constructor(n) {
    this.keys = new Int32Array(n * 8);
    this.pri = new Float64Array(n * 8);
    this.size = 0;
  }
  push(k, p) {
    let i = this.size++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.pri[up] <= p) break;
      this.keys[i] = this.keys[up];
      this.pri[i] = this.pri[up];
      i = up;
    }
    this.keys[i] = k;
    this.pri[i] = p;
  }
  pop() {
    const top = this.keys[0];
    const k = this.keys[--this.size];
    const p = this.pri[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.pri[c + 1] < this.pri[c]) c++;
      if (this.pri[c] >= p) break;
      this.keys[i] = this.keys[c];
      this.pri[i] = this.pri[c];
      i = c;
    }
    this.keys[i] = k;
    this.pri[i] = p;
    return top;
  }
}

// ------------------------------------------------------------------ steering

// Is the spot one step along (ix, iy) safe to stand on? Walls always; pod gates when
// they are on (or come on within `ahead` seconds).
export function stepSafe(game, x, y, ahead = 0.1) {
  const geo = game.room.geo;
  if (wallDistance(geo, x, y, CELL.WALL) < LETHAL + STEP_MARGIN) return false;
  if (geo.podPosts.length && podSoon(game, ahead) && wallDistance(geo, x, y, CELL.POD) < LETHAL + STEP_MARGIN) return false;
  return true;
}

// Will the pod gates be on at any point in the next `ahead` seconds?
export function podSoon(game, ahead) {
  const room = game.room;
  const cyc = room.geo.podCycle;
  if (!cyc) return false;
  if (room.podOn) return true;
  const phase = room.t % cyc.period;
  return phase + ahead >= cyc.open;
}

// Seconds the gates stay off from now (0 if on).
function podOffLeft(game) {
  const room = game.room;
  const cyc = room.geo.podCycle;
  if (!cyc) return Infinity;
  if (room.podOn) return 0;
  return cyc.open - (room.t % cyc.period);
}

const IDLE = { x: 0, y: 0, fire: false };

// The safe 8-direction step that brings Shamus closest to (tx, ty), or IDLE.
export function steerTo(game, tx, ty) {
  const p = game.player;
  let best = IDLE;
  let bd = Math.hypot(tx - p.x, ty - p.y) - 1e-6;
  for (let o = 0; o < 8; o++) {
    const ix = DIRS[o][0];
    const iy = DIRS[o][1];
    const q = previewMove(game, ix, iy);
    if (!stepSafe(game, q.x, q.y)) continue;
    const d = Math.hypot(tx - q.x, ty - q.y);
    if (d < bd) { bd = d; best = { x: ix, y: iy, fire: false }; }
  }
  return best;
}

// Follows a planned path. `goal` is { x, y, r, label }: done within r of (x, y).
export class Pilot {
  constructor(game) {
    this.game = game;
    this.path = null;
    this.idx = 0;
    this.goal = null;
    this.serial = -1;
    this.best = Infinity;
    this.stallT = 0;
  }

  setGoal(goal) {
    this.goal = goal;
    this.path = null;
    this.stallT = 0;
    this.best = Infinity;
  }

  // Plan from where Shamus stands. Returns an error string or null.
  replan() {
    const game = this.game;
    const nav = navFor(game);
    const p = game.player;
    const from = nearestPoint(nav, p.x, p.y, 0.6);
    const to = nearestPoint(nav, this.goal.x, this.goal.y, this.goal.snap ?? 0.6);
    this.serial = game.room.serial;
    if (from < 0) return `no walkable point near the player at ${fmt(p)}`;
    if (to < 0) return `no walkable point near ${this.goal.label} at ${fmt(this.goal)}`;
    this.path = plan(nav, from, to);
    this.idx = 0;
    this.best = Infinity;
    if (!this.path) return `no path to ${this.goal.label} at ${fmt(this.goal)}`;
    return null;
  }

  done() {
    const p = this.game.player;
    return Math.hypot(this.goal.x - p.x, this.goal.y - p.y) <= this.goal.r;
  }

  // The input for this step. Throws on a planning failure or a stall.
  input() {
    const game = this.game;
    if (!this.path || this.serial !== game.room.serial) {
      const err = this.replan();
      if (err) throw new Error(err);
    }
    const p = game.player;
    const path = this.path;
    // Advance along the path: skip points already reached, or closer points ahead.
    while (this.idx < path.length - 1) {
      const a = path[this.idx];
      if (Math.hypot(a.x - p.x, a.y - p.y) < 0.16) { this.idx++; continue; }
      let jumped = false;
      for (let k = this.idx + 1; k <= Math.min(path.length - 1, this.idx + 4); k++) {
        const b = path[k];
        if (Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) - 0.01 && Math.hypot(b.x - p.x, b.y - p.y) < 0.2) {
          this.idx = k;
          jumped = true;
        }
      }
      if (!jumped) break;
    }
    // Progress watchdog.
    const remaining = path.length - this.idx;
    if (remaining < this.best) { this.best = remaining; this.stallT = 0; }
    else this.stallT += DT;
    if (this.stallT > 4) throw new Error(`stalled ${this.stallT.toFixed(1)} s heading for ${this.goal.label} (path point ${this.idx}/${path.length} at ${fmt(path[this.idx])})`);
    // Pod gates: don't step into a gate's reach unless it stays off long enough to cross.
    const here = nearestPoint(navFor(game), p.x, p.y, 0.3);
    const inPod = here >= 0 && navFor(game).pod[here] === 1;
    if (!inPod && path[this.idx].pod) {
      let len = 0;
      for (let k = this.idx; k < path.length && path[k].pod; k++) len += STEP * 1.42;
      const speed = PLAYER.speed[game.room.zone] * (p.boost ? PLAYER.clearBoost : 1);
      if (podOffLeft(game) < len / speed + 0.3) {
        this.stallT = 0;
        return IDLE;
      }
    }
    const target = this.idx >= path.length - 1 ? { x: this.goal.x, y: this.goal.y } : path[this.idx];
    // The last stretch heads for the goal itself (past a door line, onto an item).
    return steerTo(game, target.x, target.y);
  }
}

const fmt = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

// ------------------------------------------------------------------ the route

// Rooms reachable from `from` through doors whose locks are open, with the first
// step toward each: Map(room -> { dist, side }).
export function roomsFrom(game, from) {
  const out = new Map([[from, { dist: 0, side: null }]]);
  const q = [from];
  while (q.length) {
    const id = q.shift();
    const here = out.get(id);
    for (const [side, to] of Object.entries(ROOMS[id].exits)) {
      const lock = lockOn(id, side);
      if (lock && !game.opened[lock.id]) continue;
      if (out.has(to)) continue;
      out.set(to, { dist: here.dist + 1, side: here.side ?? side });
      q.push(to);
    }
  }
  return out;
}

// What to do next: { kind: 'item' | 'keyhole' | 'door' | 'fight', ... }.
export function nextMove(game, all) {
  const room = game.room;
  const id = room.id;
  const it = game.item;
  if (it && !it.hidden && !it.used && it.kind === 'key') return { kind: 'item', label: `${it.color} key`, x: it.x, y: it.y };
  if (it && it.kind === 'keyhole' && !it.used && game.keys[it.color] > 0) return { kind: 'keyhole', label: `${it.color} keyhole`, x: it.x, y: it.y };
  if (id === LAIR_ROOM) return { kind: 'fight' };
  const reach = roomsFrom(game, id);
  let target = null;
  const nearest = (pred) => {
    let best = null;
    for (const [rid, info] of reach) if (rid !== id && pred(rid) && (!best || info.dist < best.dist)) best = { id: rid, ...info };
    return best;
  };
  const keyRoom = (rid) => ROOMS[rid].item?.kind === 'key' && !game.taken[rid];
  const keyhole = (rid) => {
    const lock = ROOMS[rid].lock;
    return lock && !game.opened[lock.id] && game.keys[lock.color] > 0;
  };
  if (all) {
    target = nearest((rid) => rid !== LAIR_ROOM && !game.visited[rid]);
    if (!target) target = nearest((rid) => keyRoom(rid) || keyhole(rid));
    if (!target && reach.has(LAIR_ROOM)) target = { id: LAIR_ROOM, ...reach.get(LAIR_ROOM) };
  } else {
    if (reach.has(LAIR_ROOM)) target = { id: LAIR_ROOM, ...reach.get(LAIR_ROOM) };
    else target = nearest((rid) => keyRoom(rid) || keyhole(rid));
  }
  if (!target) return null;
  const side = target.side;
  const d = DOOR[side];
  const out = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[side];
  // Aim a little past the door line, in the middle of the opening.
  const gx = d.center.x + out[0] * 0.25;
  const gy = d.center.y + out[1] * 0.25;
  return { kind: 'door', side, to: ROOMS[id].exits[side], target: target.id, label: `door ${side} to ${ROOMS[id].exits[side]} (heading for ${target.id})`, x: gx, y: gy };
}

// ------------------------------------------------------------------ the lair fight

// Line up with the Shadow along one of the 8 directions and shoot; keep away from him
// and out of the line of a charge.
export function fightInput(game) {
  const s = game.shadow;
  const p = game.player;
  if (!s || s.state === 'dying') return IDLE;
  const vulnerable = (s.state === 'chase' || s.state === 'charge') && s.immuneT <= 0;
  // Fire if lined up.
  if (vulnerable && game.shots.length < PLAYER.maxShots) {
    const o = lineUp(game, p.x, p.y, s, 0.42);
    if (o >= 0) return { x: DIRS[o][0], y: DIRS[o][1], fire: true };
  }
  // Otherwise move to the best spot nearby.
  let best = IDLE;
  let bestScore = spotScore(game, p.x, p.y, s);
  for (let o = 0; o < 8; o++) {
    const q = previewMove(game, DIRS[o][0], DIRS[o][1]);
    if (!stepSafe(game, q.x, q.y, 0.3)) continue;
    if (q.x < 1.3 || q.y < 1.3 || q.x > W - 1.3 || q.y > H - 1.3) continue; // stay in the lair
    const sc = spotScore(game, q.x, q.y, s);
    if (sc < bestScore - 1e-4) { bestScore = sc; best = { x: DIRS[o][0], y: DIRS[o][1], fire: false }; }
  }
  return best;
}

// The direction from (x, y) along which a shot would hit the Shadow, or -1.
function lineUp(game, x, y, s, tol) {
  let best = -1;
  let bp = tol;
  for (let o = 0; o < 8; o++) {
    const dx = s.x - x;
    const dy = s.y - y;
    const along = dx * UNIT[o][0] + dy * UNIT[o][1];
    if (along < 0.4) continue;
    const perp = Math.abs(dx * UNIT[o][1] - dy * UNIT[o][0]);
    if (perp >= bp) continue;
    const ex = x + UNIT[o][0] * along;
    const ey = y + UNIT[o][1] * along;
    if (!lineClear(game.room.geo, x, y, ex, ey, { podsOn: game.room.podOn, rad: PLAYER.shotRadius })) continue;
    bp = perp;
    best = o;
  }
  return best;
}

function spotScore(game, x, y, s) {
  const geo = game.room.geo;
  const d = Math.hypot(s.x - x, s.y - y);
  let score = 0;
  if (s.state !== 'enter') score += d < 3 ? (3 - d) * 6 : 0;
  if (s.state === 'charge') {
    // Stay out of the lane he is about to dash down.
    const ax = s.ax;
    const ay = s.ay;
    const along = (x - s.x) * ax + (y - s.y) * ay;
    const lane = Math.abs((x - s.x) * ay - (y - s.y) * ax);
    if (along > -0.5 && lane < 1.6) score += (1.6 - lane) * 8;
  }
  // Lined up with him (with a clear shot) is good.
  let perp = 4;
  for (let o = 0; o < 8; o++) {
    const dx = s.x - x;
    const dy = s.y - y;
    const along = dx * UNIT[o][0] + dy * UNIT[o][1];
    if (along < 0.4) continue;
    const pp = Math.abs(dx * UNIT[o][1] - dy * UNIT[o][0]);
    if (pp < perp && lineClear(geo, x, y, x + UNIT[o][0] * along, y + UNIT[o][1] * along, { rad: PLAYER.shotRadius })) perp = pp;
  }
  score += perp;
  // Room to move.
  const wd = Math.min(1.2, wallDistance(geo, x, y, CELL.WALL) - LETHAL);
  score += (1.2 - wd) * 0.8;
  if (blockAt(geo, x, y, PLAYER.radius + 0.3)) score += 0.3;
  return score;
}

// ------------------------------------------------------------------ the tour

export function runTour({ all = false, seed = 1, skill = 1, verbose = false, log = console.log, maxRooms = 2000 } = {}) {
  const game = createGame({ skill, seed });
  game.cheats.noFoes = true;
  game.cheats.noShadow = true;
  const pilot = new Pilot(game);
  const failures = [];
  const line = [];
  let move = null;
  let roomStart = 0;
  let transitions = 0;
  let fightDeaths = 0;
  let lastRoom = -1;
  const fail = (msg) => {
    const p = game.player;
    const f = `room ${game.room.id}${game.room.geo.placeholder ? ' (placeholder)' : ''}: ${msg}; player at ${fmt(p)}, t ${game.room.t.toFixed(1)} s`;
    failures.push(f);
    log(`  FAIL ${f}`);
    log(drawRoom(game, pilot.path, move && move.kind !== 'fight' ? move : null));
  };
  const maxSteps = 60 * 60 * 90; // 90 minutes of play
  for (let step = 0; step < maxSteps; step++) {
    if (game.mode === 'won') break;
    if (game.mode === 'gameover') { fail('game over'); break; }
    if (game.room.id !== lastRoom) {
      if (lastRoom >= 0) line.push(`${lastRoom}${game.events.find((e) => e.type === 'roomExit')?.side ?? ''}`);
      lastRoom = game.room.id;
      roomStart = game.t;
      transitions++;
      move = null;
      if (game.room.id === LAIR_ROOM) game.cheats.noShadow = false;
      if (verbose) log(`  enter ${game.room.id} from ${game.room.from ?? '-'}${game.room.geo.placeholder ? ' (placeholder)' : ''} keys ${JSON.stringify(game.keys)}`);
      if (transitions > maxRooms) { fail('too many rooms; the route is looping'); break; }
    }
    if (game.mode === 'dying') {
      stepGame(game, IDLE);
      if (game.mode === 'play') { move = null; pilot.path = null; }
      continue;
    }
    if (game.t - roomStart > 60 && game.room.id !== LAIR_ROOM) { fail(`spent 60 s here heading for ${move?.label ?? 'nothing'}`); break; }
    if (game.room.id === LAIR_ROOM && game.t - roomStart > 240) { fail('the lair fight ran past 240 s'); break; }

    // Decide what to do here.
    if (!move || (move.kind === 'item' && (!game.item || game.item.kind !== 'key')) || (move.kind === 'keyhole' && game.item?.used)) {
      move = nextMove(game, all);
      if (!move) { fail('no route onward: nothing reachable to do'); break; }
      if (move.kind !== 'fight') pilot.setGoal({ ...move, r: move.kind === 'door' ? 0 : PLAYER.radius + 0.35, snap: move.kind === 'door' ? 0.3 : 0.6 });
      if (verbose) log(`    -> ${move.label ?? move.kind}`);
    }
    let input;
    try {
      input = move.kind === 'fight' ? fightInput(game) : pilot.input();
    } catch (e) {
      fail(e.message);
      break;
    }
    stepGame(game, input);
    for (const e of game.events) {
      if (e.type === 'playerDie') {
        if (e.cause === 'shadow' && game.room.id === LAIR_ROOM) {
          fightDeaths++;
          if (verbose) log(`    the Shadow got us (${fightDeaths})`);
        } else fail(`died (${e.cause}) heading for ${move.label ?? move.kind}`);
      }
      if (verbose && ['keyUse', 'pickup', 'shadowHurt', 'shadowEnter', 'mystery'].includes(e.type)) log(`    ${e.type} ${JSON.stringify(e)}`);
    }
  }
  if (game.mode !== 'won' && !failures.length) fail('ran out of time');
  const visited = Object.keys(game.visited).length;
  line.push(String(game.room.id));
  const lairT = game.room.id === LAIR_ROOM ? game.t - roomStart : 0;
  return { game, failures, visited, transitions, fightDeaths, lairT, route: line };
}

// A room as text, two characters per cell: walls '#', gates 'P', blocks 'B' 'O' 'T', the
// item '*' or keyhole 'H', the planner's walkable points '.', the path 'o', the target
// 'X', and the player '@'.
export function drawRoom(game, path = null, target = null) {
  const room = game.room;
  const geo = room.geo;
  const nav = navFor(game);
  const sub = 2; // characters per cell
  const rows = [];
  for (let r = 0; r < H * sub; r++) {
    let row = '';
    for (let c = 0; c < W * sub; c++) {
      const x = (c + 0.5) / sub;
      const y = (r + 0.5) / sub;
      const ch = geo.layout[Math.floor(y)][Math.floor(x)];
      const k = nearestPoint(nav, x, y, 0.13);
      let out = '#PBOT*H'.includes(ch) ? ch : k >= 0 ? '.' : ' ';
      if (path && path.some((q) => Math.abs(q.x - x) < 0.25 && Math.abs(q.y - y) < 0.25)) out = 'o';
      if (target && Math.abs(target.x - x) < 0.25 && Math.abs(target.y - y) < 0.25) out = 'X';
      if (Math.abs(game.player.x - x) < 0.25 && Math.abs(game.player.y - y) < 0.25) out = '@';
      row += out;
    }
    rows.push('    ' + row);
  }
  return rows.join('\n');
}

// ------------------------------------------------------------------ command line

function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : dflt;
  };
  if (args.includes('--show')) {
    const id = opt('--show', 0);
    const game = createGame({ seed: 1 });
    game.cheats.noFoes = true;
    game.cheats.noShadow = true;
    enterRoom(game, id, Object.keys(ROOMS[id].exits)[0] ?? null);
    console.log(`room ${id}: '.' is where the pilot may plan, '@' the first door's landing`);
    console.log(drawRoom(game));
    return;
  }
  const all = args.includes('--all');
  const seed = opt('--seed', 1);
  const skill = opt('--skill', 1);
  const verbose = args.includes('--verbose') || args.includes('-v');
  console.log(`tour: ${all ? 'every room' : 'the winning route'}, seed ${seed}, skill ${skill}`);
  const r = runTour({ all, seed, skill, verbose });
  const g = r.game;
  // The route, wrapped: each step is a room and the side it was left by.
  const lines = [''];
  for (const step of r.route) {
    if (lines[lines.length - 1].length + step.length > 92) lines.push('');
    lines[lines.length - 1] += (lines[lines.length - 1] ? ' ' : '') + step;
  }
  console.log(`route (${r.transitions} rooms entered):\n  ${lines.join('\n  ')}`);
  const placeholders = Object.keys(g.visited).filter((id) => getRoom(Number(id)).placeholder).length;
  console.log(`visited ${r.visited}/128 rooms (${placeholders} placeholders), keys used ${Object.keys(g.opened).length}/${LOCKS.length}, lair fight ${r.lairT.toFixed(1)} s with ${r.fightDeaths} deaths, score ${g.score}, play time ${g.stats.time.toFixed(0)} s`);
  if (all && r.visited < 128) r.failures.push(`only ${r.visited} of 128 rooms visited`);
  console.log(g.mode === 'won' && !r.failures.length ? 'WON - all good' : `${r.failures.length} failure${r.failures.length === 1 ? '' : 's'}${g.mode === 'won' ? ' (but the lair was won)' : ''}`);
  for (const f of r.failures) console.log(`  ${f}`);
  process.exit(g.mode === 'won' && !r.failures.length ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
