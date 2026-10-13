// ION-SHIVs (the player's shots) and robot bolts. Both fly in a straight line (bolts and
// keyboard shots along one of the 8 directions, mouse shots at any angle) and die on
// electric walls, blocks, live pod gates, closed lock barriers, and the room's edge. A
// shot and a bolt that meet destroy each other.

import { W, H, DOOR, LOCK_FACE, touchesWall, touchesPod, blockAt } from '../room.js';
import { DT, SKILLS, PLAYER, FOES } from './tuning.js';
import { emit, UNIT, hurtPlayer } from './core.js';
import { hitFoe } from './foes.js';
import { hitShadow } from './shadow.js';
import { blockOn, explodeBarrel, breakConsole } from './props.js';

const SUBSTEPS = 2; // projectiles move in half steps so fast pairs can't pass through each other

// Fire an ION-SHIV along the unit vector (ux, uy), or along the player's facing, if one
// is free, then wait `cooldown` before the next. Returns whether it fired.
export function tryFire(game, ux = null, uy = null, cooldown = PLAYER.fireCooldown) {
  const p = game.player;
  if (p.overheatT > 0 || p.fireCd > 0 || game.shots.length >= PLAYER.maxShots) return false;
  if (ux === null || uy === null) [ux, uy] = UNIT[p.face];
  game.shots.push({ id: game.nextId++, x: p.x + ux * PLAYER.muzzle, y: p.y + uy * PLAYER.muzzle, dx: ux, dy: uy, t: 0 });
  p.fireCd = cooldown;
  // Every shot heats the gun; full heat locks it until it cools.
  p.heat += SKILLS[game.skill].heat;
  if (p.heat >= 1) {
    p.heat = 1;
    p.overheatT = PLAYER.overheatTime;
    emit(game, 'overheat', { x: p.x, y: p.y });
  }
  emit(game, 'fire', { x: p.x, y: p.y, face: p.face, dx: ux, dy: uy });
  return true;
}

// A robot fires along direction `face`. `range` limits how far the bolt flies.
export function spawnBolt(game, foe, face, range = Infinity) {
  const zone = game.room.zone;
  const [ux, uy] = UNIT[face];
  const speed = FOES.boltSpeed[zone];
  const x = foe.x + ux * (foe.r + 0.12);
  const y = foe.y + uy * (foe.r + 0.12);
  game.bolts.push({
    id: game.nextId++, x, y, vx: ux * speed, vy: uy * speed, t: 0, from: foe.type, owner: foe.id,
    life: Math.min(FOES.boltLife, range / speed),
  });
  emit(game, 'boltFire', { x, y, foe: foe.type, from: foe.type, face });
}

export function updateProjectiles(game) {
  const h = DT / SUBSTEPS;
  for (let s = 0; s < SUBSTEPS; s++) {
    moveShots(game, h);
    if (game.mode !== 'play') return;
    moveBolts(game, h);
    if (game.mode !== 'play') return;
    clashes(game);
  }
}

// Inside a closed lock barrier (the colored field across a locked door)?
export function inClosedLock(room, x, y) {
  for (const side in room.locks) {
    const lock = room.locks[side];
    if (lock.open) continue;
    const d = DOOR[side];
    const a = d.axis === 'x' ? x : y;
    if (a < d.min || a > d.max) continue;
    if (side === 'N' && y < d.line + LOCK_FACE) return true;
    if (side === 'S' && y > d.line - LOCK_FACE) return true;
    if (side === 'W' && x < d.line + LOCK_FACE) return true;
    if (side === 'E' && x > d.line - LOCK_FACE) return true;
  }
  return false;
}

// What a projectile at (x, y) with radius `rad` runs into: 'out', 'wall', 'block', 'pod',
// 'lock', or null.
function obstacle(room, x, y, rad) {
  if (x < 0 || y < 0 || x > W || y > H) return 'out';
  const geo = room.geo;
  if (touchesWall(geo, x, y, rad)) return 'wall';
  if (blockAt(geo, x, y, rad)) return 'block';
  if (room.podOn && touchesPod(geo, x, y, rad)) return 'pod';
  if (inClosedLock(room, x, y)) return 'lock';
  return null;
}

function moveShots(game, h) {
  const shots = game.shots;
  const room = game.room;
  const step = PLAYER.shotSpeed * h;
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.t += h;
    s.x += s.dx * step;
    s.y += s.dy * step;
    const what = s.t > PLAYER.shotLife ? 'out' : obstacle(room, s.x, s.y, PLAYER.shotRadius);
    if (what) {
      shots.splice(i, 1);
      // A barrel blows up; on the hardest skill a console breaks.
      const b = what === 'block' ? struck(game, s.x, s.y, PLAYER.shotRadius) : null;
      if (b && b.kind === 'barrel') {
        explodeBarrel(game, b);
        if (game.mode !== 'play') return;
        continue;
      }
      if (b && b.kind === 'terminal' && SKILLS[game.skill].consolesBreak) breakConsole(game, b, 'shot');
      if (what !== 'out') emit(game, 'shotHit', { x: s.x, y: s.y, what });
      continue;
    }
    // Robots.
    let hit = false;
    for (let j = game.foes.length - 1; j >= 0; j--) {
      const f = game.foes[j];
      const reach = f.r + PLAYER.shotReach;
      if ((f.x - s.x) ** 2 + (f.y - s.y) ** 2 > reach * reach) continue;
      shots.splice(i, 1);
      hitFoe(game, f, s.dx, s.dy, 'shot');
      hit = true;
      break;
    }
    if (hit) continue;
    // The Shadow.
    if (game.shadow && hitShadow(game, s)) shots.splice(i, 1);
    if (game.mode !== 'play') return;
  }
}

function moveBolts(game, h) {
  const bolts = game.bolts;
  const room = game.room;
  const p = game.player;
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.t += h;
    b.x += b.vx * h;
    b.y += b.vy * h;
    const what = b.t > b.life ? 'fizzle' : obstacle(room, b.x, b.y, FOES.boltRadius);
    if (what) {
      bolts.splice(i, 1);
      // Robots set off barrels too.
      const hit = what === 'block' ? struck(game, b.x, b.y, FOES.boltRadius) : null;
      if (hit && hit.kind === 'barrel') {
        explodeBarrel(game, hit);
        if (game.mode !== 'play') return;
        continue;
      }
      if (what !== 'out') emit(game, 'boltHit', { x: b.x, y: b.y, what });
      continue;
    }
    // Shamus.
    const reach = p.r + FOES.boltReach;
    if (p.alive && (p.x - b.x) ** 2 + (p.y - b.y) ** 2 < reach * reach) {
      if (hurtPlayer(game, 'bolt', b.from)) {
        bolts.splice(i, 1);
        return;
      }
      if (p.shieldT > 0 || game.cheats.invuln) {
        bolts.splice(i, 1);
        emit(game, 'boltHit', { x: b.x, y: b.y, what: 'shield' });
        continue;
      }
    }
    // Other robots (rare friendly fire: robots try not to shoot each other).
    for (let j = game.foes.length - 1; j >= 0; j--) {
      const f = game.foes[j];
      if (f.id === b.owner) continue;
      const fr = f.r + FOES.boltRadius;
      if ((f.x - b.x) ** 2 + (f.y - b.y) ** 2 > fr * fr) continue;
      bolts.splice(i, 1);
      emit(game, 'boltHit', { x: b.x, y: b.y, what: 'foe' });
      hitFoe(game, f, b.vx, b.vy, 'bolt');
      break;
    }
  }
}

// The block a projectile at (x, y) ran into, from this visit's blocks.
function struck(game, x, y, rad) {
  const cell = blockAt(game.room.geo, x, y, rad);
  return cell ? blockOn(game, cell.c, cell.r) : null;
}

// A shot and a bolt that meet both vanish.
function clashes(game) {
  const r2 = FOES.clash * FOES.clash;
  for (let i = game.shots.length - 1; i >= 0; i--) {
    const s = game.shots[i];
    for (let j = game.bolts.length - 1; j >= 0; j--) {
      const b = game.bolts[j];
      if ((s.x - b.x) ** 2 + (s.y - b.y) ** 2 > r2) continue;
      game.shots.splice(i, 1);
      game.bolts.splice(j, 1);
      emit(game, 'shotHit', { x: (s.x + b.x) / 2, y: (s.y + b.y) / 2, what: 'bolt' });
      break;
    }
  }
}
