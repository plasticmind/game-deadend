# Audio credits

Every recorded sound and music track in Dead End is dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). You don't need to credit
anyone to reuse them, but the people who made them deserve it, so here they are.

The game synthesizes everything else in the browser: the Shadow's warning pulse and drone,
the pod gate hum, room-clear chimes, and a fallback for any file that fails to load.

To hear every file, serve the game folder and open `dev/sounds.html`.

## Music

All tracks come from [OpenGameArt.org](https://opengameart.org/). Each file is normalized
to -18 LUFS and encoded as 128 kbps stereo MP3.

| File | Title | Artist | Plays | Length | Source | License |
|---|---|---|---|---|---|---|
| `music/title.mp3` | Moil | Ruskerdax | Title screen, menus, and end screens | 3:03 | [opengameart.org/content/moil](https://opengameart.org/content/moil) | CC0 1.0 |
| `music/sector-1.mp3` | Investigation | Umplix | Black Sector | 0:56 | [opengameart.org/content/investigation-0](https://opengameart.org/content/investigation-0) | CC0 1.0 |
| `music/sector-2.mp3` | jazz (saxaphone) | Alex McCulloch (Pro Sensory) | Blue Sector | 2:09 | [opengameart.org/content/jazz-saxaphone](https://opengameart.org/content/jazz-saxaphone) | CC0 1.0 |
| `music/sector-3.mp3` | Jazz | Umplix | Green Sector | 2:05 | [opengameart.org/content/jazz-2](https://opengameart.org/content/jazz-2) | CC0 1.0 |
| `music/sector-4.mp3` | Sneaking into the Robot Factory (from Sneaky Music Pack) | Umplix | Red Sector | 1:01 | [opengameart.org/content/sneaky-music-pack](https://opengameart.org/content/sneaky-music-pack) | CC0 1.0 |
| `music/lair.mp3` | Spy Loop | wipics | The Shadow's lair, room 127 | 0:25 | [opengameart.org/content/spy-loop](https://opengameart.org/content/spy-loop) | CC0 1.0 |

Changes from the originals:

- `title.mp3` starts at the first note (1.6 seconds of leading silence removed).
- `sector-2.mp3` and `sector-3.mp3` have their leading silence removed.
- `sector-4.mp3` passes through a peak limiter before normalizing, so it reaches the
  target loudness without clipping.
- `lair.mp3` is cut to exactly 16 bars at 152 bpm (25.263 seconds), with the release of
  the last note laid over the start, so it repeats without a gap.

Each sector track plays in turn: entering a sector starts its track, and after a track
plays through (twice for the two short ones), the next sector's track takes over.

## Sound effects

All sound effects come from [Kenney](https://kenney.nl/) asset packs, CC0 1.0. Each file
is the original converted to mono, with leading and trailing silence trimmed,
peak-normalized to -1 dBFS, and encoded as 96 kbps MP3.

| File | Plays for | Pack | Original file |
|---|---|---|---|
| `sfx/shot-1.mp3`, `shot-2.mp3`, `shot-3.mp3` | The ION-SHIV (`fire`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `laserSmall_000`, `laserSmall_002`, `laserSmall_003` |
| `sfx/bolt-1.mp3`, `bolt-2.mp3` | A robot fires a bolt (`boltFire`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `laserRetro_002`, `laserRetro_003` |
| `sfx/bolt-warden.mp3` | A Warden fires (`boltFire`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `laserLarge_002`, cut to 0.5 seconds |
| `sfx/clank-1.mp3`, `clank-2.mp3`, `clank-3.mp3` | A shot clangs off armor (`foeHit`) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactMetal_heavy_000`, `_002`, `_004` |
| `sfx/clank-heavy-1.mp3`, `clank-heavy-2.mp3` | Armor down to its last hit (`foeHit`); armored robots blowing up (`foeDie`) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactPlate_heavy_001`, `_003` |
| `sfx/boom-1.mp3`, `boom-2.mp3`, `boom-3.mp3` | A robot blows up (`foeDie`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `explosionCrunch_000`, `_001`, `_003`, cut to under a second |
| `sfx/zap.mp3` | Shamus touches an electric wall or a lit pod gate (`playerDie`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | `zap2` |
| `sfx/power-down.mp3` | Shamus is shot or caught (`playerDie`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | `lowDown` |
| `sfx/keys.mp3` | Picking up a key (`pickup`) | [RPG Audio](https://kenney.nl/assets/rpg-audio) | `handleCoins2` |
| `sfx/bottle.mp3` | Picking up a bottle (`pickup`) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `glass_001` |
| `sfx/question.mp3` | Picking up a mystery (`pickup`) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `question_002` |
| `sfx/shield.mp3` | A mystery shield, and bolts bouncing off it (`mystery`, `boltHit`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `forceField_000` |
| `sfx/freeze.mp3` | A mystery freezes the robots (`mystery`) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `glass_004` |
| `sfx/sax-up.mp3` | An extra life (`extraLife`) | [Music Jingles](https://kenney.nl/assets/music-jingles) | `jingles_SAX02` |
| `sfx/sax-win.mp3` | Case closed (`win`) | [Music Jingles](https://kenney.nl/assets/music-jingles) | `jingles_SAX10` |
| `sfx/sax-down.mp3` | Game over (`gameOver`) | [Music Jingles](https://kenney.nl/assets/music-jingles) | `jingles_SAX07` |
| `sfx/unlock.mp3` | A key turns in its keyhole (`keyUse`) | [RPG Audio](https://kenney.nl/assets/rpg-audio) | `metalLatch` |
| `sfx/door.mp3` | A locked door slides open (`doorOpen`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `doorOpen_001` |
| `sfx/locked.mp3` | A keyhole without its key (`doorLocked`) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `error_007` |
| `sfx/shadow-swell.mp3` | The Shadow comes through the wall (`shadowEnter`) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactBell_heavy_001`, first 1.3 seconds, reversed |
| `sfx/stun.mp3` | The Shadow is stunned (`shadowStun`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | `phaserDown1` |
| `sfx/shadow-hurt.mp3` | A hit on the Shadow in his lair (`shadowHurt`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | `zapTwoTone`, cut to 0.8 seconds |
| `sfx/shadow-down.mp3` | The Shadow is beaten (`shadowDefeat`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `lowFrequency_explosion_000` |
| `sfx/hop.mp3` | A Snap-Jumper springs (`foeHop`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | `phaseJump1` |
| `sfx/step-1.mp3` to `step-5.mp3` | Footsteps | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `footstep_concrete_000` to `_004` |
| `sfx/ui-move.mp3` | Menu move | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `tick_004` |
| `sfx/ui-select.mp3` | Menu select | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `confirmation_001` |
| `sfx/ui-back.mp3` | Menu back | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `back_003` |

## Adding or swapping a file

1. Check the license on the item's own page. Use CC0 only; the game's source is public.
2. Convert it the same way as its neighbors (see the notes at the top of each section),
   and keep the file name, or add the new name to `SAMPLES` or `TRACKS` in `src/audio.js`.
3. Update this file, and check the result in `dev/sounds.html`.
