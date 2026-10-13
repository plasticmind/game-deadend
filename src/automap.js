// The map screen's drawing: every mapped room at its gx, gy cell from map.js (the layout
// of the original fan map, 49 by 12 cells), the doors between mapped rooms, locked doors
// as colored dashes (solid once opened), stubs for doors that lead off the map, items
// seen but not taken, and the current room with a slow pulse. A room is mapped when you
// walk in on a skill with `autoMap`, or when a console maps its section; a mapped room you
// haven't been in yet is drawn dimmer and shows no items. Unmapped rooms stay hidden.
// Canvas 2D; called every frame while the map is open.

import { ROOMS, ZONES, KEY_COLORS, LAIR_ROOM, lockOn } from './map.js';

export const MAP_COLS = 49;
export const MAP_ROWS = 12;
export const MIN_CELL = 13; // below this the map scrolls sideways instead of shrinking

const DIR = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function mapStats(game) {
  const visited = Object.keys(game.visited || {}).length;
  const mapped = Object.keys(game.mapped || {}).length;
  const here = game.room ? game.room.id : -1;
  return { visited, mapped, total: ROOMS.length, hereMapped: here >= 0 && !!(game.mapped || {})[here] };
}

const WHOLE = { gx0: 0, gy0: 0, cols: MAP_COLS, rows: MAP_ROWS };
const MAX_CELL = 72; // a map of two rooms shouldn't fill the screen with two boxes

// The part of the map to show: the whole lair, or just what has been found (plus a
// margin for door stubs), so an early map isn't a few specks in an empty grid.
export function mapWindow(game, whole = false) {
  if (whole) return WHOLE;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of Object.keys(game.mapped || {})) {
    const r = ROOMS[id];
    x0 = Math.min(x0, r.gx);
    y0 = Math.min(y0, r.gy);
    x1 = Math.max(x1, r.gx);
    y1 = Math.max(y1, r.gy);
  }
  if (x0 === Infinity) return WHOLE;
  const span = (lo, hi, min, max) => {
    lo -= 1;
    hi += 1;
    while (hi - lo + 1 < min) {
      if (lo > 0) lo--;
      if (hi - lo + 1 < min && hi < max - 1) hi++;
      if (lo === 0 && hi === max - 1) break;
    }
    return [Math.max(0, lo), Math.min(max - 1, hi)];
  };
  const [gx0, gx1] = span(x0, x1, 12, MAP_COLS);
  const [gy0, gy1] = span(y0, y1, 6, MAP_ROWS);
  return { gx0, gy0, cols: gx1 - gx0 + 1, rows: gy1 - gy0 + 1 };
}

// The CSS pixel size the canvas wants to fill `availW` by `availH` with window `win`.
export function mapSize(availW, availH, win = WHOLE) {
  const cell = Math.min(MAX_CELL, Math.max(MIN_CELL, Math.min(availW / win.cols, availH / win.rows)));
  return { cell, width: Math.ceil(cell * win.cols), height: Math.ceil(cell * win.rows) };
}

// Center of a room in CSS pixels, so the screen can scroll it into view.
export function roomCenter(id, cell, win = WHOLE) {
  const r = ROOMS[id];
  return { x: (r.gx - win.gx0 + 0.5) * cell, y: (r.gy - win.gy0 + 0.5) * cell };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawKey(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 24, s / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(7, 12, 4.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillRect(11, 10.7, 10.2, 2.6);
  ctx.fillRect(16.4, 12, 2.6, 4.5);
  ctx.restore();
}

function drawLock(ctx, x, y, s, color, open) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 24, s / 24);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = color;
  ctx.fillStyle = open ? 'transparent' : color;
  ctx.beginPath();
  ctx.arc(12, 9, 4.2, Math.PI, 0);
  ctx.stroke();
  roundRect(ctx, 5.5, 9, 13, 11, 2);
  if (open) ctx.stroke();
  else ctx.fill();
  ctx.restore();
}

// Draw the whole map. `t` is seconds (for the pulse); `cell` comes from mapSize.
export function drawAutomap(canvas, game, { t = 0, reduced = false, cell = 16, win = WHOLE } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = Math.ceil(cell * win.cols);
  const cssH = Math.ceil(cell * win.rows);
  const pw = Math.round(cssW * dpr);
  const ph = Math.round(cssH * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.translate(-win.gx0 * cell, -win.gy0 * cell);

  const s = cell;
  const box = s * 0.64;
  const gap = (s - box) / 2;
  const shown = game.mapped || {};
  const been = game.visited || {};
  const here = game.room && shown[game.room.id] ? game.room.id : -1;
  const cx = (r) => (r.gx + 0.5) * s;
  const cy = (r) => (r.gy + 0.5) * s;
  const sidePoint = (r, side) => [cx(r) + DIR[side][0] * (box / 2), cy(r) + DIR[side][1] * (box / 2)];

  // Faint grid of the lair's extent, so the shape reads before much is found.
  ctx.fillStyle = 'rgba(143, 123, 255, 0.07)';
  for (let gy = win.gy0; gy < win.gy0 + win.rows; gy++) {
    for (let gx = win.gx0; gx < win.gx0 + win.cols; gx++) ctx.fillRect((gx + 0.5) * s - 1, (gy + 0.5) * s - 1, 2, 2);
  }

  // ---- doors
  ctx.lineCap = 'round';
  for (const a of ROOMS) {
    if (!shown[a.id]) continue;
    for (const [side, bId] of Object.entries(a.exits)) {
      const b = ROOMS[bId];
      const lock = lockOn(a.id, side);
      const color = lock ? KEY_COLORS[lock.color].hex : '#8d93a3';
      const opened = lock ? !!game.opened[lock.id] : true;
      ctx.strokeStyle = color;
      ctx.lineWidth = lock ? Math.max(2, s * 0.14) : Math.max(1.5, s * 0.08);
      ctx.setLineDash(lock && !opened ? [Math.max(2, s * 0.12), Math.max(2, s * 0.1)] : []);
      const [x1, y1] = sidePoint(a, side);
      ctx.beginPath();
      if (shown[bId]) {
        if (bId < a.id) continue; // each pair once
        const [x2, y2] = sidePoint(b, OPP[side]);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + DIR[side][0] * gap, y1 + DIR[side][1] * gap);
        ctx.lineTo(x2 + DIR[OPP[side]][0] * gap, y2 + DIR[OPP[side]][1] * gap);
        ctx.lineTo(x2, y2);
      } else {
        // A door that leads off the map.
        const len = gap + s * 0.16;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + DIR[side][0] * len, y1 + DIR[side][1] * len);
      }
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // ---- rooms
  const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.55);
  const fontPx = Math.max(8, Math.round(box * 0.36));
  for (const r of ROOMS) {
    if (!shown[r.id]) continue;
    const zone = ZONES[r.zone];
    const x = cx(r) - box / 2;
    const y = cy(r) - box / 2;
    const isHere = r.id === here;
    const seen = !!been[r.id];
    roundRect(ctx, x, y, box, box, Math.max(2, s * 0.08));
    ctx.fillStyle = seen ? '#121620' : '#0b0d13';
    ctx.fill();
    if (isHere) {
      ctx.globalAlpha = 0.35 + 0.4 * pulse;
      ctx.fillStyle = zone.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = isHere ? Math.max(2, s * 0.1) : Math.max(1, s * 0.06);
    ctx.strokeStyle = isHere ? '#fff4d6' : zone.color;
    // Mapped but not visited yet: a dashed outline.
    if (!seen && !isHere) ctx.setLineDash([Math.max(2, s * 0.1), Math.max(2, s * 0.07)]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (r.pod) {
      // Yellow and black hazard tick for pod rooms.
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(x + box * 0.12, y + box - Math.max(2, s * 0.08) - 1, box * 0.76, Math.max(2, s * 0.08));
    }
    if (r.id === LAIR_ROOM) {
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath();
      ctx.arc(cx(r) - box * 0.15, cy(r) + box * 0.2, Math.max(1.2, s * 0.05), 0, Math.PI * 2);
      ctx.arc(cx(r) + box * 0.15, cy(r) + box * 0.2, Math.max(1.2, s * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
    if (box >= 14) {
      ctx.fillStyle = isHere ? '#ffffff' : '#c9c4b8';
      ctx.font = `600 ${fontPx}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(r.id), cx(r), cy(r) - (r.item ? box * 0.14 : 0));
    }

    // Items seen but not taken, and keyholes, in rooms you have been in.
    const it = r.item;
    if (!it || !seen) continue;
    const isz = Math.max(6, box * 0.42);
    const ix = cx(r) - isz / 2;
    const iy = box >= 14 ? cy(r) + box * 0.02 : cy(r) - isz / 2;
    if (it.kind === 'keyhole') {
      drawLock(ctx, ix, iy, isz, KEY_COLORS[it.color].hex, !!game.opened[r.id]);
    } else if (!game.taken[r.id]) {
      if (it.kind === 'key') drawKey(ctx, ix, iy, isz, KEY_COLORS[it.color].hex);
      else if (it.kind === 'mystery') {
        ctx.fillStyle = '#ffc83d';
        ctx.font = `800 ${Math.round(isz)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', cx(r), iy + isz / 2);
      } else if (it.kind === 'life') {
        ctx.fillStyle = '#46e07c';
        ctx.beginPath();
        ctx.arc(cx(r), iy + isz * 0.6, isz * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(cx(r) - isz * 0.1, iy + isz * 0.08, isz * 0.2, isz * 0.3);
      }
    }
  }

  // Shamus's marker in the current room.
  if (here >= 0) {
    const r = ROOMS[here];
    ctx.fillStyle = '#ffb547';
    ctx.strokeStyle = '#1a0f02';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx(r) + box * 0.36, cy(r) - box * 0.36, Math.max(3, s * 0.13), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
