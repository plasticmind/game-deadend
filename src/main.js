// Dead End: boot, the fixed-step loop, and the wiring between the sim, the renderer, and
// the shell (input, HUD, menus, audio, saves, scores). docs/DESIGN.md is the contract.
//
// URL options:
//   ?view=2d    use the Canvas 2D view instead of the Three.js renderer
//   ?debug      expose window.deadEnd (the game, cheats, jump to a room)
//   ?debug&play=1&skill=2&room=40   start a game right away, optionally in a room

import * as sim from './sim/game.js';
import { SKILLS, DEFAULT_SKILL, SHOWN_SKILLS } from './sim/tuning.js';
import { ZONES } from './map.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { createSave } from './save.js';
import * as scores from './scores.js';
import { Debug2D } from './debug2d.js';

const { createGame, stepGame, DT } = sim;
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const MAX_STEPS = 5; // per animation frame
const IDLE = Object.freeze({ x: 0, y: 0, fire: false });

window.__deadEndBooted = true;

const save = createSave();
const osMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false, addEventListener() {} };
const reducedMotion = () => save.settings.motion === 'reduce' || !!osMotion.matches;

let canvas = document.getElementById('view');
const hudRoot = document.getElementById('hud');
const uiRoot = document.getElementById('ui');
const touchRoot = document.getElementById('touch');
const bootEl = document.getElementById('boot');

const run = {
  state: 'title', // 'title' | 'play' | 'paused' | 'map' | 'ending' | 'over'
  game: null, // the player's game
  demo: null, // the calm game behind the title screen
  checkpoint: null, // the deepest checkpoint of this run (what Continue restores)
  lastSkill: shownSkill(save.checkpoint?.skill),
  acc: 0,
  endKind: null,
  endT: 0,
  ended: null, // data for the end screen
};

// A skill the menus offer: a hidden or unknown one becomes the default.
function shownSkill(id) {
  return SHOWN_SKILLS.includes(id) ? id : DEFAULT_SKILL;
}

const pending = []; // events created outside a step (createGame, newLoop, debug jumps)
const frameEvents = [];
let renderer = null;
let renderErrors = 0;

// ------------------------------------------------------------------ shell modules

const audio = createAudio(save.settings);
const input = createInput({ touchRoot, toRoom: (x, y) => renderer?.screenToRoom?.(x, y) ?? null });
const hud = createHud(hudRoot, {
  onButton(which) {
    audio.unlock();
    if (run.state !== 'play') return;
    if (which === 'pause') pause();
    else openMap();
  },
});
const ui = createUI(uiRoot, {
  save,
  audio,
  getGame: () => run.game,
  getCheckpoint: () => run.checkpoint,
  lastSkill: () => run.lastSkill,
  osReducedMotion: () => !!osMotion.matches,
  reducedMotion,
  cleanName: scores.cleanName,
  scoresOnline: () => scores.serviceUrl() !== null,
  refreshScores,
  actions: {
    newGame: (skill) => startGame({ skill }),
    continueSaved: () => continueFrom(save.checkpoint),
    continueRun: () => continueFrom(run.checkpoint || save.checkpoint),
    resume,
    quitToTitle,
    playAgain,
    setSetting,
    submitScore: (name) => submitScore(name, true),
  },
});

input.onAnyInput(() => audio.unlock());
input.onAction((name, source) => {
  if (ui.current) return ui.handle(name, source);
  if (run.state === 'play') {
    if (name === 'pause' || (name === 'back' && source !== 'pad')) {
      pause();
      return true;
    }
    if (name === 'map') {
      openMap();
      return true;
    }
  }
  return false;
});

// ------------------------------------------------------------------ the renderer

function freshCanvas() {
  const c = canvas.cloneNode(false);
  canvas.replaceWith(c);
  canvas = c;
}

function rendererOptions() {
  return { quality: save.settings.quality, reducedMotion: reducedMotion() };
}

async function makeRenderer() {
  if (params.get('view') !== '2d') {
    try {
      const mod = await import('./render/renderer.js');
      return new mod.Renderer(canvas, rendererOptions());
    } catch (err) {
      console.warn('[dead-end] The 3D renderer is unavailable, so this is the 2D view.', err);
      freshCanvas();
    }
  }
  return new Debug2D(canvas, rendererOptions());
}

function fallTo2d(err) {
  console.error('[dead-end] The 3D renderer failed; switching to the 2D view.', err);
  try {
    renderer.dispose?.();
  } catch {
    // ignore
  }
  freshCanvas();
  renderer = new Debug2D(canvas, rendererOptions());
}

function safeRender(game, events, dt) {
  if (!renderer || !game) return;
  try {
    renderer.render(game, events, dt);
    renderErrors = 0;
  } catch (err) {
    renderErrors++;
    if (renderErrors === 1) console.error('[dead-end] render error', err);
    if (renderErrors > 20 && !renderer.is2d) fallTo2d(err);
  }
}

// ------------------------------------------------------------------ settings

function applyMotion() {
  const r = reducedMotion();
  document.documentElement.classList.toggle('reduce-motion', r);
  renderer?.setReducedMotion?.(r);
}

function setSetting(key, value) {
  save.setSetting(key, value);
  if (key === 'sound') audio.setSound(value);
  if (key === 'music') audio.setMusic(value);
  if (key === 'quality') renderer?.setQuality?.(value);
  if (key === 'motion') applyMotion();
}

osMotion.addEventListener?.('change', applyMotion);

// ------------------------------------------------------------------ games

const newSeed = () => (Math.floor(Math.random() * 0x7fffffff) || 1) >>> 0;

// The title screen's backdrop: room 0, robots milling about, no Shadow, nobody dies.
function makeDemo() {
  return createGame({ skill: 0, seed: newSeed(), cheats: { invuln: true, noShadow: true } });
}

function blurFocus() {
  const a = document.activeElement;
  if (a && a !== document.body && typeof a.blur === 'function') a.blur();
}

function enterPlay() {
  run.state = 'play';
  run.acc = 0;
  ui.hide();
  hud.show();
  audio.setPaused(false);
  input.latchFire();
  input.setTouchVisible(true);
  blurFocus();
}

function startGame({ skill = DEFAULT_SKILL, from = null, checkpoint = null }) {
  const g = createGame({ skill, seed: newSeed(), from });
  run.game = g;
  run.lastSkill = skill;
  run.endKind = null;
  run.ended = null;
  pending.push(...g.events);
  run.checkpoint = g.checkpoint || checkpoint || from || null;
  if (g.checkpoint) save.setCheckpoint(g.checkpoint);
  hud.reset();
  const z = ZONES[g.room.zone];
  const opener = SKILLS[skill].autoMap ? 'Find the keys. Keep moving.' : 'Find the keys. Consoles map the lair.';
  hud.moment(z.name.toUpperCase(), from ? 'Back on the case.' : opener, z.color);
  enterPlay();
  return g;
}

// Continue from a checkpoint with the skill's starting lives.
function continueFrom(cp) {
  if (!cp) return startGame({ skill: run.lastSkill });
  // A save from a skill the menus no longer offer carries on at the default.
  const skill = shownSkill(cp.skill);
  return startGame({ skill, from: { ...cp, skill, lives: SKILLS[skill].lives }, checkpoint: cp });
}

function pause() {
  if (run.state !== 'play') return;
  run.state = 'paused';
  audio.setPaused(true);
  input.setTouchVisible(false);
  input.clear();
  ui.show('pause');
}

function openMap() {
  if (run.state !== 'play') return;
  run.state = 'map';
  audio.setPaused(true);
  input.setTouchVisible(false);
  input.clear();
  ui.show('map', { from: 'play' });
}

function resume() {
  if (!run.game || (run.state !== 'paused' && run.state !== 'map')) return;
  enterPlay();
}

function quitToTitle() {
  run.state = 'title';
  run.game = null;
  run.ended = null;
  hud.hide();
  input.setTouchVisible(false);
  audio.setPaused(false);
  if (!run.demo || run.demo.mode !== 'play') run.demo = makeDemo();
  ui.show('title');
}

// After a win: the sim's next loop (harder, same score) when it has one, else a fresh
// game one skill up.
function playAgain() {
  const g = run.game;
  if (g && typeof sim.newLoop === 'function') {
    sim.newLoop(g); // it clears game.events, then re-enters room 0
    pending.push(...g.events);
    run.endKind = null;
    run.ended = null;
    if (g.checkpoint) {
      run.checkpoint = g.checkpoint;
      save.setCheckpoint(g.checkpoint);
    }
    hud.reset();
    const z = ZONES[g.room.zone];
    hud.moment(z.name.toUpperCase(), 'The Shadow is back, and faster.', z.color);
    enterPlay();
    return;
  }
  const now = g ? g.skill : run.lastSkill;
  startGame({ skill: SHOWN_SKILLS.find((id) => id > now) ?? now });
}

// ------------------------------------------------------------------ the end of a game

function beginEnd(kind) {
  if (run.state !== 'play') return;
  run.state = 'ending';
  run.endKind = kind;
  run.endT = kind === 'won' ? 3.2 : 1.8;
  input.setTouchVisible(false);
}

function submitScore(name, typed) {
  const g = run.game;
  if (!g) return Promise.resolve(null);
  const clean = scores.cleanName(name);
  if (typed) save.setInitials(clean);
  const entry = { name: clean, score: Math.floor(g.score), level: g.zoneReached, note: SKILLS[g.skill]?.name ?? '' };
  save.setScores(scores.mergeLocal(save.scores, entry));
  return scores.postScore(entry).then((res) => {
    if (res && res.scores) save.setScores(res.scores);
    return res;
  });
}

function refreshScores() {
  return scores.fetchScores().then((list) => {
    if (list) save.setScores(list);
    return list;
  });
}

function finishEnd() {
  const g = run.game;
  const kind = run.endKind;
  run.state = 'over';
  hud.hide();
  const newBest = save.setBest(g.score);
  if (kind === 'won') save.setCheckpoint(null); // the case is closed
  const autoName = scores.arcadePlayerName();
  const hasScore = g.score > 0;
  const data = {
    kind,
    game: g,
    checkpoint: kind === 'over' ? run.checkpoint || save.checkpoint : null,
    needName: hasScore && !autoName,
    autoName,
    posting: hasScore && autoName ? submitScore(autoName, false) : null,
    newBest,
  };
  run.ended = data;
  ui.show('end', data);
}

// ------------------------------------------------------------------ the loop

function advance(game, dt, inp) {
  run.acc += dt;
  let n = 0;
  while (run.acc >= DT && n < MAX_STEPS) {
    stepGame(game, inp);
    for (const e of game.events) frameEvents.push(e);
    run.acc -= DT;
    n++;
  }
  if (n === MAX_STEPS && run.acc > DT) run.acc = 0; // too far behind: drop the rest
}

function afterEvents(g, events) {
  if (g.checkpoint && g.checkpoint !== run.checkpoint) {
    run.checkpoint = g.checkpoint;
    save.setCheckpoint(g.checkpoint);
  }
  if (run.state === 'play') {
    for (const e of events) {
      if (e.type === 'win') beginEnd('won');
      else if (e.type === 'gameOver') beginEnd('over');
    }
    if (run.state === 'play' && (g.mode === 'won' || g.mode === 'gameover')) beginEnd(g.mode === 'won' ? 'won' : 'over');
  }
  if (run.state === 'ending' && run.endT <= 0) finishEnd();
}

let last = performance.now();
let inPlay = false;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.25) dt = 0.25;
  // The stylesheet shows the aiming crosshair over the room only during play.
  if (inPlay !== (run.state === 'play')) {
    inPlay = run.state === 'play';
    document.documentElement.classList.toggle('in-play', inPlay);
  }

  input.poll(dt);
  frameEvents.length = 0;
  if (pending.length) {
    frameEvents.push(...pending);
    pending.length = 0;
  }

  if (run.state === 'title') {
    let g = run.demo;
    if (!g || g.mode === 'gameover' || g.t > 120) {
      g = run.demo = makeDemo();
      frameEvents.push(...g.events);
    }
    advance(g, dt, IDLE);
    safeRender(g, frameEvents, dt);
    audio.handle(frameEvents, null);
  } else {
    const g = run.game;
    if (run.state === 'play') advance(g, dt, input.read());
    else if (run.state === 'ending') {
      advance(g, dt, IDLE);
      run.endT -= dt;
    }
    const frozen = run.state === 'paused' || run.state === 'map';
    safeRender(g, frameEvents, frozen ? 0 : dt);
    if (run.state === 'play' || run.state === 'ending') {
      audio.handle(frameEvents, g);
      hud.update(g, frameEvents, dt);
      afterEvents(g, frameEvents);
    } else {
      audio.handle(frameEvents, run.state === 'over' ? null : g);
    }
  }
  ui.frame(dt);
}

// ------------------------------------------------------------------ pause when away

window.addEventListener('blur', () => {
  if (run.state === 'play') pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && run.state === 'play') pause();
});
window.addEventListener('resize', () => renderer?.resize?.());

// ------------------------------------------------------------------ debug hooks

function harvest(g, fn) {
  const before = g.events.length;
  const out = fn();
  pending.push(...g.events.slice(before));
  return out;
}

if (DEBUG) {
  window.deadEnd = {
    sim,
    save,
    audio,
    input,
    ui,
    hud,
    get game() {
      return run.game;
    },
    get demo() {
      return run.demo;
    },
    get state() {
      return run.state;
    },
    get screen() {
      return ui.current;
    },
    get renderer() {
      return renderer;
    },
    get checkpoint() {
      return run.checkpoint;
    },
    start: (skill = DEFAULT_SKILL) => startGame({ skill }),
    cheat(name, on = true) {
      const g = run.game;
      if (!g) return null;
      g.cheats = { ...(g.cheats || {}), [name]: on };
      return g.cheats;
    },
    room(id, side = null) {
      const g = run.game;
      if (!g) return null;
      harvest(g, () => sim.enterRoom(g, id, side));
      return g.room.id;
    },
    give(color, n = 1) {
      if (run.game) run.game.keys[color] = (run.game.keys[color] || 0) + n;
    },
    lives(n) {
      if (run.game) run.game.lives = n;
    },
    score(n) {
      if (run.game) run.game.score = n;
    },
    kill(cause = 'wall') {
      const g = run.game;
      if (g) harvest(g, () => sim.killPlayer(g, cause));
    },
    // Skip to the case-closed screen (tests the win flow without the lair fight).
    win() {
      const g = run.game;
      if (!g) return;
      g.mode = 'won';
      pending.push({ type: 'win', score: g.score });
    },
    // Start the Shadow's clock near its warning.
    hurryShadow(secondsBeforeWarn = 0.2) {
      const r = run.game?.room;
      if (r) r.t = Math.max(0, r.warnAt - secondsBeforeWarn);
    },
  };
}

// ------------------------------------------------------------------ boot

async function boot() {
  applyMotion();
  run.demo = makeDemo();
  pending.push(...run.demo.events);
  hud.hide();
  input.setTouchVisible(false);
  ui.show('title');
  if (bootEl) bootEl.hidden = true;
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
  refreshScores().catch(() => {});

  renderer = await makeRenderer();
  renderer.setReducedMotion?.(reducedMotion());
  renderer.resize?.();

  if (DEBUG && params.has('play')) {
    const skill = Math.max(0, Math.min(SKILLS.length - 1, Number(params.get('skill') ?? DEFAULT_SKILL) || 0));
    startGame({ skill });
    if (params.has('room')) window.deadEnd.room(Number(params.get('room')));
  }
}

boot().catch((err) => {
  console.error('[dead-end] boot failed', err);
  if (bootEl) {
    bootEl.hidden = false;
    bootEl.textContent = 'Dead End could not start. Reload the page to try again.';
  }
});
