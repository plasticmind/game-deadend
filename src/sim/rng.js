// Seeded random numbers (mulberry32). The state lives in game.rngState so a game can
// be replayed exactly from its seed and inputs.

export function rand(game) {
  let t = (game.rngState = (game.rngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randInt = (game, n) => Math.floor(rand(game) * n);
export const pick = (game, list) => list[randInt(game, list.length)];
