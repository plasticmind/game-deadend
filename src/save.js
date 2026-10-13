// Everything Dead End remembers on this device, in one localStorage entry: settings, the
// latest checkpoint, the best score, the last initials, and a cache of the high score
// table. Storage can be missing, blocked, or full (private windows, kiosk browsers), so
// every access is wrapped and the game plays the same without it.

const KEY = 'game-deadend.v1';

export const DEFAULT_SETTINGS = {
  sound: true,
  music: true,
  quality: 'auto', // 'auto' | 'high' | 'medium' | 'low', passed to renderer.setQuality
  motion: 'system', // 'system' follows prefers-reduced-motion; 'reduce' forces it on
};

function validCheckpoint(cp) {
  return cp && typeof cp === 'object' && cp.v === 1 && Number.isInteger(cp.roomId) ? cp : null;
}

function normalize(d) {
  const src = d && typeof d === 'object' ? d : {};
  return {
    settings: { ...DEFAULT_SETTINGS, ...(src.settings && typeof src.settings === 'object' ? src.settings : {}) },
    checkpoint: validCheckpoint(src.checkpoint),
    best: Number.isFinite(src.best) ? src.best : 0,
    initials: typeof src.initials === 'string' ? src.initials.slice(0, 12) : '',
    scores: Array.isArray(src.scores) ? src.scores.filter((s) => s && typeof s.score === 'number').slice(0, 10) : [],
  };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : {});
  } catch {
    return normalize({});
  }
}

export function createSave() {
  const data = read();
  const write = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // Storage is unavailable or full; keep going with what is in memory.
    }
  };
  return {
    get settings() {
      return data.settings;
    },
    get checkpoint() {
      return data.checkpoint;
    },
    get best() {
      return data.best;
    },
    get initials() {
      return data.initials;
    },
    get scores() {
      return data.scores;
    },
    setSetting(key, value) {
      data.settings[key] = value;
      write();
    },
    setCheckpoint(cp) {
      data.checkpoint = validCheckpoint(cp);
      write();
    },
    // Returns true when this is a new best.
    setBest(score) {
      if (!(score > data.best)) return false;
      data.best = score;
      write();
      return true;
    },
    setInitials(name) {
      data.initials = String(name || '').slice(0, 12);
      write();
    },
    setScores(list) {
      data.scores = Array.isArray(list) ? list.slice(0, 10) : [];
      write();
    },
  };
}
