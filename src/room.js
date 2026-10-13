// Room layouts: parse the ASCII grid in src/rooms/*.js into geometry that the sim, the
// renderer, and tools/check-rooms.mjs share. docs/ROOMS.md describes the format.
//
// Coordinates are room units: x runs right from 0 to W, y runs down from 0 to H, and
// cell (c, r) covers [c, c+1) x [r, r+1). Electric walls are thin: each '#' cell is a
// post at its center, joined by a beam to every '#' cell beside it (never diagonally).

import { ROOMS, SIDES } from './map.js';

export const W = 21;
export const H = 13;
export const WALL_HALF = 0.18; // half thickness of an electric beam and radius of a post
export const BLOCK_HALF = 0.42; // crates, barrels, and terminals are boxes this far from center
// A locked door is a colored barrier across its opening. Its room-side face sits this far
// inside the door line; it blocks but never shocks.
export const LOCK_FACE = 0.6;

// The three border cells each door opens through.
export const OPENINGS = {
  N: [[9, 0], [10, 0], [11, 0]],
  S: [[9, 12], [10, 12], [11, 12]],
  W: [[0, 5], [0, 6], [0, 7]],
  E: [[20, 5], [20, 6], [20, 7]],
};
// Where a door's opening sits: the axis it spans and the line it lies on.
export const DOOR = {
  N: { axis: 'x', min: 9, max: 12, line: 0.5, center: { x: 10.5, y: 0.5 } },
  S: { axis: 'x', min: 9, max: 12, line: 12.5, center: { x: 10.5, y: 12.5 } },
  W: { axis: 'y', min: 5, max: 8, line: 0.5, center: { x: 0.5, y: 6.5 } },
  E: { axis: 'y', min: 5, max: 8, line: 20.5, center: { x: 20.5, y: 6.5 } },
};

export const CELL = { FLOOR: 0, WALL: 1, BLOCK: 2, POD: 3 };
const BLOCKS = { B: 'crate', O: 'barrel', T: 'terminal' };
const DECOR = { v: 'vent', '=': 'grate' };
const LEGAL = new Set('#.BOTPve*HS='.split(''));

// Arm bits on a post: which neighbors it joins.
export const ARM = { N: 1, E: 2, S: 4, W: 8 };

export function parseRoom(def, meta = ROOMS[def.id]) {
  const rows = def.layout;
  if (!Array.isArray(rows) || rows.length !== H) throw new Error(`room ${def.id}: layout needs ${H} rows`);
  rows.forEach((row, r) => {
    if (row.length !== W) throw new Error(`room ${def.id}: row ${r} is ${row.length} wide, needs ${W}`);
    for (const ch of row) if (!LEGAL.has(ch)) throw new Error(`room ${def.id}: unknown cell '${ch}' in row ${r}`);
  });
  const at = (c, r) => (c < 0 || r < 0 || c >= W || r >= H ? ' ' : rows[r][c]);

  // Border: '#' everywhere except the three cells of each door, which must be open.
  const doorCells = new Set();
  for (const side of SIDES) {
    if (meta.exits[side] === undefined) continue;
    for (const [c, r] of OPENINGS[side]) doorCells.add(`${c},${r}`);
  }
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (r !== 0 && r !== H - 1 && c !== 0 && c !== W - 1) continue;
      const ch = at(c, r);
      if (doorCells.has(`${c},${r}`)) {
        if (ch === '#') throw new Error(`room ${def.id}: door cell ${c},${r} is walled`);
      } else if (ch !== '#') {
        throw new Error(`room ${def.id}: border cell ${c},${r} must be '#' (no door there)`);
      }
    }
  }

  const solid = new Uint8Array(W * H);
  const posts = [];
  const podPosts = [];
  const blocks = [];
  const decor = [];
  const spawns = [];
  let itemSpot = null;
  let keyholeSpot = null;
  let start = null;
  const isWall = (c, r) => at(c, r) === '#';
  const isPod = (c, r) => at(c, r) === 'P';
  const armsOf = (c, r, test) =>
    (test(c, r - 1) ? ARM.N : 0) | (test(c + 1, r) ? ARM.E : 0) | (test(c, r + 1) ? ARM.S : 0) | (test(c - 1, r) ? ARM.W : 0);

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ch = at(c, r);
      const x = c + 0.5;
      const y = r + 0.5;
      const i = r * W + c;
      if (ch === '#') {
        solid[i] = CELL.WALL;
        posts.push({ c, r, x, y, arms: armsOf(c, r, isWall) });
      } else if (ch === 'P') {
        solid[i] = CELL.POD;
        // A gate joins its fellow gates and the walls it spans between, so no seam is
        // left at the joint while it is on.
        podPosts.push({ c, r, x, y, arms: armsOf(c, r, (cc, rr) => isPod(cc, rr) || isWall(cc, rr)) });
      } else if (BLOCKS[ch]) {
        solid[i] = CELL.BLOCK;
        blocks.push({ c, r, x, y, kind: BLOCKS[ch] });
      } else {
        if (DECOR[ch]) decor.push({ c, r, x, y, kind: DECOR[ch] });
        if (ch === 'e') spawns.push({ c, r, x, y });
        if (ch === '*') {
          if (itemSpot) throw new Error(`room ${def.id}: more than one '*'`);
          itemSpot = { c, r, x, y };
        }
        if (ch === 'H') {
          if (keyholeSpot) throw new Error(`room ${def.id}: more than one 'H'`);
          keyholeSpot = { c, r, x, y };
        }
        if (ch === 'S') start = { c, r, x, y };
      }
    }
  }

  const exits = {};
  for (const side of SIDES) {
    if (meta.exits[side] === undefined) continue;
    exits[side] = { side, to: meta.exits[side], ...DOOR[side] };
  }

  return {
    id: def.id,
    zone: meta.zone,
    W,
    H,
    layout: rows.slice(),
    solid,
    posts, // electric wall posts with their arm bits
    beams: beamsOf(posts),
    podPosts,
    podBeams: podBeamsOf(podPosts, isWall),
    blocks,
    decor,
    spawns,
    itemSpot,
    keyholeSpot,
    start,
    exits,
    n: def.n ?? 0,
    foes: def.foes ?? null,
    podCycle: def.pod ?? (podPosts.length ? { period: 4, open: 1.6 } : null),
    placeholder: !!def.placeholder,
  };
}

// Each beam once, as a segment between two post centers.
function beamsOf(posts) {
  const out = [];
  for (const p of posts) {
    if (p.arms & ARM.E) out.push({ x1: p.x, y1: p.y, x2: p.x + 1, y2: p.y });
    if (p.arms & ARM.S) out.push({ x1: p.x, y1: p.y, x2: p.x, y2: p.y + 1 });
  }
  return out;
}

// Gate beams: between gates once, and from a gate to every wall post beside it (wall
// posts never beam toward a gate, so these are the only beams at that joint).
function podBeamsOf(podPosts, isWall) {
  const out = beamsOf(podPosts);
  for (const p of podPosts) {
    if (p.arms & ARM.W && isWall(p.c - 1, p.r)) out.push({ x1: p.x - 1, y1: p.y, x2: p.x, y2: p.y });
    if (p.arms & ARM.N && isWall(p.c, p.r - 1)) out.push({ x1: p.x, y1: p.y - 1, x2: p.x, y2: p.y });
  }
  return out;
}

// A stand-in for a room nobody has drawn yet: border, doors, the item in the middle.
export function placeholderDef(id) {
  const meta = ROOMS[id];
  const g = [];
  for (let r = 0; r < H; r++) {
    let row = '';
    for (let c = 0; c < W; c++) row += r === 0 || r === H - 1 || c === 0 || c === W - 1 ? '#' : '.';
    g.push(row.split(''));
  }
  for (const side of SIDES) if (meta.exits[side] !== undefined) for (const [c, r] of OPENINGS[side]) g[r][c] = '.';
  if (meta.item?.kind === 'keyhole') g[6][15] = 'H';
  else if (meta.item) g[6][10] = '*';
  for (const [c, r] of [[4, 3], [16, 3], [4, 9], [16, 9]]) g[r][c] = 'e';
  if (id === 0) g[6][5] = 'S';
  return { id, n: 2 + meta.zone, layout: g.map((row) => row.join('')), placeholder: true };
}

// ------------------------------------------------------------------ geometry queries

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = x1 + t * dx - px;
  const ey = y1 + t * dy - py;
  return Math.sqrt(ex * ex + ey * ey);
}

// Distance from a point to the electric shape inside one cell: its post plus half of
// each arm (the neighbor draws the other half).
function distToCellShape(room, c, r, px, py, kind) {
  const x = c + 0.5;
  const y = r + 0.5;
  // A gate's arms also reach toward the walls it joins (half of each such beam is the
  // gate's, live only while it is on).
  const same = (cc, rr) => {
    if (cc < 0 || rr < 0 || cc >= W || rr >= H) return false;
    const k = room.solid[rr * W + cc];
    return k === kind || (kind === CELL.POD && k === CELL.WALL);
  };
  let d = Math.hypot(px - x, py - y);
  if (same(c, r - 1)) d = Math.min(d, distToSeg(px, py, x, y, x, y - 0.5));
  if (same(c + 1, r)) d = Math.min(d, distToSeg(px, py, x, y, x + 0.5, y));
  if (same(c, r + 1)) d = Math.min(d, distToSeg(px, py, x, y, x, y + 0.5));
  if (same(c - 1, r)) d = Math.min(d, distToSeg(px, py, x, y, x - 0.5, y));
  return d;
}

// Distance from (px, py) to the nearest electric wall (kind CELL.WALL) or pod gate
// (CELL.POD), looking only at nearby cells. Returns Infinity past about 1.5 units.
export function wallDistance(room, px, py, kind = CELL.WALL) {
  const c0 = Math.floor(px);
  const r0 = Math.floor(py);
  let best = Infinity;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    if (r < 0 || r >= H) continue;
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= W) continue;
      if (room.solid[r * W + c] !== kind) continue;
      const d = distToCellShape(room, c, r, px, py, kind);
      if (d < best) best = d;
    }
  }
  return best;
}

// True when a circle of radius `rad` at (px, py) touches an electric wall.
export function touchesWall(room, px, py, rad) {
  return wallDistance(room, px, py, CELL.WALL) < WALL_HALF + rad;
}

// True when a circle touches a pod gate (only lethal while the gate is on).
export function touchesPod(room, px, py, rad) {
  return room.podPosts.length > 0 && wallDistance(room, px, py, CELL.POD) < WALL_HALF + rad;
}

// The block box (crate, barrel, terminal) a circle overlaps, or null.
export function blockAt(room, px, py, rad) {
  const c0 = Math.floor(px);
  const r0 = Math.floor(py);
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    if (r < 0 || r >= H) continue;
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= W || room.solid[r * W + c] !== CELL.BLOCK) continue;
      const cx = c + 0.5;
      const cy = r + 0.5;
      const qx = Math.max(cx - BLOCK_HALF, Math.min(px, cx + BLOCK_HALF));
      const qy = Math.max(cy - BLOCK_HALF, Math.min(py, cy + BLOCK_HALF));
      if ((px - qx) ** 2 + (py - qy) ** 2 < rad * rad) return { c, r, x: cx, y: cy };
    }
  }
  return null;
}

// Push a circle out of any block it overlaps. Returns the corrected position.
export function pushOutOfBlocks(room, px, py, rad) {
  for (let pass = 0; pass < 3; pass++) {
    const b = blockAt(room, px, py, rad);
    if (!b) break;
    const qx = Math.max(b.x - BLOCK_HALF, Math.min(px, b.x + BLOCK_HALF));
    const qy = Math.max(b.y - BLOCK_HALF, Math.min(py, b.y + BLOCK_HALF));
    let nx = px - qx;
    let ny = py - qy;
    let len = Math.hypot(nx, ny);
    if (len < 1e-6) {
      // Center inside the box: leave along the shallowest side.
      const dxl = px - (b.x - BLOCK_HALF);
      const dxr = b.x + BLOCK_HALF - px;
      const dyt = py - (b.y - BLOCK_HALF);
      const dyb = b.y + BLOCK_HALF - py;
      const m = Math.min(dxl, dxr, dyt, dyb);
      if (m === dxl) { nx = -1; ny = 0; len = dxl; }
      else if (m === dxr) { nx = 1; ny = 0; len = dxr; }
      else if (m === dyt) { nx = 0; ny = -1; len = dyt; }
      else { nx = 0; ny = 1; len = dyb; }
      px += nx * (len + rad);
      py += ny * (len + rad);
    } else {
      px = qx + (nx / len) * rad;
      py = qy + (ny / len) * rad;
    }
  }
  return { x: px, y: py };
}

// Whether a straight path is free of walls (and blocks, and gates that are on).
export function lineClear(room, x1, y1, x2, y2, { podsOn = false, rad = 0 } = {}) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(len / 0.12));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (touchesWall(room, x, y, rad)) return false;
    if (blockAt(room, x, y, rad)) return false;
    if (podsOn && touchesPod(room, x, y, rad)) return false;
  }
  return true;
}

// Cells robots may stand on: floor that is not a wall, block, or gate.
export function walkableCell(room, c, r) {
  return c >= 0 && r >= 0 && c < W && r < H && room.solid[r * W + c] === CELL.FLOOR;
}
