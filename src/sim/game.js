// The game state and its fixed-step update. Deterministic: same seed, same inputs,
// same game. No DOM, no Three.js, no clocks; tools/sim-test.mjs runs it in Node.
// docs/DESIGN.md lists every field the renderer and the shell may read.

import { ROOMS, START_ROOM, OPPOSITE, LOCKS, lockOn } from '../map.js';
import { getRoom } from '../rooms/index.js';
import { DOOR, LOCK_FACE, touchesWall, touchesPod, pushOutOfBlocks } from '../room.js';
import { DT, SKILLS, PLAYER, SCORE, SHADOW } from './tuning.js';
import { rand } from './rng.js';

export { DT };

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const faceOf = (dx, dy) => (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
export const dirOf = (face) => DIRS[face];

export function createGame({ skill = 1, seed = 1, from = null } = {}) {
  const sk = SKILLS[skill];
  const game = {
    version: 1,
    t: 0,
    step: 0,
    rngState: seed >>> 0 || 1,
    skill,
    loop: 0, // times the lair has been beaten in this run
    mode: 'play', // 'play' | 'dying' | 'gameover' | 'won'
    score: 0,
    lives: sk.lives,
    nextLifeAt: SCORE.extraLifeEvery,
    keys: { blue: 0, green: 0, brown: 0, purple: 0, cyan: 0 },
    taken: {}, // room id -> true once its item is collected
    opened: {}, // lock id (the keyhole room's id) -> true once unlocked
    visited: {}, // room id -> true
    zoneReached: 1,
    checkpoint: null, // snapshot taken on first entry to each sector; the shell saves it
    room: null,
    player: {
      x: 0, y: 0, r: PLAYER.radius, face: 0, moving: false, aiming: false,
      alive: true, deadT: 0, invulnT: 0, shieldT: 0, boost: false, walk: 0, fireCd: 0,
    },
    shots: [],
    bolts: [],
    foes: [],
    shadow: null,
    item: null,
    events: [],
    banner: null,
    freezeT: 0,
    stats: { kills: 0, deaths: 0, cleared: 0, time: 0 },
    nextId: 1,
  };
  if (from) restore(game, from);
  enterRoom(game, from ? from.roomId : START_ROOM, from ? from.from : null);
  if (!from) game.checkpoint = makeSnapshot(game);
  return game;
}

// Progress that survives a reload: enough to rebuild the game at a sector's first room.
export function makeSnapshot(game) {
  return {
    v: 1,
    skill: game.skill,
    loop: game.loop,
    score: game.score,
    lives: game.lives,
    nextLifeAt: game.nextLifeAt,
    keys: { ...game.keys },
    taken: { ...game.taken },
    opened: { ...game.opened },
    visited: { ...game.visited },
    zoneReached: game.zoneReached,
    roomId: game.room.id,
    from: game.room.from,
    stats: { ...game.stats },
  };
}

function restore(game, s) {
  game.skill = s.skill ?? game.skill;
  game.loop = s.loop ?? 0;
  game.score = s.score ?? 0;
  game.lives = s.lives ?? SKILLS[game.skill].lives;
  game.nextLifeAt = s.nextLifeAt ?? SCORE.extraLifeEvery;
  Object.assign(game.keys, s.keys);
  Object.assign(game.taken, s.taken);
  Object.assign(game.opened, s.opened);
  Object.assign(game.visited, s.visited);
  game.zoneReached = s.zoneReached ?? 1;
  if (s.stats) Object.assign(game.stats, s.stats);
}

export function emit(game, type, data = {}) {
  game.events.push({ type, ...data });
}

export function banner(game, text, color = null, dur = 2.2) {
  game.banner = { text, color, t: 0, dur };
}

export function addScore(game, points) {
  game.score += points;
  while (game.score >= game.nextLifeAt) {
    game.nextLifeAt += SCORE.extraLifeEvery;
    game.lives++;
    emit(game, 'extraLife', { reason: 'score' });
  }
}

// Where the player stands on arrival through `side` (null for the start of the game).
export function entryPoint(room, side, along = null) {
  if (!side) return room.start ? { x: room.start.x, y: room.start.y } : { x: 10.5, y: 6.5 };
  const d = DOOR[side];
  const mid = (d.min + d.max) / 2;
  const a = along === null ? mid : Math.max(d.min + 0.6, Math.min(d.max - 0.6, along));
  const inset = 0.65;
  if (side === 'N') return { x: a, y: d.line + inset };
  if (side === 'S') return { x: a, y: d.line - inset };
  if (side === 'W') return { x: d.line + inset, y: a };
  return { x: d.line - inset, y: a };
}

// Arrive in room `id` through its `side` door (null at the start or after a restart).
export function enterRoom(game, id, side, along = null) {
  const meta = ROOMS[id];
  const geo = getRoom(id);
  const sk = SKILLS[game.skill];
  const prevSerial = game.room ? game.room.serial : 0;
  const locks = {};
  for (const s of Object.keys(geo.exits)) {
    const lock = lockOn(id, s);
    if (lock) locks[s] = { color: lock.color, lockId: lock.id, open: !!game.opened[lock.id] };
  }
  const shadowAt = SHADOW.time[meta.zone] * sk.shadowTime;
  game.room = {
    id,
    zone: meta.zone,
    geo,
    serial: prevSerial + 1,
    from: side,
    entry: entryPoint(geo, side, along),
    t: 0,
    shadowAt: meta.lair ? 2.5 : shadowAt,
    warnAt: meta.lair ? 0 : Math.max(0, shadowAt - SHADOW.warn),
    warned: false,
    cleared: false,
    itemsHidden: false,
    podOn: true,
    locks,
  };
  const p = game.player;
  Object.assign(p, game.room.entry);
  p.moving = false;
  p.aiming = false;
  p.boost = false;
  p.fireCd = 0;
  game.shots.length = 0;
  game.bolts.length = 0;
  game.foes.length = 0;
  game.shadow = null;
  game.freezeT = 0;
  game.item = makeItem(game, meta, geo);

  const firstVisit = !game.visited[id];
  game.visited[id] = true;
  emit(game, 'roomEnter', { id, from: side, zone: meta.zone, firstVisit });
  if (meta.zone > game.zoneReached) {
    game.zoneReached = meta.zone;
    emit(game, 'zoneEnter', { zone: meta.zone });
    game.checkpoint = makeSnapshot(game);
  }
  spawnFoes(game);
}

function makeItem(game, meta, geo) {
  const it = meta.item;
  if (!it) return null;
  if (it.kind === 'keyhole') {
    const spot = geo.keyholeSpot;
    if (!spot) return null;
    return { kind: 'keyhole', color: it.color, x: spot.x, y: spot.y, hidden: false, used: !!game.opened[meta.id] };
  }
  if (game.taken[meta.id] || !geo.itemSpot) return null;
  return { kind: it.kind, color: it.color ?? null, x: geo.itemSpot.x, y: geo.itemSpot.y, hidden: false, used: false };
}

// ------------------------------------------------------------------ hooks for foes and the Shadow
// src/sim/foes.js, shots.js, and shadow.js fill these in.

function spawnFoes(game) {
  void game;
}

// ------------------------------------------------------------------ the step

// input: { x: -1|0|1, y: -1|0|1, fire: boolean }
export function stepGame(game, input) {
  game.events.length = 0;
  if (game.mode === 'gameover' || game.mode === 'won') return;
  game.step++;
  game.t += DT;
  game.stats.time += DT;
  const room = game.room;
  room.t += DT;
  if (game.banner) {
    game.banner.t += DT;
    if (game.banner.t > game.banner.dur) game.banner = null;
  }
  updatePods(game);

  if (game.mode === 'dying') {
    const p = game.player;
    p.deadT += DT;
    if (p.deadT >= PLAYER.deathTime) respawn(game);
    return;
  }

  updatePlayer(game, input);
}

function updatePods(game) {
  const room = game.room;
  const cyc = room.geo.podCycle;
  if (!cyc) return;
  const phase = (room.t % cyc.period) / cyc.period;
  const on = phase >= cyc.open / cyc.period;
  if (on !== room.podOn) emit(game, on ? 'podOn' : 'podOff');
  room.podOn = on;
}

function updatePlayer(game, input) {
  const p = game.player;
  const room = game.room;
  const geo = room.geo;
  p.fireCd = Math.max(0, p.fireCd - DT);
  p.invulnT = Math.max(0, p.invulnT - DT);
  p.shieldT = Math.max(0, p.shieldT - DT);

  const ix = Math.sign(input.x || 0);
  const iy = Math.sign(input.y || 0);
  p.aiming = !!input.fire;
  p.moving = false;
  if (ix || iy) p.face = faceOf(ix, iy);

  if (!p.aiming && (ix || iy)) {
    const speed = PLAYER.speed[room.zone] * (p.boost ? PLAYER.clearBoost : 1);
    const len = Math.hypot(ix, iy);
    const dx = (ix / len) * speed * DT;
    const dy = (iy / len) * speed * DT;
    let nx = p.x + dx;
    let ny = p.y;
    ({ x: nx, y: ny } = pushOutOfBlocks(geo, nx, ny, p.r));
    ny += dy;
    ({ x: nx, y: ny } = pushOutOfBlocks(geo, nx, ny, p.r));
    ({ x: nx, y: ny } = clampToLocks(room, nx, ny, p.r));
    p.moving = Math.hypot(nx - p.x, ny - p.y) > 1e-4;
    p.walk += Math.hypot(nx - p.x, ny - p.y);
    p.x = nx;
    p.y = ny;
  }

  // Electric walls and live pod gates kill on contact.
  if (touchesWall(geo, p.x, p.y, PLAYER.wallRadius)) return killPlayer(game, 'wall');
  if (room.podOn && touchesPod(geo, p.x, p.y, PLAYER.wallRadius)) return killPlayer(game, 'pod');

  touchItem(game);
  checkDoors(game);
}

// A locked door is a solid (but harmless) colored barrier across its opening.
function clampToLocks(room, x, y, r) {
  for (const [side, lock] of Object.entries(room.locks)) {
    if (lock.open) continue;
    const d = DOOR[side];
    const inDoorway = d.axis === 'x' ? x > d.min - 0.2 && x < d.max + 0.2 : y > d.min - 0.2 && y < d.max + 0.2;
    if (!inDoorway) continue;
    const stop = LOCK_FACE + r;
    if (side === 'N') y = Math.max(y, d.line + stop);
    if (side === 'S') y = Math.min(y, d.line - stop);
    if (side === 'W') x = Math.max(x, d.line + stop);
    if (side === 'E') x = Math.min(x, d.line - stop);
  }
  return { x, y };
}

function touchItem(game) {
  const it = game.item;
  const p = game.player;
  if (!it || it.used) return;
  if (Math.hypot(it.x - p.x, it.y - p.y) > p.r + 0.4) {
    if (it.kind === 'keyhole') it.nagged = false;
    return;
  }
  const id = game.room.id;
  if (it.kind === 'keyhole') {
    if (game.keys[it.color] > 0) {
      game.keys[it.color]--;
      game.opened[id] = true;
      it.used = true;
      for (const lock of Object.values(game.room.locks)) if (lock.lockId === id) lock.open = true;
      emit(game, 'keyUse', { color: it.color, x: it.x, y: it.y });
      emit(game, 'doorOpen', { side: ROOMS[id].lock.side, color: it.color });
    } else if (!it.nagged) {
      it.nagged = true;
      emit(game, 'doorLocked', { color: it.color });
      banner(game, `Needs the ${it.color.toUpperCase()} key`, it.color);
    }
    return;
  }
  if (it.hidden) return;
  game.taken[id] = true;
  game.item = null;
  if (it.kind === 'key') {
    game.keys[it.color]++;
    addScore(game, SCORE.key);
    emit(game, 'pickup', { kind: 'key', color: it.color, x: it.x, y: it.y });
    banner(game, `${it.color.toUpperCase()} KEY`, it.color);
  } else if (it.kind === 'life') {
    game.lives++;
    addScore(game, SCORE.life);
    emit(game, 'pickup', { kind: 'life', x: it.x, y: it.y });
    emit(game, 'extraLife', { reason: 'bottle' });
  } else if (it.kind === 'mystery') {
    emit(game, 'pickup', { kind: 'mystery', x: it.x, y: it.y });
    mystery(game, it);
  }
}

// Bonus or disaster. src/sim/foes.js and shadow.js add the outcomes that need them.
function mystery(game, it) {
  const points = (1 + Math.floor(rand(game) * 10)) * 100 * game.room.zone;
  addScore(game, points);
  emit(game, 'mystery', { outcome: 'points', points, x: it.x, y: it.y });
  banner(game, `+${points}`);
}

function checkDoors(game) {
  const p = game.player;
  const room = game.room;
  for (const [side, exit] of Object.entries(room.geo.exits)) {
    const d = DOOR[side];
    const crossed =
      (side === 'N' && p.y < d.line) || (side === 'S' && p.y > d.line) ||
      (side === 'W' && p.x < d.line) || (side === 'E' && p.x > d.line);
    if (!crossed) continue;
    const along = d.axis === 'x' ? p.x : p.y;
    emit(game, 'roomExit', { side, to: exit.to });
    enterRoom(game, exit.to, OPPOSITE[side], along);
    return;
  }
}

export function killPlayer(game, cause) {
  const p = game.player;
  if (!p.alive) return;
  p.alive = false;
  p.deadT = 0;
  game.mode = 'dying';
  game.stats.deaths++;
  emit(game, 'playerDie', { cause, x: p.x, y: p.y });
}

function respawn(game) {
  const p = game.player;
  game.lives--;
  if (game.lives <= 0) {
    game.lives = 0;
    game.mode = 'gameover';
    emit(game, 'gameOver', { score: game.score });
    return;
  }
  p.alive = true;
  p.deadT = 0;
  p.invulnT = PLAYER.respawnInvuln;
  game.mode = 'play';
  enterRoom(game, game.room.id, game.room.from);
  emit(game, 'respawn', {});
}

export { LOCKS };
