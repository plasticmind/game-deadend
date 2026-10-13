# Room layouts

Each room is drawn by hand as 13 strings of 21 characters in `src/rooms/sector<N>.js`.
`src/map.js` decides which doors a room has, where they lead, and what item it holds;
the layout decides what the room looks like inside. Run the checker after every change:

```bash
node tools/check-rooms.mjs            # every room, plus the whole-lair key check
node tools/check-rooms.mjs 12 13      # just these rooms
node tools/check-rooms.mjs --show 12  # print room 12 with reachable floor marked ':'
node tools/room-brief.mjs 2           # what every sector 2 room needs
```

## Format

```js
{
  id: 12,
  n: 3,               // robots per visit (sector 1: 2-4, 2: 3-6, 3: 4-7, 4: 5-9)
  foes: ['droid'],    // optional: limit robot types for a themed room
  pod: { period: 4, open: 1.6 }, // optional, pod rooms only: gate cycle in seconds
  layout: [ ...13 strings of 21 characters... ],
}
```

| Char | Meaning |
|---|---|
| `#` | Electric wall. Thin: a post at the cell center, beamed to every `#` beside it |
| `.` | Floor |
| `B` | Crate: solid, harmless, stops shots |
| `O` | Barrel: same as a crate, round |
| `T` | Terminal (a console with a green screen): same as a crate |
| `v` | Floor vent (walkable decoration) |
| `=` | Floor grate (walkable decoration) |
| `P` | Pod gate: an electric beam that switches on and off (pod rooms only) |
| `e` | Robot spawn point (floor). Give `n + 2` or more, spread around the room |
| `*` | The room's item (key, mystery, or life; `map.js` says which) |
| `H` | The keyhole (keyhole rooms only) |
| `S` | Where the game starts (room 0 only) |

## Rules the checker enforces

- Row 0, row 12, column 0, and column 20 are `#`, except the three cells of each door:
  north and south doors are columns 9-11 of the top or bottom row; west and east doors
  are rows 5-7 of the left or right column. Those three cells are `.` (or `P` in a pod
  room). A side with no door is solid `#`.
- Exactly the markers the map asks for: one `*` if the room has a key, mystery, or life;
  one `H` in a keyhole room; `S` only in room 0; `P` only in pod rooms.
- The player's body fits everywhere it must go: from every door it can reach every other
  door, the item, the keyhole, and every spawn point. Walls are thin, so a one-cell gap
  between two walls (`#.#`) is a fine corridor (about 1.6 units wide).
- Every door has a safe landing: no wall within about 1.6 cells inward of the door, and
  no crate in it.
- At least three spawn points (or `n`, if smaller) sit 6 or more units from each door.

## Designing a good room

Shamus rooms are mazes of thin electric walls: corridors, T-junctions, chambers, pillars,
and alcoves, drawn with straight orthogonal lines. A few habits make them play well:

- Give every room one idea: a long corridor with side pockets, a ring around a central
  pillar, a zigzag, a split room with two routes, a big hall with crates for cover. Vary
  it room to room; no two rooms in a row should feel the same.
- Make the route between doors interesting but fair. Corridors of one cell are tense;
  open halls give robots room to swarm. Mix them.
- Put the item somewhere that takes a little nerve: an alcove, the end of a corridor, the
  middle of a ring. Keys deserve the best spots.
- In a keyhole room, put `H` within about four cells of the locked door, in plain view,
  so players connect the keyhole with the barrier.
- Pod rooms ("they exist in another dimension, with only a small time window to get in"):
  put `P` cells across the doorway or around the alcove that holds the item, so the
  player waits for the gate to drop and dashes through. Never put a gate where a player
  must stand still to survive.
- Crates and barrels are cover. Use them in about half the rooms, a few at a time.
  Terminals suit offices and labs. Vents and grates are pure decoration.
- Deeper sectors get denser: sector 1 is open and forgiving, sector 4 is tight and
  crowded. The lair (room 127) is the Shadow's arena: open, with a few pillars and crates
  to dodge around, and `n` of 0 to 4.
- Room 0 is the start. It should be calm and readable.
