// Every number that sets how Dead End plays. Sector rows are indexed by zone (1-4),
// skill rows by skill (0-3). The sim multiplies a zone value by the skill factor.

export const DT = 1 / 60;

// foeSpeed, foeFire, foeCount, shadowTime, and shadowSpeed multiply the sector values.
// grace multiplies FOES.entryGrace: a Rookie gets a longer breath on every entry. armor
// multiplies FOES.armor.chance. heat is how much each shot heats the ION-SHIV (it
// overheats at 1). autoMap puts every room you walk into on the map; without it, only a
// console maps rooms (a section at a time). consolesBreak lets shots and barrel blasts
// wreck consoles. hidden skills stay out of the menus (old saves can still use them).
export const SKILLS = [
  { id: 0, name: 'Rookie', blurb: 'Slower robots, a patient Shadow, seven lives, and a map that draws itself', lives: 7, foeSpeed: 0.75, foeFire: 0.6, foeCount: 0.7, shadowTime: 1.5, shadowSpeed: 0.8, grace: 1.6, armor: 0.5, heat: 0.12, autoMap: true, consolesBreak: false },
  { id: 1, name: 'Gumshoe', blurb: 'The way Shamus played', lives: 5, foeSpeed: 1, foeFire: 1, foeCount: 1, shadowTime: 1, shadowSpeed: 1, grace: 1, armor: 1, heat: 0.15, autoMap: true, consolesBreak: false, hidden: true },
  { id: 2, name: 'Detective', blurb: 'Fast robots, a short fuse, and consoles to map the lair', lives: 5, foeSpeed: 1.15, foeFire: 1.25, foeCount: 1.2, shadowTime: 0.8, shadowSpeed: 1.1, grace: 0.9, armor: 1.25, heat: 0.2, autoMap: false, consolesBreak: false },
  { id: 3, name: 'Chief', blurb: 'Substantially harder, and stray fire wrecks consoles. Choose wisely', lives: 4, foeSpeed: 1.3, foeFire: 1.5, foeCount: 1.35, shadowTime: 0.65, shadowSpeed: 1.2, grace: 0.8, armor: 1.5, heat: 0.24, autoMap: false, consolesBreak: true },
];
// The skill a new case starts on, and the skills the menus offer.
export const DEFAULT_SKILL = 2;
export const SHOWN_SKILLS = SKILLS.filter((s) => !s.hidden).map((s) => s.id);

export const PLAYER = {
  radius: 0.3, // body size for robots, bolts, and pickups
  wallRadius: 0.22, // forgiving size against electric walls and pod gates
  speed: [0, 4.2, 4.4, 4.6, 4.8], // by zone: the lair speeds up as you go deeper
  clearBoost: 1.55, // speed multiplier once every robot in the room is down
  maxShots: 2, // the original's two ION-SHIVs on screen
  shotSpeed: 16,
  shotRadius: 0.06, // against walls, blocks, gates, and locks
  shotReach: 0.12, // added to a robot's or the Shadow's radius for a hit
  shotLife: 2.5, // seconds before a shot that hit nothing fizzles
  muzzle: 0.4, // a new shot starts this far ahead of Shamus
  fireCooldown: 0.16, // fire keys, gamepads, and touch, which plant his feet to shoot
  mouseCooldown: 0.3, // the mouse runs and guns, so it reloads slower
  clickBuffer: 0.35, // a mouse click waits this long for a free shot, so quick clicks count
  heatCool: 0.35, // the ION-SHIV sheds this much heat a second (SKILLS.heat adds it per shot)
  overheatTime: 1.6, // seconds it stays locked once it hits full heat
  respawnInvuln: 1.6,
  deathTime: 1.6,
  touchSlack: 0.08, // robots and the Shadow must overlap Shamus this much to kill him
  maxLives: 9,
};

export const SCORE = {
  key: 250,
  life: 100,
  extraLifeEvery: 10000,
  roomClear: 150, // times the zone
  shadowDefeat: 10000,
  mapSection: 100, // times the zone, for each section a console maps
  barrel: 25,
  foe: { droid: 50, drone: 75, jumper: 100, sniffer: 150, warden: 200 }, // times the zone
};

// The Shadow. speed is units per second by zone; while he chases, `accel` of that base
// speed is added every second (so after 10 s he moves 1.8 times as fast), up to
// `maxSpeed` times Shamus's own unboosted speed. He always catches a player who dawdles.
export const SHADOW = {
  time: [0, 24, 19, 15, 12], // seconds in a room before the Shadow comes, by zone
  warn: 4, // the low pulsing starts this long before
  speed: [0, 2.2, 2.6, 3.0, 3.4], // starts here and creeps up while he chases
  accel: 0.08, // fraction of the base speed added per second of chase
  maxSpeed: 1.2, // times Shamus's speed in the sector
  radius: 0.45,
  enterTime: 0.9, // he fades in where he enters: harmless, immune, and still
  minEnterDist: 5, // never closer than this to Shamus when he appears
  nearestChance: 0.7, // otherwise he comes through a random stretch of wall
  stun: 2.2, // seconds a hit freezes him
  stunImmune: 1.0, // after a stun he shrugs off shots this long, so he always gains ground
  lairHits: 6, // hits that finish him in room 127 (a short finale; damage carries over deaths)
  lair: {
    delay: 1.5, // he arrives this soon after you walk in
    speed: 3.0, // times the skill's shadowSpeed
    enterTime: 0.6,
    minDist: 7, // where he enters and where he blinks to, from Shamus
    stun: 0.55, // each hit stuns him this long, then he blinks away or charges
    chargeChance: 0.45,
    windup: 0.55, // he rears back before a charge (vulnerable)
    chargeSpeed: 2.5, // times his chase speed
    chargeTime: 0.9,
    dieTime: 2.4, // the defeat plays this long before the game is won
  },
};

// Robots. Sector rows multiply each type's own numbers in FOE.
export const FOES = {
  // Robot types that may appear in each zone.
  types: [null, ['droid', 'drone', 'jumper'], ['droid', 'drone', 'jumper', 'sniffer'], ['droid', 'drone', 'jumper', 'sniffer', 'warden'], ['droid', 'drone', 'jumper', 'sniffer', 'warden']],
  // How often each type is picked, by zone (types outside FOES.types are never picked).
  mix: [null,
    { droid: 5, drone: 3, jumper: 2 },
    { droid: 4, drone: 3, jumper: 3, sniffer: 2 },
    { droid: 4, drone: 3, jumper: 3, sniffer: 2, warden: 2 },
    { droid: 4, drone: 3, jumper: 3, sniffer: 3, warden: 2 }],
  maxWardens: 2, // turrets pin you down; more than two in a room is no fun
  // Brass-plated droids and jumpers: the plating takes one extra hit, and they score
  // double. chance is by zone, times the skill's armor.
  armor: { types: ['droid', 'jumper'], chance: [0, 0.12, 0.25, 0.4, 0.55], extraHp: 1, points: 2 },
  speed: [0, 1, 1.15, 1.3, 1.5], // zone multiplier on each type's base speed
  fire: [0, 1, 1.2, 1.45, 1.75], // zone multiplier on fire rate
  maxBolts: [0, 3, 4, 5, 7],
  boltSpeed: [0, 6, 7, 8, 9.5],
  boltRadius: 0.08, // against walls, blocks, gates, and locks
  boltReach: 0.0, // added to Shamus's radius for a hit (his body is already generous)
  boltLife: 4,
  clash: 0.32, // a shot and a bolt closer than this destroy each other
  entryGrace: 1.0, // seconds after you enter before anything fires
  minSpawnDist: 6, // robots never appear closer than this to the door you came in by
  blast: 1.25, // a robot exploding hits every robot within this radius once (plain ones go too)
  stuck: 1.2, // seconds a robot waits on another before it turns back
};

// Each robot type. Speeds are units per second, times are seconds, at sector 1 on
// Gumshoe; FOES.speed, FOES.fire, and the skill scale them. Firing robots always
// telegraph: a droid stops and aims, a jumper crouches facing its hop, a warden turns
// and aims before a burst.
export const FOE = {
  // Walks the grid a few cells at a time, pauses, and fires along one of the 8
  // directions when Shamus is lined up with it (within `align` of the line).
  droid: { r: 0.36, hp: 1, speed: 1.6, steps: [2, 5], pause: [0.4, 1.1], chase: 0.55, reload: 2.6, aim: 0.5, range: 13, align: 0.45 },
  // Whirls around a center that drifts toward Shamus, the circle tightening from rMax
  // to rMin every `tighten` seconds. `spin` is its speed around the circle.
  drone: { r: 0.34, hp: 1, drift: 1.0, chase: 0.85, spin: 2.6, rMax: 1.7, rMin: 0.35, tighten: 2.8 },
  // Crouches (facing where it will go), then hops 2-3 cells in `hop` seconds. From
  // sector `zapFrom` it zaps a short bolt after landing when Shamus is close.
  jumper: { r: 0.36, hp: 1, crouch: 1.1, hop: 0.32, land: 0.45, zapFrom: 2, zapRange: 4.5, zapAlign: 0.8 },
  // Follows Shamus's trail cell by cell at a steady pace. Its armored front takes two
  // hits; a shot from behind or the side wrecks it at once.
  sniffer: { r: 0.38, hp: 2, speed: 1.9 },
  // Stays put, turns one direction at a time toward Shamus, and fires a burst down a
  // line when he is on it. Two brass plates make it take three hits.
  warden: { r: 0.42, hp: 3, turn: 0.5, aim: 0.55, burst: 3, gap: 0.16, rest: 2.4, range: 16, align: 0.5 },
};

// Red barrels explode when a shot or a robot's bolt hits them. The blast kills Shamus
// within `radius` (unless the respawn grace, the shield, or a cheat protects him), deals
// `damage` hits to every robot it reaches, stuns the Shadow, and lights the fuse of every
// barrel within `chain`, which blows `fuse` seconds later. The fuse keeps chains to at
// most three booms a second.
export const BARREL = { radius: 1.7, damage: 2, chain: 2.3, fuse: 0.34 };

// Consoles (terminals): Shamus uses one by walking up to it, until the gap between his
// body and the console's box is at most `reach`.
export const CONSOLE = { reach: 0.15 };

// Mystery `?`: bonus or disaster. Weights are relative; the Shadow is the disaster.
export const MYSTERY = {
  weights: [['points', 56], ['life', 12], ['shield', 13], ['freeze', 11], ['shadow', 8]],
  shield: 6, // seconds robots and bolts can't hurt you
  freeze: 5, // seconds robots stand frozen (and harmless)
  shadowDelay: 1.2, // the warning sounds, then he comes this much later
};
