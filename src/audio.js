// Dead End's sound. One-shot effects come from sim events and play recorded samples
// (audio/sfx/, all CC0) where a recording beats the synth; everything else, and every
// sample that hasn't loaded yet or failed to load, is synthesized with WebAudio. Loops come
// from state: the Shadow's low pulsing warning, his drone while he is in the room, the pod
// gate hum, and footsteps. Music is CC0 jazz streamed from audio/music/ through one <audio>
// element: a title track, a track per sector that rotates as you play, and a tenser loop
// in the Shadow's lair. If a track can't play, a procedural noir loop (a walking bass
// under brushed hi-hats) takes over. audio/CREDITS.md lists every file.
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
const DUCK = 0.3; // music level under the Shadow's warning and while he is in the room
const DUCK_LAIR = 0.6; // he is always there in the lair, so its track only dips
const FADE = 0.8; // seconds to fade out a track before the next one starts
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
  rpg: kenney('RPG Audio', 'rpg-audio'),
  jingles: kenney('Music Jingles', 'music-jingles'),
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
  clankHeavy: { files: ['clank-heavy-1', 'clank-heavy-2'], from: 'impact', orig: 'impactPlate_heavy_001, _003', use: 'Armor down to its last hit (foeHit, hp 1); armored wrecks (foeDie)', vol: 0.204, vary: 0.05 },
  boom: { files: ['boom-1', 'boom-2', 'boom-3'], from: 'scifi', orig: 'explosionCrunch_000, _001, _003', use: 'A robot blows up (foeDie)', vol: 0.32, vary: 0.05 },
  zap: { files: ['zap'], from: 'digital', orig: 'zap2', use: 'Shamus touches an electric wall or a lit pod gate (playerDie)', vol: 0.075 },
  powerDown: { files: ['power-down'], from: 'digital', orig: 'lowDown', use: 'Shamus is shot or caught (playerDie)', vol: 0.129 },
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

// Music in audio/music/. `loop` tracks repeat until the scene changes; sector tracks play
// `repeat` times, then the next sector's track takes over, so a long stay doesn't wear one out.
export const TRACKS = {
  title: { file: 'title', title: 'Moil', author: 'Ruskerdax', license: CC0, url: 'https://opengameart.org/content/moil', use: 'Title screen, menus, and end screens', loop: true },
  'sector-1': { file: 'sector-1', title: 'Investigation', author: 'Umplix', license: CC0, url: 'https://opengameart.org/content/investigation-0', use: 'Black Sector', repeat: 2 },
  'sector-2': { file: 'sector-2', title: 'jazz (saxaphone)', author: 'Alex McCulloch (Pro Sensory)', license: CC0, url: 'https://opengameart.org/content/jazz-saxaphone', use: 'Blue Sector', repeat: 1 },
  'sector-3': { file: 'sector-3', title: 'Jazz', author: 'Umplix', license: CC0, url: 'https://opengameart.org/content/jazz-2', use: 'Green Sector', repeat: 1 },
  'sector-4': { file: 'sector-4', title: 'Sneaking into the Robot Factory', author: 'Umplix', license: CC0, url: 'https://opengameart.org/content/sneaky-music-pack', use: 'Red Sector', repeat: 2 },
  lair: { file: 'lair', title: 'Spy Loop', author: 'wipics', license: CC0, url: 'https://opengameart.org/content/spy-loop', use: "The Shadow's lair (room 127)", loop: true },
};
const ROTATION = ['sector-1', 'sector-2', 'sector-3', 'sector-4'];

// Relative to this module, because the game is served from /game-deadend/, not the root.
export const sfxUrl = (file) => new URL(`../audio/sfx/${file}.mp3`, import.meta.url).href;
export const musicUrl = (file) => new URL(`../audio/music/${file}.mp3`, import.meta.url).href;

// ------------------------------------------------------------------ the engine

export function createAudio({ sound = true, music = true, context = null } = {}) {
  let ctx = null;
  let master = null;
  let sfx = null;
  let mus = null;
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
  if (typeof fetch === 'function') {
    for (const f of allFiles) {
      raw[f] = fetch(sfxUrl(f))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
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
      mus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      ms.next = ctx.currentTime + 0.1;
      decodeAll();
      makeDeck();
    }
    if (ctx.state === 'suspended' && !context) ctx.resume().catch(() => {});
    // iOS lets a media element start only from a tap or key: start (or retry) it here.
    if (deck.el && musicOn && !paused && (deck.blocked || !deck.name)) startDeck();
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
      g.gain.value = def.vol * vol;
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
      build(out);
      loops[name] = { out, level: 0 };
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

  function loopsOff() {
    for (const name of Object.keys(loops)) setLoop(name, 0);
  }

  // ------------------------------------------------------------------ music tracks

  // One <audio> element streams the current track into the music bus through Web Audio, so
  // the music setting, pausing, and ducking all work on one gain node. A track change fades
  // the old track out, swaps the source, and fades the new one in.
  const deck = { el: null, gain: null, name: null, state: 'idle', fadeUntil: 0, pending: false, blocked: false, quietSince: 0 };
  const failed = {};
  let lastWant = 'title';
  const rot = { zone: 0, idx: 0, plays: 0 };

  function makeDeck() {
    if (deck.el || context || typeof Audio === 'undefined' || typeof ctx.createMediaElementSource !== 'function') return;
    try {
      const el = new Audio();
      el.preload = 'auto';
      const node = ctx.createMediaElementSource(el);
      deck.gain = ctx.createGain();
      deck.gain.gain.value = 0;
      node.connect(deck.gain).connect(mus);
      el.addEventListener('playing', () => {
        deck.state = 'playing';
        deck.gain.gain.setTargetAtTime(TRACK_LEVEL, ctx.currentTime, 0.3);
      });
      el.addEventListener('error', () => {
        if (deck.name) failed[deck.name] = true;
        deck.state = 'failed';
      });
      el.addEventListener('ended', onEnded);
      deck.el = el;
    } catch {
      deck.el = null;
    }
  }

  function load(name) {
    deck.name = name;
    deck.fadeUntil = 0;
    deck.gain.gain.cancelScheduledValues(ctx.currentTime);
    deck.gain.gain.setValueAtTime(0, ctx.currentTime);
    if (!name) {
      deck.el.pause();
      deck.state = 'idle';
      return;
    }
    if (failed[name]) {
      deck.el.pause();
      deck.state = 'failed';
      return;
    }
    deck.state = 'loading';
    deck.el.loop = !!TRACKS[name].loop;
    deck.el.src = musicUrl(TRACKS[name].file);
  }

  function playDeck() {
    if (!deck.el || deck.pending || deck.state === 'failed' || deck.state === 'idle' || deck.state === 'ended') return;
    let p;
    try {
      p = deck.el.play();
    } catch {
      return;
    }
    if (!p || typeof p.then !== 'function') return;
    deck.pending = true;
    p.then(
      () => {
        deck.pending = false;
      },
      (err) => {
        deck.pending = false;
        const why = err && err.name;
        if (why === 'NotAllowedError') deck.blocked = true; // wait for the next tap or key
        else if (why === 'NotSupportedError') {
          if (deck.name) failed[deck.name] = true;
          deck.state = 'failed';
        }
      },
    );
  }

  // Load the track the game wants (if nothing is loaded) and play it. Called from a tap,
  // key, or settings change, so it counts as a user gesture on iOS.
  function startDeck() {
    if (!deck.name) load(lastWant);
    deck.blocked = false;
    playDeck();
  }

  // Stop streaming once the music bus has faded out. Timers still run in a hidden tab,
  // where the frame hook doesn't.
  function quietDeckSoon() {
    setTimeout(() => {
      if (deck.el && (paused || !musicOn)) deck.el.pause();
    }, 900);
  }

  // A sector track finished: play it again, or hand over to the next sector's track.
  function onEnded() {
    const t = TRACKS[deck.name];
    if (!t || t.loop) return;
    rot.plays++;
    if (rot.plays < (t.repeat || 1)) {
      try {
        deck.el.currentTime = 0;
      } catch {
        // A stream that can't seek starts over from the next load.
      }
      playDeck();
    } else {
      rot.idx++;
      rot.plays = 0;
      deck.state = 'ended';
    }
  }

  // Which track this moment calls for.
  function trackFor(game) {
    if (!game || !game.room || game.mode === 'won' || game.mode === 'gameover') {
      rot.zone = 0;
      return 'title';
    }
    if (game.room.lair) return 'lair';
    const zone = game.room.zone || 1;
    if (zone !== rot.zone) {
      rot.zone = zone;
      rot.idx = zone - 1;
      rot.plays = 0;
    }
    return ROTATION[rot.idx % ROTATION.length];
  }

  function updateDeck(want) {
    if (!deck.el) return;
    const now = ctx.currentTime;
    const live = musicOn && !paused;
    if (want !== deck.name) {
      const audible = deck.state === 'playing' && !deck.el.paused && live;
      if (audible && !deck.fadeUntil) {
        deck.gain.gain.setTargetAtTime(0, now, FADE / 5);
        deck.fadeUntil = now + FADE;
      }
      if (audible && now < deck.fadeUntil) return;
      load(want);
      if (live) playDeck();
      return;
    }
    if (live) {
      deck.quietSince = 0;
      if (deck.el.paused && !deck.blocked) playDeck();
    } else if (!deck.el.paused) {
      // Let the music bus fade first, then stop streaming.
      if (!deck.quietSince) deck.quietSince = now;
      else if (now - deck.quietSince > 0.8) deck.el.pause();
    }
  }

  // The procedural loop plays only when there is no track to stream.
  const synthMusic = () => !deck.el || deck.state === 'failed';

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

  // The music bus: off, paused, or ducked under the Shadow so his warning always reads.
  let busLevel = -1;
  function updateMusicGain() {
    if (!ctx) return;
    const duck = shadowNear || warnNear ? (inLair ? DUCK_LAIR : DUCK) : 1;
    const level = musicOn && !paused ? MUSIC_LEVEL * duck : 0;
    if (Math.abs(level - busLevel) < 1e-4) return;
    const tc = level < busLevel ? 0.12 : 0.5; // duck fast, come back slowly
    busLevel = level;
    mus.gain.setTargetAtTime(level, ctx.currentTime, tc);
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
        const chain = !!e.chain;
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
      case 'roomClear':
        tone({ type: 'sine', f0: 1318.5, dur: 0.7, vol: 0.12 });
        tone({ type: 'sine', f0: 2637, dur: 0.4, vol: 0.03 });
        tone({ type: 'sine', f0: 1760, dur: 0.9, vol: 0.12, at: 0.13 });
        tone({ type: 'sine', f0: 3520, dur: 0.5, vol: 0.03, at: 0.13 });
        break;
      case 'playerDie':
        if (e.cause === 'wall' || e.cause === 'pod') {
          // The electric wall: a crackling zap.
          if (sample('zap')) break;
          noise({ dur: 0.55, vol: 0.28, type: 'bandpass', f0: 3200, f1: 900, q: 2.5 });
          for (let i = 0; i < 6; i++) tone({ type: 'sawtooth', f0: 90 + ((i * 53) % 70), f1: 60, dur: 0.07, vol: 0.12, at: i * 0.075 });
          tone({ type: 'square', f0: 1800, f1: 120, dur: 0.6, vol: 0.06 });
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

  function frame(events, game) {
    lastWant = trackFor(game);
    updateDeck(lastWant);
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
        quietDeckSoon();
      }
      updateMusicGain();
    },
    setSound(on) {
      soundOn = !!on;
      if (ctx) sfx.gain.setTargetAtTime(soundOn ? SFX_LEVEL : 0, ctx.currentTime, 0.05);
    },
    setMusic(on) {
      musicOn = !!on;
      if (ctx) {
        ms.next = ctx.currentTime + 0.1;
        updateMusicGain();
        if (!deck.el) return;
        if (!musicOn) quietDeckSoon();
        else if (!paused && deck.el.paused) startDeck();
      }
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
    // loaded) or 'synth' (the synthesized version). `type` can also be 'step' or 'ui:move'.
    preview(type, data = {}, engine = 'auto') {
      if (!ctx) return false;
      force = engine === 'synth' ? 'synth' : null;
      try {
        for (const k of Object.keys(lastPlayed)) delete lastPlayed[k];
        if (type === 'step') step();
        else if (type.startsWith('ui:')) menuBlip(type.slice(3));
        else play({ type, ...data }, null);
        return true;
      } catch {
        return false;
      } finally {
        force = null;
      }
    },
    // How many sample files have decoded, and which failed.
    status() {
      return { loaded: Object.keys(bufs).length, total: allFiles.length, missing: [...missing], track: deck.name, trackState: deck.state };
    },
    get running() {
      return !!ctx && ctx.state === 'running';
    },
  };
}
