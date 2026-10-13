# Dead End: design and module contract

Dead End is a spiritual successor to Shamus (Synapse, 1982), rebuilt as a 3D top-down
diorama for the family arcade. You are a trench-coated robot detective working through
the Shadow's lair: 128 hand-mapped rooms in four sectors, electrified walls, colored keys
and keyholes, respawning robots, and the Shadow, who comes for you if you linger.

Read `docs/gameplay-mechanics.md` for why the original works. The five things that must
survive: room-by-room screens, eight-direction shooting tied to the stick, walls that
kill on touch, a key-and-lock maze with backtracking, and the unstoppable Shadow that
punishes hesitation. Exploration says slow down; the Shadow says move. Everything is
built around that tension. It is not a twin-stick roguelike: no free aim, no procedural
maze, no permanently cleared rooms, no upgrade tree.

## Ground rules

- Static arcade game: plain ES modules, no build, no npm. Three.js 0.170.0 from the pinned
  jsDelivr import map in `index.html`. Every asset path is relative.
- The sim (`src/sim/`, `src/map.js`, `src/room.js`, `src/rooms/`) has no DOM, no Three.js,
  no `Date`/`performance`, and no `Math.random`. It runs in Node for tests.
- The renderer and the shell only read sim state. They never write to it, except the
  shell, which calls `createGame` and `stepGame`.
- Accessibility (kids play this): keyboard, gamepad, and touch controls; honor
  `prefers-reduced-motion` (no camera shake, no slides, no bobbing camera); text at 4.5:1
  contrast or better; nothing flashes more than three times a second, including electric
  crackle, the Shadow warning, and explosions.

## Files and owners

| Path | What it is |
|---|---|
| `src/map.js` | The 128-room graph: doors, zones, items, locks, pod rooms, map positions |
| `src/room.js` | Room format parser and geometry (walls, blocks, doors, collision queries) |
| `src/rooms/sector1-4.js`, `index.js` | Hand-drawn room layouts (`docs/ROOMS.md`), `getRoom(id)` |
| `src/sim/game.js` | State, `createGame`, `stepGame`, rooms, doors, items, death, snapshot |
| `src/sim/tuning.js` | Every gameplay number |
| `src/sim/foes.js`, `shots.js`, `shadow.js`, `rng.js` | Robots, ION-SHIVs and bolts, the Shadow, seeded random |
| `src/render/*.js` | Three.js renderer (`Renderer` class) |
| `src/main.js` | Boot, fixed-step loop, wiring |
| `src/input.js`, `hud.js`, `ui.js`, `audio.js`, `save.js`, `scores.js`, `automap.js` | Shell |
| `tools/check-rooms.mjs` | Validates every room and that the lair is winnable |
| `tools/sim-test.mjs` | Headless sim tests |

## Coordinates

Room units. A room is 21 by 13 cells; `x` runs right 0..21, `y` runs down 0..13, cell
`(c, r)` covers `[c, c+1) x [r, r+1)`. The renderer maps sim `x` to world `X` and sim `y`
to world `Z` (world `Y` is up), with the room centered on the origin:
`X = x - 10.5`, `Z = y - 6.5`. One room unit is one world unit.

Facing `face` is 0..7 clockwise from east with `y` down: 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW,
6 N, 7 NE. `dirOf(face)` gives `[dx, dy]`; `faceOf(dx, dy)` the reverse.

Electric walls are thin. Every `#` cell is a post at its center, joined by a beam to each
`#` neighbor (north, east, south, west; never diagonal). The lethal shape is that lattice
thickened by `WALL_HALF` (0.18). The player dies when their center comes within
`WALL_HALF + PLAYER.wallRadius` (0.18 + 0.22) of it; their drawn body is a little wider
than that on purpose, so a graze looks close but survives. Pod gates (`P`) are the same
shape and are lethal only while on. Blocks (`B` crate, `O` barrel, `T` terminal) are
boxes of half-size `BLOCK_HALF` (0.42) at their cell center: solid, harmless, and they
stop shots. Locked doors are a colored barrier across the opening whose room-side face is
`LOCK_FACE` (0.6) inside the door line: solid, harmless.

Doors open through the middle three border cells of a side: north and south through
columns 9-11 (x 9..12), west and east through rows 5-7 (y 5..8). The door line is the
border's post line (x = 0.5 or 20.5, y = 0.5 or 12.5). Crossing it moves you to the
neighbor, arriving through the opposite door with your offset along the door kept.

## The loop

`src/main.js` runs the sim at a fixed 60 steps per second (`DT`), at most 5 steps per
animation frame, and renders once per frame:

```js
import { createGame, stepGame, DT } from './sim/game.js';
const frameEvents = [];
while (acc >= DT) { stepGame(game, input.read()); frameEvents.push(...game.events); acc -= DT; }
renderer.render(game, frameEvents, dtReal);
audio.handle(frameEvents, game);
hud.update(game, frameEvents);
frameEvents.length = 0;
```

`game.events` holds only the last step's events, so the loop must collect them each
step. Events from `createGame` sit in `game.events` until the first step.

## Sim API

```js
createGame({ skill = 1, seed = 1, from = null }) -> game   // from: a snapshot to resume
stepGame(game, input)                                       // input: { x, y, fire }
makeSnapshot(game) -> plain JSON object
DT, faceOf(dx, dy), dirOf(face)
```

`input.x` and `input.y` are -1, 0, or 1 (`y` = 1 is down/south). `input.fire` is true
while the fire button is held. Debug hooks for tests and the dev console:
`game.cheats = { invuln, noShadow, noFoes }`, all off by default.

## State (read-only outside the sim)

```js
game = {
  t, step, skill, loop,                 // loop: times the Shadow was beaten this run
  mode,                                 // 'play' | 'dying' | 'gameover' | 'won'
  score, lives, nextLifeAt,
  keys: { blue, green, brown, purple, cyan },   // counts held
  taken: { [roomId]: true },            // items collected (keys, lives, mysteries)
  opened: { [lockId]: true },           // lockId is the keyhole room's id
  visited: { [roomId]: true },
  zoneReached,                          // 1-4
  checkpoint,                           // snapshot from the first entry to the deepest sector
  room: {
    id, zone, serial,                   // serial changes on every entry (and respawn)
    geo,                                // parsed room from getRoom(id): see src/room.js
    from,                               // side we came in by, or null
    entry: { x, y },
    t,                                  // seconds since entry
    shadowAt, warnAt, warned,           // the Shadow's clock
    cleared,                            // every robot down: the boost is on
    itemsHidden,                        // the Shadow came: items vanish until you re-enter
    podOn,                              // pod gates live right now
    locks: { [side]: { color, lockId, open } },
  },
  player: { x, y, r, face, moving, aiming, alive, deadT, invulnT, shieldT, boost, walk },
  shots: [{ id, x, y, dx, dy, t }],                     // the player's ION-SHIVs (max 2)
  bolts: [{ id, x, y, vx, vy, t, from }],               // robot fire; `from` is a foe type
  foes: [{ id, type, x, y, face, state, t, hp, ... }],  // type below; state is per type
  shadow: null | { x, y, state, t, stunT, hp },         // state: 'enter' | 'chase' | 'stunned' | 'dying'
  item: null | { kind, color, x, y, hidden, used },     // kind: 'key' | 'keyhole' | 'mystery' | 'life'
  banner: null | { text, color, t, dur },              // a short message for the HUD
  freezeT,                                             // robots frozen (a mystery outcome)
  stats: { kills, deaths, cleared, time },
}
```

`player.walk` is distance walked (drive the walk cycle from it). `player.aiming` is true
while fire is held: Shamus plants his feet and points the shiv along `face`.

### Robots (`foe.type`)

| Type | Look | Behavior | Sectors |
|---|---|---|---|
| `droid` | Robo-Droid: white dome on four short legs, one red eye | Walks the cell grid, pauses, fires a bolt along one of the 8 directions when roughly lined up with you | all |
| `drone` | Whirling Drone: spinning disc-top with blades, cyan glow | Whirls in tightening spirals around a drifting center that wanders toward you; deadly to touch; never fires | all |
| `jumper` | Snap-Jumper: squat spring-legged frog bot, green | Crouches, then snaps 2-3 cells toward you in a quick hop; zaps a short-range bolt after landing from sector 2 | all |
| `sniffer` | Sniffer: low hound bot with a long sensor snout, violet | Follows your scent trail at a steady pace; armored front, takes 2 hits | 2+ |
| `warden` | Warden: turret on a pedestal, orange | Stationary, rotates, fires bursts down the 8 directions | 3+ |

Robots never walk into walls on purpose, avoid each other, and respawn every time you
enter a room: a fresh random pick of the room's `n` robots from its spawn points, never
within `FOES.minSpawnDist` of your door. Nothing fires for `FOES.entryGrace` seconds
after you arrive. A robot exploding takes others within `FOES.blast` with it. Your shot
and a bolt that meet both vanish.

### The Shadow

Each room starts a clock (`SHADOW.time` by sector, scaled by skill). At `warnAt` the
low pulsing starts (`shadowWarn` event). At `shadowAt` he enters through the nearest
wall (`shadowEnter`), the room's items vanish (`itemsHidden`), and he drifts straight
for you through walls, speeding up. Touch him and you die. A shot stuns him for
`SHADOW.stun` seconds (`shadowStun`). He cannot be killed, except in room 127, his lair,
where he arrives at once and falls after `SHADOW.lairHits` hits (`shadowHurt`,
`shadowDefeat`), and then the game is won (`mode = 'won'`, `win` event). Leaving the room
ends the chase. Keyholes stay put when he comes; keys, lives, and mysteries hide.

### Items

Keys go in your pocket and are spent on a keyhole of their color; the door it guards
opens for good. Bottles (life) add a life. Mysteries are bonus or disaster: points (most
often), a life, a shield (`player.shieldT`, robots and bolts can't hurt you), frozen
robots (`freezeT`), or the Shadow, right now. Clearing a room of robots scores
`SCORE.roomClear` times the sector and turns on Shamus's speed boost for that room.
Every `SCORE.extraLifeEvery` points earns a life.

## Events

Each is `{ type, ...fields }`. The renderer, audio, and HUD react to them.

| type | fields |
|---|---|
| `roomEnter` | `id, from, zone, firstVisit` |
| `roomExit` | `side, to` |
| `zoneEnter` | `zone` (first time only) |
| `fire` | `x, y, face` (the player fired) |
| `boltFire` | `x, y, type` (a robot fired) |
| `shotHit` | `x, y, what` ('wall', 'block', 'bolt', 'lock', 'pod') |
| `foeHit` | `x, y, type, hp` (armor absorbed it) |
| `foeDie` | `x, y, type, points, chain` (chain: killed by another's blast) |
| `roomClear` | `points` |
| `playerDie` | `x, y, cause` ('wall', 'pod', 'bolt', 'foe', 'shadow') |
| `respawn` | |
| `gameOver` | `score` |
| `pickup` | `kind, color, x, y` |
| `mystery` | `outcome, points, x, y` (outcome: 'points', 'life', 'shield', 'freeze', 'shadow') |
| `extraLife` | `reason` ('bottle', 'score', 'mystery') |
| `keyUse` | `color, x, y` |
| `doorOpen` | `side, color` |
| `doorLocked` | `color` (touched a keyhole without the key) |
| `podOn`, `podOff` | |
| `shadowWarn` | |
| `shadowEnter` | `x, y` |
| `shadowStun` | `x, y` |
| `shadowHurt` | `x, y, hp` (lair only) |
| `shadowDefeat` | `x, y` |
| `itemsVanish` | |
| `win` | `score` |

## Renderer API

```js
import { Renderer } from './render/renderer.js';
const r = new Renderer(canvas, { quality: 'auto', reducedMotion });
r.render(game, events, dtReal);   // every animation frame
r.resize();                       // on window resize (it reads the canvas's client size)
r.setQuality('auto' | 'high' | 'medium' | 'low');
r.setReducedMotion(bool);
r.dispose();
```

The renderer rebuilds the room scene when `game.room.id` or `game.room.serial` changes,
caches geometry and materials across rooms, and never allocates per frame in the hot
path. On `roomExit` it slides the old room out and the new one in (about 0.3 seconds,
along the exit direction); with reduced motion it cuts.

## Look

Reference: `reference/Electric Maze Showdown.png`, brighter. A miniature sci-fi detective
diorama seen from above at a steep tilt (about 55-60 degrees), the whole room filling the
screen with a margin of dark machinery around it. Not as dark as the reference: the floor
reads clearly, the light is warm, and the electric color does the drama.

- Floor: brushed metal plates on the cell grid with seams, rivets, a few vents and
  grates; slightly glossy so neon reflects.
- Border: chunky raised bulkhead walls around the room with amber light strips and
  rivets; the electric border beam runs along their inner top edge. Doors are gaps with
  red-lit grated door frames; a locked door fills with a colored force field and a lock
  icon of its color.
- Electric walls: short metal emitter posts with glowing caps, joined by bright
  crackling beams (animated noise, additive) in the sector color: Black sector violet
  `#8f7bff`, Blue `#3fa9ff`, Green `#3ee07a`, Red `#ff4d3d`. Bloom where quality allows.
  Crackle shimmers; it never strobes.
- Blocks: steel crates with amber light strips, red barrels, consoles with green screens.
- Items float and turn: keys are chunky glowing keys in their color; the keyhole is a
  pedestal with a lock plate of its color (dim and open once used); mysteries are a
  pulsing glowing `?`; lives are a green bubbling canister. Pod gates are yellow and black
  striped force bars.
- Shamus: tiny robot detective in a tan-orange trench coat and fedora, pistol-like
  ION-SHIV. Walk cycle from `player.walk`; plants and points when aiming.
- The Shadow: a tall, translucent dark-violet figure in a wide hat and cape with glowing
  yellow eyes, ignoring walls, flickering at its edges.
- Shots: the player's ION-SHIV is an electric blue streak; robot bolts are red-orange.
- Explosions: a bright burst, sparks, a puff of smoke, a scorch mark that fades.

Sector colors also tint the lighting. The Shadow warning slowly pulses the room toward
violet (at most 1.5 pulses a second) with a vignette.
