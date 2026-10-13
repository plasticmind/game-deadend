// Barrels and consoles: the blocks that do something. Every visit to a room gets its own
// copy of the room's blocks and solid cells (visitGeo), so a barrel that blew up stays
// gone until you come back, and the parsed room stays untouched.
//
// Barrels explode when a shot or a robot's bolt hits them (BARREL in tuning.js says what
// the blast does). Consoles map their whole section of the lair when Shamus walks up to
// one; on the hardest skill, shots and barrel blasts can wreck them for good.

import { W, CELL, BLOCK_HALF } from '../room.js';
import { sectionOf, sectionRooms } from '../rooms/index.js';
import { DT, SKILLS, SCORE, SHADOW, BARREL, CONSOLE } from './tuning.js';
import { emit, banner, addScore, hurtPlayer } from './core.js';
import { hitFoe } from './foes.js';
import { hitShadow } from './shadow.js';

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// This visit's copy of room `id`'s parsed layout `geo`. Each block gains its index `i`;
// barrels gain `gone` and `fuse` (seconds until a lit barrel blows, 0 when unlit), and
// consoles gain `state`: 'idle', 'used' (its section is mapped), or 'broken'.
export function visitGeo(geo, game, id) {
  const broken = game.broken[id] ?? [];
  const mapped = sectionMapped(game, id);
  return {
    ...geo,
    solid: geo.solid.slice(),
    blocks: geo.blocks.map((b, i) => ({
      ...b,
      i,
      gone: false,
      fuse: 0,
      touched: false,
      state: b.kind !== 'terminal' ? null : broken.includes(i) ? 'broken' : mapped ? 'used' : 'idle',
    })),
  };
}

// Whether a console has already mapped the section that holds room `id`.
export function sectionMapped(game, id) {
  return !!game.sections[sectionOf(id)];
}

// The block on cell (c, r) in this visit, or null.
export function blockOn(game, c, r) {
  for (const b of game.room.geo.blocks) if (b.c === c && b.r === r && !b.gone) return b;
  return null;
}

// ------------------------------------------------------------------ barrels

export function explodeBarrel(game, b, chain = false) {
  if (b.gone || b.kind !== 'barrel') return;
  const room = game.room;
  const geo = room.geo;
  b.gone = true;
  b.fuse = 0;
  geo.solid[b.r * W + b.c] = CELL.FLOOR;
  addScore(game, SCORE.barrel);
  emit(game, 'barrelBoom', { x: b.x, y: b.y, block: b.i, chain });

  // Every robot in reach takes the blast's hits (armor and all); chains of robot
  // explosions carry on from there.
  const near = game.foes.filter((f) => d2(f, b) <= (BARREL.radius + f.r) ** 2);
  for (const f of near) {
    for (let k = 0; k < BARREL.damage && game.foes.includes(f); k++) hitFoe(game, f, 0, 0, 'barrel');
  }
  // The Shadow is stunned, or hurt in his lair, as if shot.
  const s = game.shadow;
  if (s && d2(s, b) <= (BARREL.radius + SHADOW.radius) ** 2) hitShadow(game, { x: s.x, y: s.y });
  // On the hardest skill the blast wrecks consoles.
  if (SKILLS[game.skill].consolesBreak) {
    for (const t of geo.blocks) if (t.kind === 'terminal' && d2(t, b) <= BARREL.radius ** 2) breakConsole(game, t, 'barrel');
  }
  // Light the barrels close by.
  for (const o of geo.blocks) {
    if (o.kind === 'barrel' && !o.gone && !o.fuse && d2(o, b) <= BARREL.chain ** 2) o.fuse = BARREL.fuse;
  }
  // Shamus last, so everything above still happens if the blast gets him.
  const p = game.player;
  if (p.alive && d2(p, b) <= BARREL.radius ** 2) hurtPlayer(game, 'barrel');
}

// Burn lit fuses down; a barrel whose fuse runs out explodes.
export function updateProps(game) {
  for (const b of game.room.geo.blocks) {
    if (!b.fuse) continue;
    b.fuse -= DT;
    if (b.fuse > 0) continue;
    explodeBarrel(game, b, true);
    if (game.mode !== 'play') return;
  }
}

// ------------------------------------------------------------------ consoles

export function breakConsole(game, t, by) {
  if (t.kind !== 'terminal' || t.state === 'broken') return;
  t.state = 'broken';
  const id = game.room.id;
  (game.broken[id] ??= []).push(t.i);
  emit(game, 'consoleBreak', { x: t.x, y: t.y, block: t.i, by });
}

// Shamus uses any console his body is up against: the first use maps its section.
export function useConsoles(game) {
  const p = game.player;
  for (const t of game.room.geo.blocks) {
    if (t.kind !== 'terminal' || t.state === 'broken' || t.touched) continue;
    const qx = Math.max(t.x - BLOCK_HALF, Math.min(p.x, t.x + BLOCK_HALF));
    const qy = Math.max(t.y - BLOCK_HALF, Math.min(p.y, t.y + BLOCK_HALF));
    if (Math.hypot(p.x - qx, p.y - qy) - p.r > CONSOLE.reach) continue;
    t.touched = true;
    useConsole(game, t);
  }
}

function useConsole(game, t) {
  const room = game.room;
  const owner = sectionOf(room.id);
  const fresh = !game.sections[owner];
  let rooms = 0;
  if (fresh) {
    game.sections[owner] = true;
    for (const id of sectionRooms(owner)) {
      if (game.mapped[id]) continue;
      game.mapped[id] = true;
      rooms++;
    }
  }
  for (const o of room.geo.blocks) if (o.kind === 'terminal' && o.state === 'idle') o.state = 'used';
  const points = fresh ? SCORE.mapSection * room.zone : 0;
  if (points) addScore(game, points);
  emit(game, 'consoleUse', { x: t.x, y: t.y, block: t.i, fresh, points, rooms });
  if (fresh) banner(game, `SECTION MAPPED +${points}`, null, 1.8);
}
