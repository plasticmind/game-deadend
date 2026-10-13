// The in-game HUD, in the DOM over the canvas. Top left, after the reference art: SCORE
// in red LED segments, Shamus heads for lives, the keys you hold, and the room and sector.
// Center: big moments (a new sector, ROOM CLEAR, EXTRA LIFE, mystery outcomes), the
// sim's short banner, and the Shadow warning, which pulses slowly (well under 1.5 Hz)
// and stops for reduced motion. The DOM is only touched when a value changes.

import { ZONES, KEY_COLORS, LAIR_ROOM } from './map.js';
import { SHADOW } from './sim/tuning.js';
import * as icons from './icons.js';

const KEY_ORDER = ['blue', 'green', 'brown', 'purple', 'cyan'];

// Seven-segment digits. Segments a-g as polygons in a 12 x 20 box.
const H_SEG = (y) => `2.4,${y} 3.3,${y - 0.9} 8.7,${y - 0.9} 9.6,${y} 8.7,${y + 0.9} 3.3,${y + 0.9}`;
const V_SEG = (x, y1, y2) => `${x},${y1} ${x + 0.9},${y1 + 0.9} ${x + 0.9},${y2 - 0.9} ${x},${y2} ${x - 0.9},${y2 - 0.9} ${x - 0.9},${y1 + 0.9}`;
const SEGMENTS = {
  a: H_SEG(1.5),
  b: V_SEG(10.5, 1.9, 9.6),
  c: V_SEG(10.5, 10.4, 18.1),
  d: H_SEG(18.5),
  e: V_SEG(1.5, 10.4, 18.1),
  f: V_SEG(1.5, 1.9, 9.6),
  g: H_SEG(10),
};
const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

function ledDigit() {
  const polys = Object.entries(SEGMENTS)
    .map(([k, pts]) => `<polygon data-seg="${k}" points="${pts}"/>`)
    .join('');
  const wrap = document.createElement('span');
  wrap.className = 'led-digit';
  wrap.innerHTML = `<svg viewBox="0 0 12 20" aria-hidden="true" focusable="false"><g transform="skewX(-7) translate(1.6 0)">${polys}</g></svg>`;
  return wrap;
}

export function colorOf(c, fallback = '#f3efe4') {
  if (!c) return fallback;
  if (KEY_COLORS[c]) return KEY_COLORS[c].hex;
  return /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function createHud(root, { onButton = () => {} } = {}) {
  root.innerHTML = '';
  root.classList.add('hud');

  // ---- the panel
  const panel = el('div', 'hud-panel');
  const scoreCell = el('div', 'hud-cell hud-score');
  const scoreLabel = el('span', 'hud-label', 'SCORE');
  const led = el('span', 'led');
  led.setAttribute('aria-hidden', 'true');
  const scoreSr = el('span', 'sr-only');
  scoreCell.append(scoreLabel, led, scoreSr);
  const livesCell = el('div', 'hud-cell hud-lives');
  const keysCell = el('div', 'hud-cell hud-keys');
  panel.append(scoreCell, livesCell, keysCell);

  const roomLine = el('div', 'hud-room');
  const status = el('div', 'hud-status');
  const topLeft = el('div', 'hud-topleft');
  topLeft.append(panel, roomLine, status);

  // ---- buttons for mouse and touch players (keyboard and pads use Esc/P/M/Start/Back)
  const buttons = el('div', 'hud-buttons');
  const mapBtn = el('button', 'hud-btn', 'Map');
  mapBtn.type = 'button';
  mapBtn.tabIndex = -1;
  mapBtn.setAttribute('aria-label', 'Map (M)');
  const pauseBtn = el('button', 'hud-btn', 'Pause');
  pauseBtn.type = 'button';
  pauseBtn.tabIndex = -1;
  pauseBtn.setAttribute('aria-label', 'Pause (Esc)');
  mapBtn.addEventListener('click', () => onButton('map'));
  pauseBtn.addEventListener('click', () => onButton('pause'));
  buttons.append(mapBtn, pauseBtn);

  // ---- center messages
  const center = el('div', 'hud-center');
  const moment = el('div', 'hud-moment');
  moment.setAttribute('aria-live', 'polite');
  const momentTitle = el('div', 'hud-moment-title');
  const momentSub = el('div', 'hud-moment-sub');
  moment.append(momentTitle, momentSub);
  const banner = el('div', 'hud-banner');
  banner.setAttribute('aria-live', 'polite');
  center.append(moment, banner);

  // The Shadow's health in his lair (room 127), the only place he can be beaten.
  const boss = el('div', 'hud-boss');
  boss.hidden = true;
  const bossLabel = el('div', 'hud-boss-label', 'THE SHADOW');
  const bossTrack = el('div', 'hud-boss-track');
  const bossFill = el('div', 'hud-boss-fill');
  bossTrack.append(bossFill);
  bossTrack.setAttribute('role', 'meter');
  bossTrack.setAttribute('aria-label', 'The Shadow’s strength');
  bossTrack.setAttribute('aria-valuemin', '0');
  boss.append(bossLabel, bossTrack);

  const warning = el('div', 'hud-warning');
  warning.setAttribute('role', 'status');
  const warnText = el('span', '', 'THE SHADOW IS COMING');
  warning.append(warnText);

  root.append(topLeft, buttons, boss, center, warning);

  // ---- state
  const last = { score: -1, digits: 0, lives: -1, keys: '', room: '', status: '', banner: null, boss: '' };
  const queue = [];
  let momentT = 0;
  let warnSerial = -1; // room serial the warning belongs to
  let shadowHere = false;
  let ledDigits = [];

  function setScore(score) {
    const s = String(Math.max(0, Math.floor(score))).padStart(6, '0');
    if (s.length !== ledDigits.length) {
      led.innerHTML = '';
      ledDigits = [...s].map(() => {
        const d = ledDigit();
        led.append(d);
        return [...d.querySelectorAll('polygon')];
      });
    }
    [...s].forEach((ch, i) => {
      const on = DIGITS[+ch];
      for (const poly of ledDigits[i]) poly.classList.toggle('on', on.includes(poly.dataset.seg));
    });
    scoreSr.textContent = `Score ${Math.floor(score).toLocaleString()}`;
  }

  function setLives(n) {
    livesCell.innerHTML = '';
    const label = `${n} ${n === 1 ? 'life' : 'lives'}`;
    livesCell.setAttribute('aria-label', label);
    livesCell.setAttribute('role', 'img');
    if (n <= 6) {
      for (let i = 0; i < n; i++) livesCell.insertAdjacentHTML('beforeend', icons.head());
      if (n === 0) livesCell.append(el('span', 'hud-count', '× 0'));
    } else {
      livesCell.insertAdjacentHTML('beforeend', icons.head());
      livesCell.append(el('span', 'hud-count', `× ${n}`));
    }
  }

  function setKeys(keys) {
    keysCell.innerHTML = '';
    let any = false;
    const words = [];
    for (const c of KEY_ORDER) {
      const n = keys?.[c] ?? 0;
      if (!n) continue;
      any = true;
      words.push(`${n} ${KEY_COLORS[c].name.toLowerCase()}`);
      const k = el('span', 'hud-key');
      k.insertAdjacentHTML('beforeend', icons.key(KEY_COLORS[c].hex));
      if (n > 1) k.append(el('span', 'hud-count', `×${n}`));
      keysCell.append(k);
    }
    keysCell.hidden = !any;
    keysCell.setAttribute('role', 'img');
    keysCell.setAttribute('aria-label', any ? `Keys: ${words.join(', ')}` : 'No keys');
  }

  // `now` cuts the line: the Shadow's defeat and the win replace whatever is showing.
  function showMoment(title, sub = '', color = null, now = false) {
    if (now) queue.length = 0;
    queue.push({ title, sub, color });
    if (queue.length > 3) queue.splice(0, queue.length - 3);
    if (now || momentT <= 0) nextMoment();
  }

  function nextMoment() {
    const m = queue.shift();
    if (!m) {
      moment.classList.remove('is-on');
      momentT = 0;
      return;
    }
    momentTitle.textContent = m.title;
    momentSub.textContent = m.sub;
    momentTitle.style.color = colorOf(m.color, '#fff4d6');
    moment.classList.add('is-on');
    momentT = m.sub ? 2.4 : 1.8;
  }

  function setWarning(on, here) {
    warning.classList.toggle('is-on', on);
    warnText.textContent = here ? 'THE SHADOW IS HERE' : 'THE SHADOW IS COMING';
  }

  // Sim banners that deserve the big center treatment. The sim's words become the
  // moment's title; these add a line underneath. Anything else stays in the small pill.
  let promote = null;

  function handleEvents(game, events) {
    promote = null;
    for (const e of events) {
      switch (e.type) {
        case 'roomEnter':
          warnSerial = -1;
          shadowHere = false;
          break;
        case 'zoneEnter': {
          const z = ZONES[e.zone];
          if (z) showMoment(z.name.toUpperCase(), e.zone === 4 ? 'The lair is close. Everything is faster.' : 'Robots get faster from here.', z.color);
          break;
        }
        case 'roomClear':
          promote = { sub: 'Speed boost in this room', color: '#7dffb0' };
          break;
        case 'extraLife':
          // A life earned by score has no banner of its own.
          if (e.reason === 'score') showMoment('EXTRA LIFE', 'For your score', '#7dffb0');
          else promote = promote || { sub: e.reason === 'mystery' ? 'From a mystery' : '', color: '#7dffb0' };
          break;
        case 'mystery':
          if (e.outcome === 'shield') promote = { sub: 'Robots and bolts can’t hurt you for a while', color: '#7fd4ff' };
          else if (e.outcome === 'freeze') promote = { sub: 'Every robot in the room stops', color: '#7fd4ff' };
          else if (e.outcome === 'shadow') promote = { sub: 'A bad mystery. Run!', color: '#c9b8ff' };
          break;
        case 'doorOpen':
          showMoment('DOOR OPEN', '', e.color);
          break;
        case 'shadowWarn':
          warnSerial = game.room.serial;
          break;
        case 'shadowEnter':
          warnSerial = game.room.serial;
          shadowHere = true;
          break;
        case 'shadowDefeat':
          promote = { sub: '', color: '#ffe14d', now: true };
          break;
        case 'win':
          promote = { sub: 'You beat the Shadow in his own lair', color: '#ffe14d', now: true };
          break;
        default:
      }
    }
  }

  return {
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    // Forget everything shown, for a fresh game.
    reset() {
      last.score = -1;
      last.lives = -1;
      last.keys = '';
      last.room = '';
      last.status = '';
      last.banner = null;
      last.boss = '';
      boss.hidden = true;
      queue.length = 0;
      momentT = 0;
      moment.classList.remove('is-on');
      banner.classList.remove('is-on');
      warnSerial = -1;
      shadowHere = false;
      setWarning(false, false);
    },
    // A moment the shell wants on screen (the start of a case, say).
    moment: showMoment,
    update(game, events, dt = 0) {
      if (!game) return;
      handleEvents(game, events);

      if (game.score !== last.score) {
        last.score = game.score;
        setScore(game.score);
      }
      if (game.lives !== last.lives) {
        last.lives = game.lives;
        setLives(game.lives);
      }
      const keySig = KEY_ORDER.map((c) => game.keys?.[c] ?? 0).join(',');
      if (keySig !== last.keys) {
        last.keys = keySig;
        setKeys(game.keys);
      }
      const room = game.room;
      const roomSig = room ? `${room.id}:${room.zone}` : '';
      if (roomSig !== last.room && room) {
        last.room = roomSig;
        const z = ZONES[room.zone];
        roomLine.textContent = `ROOM ${room.id} · ${z ? z.name.toUpperCase() : ''}`;
        roomLine.style.color = z ? z.color : '';
      }

      // Shield and frozen-robot timers.
      const p = game.player;
      const parts = [];
      if (p && p.shieldT > 0) parts.push(`SHIELD ${Math.ceil(p.shieldT)}`);
      // The sim also freezes robots while the beaten Shadow goes down; that's no power-up.
      const shadowFalling = game.shadow?.state === 'dying' || game.mode === 'won';
      if (game.freezeT > 0 && !shadowFalling) parts.push(`FROZEN ${Math.ceil(game.freezeT)}`);
      const statusSig = parts.join('|');
      if (statusSig !== last.status) {
        last.status = statusSig;
        status.innerHTML = '';
        for (const t of parts) status.append(el('span', 'hud-chip', t));
      }

      // The sim's short banner: big moments go center stage, the rest in the pill.
      const b = game.banner;
      if (b !== last.banner) {
        last.banner = b;
        if (b && promote) {
          showMoment(b.text, promote.sub, b.color || promote.color, !!promote.now);
          banner.classList.remove('is-on');
        } else if (b) {
          banner.textContent = b.text;
          banner.style.color = colorOf(b.color, '#fff4d6');
          banner.classList.add('is-on');
        } else {
          banner.classList.remove('is-on');
        }
      }

      // The Shadow's health bar, in the lair once the fight has started.
      const inLair = room && room.id === LAIR_ROOM;
      const hpMax = game.shadow?.hpMax ?? SHADOW.lairHits;
      const hp = game.shadow?.hpMax ? game.shadow.hp : game.lairHp;
      const bossSig = inLair && hp != null ? `${hp}/${hpMax}` : '';
      if (bossSig !== last.boss) {
        last.boss = bossSig;
        boss.hidden = !bossSig;
        if (bossSig) {
          const k = Math.max(0, Math.min(1, hp / hpMax));
          bossFill.style.width = `${(k * 100).toFixed(1)}%`;
          bossTrack.setAttribute('aria-valuemax', String(hpMax));
          bossTrack.setAttribute('aria-valuenow', String(hp));
          bossTrack.setAttribute('aria-valuetext', `${hp} of ${hpMax} hits left`);
          bossLabel.textContent = hp > 0 ? `THE SHADOW · ${hp} HITS LEFT` : 'THE SHADOW · BEATEN';
        }
      }

      // The Shadow warning: from shadowWarn until the room changes.
      const warned = room && (warnSerial === room.serial || (room.warned && game.mode !== 'won'));
      const here = shadowHere || !!game.shadow;
      setWarning(!!warned && game.mode !== 'gameover' && game.mode !== 'won', here);

      if (momentT > 0) {
        momentT -= dt;
        if (momentT <= 0) nextMoment();
      }
    },
  };
}
