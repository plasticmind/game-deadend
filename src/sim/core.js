// Helpers every sim module shares: directions, events, banners, score, lives, and the
// one place that decides whether something can kill Shamus.

import { PLAYER, SCORE } from './tuning.js';

// Facing 0..7 clockwise from east with y down: E, SE, S, SW, W, NW, N, NE.
export const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const S = Math.SQRT1_2;
// The same directions as unit vectors.
export const UNIT = [[1, 0], [S, S], [0, 1], [-S, S], [-1, 0], [-S, -S], [0, -1], [S, -S]];
export const faceOf = (dx, dy) => (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
export const dirOf = (face) => DIRS[face];

// `type` is always the event's name; a field called `type` in `data` can't replace it
// (robot events carry the robot type as `foe`).
export function emit(game, type, data = {}) {
  game.events.push({ ...data, type });
}

export function banner(game, text, color = null, dur = 2.2) {
  game.banner = { text, color, t: 0, dur };
}

// One more life, up to PLAYER.maxLives. Returns whether it counted.
export function gainLife(game, reason) {
  if (game.lives >= PLAYER.maxLives) return false;
  game.lives++;
  emit(game, 'extraLife', { reason });
  return true;
}

export function addScore(game, points) {
  game.score += points;
  while (game.score >= game.nextLifeAt) {
    game.nextLifeAt += SCORE.extraLifeEvery;
    gainLife(game, 'score');
  }
}

// Whether `cause` ('wall', 'pod', 'foe', 'bolt', 'shadow', 'barrel') can kill Shamus now.
// Electric walls and live gates always can. The invuln cheat and the respawn grace stop
// everything else; the mystery shield stops robots and bolts but not the Shadow.
export function canHurt(game, cause) {
  const p = game.player;
  if (!p.alive || game.mode !== 'play') return false;
  if (cause === 'wall' || cause === 'pod') return true;
  if (game.cheats.invuln || p.invulnT > 0) return false;
  if ((cause === 'foe' || cause === 'bolt' || cause === 'barrel') && p.shieldT > 0) return false;
  if (game.shadow && game.shadow.state === 'dying') return false; // the lair is won
  return true;
}

// Kill Shamus if `cause` can hurt him. `foe` names the robot type for 'foe' and 'bolt'.
// Returns whether he died.
export function hurtPlayer(game, cause, foe = null) {
  if (!canHurt(game, cause)) return false;
  killPlayer(game, cause, foe);
  return true;
}

// Kill Shamus unconditionally (tests and the dev console use it directly).
export function killPlayer(game, cause, foe = null) {
  const p = game.player;
  if (!p.alive) return;
  p.alive = false;
  p.deadT = 0;
  p.aiming = false;
  p.freeAim = false;
  p.queueT = 0;
  p.heat = 0;
  p.overheatT = 0;
  p.moving = false;
  game.mode = 'dying';
  game.stats.deaths++;
  emit(game, 'playerDie', { cause, x: p.x, y: p.y, foe });
}
