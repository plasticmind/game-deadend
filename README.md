# Dead End

A spiritual successor to Shamus by Cathryn Mataga, Synapse Software, 1982.

Dead End rebuilds Shamus as a 3D diorama that runs in your browser. You're a
trench-coated robot detective working through the Shadow's lair: 128 hand-mapped rooms
in four sectors, electrified walls that kill on touch, colored keys and keyholes,
robots that come back every time you walk into a room, and the Shadow himself, who
comes for you if you stay in one place too long.

It's a plain static web game: HTML, CSS, and JavaScript modules with no build step.
Three.js loads from a pinned CDN URL.

## How to play

Find your way to the Shadow's lair in room 127 and beat him there. It's the only place he
can be beaten. Every hit there counts, even across lives, and a bar at the top of the
screen shows how many hits he has left.

- **Electric walls kill on touch.** So do the yellow pod gates while they're lit. Wait
  for a gate to drop, then go.
- **Keys open the way.** Pick up a colored key, carry it to the keyhole of the same color,
  and touch the keyhole. Its locked door opens for good. Keys and keyholes are spread
  across the lair, so expect to backtrack.
- **Robots respawn.** Every time you enter a room, a fresh set of robots appears. Clear
  them all and Shamus runs faster in that room.
- **Don't linger.** Each room starts a clock. When you hear a low pulsing, the Shadow is
  about to come through the walls. You can't kill him; a shot only stuns him for a
  moment. Leave the room and the chase ends.
- **Mysteries are a gamble.** A glowing question mark gives you points, a life, a shield,
  frozen robots, or the Shadow, right now.
- **Bottles are extra lives.** You also earn a life every 10,000 points.
- **Sectors save your place.** The lair has four sectors (Black, Blue, Green, and Red),
  each faster than the last. Reaching a new sector saves a checkpoint, and after a game
  over you can continue from it with a full set of lives.

With fire keys, a gamepad, or touch, Shamus shoots the way he did in 1982. He can't
walk and shoot at the same time: hold fire and he plants his feet, then push a direction
to shoot that way, in any of eight directions. Let go of fire to walk again. With the
mouse, click where you want to shoot: he fires toward the cursor at any angle and keeps
walking. However you shoot, only two ION-SHIVs fly at once.

### Things you meet

| Thing | What it does |
|---|---|
| Keyhole | Touch it while you carry a key of its color to open its locked door. |
| Key | Stays in your pocket until you use it on a keyhole of the same color. |
| Mystery | Bonus or disaster. |
| Extra life | A bubbling bottle: one more life. |
| Robo-Droid | Walks the grid and fires along the eight directions when you line up with it. |
| Whirling Drone | Spirals in on you. It never fires, but touching it is fatal. |
| Snap-Jumper | Crouches, then hops at you. From Blue Sector on, it zaps after it lands. |
| Sniffer | Follows your trail. Its armored front takes two hits. Blue Sector and deeper. |
| Warden | A turret that stays put and fires bursts down eight lines. Green Sector and deeper. |
| The Shadow | Comes through the walls if you linger. Stun him with a shot, then leave. |

### Skill levels

| Skill | Lives | What changes |
|---|---|---|
| Rookie | 7 | Slower robots and a patient Shadow |
| Gumshoe | 5 | The way Shamus played |
| Detective | 5 | Faster robots and a shorter fuse |
| Chief | 4 | Substantially harder |

After you win, **Play again, harder** starts a new case one skill level up and keeps your
score.

## Controls

| Action | Keyboard and mouse | Gamepad | Touch |
|---|---|---|---|
| Move | Arrow keys or WASD | Left stick or d-pad (eight directions) | Virtual stick on the left half |
| Fire | Click, or Space, J, Z, or Enter | A or X | FIRE button |
| Aim and shoot | Click where you want to shoot, or hold fire and press a direction | Hold A, push the stick | Hold FIRE, move the stick |
| Pause | Esc or P | Start | Pause button |
| Map | M or Tab | Back or Select | Map button |

The mouse aims at any angle: click in the room and Shamus fires toward the cursor, and
holding the button keeps firing. He keeps walking while you shoot with the mouse. Fire
keys, the gamepad, and touch aim the original way instead: holding fire plants his feet,
and he shoots in one of eight directions.

Menus work with every input. Use the arrow keys, stick, or d-pad to move between items,
Enter, Space, or A to choose, and Esc or B to go back. Touch screens show the virtual
stick and FIRE button automatically.

The map shows every room you've found, the doors between them, locked doors in their
key's color (dashed until opened), items you left behind, and the keys you carry.

## Settings and accessibility

- **Sound effects** and **music** turn on and off separately. Every sound and the music
  are synthesized in the browser; there are no audio files.
- **Graphics** is Auto, High, Medium, or Low. Lower it if the game stutters.
- **Reduced motion** follows your system setting, and you can force it on. It removes
  camera moves, room slides, and pulsing effects.
- Nothing flashes more than three times a second, and on-screen text keeps a contrast
  ratio of at least 4.5:1.

Settings, your latest checkpoint, and your best score are saved in the browser's local
storage under `game-deadend.v1`.

## Run it locally

Serve the folder with any static web server and open it in a browser. For example, with
Python:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Opening `index.html` straight from disk doesn't
work, because browsers don't load JavaScript modules from `file://` pages.

The 3D renderer needs WebGL 2 and a network connection to load Three.js from jsDelivr.
If either is missing, the game falls back to a flat 2D view of the same rooms.

### URL options

| Option | What it does |
|---|---|
| `?view=2d` | Use the 2D view instead of the 3D renderer. |
| `?debug` | Expose `window.deadEnd` in the browser console: the game state, cheats (`cheat('invuln')`), and room jumps (`room(40)`). |
| `?debug&play=1&skill=2&room=40` | Start a game right away, at a skill level, in a room. |

### High scores

In the Gardner family arcade, finished games post to the arcade's shared players
service on port 4703 of the same host. Anywhere else, the post fails quietly and scores
stay on your device. The game never waits on the network.

## Tools

The tools run the game's simulation in Node.js 20 or later, with no browser and no
dependencies.

```bash
node tools/check-rooms.mjs          # check every room layout and that the lair is winnable
node tools/check-rooms.mjs --show 12   # print room 12 with its reachable floor marked
node tools/sim-test.mjs             # headless simulation tests
node tools/sim-test.mjs shadow      # only the tests whose names contain "shadow"
node tools/tour.mjs                 # an autopilot plays the winning route from room 0 to the lair
node tools/tour.mjs --all           # the autopilot visits all 128 rooms, then wins
node tools/room-brief.mjs 2         # list each Blue Sector room's doors, item, and lock
```

`tools/backup.sh` publishes this folder from the family arcade's repository to this
GitHub repository.

## Files

| Path | What it is |
|---|---|
| `index.html`, `style.css` | The page, the import map that pins Three.js, and the look of the HUD and menus |
| `game.json` | The arcade's listing for the game |
| `docs/DESIGN.md` | The design and the contract between the modules |
| `docs/ROOMS.md` | The room layout format |
| `docs/gameplay-mechanics.md` | Notes on why the original works |
| `src/map.js` | The 128-room graph: doors, sectors, items, locks, and map positions |
| `src/room.js` | The room format parser and wall geometry |
| `src/rooms/` | The hand-drawn room layouts, one file per sector |
| `src/sim/` | The deterministic simulation: game state, robots, shots, the Shadow, and tuning |
| `src/render/` | The Three.js renderer |
| `src/main.js` | Boot and the fixed-step game loop |
| `src/input.js` | Keyboard, gamepad, and touch input |
| `src/hud.js` | The score, lives, keys, room, and messages during play |
| `src/ui.js` | The title, menus, pause, map, and end screens |
| `src/automap.js` | Draws the map screen |
| `src/audio.js` | Synthesized sound effects and music |
| `src/save.js` | Settings, checkpoint, and best score in local storage |
| `src/scores.js` | The shared high score table |
| `src/debug2d.js` | The 2D fallback view |
| `src/icons.js` | Small SVG icons for the HUD and menus |
| `tools/` | Room checks, simulation tests, and the autopilot |
