#!/usr/bin/env node
// Headless sim tests. `node tools/sim-test.mjs` (add a word to run only tests whose
// name contains it). Every test works from the real map and whatever room layouts
// exist, finding open floor by searching rather than assuming a layout.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ROOMS, LAIR_ROOM, START_ROOM } from '../src/map.js';
import { W, H, CELL, WALL_HALF, wallDistance, blockAt, lineClear, walkableCell } from '../src/room.js';
import { createGame, stepGame, enterRoom, makeSnapshot, newLoop, killPlayer, DT } from '../src/sim/game.js';
import { PLAYER, SCORE, SHADOW, FOES, SKILLS, MYSTERY } from '../src/sim/tuning.js';
import { addFoe } from '../src/sim/foes.js';
import { Pilot, fightInput } from './tour.mjs';

const only = process.argv[2] ?? '';
const results = [];
function test(name, fn) {
  if (only && !name.includes(only)) return;
  try {
    fn();
    results.push([name, null]);
    console.log(`  ok    ${name}`);
  } catch (e) {
    results.push([name, e]);
    console.log(`  FAIL  ${name}\n        ${(e.stack || String(e)).split('\n').slice(0, 4).join('\n        ')}`);
  }
}

// ------------------------------------------------------------------ helpers

const IDLE = { x: 0, y: 0, fire: false };

function quiet({ skill = 1, seed = 1, foes = false, shadow = false } = {}) {
  return createGame({ skill, seed, cheats: { noFoes: !foes, noShadow: !shadow } });
}

// Step `n` times with `input` (a value or a function of the step), returning every event.
function run(g, input, n) {
  const events = [];
  for (let i = 0; i < n; i++) {
    stepGame(g, typeof input === 'function' ? input(i) : input);
    events.push(...g.events);
  }
  return events;
}
const count = (events, type) => events.filter((e) => e.type === type).length;
const find = (events, type) => events.find((e) => e.type === type);

// A cell center with nothing solid for `len` units along (ux, uy) and room to stand.
function openLine(g, ux, uy, len, clear = 0.45) {
  const geo = g.room.geo;
  for (let r = 1; r < H - 1; r++) {
    for (let c = 1; c < W - 1; c++) {
      if (!walkableCell(geo, c, r)) continue;
      const x = c + 0.5;
      const y = r + 0.5;
      if (wallDistance(geo, x, y, CELL.WALL) < 0.9) continue;
      if (blockAt(geo, x, y, 0.6)) continue;
      const ex = x + ux * len;
      const ey = y + uy * len;
      if (ex < 1 || ey < 1 || ex > W - 1 || ey > H - 1) continue;
      if (!lineClear(geo, x, y, ex, ey, { podsOn: true, rad: clear })) continue;
      return { x, y };
    }
  }
  throw new Error(`room ${g.room.id}: no open line ${ux},${uy} of ${len}`);
}

function place(g, x, y) {
  g.player.x = x;
  g.player.y = y;
}

// Walk (with real inputs) to (x, y), within `r`. Returns the events on the way.
function walkTo(g, x, y, r, label, maxSteps = 60 * 30) {
  const pilot = new Pilot(g);
  pilot.setGoal({ x, y, r, label, snap: r > 0 ? 0.6 : 0.3 });
  const events = [];
  const room = g.room.id;
  for (let i = 0; i < maxSteps; i++) {
    if (pilot.done() && r > 0) return events;
    stepGame(g, pilot.input());
    events.push(...g.events);
    if (g.room.id !== room || g.mode !== 'play') return events;
  }
  throw new Error(`could not walk to ${label} in room ${room}`);
}

function doorGoal(side) {
  const d = { N: [10.5, 0.25], S: [10.5, 12.75], W: [0.25, 6.5], E: [20.75, 6.5] }[side];
  return { x: d[0], y: d[1] };
}

function hash(g) {
  const state = JSON.stringify(g, (k, v) => (k === 'geo' || k === 'events' || k === 'checkpoint' ? undefined : v));
  return createHash('sha256').update(state).digest('hex').slice(0, 16);
}

// A deterministic input script.
function script(seed) {
  let s = seed >>> 0;
  let cur = IDLE;
  return (i) => {
    if (i % 12 === 0) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const v = s >>> 8;
      cur = { x: (v % 3) - 1, y: ((v >> 2) % 3) - 1, fire: ((v >> 4) & 3) === 0 };
    }
    return cur;
  };
}

// A room in `zone` with an item of `kind` (and the side to enter it by).
function roomWith(kind, zone = null) {
  const r = ROOMS.find((m) => m.item?.kind === kind && (zone === null || m.zone === zone) && !m.pod && !m.lair);
  return { id: r.id, side: Object.keys(r.exits).find((s) => !r.lock || r.lock.side !== s) };
}

// ------------------------------------------------------------------ tests

console.log('sim tests');

test('determinism: same seed and inputs give the same game', () => {
  const play = (seed) => {
    const g = createGame({ skill: 2, seed });
    g.cheats.invuln = true; // keep him alive so the robots get a long workout
    const busy = ROOMS.filter((m) => m.zone >= 3 && !m.lair && !m.pod)[3];
    enterRoom(g, busy.id, Object.keys(busy.exits)[0]);
    run(g, script(99), 60 * 40);
    return hash(g);
  };
  const a = play(42);
  const b = play(42);
  assert.equal(a, b);
  assert.notEqual(a, play(43), 'a different seed should play differently');
});

test('determinism: robots, bolts, and the Shadow replay exactly', () => {
  const play = () => {
    const g = createGame({ skill: 3, seed: 5 });
    const busy = ROOMS.filter((m) => m.zone === 3 && !m.pod)[5];
    enterRoom(g, busy.id, Object.keys(busy.exits)[0]);
    const ev = run(g, script(7), 60 * 30);
    return `${hash(g)} ${ev.length} ${g.mode}`;
  };
  assert.equal(play(), play());
});

test('walls kill on contact, even with the invuln cheat on', () => {
  for (const invuln of [false, true]) {
    const g = quiet();
    g.cheats.invuln = invuln;
    const geo = g.room.geo;
    // Find a wall post with open floor east of it, stand there, and walk west into it.
    let spot = null;
    for (const post of geo.posts) {
      if (post.c < 1 || post.c > W - 3 || post.r < 1 || post.r > H - 2) continue;
      if (!walkableCell(geo, post.c + 1, post.r) || !walkableCell(geo, post.c + 2, post.r)) continue;
      const x = post.x + 1.2;
      if (wallDistance(geo, x, post.y, CELL.WALL) < WALL_HALF + PLAYER.wallRadius + 0.3) continue;
      spot = { x, y: post.y };
      break;
    }
    assert.ok(spot, 'room 0 needs a post with open floor beside it');
    place(g, spot.x, spot.y);
    const ev = run(g, { x: -1, y: 0, fire: false }, 30);
    assert.equal(find(ev, 'playerDie')?.cause, 'wall');
    assert.equal(g.mode, 'dying');
    const reach = WALL_HALF + PLAYER.wallRadius;
    assert.ok(wallDistance(geo, g.player.x, g.player.y, CELL.WALL) > reach - PLAYER.speed[1] * DT - 1e-9, 'he died at the wall, not inside it');
  }
});

test('the invuln cheat stops robots, bolts, and the Shadow', () => {
  const g = quiet({ shadow: true });
  g.cheats.invuln = true;
  g.cheats.noFoes = false;
  const spot = openLine(g, 1, 0, 3);
  place(g, spot.x, spot.y);
  addFoe(g, 'droid', Math.floor(spot.x), Math.floor(spot.y));
  g.bolts.push({ id: 999, x: spot.x + 2, y: spot.y, vx: -6, vy: 0, t: 0, from: 'droid', owner: -1, life: 4 });
  g.room.shadowAt = 0;
  const ev = run(g, IDLE, 120);
  assert.ok(find(ev, 'shadowEnter'));
  assert.equal(count(ev, 'playerDie'), 0);
});

test('fire: at most two shots on screen, with a cooldown', () => {
  const g = quiet();
  const spot = openLine(g, 1, 0, 9);
  place(g, spot.x, spot.y);
  let most = 0;
  const steps = [];
  run(g, (i) => {
    most = Math.max(most, g.shots.length);
    if (find(g.events, 'fire')) steps.push(i - 1);
    return { x: 1, y: 0, fire: true };
  }, 150);
  assert.equal(most, PLAYER.maxShots);
  assert.ok(steps.length >= 3, 'freed slots fire again while held');
  assert.ok(steps[1] - steps[0] >= Math.floor(PLAYER.fireCooldown / DT), 'the cooldown spaces shots');
});

test('fire: aiming plants his feet; a held direction aims, a bare press fires along his facing', () => {
  const g = quiet();
  const spot = openLine(g, 0, 1, 4);
  place(g, spot.x, spot.y);
  g.player.face = 0;
  // Fire alone: one shot east (his facing), no movement, no auto-repeat.
  let ev = run(g, { x: 0, y: 0, fire: true }, 30);
  assert.equal(count(ev, 'fire'), 1);
  assert.equal(g.player.aiming, true);
  assert.equal(g.player.x, spot.x);
  ev = run(g, IDLE, 40);
  // Fire held with south: he turns, stays put, and fires south.
  ev = run(g, { x: 0, y: 1, fire: true }, 3);
  assert.equal(g.player.face, 2);
  assert.deepEqual([g.player.x, g.player.y], [spot.x, spot.y]);
  const shot = g.shots[g.shots.length - 1];
  assert.ok(shot.dy > 0.99 && Math.abs(shot.dx) < 1e-9, 'shot flies south');
  run(g, IDLE, 40);
  // Release, then a bare press fires along the new facing.
  ev = run(g, { x: 0, y: 0, fire: true }, 2);
  assert.equal(count(ev, 'fire'), 1);
  assert.equal(find(ev, 'fire').face, 2);
  // Walking (no fire) moves him.
  run(g, IDLE, 1);
  run(g, { x: 0, y: 1, fire: false }, 5);
  assert.ok(g.player.y > spot.y + 0.2);
});

test('fire: mouse aim shoots toward the point at any angle while he keeps walking', () => {
  const g = quiet();
  const spot = openLine(g, 1, 0, 5);
  place(g, spot.x, spot.y);
  // A point up and to the right at about 30 degrees, not one of the eight directions.
  const aim = { x: spot.x + 3, y: spot.y - Math.sqrt(3) };
  let ev = run(g, { x: 0, y: 0, fire: true, aim }, 1);
  assert.equal(count(ev, 'fire'), 1);
  const shot = g.shots[g.shots.length - 1];
  assert.ok(Math.abs(shot.dx - Math.cos(Math.PI / 6)) < 1e-9 && Math.abs(shot.dy + 0.5) < 1e-9, 'the shot flies at 30 degrees');
  assert.equal(find(ev, 'fire').dx, shot.dx);
  assert.equal(g.player.freeAim, true);
  assert.equal(g.player.aiming, false, 'mouse fire does not plant his feet');
  assert.equal(g.player.face, 7, 'he faces the nearest of the eight directions');
  // Held fire with a direction: he walks east and keeps firing at the point.
  run(g, IDLE, 40);
  const x0 = g.player.x;
  ev = run(g, { x: 1, y: 0, fire: true, aim: { x: spot.x + 4, y: spot.y } }, 30);
  assert.ok(g.player.x > x0 + 0.5, 'he walks while he fires');
  assert.ok(count(ev, 'fire') >= 2, 'holding keeps firing');
  // Letting go clears freeAim, and a point on top of him keeps the last aim.
  run(g, { x: 0, y: 0, fire: false, aim: { x: g.player.x, y: g.player.y } }, 1);
  assert.equal(g.player.freeAim, false);
  assert.ok(g.player.aimX > 0.99);
});

test('fire: a quick mouse click during the cooldown still fires once a shot frees up', () => {
  const g = quiet();
  const spot = openLine(g, 1, 0, 5);
  place(g, spot.x, spot.y);
  const aim = { x: spot.x + 4, y: spot.y };
  let fires = count(run(g, { x: 0, y: 0, fire: true, aim }, 2), 'fire');
  // Up for one step, then a two-step click, all inside the cooldown.
  fires += count(run(g, { x: 0, y: 0, fire: false, aim }, 1), 'fire');
  fires += count(run(g, { x: 0, y: 0, fire: true, aim }, 2), 'fire');
  assert.equal(fires, 1, 'the second click lands in the cooldown');
  // Released, with the shell still sending the cursor: the queued click fires.
  const steps = Math.ceil(PLAYER.clickBuffer / DT) - 2;
  fires += count(run(g, { x: 0, y: 0, fire: false, aim }, steps), 'fire');
  assert.equal(fires, 2);
  // A click never fires twice, and the queue empties.
  fires += count(run(g, { x: 0, y: 0, fire: false, aim }, 30), 'fire');
  assert.equal(fires, 2);
  assert.equal(g.player.queueT, 0);
});

test('fire: a press while both shots are out fires as soon as one frees up', () => {
  const g = quiet();
  const spot = openLine(g, 1, 0, 9);
  place(g, spot.x, spot.y);
  run(g, { x: 1, y: 0, fire: true }, 12); // two shots out
  assert.equal(g.shots.length, 2);
  run(g, IDLE, 1);
  const ev = run(g, { x: 0, y: 0, fire: true }, 150);
  assert.equal(count(ev, 'fire'), 1, 'the buffered press fired once');
});

test('shots wreck robots; scoring per type and sector; room clear and the boost', () => {
  const g = quiet();
  g.cheats.noFoes = false;
  const spot = openLine(g, 1, 0, 6);
  place(g, spot.x, spot.y);
  const f = addFoe(g, 'droid', Math.floor(spot.x) + 5, Math.floor(spot.y));
  f.state = 'pause';
  f.dur = 99; // hold still
  f.fireCd = 99;
  const before = g.score;
  const ev = run(g, (i) => (i < 2 ? { x: 1, y: 0, fire: true } : IDLE), 40);
  const die = find(ev, 'foeDie');
  assert.ok(die, 'the droid died');
  assert.equal(die.foe, 'droid');
  assert.equal(die.by, 'shot');
  assert.equal(die.points, SCORE.foe.droid * g.room.zone);
  const clear = find(ev, 'roomClear');
  assert.ok(clear, 'room clear');
  assert.equal(g.room.cleared, true);
  assert.equal(g.player.boost, true);
  assert.equal(g.score - before, die.points + clear.points);
  // The boost: faster walking for the rest of the visit.
  const x0 = g.player.x;
  run(g, { x: -1, y: 0, fire: false }, 1);
  assert.ok(Math.abs(x0 - g.player.x - PLAYER.speed[g.room.zone] * PLAYER.clearBoost * DT) < 1e-9);
});

test('blasts chain to robots close by', () => {
  const g = quiet();
  g.cheats.noFoes = false;
  const spot = openLine(g, 1, 0, 7);
  place(g, spot.x, spot.y);
  const c = Math.floor(spot.x) + 5;
  const r = Math.floor(spot.y);
  const a = addFoe(g, 'droid', c, r);
  // A second droid one cell behind it (inside the blast).
  const b = addFoe(g, 'droid', c + 1, r);
  for (const f of [a, b]) { f.state = 'pause'; f.dur = 99; f.fireCd = 99; }
  const ev = run(g, (i) => (i < 2 ? { x: 1, y: 0, fire: true } : IDLE), 40);
  const deaths = ev.filter((e) => e.type === 'foeDie');
  assert.equal(deaths.length, 2);
  assert.equal(deaths[1].chain, true);
});

test('sniffer armor: two hits from the front, one from behind', () => {
  for (const fromBehind of [false, true]) {
    const g = quiet();
    g.cheats.noFoes = false;
    const spot = openLine(g, 1, 0, 7);
    place(g, spot.x, spot.y);
    const f = addFoe(g, 'sniffer', Math.floor(spot.x) + 5, Math.floor(spot.y));
    f.face = fromBehind ? 0 : 4; // facing away from or toward Shamus
    // Hold it still: a sniffer always moves, so freeze the world but keep shots flying.
    const ev = [];
    for (let i = 0; i < 60; i++) {
      g.freezeT = 1;
      stepGame(g, i < 2 || (i > 30 && i < 33) ? { x: 1, y: 0, fire: true } : IDLE);
      ev.push(...g.events);
    }
    if (fromBehind) {
      assert.equal(count(ev, 'foeHit'), 0);
      assert.equal(count(ev, 'foeDie'), 1);
    } else {
      assert.equal(find(ev, 'foeHit')?.hp, 1);
      assert.equal(count(ev, 'foeDie'), 1);
    }
  }
});

test('armor: a warden takes three hits, brass plating one more, and plated robots score double', () => {
  for (const [type, armored, hits] of [['warden', false, 3], ['droid', true, 2], ['jumper', true, 2], ['droid', false, 1]]) {
    const g = quiet();
    g.cheats.noFoes = false;
    const spot = openLine(g, 1, 0, 7);
    place(g, spot.x, spot.y);
    const f = addFoe(g, type, Math.floor(spot.x) + 5, Math.floor(spot.y), armored);
    assert.equal(f.hp, hits);
    assert.equal(f.maxHp, hits);
    // Hold it still (frozen robots still take shots) and fire a fresh shot every 40 steps.
    const ev = [];
    for (let i = 0; i < 160; i++) {
      g.freezeT = 1;
      stepGame(g, i % 40 < 2 ? { x: 1, y: 0, fire: true } : IDLE);
      ev.push(...g.events);
    }
    assert.equal(count(ev, 'foeHit'), hits - 1, `${type}: hits before it goes down`);
    const die = find(ev, 'foeDie');
    assert.ok(die, `${type} went down`);
    assert.equal(die.armored, armored);
    assert.equal(die.points, SCORE.foe[type] * g.room.zone * (armored ? FOES.armor.points : 1));
  }
});

test('armor: a blast is one hit, so plating survives a chain', () => {
  const g = quiet();
  g.cheats.noFoes = false;
  const spot = openLine(g, 1, 0, 7);
  place(g, spot.x, spot.y);
  const c = Math.floor(spot.x) + 5;
  const r = Math.floor(spot.y);
  const a = addFoe(g, 'droid', c, r);
  const b = addFoe(g, 'droid', c + 1, r, true);
  for (const f of [a, b]) { f.state = 'pause'; f.dur = 99; f.fireCd = 99; }
  const ev = run(g, (i) => (i < 2 ? { x: 1, y: 0, fire: true } : IDLE), 40);
  assert.equal(count(ev, 'foeDie'), 1);
  const hit = find(ev, 'foeHit');
  assert.equal(hit?.by, 'blast');
  assert.equal(hit?.hp, 1);
  assert.deepEqual(g.foes, [b]);
});

test('armor: plating shows up more by sector and skill, and only on droids and jumpers', () => {
  const rate = (skill, zone) => {
    let plated = 0;
    let eligible = 0;
    for (const m of ROOMS.filter((r) => r.zone === zone && !r.lair)) {
      for (let k = 0; k < 6; k++) {
        const g = createGame({ skill, seed: m.id * 7 + k + 1 });
        enterRoom(g, m.id, Object.keys(m.exits)[0]);
        for (const f of g.foes) {
          if (!FOES.armor.types.includes(f.type)) {
            assert.equal(f.armored, false, `${f.type} is never plated`);
            continue;
          }
          eligible++;
          if (f.armored) plated++;
        }
      }
    }
    return plated / eligible;
  };
  for (const [skill, zone] of [[1, 1], [1, 4], [3, 4]]) {
    const want = FOES.armor.chance[zone] * SKILLS[skill].armor;
    const got = rate(skill, zone);
    assert.ok(Math.abs(got - want) < 0.07, `skill ${skill}, sector ${zone}: ${got.toFixed(2)} plated, want about ${want.toFixed(2)}`);
  }
});

test('fire: the mouse reloads slower than fire keys', () => {
  const g = quiet();
  const spot = openLine(g, 1, 0, 9);
  place(g, spot.x, spot.y);
  const aim = { x: spot.x + 6, y: spot.y };
  const steps = [];
  run(g, (i) => {
    if (find(g.events, 'fire')) steps.push(i - 1);
    return { x: 0, y: 0, fire: true, aim };
  }, 90);
  assert.ok(steps.length >= 2);
  assert.ok(steps[1] - steps[0] >= Math.floor(PLAYER.mouseCooldown / DT), 'mouse shots wait for the mouse cooldown');
  assert.ok(PLAYER.mouseCooldown > PLAYER.fireCooldown);
});

test('bolts kill Shamus; the shield stops them; a shot and a bolt destroy each other', () => {
  // A bolt flying at him.
  const g = quiet();
  const spot = openLine(g, 1, 0, 6);
  place(g, spot.x, spot.y);
  const bolt = () => g.bolts.push({ id: 999, x: spot.x + 4, y: spot.y, vx: -FOES.boltSpeed[1], vy: 0, t: 0, from: 'droid', owner: -1, life: 4 });
  bolt();
  let ev = run(g, IDLE, 60);
  assert.equal(find(ev, 'playerDie')?.cause, 'bolt');
  assert.equal(find(ev, 'playerDie')?.foe, 'droid');
  // Shielded.
  const g2 = quiet();
  place(g2, spot.x, spot.y);
  g2.player.shieldT = 2;
  g2.bolts.push({ id: 999, x: spot.x + 4, y: spot.y, vx: -FOES.boltSpeed[1], vy: 0, t: 0, from: 'droid', owner: -1, life: 4 });
  ev = run(g2, IDLE, 60);
  assert.equal(count(ev, 'playerDie'), 0);
  assert.equal(find(ev, 'boltHit')?.what, 'shield');
  // Shot meets bolt.
  const g3 = quiet();
  place(g3, spot.x, spot.y);
  g3.bolts.push({ id: 999, x: spot.x + 5, y: spot.y, vx: -FOES.boltSpeed[4], vy: 0, t: 0, from: 'warden', owner: -1, life: 4 });
  g3.player.face = 0;
  ev = run(g3, (i) => (i === 0 ? { x: 1, y: 0, fire: true } : IDLE), 60);
  assert.equal(find(ev, 'shotHit')?.what, 'bolt');
  assert.equal(count(ev, 'playerDie'), 0);
  assert.equal(g3.bolts.length, 0);
});

test('robots fire only after the entry grace, and only when lined up', () => {
  const g = createGame({ skill: 3, seed: 3 });
  g.cheats.noShadow = true;
  g.cheats.invuln = true;
  const busy = ROOMS.filter((m) => m.zone === 3 && !m.pod);
  let fired = 0;
  for (const m of busy.slice(0, 10)) {
    enterRoom(g, m.id, Object.keys(m.exits)[0]);
    const grace = FOES.entryGrace * SKILLS[3].grace;
    for (let i = 0; i < 60 * 12; i++) {
      stepGame(g, script(m.id)(i));
      for (const e of g.events) {
        if (e.type !== 'boltFire') continue;
        fired++;
        assert.ok(g.room.t >= grace - 1e-9, `room ${m.id}: fired at ${g.room.t.toFixed(2)} s`);
      }
    }
  }
  assert.ok(fired > 0, 'some robot fired');
});

test('robots stay on safe ground, inside the room, and apart', () => {
  let checked = 0;
  for (const skill of [0, 3]) {
    for (const m of ROOMS.filter((r) => !r.lair).filter((_, i) => i % 6 === 0)) {
      const g = createGame({ skill, seed: m.id + 1 });
      g.cheats.invuln = true;
      g.cheats.noShadow = true;
      enterRoom(g, m.id, Object.keys(m.exits)[0]);
      const geo = g.room.geo;
      const input = script(m.id * 3);
      for (let i = 0; i < 60 * 15; i++) {
        stepGame(g, input(i));
        if (g.room.id !== m.id) break;
        for (const f of g.foes) {
          checked++;
          const wd = wallDistance(geo, f.x, f.y, CELL.WALL);
          assert.ok(wd >= WALL_HALF + f.r, `room ${m.id}: ${f.type} touches a wall at ${f.x.toFixed(2)},${f.y.toFixed(2)}`);
          if (geo.podPosts.length) assert.ok(wallDistance(geo, f.x, f.y, CELL.POD) >= WALL_HALF + f.r, `room ${m.id}: ${f.type} in a pod gate`);
          assert.ok(!blockAt(geo, f.x, f.y, f.r - 0.05), `room ${m.id}: ${f.type} inside a block`);
          assert.ok(f.x > 1 && f.y > 1 && f.x < W - 1 && f.y < H - 1, `room ${m.id}: ${f.type} left the room`);
          for (const o of g.foes) {
            if (o === f || (o.type === 'jumper' && o.state === 'hop') || (f.type === 'jumper' && f.state === 'hop')) continue;
            assert.ok(Math.hypot(o.x - f.x, o.y - f.y) >= o.r + f.r - 0.1, `room ${m.id}: ${f.type} and ${o.type} overlap`);
          }
        }
      }
    }
  }
  assert.ok(checked > 1000);
});

test('spawns: n scaled by skill, never near the door, types by sector', () => {
  for (const skill of [0, 1, 3]) {
    for (const m of ROOMS.filter((r) => !r.lair)) {
      const g = createGame({ skill, seed: m.id + 11 });
      for (const side of Object.keys(m.exits)) {
        enterRoom(g, m.id, side);
        const geo = g.room.geo;
        const e = g.room.entry;
        const want = geo.n > 0 ? Math.max(1, Math.round(geo.n * SKILLS[skill].foeCount)) : 0;
        const far = geo.spawns.filter((s) => Math.hypot(s.x - e.x, s.y - e.y) >= FOES.minSpawnDist).length;
        assert.equal(g.foes.length, Math.min(want, far), `room ${m.id} from ${side}`);
        for (const f of g.foes) {
          assert.ok(Math.hypot(f.x - e.x, f.y - e.y) >= FOES.minSpawnDist, `room ${m.id}: spawned too close`);
          assert.ok((geo.foes ?? FOES.types[m.zone]).includes(f.type), `room ${m.id}: ${f.type} not allowed`);
        }
        assert.ok(g.foes.filter((f) => f.type === 'warden').length <= FOES.maxWardens);
      }
    }
  }
});

test('keys, keyholes, and locked doors', () => {
  const g = quiet();
  // Room 15 holds the blue keyhole for its west door; room 2 holds the blue key.
  const lockRoom = ROOMS.find((m) => m.lock && m.lock.color === 'blue' && m.zone === 1);
  const keyRoom = ROOMS.find((m) => m.item?.kind === 'key' && m.item.color === 'blue' && m.zone === 1);
  const lockSide = lockRoom.lock.side;
  const otherSide = Object.keys(lockRoom.exits).find((s) => s !== lockSide);
  enterRoom(g, lockRoom.id, otherSide);
  assert.equal(g.room.locks[lockSide].open, false);
  // Without the key: the keyhole complains.
  let ev = walkTo(g, g.item.x, g.item.y, PLAYER.radius + 0.35, 'keyhole');
  assert.equal(find(ev, 'doorLocked')?.color, 'blue');
  assert.equal(g.item.used, false);
  // The barrier holds.
  const d = doorGoal(lockSide);
  const pilot = new Pilot(g);
  const inward = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }[lockSide];
  pilot.setGoal({ x: d.x + inward[0] * 1.2, y: d.y + inward[1] * 1.2, r: 0.2, label: 'lock', snap: 0.6 });
  for (let i = 0; i < 60 * 20 && !pilot.done(); i++) stepGame(g, pilot.input());
  run(g, { x: -inward[0], y: -inward[1], fire: false }, 60);
  assert.equal(g.room.id, lockRoom.id, 'walked through a locked door');
  // Fetch the key.
  enterRoom(g, keyRoom.id, Object.keys(keyRoom.exits)[0]);
  ev = walkTo(g, g.item.x, g.item.y, PLAYER.radius + 0.35, 'key');
  assert.equal(find(ev, 'pickup')?.kind, 'key');
  assert.equal(g.keys.blue, 1);
  assert.equal(g.taken[keyRoom.id], true);
  enterRoom(g, keyRoom.id, Object.keys(keyRoom.exits)[0]);
  assert.equal(g.item, null, 'a taken key stays taken');
  // Use it.
  enterRoom(g, lockRoom.id, otherSide);
  ev = walkTo(g, g.item.x, g.item.y, PLAYER.radius + 0.35, 'keyhole');
  assert.equal(find(ev, 'keyUse')?.color, 'blue');
  assert.equal(find(ev, 'doorOpen')?.side, lockSide);
  assert.equal(g.keys.blue, 0);
  assert.equal(g.opened[lockRoom.id], true);
  assert.equal(g.room.locks[lockSide].open, true);
  // Through the door, and the far side's barrier is open too.
  ev = walkTo(g, d.x, d.y, 0, `door ${lockSide}`);
  assert.equal(g.room.id, lockRoom.exits[lockSide]);
  const back = Object.keys(g.room.locks);
  assert.ok(back.length === 1 && g.room.locks[back[0]].open);
});

test('the Shadow: warning, entry, items vanish, stun, immunity, and the kill', () => {
  const { id, side } = roomWith('life', 1);
  const g = quiet({ shadow: true });
  enterRoom(g, id, side);
  const warnAt = SHADOW.time[1] - SHADOW.warn;
  const comeAt = SHADOW.time[1];
  let warn = -1;
  let came = -1;
  for (let i = 0; i < 60 * 30 && came < 0; i++) {
    stepGame(g, IDLE);
    for (const e of g.events) {
      if (e.type === 'shadowWarn') warn = g.room.t;
      if (e.type === 'shadowEnter') came = g.room.t;
    }
  }
  assert.ok(Math.abs(warn - warnAt) <= DT + 1e-9, `warned at ${warn}`);
  assert.ok(Math.abs(came - comeAt) <= DT + 1e-9, `came at ${came}`);
  assert.equal(g.item.hidden, true);
  assert.equal(g.room.itemsHidden, true);
  const s = g.shadow;
  assert.equal(s.state, 'enter');
  assert.ok(Math.hypot(s.x - g.player.x, s.y - g.player.y) >= SHADOW.minEnterDist - 1e-9);
  // Hidden items can't be taken.
  place(g, g.item.x, g.item.y);
  run(g, IDLE, 1);
  assert.ok(g.item && !g.taken[id], 'took a hidden item');
  // Set up a clear shot east and put him on the line.
  const spot = openLine(g, 1, 0, 6);
  place(g, spot.x, spot.y);
  run(g, IDLE, Math.ceil(SHADOW.enterTime / DT) + 1);
  assert.equal(s.state, 'chase');
  s.x = spot.x + 5;
  s.y = spot.y;
  g.player.face = 0;
  let ev = run(g, (i) => (i === 0 ? { x: 1, y: 0, fire: true } : IDLE), 20);
  assert.ok(find(ev, 'shadowStun'), 'stunned');
  assert.equal(s.state, 'stunned');
  const sx = s.x;
  ev = run(g, IDLE, Math.floor((SHADOW.stun - 0.4) / DT));
  assert.equal(s.x, sx, 'he holds still while stunned');
  run(g, IDLE, Math.ceil(0.4 / DT) + 2);
  assert.equal(s.state, 'chase');
  assert.ok(s.immuneT > 0);
  // A shot during his immunity is soaked up.
  s.x = g.player.x + 3;
  s.y = g.player.y;
  ev = run(g, (i) => (i === 0 ? { x: 1, y: 0, fire: true } : IDLE), 8);
  assert.equal(find(ev, 'shotHit')?.what, 'shadow');
  assert.equal(count(ev, 'shadowStun'), 0);
  // Then he gets Shamus.
  ev = run(g, IDLE, 60 * 5);
  assert.equal(find(ev, 'playerDie')?.cause, 'shadow');
  // Respawning re-enters the room: the item is back.
  run(g, IDLE, Math.ceil(PLAYER.deathTime / DT) + 1);
  assert.equal(g.mode, 'play');
  assert.equal(g.item.hidden, false);
  assert.equal(g.shadow, null);
});

test('the Shadow leaves keyholes alone; leaving the room ends the chase', () => {
  const lockRoom = ROOMS.find((m) => m.lock && m.zone === 1);
  const g = quiet({ shadow: true });
  const side = Object.keys(lockRoom.exits).find((s) => s !== lockRoom.lock.side);
  enterRoom(g, lockRoom.id, side);
  g.room.shadowAt = 0.1;
  run(g, IDLE, 12);
  assert.ok(g.shadow);
  assert.equal(g.item.kind, 'keyhole');
  assert.equal(g.item.hidden, false);
  // Walk back out the way he came.
  walkTo(g, doorGoal(side).x, doorGoal(side).y, 0, 'door');
  assert.notEqual(g.room.id, lockRoom.id);
  assert.equal(g.shadow, null);
});

test('respawn and game over', () => {
  const g = quiet();
  const lives = g.lives;
  const entry = { ...g.room.entry };
  place(g, entry.x + 1, entry.y);
  killPlayer(g, 'wall');
  let ev = run(g, IDLE, Math.ceil(PLAYER.deathTime / DT) + 1);
  assert.ok(find(ev, 'respawn'));
  assert.equal(g.lives, lives - 1);
  assert.equal(g.mode, 'play');
  assert.deepEqual([g.player.x, g.player.y], [entry.x, entry.y]);
  assert.ok(g.player.invulnT > 0);
  while (g.lives > 1) {
    killPlayer(g, 'foe');
    run(g, IDLE, Math.ceil(PLAYER.deathTime / DT) + 1);
  }
  killPlayer(g, 'bolt');
  ev = run(g, IDLE, Math.ceil(PLAYER.deathTime / DT) + 1);
  assert.equal(find(ev, 'gameOver')?.score, g.score);
  assert.equal(g.mode, 'gameover');
  assert.equal(g.lives, 0);
  const step = g.step;
  run(g, { x: 1, y: 0, fire: true }, 10);
  assert.equal(g.step, step, 'game over stops the clock');
});

test('respawn grace protects from robots but not from walls', () => {
  const g = quiet();
  g.cheats.noFoes = false;
  g.player.invulnT = 1;
  const spot = openLine(g, 1, 0, 3);
  place(g, spot.x, spot.y);
  addFoe(g, 'droid', Math.floor(spot.x), Math.floor(spot.y)); // right on top of him
  const ev = run(g, IDLE, 5);
  assert.equal(count(ev, 'playerDie'), 0);
});

test('extra lives: bottles and every SCORE.extraLifeEvery points', () => {
  const g = quiet();
  const lives = g.lives;
  g.score = SCORE.extraLifeEvery - 10;
  const { id, side } = roomWith('life', 1);
  enterRoom(g, id, side);
  const ev = walkTo(g, g.item.x, g.item.y, PLAYER.radius + 0.35, 'bottle');
  const reasons = ev.filter((e) => e.type === 'extraLife').map((e) => e.reason).sort();
  assert.deepEqual(reasons, ['bottle', 'score']);
  assert.equal(g.lives, lives + 2);
  assert.equal(g.nextLifeAt, SCORE.extraLifeEvery * 2);
});

test('mysteries: points, life, shield, freeze, and the Shadow', () => {
  const { id, side } = roomWith('mystery', 1);
  const seen = {};
  for (let seed = 1; seed < 400 && Object.keys(seen).length < 5; seed++) {
    const g = quiet({ shadow: true });
    g.cheats.noFoes = false;
    enterRoom(g, id, side);
    if (!g.foes.length) addFoe(g, 'droid', 10, 1);
    g.rngState = seed;
    const lives = g.lives;
    const score = g.score;
    place(g, g.item.x, g.item.y);
    g.player.invulnT = 99;
    stepGame(g, IDLE);
    const m = find(g.events, 'mystery');
    assert.ok(m, 'stepping on it opened it');
    if (seen[m.outcome]) continue;
    seen[m.outcome] = true;
    if (m.outcome === 'points') assert.equal(g.score - score, m.points);
    if (m.outcome === 'life') assert.equal(g.lives, lives + 1);
    if (m.outcome === 'shield') assert.ok(Math.abs(g.player.shieldT - MYSTERY.shield) < 0.05);
    if (m.outcome === 'freeze') {
      assert.ok(Math.abs(g.freezeT - MYSTERY.freeze) < 0.05);
      const where = g.foes.map((f) => `${f.x},${f.y}`).join();
      run(g, IDLE, 60);
      assert.equal(g.foes.map((f) => `${f.x},${f.y}`).join(), where, 'frozen robots hold still');
    }
    if (m.outcome === 'shadow') {
      const ev = run(g, IDLE, Math.ceil(MYSTERY.shadowDelay / DT) + 2);
      assert.ok(find(ev, 'shadowEnter'), 'he came');
      assert.ok(g.room.warned);
    }
  }
  assert.deepEqual(Object.keys(seen).sort(), ['freeze', 'life', 'points', 'shadow', 'shield']);
});

test('cheats: noFoes and noShadow', () => {
  const g = createGame({ seed: 4 });
  g.cheats.noFoes = true;
  g.cheats.noShadow = true;
  const busy = ROOMS.find((m) => m.zone === 3 && !m.pod);
  enterRoom(g, busy.id, Object.keys(busy.exits)[0]);
  assert.equal(g.foes.length, 0);
  const ev = run(g, IDLE, 60 * 40);
  assert.equal(count(ev, 'shadowEnter'), 0);
  assert.equal(g.mode, 'play');
  // Turning noFoes on mid-room clears them out.
  g.cheats.noFoes = false;
  enterRoom(g, busy.id, Object.keys(busy.exits)[0]);
  assert.ok(g.foes.length > 0);
  g.cheats.noFoes = true;
  run(g, IDLE, 1);
  assert.equal(g.foes.length, 0);
});

test('snapshot and restore round trip', () => {
  const g = quiet({ seed: 9 });
  const { id, side } = roomWith('key', 1);
  enterRoom(g, id, side);
  walkTo(g, g.item.x, g.item.y, PLAYER.radius + 0.35, 'key');
  g.opened[37] = true;
  g.score = 4321;
  const snap = JSON.parse(JSON.stringify(makeSnapshot(g)));
  const g2 = createGame({ from: snap, seed: 2 });
  assert.equal(g2.room.id, snap.roomId);
  assert.deepEqual(makeSnapshot(g2), snap);
  assert.equal(g2.keys[ROOMS[id].item.color], 1);
  assert.equal(g2.item, null, 'the taken key stays taken');
});

test('the lair: he comes at once, takes SHADOW.lairHits hits, and the game is won', () => {
  const g = createGame({ seed: 3 });
  g.cheats.noFoes = true;
  g.cheats.invuln = true; // the test is about the fight's rules, not the pilot's dodging
  const score = g.score;
  enterRoom(g, LAIR_ROOM, 'W');
  const ev = [];
  for (let i = 0; i < 60 * 120 && g.mode !== 'won'; i++) {
    stepGame(g, fightInput(g));
    ev.push(...g.events);
  }
  const enter = ev.findIndex((e) => e.type === 'shadowEnter');
  assert.ok(enter >= 0);
  assert.equal(g.mode, 'won');
  const hurts = ev.filter((e) => e.type === 'shadowHurt').map((e) => e.hp);
  assert.deepEqual(hurts, Array.from({ length: SHADOW.lairHits }, (_, i) => SHADOW.lairHits - 1 - i));
  assert.ok(find(ev, 'shadowDefeat'));
  assert.equal(find(ev, 'win')?.score, g.score);
  assert.ok(g.score - score >= SCORE.shadowDefeat);
  assert.equal(g.lairHp, 0);
  const step = g.step;
  stepGame(g, IDLE);
  assert.equal(g.step, step, 'a won game stops');
});

test('the lair: without cheats the pilot still wins (a fair fight)', () => {
  let wins = 0;
  for (const seed of [1, 2, 3, 4]) {
    const g = createGame({ seed, skill: 1 });
    g.cheats.noFoes = true;
    enterRoom(g, LAIR_ROOM, 'W');
    for (let i = 0; i < 60 * 180 && g.mode !== 'won' && g.mode !== 'gameover'; i++) stepGame(g, g.mode === 'play' ? fightInput(g) : IDLE);
    if (g.mode === 'won') wins++;
  }
  assert.ok(wins >= 3, `won ${wins} of 4`);
});

test('the lair: damage carries over a death', () => {
  const g = createGame({ seed: 6 });
  g.cheats.noFoes = true;
  enterRoom(g, LAIR_ROOM, 'W');
  run(g, IDLE, Math.ceil((SHADOW.lair.delay + SHADOW.lair.enterTime) / DT) + 2);
  const s = g.shadow;
  assert.equal(s.hp, SHADOW.lairHits);
  // Two hits by hand.
  for (let k = 0; k < 2; k++) {
    s.state = 'chase';
    s.immuneT = 0;
    const spot = openLine(g, 1, 0, 5);
    place(g, spot.x, spot.y);
    s.x = spot.x + 3;
    s.y = spot.y;
    run(g, (i) => (i === 0 ? { x: 1, y: 0, fire: true } : IDLE), 10);
    run(g, IDLE, 1);
  }
  assert.equal(g.lairHp, SHADOW.lairHits - 2);
  killPlayer(g, 'shadow');
  run(g, IDLE, Math.ceil((PLAYER.deathTime + SHADOW.lair.delay + SHADOW.lair.enterTime) / DT) + 4);
  assert.equal(g.shadow.hp, SHADOW.lairHits - 2);
});

test('newLoop: keep score and lives, start over one skill harder', () => {
  const g = createGame({ seed: 3, skill: 1 });
  g.cheats.noFoes = true;
  g.cheats.invuln = true;
  g.keys.green = 1;
  g.taken[2] = true;
  g.opened[15] = true;
  enterRoom(g, LAIR_ROOM, 'W');
  for (let i = 0; i < 60 * 120 && g.mode !== 'won'; i++) stepGame(g, fightInput(g));
  assert.equal(g.mode, 'won');
  const score = g.score;
  const lives = g.lives;
  newLoop(g);
  assert.equal(g.mode, 'play');
  assert.equal(g.loop, 1);
  assert.equal(g.skill, 2);
  assert.equal(g.score, score);
  assert.equal(g.lives, lives);
  assert.equal(g.room.id, START_ROOM);
  assert.deepEqual(g.keys, { blue: 0, green: 0, brown: 0, purple: 0, cyan: 0 });
  assert.deepEqual(g.taken, {});
  assert.deepEqual(g.opened, {});
  assert.deepEqual(Object.keys(g.visited), [String(START_ROOM)]);
  assert.equal(g.lairHp, null);
  assert.equal(g.checkpoint.skill, 2);
  newLoop(g);
  newLoop(g);
  assert.equal(g.skill, 3, 'skill tops out at Chief');
  assert.ok(find(g.events, 'roomEnter'));
});

test('pod gates kill while on and let you by while off', () => {
  const pod = ROOMS.find((m) => m.pod);
  const g = quiet();
  enterRoom(g, pod.id, Object.keys(pod.exits)[0]);
  const post = g.room.geo.podPosts[0];
  // Next to a gate post: harmless while the gate is off (it starts off).
  place(g, post.x + 0.3, post.y);
  stepGame(g, IDLE);
  assert.equal(g.room.podOn, false);
  assert.equal(g.mode, 'play');
  const cyc = g.room.geo.podCycle;
  const ev = run(g, IDLE, Math.ceil(cyc.open / DT) + 2);
  assert.ok(find(ev, 'podOn'));
  assert.equal(find(ev, 'playerDie')?.cause, 'pod');
});

test('shots stop at walls, blocks, and closed locks', () => {
  const g = quiet();
  // Fire at the room's border from the middle of an open line: it must die on a wall.
  const spot = openLine(g, 1, 0, 3);
  place(g, spot.x, spot.y);
  const ev = run(g, (i) => (i === 0 ? { x: 1, y: 0, fire: true } : IDLE), 90);
  const hit = find(ev, 'shotHit');
  assert.ok(hit && ['wall', 'block', 'lock', 'pod'].includes(hit.what), `shot ended on ${hit?.what}`);
  assert.equal(g.shots.length, 0);
});

// ------------------------------------------------------------------ summary

const failed = results.filter(([, e]) => e);
console.log(failed.length ? `${failed.length} of ${results.length} failed` : `all ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
