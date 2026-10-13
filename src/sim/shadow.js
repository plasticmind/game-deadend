// The Shadow. Every room runs a clock; when it runs out he comes through the wall
// nearest Shamus (sometimes another stretch of wall), the room's items vanish, and he
// drifts straight for Shamus through everything, speeding up. A shot stuns him. Only in
// room 127, his lair, can he be beaten: there he arrives at once, and every hit stuns
// him briefly before he blinks to a new spot or rears back and charges.

import { W, H } from '../room.js';
import { DT, SKILLS, SCORE, SHADOW, PLAYER } from './tuning.js';
import { rand } from './rng.js';
import { emit, banner, addScore, hurtPlayer } from './core.js';

// Run the room's clock: the warning, then the Shadow.
export function updateShadowClock(game) {
  const room = game.room;
  if (game.cheats.noShadow) {
    game.shadow = null;
    return;
  }
  if (!room.warned && room.t >= room.warnAt) {
    room.warned = true;
    emit(game, 'shadowWarn');
  }
  if (!room.shadowCame && room.t >= room.shadowAt) {
    if (room.lair && game.lairHp === 0) return; // already beaten (only until newLoop)
    enter(game);
  }
}

// Bring him in `delay` seconds from now (a mystery's disaster). The warning sounds now.
export function summonShadow(game, delay) {
  const room = game.room;
  if (room.shadowCame || game.cheats.noShadow) return false;
  room.shadowAt = Math.min(room.shadowAt, room.t + delay);
  room.warnAt = Math.min(room.warnAt, room.t);
  return true;
}

// The keys, lives, and mysteries in the room vanish until Shamus comes back.
export function hideItems(game) {
  const room = game.room;
  room.itemsHidden = true;
  const it = game.item;
  if (it && it.kind !== 'keyhole' && !it.hidden) {
    it.hidden = true;
    emit(game, 'itemsVanish');
  }
}

function enter(game) {
  const room = game.room;
  const lair = room.lair;
  const spot = lair ? farSpot(game, SHADOW.lair.minDist, true) : entrySpot(game);
  const hp = lair ? (game.lairHp ?? SHADOW.lairHits) : null;
  if (lair) game.lairHp = hp;
  game.shadow = {
    x: spot.x, y: spot.y, state: 'enter', t: 0, dur: lair ? SHADOW.lair.enterTime : SHADOW.enterTime,
    stunT: 0, immuneT: 0, chaseT: 0, hp, hpMax: lair ? SHADOW.lairHits : null,
    vx: 0, vy: 0, ax: 0, ay: 0, next: null,
  };
  room.shadowCame = true;
  if (!room.warned) {
    room.warned = true;
    emit(game, 'shadowWarn');
  }
  hideItems(game);
  emit(game, 'shadowEnter', { x: spot.x, y: spot.y });
}

// Through the wall nearest Shamus, unless that is too close or chance says otherwise.
function entrySpot(game) {
  const p = game.player;
  const x = Math.min(W - 0.5, Math.max(0.5, p.x));
  const y = Math.min(H - 0.5, Math.max(0.5, p.y));
  const opts = [
    { x: 0.5, y, d: Math.abs(p.x - 0.5) },
    { x: W - 0.5, y, d: Math.abs(W - 0.5 - p.x) },
    { x, y: 0.5, d: Math.abs(p.y - 0.5) },
    { x, y: H - 0.5, d: Math.abs(H - 0.5 - p.y) },
  ];
  let best = opts[0];
  for (const o of opts) if (o.d < best.d) best = o;
  const roll = rand(game);
  if (best.d >= SHADOW.minEnterDist && roll < SHADOW.nearestChance) return { x: best.x, y: best.y };
  return farSpot(game, SHADOW.minEnterDist, false);
}

// A random point on the border (or, `inside`, anywhere in the room) at least `minD`
// from Shamus; the farthest corner if chance keeps missing.
function farSpot(game, minD, inside) {
  const p = game.player;
  for (let i = 0; i < 12; i++) {
    let x;
    let y;
    if (inside) {
      x = 2 + rand(game) * (W - 4);
      y = 2 + rand(game) * (H - 4);
    } else {
      const w = W - 1;
      const h = H - 1;
      let u = rand(game) * 2 * (w + h);
      if (u < w) { x = 0.5 + u; y = 0.5; }
      else if ((u -= w) < h) { x = W - 0.5; y = 0.5 + u; }
      else if ((u -= h) < w) { x = W - 0.5 - u; y = H - 0.5; }
      else { u -= w; x = 0.5; y = H - 0.5 - u; }
    }
    if (Math.hypot(x - p.x, y - p.y) >= minD) return { x, y };
  }
  const x = p.x < W / 2 ? W - 1.5 : 1.5;
  const y = p.y < H / 2 ? H - 1.5 : 1.5;
  return { x, y };
}

function baseSpeed(game) {
  const sk = SKILLS[game.skill];
  return (game.room.lair ? SHADOW.lair.speed : SHADOW.speed[game.room.zone]) * sk.shadowSpeed;
}

export function updateShadow(game) {
  const s = game.shadow;
  if (!s) return;
  const p = game.player;
  const lair = game.room.lair;
  s.t += DT;
  if (s.immuneT > 0) s.immuneT = Math.max(0, s.immuneT - DT);
  switch (s.state) {
    case 'enter':
      if (s.t >= s.dur) setState(s, 'chase');
      break;
    case 'stunned':
      s.stunT = Math.max(0, s.stunT - DT);
      if (s.stunT > 0) break;
      if (!lair) {
        setState(s, 'chase');
        s.immuneT = SHADOW.stunImmune;
      } else if (s.next === 'charge') {
        setState(s, 'charge', SHADOW.lair.windup + SHADOW.lair.chargeTime);
        s.vx = 0;
        s.vy = 0;
      } else {
        blink(game, s);
      }
      s.next = null;
      break;
    case 'chase': {
      s.chaseT += DT;
      const cap = PLAYER.speed[game.room.zone] * SHADOW.maxSpeed;
      const speed = Math.min(cap, baseSpeed(game) * (1 + SHADOW.accel * s.chaseT));
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        const step = Math.min(d, speed * DT);
        s.vx = (dx / d) * speed;
        s.vy = (dy / d) * speed;
        s.x += (dx / d) * step;
        s.y += (dy / d) * step;
      }
      break;
    }
    case 'charge': {
      const L = SHADOW.lair;
      if (s.t < L.windup) {
        // Rearing back: he tracks Shamus; the dash locks in when the windup ends.
        const dx = p.x - s.x;
        const dy = p.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        s.ax = dx / d;
        s.ay = dy / d;
        s.vx = 0;
        s.vy = 0;
        break;
      }
      const speed = baseSpeed(game) * L.chargeSpeed;
      s.vx = s.ax * speed;
      s.vy = s.ay * speed;
      s.x += s.vx * DT;
      s.y += s.vy * DT;
      const out = s.x < 1 || s.y < 1 || s.x > W - 1 || s.y > H - 1;
      if (out) {
        s.x = Math.min(W - 1, Math.max(1, s.x));
        s.y = Math.min(H - 1, Math.max(1, s.y));
      }
      if (out || s.t >= s.dur) {
        setState(s, 'chase');
        s.chaseT = 0;
      }
      break;
    }
    case 'dying':
      if (s.t >= s.dur) {
        game.mode = 'won';
        emit(game, 'win', { score: game.score });
        banner(game, 'CASE CLOSED', null, 4);
      }
      return;
    default:
      break;
  }
  // His touch kills (not while he fades in).
  if (s.state !== 'enter') {
    const reach = SHADOW.radius + p.r - PLAYER.touchSlack;
    if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 < reach * reach) hurtPlayer(game, 'shadow');
  }
}

function setState(s, state, dur = 0) {
  s.state = state;
  s.t = 0;
  s.dur = dur;
}

// Lair only: vanish and come back somewhere far from Shamus.
function blink(game, s) {
  const fromX = s.x;
  const fromY = s.y;
  const spot = farSpot(game, SHADOW.lair.minDist, true);
  s.x = spot.x;
  s.y = spot.y;
  s.vx = 0;
  s.vy = 0;
  s.chaseT = 0;
  setState(s, 'enter', SHADOW.lair.enterTime);
  emit(game, 'shadowBlink', { x: s.x, y: s.y, fromX, fromY });
}

// A shot reaches him? Returns true when he soaks it up (the shot is spent).
export function hitShadow(game, shot) {
  const s = game.shadow;
  if (!s || s.state === 'enter' || s.state === 'dying') return false;
  const reach = SHADOW.radius + PLAYER.shotReach;
  if ((s.x - shot.x) ** 2 + (s.y - shot.y) ** 2 > reach * reach) return false;
  const vulnerable = s.state === 'chase' || s.state === 'charge';
  if (!vulnerable || s.immuneT > 0) {
    emit(game, 'shotHit', { x: shot.x, y: shot.y, what: 'shadow' });
    return true;
  }
  if (!game.room.lair) {
    setState(s, 'stunned');
    s.stunT = SHADOW.stun;
    emit(game, 'shadowStun', { x: s.x, y: s.y });
    return true;
  }
  // The lair: every hit counts.
  s.hp--;
  game.lairHp = s.hp;
  emit(game, 'shadowHurt', { x: s.x, y: s.y, hp: s.hp });
  if (s.hp <= 0) {
    setState(s, 'dying', SHADOW.lair.dieTime);
    addScore(game, SCORE.shadowDefeat);
    emit(game, 'shadowDefeat', { x: s.x, y: s.y });
    banner(game, 'THE SHADOW FALLS', null, SHADOW.lair.dieTime);
    game.bolts.length = 0;
    game.freezeT = Math.max(game.freezeT, SHADOW.lair.dieTime + 1);
    return true;
  }
  setState(s, 'stunned');
  s.stunT = SHADOW.lair.stun;
  emit(game, 'shadowStun', { x: s.x, y: s.y });
  const far = Math.hypot(s.x - game.player.x, s.y - game.player.y) > 3.5;
  s.next = far && rand(game) < SHADOW.lair.chargeChance ? 'charge' : 'blink';
  // He can't be hit again until he has blinked away or launched his charge, so every
  // hit buys a beat of dodging instead of a stun-lock.
  s.immuneT = SHADOW.lair.stun + (s.next === 'charge' ? SHADOW.lair.windup : 0);
  return true;
}
