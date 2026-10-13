// Shared high scores through the arcade's players service (players/README.md), on port
// 4703 of whatever host served the game. The game never waits on it: bigdata.local cold
// lookups can take five seconds, so reads paint the cached table first and writes are
// fire and forget. Pages opened from disk (file://) never touch the network.

const GAME_KEY = 'game-deadend';
const TIMEOUT_MS = 9000;

export function serviceUrl() {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  return `${location.protocol}//${location.hostname}:4703/api/scores/${GAME_KEY}`;
}

// Score names: letters, digits, spaces, and a little punctuation, 12 characters at most.
export function cleanName(name) {
  return String(name ?? '')
    .replace(/[^\p{L}\p{N} .'_-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
}

// The player picked on the arcade hub ("Who's playing?"), or null for a guest.
export function arcadePlayerName() {
  try {
    const p = JSON.parse(localStorage.getItem('arcade.player') || 'null');
    const name = p && !p.guest && typeof p.name === 'string' ? cleanName(p.name) : '';
    return name || null;
  } catch {
    return null;
  }
}

function withTimeout(promise, ctrl) {
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return promise.finally(() => clearTimeout(timer));
}

function cleanList(list) {
  if (!Array.isArray(list)) return null;
  return list
    .filter((s) => s && Number.isFinite(s.score))
    .map((s) => ({
      name: cleanName(s.name) || '???',
      score: Math.max(0, Math.floor(s.score)),
      level: Number.isFinite(s.level) ? s.level : null,
      note: typeof s.note === 'string' ? s.note.slice(0, 16) : '',
      date: s.date ?? null,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// The service's table, best first, or null when it can't be reached.
export async function fetchScores() {
  const url = serviceUrl();
  if (!url) return null;
  const ctrl = new AbortController();
  try {
    const res = await withTimeout(fetch(url, { signal: ctrl.signal, cache: 'no-store' }), ctrl);
    if (!res.ok) return null;
    const body = await res.json();
    return cleanList(body.scores);
  } catch {
    return null;
  }
}

// Post one finished game. Resolves to { rank, scores } from the service, or null. Never
// throws, and nothing waits on it.
export async function postScore({ name, score, level, note }) {
  const url = serviceUrl();
  const clean = cleanName(name);
  if (!url || !clean || !(score > 0)) return null;
  const ctrl = new AbortController();
  try {
    const res = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ name: clean, score: Math.floor(score), level, note }),
        keepalive: true,
        signal: ctrl.signal,
      }),
      ctrl,
    );
    if (!res.ok) return null;
    const body = await res.json();
    return { rank: body.rank ?? null, added: !!body.added, scores: cleanList(body.scores) };
  } catch {
    return null;
  }
}

// Fold a new entry into a cached table so the title screen shows it before the service
// answers (or when there is no service at all).
export function mergeLocal(list, entry) {
  const next = [...(list || []), { ...entry, date: new Date().toISOString() }];
  next.sort((a, b) => b.score - a.score);
  return next.slice(0, 10);
}
