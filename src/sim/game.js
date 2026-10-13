// The game state and its fixed-step update. Deterministic: same seed, same inputs,
// same game. No DOM, no Three.js, no clocks; tools/sim-test.mjs runs it in Node.
// docs/DESIGN.md lists every field the renderer and the shell may read.
//
// Robots live in foes.js, shots and bolts in shots.js, the Shadow in shadow.js, and
// the helpers they share (events, score, death) in core.js.

import { ROOMS, START_ROOM, OPPOSITE, LOCKS, lockOn } from '../map.js';
import { getRoom } from '../rooms/index.js';
import { W, DOOR, LOCK_FACE, touchesWall, touchesPod, pushOutOfBlocks } from '../room.js';
import { DT, SKILLS, PLAYER, SCORE, SHADOW, MYSTERY } from './tuning.js';
import { rand } from './rng.js';
import { emit, banner, addScore, gainLife, canHurt, killPlayer, faceOf, dirOf } from './core.js';
import { spawnFoes, updateFoes } from './foes.js';
import { tryFire, updateProjectiles } from './shots.js';
import { updateShadowClock, updateShadow, summonShadow } from './shadow.js';

export { DT, emit, banner, addScore, killPlayer, faceOf, dirOf };

const TRAIL_MAX = 400; // cells of scent a sniffer can follow in one visit

// cheats: { invuln, noShadow, noFoes } to start with (tests and the dev console).
export function createGame({ skill = 1, seed = 1, from = null, cheats = null } = {}) {
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
    lairHp: null, // the Shadow's hits left in the lair once the fight has started
    checkpoint: null, // snapshot taken on first entry to each sector; the shell saves it
    room: null,
    player: {
      x: 0, y: 0, r: PLAYER.radius, face: 0, moving: false, aiming: false,
      alive: true, deadT: 0, invulnT: 0, shieldT: 0, boost: false, walk: 0, fireCd: 0,
      fireHeld: false, wantShot: false,
      // Mouse aiming: freeAim is true while he runs and guns toward the cursor, along the
      // unit vector (aimX, aimY).
      freeAim: false, aimX: 1, aimY: 0, queueT: 0,
    },
    shots: [],
    bolts: [],
    foes: [],
    shadow: null,
    item: null,
    trail: [], // cells Shamus walked this visit, oldest first (the sniffers' scent)
    events: [],
    banner: null,
    freezeT: 0,
    stats: { kills: 0, deaths: 0, cleared: 0, time: 0 },
    cheats: { invuln: false, noShadow: false, noFoes: false, ...cheats },
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
    lairHp: game.lairHp,
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
  game.lairHp = s.lairHp ?? null;
  if (s.stats) Object.assign(game.stats, s.stats);
}

// After a win: keep the score and lives, forget the lair, and start again one skill
// level harder (the original restarts harder too). The shell calls this from the win
// screen.
export function newLoop(game) {
  game.loop++;
  game.skill = Math.min(SKILLS.length - 1, game.skill + 1);
  for (const k of Object.keys(game.keys)) game.keys[k] = 0;
  for (const bag of [game.taken, game.opened, game.visited]) for (const k of Object.keys(bag)) delete bag[k];
  game.zoneReached = 1;
  game.lairHp = null;
  game.mode = 'play';
  const p = game.player;
  p.alive = true;
  p.deadT = 0;
  p.invulnT = 0;
  p.shieldT = 0;
  game.events.length = 0;
  enterRoom(game, START_ROOM, null);
  game.checkpoint = makeSnapshot(game);
  banner(game, `CASE ${game.loop + 1}: ${SKILLS[game.skill].name.toUpperCase()}`, null, 3);
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
  const lair = !!meta.lair;
  game.room = {
    id,
    zone: meta.zone,
    geo,
    serial: prevSerial + 1,
    from: side,
    entry: entryPoint(geo, side, along),
    t: 0,
    lair,
    shadowAt: lair ? SHADOW.lair.delay : shadowAt,
    warnAt: lair ? 0 : Math.max(0, shadowAt - SHADOW.warn),
    warned: false,
    shadowCame: false,
    cleared: false,
    foesSpawned: 0,
    itemsHidden: false,
    podOn: true,
    locks,
  };
  const p = game.player;
  Object.assign(p, game.room.entry);
  p.moving = false;
  p.aiming = false;
  p.freeAim = false;
  p.queueT = 0;
  p.boost = false;
  p.fireCd = 0;
  p.wantShot = false;
  game.shots.length = 0;
  game.bolts.length = 0;
  game.foes.length = 0;
  game.shadow = null;
  game.freezeT = 0;
  game.trail.length = 0;
  game.trail.push(Math.floor(p.y) * W + Math.floor(p.x));
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

// ------------------------------------------------------------------ the step

// input: { x: -1|0|1, y: -1|0|1, fire: boolean, aim?: { x, y } }
// `aim` is a point in room cells (the mouse cursor). With it, fire shoots toward that
// point and Shamus keeps walking; without it, fire plants his feet the original way.
export function stepGame(game, input = {}) {
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
    // The world holds still while Shamus goes down.
    const p = game.player;
    p.deadT += DT;
    if (p.deadT >= PLAYER.deathTime) respawn(game);
    return;
  }

  const serial = room.serial;
  updatePlayer(game, input);
  if (game.room.serial !== serial || game.mode !== 'play') return;
  updateShadowClock(game);
  updateShadow(game);
  if (game.mode !== 'play') return;
  updateFoes(game);
  if (game.mode !== 'play') return;
  updateProjectiles(game);
  if (game.freezeT > 0) game.freezeT = Math.max(0, game.freezeT - DT);
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

  // While the beaten Shadow goes down, Shamus watches (and can't wander out of the lair
  // before the win).
  const held = game.shadow && game.shadow.state === 'dying';
  const ix = held ? 0 : Math.sign(input.x || 0);
  const iy = held ? 0 : Math.sign(input.y || 0);
  const fire = held ? false : !!input.fire;
  const aim = held ? null : input.aim;
  p.moving = false;
  if (aim) {
    // Mouse aiming: run and gun. Holding the button keeps firing as fast as the
    // ION-SHIVs come back, and a quick click that lands while none is free waits a moment
    // for one (the shell keeps sending `aim` briefly after a release for this). He faces
    // the cursor while he shoots.
    const ax = aim.x - p.x;
    const ay = aim.y - p.y;
    const len = Math.hypot(ax, ay);
    if (len > 0.05) {
      p.aimX = ax / len;
      p.aimY = ay / len;
    }
    p.queueT = fire && !p.fireHeld ? PLAYER.clickBuffer : Math.max(0, p.queueT - DT);
    p.fireHeld = fire;
    p.wantShot = false;
    p.aiming = false;
    p.freeAim = fire || p.queueT > 0;
    if (p.freeAim) p.face = faceOf(p.aimX, p.aimY);
    else if (ix || iy) p.face = faceOf(ix, iy);
    if (p.freeAim && tryFire(game, p.aimX, p.aimY, PLAYER.mouseCooldown)) p.queueT = 0;
  } else {
    // Fire plants Shamus's feet. A held direction aims and fires along it (again and
    // again while held); a press with no direction fires once along his facing.
    if (fire && !p.fireHeld) p.wantShot = true;
    if (!fire) p.wantShot = false;
    p.fireHeld = fire;
    p.aiming = fire;
    p.freeAim = false;
    p.queueT = 0;
    if (ix || iy) p.face = faceOf(ix, iy);
    if (fire && (ix || iy || p.wantShot) && tryFire(game)) p.wantShot = false;
  }

  if (!p.aiming && (ix || iy)) {
    const { x: nx, y: ny } = previewMove(game, ix, iy);
    p.moving = Math.hypot(nx - p.x, ny - p.y) > 1e-4;
    p.walk += Math.hypot(nx - p.x, ny - p.y);
    p.x = nx;
    p.y = ny;
    const cell = Math.floor(p.y) * W + Math.floor(p.x);
    const trail = game.trail;
    if (trail[trail.length - 1] !== cell && trail.length < TRAIL_MAX) trail.push(cell);
  }

  // Electric walls and live pod gates kill on contact.
  if (touchesWall(geo, p.x, p.y, PLAYER.wallRadius) && canHurt(game, 'wall')) return killPlayer(game, 'wall');
  if (room.podOn && touchesPod(geo, p.x, p.y, PLAYER.wallRadius) && canHurt(game, 'pod')) return killPlayer(game, 'pod');

  touchItem(game);
  checkDoors(game);
}

// Where one step of walking along (ix, iy) takes Shamus: blocks push him aside and
// locked doors stop him. Autopilots (tools/tour.mjs) use it to look before they step.
export function previewMove(game, ix, iy) {
  const p = game.player;
  const room = game.room;
  const geo = room.geo;
  const speed = PLAYER.speed[room.zone] * (p.boost ? PLAYER.clearBoost : 1);
  const len = Math.hypot(ix, iy) || 1;
  const dx = (ix / len) * speed * DT;
  const dy = (iy / len) * speed * DT;
  let nx = p.x + dx;
  let ny = p.y;
  ({ x: nx, y: ny } = pushOutOfBlocks(geo, nx, ny, p.r));
  ny += dy;
  ({ x: nx, y: ny } = pushOutOfBlocks(geo, nx, ny, p.r));
  return clampToLocks(room, nx, ny, p.r);
}

// A locked door is a solid (but harmless) colored barrier across its opening.
function clampToLocks(room, x, y, r) {
  for (const side in room.locks) {
    const lock = room.locks[side];
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
    addScore(game, SCORE.life);
    emit(game, 'pickup', { kind: 'life', color: null, x: it.x, y: it.y });
    if (gainLife(game, 'bottle')) banner(game, 'EXTRA LIFE');
  } else if (it.kind === 'mystery') {
    emit(game, 'pickup', { kind: 'mystery', color: null, x: it.x, y: it.y });
    mystery(game, it);
  }
}

// Bonus or disaster: points (most often), a life, a shield, frozen robots, or the
// Shadow, right now. An outcome that would do nothing turns into points.
function mystery(game, it) {
  const room = game.room;
  let total = 0;
  for (const [, w] of MYSTERY.weights) total += w;
  let u = rand(game) * total;
  let outcome = 'points';
  for (const [name, w] of MYSTERY.weights) {
    u -= w;
    if (u < 0) { outcome = name; break; }
  }
  if (outcome === 'life' && game.lives >= PLAYER.maxLives) outcome = 'points';
  if (outcome === 'freeze' && !game.foes.length) outcome = 'points';
  if (outcome === 'shadow' && (room.shadowCame || room.lair || game.cheats.noShadow)) outcome = 'points';
  let points = 0;
  if (outcome === 'points') {
    points = (1 + Math.floor(rand(game) * 10)) * 100 * room.zone;
    addScore(game, points);
    banner(game, `+${points}`);
  } else if (outcome === 'life') {
    gainLife(game, 'mystery');
    banner(game, 'EXTRA LIFE');
  } else if (outcome === 'shield') {
    game.player.shieldT = MYSTERY.shield;
    banner(game, 'SHIELD');
  } else if (outcome === 'freeze') {
    game.freezeT = MYSTERY.freeze;
    for (const b of game.bolts) emit(game, 'boltHit', { x: b.x, y: b.y, what: 'freeze' });
    game.bolts.length = 0;
    banner(game, 'ROBOTS FROZEN');
  } else if (outcome === 'shadow') {
    summonShadow(game, MYSTERY.shadowDelay);
    banner(game, 'THE SHADOW!');
  }
  emit(game, 'mystery', { outcome, points, x: it.x, y: it.y });
}

function checkDoors(game) {
  const p = game.player;
  const room = game.room;
  for (const side in room.geo.exits) {
    const exit = room.geo.exits[side];
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
