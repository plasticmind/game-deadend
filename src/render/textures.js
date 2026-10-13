// Procedural canvas textures. No image files: every surface is painted here once and
// cached by the kit.

import * as THREE from 'three';
import { mulberry } from './util.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

export function toTexture(c, { srgb = true, repeat = false, aniso = 1, mipmaps = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (!mipmaps) {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  return t;
}

function rivet(g, x, y, r) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x, y, r);
  gr.addColorStop(0, '#e4e8ef');
  gr.addColorStop(0.55, '#868c97');
  gr.addColorStop(1, '#25282e');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function brushed(g, S, rnd, n = 900, alpha = 0.08) {
  for (let i = 0; i < n; i++) {
    const y = rnd() * S;
    const a = rnd() * alpha;
    g.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(rnd() * S - 40, y, 40 + rnd() * S * 0.8, 1);
  }
}

function grime(g, S, rnd, n, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = S * (0.04 + rnd() * 0.16);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(15,14,18,${alpha})`);
    gr.addColorStop(1, 'rgba(15,14,18,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}

function bevel(g, S, b, hi = 0.16, lo = 0.32) {
  g.fillStyle = `rgba(255,255,255,${hi})`;
  g.fillRect(0, 0, S, b);
  g.fillRect(0, 0, b, S);
  g.fillStyle = `rgba(0,0,0,${lo})`;
  g.fillRect(0, S - b, S, b);
  g.fillRect(S - b, 0, b, S);
}

// One floor plate: brushed steel, beveled edge, inset panel line, corner rivets.
export function floorPlate(aniso) {
  const S = 256;
  const [c, g] = canvas(S);
  const rnd = mulberry(7);
  g.fillStyle = '#858d9b';
  g.fillRect(0, 0, S, S);
  brushed(g, S, rnd, 1100, 0.07);
  grime(g, S, rnd, 9, 0.12);
  bevel(g, S, 7, 0.2, 0.35);
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, S - 3, S - 3);
  g.strokeStyle = 'rgba(0,0,0,0.2)';
  g.lineWidth = 2;
  g.strokeRect(30, 30, S - 60, S - 60);
  g.strokeStyle = 'rgba(255,255,255,0.09)';
  g.strokeRect(32, 32, S - 60, S - 60);
  for (const [x, y] of [[17, 17], [S - 17, 17], [17, S - 17], [S - 17, S - 17]]) rivet(g, x, y, 6);
  return toTexture(c, { aniso });
}

// Dark steel wall panels, tiled in world units (two panels per repeat).
export function steelPanel(aniso, { base = '#4a4f59', seam = 128, rivets = true, seed = 3 } = {}) {
  const S = 256;
  const [c, g] = canvas(S);
  const rnd = mulberry(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  brushed(g, S, rnd, 500, 0.06);
  grime(g, S, rnd, 10, 0.18);
  for (let x = 0; x < S; x += seam) {
    for (let y = 0; y < S; y += seam) {
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(x, y, seam, 3);
      g.fillRect(x, y, 3, seam);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(x, y + seam - 3, seam, 3);
      g.fillRect(x + seam - 3, y, 3, seam);
      if (rivets) {
        for (let i = 12; i < seam; i += 26) {
          rivet(g, x + i, y + 9, 3);
          rivet(g, x + i, y + seam - 10, 3);
        }
      }
    }
  }
  return toTexture(c, { aniso, repeat: true });
}

// Crate side: beveled frame, inner panel, and a column of amber lamp slots. The
// emissive map lights just the lamps.
export function crateSide() {
  const S = 128;
  const [c, g] = canvas(S);
  const [ce, ge] = canvas(S);
  const rnd = mulberry(11);
  g.fillStyle = '#5a606b';
  g.fillRect(0, 0, S, S);
  brushed(g, S, rnd, 260, 0.07);
  bevel(g, S, 7, 0.22, 0.4);
  g.fillStyle = '#464b55';
  g.fillRect(16, 16, S - 32, S - 32);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.strokeRect(16, 16, S - 32, S - 32);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.strokeRect(18, 18, S - 32, S - 32);
  for (const [x, y] of [[9, 9], [S - 9, 9], [9, S - 9], [S - 9, S - 9]]) rivet(g, x, y, 3.5);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++) {
    const y = 34 + i * 17;
    g.fillStyle = '#2a1a08';
    g.fillRect(S - 34, y, 12, 9);
    ge.fillStyle = '#ffb547';
    ge.fillRect(S - 33, y + 1, 10, 7);
  }
  return [toTexture(c), toTexture(ce)];
}

export function crateTop() {
  const S = 128;
  const [c, g] = canvas(S);
  const rnd = mulberry(12);
  g.fillStyle = '#6b717c';
  g.fillRect(0, 0, S, S);
  brushed(g, S, rnd, 260, 0.06);
  bevel(g, S, 8, 0.25, 0.4);
  g.fillStyle = '#585e69';
  g.fillRect(22, 22, S - 44, S - 44);
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 3;
  g.strokeRect(22, 22, S - 44, S - 44);
  g.strokeStyle = 'rgba(255,255,255,0.1)';
  g.lineWidth = 2;
  g.strokeRect(25, 25, S - 44, S - 44);
  for (const [x, y] of [[11, 11], [S - 11, 11], [11, S - 11], [S - 11, S - 11]]) rivet(g, x, y, 4);
  return toTexture(c);
}

export function barrelSide() {
  const W = 128;
  const H = 128;
  const [c, g] = canvas(W, H);
  const rnd = mulberry(21);
  g.fillStyle = '#a3302a';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 8);
  }
  for (const y of [10, 56, 72, 118]) {
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.fillRect(0, y - 4, W, 8);
    g.fillStyle = 'rgba(255,220,200,0.18)';
    g.fillRect(0, y - 4, W, 2);
  }
  g.fillStyle = 'rgba(255,210,80,0.85)';
  g.fillRect(W * 0.38, 26, W * 0.24, 20);
  g.fillStyle = '#2a1206';
  g.font = 'bold 15px sans-serif';
  g.textAlign = 'center';
  g.fillText('!', W * 0.5, 42);
  return toTexture(c);
}

export function barrelTop() {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = '#7d2420';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,200,180,0.25)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2);
  g.stroke();
  rivet(g, S * 0.68, S * 0.36, 9);
  return toTexture(c);
}

// The terminal's green CRT: text rows, a small bar chart, scanlines.
export function terminalScreen() {
  const W = 128;
  const H = 96;
  const [c, g] = canvas(W, H);
  const rnd = mulberry(31);
  g.fillStyle = '#04200d';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#58ff8f';
  for (let r = 0; r < 6; r++) {
    let x = 8;
    while (x < 70) {
      const w = 4 + Math.floor(rnd() * 14);
      if (x + w > 70) break;
      g.fillRect(x, 10 + r * 12, w, 5);
      x += w + 4;
    }
  }
  for (let i = 0; i < 6; i++) {
    const h = 10 + rnd() * 50;
    g.fillRect(80 + i * 7, 80 - h, 5, h);
  }
  g.strokeStyle = '#58ff8f';
  g.strokeRect(76, 12, 46, 72);
  for (let y = 0; y < H; y += 3) {
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, y, W, 1);
  }
  const vg = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  return toTexture(c);
}

// Console body: dark steel with a row of small indicator lamps (emissive map).
export function terminalBody() {
  const S = 128;
  const [c, g] = canvas(S);
  const [ce, ge] = canvas(S);
  const rnd = mulberry(33);
  g.fillStyle = '#434852';
  g.fillRect(0, 0, S, S);
  brushed(g, S, rnd, 220, 0.06);
  bevel(g, S, 6, 0.18, 0.4);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  const cols = ['#ff5040', '#ffc040', '#50ff80', '#40c0ff'];
  for (let i = 0; i < 6; i++) {
    const x = 18 + i * 16;
    g.fillStyle = '#16181c';
    g.fillRect(x, S - 30, 10, 8);
    ge.fillStyle = cols[i % cols.length];
    ge.fillRect(x + 1, S - 29, 8, 6);
  }
  g.fillStyle = '#16181c';
  for (let i = 0; i < 5; i++) g.fillRect(20, 24 + i * 9, S - 40, 4);
  return [toTexture(c), toTexture(ce)];
}

// Floor vent: slats in a frame.
export function vent() {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = '#3c4049';
  g.fillRect(0, 0, S, S);
  bevel(g, S, 6, 0.22, 0.45);
  g.fillStyle = '#0b0c10';
  g.fillRect(14, 14, S - 28, S - 28);
  for (let i = 0; i < 7; i++) {
    const y = 18 + i * 14;
    g.fillStyle = '#5b606b';
    g.fillRect(16, y, S - 32, 6);
    g.fillStyle = 'rgba(255,255,255,0.2)';
    g.fillRect(16, y, S - 32, 1.5);
  }
  for (const [x, y] of [[8, 8], [S - 8, 8], [8, S - 8], [S - 8, S - 8]]) rivet(g, x, y, 3);
  return toTexture(c);
}

// Floor grate: a grid of bars over a dark pit with a faint warm glow.
export function grate() {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = '#3a3e47';
  g.fillRect(0, 0, S, S);
  const pit = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S * 0.55);
  pit.addColorStop(0, '#3a2412');
  pit.addColorStop(1, '#08090c');
  g.fillStyle = pit;
  g.fillRect(10, 10, S - 20, S - 20);
  g.fillStyle = '#5f6570';
  for (let i = 0; i <= 8; i++) {
    const p = 10 + i * ((S - 20) / 8) - 2;
    g.fillRect(p, 10, 4, S - 20);
    g.fillRect(10, p, S - 20, 4);
  }
  bevel(g, S, 6, 0.22, 0.45);
  return toTexture(c);
}

// Soft white radial glow, used for sprites, glow decals, and blob shadows (as alpha).
export function radial(size = 128, inner = 0, falloff = 1) {
  const [c, g] = canvas(size);
  const gr = g.createRadialGradient(size / 2, size / 2, size * 0.5 * inner, size / 2, size / 2, size * 0.5);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35 * falloff, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return toTexture(c, { srgb: false });
}

// A charred blotch for explosion scorch marks.
export function scorch() {
  const S = 128;
  const [c, g] = canvas(S);
  const rnd = mulberry(41);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * S * 0.22;
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d;
    const r = S * (0.12 + rnd() * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(12,8,6,0.5)');
    gr.addColorStop(1, 'rgba(12,8,6,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    g.strokeStyle = 'rgba(8,6,4,0.55)';
    g.lineWidth = 1 + rnd() * 2;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * 10, S / 2 + Math.sin(a) * 10);
    g.lineTo(S / 2 + Math.cos(a) * S * (0.3 + rnd() * 0.18), S / 2 + Math.sin(a) * S * (0.3 + rnd() * 0.18));
    g.stroke();
  }
  return toTexture(c);
}

// A padlock in white on transparent, tinted by the material color.
export function lockIcon() {
  const S = 128;
  const [c, g] = canvas(S);
  g.lineCap = 'round';
  g.strokeStyle = '#fff';
  g.lineWidth = 13;
  g.beginPath();
  g.arc(64, 52, 24, Math.PI, 0);
  g.lineTo(88, 64);
  g.moveTo(40, 52);
  g.lineTo(40, 64);
  g.stroke();
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(26, 60, 76, 56, 10);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(64, 82, 9, 0, Math.PI * 2);
  g.fill();
  g.fillRect(60, 84, 8, 20);
  g.globalCompositeOperation = 'source-over';
  return toTexture(c, { srgb: false });
}

// A lock plate for the keyhole pedestal: a white keyhole on black (emissive mask).
export function keyholePlate() {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.strokeRect(10, 10, S - 20, S - 20);
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(64, 52, 18, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(54, 60);
  g.lineTo(74, 60);
  g.lineTo(82, 104);
  g.lineTo(46, 104);
  g.closePath();
  g.fill();
  return toTexture(c, { srgb: false });
}

// Yellow and black hazard stripes for pod posts.
export function hazard() {
  const W = 64;
  const H = 64;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#16140f';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#f2c018';
  for (let i = -2; i < 6; i++) {
    g.beginPath();
    g.moveTo(i * 16, 0);
    g.lineTo(i * 16 + 8, 0);
    g.lineTo(i * 16 + 8 + 16, H);
    g.lineTo(i * 16 + 16, H);
    g.closePath();
    g.fill();
  }
  return toTexture(c, { repeat: true });
}

// The dark machinery around the room: panels, conduit lines, a few vents.
export function machinery(aniso) {
  const S = 256;
  const [c, g] = canvas(S);
  const rnd = mulberry(51);
  g.fillStyle = '#2b2e35';
  g.fillRect(0, 0, S, S);
  brushed(g, S, rnd, 300, 0.05);
  grime(g, S, rnd, 14, 0.25);
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(rnd() * 4) * 64;
    const y = Math.floor(rnd() * 4) * 64;
    g.fillStyle = '#16181d';
    g.fillRect(x + 8, y + 8, 48, 48);
    g.fillStyle = '#3b3f48';
    for (let k = 0; k < 5; k++) g.fillRect(x + 10, y + 12 + k * 9, 44, 4);
  }
  for (let x = 0; x < S; x += 64) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x, 0, 2, S);
    g.fillRect(0, x, S, 2);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(x + 2, 0, 1, S);
    g.fillRect(0, x + 2, S, 1);
  }
  return toTexture(c, { aniso, repeat: true });
}
