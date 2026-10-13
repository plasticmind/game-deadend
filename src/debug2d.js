// A plain Canvas 2D top-down view of the sim state, with the same API as the Three.js
// Renderer. main.js uses it with ?view=2d, and as the fallback when the 3D renderer
// can't load (no WebGL, the CDN is unreachable, or src/render/ isn't there yet).
// It draws what the sim knows: walls as lines, blocks (barrels lit or gone, consoles by
// state), the item, Shamus and his gun's heat, robots, shots, bolts, and the Shadow.
// Nothing in it flashes; pulses stay under 1.5 Hz.

import { ZONES, KEY_COLORS } from './map.js';
import { WALL_HALF, BLOCK_HALF, LOCK_FACE, DOOR, W, H } from './room.js';
import { SKILLS, BARREL } from './sim/tuning.js';

const SCREEN = { idle: '#3ee07a', used: '#4fd8ff', broken: '#2a1c18' };

const FOE_STYLE = {
  droid: { fill: '#eef0f2', eye: '#ff3b30', label: 'D' },
  drone: { fill: '#3fe0f0', eye: '#0b3a40', label: 'W' },
  jumper: { fill: '#2fbf5a', eye: '#ffd23f', label: 'J' },
  sniffer: { fill: '#7b5cff', eye: '#ff3b30', label: 'S' },
  warden: { fill: '#ff8a2a', eye: '#2a1406', label: 'T' },
};

export class Debug2D {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('Canvas 2D is unavailable');
    this.reduced = reducedMotion;
    this.t = 0;
    this.fx = [];
    this.is2d = true;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  setQuality() {}

  setReducedMotion(on) {
    this.reduced = !!on;
  }

  dispose() {
    this.fx.length = 0;
  }

  // The room point (in cells) under a screen point (client pixels), for mouse aiming.
  screenToRoom(clientX, clientY) {
    if (!this.fit) return null;
    const r = this.canvas.getBoundingClientRect();
    const { s, ox, oy } = this.fit;
    return { x: ((clientX - r.left) * this.dpr - ox) / s, y: ((clientY - r.top) * this.dpr - oy) / s };
  }

  render(game, events = [], dt = 0) {
    this.t += dt;
    const { ctx, canvas } = this;
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07080c';
    ctx.fillRect(0, 0, cw, ch);
    if (!game || !game.room) return;

    // Fit the room with a margin; leave the top for the HUD panel.
    const top = 86 * this.dpr;
    const pad = 18 * this.dpr;
    const s = Math.min((cw - pad * 2) / W, (ch - top - pad) / H);
    const ox = (cw - s * W) / 2;
    const oy = top + (ch - top - pad - s * H) / 2;
    ctx.setTransform(s, 0, 0, s, ox, oy);
    this.fit = { s, ox, oy };
    const px = 1 / s; // one device pixel in room units

    const room = game.room;
    const geo = room.geo;
    const zoneColor = ZONES[room.zone]?.color ?? '#8f7bff';

    for (const e of events) {
      if (e.type === 'foeDie' || e.type === 'playerDie' || e.type === 'shadowStun' || e.type === 'shadowHurt' || e.type === 'shadowDefeat') {
        this.fx.push({ x: e.x, y: e.y, t: 0, dur: e.type === 'shadowDefeat' ? 1.4 : 0.6, color: e.type === 'playerDie' ? '#ffb547' : e.type.startsWith('shadow') ? '#c9b8ff' : '#ffd23f' });
      }
      if (e.type === 'barrelBoom') this.fx.push({ x: e.x, y: e.y, t: 0, dur: 0.7, color: '#ff8a2a', r: BARREL.radius });
      if (e.type === 'consoleUse' && e.fresh) this.fx.push({ x: e.x, y: e.y, t: 0, dur: 0.9, color: '#4fd8ff', r: 2.2 });
      if (e.type === 'consoleBreak') this.fx.push({ x: e.x, y: e.y, t: 0, dur: 0.5, color: '#ffb547' });
      if (e.type === 'roomEnter') this.fx.length = 0;
    }

    // Floor and grid.
    ctx.fillStyle = '#1b1f29';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#262b37';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let c = 0; c <= W; c++) {
      ctx.moveTo(c, 0);
      ctx.lineTo(c, H);
    }
    for (let r = 0; r <= H; r++) {
      ctx.moveTo(0, r);
      ctx.lineTo(W, r);
    }
    ctx.stroke();

    // Decor: vents and grates, faint.
    ctx.fillStyle = '#2a303d';
    for (const d of geo.decor || []) ctx.fillRect(d.c + 0.2, d.r + 0.2, 0.6, 0.6);

    // Electric walls: posts joined by beams.
    ctx.lineCap = 'round';
    ctx.strokeStyle = zoneColor;
    ctx.fillStyle = zoneColor;
    ctx.lineWidth = WALL_HALF * 2;
    ctx.beginPath();
    for (const b of geo.beams) {
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
    }
    ctx.stroke();
    ctx.beginPath();
    for (const p of geo.posts) {
      ctx.moveTo(p.x + WALL_HALF, p.y);
      ctx.arc(p.x, p.y, WALL_HALF, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = WALL_HALF * 0.5;
    ctx.beginPath();
    for (const b of geo.beams) {
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
    }
    ctx.stroke();

    // Pod gates: yellow while live, dashed while open.
    if (geo.podPosts && geo.podPosts.length) {
      ctx.strokeStyle = room.podOn ? '#ffd23f' : 'rgba(255, 210, 63, 0.35)';
      ctx.lineWidth = room.podOn ? WALL_HALF * 2 : WALL_HALF;
      ctx.setLineDash(room.podOn ? [0.3, 0.18] : [0.12, 0.2]);
      ctx.beginPath();
      for (const b of geo.podBeams) {
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
      }
      for (const p of geo.podPosts) {
        ctx.moveTo(p.x - 0.01, p.y);
        ctx.lineTo(p.x + 0.01, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Blocks. A lit barrel glows brighter as its fuse runs down; a blown one leaves a
    // burn mark. Consoles show their state; one waiting to map the room swells slowly.
    const attract = !SKILLS[game.skill]?.autoMap;
    for (const b of geo.blocks) {
      const x = b.x - BLOCK_HALF;
      const y = b.y - BLOCK_HALF;
      const sz = BLOCK_HALF * 2;
      if (b.kind === 'barrel') {
        if (b.gone) {
          ctx.fillStyle = 'rgba(10, 8, 6, 0.6)';
          ctx.beginPath();
          ctx.arc(b.x, b.y, BLOCK_HALF * 1.2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        const lit = b.fuse > 0 ? 1 - b.fuse / BARREL.fuse : -1;
        if (lit >= 0) {
          ctx.fillStyle = `rgba(255, 150, 40, ${0.25 + 0.45 * lit})`;
          ctx.beginPath();
          ctx.arc(b.x, b.y, BLOCK_HALF * (1.3 + 0.5 * lit), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = lit >= 0 ? '#e0582a' : '#9b2a22';
        ctx.beginPath();
        ctx.arc(b.x, b.y, BLOCK_HALF, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = lit >= 0 ? '#ffd23f' : '#d4553f';
        ctx.lineWidth = 0.06;
        ctx.stroke();
      } else if (b.kind === 'terminal') {
        const st = b.state || 'idle';
        ctx.fillStyle = '#2b313d';
        ctx.fillRect(x, y, sz, sz);
        if (st === 'idle' && attract) {
          const a = this.reduced ? 0.5 : 0.25 + 0.3 * (0.5 - 0.5 * Math.cos(this.t * Math.PI * 2 * 0.6));
          ctx.strokeStyle = `rgba(62, 224, 122, ${a})`;
          ctx.lineWidth = 0.08;
          ctx.strokeRect(x - 0.1, y - 0.1, sz + 0.2, sz + 0.2);
        }
        ctx.fillStyle = SCREEN[st] ?? SCREEN.idle;
        ctx.fillRect(x + 0.18, y + 0.16, sz - 0.36, sz * 0.38);
        if (st === 'broken') {
          ctx.strokeStyle = '#ff8a2a';
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.moveTo(x + 0.22, y + 0.2);
          ctx.lineTo(x + sz - 0.22, y + 0.16 + sz * 0.34);
          ctx.moveTo(x + sz - 0.22, y + 0.2);
          ctx.lineTo(x + 0.22, y + 0.16 + sz * 0.34);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = '#4a4f5c';
        ctx.fillRect(x, y, sz, sz);
        ctx.fillStyle = '#ffb547';
        ctx.fillRect(x + sz - 0.14, y + 0.18, 0.08, sz - 0.36);
        ctx.strokeStyle = '#6d7383';
        ctx.lineWidth = 0.05;
        ctx.strokeRect(x, y, sz, sz);
      }
    }

    // Locked doors: a colored barrier across the opening.
    for (const [side, lock] of Object.entries(room.locks || {})) {
      if (lock.open) continue;
      const d = DOOR[side];
      ctx.fillStyle = KEY_COLORS[lock.color]?.hex ?? '#fff';
      ctx.globalAlpha = 0.85;
      if (side === 'N') ctx.fillRect(d.min, d.line, d.max - d.min, LOCK_FACE);
      if (side === 'S') ctx.fillRect(d.min, d.line - LOCK_FACE, d.max - d.min, LOCK_FACE);
      if (side === 'W') ctx.fillRect(d.line, d.min, LOCK_FACE, d.max - d.min);
      if (side === 'E') ctx.fillRect(d.line - LOCK_FACE, d.min, LOCK_FACE, d.max - d.min);
      ctx.globalAlpha = 1;
    }

    // The item.
    const it = game.item;
    if (it && !it.hidden && !(it.kind !== 'keyhole' && it.used)) this.drawItem(it);

    // Robots.
    for (const f of game.foes || []) {
      const st = FOE_STYLE[f.type] || FOE_STYLE.droid;
      const r = f.r ?? 0.36;
      ctx.globalAlpha = game.freezeT > 0 ? 0.6 : 1;
      ctx.fillStyle = st.fill;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = st.eye;
      ctx.beginPath();
      const [fx, fy] = faceVec(f.face);
      ctx.arc(f.x + fx * r * 0.45, f.y + fy * r * 0.45, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      // Brass rings show the hits armor still has to take (not the sniffer's front plate).
      if (f.type !== 'sniffer') {
        ctx.strokeStyle = '#d9a441';
        ctx.lineWidth = 0.06;
        for (let i = 1; i < (f.hp ?? 1); i++) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, r + 0.06 + (i - 1) * 0.1, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // The player's ION-SHIVs and the robots' bolts.
    ctx.lineCap = 'round';
    for (const sh of game.shots || []) {
      const len = Math.hypot(sh.dx, sh.dy) || 1;
      ctx.strokeStyle = '#7fd4ff';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(sh.x - (sh.dx / len) * 0.55, sh.y - (sh.dy / len) * 0.55);
      ctx.lineTo(sh.x, sh.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff6a3d';
    for (const b of game.bolts || []) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 0.13, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawPlayer(game.player, game);

    // The Shadow.
    const sd = game.shadow;
    if (sd) {
      ctx.globalAlpha = sd.state === 'stunned' ? 0.45 : 0.78;
      ctx.fillStyle = '#2a1d4d';
      ctx.beginPath();
      ctx.arc(sd.x, sd.y, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8f7bff';
      ctx.lineWidth = 0.06;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffe14d';
      ctx.fillRect(sd.x - 0.28, sd.y - 0.12, 0.18, 0.08);
      ctx.fillRect(sd.x + 0.1, sd.y - 0.12, 0.18, 0.08);
    }

    // Bursts.
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      if (f.t >= f.dur) {
        this.fx.splice(i, 1);
        continue;
      }
      const k = f.t / f.dur;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      const r = f.r ?? 1.35;
      ctx.arc(f.x, f.y, this.reduced ? r * 0.6 : 0.25 + k * (r - 0.25), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The Shadow's warning: a slow violet vignette (0.6 Hz), steady for reduced motion.
    const warned = room.warned || game.shadow;
    if (warned && game.mode === 'play') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const a = this.reduced ? 0.35 : 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(this.t * Math.PI * 2 * 0.6));
      const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
      g.addColorStop(0, 'rgba(60, 20, 120, 0)');
      g.addColorStop(1, `rgba(60, 20, 120, ${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }
  }

  drawItem(it) {
    const { ctx } = this;
    const bob = this.reduced ? 0 : Math.sin(this.t * 2.4) * 0.05;
    const x = it.x;
    const y = it.y + bob;
    if (it.kind === 'key') {
      const c = KEY_COLORS[it.color]?.hex ?? '#fff';
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.arc(x - 0.18, y, 0.16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(x - 0.02, y - 0.05, 0.42, 0.1);
      ctx.fillRect(x + 0.24, y, 0.08, 0.16);
    } else if (it.kind === 'keyhole') {
      const c = KEY_COLORS[it.color]?.hex ?? '#fff';
      ctx.globalAlpha = it.used ? 0.4 : 1;
      ctx.fillStyle = '#1b1f29';
      ctx.strokeStyle = c;
      ctx.lineWidth = 0.08;
      ctx.fillRect(x - 0.32, y - 0.38, 0.64, 0.76);
      ctx.strokeRect(x - 0.32, y - 0.38, 0.64, 0.76);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y - 0.08, 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 0.06, y - 0.04, 0.12, 0.26);
      ctx.globalAlpha = 1;
    } else if (it.kind === 'mystery') {
      const glow = this.reduced ? 1 : 0.75 + 0.25 * Math.sin(this.t * Math.PI * 2 * 0.8);
      ctx.globalAlpha = glow;
      ctx.fillStyle = '#ffc83d';
      ctx.font = '800 0.8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x, y + 0.04);
      ctx.globalAlpha = 1;
    } else if (it.kind === 'life') {
      ctx.fillStyle = '#46e07c';
      ctx.beginPath();
      ctx.arc(x, y + 0.08, 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 0.07, y - 0.32, 0.14, 0.26);
    }
  }

  drawPlayer(p, game) {
    if (!p) return;
    const { ctx } = this;
    const [fx, fy] = p.freeAim ? [p.aimX, p.aimY] : faceVec(p.face);
    if (!p.alive) {
      ctx.strokeStyle = '#ffb547';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(p.x - 0.25, p.y - 0.25);
      ctx.lineTo(p.x + 0.25, p.y + 0.25);
      ctx.moveTo(p.x + 0.25, p.y - 0.25);
      ctx.lineTo(p.x - 0.25, p.y + 0.25);
      ctx.stroke();
      return;
    }
    ctx.globalAlpha = p.invulnT > 0 ? 0.55 : 1;
    if (p.shieldT > 0) {
      ctx.strokeStyle = '#7fd4ff';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.48, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p.aiming) {
      ctx.strokeStyle = 'rgba(127, 212, 255, 0.6)';
      ctx.lineWidth = 0.05;
      ctx.setLineDash([0.15, 0.12]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + fx * 2.2, p.y + fy * 2.2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#c98a3c'; // trench coat
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r ?? 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a3a18'; // fedora crown
    ctx.beginPath();
    ctx.arc(p.x, p.y, (p.r ?? 0.3) * 0.55, 0, Math.PI * 2);
    ctx.fill();
    // The gun shows its heat: blue when cold, orange and then red as it heats, and a
    // dim red with a ring of steam while it is locked out.
    const heat = Math.max(0, Math.min(1, p.heat ?? 0));
    const hot = p.overheatT > 0;
    ctx.strokeStyle = hot ? '#b8322a' : heat < 0.5 ? mixHex('#7fd4ff', '#ff9a3c', heat / 0.5) : mixHex('#ff9a3c', '#ff3b2a', (heat - 0.5) / 0.5);
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(p.x + fx * 0.2, p.y + fy * 0.2);
    ctx.lineTo(p.x + fx * 0.5, p.y + fy * 0.5);
    ctx.stroke();
    if (heat > 0.02 || hot) {
      ctx.strokeStyle = hot ? 'rgba(220, 220, 230, 0.55)' : `rgba(255, 140, 50, ${0.25 + 0.5 * heat})`;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (hot ? 1 : heat));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    void game;
  }
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const k = Math.max(0, Math.min(1, t));
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function faceVec(face = 0) {
  const a = (face % 8) * (Math.PI / 4);
  const len = face % 2 ? Math.SQRT1_2 : 1;
  return [Math.round(Math.cos(a)) * len, Math.round(Math.sin(a)) * len];
}
