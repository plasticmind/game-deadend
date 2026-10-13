// Every number that sets how Dead End plays. Sector rows are indexed by zone (1-4),
// skill rows by skill (0-3). The sim multiplies a zone value by the skill factor.

export const DT = 1 / 60;

export const SKILLS = [
  { id: 0, name: 'Rookie', blurb: 'Slower robots, a patient Shadow, seven lives', lives: 7, foeSpeed: 0.75, foeFire: 0.6, foeCount: 0.7, shadowTime: 1.5, shadowSpeed: 0.8 },
  { id: 1, name: 'Gumshoe', blurb: 'The way Shamus played', lives: 5, foeSpeed: 1, foeFire: 1, foeCount: 1, shadowTime: 1, shadowSpeed: 1 },
  { id: 2, name: 'Detective', blurb: 'Faster robots and a shorter fuse', lives: 5, foeSpeed: 1.15, foeFire: 1.25, foeCount: 1.2, shadowTime: 0.8, shadowSpeed: 1.1 },
  { id: 3, name: 'Chief', blurb: 'Substantially harder. Choose wisely', lives: 4, foeSpeed: 1.3, foeFire: 1.5, foeCount: 1.35, shadowTime: 0.65, shadowSpeed: 1.2 },
];

export const PLAYER = {
  radius: 0.3, // body size for robots, bolts, and pickups
  wallRadius: 0.22, // forgiving size against electric walls and pod gates
  speed: [0, 4.2, 4.4, 4.6, 4.8], // by zone: the lair speeds up as you go deeper
  clearBoost: 1.55, // speed multiplier once every robot in the room is down
  maxShots: 2, // the original's two ION-SHIVs on screen
  shotSpeed: 16,
  fireCooldown: 0.16,
  respawnInvuln: 1.6,
  deathTime: 1.6,
};

export const SCORE = {
  key: 250,
  life: 100,
  extraLifeEvery: 10000,
  roomClear: 150, // times the zone
  shadowDefeat: 10000,
  foe: { droid: 50, drone: 75, jumper: 100, sniffer: 150, warden: 200 }, // times the zone
};

export const SHADOW = {
  time: [0, 24, 19, 15, 12], // seconds in a room before the Shadow comes, by zone
  warn: 4, // the low pulsing starts this long before
  speed: [0, 2.2, 2.6, 3.0, 3.4], // starts here and creeps up while he chases
  accel: 0.08, // per second
  stun: 2.2, // seconds a hit freezes him
  lairHits: 12, // hits that finish him in room 127
};

export const FOES = {
  // Robot types that may appear in each zone.
  types: [null, ['droid', 'drone', 'jumper'], ['droid', 'drone', 'jumper', 'sniffer'], ['droid', 'drone', 'jumper', 'sniffer', 'warden'], ['droid', 'drone', 'jumper', 'sniffer', 'warden']],
  speed: [0, 1, 1.15, 1.3, 1.5], // zone multiplier on each type's base speed
  fire: [0, 1, 1.2, 1.45, 1.75], // zone multiplier on fire rate
  maxBolts: [0, 3, 4, 5, 7],
  boltSpeed: [0, 6, 7, 8, 9.5],
  entryGrace: 1.0, // seconds after you enter before anything fires
  minSpawnDist: 6, // robots never appear closer than this to the door you came in by
  blast: 1.25, // a robot exploding takes others within this radius with it
};
