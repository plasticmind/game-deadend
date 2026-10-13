#!/usr/bin/env node
// Check every room layout against the map, and the whole lair for a winnable key order.
//
//   node tools/check-rooms.mjs            all rooms
//   node tools/check-rooms.mjs 12 13 40   only these rooms (the lair check still runs)
//   node tools/check-rooms.mjs --show 12  print a room with its reachable floor marked
//
// A room passes when: its layout parses (border, doors, legal cells); its markers match
// map.js (one '*' for a key, mystery, or life; one 'H' for a keyhole; 'S' in room 0;
// 'P' gates only in pod rooms); every door, the item, the keyhole, and every spawn are
// reachable by the player's body from every door; each door's landing zone is safe;
// and there are enough spawn points far from each door.

import { ROOMS, LOCKS, START_ROOM, LAIR_ROOM, POD_ROOMS, lockOn } from '../src/map.js';
import { ROOM_DEFS } from '../src/rooms/index.js';
import { parseRoom, placeholderDef, wallDistance, blockAt, CELL, WALL_HALF, DOOR, W, H } from '../src/room.js';
import { entryPoint } from '../src/sim/game.js';
import { PLAYER, FOES } from '../src/sim/tuning.js';

const args = process.argv.slice(2);
const show = args.includes('--show');
const only = args.filter((a) => /^\d+$/.test(a)).map(Number);
const ids = only.length ? only : ROOMS.map((r) => r.id);

const STEP = 0.25;
const NX = Math.round(W / STEP) + 1;
const NY = Math.round(H / STEP) + 1;
const BODY = PLAYER.wallRadius + 0.08; // a little margin over the real wall test
const N_RANGE = [null, [2, 4], [3, 6], [4, 7], [5, 9]];

let failures = 0;
let placeholders = 0;
const warn = [];

function fail(id, msg) {
  failures++;
  console.log(`  room ${id}: ${msg}`);
}

// Sample points the player's center can occupy, ignoring pod gates (they open on a timer)
// and treating locked doors as open (the other side of a lock is a room of its own).
function safeGrid(room) {
  const safe = new Uint8Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const x = i * STEP;
      const y = j * STEP;
      if (x < 0.25 || y < 0.25 || x > W - 0.25 || y > H - 0.25) continue;
      if (wallDistance(room, x, y, CELL.WALL) < WALL_HALF + BODY) continue;
      if (blockAt(room, x, y, PLAYER.radius)) continue;
      safe[j * NX + i] = 1;
    }
  }
  return safe;
}

function flood(safe, x, y) {
  const seen = new Uint8Array(NX * NY);
  const start = nearestSafe(safe, x, y);
  if (start < 0) return seen;
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const k = q.pop();
    const i = k % NX;
    const j = (k - i) / NX;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
      const kk = jj * NX + ii;
      if (!safe[kk] || seen[kk]) continue;
      seen[kk] = 1;
      q.push(kk);
    }
  }
  return seen;
}

function nearestSafe(safe, x, y, maxR = 0.6) {
  let best = -1;
  let bd = Infinity;
  for (let j = Math.max(0, Math.floor((y - maxR) / STEP)); j <= Math.min(NY - 1, Math.ceil((y + maxR) / STEP)); j++) {
    for (let i = Math.max(0, Math.floor((x - maxR) / STEP)); i <= Math.min(NX - 1, Math.ceil((x + maxR) / STEP)); i++) {
      const k = j * NX + i;
      if (!safe[k]) continue;
      const d = Math.hypot(i * STEP - x, j * STEP - y);
      if (d < bd && d <= maxR) { bd = d; best = k; }
    }
  }
  return best;
}

const reached = (seen, safe, x, y) => {
  const k = nearestSafe(safe, x, y);
  return k >= 0 && seen[k] === 1;
};

function checkRoom(id) {
  const meta = ROOMS[id];
  const def = ROOM_DEFS[id];
  if (!def) placeholders++;
  let room;
  try {
    room = parseRoom(def ?? placeholderDef(id), meta);
  } catch (e) {
    return fail(id, e.message);
  }
  if (!def) return room;

  // Markers against the map.
  const kind = meta.item?.kind;
  if (kind === 'keyhole') {
    if (!room.keyholeSpot) fail(id, `keyhole room needs an 'H'`);
    if (room.itemSpot) fail(id, `keyhole room should have no '*'`);
  } else if (kind) {
    if (!room.itemSpot) fail(id, `needs a '*' for its ${kind}${meta.item.color ? ` (${meta.item.color})` : ''}`);
    if (room.keyholeSpot) fail(id, `has an 'H' but no keyhole on the map`);
  } else {
    if (room.itemSpot && id !== LAIR_ROOM) fail(id, `has a '*' but no item on the map`);
    if (room.keyholeSpot) fail(id, `has an 'H' but no keyhole on the map`);
  }
  if (id === START_ROOM && !room.start) fail(id, `the start room needs an 'S'`);
  if (id !== START_ROOM && room.start) fail(id, `only room ${START_ROOM} has an 'S'`);
  if (meta.pod && !room.podPosts.length) fail(id, `pod room needs 'P' gate cells`);
  if (!meta.pod && room.podPosts.length) fail(id, `'P' gates belong only in pod rooms (${POD_ROOMS.join(', ')})`);

  // Robot count and spawns.
  const [lo, hi] = id === LAIR_ROOM ? [0, 9] : N_RANGE[meta.zone];
  if (!(room.n >= lo && room.n <= hi)) fail(id, `n is ${room.n}; sector ${meta.zone} rooms take ${lo} to ${hi}`);
  if (room.spawns.length < Math.max(4, room.n + 2)) fail(id, `needs at least ${Math.max(4, room.n + 2)} 'e' spawns (has ${room.spawns.length})`);

  // Reachability for the player's body.
  const safe = safeGrid(room);
  const doors = Object.keys(room.exits);
  const targets = [];
  for (const side of doors) targets.push([`door ${side}`, entryPoint(room, side)]);
  if (room.itemSpot) targets.push(['item', room.itemSpot]);
  if (room.keyholeSpot) targets.push(['keyhole', room.keyholeSpot]);
  if (room.start) targets.push(['start', room.start]);
  room.spawns.forEach((s, i) => targets.push([`spawn ${i + 1} at ${s.c},${s.r}`, s]));

  const starts = doors.length ? doors.map((s) => [`door ${s}`, entryPoint(room, s)]) : [['start', room.start]];
  if (room.start && doors.length) starts.push(['start', room.start]);
  for (const [fromName, from] of starts) {
    const seen = flood(safe, from.x, from.y);
    for (const [name, p] of targets) {
      if (!reached(seen, safe, p.x, p.y)) fail(id, `${name} is unreachable from ${fromName}`);
    }
    if (show && fromName === starts[0][0]) printReach(room, seen);
  }

  // Landing zones: everything within 1.1 of each door's entry line is safe, and the
  // doorway itself (in front of a lock barrier for locked doors) is clear of blocks.
  for (const side of doors) {
    const d = DOOR[side];
    for (let a = d.min + 0.6; a <= d.max - 0.6 + 1e-6; a += 0.3) {
      const e = entryPoint(room, side, a);
      for (const depth of [0, 0.5, 1.0]) {
        const inward = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }[side];
        const x = e.x + inward[0] * depth;
        const y = e.y + inward[1] * depth;
        if (wallDistance(room, x, y, CELL.WALL) < WALL_HALF + PLAYER.wallRadius + 0.25) {
          fail(id, `door ${side} landing at ${x.toFixed(1)},${y.toFixed(1)} is too close to a wall`);
          break;
        }
        if (blockAt(room, x, y, PLAYER.radius)) {
          fail(id, `door ${side} landing at ${x.toFixed(1)},${y.toFixed(1)} is blocked by a crate`);
          break;
        }
      }
    }
  }

  // Spawns far from each door.
  for (const side of doors) {
    const e = entryPoint(room, side);
    const far = room.spawns.filter((s) => Math.hypot(s.x - e.x, s.y - e.y) >= FOES.minSpawnDist).length;
    if (far < Math.min(room.n, 3)) fail(id, `only ${far} spawns are ${FOES.minSpawnDist}+ from door ${side}`);
  }
  if (room.keyholeSpot) {
    const lock = meta.lock;
    const d = DOOR[lock.side];
    const k = room.keyholeSpot;
    const dist = Math.hypot(k.x - d.center.x, k.y - d.center.y);
    if (dist > 6) warn.push(`room ${id}: keyhole is ${dist.toFixed(1)} from its door; players look for it near the lock`);
  }
  return room;
}

function printReach(room, seen) {
  console.log(`\n  room ${room.id} (reachable from first door marked with ':')`);
  for (let r = 0; r < H; r++) {
    let line = '  ';
    for (let c = 0; c < W; c++) {
      const ch = room.layout[r][c];
      const i = Math.round((c + 0.5) / STEP);
      const j = Math.round((r + 0.5) / STEP);
      line += ch === '.' && seen[j * NX + i] ? ':' : ch;
    }
    console.log(line);
  }
}

// The whole lair: search every order of collecting keys and using them, and check the
// Shadow's room is reachable from the start, and from every state a player can reach
// (no key spent in a way that strands them).
function checkLair() {
  const keyRooms = ROOMS.filter((r) => r.item?.kind === 'key');
  const enc = (opened, got) => `${opened}|${got}`;
  const reach = (opened) => {
    const seen = new Set([START_ROOM]);
    const q = [START_ROOM];
    while (q.length) {
      const id = q.pop();
      for (const [side, to] of Object.entries(ROOMS[id].exits)) {
        const lockIdx = LOCKS.indexOf(lockOn(id, side));
        if (lockIdx >= 0 && !(opened & (1 << lockIdx))) continue;
        if (!seen.has(to)) { seen.add(to); q.push(to); }
      }
    }
    return seen;
  };
  const held = (opened, got) => {
    const n = {};
    keyRooms.forEach((r, i) => { if (got & (1 << i)) n[r.item.color] = (n[r.item.color] || 0) + 1; });
    LOCKS.forEach((l, i) => { if (opened & (1 << i)) n[l.color]--; });
    return n;
  };
  const states = new Map();
  const q = [[0, 0]];
  states.set(enc(0, 0), []);
  while (q.length) {
    const [opened, got] = q.shift();
    const rooms = reach(opened);
    const next = [];
    keyRooms.forEach((r, i) => { if (!(got & (1 << i)) && rooms.has(r.id)) next.push([opened, got | (1 << i)]); });
    const h = held(opened, got);
    LOCKS.forEach((l, i) => { if (!(opened & (1 << i)) && rooms.has(l.room) && (h[l.color] || 0) > 0) next.push([opened | (1 << i), got]); });
    states.get(enc(opened, got)).push(...next.map(([o, g]) => enc(o, g)));
    for (const [o, g] of next) if (!states.has(enc(o, g))) { states.set(enc(o, g), []); q.push([o, g]); }
  }
  const wins = new Set();
  for (const key of states.keys()) {
    const [o] = key.split('|').map(Number);
    if (reach(o).has(LAIR_ROOM)) wins.add(key);
  }
  // Backward closure: states that can still reach a win.
  let changed = true;
  const good = new Set(wins);
  while (changed) {
    changed = false;
    for (const [key, outs] of states) if (!good.has(key) && outs.some((o) => good.has(o))) { good.add(key); changed = true; }
  }
  const stuck = [...states.keys()].filter((k) => !good.has(k));
  console.log(`lair: ${states.size} key states, ${wins.size} reach room ${LAIR_ROOM}, ${stuck.length} dead ends`);
  if (!wins.size) { failures++; console.log('  the lair cannot be finished'); }
  if (stuck.length) { failures++; console.log(`  a player can strand themselves: ${stuck.slice(0, 3).join(', ')}`); }
  const all = reach((1 << LOCKS.length) - 1);
  const orphans = ROOMS.filter((r) => !all.has(r.id)).map((r) => r.id);
  if (orphans.length) { failures++; console.log(`  rooms no one can reach: ${orphans.join(', ')}`); }
}

console.log(`checking ${ids.length} room${ids.length === 1 ? '' : 's'}`);
for (const id of ids) checkRoom(id);
checkLair();
for (const w of warn) console.log(`  note: ${w}`);
if (placeholders) console.log(`${placeholders} room${placeholders === 1 ? '' : 's'} still use the placeholder layout`);
console.log(failures ? `${failures} problem${failures === 1 ? '' : 's'}` : 'all good');
process.exit(failures ? 1 : 0);
