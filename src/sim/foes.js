// Robots: five types, spawned fresh on every entry to a room. docs/DESIGN.md describes
// each one; tuning.js (FOE, FOES) holds their numbers.
//
// Every robot but the drone walks the cell grid: it stands on a cell center (col, row)
// or moves to a neighbor (tcol, trow) it has reserved, so robots never share a cell.
// Robots only use floor cells inside the border (never door cells, walls, blocks, or
// pod gates) and never cut a corner past a wall or a block, so a robot on the grid is
// always at least a cell's width from an electric wall. The drone moves freely around
// its center and checks every step against the walls with a safety margin.

import { W, H, CELL, WALL_HALF, walkableCell, lineClear, wallDistance, blockAt } from '../room.js';
import { DT, SKILLS, SCORE, FOES, FOE, PLAYER } from './tuning.js';
import { rand, randInt } from './rng.js';
import { emit, banner, addScore, DIRS, UNIT, faceOf, hurtPlayer } from './core.js';
import { spawnBolt } from './shots.js';

const N = W * H;
const FAR = 32767;
const toPlayer = new Int16Array(N); // BFS steps from each cell to Shamus's cell
const toScent = new Int16Array(N); // BFS steps to a sniffer's next scent cell
const queue = new Int16Array(N);
const cand = new Int8Array(8);
let fieldGeo = null;
let fieldCell = -1;

const nav = (geo, c, r) => c >= 1 && r >= 1 && c <= W - 2 && r <= H - 2 && walkableCell(geo, c, r);

// Can a robot step from (c, r) by (dc, dr)? No corner cutting past walls or crates.
function stepOk(geo, c, r, dc, dr) {
  if (!nav(geo, c + dc, r + dr)) return false;
  if (dc && dr && (!nav(geo, c + dc, r) || !nav(geo, c, r + dr))) return false;
  return true;
}

// Breadth-first steps from the `seeds` cells already in queue[0..seeds).
function bfs(geo, seeds, out) {
  out.fill(FAR);
  for (let i = 0; i < seeds; i++) out[queue[i]] = 0;
  let head = 0;
  let tail = seeds;
  while (head < tail) {
    const k = queue[head++];
    const c = k % W;
    const r = (k - c) / W;
    const d = out[k] + 1;
    for (let o = 0; o < 8; o++) {
      const dc = DIRS[o][0];
      const dr = DIRS[o][1];
      if (!stepOk(geo, c, r, dc, dr)) continue;
      const kk = k + dr * W + dc;
      if (out[kk] !== FAR) continue;
      out[kk] = d;
      queue[tail++] = kk;
    }
  }
}

// The flow field toward Shamus, rebuilt only when he changes cell.
function playerField(game) {
  const geo = game.room.geo;
  const p = game.player;
  const pc = Math.min(W - 2, Math.max(1, Math.floor(p.x)));
  const pr = Math.min(H - 2, Math.max(1, Math.floor(p.y)));
  const cell = pr * W + pc;
  if (geo === fieldGeo && cell === fieldCell) return toPlayer;
  fieldGeo = geo;
  fieldCell = cell;
  let seeds = 0;
  if (nav(geo, pc, pr)) queue[seeds++] = cell;
  else {
    for (let o = 0; o < 8; o++) {
      const c = pc + DIRS[o][0];
      const r = pr + DIRS[o][1];
      if (nav(geo, c, r)) queue[seeds++] = r * W + c;
    }
  }
  bfs(geo, seeds, toPlayer);
  return toPlayer;
}

// ------------------------------------------------------------------ spawning

// A fresh pick of the room's robots: `n` (scaled by skill) from the spawn points at
// least FOES.minSpawnDist from where Shamus came in.
export function spawnFoes(game) {
  const room = game.room;
  const geo = room.geo;
  game.foes.length = 0;
  room.foesSpawned = 0;
  if (game.cheats.noFoes || geo.n <= 0) return;
  const sk = SKILLS[game.skill];
  const want = Math.max(1, Math.round(geo.n * sk.foeCount));
  const e = room.entry;
  const spots = geo.spawns.filter((s) => nav(geo, s.c, s.r) && Math.hypot(s.x - e.x, s.y - e.y) >= FOES.minSpawnDist);
  const allowed = (geo.foes && geo.foes.length ? geo.foes : FOES.types[room.zone]).filter((t) => FOE[t]);
  const mix = FOES.mix[room.zone];
  let wardens = 0;
  for (let i = 0; i < want && spots.length; i++) {
    const spot = spots.splice(randInt(game, spots.length), 1)[0];
    const type = pickType(game, allowed, mix, wardens >= FOES.maxWardens);
    if (!type) break;
    if (type === 'warden') wardens++;
    addFoe(game, type, spot.c, spot.r);
  }
}

function pickType(game, allowed, mix, noWarden) {
  let total = 0;
  for (const t of allowed) if (!(noWarden && t === 'warden')) total += mix[t] ?? 1;
  if (total <= 0) return null;
  let u = rand(game) * total;
  for (const t of allowed) {
    if (noWarden && t === 'warden') continue;
    u -= mix[t] ?? 1;
    if (u < 0) return t;
  }
  return allowed[allowed.length - 1];
}

// Put a robot of `type` on cell (col, row). Exported for tests and the dev console.
export function addFoe(game, type, col, row) {
  const T = FOE[type];
  const p = game.player;
  const x = col + 0.5;
  const y = row + 0.5;
  const f = {
    id: game.nextId++, type, x, y, face: faceOf(p.x - x, p.y - y), state: 'idle', t: 0, dur: 0,
    hp: T.hp, r: T.r, col, row, tcol: col, trow: row, aim: -1, fireCd: 0, stuckT: 0, steps: 0,
  };
  const k = rates(game);
  if (type === 'droid') {
    setState(f, 'pause', 0.2 + rand(game) * 0.8);
    f.fireCd = (0.3 + rand(game) * 0.7) * T.reload / k.fire;
  } else if (type === 'drone') {
    f.state = 'whirl';
    f.ox = x;
    f.oy = y;
    f.rad = 0;
    f.ang = rand(game) * Math.PI * 2;
    f.spin = rand(game) < 0.5 ? 1 : -1;
    f.ph = rand(game) * T.tighten;
  } else if (type === 'jumper') {
    f.state = 'land';
    f.dur = 0.2 + rand(game) * 0.8;
    f.zap = false;
  } else if (type === 'sniffer') {
    f.state = 'sniff';
    f.ti = 0;
  } else if (type === 'warden') {
    f.face = randInt(game, 8);
    setState(f, 'scan', T.turn);
    f.burst = 0;
  }
  game.foes.push(f);
  game.room.foesSpawned++;
  return f;
}

function setState(f, state, dur = 0) {
  f.state = state;
  f.t = 0;
  f.dur = dur;
}

// Speed and fire-rate multipliers for this sector and skill (one shared object).
const k = { speed: 1, fire: 1 };
function rates(game) {
  const sk = SKILLS[game.skill];
  const zone = game.room.zone;
  k.speed = FOES.speed[zone] * sk.foeSpeed;
  k.fire = FOES.fire[zone] * sk.foeFire;
  return k;
}

// ------------------------------------------------------------------ the step

export function updateFoes(game) {
  if (game.cheats.noFoes) {
    game.foes.length = 0;
    return;
  }
  const foes = game.foes;
  if (!foes.length) return;
  if (game.freezeT > 0) return; // frozen robots stand still and can't hurt you
  const k = rates(game);
  for (let i = 0; i < foes.length; i++) {
    const f = foes[i];
    f.t += DT;
    if (f.fireCd > 0) f.fireCd -= DT;
    if (f.type === 'droid') droid(game, f, k);
    else if (f.type === 'drone') drone(game, f, k);
    else if (f.type === 'jumper') jumper(game, f, k);
    else if (f.type === 'sniffer') sniffer(game, f, k);
    else if (f.type === 'warden') warden(game, f, k);
    if (game.mode !== 'play') return;
  }
  // Touching a robot kills.
  const p = game.player;
  for (let i = 0; i < foes.length; i++) {
    const f = foes[i];
    const reach = f.r + p.r - PLAYER.touchSlack;
    if ((f.x - p.x) ** 2 + (f.y - p.y) ** 2 < reach * reach && hurtPlayer(game, 'foe', f.type)) return;
  }
}

// ---------------------------------------------------------------- grid walking

function reserved(game, f, c, r) {
  const cx = c + 0.5;
  const cy = r + 0.5;
  for (const o of game.foes) {
    if (o === f) continue;
    if (o.type === 'drone') {
      if (Math.hypot(o.x - cx, o.y - cy) < o.r + f.r + 0.3) return true;
    } else if ((o.col === c && o.row === r) || (o.tcol === c && o.trow === r)) {
      return true;
    }
  }
  return false;
}

// Would moving `f` to (nx, ny) push it into another robot?
function bumps(game, f, nx, ny) {
  for (const o of game.foes) {
    if (o === f) continue;
    const lim = o.r + f.r + 0.04;
    const d = (nx - o.x) ** 2 + (ny - o.y) ** 2;
    if (d < lim * lim && d < (f.x - o.x) ** 2 + (f.y - o.y) ** 2) return true;
  }
  return false;
}

const moving = (f) => f.col !== f.tcol || f.row !== f.trow;

// Move toward the target cell's center. Returns true on arrival.
function walk(game, f, speed) {
  const tx = f.tcol + 0.5;
  const ty = f.trow + 0.5;
  const dx = tx - f.x;
  const dy = ty - f.y;
  const d = Math.hypot(dx, dy);
  const step = speed * DT;
  if (d <= step) {
    f.x = tx;
    f.y = ty;
    f.col = f.tcol;
    f.row = f.trow;
    f.stuckT = 0;
    return true;
  }
  const nx = f.x + (dx / d) * step;
  const ny = f.y + (dy / d) * step;
  if (bumps(game, f, nx, ny)) {
    f.stuckT += DT;
    if (f.stuckT > FOES.stuck) {
      // Give up the cell and go back where it came from.
      const c = f.col;
      const r = f.row;
      f.col = f.tcol;
      f.row = f.trow;
      f.tcol = c;
      f.trow = r;
      f.stuckT = 0;
    }
    return false;
  }
  f.x = nx;
  f.y = ny;
  return false;
}

// Pick the next cell: with chance `chase` the step that best closes on the field's
// goal, otherwise a wander that likes to keep going straight. Returns false if boxed in.
function chooseStep(game, f, field, chase) {
  const geo = game.room.geo;
  let n = 0;
  for (let o = 0; o < 8; o++) {
    const c = f.col + DIRS[o][0];
    const r = f.row + DIRS[o][1];
    if (!stepOk(geo, f.col, f.row, DIRS[o][0], DIRS[o][1]) || reserved(game, f, c, r)) continue;
    cand[n++] = o;
  }
  if (!n) return false;
  let pickO = -1;
  if (field && rand(game) < chase) {
    let best = FAR;
    let ties = 0;
    for (let i = 0; i < n; i++) {
      const o = cand[i];
      const v = field[(f.row + DIRS[o][1]) * W + f.col + DIRS[o][0]];
      if (v < best) { best = v; ties = 1; pickO = o; }
      else if (v === best && randInt(game, ++ties) === 0) pickO = o;
    }
    if (best === FAR) pickO = -1;
  }
  if (pickO < 0) {
    pickO = cand[randInt(game, n)];
    for (let i = 0; i < n; i++) if (cand[i] === f.face && rand(game) < 0.6) pickO = f.face;
  }
  f.tcol = f.col + DIRS[pickO][0];
  f.trow = f.row + DIRS[pickO][1];
  f.face = pickO;
  f.stuckT = 0;
  return true;
}

// ---------------------------------------------------------------- aiming

function canFire(game) {
  const room = game.room;
  return game.player.alive && room.t >= FOES.entryGrace * SKILLS[game.skill].grace && game.bolts.length < FOES.maxBolts[room.zone];
}

// The direction (0..7) along which `f` has a clear shot at Shamus: he is within `tol`
// of that line and `range` along it, nothing solid is in the way, and no other robot
// stands in the line of fire. -1 if none.
function lineOfFire(game, f, tol, range) {
  const p = game.player;
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  let best = -1;
  let bestPerp = tol;
  let bestAlong = 0;
  for (let o = 0; o < 8; o++) {
    const ux = UNIT[o][0];
    const uy = UNIT[o][1];
    const along = dx * ux + dy * uy;
    if (along < 0.5 || along > range) continue;
    const perp = Math.abs(dx * uy - dy * ux);
    if (perp < bestPerp) { best = o; bestPerp = perp; bestAlong = along; }
  }
  if (best < 0) return -1;
  const tx = f.x + UNIT[best][0] * bestAlong;
  const ty = f.y + UNIT[best][1] * bestAlong;
  if (!lineClear(game.room.geo, f.x, f.y, tx, ty, { podsOn: game.room.podOn, rad: FOES.boltRadius })) return -1;
  for (const o of game.foes) {
    if (o === f) continue;
    if (segDist(o.x, o.y, f.x, f.y, tx, ty) < o.r + 0.2) return -1;
  }
  return best;
}

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x1 + t * dx - px, y1 + t * dy - py);
}

// ---------------------------------------------------------------- the five types

// Droid: walk a few cells, pause, and stop to aim and fire when Shamus lines up.
function droid(game, f, k) {
  const T = FOE.droid;
  if (f.state === 'aim') {
    if (f.t < f.dur) return;
    if (canFire(game)) spawnBolt(game, f, f.aim);
    f.fireCd = T.reload / k.fire * (0.8 + rand(game) * 0.4);
    f.aim = -1;
    setState(f, 'pause', (T.pause[0] + rand(game) * (T.pause[1] - T.pause[0])) / k.speed);
    return;
  }
  if (moving(f)) {
    if (!walk(game, f, T.speed * k.speed)) return;
    f.steps--;
  }
  // On a cell center: shoot if lined up, else keep walking or pausing.
  if (f.fireCd <= 0 && canFire(game)) {
    const o = lineOfFire(game, f, T.align, T.range);
    if (o >= 0) {
      f.aim = o;
      f.face = o;
      setState(f, 'aim', T.aim / Math.sqrt(k.fire));
      return;
    }
  }
  if (f.state === 'pause') {
    if (f.t < f.dur) return;
    setState(f, 'walk');
    f.steps = T.steps[0] + randInt(game, T.steps[1] - T.steps[0] + 1);
  }
  if (f.steps <= 0 || !chooseStep(game, f, playerField(game), T.chase)) {
    setState(f, 'pause', (T.pause[0] + rand(game) * (T.pause[1] - T.pause[0])) / k.speed);
  }
}

// Drone: whirl in a tightening spiral around a center that drifts toward Shamus. Never
// fires; deadly to touch. The body always sits on a clear line out from the center (out
// to the spiral's radius or the nearest wall, whichever is closer), so it can never be
// stranded behind a wall; when a wall blocks the circle ahead it whirls back the other
// way.
function drone(game, f, k) {
  const T = FOE.drone;
  // The center walks the grid like a slow robot (it reserves nothing; the body keeps
  // clear of others).
  const tx = f.tcol + 0.5;
  const ty = f.trow + 0.5;
  const cd = Math.hypot(tx - f.ox, ty - f.oy);
  const cstep = T.drift * k.speed * DT;
  if (cd <= cstep) {
    f.ox = tx;
    f.oy = ty;
    f.col = f.tcol;
    f.row = f.trow;
    pickDroneCell(game, f, T.chase);
  } else {
    f.ox += ((tx - f.ox) / cd) * cstep;
    f.oy += ((ty - f.oy) / cd) * cstep;
  }
  // The spiral.
  f.ph = (f.ph + DT) % T.tighten;
  const R = T.rMax - (T.rMax - T.rMin) * (f.ph / T.tighten);
  const vt = T.spin * k.speed;
  let ang = f.ang + (f.spin * vt * DT) / Math.max(f.rad, 0.6);
  let room = clearRay(game, f, f.ox, f.oy, ang, R);
  if (room < f.rad - 0.15) {
    // A wall ahead on the circle: whirl back.
    f.spin = -f.spin;
    ang = f.ang;
    room = clearRay(game, f, f.ox, f.oy, ang, R);
  }
  // Swing back out gently; pull in at once when a wall is closer.
  const rad = room > f.rad ? Math.min(room, f.rad + vt * 1.5 * DT) : room;
  const nx = f.ox + Math.cos(ang) * rad;
  const ny = f.oy + Math.sin(ang) * rad;
  if (bumps(game, f, nx, ny)) {
    f.spin = -f.spin;
    return;
  }
  if (nx !== f.x || ny !== f.y) f.face = faceOf(nx - f.x, ny - f.y);
  f.x = nx;
  f.y = ny;
  f.ang = ang;
  f.rad = rad;
}

// How far out from (ox, oy) along `ang`, up to `max`, the drone's body has room.
function clearRay(game, f, ox, oy, ang, max) {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  let s = 0;
  while (s < max) {
    const next = Math.min(max, s + 0.1);
    if (!droneRoom(game, f, ox + ux * next, oy + uy * next)) break;
    s = next;
  }
  return s;
}

function pickDroneCell(game, f, chase) {
  const geo = game.room.geo;
  const field = playerField(game);
  let n = 0;
  for (let o = 0; o < 8; o++) if (stepOk(geo, f.col, f.row, DIRS[o][0], DIRS[o][1])) cand[n++] = o;
  if (!n) return;
  let pickO = cand[randInt(game, n)];
  if (rand(game) < chase) {
    let best = field[f.row * W + f.col];
    for (let i = 0; i < n; i++) {
      const o = cand[i];
      const v = field[(f.row + DIRS[o][1]) * W + f.col + DIRS[o][0]];
      if (v < best) { best = v; pickO = o; }
    }
    // Already next to Shamus: hover here.
    if (best === field[f.row * W + f.col]) return;
  }
  f.tcol = f.col + DIRS[pickO][0];
  f.trow = f.row + DIRS[pickO][1];
}

const MARGIN = 0.12;
function droneRoom(game, f, x, y) {
  const geo = game.room.geo;
  if (x < 1.1 || y < 1.1 || x > W - 1.1 || y > H - 1.1) return false;
  if (wallDistance(geo, x, y, CELL.WALL) < WALL_HALF + f.r + MARGIN) return false;
  if (geo.podPosts.length && wallDistance(geo, x, y, CELL.POD) < WALL_HALF + f.r + MARGIN) return false;
  return !blockAt(geo, x, y, f.r + 0.04);
}

// Jumper: crouch facing where it will hop, snap 2-3 cells that way, land, and (from
// sector 2) zap a short bolt at Shamus if he is close.
function jumper(game, f, k) {
  const T = FOE.jumper;
  if (f.state === 'hop') {
    const u = Math.min(1, f.t / f.dur);
    f.x = f.hx + (f.tcol + 0.5 - f.hx) * u;
    f.y = f.hy + (f.trow + 0.5 - f.hy) * u;
    if (u < 1) return;
    f.col = f.tcol;
    f.row = f.trow;
    setState(f, 'land', T.land / k.speed);
    f.zap = false;
    if (game.room.zone >= T.zapFrom && canFire(game)) {
      const o = lineOfFire(game, f, T.zapAlign, T.zapRange);
      if (o >= 0) {
        f.zap = true;
        f.aim = o;
        f.face = o;
      }
    }
    return;
  }
  if (f.state === 'land') {
    if (f.t < f.dur) return;
    if (f.zap && canFire(game)) spawnBolt(game, f, f.aim, T.zapRange);
    f.zap = false;
    f.aim = -1;
    setState(f, 'crouch', (T.crouch * (0.8 + rand(game) * 0.4)) / k.speed);
    if (!chooseHop(game, f)) f.dur *= 0.5; // boxed in: look again soon
    return;
  }
  if (f.state === 'crouch') {
    if (f.t < f.dur) return;
    // Hop, if the landing is still free.
    if (f.aim >= 0 && !reserved(game, f, f.hc, f.hr)) {
      f.hx = f.x;
      f.hy = f.y;
      f.tcol = f.hc;
      f.trow = f.hr;
      f.face = f.aim;
      f.aim = -1;
      setState(f, 'hop', T.hop);
      emit(game, 'foeHop', { id: f.id, x: f.x, y: f.y });
      return;
    }
    setState(f, 'crouch', (T.crouch * 0.4) / k.speed);
    chooseHop(game, f);
  }
}

// Choose the hop (direction and 1-3 cells) that lands closest to Shamus; prefer long
// hops. Stores it in f.aim, f.hc, f.hr and faces that way. Returns false if boxed in.
function chooseHop(game, f) {
  const geo = game.room.geo;
  const p = game.player;
  let best = Infinity;
  f.aim = -1;
  for (let o = 0; o < 8; o++) {
    const dc = DIRS[o][0];
    const dr = DIRS[o][1];
    let reach = 0;
    while (reach < 3 && stepOk(geo, f.col + dc * reach, f.row + dr * reach, dc, dr)) reach++;
    for (let len = reach; len >= 1; len--) {
      const c = f.col + dc * len;
      const r = f.row + dr * len;
      if (reserved(game, f, c, r)) continue;
      const score = Math.hypot(c + 0.5 - p.x, r + 0.5 - p.y) + (len === 1 ? 1.5 : 0) + rand(game) * 0.8;
      if (score < best) {
        best = score;
        f.aim = o;
        f.hc = c;
        f.hr = r;
      }
    }
  }
  if (f.aim >= 0) f.face = f.aim;
  return f.aim >= 0;
}

// Sniffer: follow Shamus's trail at a steady pace; pick up fresher scent when it
// crosses the trail; when it has caught up, home straight in on him.
function sniffer(game, f, k) {
  const T = FOE.sniffer;
  if (moving(f) && !walk(game, f, T.speed * k.speed)) return;
  const geo = game.room.geo;
  const trail = game.trail;
  // Fresher scent beside it?
  for (let j = trail.length - 1; j > f.ti; j--) {
    const cell = trail[j];
    const c = cell % W;
    const r = (cell - c) / W;
    if (Math.abs(c - f.col) <= 1 && Math.abs(r - f.row) <= 1) { f.ti = j; break; }
  }
  // Skip scent it is standing on, or that no robot can reach.
  while (f.ti < trail.length) {
    const cell = trail[f.ti];
    const c = cell % W;
    const r = (cell - c) / W;
    if ((c === f.col && r === f.row) || !nav(geo, c, r)) f.ti++;
    else break;
  }
  let field;
  if (f.ti < trail.length) {
    f.state = 'sniff';
    queue[0] = trail[f.ti];
    bfs(geo, 1, toScent);
    if (toScent[f.row * W + f.col] === FAR) { f.ti++; return; }
    field = toScent;
  } else {
    f.state = 'track';
    field = playerField(game);
  }
  chooseStep(game, f, field, 1);
}

// Warden: a turret. Turns one direction at a time toward Shamus and fires a burst
// down the line when he stands on it.
function warden(game, f, k) {
  const T = FOE.warden;
  if (f.state === 'aim') {
    if (f.t < f.dur) return;
    setState(f, 'burst', T.gap);
    f.burst = T.burst;
  }
  if (f.state === 'burst') {
    if (f.t < f.dur) return;
    if (f.burst > 0 && canFire(game)) spawnBolt(game, f, f.face);
    f.burst--;
    f.t = 0;
    if (f.burst <= 0) {
      setState(f, 'rest', T.rest / k.fire);
      f.aim = -1;
    }
    return;
  }
  if (f.state === 'rest') {
    if (f.t < f.dur) return;
    setState(f, 'scan', T.turn / k.speed);
  }
  // Scan: on the line? Fire. Otherwise turn one step toward him now and then.
  if (canFire(game)) {
    const o = lineOfFire(game, f, T.align, T.range);
    if (o === f.face) {
      f.aim = o;
      setState(f, 'aim', T.aim / Math.sqrt(k.fire));
      return;
    }
  }
  if (f.t < f.dur) return;
  f.t = 0;
  const p = game.player;
  const want = faceOf(p.x - f.x, p.y - f.y);
  const diff = (want - f.face + 8) % 8;
  if (diff) f.face = (f.face + (diff <= 4 ? 1 : 7)) % 8;
}

// ---------------------------------------------------------------- damage

// A shot or bolt moving along (dx, dy) hits robot `f`. Armor may absorb it.
export function hitFoe(game, f, dx, dy, by) {
  if (f.hp > 1) {
    // A sniffer's armor is on its front: a hit from behind or the side goes through.
    const [fx, fy] = UNIT[f.face];
    const len = Math.hypot(dx, dy) || 1;
    const front = f.type !== 'sniffer' || (dx * fx + dy * fy) / len < -0.35;
    if (front) {
      f.hp--;
      emit(game, 'foeHit', { x: f.x, y: f.y, foe: f.type, hp: f.hp });
      return;
    }
  }
  killFoe(game, f, by);
}

// Wreck robot `f` (by 'shot', 'bolt', or 'blast'), score it, and set off the chain.
export function killFoe(game, f, by) {
  const foes = game.foes;
  const i = foes.indexOf(f);
  if (i < 0) return;
  foes.splice(i, 1);
  const points = SCORE.foe[f.type] * game.room.zone;
  addScore(game, points);
  game.stats.kills++;
  emit(game, 'foeDie', { x: f.x, y: f.y, foe: f.type, points, chain: by === 'blast', by });
  const b2 = FOES.blast * FOES.blast;
  for (let j = foes.length - 1; j >= 0; j--) {
    const o = foes[j];
    if (o && (o.x - f.x) ** 2 + (o.y - f.y) ** 2 <= b2) killFoe(game, o, 'blast');
  }
  checkClear(game);
}

function checkClear(game) {
  const room = game.room;
  if (room.cleared || game.foes.length || room.foesSpawned <= 0) return;
  room.cleared = true;
  game.player.boost = true;
  const points = SCORE.roomClear * room.zone;
  addScore(game, points);
  game.stats.cleared++;
  emit(game, 'roomClear', { points });
  banner(game, `ROOM CLEAR +${points}`, null, 1.6);
}
