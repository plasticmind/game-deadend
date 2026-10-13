// Dead End's sound. One-shot effects come from sim events and play recorded samples
// (audio/sfx/) where a recording beats the synth; everything else, and every sample that
// hasn't loaded yet or failed to load, is synthesized with WebAudio. Loops come from state:
// the Shadow's low pulsing warning, his drone while he is in the room, the pod gate hum,
// the ION-SHIV's whine as it heats up, and footsteps. Music is jazz streamed from
// audio/music/: a playful title track, a track per sector, a sneaking track while the
// Shadow is on your trail, and a tense loop in his lair. Tracks hand over without a gap.
// If a track can't play, a procedural noir loop (a walking bass under brushed hi-hats)
// takes over. audio/CREDITS.md lists every file and its license.
//
//   const audio = createAudio(settings);
//   audio.unlock();                 // on the first key, tap, or button (browser rule)
//   audio.handle(events, game);     // every frame; game null on the title screen
//   audio.setPaused(bool); audio.setSound(bool); audio.setMusic(bool);
//   audio.blip('move' | 'select' | 'back');
//   audio.preview(type, data, engine);   // dev/sounds.html: play one event
//
// Nothing here throws into the game loop, and nothing waits on a file.

const MASTER = 0.42; // modest: these play on family laptops and TVs
const SFX_LEVEL = 0.9;
const MUSIC_LEVEL = 0.5;
const TRACK_LEVEL = 0.67; // the music files sit at -18 LUFS; this plays them 2 dB above the synth loop
const DUCK_WARN = 0.3; // music level under the Shadow's warning pulse
const DUCK_NEAR = 0.65; // while he's in the room (and in his lair), so his music still lands
const ATTACK = 0.12; // seconds a new track takes to come in
const RELEASE = 1.2; // seconds the old track takes to fade out
const TRAIL_HOLD = 15; // seconds of play the Shadow's music lasts after he's gone
const TEMPO = [84, 96, 106, 118, 132]; // synth music: title, then by sector

// Walking bass, one note per beat, eight bars: Am7 Dm7 E7 Am7 | Dm7 G7 Cmaj7 E7.
const BASS = [
  45, 48, 52, 50, 50, 53, 57, 56, 52, 56, 59, 46, 45, 52, 48, 44,
  50, 48, 47, 45, 43, 47, 50, 49, 48, 52, 55, 51, 52, 50, 48, 47,
];
const CHORDS = [
  [57, 60, 64, 67], [53, 57, 60, 64], [52, 56, 59, 62], [57, 60, 64, 67],
  [53, 57, 60, 64], [55, 59, 62, 65], [55, 59, 60, 64], [52, 56, 59, 65],
];
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// ------------------------------------------------------------------ the files

const CC0 = 'CC0 1.0';
const kenney = (pack, slug) => ({ pack, author: 'Kenney', license: CC0, url: `https://kenney.nl/assets/${slug}` });
export const SOURCES = {
  scifi: kenney('Sci-Fi Sounds', 'sci-fi-sounds'),
  digital: kenney('Digital Audio', 'digital-audio'),
  impact: kenney('Impact Sounds', 'impact-sounds'),
  ui: kenney('Interface Sounds', 'interface-sounds'),
  uiAudio: kenney('UI Audio', 'ui-audio'),
  rpg: kenney('RPG Audio', 'rpg-audio'),
  jingles: kenney('Music Jingles', 'music-jingles'),
  steam: { pack: 'Steam release sounds', author: 'bart', license: CC0, url: 'https://opengameart.org/content/steam-release-sounds' },
};

// Each sample: its files in audio/sfx/ (several means a random pick each time), the pack
// and original file names, what it plays for, its level, and its random pitch spread.
// The files peak at -1 dBFS. Each level makes the sample as loud as the synth sound it
// replaces (both rendered offline and measured), so the mix stays as it was; the shot, the
// armor clanks, and the explosions sit 2 dB hotter.
export const SAMPLES = {
  shot: { files: ['shot-1', 'shot-2', 'shot-3'], from: 'scifi', orig: 'laserSmall_000, laserSmall_002, laserSmall_003', use: 'The ION-SHIV (fire)', vol: 0.112, vary: 0.05 },
  bolt: { files: ['bolt-1', 'bolt-2'], from: 'scifi', orig: 'laserRetro_002, laserRetro_003', use: 'A robot fires a bolt (boltFire)', vol: 0.018, vary: 0.05 },
  boltWarden: { files: ['bolt-warden'], from: 'scifi', orig: 'laserLarge_002', use: 'A Warden fires (boltFire)', vol: 0.019, vary: 0.04 },
  clank: { files: ['clank-1', 'clank-2', 'clank-3'], from: 'impact', orig: 'impactMetal_heavy_000, _002, _004', use: 'A shot clangs off armor (foeHit)', vol: 0.184, vary: 0.06 },
  clankHeavy: { files: ['clank-heavy-1', 'clank-heavy-2'], from: 'impact', orig: 'impactPlate_heavy_001, _003', use: 'Armor down to its last hit (foeHit, hp 1); armored wrecks and barrel debris', vol: 0.204, vary: 0.05 },
  boom: { files: ['boom-1', 'boom-2', 'boom-3'], from: 'scifi', orig: 'explosionCrunch_000, _001, _003', use: 'A robot blows up (foeDie)', vol: 0.32, vary: 0.05 },
  barrel: { files: ['barrel-1', 'barrel-2'], from: 'scifi', orig: 'explosionCrunch_004 and _002, each over lowFrequency_explosion_001', use: 'A red barrel explodes (barrelBoom)', vol: 0.5, vary: 0.04 },
  shock: { files: ['shock'], local: 'shock', from: 'digital', orig: 'zap2 over zap1', use: 'The arc when Shamus touches an electric wall or a lit pod gate (playerDie)', vol: 0.5, localVol: 0.5, localFrom: '“High Voltage Power” by virtual_vibes (Pixabay), kept out of the public repo' },
  powerDown: { files: ['power-down'], from: 'digital', orig: 'lowDown', use: 'Shamus is shot, caught, or blown up (playerDie)', vol: 0.129 },
  keys: { files: ['keys'], from: 'rpg', orig: 'handleCoins2', use: 'Picking up a key (pickup)', vol: 0.33 },
  bottle: { files: ['bottle'], from: 'ui', orig: 'glass_001', use: 'Picking up a bottle (pickup)', vol: 0.17 },
  question: { files: ['question'], from: 'ui', orig: 'question_002', use: 'Picking up a mystery (pickup)', vol: 0.086 },
  shield: { files: ['shield'], from: 'scifi', orig: 'forceField_000', use: 'A mystery shield; bolts bounce off it (mystery, boltHit)', vol: 0.075 },
  freeze: { files: ['freeze'], from: 'ui', orig: 'glass_004', use: 'A mystery freezes the robots (mystery)', vol: 0.089 },
  saxUp: { files: ['sax-up'], from: 'jingles', orig: 'jingles_SAX02', use: 'An extra life (extraLife)', vol: 0.08 },
  saxWin: { files: ['sax-win'], from: 'jingles', orig: 'jingles_SAX10', use: 'Case closed (win)', vol: 0.121 },
  saxDown: { files: ['sax-down'], from: 'jingles', orig: 'jingles_SAX07', use: 'Game over (gameOver)', vol: 0.086 },
  unlock: { files: ['unlock'], from: 'rpg', orig: 'metalLatch', use: 'A key turns in its keyhole (keyUse)', vol: 0.186 },
  door: { files: ['door'], from: 'scifi', orig: 'doorOpen_001', use: 'A locked door slides open (doorOpen)', vol: 0.107 },
  locked: { files: ['locked'], from: 'ui', orig: 'error_007', use: 'A keyhole without its key (doorLocked)', vol: 0.187 },
  consoleFresh: { files: ['console-fresh'], from: 'digital', orig: 'pepSound3, after a moment of Sci-Fi Sounds computerNoise_002', use: 'A console maps new rooms (consoleUse, fresh)', vol: 0.076 },
  consoleBeep: { files: ['console-beep'], from: 'ui', orig: 'toggle_001', use: 'A console with nothing new to map (consoleUse)', vol: 0.05 },
  consoleBreak: { files: ['console-break'], from: 'impact', orig: 'impactGlass_heavy_000, with a crackle of Digital Audio zap1', use: 'A console is shot or blasted (consoleBreak)', vol: 0.18 },
  overheat: { files: ['overheat'], from: 'steam', orig: 'steam hisses, marker 1', use: 'The ION-SHIV overheats (overheat)', vol: 0.17 },
  cooled: { files: ['cooled'], from: 'rpg', orig: 'metalClick, then Interface Sounds toggle_002', use: 'The ION-SHIV is ready again (cooled)', vol: 0.164 },
  dryFire: { files: ['dry-fire'], from: 'uiAudio', orig: 'click2', use: 'Fire pressed while it is overheated (dryFire)', vol: 0.038, vary: 0.04 },
  shadowSwell: { files: ['shadow-swell'], from: 'impact', orig: 'impactBell_heavy_001, reversed', use: 'The Shadow comes through the wall (shadowEnter)', vol: 0.314 },
  stun: { files: ['stun'], from: 'digital', orig: 'phaserDown1', use: 'The Shadow is stunned (shadowStun)', vol: 0.093 },
  shadowHurt: { files: ['shadow-hurt'], from: 'digital', orig: 'zapTwoTone', use: 'A hit on the Shadow in his lair (shadowHurt)', vol: 0.045 },
  shadowDown: { files: ['shadow-down'], from: 'scifi', orig: 'lowFrequency_explosion_000', use: 'The Shadow is beaten (shadowDefeat)', vol: 0.219 },
  hop: { files: ['hop'], from: 'digital', orig: 'phaseJump1', use: 'A Snap-Jumper springs (foeHop)', vol: 0.028, vary: 0.05 },
  step: { files: ['step-1', 'step-2', 'step-3', 'step-4', 'step-5'], from: 'impact', orig: 'footstep_concrete_000 to _004', use: 'Footsteps', vol: 0.012, vary: 0.05 },
  uiMove: { files: ['ui-move'], from: 'ui', orig: 'tick_004', use: 'Menu move', vol: 0.04, vary: 0.03 },
  uiSelect: { files: ['ui-select'], from: 'ui', orig: 'confirmation_001', use: 'Menu select', vol: 0.02 },
  uiBack: { files: ['ui-back'], from: 'ui', orig: 'back_003', use: 'Menu back', vol: 0.088 },
};

// Music in audio/music/. Every track is CC0 except `title`, which is CC BY 4.0 and credited
// in the game. `tail` is how many seconds before its end a track hands over (while its last
// notes ring), or `out` is the moment it hands over; `head` is where it starts when it comes
// in under another track. `loop` tracks hand over to themselves. The lair is a decoded
// buffer that loops to the sample, `loopLength` seconds long.
export const TRACKS = {
  title: {
    file: 'title', title: 'Midnight Creeping in the Alchemy Lab', author: 'glitchart, remixing Jonathan Shaw (jshaw.co.uk) and tcarisland',
    license: 'CC BY 4.0', url: 'https://opengameart.org/content/midnight-creeping-in-the-alchemy-lab-jonathan-shaw-tcarisland',
    use: 'Title screen, menus, and end screens', loop: true, head: 6.6, tail: 9,
  },
  'sector-1': { file: 'sector-1', title: 'Investigation', author: 'Umplix', license: CC0, url: 'https://opengameart.org/content/investigation-0', use: 'Black Sector', head: 9.35, tail: 0.12 },
  'sector-2': { file: 'sector-2', title: 'jazz (saxaphone)', author: 'Alex McCulloch (Pro Sensory)', license: CC0, url: 'https://opengameart.org/content/jazz-saxaphone', use: 'Blue Sector', tail: 3 },
  'sector-3': { file: 'sector-3', title: 'Jazz', author: 'Umplix', license: CC0, url: 'https://opengameart.org/content/jazz-2', use: 'Green Sector', tail: 0.25 },
  'sector-4': { file: 'sector-4', title: 'Sneaking into the Robot Factory', author: 'Umplix', license: CC0, url: 'https://opengameart.org/content/sneaky-music-pack', use: 'Red Sector', head: 3.1, tail: 0.35 },
  trail: {
    file: 'trail', title: 'Moil', author: 'Ruskerdax', license: CC0, url: 'https://opengameart.org/content/moil',
    use: 'The Shadow on your trail: from when he shows up until 15 seconds after he is gone (its first 86 seconds, looped)', loop: true, out: 86, fade: 1.5,
  },
  lair: { file: 'lair', title: 'Spy Loop', author: 'wipics', license: CC0, url: 'https://opengameart.org/content/spy-loop', use: "The Shadow's lair (room 127)", loop: true, buffer: true, loopLength: 25.26316 },
};
const ROTATION = ['sector-1', 'sector-2', 'sector-3', 'sector-4'];
const SECTOR = new Set(ROTATION);

// Relative to this module, because the game is served from /game-deadend/, not the root.
export const sfxUrl = (file) => new URL(`../audio/sfx/${file}.mp3`, import.meta.url).href;
export const musicUrl = (file) => new URL(`../audio/music/${file}.mp3`, import.meta.url).href;
// Sounds the arcade may use but not redistribute live in audio/local/, which git ignores. A
// sample with a `local` file tries it first and falls back to its own file in audio/sfx/.
export const localUrl = (file) => new URL(`../audio/local/${file}.mp3`, import.meta.url).href;

// ------------------------------------------------------------------ the engine

export function createAudio({ sound = true, music = true, context = null } = {}) {
  let ctx = null;
  let master = null;
  let sfx = null;
  let mus = null;
  let musHit = null; // a short duck under the electrocution
  let meterNode = null;
  let noiseBuf = null;
  let soundOn = sound;
  let musicOn = music;
  let paused = false;
  const loops = {};
  const lastPlayed = {};
  const lastPick = {};
  const ms = { next: 0, step: 0, tempo: TEMPO[0] };
  const walk = { last: null, acc: 0, alt: 0 };
  let warnSerial = -1;
  let shadowNear = false; // the Shadow is in the room
  let warnNear = false; // his warning is sounding
  let inLair = false;
  let force = null; // 'synth' while previewing the synth version of an event

  // Samples: fetch the bytes now (no AudioContext needed), decode after unlock.
  const raw = {}; // file -> Promise<ArrayBuffer | null>
  const bufs = {}; // file -> { buf, off }
  const missing = new Set();
  let decoding = false;
  const allFiles = [...new Set(Object.values(SAMPLES).flatMap((s) => s.files))];
  const localFiles = new Set(Object.values(SAMPLES).map((s) => s.local).filter(Boolean));
  const fromLocal = new Set(); // files that loaded from audio/local/
  if (typeof fetch === 'function') {
    for (const f of allFiles) {
      const shipped = () => fetch(sfxUrl(f)).then((r) => (r.ok ? r.arrayBuffer() : null));
      const local = () =>
        fetch(localUrl(f)).then((r) => {
          if (!r.ok) return shipped();
          fromLocal.add(f);
          return r.arrayBuffer();
        }, shipped);
      raw[f] = (localFiles.has(f) ? local() : shipped()).catch(() => null);
    }
  }

  // ------------------------------------------------------------------ setup

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!context && !AC) return;
      try {
        ctx = context || new AC();
      } catch {
        return;
      }
      master = ctx.createGain();
      master.gain.value = MASTER;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
      sfx = ctx.createGain();
      sfx.gain.value = soundOn ? SFX_LEVEL : 0;
      sfx.connect(master);
      mus = ctx.createGain();
      mus.gain.value = musicOn ? MUSIC_LEVEL : 0;
      musHit = ctx.createGain();
      mus.connect(musHit).connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      ms.next = ctx.currentTime + 0.1;
      decodeAll();
      makeVoices();
    }
    if (ctx.state === 'suspended' && !context) ctx.resume().catch(() => {});
    // iOS lets a media element start only from a tap or key: bless every voice here, and
    // start (or retry) the music while this gesture lasts.
    blessVoices();
    if (musicOn && !paused) kickMusic();
  }

  function decodeAll() {
    if (decoding) return;
    decoding = true;
    for (const f of allFiles) {
      if (!raw[f]) {
        missing.add(f);
        continue;
      }
      raw[f]
        .then((ab) => (ab ? decode(ab) : null))
        .then((buf) => {
          if (buf) bufs[f] = { buf, off: leadIn(buf) };
          else missing.add(f);
        })
        .catch(() => missing.add(f));
    }
  }
  // Old Safari only has the callback form of decodeAudioData; newer browsers return a promise.
  function decode(ab) {
    return new Promise((resolve) => {
      try {
        const p = ctx.decodeAudioData(ab, resolve, () => resolve(null));
        if (p && typeof p.catch === 'function') p.catch(() => resolve(null));
      } catch {
        resolve(null);
      }
    });
  }

  // Skip the decoder's leading silence (MP3 padding) so a shot sounds the instant it fires.
  function leadIn(buf) {
    const d = buf.getChannelData(0);
    const end = Math.min(d.length, Math.floor(buf.sampleRate * 0.15));
    for (let i = 0; i < end; i++) {
      if (Math.abs(d[i]) > 0.003) return Math.max(0, (i - 32) / buf.sampleRate);
    }
    return 0;
  }

  // Throttle a sound so a burst of identical events doesn't stack into a roar.
  function gate(name, gap) {
    const now = ctx.currentTime;
    if (lastPlayed[name] && now - lastPlayed[name] < gap) return false;
    lastPlayed[name] = now;
    return true;
  }

  // Play a sample if it's ready. Returns false (so the caller can synthesize) if it isn't.
  function sample(name, { vol = 1, rate = 1, at = 0 } = {}) {
    if (force === 'synth') return false;
    const def = SAMPLES[name];
    if (!def) return false;
    const ready = def.files.filter((f) => bufs[f]);
    if (!ready.length) return false;
    let file = ready[0];
    if (ready.length > 1) {
      // A random variant, never the same one twice in a row.
      const options = ready.filter((f) => f !== lastPick[name]);
      file = options[Math.floor(Math.random() * options.length)];
    }
    lastPick[name] = file;
    try {
      const { buf, off } = bufs[file];
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const spread = def.vary || 0;
      src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * spread);
      const g = ctx.createGain();
      g.gain.value = (fromLocal.has(file) && def.localVol ? def.localVol : def.vol) * vol;
      src.connect(g).connect(sfx);
      src.start(ctx.currentTime + at, off);
      return true;
    } catch {
      return false;
    }
  }

  function tone({ type = 'sine', f0, f1 = f0, dur = 0.2, vol = 0.2, at = 0, attack = 0.005, bus = sfx, filter = null, q = 1, detune = 0 }) {
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    if (detune) o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = typeof q === 'object' ? q.f : 1200;
      if (typeof q === 'object') f.Q.value = q.q ?? 1;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(bus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise({ dur = 0.2, vol = 0.2, at = 0, type = 'lowpass', f0 = 1000, f1 = f0, q = 1, attack = 0.003, bus = sfx }) {
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t0, Math.random() * 0.9);
    src.stop(t0 + dur + 0.05);
  }

  const notes = (list, { type = 'square', step = 0.09, dur = 0.12, vol = 0.1, at = 0 } = {}) =>
    list.forEach((m, i) => tone({ type, f0: hz(m), dur, vol, at: at + i * step }));

  // ------------------------------------------------------------------ loops (state driven)

  function loop(name, build) {
    if (!loops[name]) {
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(sfx);
      loops[name] = { out, level: 0, ...build(out) };
    }
    return loops[name];
  }

  function setLoop(name, level, build, tc = 0.12) {
    if (!ctx) return;
    if (level <= 0 && !loops[name]) return;
    const l = loop(name, build);
    if (Math.abs(l.level - level) < 1e-4) return;
    l.level = level;
    l.out.gain.setTargetAtTime(level, ctx.currentTime, tc);
  }

  // "A low pitched pulsing": the cue that the Shadow is about to come in.
  const buildWarn = (out) => {
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3.2;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(pulse.gain);
    const a = ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = 58;
    const b = ctx.createOscillator();
    b.type = 'triangle';
    b.frequency.value = 116.5;
    const bg = ctx.createGain();
    bg.gain.value = 0.35;
    a.connect(pulse);
    b.connect(bg).connect(pulse);
    pulse.connect(out);
    [lfo, a, b].forEach((o) => o.start());
  };

  // His presence: two detuned saws under a slowly breathing low-pass.
  const buildDrone = (out) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    f.Q.value = 3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const depth = ctx.createGain();
    depth.gain.value = 110;
    lfo.connect(depth).connect(f.frequency);
    for (const fr of [46.2, 46.9, 69.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.connect(f);
      o.start();
    }
    f.connect(out);
    lfo.start();
  };

  // Pod gates: an electric hum while they are live.
  const buildHum = (out) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 120;
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = 180.6;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    o.connect(f);
    o2.connect(g2).connect(f);
    f.connect(out);
    o.start();
    o2.start();
  };

  // The ION-SHIV heating up: a thin whine that climbs with the heat.
  const buildHeat = (out) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 700;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    f.Q.value = 2;
    const wob = ctx.createOscillator();
    wob.frequency.value = 9;
    const depth = ctx.createGain();
    depth.gain.value = 12;
    wob.connect(depth).connect(osc.frequency);
    osc.connect(f).connect(out);
    osc.start();
    wob.start();
    return { osc };
  };

  function loopsOff() {
    for (const name of Object.keys(loops)) setLoop(name, 0);
  }

  // ------------------------------------------------------------------ music tracks

  // Every track is fetched once into memory (the title track at once, the rest right after
  // unlock) and played by "voices": two <audio> elements per track that share the file, so
  // a track can hand over to itself at its loop point. The lair's loop is a decoded buffer
  // instead, looped to the sample. A change of track starts the new one at once (ATTACK),
  // and the old one fades out (RELEASE) only once the new one is actually playing, so the
  // music never fades into nothing. A track hands over a moment before it ends, while its
  // last notes still ring: to its own second voice if it loops, or to the next track in
  // the sector's rotation. Each sector's rotation is its own track, then the tracks of the
  // sectors before it, so a sector's track is new when you get there.
  const voices = [];
  const voicesOf = {}; // track -> its voices
  const urls = {}; // track -> object URL of the file in memory, 'buffer' for the lair, false if it failed
  const lairData = { raw: null, buf: null, start: 0, end: 0, decoding: false };
  let lead = null; // the voice for the track the game wants
  let lastWant = 'title';
  let quietSince = 0;
  let silentSince = 0;
  const resumeAt = {}; // sector track -> seconds where it stopped, to pick up after the Shadow's music
  const rot = { zone: 0, list: [], idx: 0, fresh: false };
  const trail = { game: null, until: -1 }; // the Shadow's music plays until game.t passes `until`

  function fetchTrack(name) {
    if (name in urls || typeof fetch !== 'function' || context) return;
    urls[name] = null;
    const t = TRACKS[name];
    fetch(musicUrl(t.file))
      .then((r) => (r.ok ? (t.buffer ? r.arrayBuffer() : r.blob()) : null))
      .then((data) => {
        if (!data) {
          urls[name] = false;
        } else if (t.buffer) {
          lairData.raw = data;
          urls[name] = 'buffer';
          decodeLair();
        } else {
          urls[name] = URL.createObjectURL(data);
          for (const v of voicesOf[name] || []) setSource(v);
        }
      })
      .catch(() => {
        urls[name] = false;
      });
  }
  // The title track loads with the page, so it's ready for the first key.
  if (typeof URL !== 'undefined' && URL.createObjectURL) fetchTrack('title');

  function decodeLair() {
    if (!ctx || !lairData.raw || lairData.decoding) return;
    lairData.decoding = true;
    decode(lairData.raw).then((buf) => {
      if (!buf) {
        urls.lair = false;
        return;
      }
      const len = TRACKS.lair.loopLength;
      // A decoder that ignores the MP3's gapless note keeps the encoder's 1105-sample delay.
      lairData.start = buf.duration - len > 0.02 ? 1105 / 44100 : 0;
      lairData.end = Math.min(buf.duration, lairData.start + len);
      lairData.buf = buf;
    });
  }

  function makeVoices() {
    if (voices.length || context || typeof Audio === 'undefined' || typeof ctx.createMediaElementSource !== 'function') return;
    if (typeof URL === 'undefined' || !URL.createObjectURL) return;
    for (const name of Object.keys(TRACKS)) {
      voicesOf[name] = [];
      const t = TRACKS[name];
      for (let i = 0; i < (t.buffer ? 1 : 2); i++) {
        const v = { track: name, el: null, gain: ctx.createGain(), src: null, state: 'idle', at: 0, fadeEnd: 0, fadeLen: 0, handed: false, held: false, blessed: false, blocked: false, pending: false, attack: ATTACK, started: 0 };
        v.gain.gain.value = 0;
        if (!t.buffer) {
          try {
            v.el = new Audio();
            v.el.preload = 'auto';
            ctx.createMediaElementSource(v.el).connect(v.gain);
          } catch {
            continue;
          }
          v.el.addEventListener('playing', () => onPlaying(v));
          v.el.addEventListener('ended', () => onEnded(v));
          v.el.addEventListener('error', () => {
            if (!v.el.getAttribute('src')) return;
            urls[name] = false;
            if (v.state !== 'idle') stopVoice(v);
          });
          setSource(v);
        }
        v.gain.connect(mus);
        voicesOf[name].push(v);
        voices.push(v);
      }
    }
    for (const name of Object.keys(TRACKS)) fetchTrack(name);
    decodeLair();
  }

  function setSource(v) {
    const url = urls[v.track];
    if (v.el && typeof url === 'string' && url !== 'buffer' && !v.el.getAttribute('src')) v.el.src = url;
  }

  // A play() from a tap or key lets iOS play that element later without one.
  function blessVoices() {
    for (const v of voices) {
      if (!v.el || v.blessed || v.state !== 'idle') continue;
      v.blessed = true;
      try {
        const p = v.el.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
        v.el.pause();
      } catch {
        // Nothing to bless.
      }
    }
    for (const v of voices) v.blocked = false;
  }

  // A media voice can start once its file is in memory: it fades in only when it's
  // actually playing, so asking early costs nothing (and iOS buffers nothing until asked).
  function ready(v) {
    if (!v.el) return !!lairData.buf;
    return typeof urls[v.track] === 'string' && !!v.el.getAttribute('src') && !v.blocked;
  }

  const audible = (v) => v.state === 'playing' || v.state === 'fading';

  function playEl(v) {
    if (v.pending) return;
    let p;
    try {
      p = v.el.play();
    } catch {
      return;
    }
    if (!p || typeof p.then !== 'function') return;
    v.pending = true;
    p.then(
      () => {
        v.pending = false;
      },
      (err) => {
        v.pending = false;
        const why = err && err.name;
        if (why === 'NotAllowedError') {
          // Wait for the next tap or key; whatever is playing keeps playing.
          v.blocked = true;
          if (v.state === 'starting') v.state = 'waiting';
        } else if (why === 'NotSupportedError') {
          urls[v.track] = false;
          if (v.state !== 'idle') stopVoice(v);
        }
      },
    );
  }

  // Start voice `v` at `at` seconds into its track. A media voice turns up when it is
  // actually playing (onPlaying); the lair's buffer plays at once.
  function startVoice(v, at) {
    const now = ctx.currentTime;
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    v.handed = false;
    v.held = false;
    v.fadeEnd = 0;
    v.fadeLen = 0;
    if (!v.el) {
      try {
        stopSource(v);
        const src = ctx.createBufferSource();
        src.buffer = lairData.buf;
        src.loop = true;
        src.loopStart = lairData.start;
        src.loopEnd = lairData.end;
        src.connect(v.gain);
        src.start(now, lairData.start + (at % (lairData.end - lairData.start)));
        v.src = src;
        v.started = now - at;
      } catch {
        urls[v.track] = false;
        v.state = 'idle';
        return;
      }
      v.state = 'playing';
      g.linearRampToValueAtTime(TRACK_LEVEL, now + v.attack);
      if (v === lead) fadeOthers(v);
      return;
    }
    v.state = 'starting';
    try {
      if (Math.abs(v.el.currentTime - at) > 0.03) v.el.currentTime = at;
    } catch {
      // Can't seek: it starts where it is.
    }
    playEl(v);
  }

  function onPlaying(v) {
    if (v.state !== 'starting') return;
    if (v !== lead) {
      stopVoice(v); // a start the game no longer wants
      return;
    }
    v.state = 'playing';
    const now = ctx.currentTime;
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(TRACK_LEVEL, now + v.attack);
    fadeOthers(v);
  }

  // Fade every voice but `keep`. A voice handing over rings out over its own tail.
  function fadeOthers(keep) {
    for (const v of voices) if (v !== keep) fadeOut(v);
  }

  function fadeOut(v) {
    if (v.state === 'idle' || v.state === 'fading') return;
    if (v.state !== 'playing') {
      stopVoice(v); // never heard
      return;
    }
    const now = ctx.currentTime;
    let dur = RELEASE;
    if (v.handed && v.el) {
      dur = v.fadeLen || Math.max(0.05, Math.min(8, (v.el.duration || 0) - v.el.currentTime));
    } else if (v.el && SECTOR.has(v.track)) {
      resumeAt[v.track] = v.el.currentTime;
    }
    const g = v.gain.gain;
    const from = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(from, now);
    g.linearRampToValueAtTime(0, now + dur);
    v.state = 'fading';
    v.fadeEnd = now + dur + 0.05;
  }

  function stopSource(v) {
    if (!v.src) return;
    try {
      v.src.stop();
      v.src.disconnect();
    } catch {
      // Already stopped.
    }
    v.src = null;
  }

  function stopVoice(v) {
    v.state = 'idle';
    v.fadeEnd = 0;
    v.handed = false;
    v.held = false;
    const now = ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(0, now);
    if (!v.el) {
      stopSource(v);
      return;
    }
    try {
      v.el.pause();
      // Wait where the next start will most likely be, so it's instant.
      const head = TRACKS[v.track].head || 0;
      if (Math.abs(v.el.currentTime - head) > 0.05) v.el.currentTime = head;
    } catch {
      // A stream that can't seek starts from wherever it is.
    }
  }

  // Where a track starts: a sector's track picks up where it stopped after the Shadow's
  // music, unless the sector is new; otherwise at `head`, past any sparse opening.
  function startAt(v, fresh) {
    const t = TRACKS[v.track];
    const pos = resumeAt[v.track];
    const len = v.el ? v.el.duration : 0;
    if (!fresh && SECTOR.has(v.track) && pos > 0 && (!(len > 0) || pos < len - (t.tail || 0) - 4)) return pos;
    return t.head || 0;
  }

  // A scene change cuts short a long ring-out (a track handing over over its last bars).
  function hurryFades() {
    const now = ctx.currentTime;
    for (const v of voices) {
      if (v.state !== 'fading' || v.fadeEnd <= now + RELEASE) continue;
      const g = v.gain.gain;
      const from = g.value;
      g.cancelScheduledValues(now);
      g.setValueAtTime(from, now);
      g.linearRampToValueAtTime(0, now + RELEASE);
      v.fadeEnd = now + RELEASE + 0.05;
    }
  }

  // Make `name` the track: bring back a voice that is still playing it, or start a free one.
  function switchTo(name) {
    hurryFades();
    const fresh = !SECTOR.has(name) || rot.fresh;
    if (SECTOR.has(name)) rot.fresh = false;
    for (const v of voices) if (v.track !== name && (v.state === 'waiting' || v.state === 'starting')) stopVoice(v);
    if (urls[name] === false || !voicesOf[name] || !voicesOf[name].length) {
      lead = null; // the synth loop takes over
      for (const v of voices) fadeOut(v);
      return;
    }
    const pool = voicesOf[name];
    if (!fresh) {
      const back = pool.find((v) => v.state === 'playing' && !v.handed) || pool.find((v) => v.state === 'fading' && !v.handed);
      if (back) {
        lead = back;
        const now = ctx.currentTime;
        const g = back.gain.gain;
        const from = g.value;
        g.cancelScheduledValues(now);
        g.setValueAtTime(from, now);
        g.linearRampToValueAtTime(TRACK_LEVEL, now + ATTACK);
        back.state = 'playing';
        back.fadeEnd = 0;
        fadeOthers(back);
        return;
      }
    }
    const v = pool.find((x) => x.state === 'idle') || pool.find((x) => x.state === 'fading') || pool[0];
    if (v.state !== 'idle') stopVoice(v);
    lead = v;
    v.attack = ATTACK;
    v.at = startAt(v, fresh);
    v.state = 'waiting';
    if (ready(v)) startVoice(v, v.at);
  }

  // Near its end, a track hands over while its last notes ring.
  function checkHandoff(v) {
    if (!v.el || v.handed) return;
    const t = TRACKS[v.track];
    const len = v.el.duration;
    if (!(len > 0)) return;
    const out = t.out != null ? t.out : len - (t.tail || 0.25);
    if (v.el.currentTime < out) return;
    handOff(v);
  }

  function handOff(v) {
    const t = TRACKS[v.track];
    let next = v.track;
    if (!t.loop && SECTOR.has(v.track) && rot.list.length) {
      rot.idx++;
      next = rot.list[rot.idx % rot.list.length];
      delete resumeAt[next];
    }
    const pool = voicesOf[next] || [];
    const nv = pool.find((x) => x !== v && x.state === 'idle') || pool.find((x) => x !== v && x.state === 'fading');
    v.handed = true;
    v.fadeLen = t.out != null ? t.fade || RELEASE : 0;
    if (!nv || urls[next] === false) return; // nothing free: it plays out
    if (nv.state !== 'idle') stopVoice(nv);
    lead = nv;
    nv.attack = Math.min(ATTACK, Math.max(0.05, t.tail || ATTACK));
    nv.at = TRACKS[next].head || 0;
    nv.state = 'waiting';
    if (ready(nv)) startVoice(nv, nv.at);
  }

  function onEnded(v) {
    if (v === lead && !v.handed) handOff(v);
    if (v.state !== 'idle' && v !== lead) stopVoice(v);
  }

  // Pausing stops the streams once the music bus has faded; they pick up where they were.
  function holdAll() {
    for (const v of voices) {
      if (v.state === 'fading' || v.state === 'starting') stopVoice(v);
      else if (v.state === 'playing' && !v.held) {
        v.held = true;
        if (v.el) {
          try {
            v.el.pause();
          } catch {
            // Already paused.
          }
        } else {
          v.at = (ctx.currentTime - v.started) % (lairData.end - lairData.start || 1);
          stopSource(v);
        }
      }
    }
  }

  function resumeHeld() {
    for (const v of voices) {
      if (!v.held) continue;
      v.held = false;
      if (v.el) playEl(v);
      else {
        v.state = 'waiting';
        startVoice(v, v.at);
      }
    }
  }

  function quietSoon() {
    setTimeout(() => {
      if (ctx && (paused || !musicOn)) holdAll();
    }, 900);
  }

  // Called from unlock (a gesture): start whatever is waiting.
  function kickMusic() {
    if (!voices.length) return;
    if (!lead) switchTo(lastWant);
    resumeHeld();
    if (lead && lead.state === 'waiting' && ready(lead)) startVoice(lead, lead.at);
  }

  // The Shadow on your trail: from the moment he shows up in a room until TRAIL_HOLD
  // seconds of play after he's gone, his music plays.
  function onTrail(game) {
    if (trail.game !== game) {
      trail.game = game;
      trail.until = -1;
    }
    if (game.shadow && game.shadow.state !== 'dying') trail.until = game.t + TRAIL_HOLD;
    return game.t < trail.until;
  }

  // Which track this moment calls for.
  function trackFor(game) {
    if (!game || !game.room || game.mode === 'won' || game.mode === 'gameover') {
      rot.zone = 0;
      return 'title';
    }
    if (game.room.lair) return 'lair';
    const zone = Math.min(ROTATION.length, game.room.zone || 1);
    if (zone !== rot.zone) {
      rot.zone = zone;
      rot.list = [ROTATION[zone - 1], ...ROTATION.slice(0, zone - 1)];
      rot.idx = 0;
      rot.fresh = true;
      for (const k of ROTATION) delete resumeAt[k];
    }
    if (onTrail(game)) return 'trail';
    return rot.list[rot.idx % rot.list.length];
  }

  function updateMusic(want) {
    if (!voices.length) return;
    const now = ctx.currentTime;
    for (const v of voices) if (v.state === 'fading' && now >= v.fadeEnd) stopVoice(v);
    if (!musicOn || paused) {
      if (!quietSince) quietSince = now;
      else if (now - quietSince > 0.8) holdAll();
      return;
    }
    quietSince = 0;
    resumeHeld();
    if (urls[want] === false) {
      if (lead || voices.some(audible)) switchTo(want); // let the synth loop take over
    } else if (!lead || lead.track !== want || (rot.fresh && SECTOR.has(want))) switchTo(want);
    if (lead && lead.state === 'waiting' && ready(lead)) startVoice(lead, lead.at);
    if (lead && lead.state === 'playing') checkHandoff(lead);
    if (voices.some(audible)) silentSince = 0;
    else if (!silentSince) silentSince = now;
  }

  // The procedural loop plays when there is no track: no media support, a file that
  // failed, or (for a moment) nothing loaded yet.
  function synthMusic() {
    if (!voices.length) return true;
    if (urls[lastWant] === false) return true;
    return silentSince > 0 && ctx.currentTime - silentSince > 1.5;
  }

  // ------------------------------------------------------------------ synth music

  function scheduleMusic() {
    const now = ctx.currentTime;
    if (ms.next < now - 0.05) ms.next = now + 0.05;
    while (ms.next < now + 0.3) {
      const spb = 60 / ms.tempo;
      const i = ms.step;
      const sub = i % 2;
      const beat = (i >> 1) % BASS.length;
      const t = ms.next - now;
      if (sub === 0) {
        // Upright bass: a triangle an octave down with a sine on top for definition.
        tone({ type: 'triangle', f0: hz(BASS[beat] - 12), dur: spb * 0.92, vol: 0.34, at: t, attack: 0.012, bus: mus });
        tone({ type: 'sine', f0: hz(BASS[beat]), dur: spb * 0.6, vol: 0.08, at: t, attack: 0.01, bus: mus });
        if (beat % 4 === 0) {
          // A soft vibraphone-ish chord at the top of each bar.
          for (const m of CHORDS[(beat / 4) % CHORDS.length]) {
            tone({ type: 'sine', f0: hz(m), dur: spb * 2.6, vol: 0.022, at: t + 0.01, attack: 0.03, bus: mus });
          }
        }
        // Brushed hat on every beat, with a swish on two and four.
        noise({ dur: 0.05, vol: 0.035, at: t, type: 'highpass', f0: 7000, bus: mus });
        if (beat % 2 === 1) noise({ dur: 0.2, vol: 0.05, at: t, type: 'bandpass', f0: 2600, q: 0.6, attack: 0.03, bus: mus });
      } else if ((i >> 1) % 4 !== 3) {
        noise({ dur: 0.04, vol: 0.022, at: t, type: 'highpass', f0: 8000, bus: mus });
      }
      ms.next += sub === 0 ? spb * 0.64 : spb * 0.36; // swung eighths
      ms.step++;
    }
  }

  // The music bus: off, paused, or ducked so the Shadow always reads. His warning pulse
  // gets the deep duck; while he's in the room, the music only dips, so his track lands.
  let busLevel = -1;
  function updateMusicGain() {
    if (!ctx) return;
    const duck = warnNear && !inLair ? DUCK_WARN : shadowNear || warnNear ? DUCK_NEAR : 1;
    const level = musicOn && !paused ? MUSIC_LEVEL * duck : 0;
    if (Math.abs(level - busLevel) < 1e-4) return;
    const tc = level < busLevel ? 0.12 : 0.5; // duck fast, come back slowly
    busLevel = level;
    mus.gain.setTargetAtTime(level, ctx.currentTime, tc);
  }

  // Drop the music for a moment, so a big sound lands harder.
  function hitMusic(level, hold) {
    const now = ctx.currentTime;
    const g = musHit.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(level, now + 0.02);
    g.setValueAtTime(level, now + hold);
    g.linearRampToValueAtTime(1, now + hold + 1.2);
  }
  // ------------------------------------------------------------------ one-shots

  function play(e, game) {
    switch (e.type) {
      case 'fire': // the ION-SHIV
        if (sample('shot')) break;
        tone({ type: 'square', f0: 1900, f1: 520, dur: 0.09, vol: 0.09 });
        tone({ type: 'sawtooth', f0: 2600, f1: 1100, dur: 0.05, vol: 0.04 });
        break;
      case 'boltFire': {
        if (!gate('bolt', 0.05)) break;
        const warden = (e.from || e.foe) === 'warden';
        if (sample(warden ? 'boltWarden' : 'bolt')) break;
        tone({ type: 'sawtooth', f0: warden ? 420 : 560, f1: 170, dur: 0.15, vol: 0.07, filter: 'bandpass', q: { f: 900, q: 1.2 } });
        break;
      }
      case 'shotHit':
        if (!gate('hit', 0.03)) break;
        if (e.what === 'bolt') tone({ type: 'triangle', f0: 1300, f1: 2600, dur: 0.07, vol: 0.08 });
        else if (e.what === 'lock' || e.what === 'pod') tone({ type: 'square', f0: 140, dur: 0.08, vol: 0.05 });
        else noise({ dur: 0.04, vol: 0.06, type: 'highpass', f0: 2800 });
        break;
      case 'boltHit':
        if (!gate('boltHit', 0.05)) break;
        if (e.what === 'shield') {
          if (!sample('shield', { vol: 0.45, rate: 1.4 })) tone({ type: 'sine', f0: 1600, f1: 2200, dur: 0.08, vol: 0.06 });
        } else if (e.what !== 'freeze') noise({ dur: 0.05, vol: 0.04, type: 'bandpass', f0: 1800, q: 2 });
        break;
      case 'foeHop': // a Snap-Jumper springs
        if (!gate('hop', 0.08)) break;
        if (sample('hop')) break;
        tone({ type: 'triangle', f0: 200, f1: 560, dur: 0.13, vol: 0.06 });
        break;
      case 'shadowBlink':
        noise({ dur: 0.28, vol: 0.08, type: 'bandpass', f0: 700, f1: 2600, q: 3, attack: 0.08 });
        break;
      case 'foeHit': {
        // Armor takes it: a clank with a ricochet ring on top. The last hit before the
        // armor gives way lands heavier.
        if (!gate('armor', 0.04)) break;
        const last = e.hp === 1;
        const clanked = sample(last ? 'clankHeavy' : 'clank');
        tone({ type: 'triangle', f0: 980, f1: 620, dur: 0.1, vol: clanked ? 0.05 : 0.12 });
        tone({ type: 'square', f0: 1480, dur: 0.05, vol: clanked ? 0.025 : 0.04 });
        if (last && !clanked) tone({ type: 'sine', f0: 240, f1: 90, dur: 0.16, vol: 0.14 });
        break;
      }
      case 'foeDie': {
        const chain = !!e.chain || e.by === 'barrel';
        const at = chain ? 0.05 : 0;
        if (!gate(chain ? 'boomChain' : 'boom', 0.04)) break;
        if (sample('boom', { at, vol: chain ? 0.75 : 1, rate: chain ? 1.12 : 1 })) {
          if (e.armored) sample('clankHeavy', { at: at + 0.03, vol: 0.7, rate: 0.85 });
          break;
        }
        noise({ dur: chain ? 0.32 : 0.5, vol: chain ? 0.24 : 0.34, at, type: 'lowpass', f0: chain ? 3200 : 2200, f1: 140, q: 0.7 });
        tone({ type: 'sine', f0: chain ? 220 : 150, f1: 38, dur: chain ? 0.28 : 0.4, vol: chain ? 0.2 : 0.3, at });
        break;
      }
      case 'barrelBoom':
        // Chain blasts come at least 0.34 s apart; the gate lets each one read.
        if (gate('barrel', 0.2)) barrelBoom(!!e.chain);
        break;
      case 'overheat': {
        // The ION-SHIV overheats: steam vents, and the charge drops away.
        const vented = sample('overheat');
        tone({ type: 'sawtooth', f0: 1500, f1: 260, dur: 0.5, vol: vented ? 0.025 : 0.05, filter: 'lowpass', q: { f: 2400, q: 1 } });
        if (!vented) noise({ dur: 0.85, vol: 0.12, type: 'highpass', f0: 3000, f1: 1600, attack: 0.02 });
        break;
      }
      case 'cooled':
        if (sample('cooled')) break;
        noise({ dur: 0.03, vol: 0.08, type: 'bandpass', f0: 2500, q: 2 });
        tone({ type: 'sine', f0: 1568, dur: 0.18, vol: 0.06, at: 0.06 });
        break;
      case 'dryFire':
        if (!gate('dry', 0.1)) break;
        if (sample('dryFire')) break;
        noise({ dur: 0.035, vol: 0.2, type: 'lowpass', f0: 900, q: 1.5 });
        break;
      case 'consoleUse':
        if (!gate('console', 0.15)) break;
        if (e.fresh) {
          // New rooms on the map: a burst of data, then a rising chirp.
          if (sample('consoleFresh')) break;
          for (let i = 0; i < 5; i++) tone({ type: 'square', f0: 900 + ((i * 677) % 900), dur: 0.03, vol: 0.06, at: i * 0.035 });
          notes([72, 76, 79, 84, 88], { type: 'square', step: 0.05, dur: 0.07, vol: 0.11, at: 0.2 });
        } else if (!sample('consoleBeep')) {
          tone({ type: 'square', f0: 932, dur: 0.09, vol: 0.05 });
        }
        break;
      case 'consoleBreak':
        if (!gate('consoleBreak', 0.08)) break;
        if (sample('consoleBreak')) break;
        noise({ dur: 0.25, vol: 0.2, type: 'highpass', f0: 2500, f1: 1200 });
        for (let i = 0; i < 4; i++) noise({ dur: 0.03, vol: 0.15, at: 0.05 + i * 0.06, type: 'bandpass', f0: 3000 + i * 700, q: 2 });
        tone({ type: 'sawtooth', f0: 220, f1: 60, dur: 0.3, vol: 0.08 });
        break;
      case 'roomClear':
        tone({ type: 'sine', f0: 1318.5, dur: 0.7, vol: 0.12 });
        tone({ type: 'sine', f0: 2637, dur: 0.4, vol: 0.03 });
        tone({ type: 'sine', f0: 1760, dur: 0.9, vol: 0.12, at: 0.13 });
        tone({ type: 'sine', f0: 3520, dur: 0.5, vol: 0.03, at: 0.13 });
        break;
      case 'playerDie':
        if (e.cause === 'wall' || e.cause === 'pod') {
          electrocute();
        } else if (e.cause === 'barrel') {
          // Caught in the blast: the boom (unless the barrel's own already played), then he powers down.
          if (gate('barrel', 0.2)) barrelBoom(false);
          if (!sample('powerDown', { at: 0.15 })) tone({ type: 'square', f0: 640, f1: 70, dur: 0.85, vol: 0.12, at: 0.15 });
        } else {
          // Shot or caught: the little detective powers down.
          if (sample('powerDown')) break;
          tone({ type: 'square', f0: 640, f1: 70, dur: 0.85, vol: 0.12 });
          noise({ dur: 0.35, vol: 0.18, type: 'lowpass', f0: 1800, f1: 200 });
        }
        break;
      case 'respawn':
        tone({ type: 'triangle', f0: 300, f1: 900, dur: 0.3, vol: 0.09 });
        break;
      case 'gameOver':
        if (sample('saxDown')) break;
        notes([67, 63, 60, 55, 48], { type: 'triangle', step: 0.26, dur: 0.34, vol: 0.14 });
        break;
      case 'pickup':
        if (e.kind === 'key') {
          // A jingle of keys over the bright little arpeggio.
          const jingled = sample('keys');
          notes([76, 81, 88], { type: 'triangle', step: 0.07, dur: 0.14, vol: jingled ? 0.07 : 0.14 });
        } else if (e.kind === 'life') {
          // The bottle clinks, then bubbles.
          const clinked = sample('bottle');
          const v = clinked ? 0.05 : 0.1;
          [0, 1, 2, 3, 4, 5].forEach((i) => tone({ type: 'sine', f0: 380 + i * 95 + (i % 2) * 60, f1: 520 + i * 110, dur: 0.07, vol: v, at: (clinked ? 0.08 : 0) + i * 0.055 }));
        } else if (e.kind === 'mystery') {
          if (sample('question')) break;
          tone({ type: 'sine', f0: 300, f1: 1250, dur: 0.38, vol: 0.12 });
          tone({ type: 'triangle', f0: 1500, f1: 2400, dur: 0.12, vol: 0.05, at: 0.3 });
        }
        break;
      case 'mystery':
        if (e.outcome === 'shadow') {
          tone({ type: 'sawtooth', f0: 110, f1: 55, dur: 1.1, vol: 0.12, filter: 'lowpass', q: { f: 500, q: 2 } });
          tone({ type: 'sawtooth', f0: 116.5, f1: 58, dur: 1.1, vol: 0.1, filter: 'lowpass', q: { f: 500, q: 2 } });
        } else if (e.outcome === 'shield') {
          if (!sample('shield', { at: 0.3 })) notes([72, 79, 84, 91], { type: 'sine', step: 0.06, dur: 0.3, vol: 0.09 });
        } else if (e.outcome === 'freeze') {
          if (!sample('freeze', { at: 0.3 })) notes([96, 91, 88, 84], { type: 'triangle', step: 0.05, dur: 0.2, vol: 0.07 });
        }
        break;
      case 'extraLife':
        if (sample('saxUp', { at: 0.15 })) break;
        notes([72, 76, 79, 84], { type: 'square', step: 0.09, dur: 0.11, vol: 0.07, at: 0.15 });
        [72, 76, 79, 84].forEach((m) => tone({ type: 'triangle', f0: hz(m), dur: 0.6, vol: 0.05, at: 0.53 }));
        break;
      case 'keyUse':
        if (sample('unlock')) break;
        noise({ dur: 0.09, vol: 0.18, type: 'lowpass', f0: 500 });
        tone({ type: 'triangle', f0: 220, f1: 440, dur: 0.18, vol: 0.1, at: 0.05 });
        break;
      case 'doorOpen': // the wall retracts
        if (sample('door', { at: 0.12 })) {
          noise({ dur: 0.08, vol: 0.14, at: 0.62, type: 'lowpass', f0: 380 }); // it settles
          break;
        }
        tone({ type: 'sawtooth', f0: 420, f1: 70, dur: 0.75, vol: 0.09, at: 0.12, filter: 'lowpass', q: { f: 900, q: 1 } });
        noise({ dur: 0.65, vol: 0.08, at: 0.12, type: 'bandpass', f0: 900, f1: 300, q: 1.5 });
        noise({ dur: 0.08, vol: 0.2, at: 0.86, type: 'lowpass', f0: 380 });
        break;
      case 'doorLocked':
        if (sample('locked')) break;
        tone({ type: 'square', f0: 98, dur: 0.3, vol: 0.09 });
        tone({ type: 'square', f0: 103.5, dur: 0.3, vol: 0.07 });
        break;
      case 'podOn':
      case 'podOff':
        tone({ type: 'square', f0: e.type === 'podOn' ? 240 : 180, dur: 0.05, vol: 0.04 });
        break;
      case 'shadowEnter': {
        // A dark swell as he comes through the wall, over a low growl.
        const swelled = sample('shadowSwell');
        tone({ type: 'sawtooth', f0: 55, f1: 41, dur: 1.4, vol: swelled ? 0.11 : 0.16, attack: 0.3, filter: 'lowpass', q: { f: 400, q: 4 } });
        if (!swelled) noise({ dur: 1.2, vol: 0.08, type: 'bandpass', f0: 200, f1: 1600, q: 3, attack: 0.4 });
        break;
      }
      case 'shadowStun':
        if (sample('stun')) break;
        tone({ type: 'square', f0: 900, f1: 180, dur: 0.32, vol: 0.08 });
        tone({ type: 'square', f0: 940, f1: 200, dur: 0.32, vol: 0.06 });
        break;
      case 'shadowHurt':
        if (sample('shadowHurt')) break;
        tone({ type: 'sawtooth', f0: 210, f1: 55, dur: 0.35, vol: 0.14 });
        noise({ dur: 0.25, vol: 0.14, type: 'lowpass', f0: 1400, f1: 200 });
        break;
      case 'shadowDefeat': {
        // A deep boom, then the long dissolve.
        const boomed = sample('shadowDown');
        noise({ dur: 1.8, vol: boomed ? 0.2 : 0.38, type: 'lowpass', f0: 2600, f1: 60, q: 0.8 });
        tone({ type: 'sawtooth', f0: 330, f1: 30, dur: 1.9, vol: boomed ? 0.07 : 0.12 });
        break;
      }
      case 'win': {
        // A sax "case closed", then the bright arpeggio and its chord.
        const sax = sample('saxWin', { at: 0.4 });
        notes([60, 64, 67, 72, 76, 79, 84], { type: 'square', step: 0.11, dur: 0.16, vol: sax ? 0.045 : 0.06, at: 1.2 });
        [60, 67, 72, 76].forEach((m) => tone({ type: 'triangle', f0: hz(m), dur: 1.6, vol: 0.06, at: 2.0 }));
        break;
      }
      case 'zoneEnter':
        [57, 60, 64, 69].forEach((m, i) => tone({ type: 'sawtooth', f0: hz(m), dur: 1.3, vol: 0.035, at: i * 0.04, attack: 0.25, filter: 'lowpass', q: { f: 1400, q: 1 } }));
        break;
      case 'itemsVanish':
        noise({ dur: 0.45, vol: 0.1, type: 'bandpass', f0: 300, f1: 3000, q: 4, attack: 0.3 });
        break;
      case 'roomEnter':
        if (game && e.zone !== undefined) noise({ dur: 0.12, vol: 0.04, type: 'bandpass', f0: 1200, f1: 500, q: 1 });
        break;
      default:
    }
  }

  // A red barrel goes up: bigger than any robot, with its drum clanging away.
  function barrelBoom(chain) {
    if (sample('barrel', { vol: chain ? 0.9 : 1 })) {
      sample('clankHeavy', { at: 0.07, vol: 0.8, rate: 0.7 });
      return;
    }
    noise({ dur: 0.08, vol: 0.3, type: 'highpass', f0: 2000 });
    noise({ dur: 0.95, vol: 0.5, type: 'lowpass', f0: 2600, f1: 80, q: 0.7 });
    tone({ type: 'sine', f0: 120, f1: 28, dur: 0.8, vol: 0.45 });
    tone({ type: 'triangle', f0: 640, f1: 410, dur: 0.25, vol: 0.06, at: 0.07 });
  }

  // Touching the electricity: the loudest thing in the game, on purpose. A hard snap, a
  // deep thump, and a buzzing arc that sizzles for most of a second, with the music
  // dropped out from under it. It hits the master compressor hard rather than raising
  // anything, so the peak stays short and nothing clips.
  const SHOCK = 1;
  function electrocute() {
    hitMusic(0.08, 0.9);
    const v = SHOCK;
    noise({ dur: 0.045, vol: 1.1 * v, type: 'highpass', f0: 1800, attack: 0.001 });
    noise({ dur: 0.16, vol: 0.7 * v, type: 'bandpass', f0: 4200, f1: 1300, q: 0.7, attack: 0.001 });
    tone({ type: 'sine', f0: 105, f1: 34, dur: 0.5, vol: 0.95 * v, attack: 0.002 });
    const arced = sample('shock', { vol: v });
    tone({ type: 'sawtooth', f0: 98, f1: 74, dur: 0.85, vol: (arced ? 0.12 : 0.32) * v, attack: 0.004, filter: 'bandpass', q: { f: 900, q: 0.8 } });
    tone({ type: 'square', f0: 61, f1: 55, dur: 0.8, vol: (arced ? 0.08 : 0.22) * v, attack: 0.004 });
    for (let i = 0; i < 12; i++) {
      const at = 0.03 + i * 0.06 + Math.random() * 0.04;
      noise({ dur: 0.02 + Math.random() * 0.04, vol: (arced ? 0.2 : 0.4) * (0.6 + Math.random() * 0.6) * v, at, type: 'bandpass', f0: 1500 + Math.random() * 5000, q: 1.5, attack: 0.001 });
    }
  }

  function step() {
    walk.alt ^= 1;
    if (sample('step')) return;
    noise({ dur: 0.04, vol: 0.045, type: 'lowpass', f0: walk.alt ? 520 : 680, q: 1.5 });
  }

  function footsteps(game) {
    const p = game.player;
    if (!p) return;
    if (walk.last === null || p.walk < walk.last) walk.last = p.walk;
    const moved = p.walk - walk.last;
    walk.last = p.walk;
    if (!p.moving || moved <= 0 || moved > 1) return;
    walk.acc += moved;
    const stride = p.boost ? 1.05 : 0.8;
    if (walk.acc >= stride) {
      walk.acc = 0;
      step();
    }
  }

  function menuBlip(kind) {
    if (kind === 'move') {
      if (!sample('uiMove')) tone({ type: 'square', f0: 660, dur: 0.035, vol: 0.03 });
    } else if (kind === 'select') {
      if (!sample('uiSelect')) tone({ type: 'square', f0: 880, f1: 1320, dur: 0.07, vol: 0.04 });
    } else if (kind === 'back') {
      if (!sample('uiBack')) tone({ type: 'square', f0: 520, f1: 330, dur: 0.07, vol: 0.04 });
    }
  }

  // ------------------------------------------------------------------ the frame hook

  // The ION-SHIV's whine: silent while it's cool, climbing past 60% heat.
  function heatWhine(game, live) {
    const p = game.player;
    const heat = p && typeof p.heat === 'number' ? p.heat : 0;
    const k = live && soundOn && !(p && p.overheatT > 0) ? Math.max(0, Math.min(1, (heat - 0.6) / 0.4)) : 0;
    setLoop('heat', 0.05 * k * k, buildHeat, 0.06);
    if (loops.heat && loops.heat.osc) loops.heat.osc.frequency.setTargetAtTime(650 + 1100 * k, ctx.currentTime, 0.05);
  }

  function frame(events, game) {
    lastWant = trackFor(game);
    updateMusic(lastWant);
    ms.tempo = game && game.room ? TEMPO[game.room.zone] || TEMPO[1] : TEMPO[0];
    if (musicOn && !paused && synthMusic()) scheduleMusic();

    if (!game || paused) {
      loopsOff();
      shadowNear = false;
      warnNear = false;
      updateMusicGain();
      return;
    }

    if (soundOn) {
      for (const e of events) {
        try {
          play(e, game);
        } catch {
          // One bad sound never stops the game.
        }
      }
    }
    for (const e of events) {
      if (e.type === 'shadowWarn') warnSerial = game.room.serial;
      if (e.type === 'roomEnter') warnSerial = -1;
    }

    const room = game.room;
    const live = game.mode === 'play';
    const shadow = !!game.shadow && game.shadow.state !== 'dying' && game.mode !== 'won';
    const warned = (warnSerial === room.serial || room.warned) && !game.shadow && live;
    setLoop('warn', warned ? 0.28 : 0, buildWarn, 0.08);
    setLoop('drone', shadow ? 0.2 : 0, buildDrone, shadow ? 0.4 : 0.15);
    const pods = room.geo && room.geo.podPosts && room.geo.podPosts.length > 0;
    setLoop('hum', pods && room.podOn && live ? 0.045 : 0, buildHum, 0.06);
    heatWhine(game, live);
    shadowNear = shadow;
    warnNear = warned;
    inLair = !!room.lair;
    updateMusicGain();
    if (soundOn && live) footsteps(game);
  }

  function handle(events, game) {
    if (!ctx || ctx.state !== 'running') return;
    try {
      frame(events, game);
    } catch {
      // Audio trouble never reaches the game loop.
    }
  }

  return {
    unlock,
    handle,
    setPaused(on) {
      paused = !!on;
      if (!ctx) return;
      if (paused) {
        loopsOff();
        quietSoon();
      }
      updateMusicGain();
    },
    setSound(on) {
      soundOn = !!on;
      if (ctx) sfx.gain.setTargetAtTime(soundOn ? SFX_LEVEL : 0, ctx.currentTime, 0.05);
    },
    setMusic(on) {
      musicOn = !!on;
      if (!ctx) return;
      ms.next = ctx.currentTime + 0.1;
      updateMusicGain();
      if (!musicOn) quietSoon();
      else if (!paused) kickMusic(); // a settings change is a gesture, so iOS lets it start
    },
    // A short click for menu moves, so the menus feel alive.
    blip(kind = 'move') {
      if (!ctx || !soundOn || ctx.state !== 'running') return;
      try {
        menuBlip(kind);
      } catch {
        // Ignore: a missing click is harmless.
      }
    },
    // Play one event for the audition page. `engine` is 'auto' (the sample when it's
    // loaded) or 'synth' (the synthesized version). `type` can also be 'step', 'heat'
    // (the heat whine rising), or 'ui:move'.
    preview(type, data = {}, engine = 'auto') {
      if (!ctx) return false;
      force = engine === 'synth' ? 'synth' : null;
      try {
        for (const k of Object.keys(lastPlayed)) delete lastPlayed[k];
        if (type === 'step') step();
        else if (type === 'heat') {
          const { osc } = loop('heat', buildHeat);
          const out = loops.heat.out.gain;
          const now = ctx.currentTime;
          osc.frequency.setValueAtTime(650, now);
          osc.frequency.linearRampToValueAtTime(1750, now + 2);
          out.setValueAtTime(0, now);
          out.linearRampToValueAtTime(0.05, now + 2);
          out.linearRampToValueAtTime(0, now + 2.3);
          loops.heat.level = 0;
        } else if (type.startsWith('ui:')) menuBlip(type.slice(3));
        else play({ type, ...data }, null);
        return true;
      } catch {
        return false;
      } finally {
        force = null;
      }
    },
    // How many sample files have decoded, which failed, which came from audio/local/, and
    // what the music is doing.
    status() {
      return {
        loaded: Object.keys(bufs).length, total: allFiles.length, missing: [...missing], local: [...fromLocal],
        track: lead ? lead.track : null, trackState: lead ? lead.state : 'idle',
        voices: voices.filter((v) => v.state !== 'idle').map((v) => ({ track: v.track, state: v.state, t: v.el ? +v.el.currentTime.toFixed(2) : null })),
        tracksLoaded: Object.keys(urls).filter((k) => urls[k]).length, tracksFailed: Object.keys(urls).filter((k) => urls[k] === false),
      };
    },
    // The music bus level right now, in dBFS (for tests that listen for gaps).
    meter() {
      if (!ctx || !mus) return -200;
      if (!meterNode) {
        meterNode = ctx.createAnalyser();
        meterNode.fftSize = 1024;
        mus.connect(meterNode);
      }
      const buf = new Float32Array(meterNode.fftSize);
      meterNode.getFloatTimeDomainData(buf);
      let s = 0;
      for (const x of buf) s += x * x;
      return 10 * Math.log10(s / buf.length + 1e-20);
    },
    get running() {
      return !!ctx && ctx.state === 'running';
    },
  };
}
