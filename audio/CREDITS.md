# Audio credits

Every recorded sound and music track that ships with Dead End but one is dedicated to the
public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). You
don't need to credit anyone to reuse those, but the people who made them deserve it, so
here they are. The exception is "Midnight Creeping in the Alchemy Lab," which is licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): reuse it only with the
credit given in its row. One more sound is used only on the family arcade and never ships;
see [Local-only sounds](#local-only-sounds).

The game synthesizes everything else in the browser: the Shadow's warning pulse and drone,
the pod gate hum, the ION-SHIV's heat whine, room-clear chimes, and a fallback for any file
that fails to load.

To hear every file, serve the game folder and open `dev/sounds.html`.

## Music

All tracks come from [OpenGameArt.org](https://opengameart.org/). Each file is normalized
to -18 LUFS and encoded as 128 kbps stereo MP3.

| File | Title | Artist | Plays | Length | Source | License |
|---|---|---|---|---|---|---|
| `music/title.mp3` | Midnight Creeping in the Alchemy Lab | glitchart, a remix of "Midnight Creeping" composed by Jonathan Shaw ([www.jshaw.co.uk](https://www.jshaw.co.uk)) and "Alchemy Lab" by tcarisland | Title screen, menus, and end screens | 4:19 | [opengameart.org/content/midnight-creeping-in-the-alchemy-lab-jonathan-shaw-tcarisland](https://opengameart.org/content/midnight-creeping-in-the-alchemy-lab-jonathan-shaw-tcarisland) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `music/sector-1.mp3` | Investigation | Umplix | Black Sector | 0:47 | [opengameart.org/content/investigation-0](https://opengameart.org/content/investigation-0) | CC0 1.0 |
| `music/sector-2.mp3` | jazz (saxaphone) | Alex McCulloch (Pro Sensory) | Blue Sector | 2:09 | [opengameart.org/content/jazz-saxaphone](https://opengameart.org/content/jazz-saxaphone) | CC0 1.0 |
| `music/sector-3.mp3` | Jazz | Umplix | Green Sector | 2:05 | [opengameart.org/content/jazz-2](https://opengameart.org/content/jazz-2) | CC0 1.0 |
| `music/sector-4.mp3` | Sneaking into the Robot Factory (from Sneaky Music Pack) | Umplix | Red Sector | 1:01 | [opengameart.org/content/sneaky-music-pack](https://opengameart.org/content/sneaky-music-pack) | CC0 1.0 |
| `music/trail.mp3` | Moil | Ruskerdax | While the Shadow is on your trail: from when he shows up until 15 seconds after he's gone (its first 1:26, looped) | 3:03 | [opengameart.org/content/moil](https://opengameart.org/content/moil) | CC0 1.0 |
| `music/lair.mp3` | Spy Loop | wipics | The Shadow's lair, room 127 | 0:25 | [opengameart.org/content/spy-loop](https://opengameart.org/content/spy-loop) | CC0 1.0 |

Changes from the originals:

- `title.mp3` is converted from the 16-bit FLAC, with the silence at the start and the
  last 1.3 seconds of silence removed, and normalized to -18 LUFS. The music is otherwise
  unchanged.
- `trail.mp3` starts at the first note (1.6 seconds of leading silence removed).
- `sector-1.mp3` leaves out the four-bar breakdown in the middle (18.7 to 28.0 seconds of
  the original), where the bass plays alone with silent rests, so the track never drops
  out.
- `sector-2.mp3` and `sector-3.mp3` have their leading silence removed.
- `sector-4.mp3` passes through a peak limiter before normalizing, so it reaches the
  target loudness without clipping.
- `lair.mp3` is cut to exactly 16 bars at 152 bpm (25.263 seconds), with the release of
  the last note laid over the start, so it repeats without a gap.

The music never stops between tracks. Entering a sector, the lair, or the title starts its
track at once, and the old track fades out over 1.2 seconds only after the new one is
playing. A track hands over a moment before it ends, while its last notes ring: the title
and the Shadow's track to a second copy of themselves, and a sector's track to the next one
in that sector's rotation (its own track, then the tracks of the sectors before it). A
sector's track picks up where it stopped after the Shadow's music; a new sector starts its
track from the top. The lair's loop is decoded in memory and repeats to the sample.

## Sound effects

The sound effects come from [Kenney](https://kenney.nl/) asset packs, plus one steam hiss
from OpenGameArt.org, all CC0 1.0. Each file is the original converted to mono (layered
files are mixed first), with leading and trailing silence trimmed, peak-normalized to
-1 dBFS, and encoded as 96 kbps MP3.

| File | Plays for | Pack | Original file |
|---|---|---|---|
| `sfx/shot-1.mp3`, `shot-2.mp3`, `shot-3.mp3` | The ION-SHIV (`fire`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `laserSmall_000`, `laserSmall_002`, `laserSmall_003` |
| `sfx/bolt-1.mp3`, `bolt-2.mp3` | A robot fires a bolt (`boltFire`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `laserRetro_002`, `laserRetro_003` |
| `sfx/bolt-warden.mp3` | A Warden fires (`boltFire`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `laserLarge_002`, cut to 0.5 seconds |
| `sfx/clank-1.mp3`, `clank-2.mp3`, `clank-3.mp3` | A shot clangs off armor (`foeHit`) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactMetal_heavy_000`, `_002`, `_004` |
| `sfx/clank-heavy-1.mp3`, `clank-heavy-2.mp3` | Armor down to its last hit (`foeHit`); armored robots blowing up (`foeDie`) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactPlate_heavy_001`, `_003` |
| `sfx/boom-1.mp3`, `boom-2.mp3`, `boom-3.mp3` | A robot blows up (`foeDie`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `explosionCrunch_000`, `_001`, `_003`, cut to under a second |
| `sfx/barrel-1.mp3`, `barrel-2.mp3` | A red barrel explodes (`barrelBoom`, and `playerDie` in its blast) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `explosionCrunch_004` and `explosionCrunch_002`, each mixed over `lowFrequency_explosion_001`, cut to 1.4 and 1.3 seconds |
| `sfx/shock.mp3` | The buzzing arc when Shamus touches an electric wall or a lit pod gate (`playerDie`); the game adds the snap, crackles, and thump | [Digital Audio](https://kenney.nl/assets/digital-audio) | `zap2` mixed with `zap1`, cut to 0.95 seconds |
| `sfx/power-down.mp3` | Shamus is shot, caught, or blown up (`playerDie`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | `lowDown` |
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
| `sfx/console-fresh.mp3` | A console maps new rooms (`consoleUse`, `fresh`) | [Digital Audio](https://kenney.nl/assets/digital-audio) and [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `pepSound3`, after the first 0.3 seconds of `computerNoise_002` |
| `sfx/console-beep.mp3` | A console with nothing new to map (`consoleUse`) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `toggle_001` |
| `sfx/console-break.mp3` | A console is shot or blasted (`consoleBreak`) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) and [Digital Audio](https://kenney.nl/assets/digital-audio) | `impactGlass_heavy_000`, with the first 0.5 seconds of `zap1` |
| `sfx/overheat.mp3` | The ION-SHIV overheats (`overheat`) | [Steam release sounds](https://opengameart.org/content/steam-release-sounds) by bart, OpenGameArt.org | `steam hisses - Marker #1`, cut to 0.9 seconds |
| `sfx/cooled.mp3` | The ION-SHIV is ready again (`cooled`) | [RPG Audio](https://kenney.nl/assets/rpg-audio) and [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `metalClick`, then `toggle_002` |
| `sfx/dry-fire.mp3` | Fire pressed while it's overheated (`dryFire`) | [UI Audio](https://kenney.nl/assets/ui-audio) | `click2`, low-passed |
| `sfx/shadow-swell.mp3` | The Shadow comes through the wall (`shadowEnter`) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactBell_heavy_001`, first 1.3 seconds, reversed |
| `sfx/stun.mp3` | The Shadow is stunned (`shadowStun`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | `phaserDown1` |
| `sfx/shadow-hurt.mp3` | A hit on the Shadow in his lair (`shadowHurt`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | `zapTwoTone`, cut to 0.8 seconds |
| `sfx/shadow-down.mp3` | The Shadow is beaten (`shadowDefeat`) | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `lowFrequency_explosion_000` |
| `sfx/hop.mp3` | A Snap-Jumper springs (`foeHop`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | `phaseJump1` |
| `sfx/step-1.mp3` to `step-5.mp3` | Footsteps | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `footstep_concrete_000` to `_004` |
| `sfx/ui-move.mp3` | Menu move | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `tick_004` |
| `sfx/ui-select.mp3` | Menu select | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `confirmation_001` |
| `sfx/ui-back.mp3` | Menu back | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `back_003` |

## Local-only sounds

These files live in `audio/local/`, which git ignores, so they never reach the public
repository. They deploy to the family arcade from the working tree. The game loads each one
first and falls back to the shipped CC0 file when it isn't there.

| File | Plays for | Source | Kept out because |
|---|---|---|---|
| `local/shock.mp3` | The arc when Shamus touches the electricity, in place of `sfx/shock.mp3` | 1.3 seconds of "High Voltage Power" by virtual_vibes (Pixabay), starting at 0.62 seconds, with a 0.35-second fade-out | The Pixabay license allows use in a game but not redistribution of the file on its own |

## Adding or swapping a file

1. Check the license on the item's own page. Prefer CC0. CC BY works too, because the
   game's source is public and credits each author, but give exactly the credit the
   license asks for here, in the README, and on the game's credits screen. A file whose
   license doesn't allow redistribution goes in `audio/local/` with a CC0 fallback in
   `audio/sfx/`.
2. Convert it the same way as its neighbors (see the notes at the top of each section),
   and keep the file name, or add the new name to `SAMPLES` or `TRACKS` in `src/audio.js`.
3. Update this file, and check the result in `dev/sounds.html`.
