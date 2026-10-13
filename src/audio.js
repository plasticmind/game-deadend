// Every sound in Dead End is synthesized with WebAudio: no files. One-shot effects come
// from sim events; loops come from state (the Shadow's low pulsing warning, his drone
// while he is in the room, the pod gate hum, footsteps). A light procedural noir loop,
// a walking bass under brushed hi-hats, speeds up sector by sector.
//
//   const audio = createAudio(settings);
//   audio.unlock();                 // on the first key, tap, or button (browser rule)
//   audio.handle(events, game);     // every frame; game null on the title screen
//   audio.setPaused(bool); audio.setSound(bool); audio.setMusic(bool);

const MASTER = 0.42; // modest: these play on family laptops and TVs
const SFX_LEVEL = 0.9;
const MUSIC_LEVEL = 0.5;
const TEMPO = [84, 96, 106, 118, 132]; // title, then by sector

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

export function createAudio({ sound = true, music = true } = {}) {
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
  const ms = { next: 0, step: 0, tempo: TEMPO[0] };
  const walk = { last: null, acc: 0, alt: 0 };
  let warnSerial = -1;
  let shadowNear = false;

  // ------------------------------------------------------------------ setup

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ctx = new AC();
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
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  // Throttle a sound so a burst of identical events doesn't stack into a roar.
  function gate(name, gap) {
    const now = ctx.currentTime;
    if (lastPlayed[name] && now - lastPlayed[name] < gap) return false;
    lastPlayed[name] = now;
    return true;
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

  // ------------------------------------------------------------------ music

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

  function updateMusicGain() {
    if (!ctx) return;
    const level = musicOn && !paused ? (shadowNear ? MUSIC_LEVEL * 0.35 : MUSIC_LEVEL) : 0;
    mus.gain.setTargetAtTime(level, ctx.currentTime, 0.25);
  }

  // ------------------------------------------------------------------ one-shots

  function play(e, game) {
    switch (e.type) {
      case 'fire': // the ION-SHIV
        tone({ type: 'square', f0: 1900, f1: 520, dur: 0.09, vol: 0.09 });
        tone({ type: 'sawtooth', f0: 2600, f1: 1100, dur: 0.05, vol: 0.04 });
        break;
      case 'boltFire':
        if (!gate('bolt', 0.05)) break;
        tone({ type: 'sawtooth', f0: (e.from || e.foe) === 'warden' ? 420 : 560, f1: 170, dur: 0.15, vol: 0.07, filter: 'bandpass', q: { f: 900, q: 1.2 } });
        break;
      case 'shotHit':
        if (!gate('hit', 0.03)) break;
        if (e.what === 'bolt') tone({ type: 'triangle', f0: 1300, f1: 2600, dur: 0.07, vol: 0.08 });
        else if (e.what === 'lock' || e.what === 'pod') tone({ type: 'square', f0: 140, dur: 0.08, vol: 0.05 });
        else noise({ dur: 0.04, vol: 0.06, type: 'highpass', f0: 2800 });
        break;
      case 'boltHit':
        if (!gate('boltHit', 0.05)) break;
        if (e.what === 'shield') tone({ type: 'sine', f0: 1600, f1: 2200, dur: 0.08, vol: 0.06 });
        else if (e.what !== 'freeze') noise({ dur: 0.05, vol: 0.04, type: 'bandpass', f0: 1800, q: 2 });
        break;
      case 'foeHop': // a Snap-Jumper springs
        if (!gate('hop', 0.08)) break;
        tone({ type: 'triangle', f0: 200, f1: 560, dur: 0.13, vol: 0.06 });
        break;
      case 'shadowBlink':
        noise({ dur: 0.28, vol: 0.08, type: 'bandpass', f0: 700, f1: 2600, q: 3, attack: 0.08 });
        break;
      case 'foeHit': // armor takes it
        tone({ type: 'triangle', f0: 980, f1: 620, dur: 0.1, vol: 0.12 });
        tone({ type: 'square', f0: 1480, dur: 0.05, vol: 0.04 });
        break;
      case 'foeDie': {
        const chain = !!e.chain;
        const at = chain ? 0.05 : 0;
        if (!gate(chain ? 'boomChain' : 'boom', 0.04)) break;
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
          noise({ dur: 0.55, vol: 0.28, type: 'bandpass', f0: 3200, f1: 900, q: 2.5 });
          for (let i = 0; i < 6; i++) tone({ type: 'sawtooth', f0: 90 + ((i * 53) % 70), f1: 60, dur: 0.07, vol: 0.12, at: i * 0.075 });
          tone({ type: 'square', f0: 1800, f1: 120, dur: 0.6, vol: 0.06 });
        } else {
          tone({ type: 'square', f0: 640, f1: 70, dur: 0.85, vol: 0.12 });
          noise({ dur: 0.35, vol: 0.18, type: 'lowpass', f0: 1800, f1: 200 });
        }
        break;
      case 'respawn':
        tone({ type: 'triangle', f0: 300, f1: 900, dur: 0.3, vol: 0.09 });
        break;
      case 'gameOver':
        notes([67, 63, 60, 55, 48], { type: 'triangle', step: 0.26, dur: 0.34, vol: 0.14 });
        break;
      case 'pickup':
        if (e.kind === 'key') notes([76, 81, 88], { type: 'triangle', step: 0.07, dur: 0.14, vol: 0.14 });
        else if (e.kind === 'life') [0, 1, 2, 3, 4, 5].forEach((i) => tone({ type: 'sine', f0: 380 + i * 95 + (i % 2) * 60, f1: 520 + i * 110, dur: 0.07, vol: 0.1, at: i * 0.055 }));
        else if (e.kind === 'mystery') {
          tone({ type: 'sine', f0: 300, f1: 1250, dur: 0.38, vol: 0.12 });
          tone({ type: 'triangle', f0: 1500, f1: 2400, dur: 0.12, vol: 0.05, at: 0.3 });
        }
        break;
      case 'mystery':
        if (e.outcome === 'shadow') {
          tone({ type: 'sawtooth', f0: 110, f1: 55, dur: 1.1, vol: 0.12, filter: 'lowpass', q: { f: 500, q: 2 } });
          tone({ type: 'sawtooth', f0: 116.5, f1: 58, dur: 1.1, vol: 0.1, filter: 'lowpass', q: { f: 500, q: 2 } });
        } else if (e.outcome === 'shield') notes([72, 79, 84, 91], { type: 'sine', step: 0.06, dur: 0.3, vol: 0.09 });
        else if (e.outcome === 'freeze') notes([96, 91, 88, 84], { type: 'triangle', step: 0.05, dur: 0.2, vol: 0.07 });
        break;
      case 'extraLife':
        notes([72, 76, 79, 84], { type: 'square', step: 0.09, dur: 0.11, vol: 0.07, at: 0.15 });
        [72, 76, 79, 84].forEach((m) => tone({ type: 'triangle', f0: hz(m), dur: 0.6, vol: 0.05, at: 0.53 }));
        break;
      case 'keyUse':
        noise({ dur: 0.09, vol: 0.18, type: 'lowpass', f0: 500 });
        tone({ type: 'triangle', f0: 220, f1: 440, dur: 0.18, vol: 0.1, at: 0.05 });
        break;
      case 'doorOpen': // the wall retracts
        tone({ type: 'sawtooth', f0: 420, f1: 70, dur: 0.75, vol: 0.09, at: 0.12, filter: 'lowpass', q: { f: 900, q: 1 } });
        noise({ dur: 0.65, vol: 0.08, at: 0.12, type: 'bandpass', f0: 900, f1: 300, q: 1.5 });
        noise({ dur: 0.08, vol: 0.2, at: 0.86, type: 'lowpass', f0: 380 });
        break;
      case 'doorLocked':
        tone({ type: 'square', f0: 98, dur: 0.3, vol: 0.09 });
        tone({ type: 'square', f0: 103.5, dur: 0.3, vol: 0.07 });
        break;
      case 'podOn':
      case 'podOff':
        tone({ type: 'square', f0: e.type === 'podOn' ? 240 : 180, dur: 0.05, vol: 0.04 });
        break;
      case 'shadowEnter':
        tone({ type: 'sawtooth', f0: 55, f1: 41, dur: 1.4, vol: 0.16, attack: 0.3, filter: 'lowpass', q: { f: 400, q: 4 } });
        noise({ dur: 1.2, vol: 0.08, type: 'bandpass', f0: 200, f1: 1600, q: 3, attack: 0.4 });
        break;
      case 'shadowStun':
        tone({ type: 'square', f0: 900, f1: 180, dur: 0.32, vol: 0.08 });
        tone({ type: 'square', f0: 940, f1: 200, dur: 0.32, vol: 0.06 });
        break;
      case 'shadowHurt':
        tone({ type: 'sawtooth', f0: 210, f1: 55, dur: 0.35, vol: 0.14 });
        noise({ dur: 0.25, vol: 0.14, type: 'lowpass', f0: 1400, f1: 200 });
        break;
      case 'shadowDefeat':
        noise({ dur: 1.8, vol: 0.38, type: 'lowpass', f0: 2600, f1: 60, q: 0.8 });
        tone({ type: 'sawtooth', f0: 330, f1: 30, dur: 1.9, vol: 0.12 });
        break;
      case 'win':
        notes([60, 64, 67, 72, 76, 79, 84], { type: 'square', step: 0.11, dur: 0.16, vol: 0.06, at: 1.2 });
        [60, 67, 72, 76].forEach((m) => tone({ type: 'triangle', f0: hz(m), dur: 1.6, vol: 0.06, at: 2.0 }));
        break;
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
      walk.alt ^= 1;
      noise({ dur: 0.04, vol: 0.045, type: 'lowpass', f0: walk.alt ? 520 : 680, q: 1.5 });
    }
  }

  // ------------------------------------------------------------------ the frame hook

  function handle(events, game) {
    if (!ctx || ctx.state !== 'running') return;
    ms.tempo = game && game.room ? TEMPO[game.room.zone] || TEMPO[1] : TEMPO[0];
    if (musicOn && !paused) scheduleMusic();

    if (!game || paused) {
      loopsOff();
      if (shadowNear) {
        shadowNear = false;
        updateMusicGain();
      }
      return;
    }

    if (soundOn) for (const e of events) play(e, game);
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
    if (shadow !== shadowNear) {
      shadowNear = shadow;
      updateMusicGain();
    }
    if (soundOn && live) footsteps(game);
  }

  return {
    unlock,
    handle,
    setPaused(on) {
      paused = !!on;
      if (!ctx) return;
      if (paused) loopsOff();
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
      }
    },
    // A short click for menu moves, so the menus feel alive.
    blip(kind = 'move') {
      if (!ctx || !soundOn || ctx.state !== 'running') return;
      if (kind === 'move') tone({ type: 'square', f0: 660, dur: 0.035, vol: 0.03 });
      else if (kind === 'select') tone({ type: 'square', f0: 880, f1: 1320, dur: 0.07, vol: 0.04 });
      else if (kind === 'back') tone({ type: 'square', f0: 520, f1: 330, dur: 0.07, vol: 0.04 });
    },
    get running() {
      return !!ctx && ctx.state === 'running';
    },
  };
}
