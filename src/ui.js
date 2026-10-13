// Menus and screens, in the DOM over the live scene: title, new case (skill), how to
// play, high scores, settings, credits, pause, map, game over, and case closed. Screens
// stack (settings opened from pause returns to pause). Everything works with a mouse,
// a touch screen, the keyboard (arrows move, Enter or Space selects, Esc goes back), and
// a gamepad (stick or d-pad moves, A selects, B goes back). Arrows move focus spatially,
// so lists, grids, and the letter picker all navigate the same way.

import { SKILLS } from './sim/tuning.js';
import { ZONES, KEY_COLORS } from './map.js';
import * as icons from './icons.js';
import { drawAutomap, mapSize, mapWindow, roomCenter, mapStats } from './automap.js';

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [data-nav]';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Small DOM builder. `html` is only ever given trusted icon markup.
function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export const fmtScore = (n) => Math.floor(n || 0).toLocaleString('en-US');
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
const zoneName = (z) => (ZONES[z] ? ZONES[z].name : 'Black Sector');

// ctx: { save, audio, actions, getGame, osReducedMotion, reducedMotion }
export function createUI(root, ctx) {
  const { save, audio, actions } = ctx;
  const stack = []; // { name, data, screen }
  let shownAt = 0;
  let clock = 0;
  let mapZoomed = false; // remembered between visits to the map

  // ------------------------------------------------------------------ building blocks

  // A keyboard "click" only counts when Enter or Space went down on that same control and
  // wasn't auto-repeat. Space clicks on key-up, so without this, letting go of fire after
  // pausing would press Resume. Pointer and gamepad clicks always count. End screens also
  // ignore anything in their first moments, while fingers are still on the fire button.
  let keyDown = { target: null, repeat: false };
  let padClick = false;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      keyDown = { target: e.target, repeat: e.repeat };
      if (e.repeat && stack.length) e.preventDefault();
    },
    true,
  );

  function guardOk(top, e, node) {
    if (performance.now() - shownAt < (top?.screen.guard ?? 0)) return false;
    if (!e || padClick || e.detail !== 0) return true;
    return keyDown.target === node && !keyDown.repeat;
  }

  function btn(label, onClick, { sub = null, cls = '', id = null, attrs = {} } = {}) {
    const b = h(
      'button',
      { type: 'button', class: `menu-btn ${cls}`.trim(), 'data-id': id, ...attrs },
      h('span', { class: 'menu-btn-label' }, label),
      sub ? h('span', { class: 'menu-btn-sub' }, sub) : null,
    );
    b.addEventListener('click', (e) => {
      if (!guardOk(stack.at(-1), e, b)) return;
      audio.blip('select');
      onClick(e);
    });
    hoverFocus(b);
    return b;
  }

  // Console-style menus: pointing at an item selects it.
  function hoverFocus(node) {
    node.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && document.activeElement !== node) node.focus({ preventScroll: true });
    });
  }

  function card(name, title, ...kids) {
    return h(
      'section',
      { class: `screen screen-${name}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `h-${name}` },
      h('div', { class: 'screen-card' }, h('h2', { class: 'screen-title', id: `h-${name}` }, title), ...kids),
    );
  }

  // ------------------------------------------------------------------ screens

  const screens = {
    title() {
      const cp = save.checkpoint;
      const items = [];
      if (cp) {
        const sk = SKILLS[cp.skill] ? SKILLS[cp.skill].name : '';
        items.push(btn('Continue', () => actions.continueSaved(), { id: 'continue', sub: `${zoneName(cp.zoneReached)} · ${sk} · ${fmtScore(cp.score)} pts` }));
      }
      items.push(
        btn('New case', () => push('skill'), { id: 'new' }),
        btn('How to play', () => push('howto'), { id: 'howto' }),
        btn('High scores', () => push('scores'), { id: 'scores' }),
        btn('Settings', () => push('settings'), { id: 'settings' }),
        btn('Credits', () => push('credits'), { id: 'credits' }),
      );
      const arcade = h('a', { class: 'menu-btn menu-link', href: '../', 'data-id': 'arcade' }, h('span', { class: 'menu-btn-label' }, '← Back to the arcade'));
      hoverFocus(arcade);
      items.push(arcade);
      const el = h(
        'section',
        { class: 'screen screen-title-page', 'aria-labelledby': 'logo' },
        h(
          'div',
          { class: 'title-wrap' },
          h('h1', { class: 'logo', id: 'logo', 'aria-label': 'Dead End' }, h('span', { class: 'logo-dead', 'aria-hidden': 'true' }, 'DEAD'), h('span', { class: 'logo-bolt', 'aria-hidden': 'true' }), h('span', { class: 'logo-end', 'aria-hidden': 'true' }, 'END')),
          h('p', { class: 'tagline' }, 'A robot detective. The Shadow’s lair. 128 rooms of electric walls.'),
          h('nav', { class: 'menu', 'aria-label': 'Main menu' }, items),
          h('p', { class: save.best > 0 ? 'title-foot' : 'title-foot is-hint' }, save.best > 0 ? `Your best on this device: ${fmtScore(save.best)}` : 'Arrows or stick to choose · Enter, Space, or A to select'),
        ),
      );
      return { el, focus: cp ? 'continue' : 'new', onBack: () => true };
    },

    skill() {
      const cp = save.checkpoint;
      const last = Number.isInteger(ctx.lastSkill?.()) ? ctx.lastSkill() : 1;
      const list = SKILLS.map((sk) =>
        btn(sk.name, () => actions.newGame(sk.id), {
          id: `skill-${sk.id}`,
          cls: 'skill-btn',
          sub: /lives/.test(sk.blurb) ? `${sk.blurb}.` : `${sk.blurb}. ${sk.lives} lives.`,
        }),
      );
      const note =
        cp && cp.zoneReached > 1
          ? h('p', { class: 'note' }, `Starting a new case replaces your saved one in ${zoneName(cp.zoneReached)}.`)
          : null;
      const el = card(
        'skill',
        'New case',
        h('p', { class: 'lede' }, 'How hard does the Shadow push back? Each level is substantially harder than the last.'),
        h('div', { class: 'menu menu-skills' }, list),
        note,
        h('div', { class: 'menu menu-foot' }, btn('Back', () => back(), { id: 'back', cls: 'menu-back' })),
      );
      return { el, focus: `skill-${last}` };
    },

    howto() {
      const row = (what, kb, pad, touch) => h('tr', {}, h('th', { scope: 'row' }, what), h('td', {}, kb), h('td', {}, pad), h('td', {}, touch));
      const cast = [
        [icons.keyhole('#33dd66'), 'Keyhole', 'Touch it while you carry a key of its color and its locked door opens for good.'],
        [icons.key('#3d8bff'), 'Key', 'Pick it up. It stays in your pocket until you use it on a keyhole of the same color.'],
        [icons.mystery(), 'Mystery', 'Bonus or disaster: points, a life, a shield, frozen robots, or the Shadow himself.'],
        [icons.life(), 'Extra life', 'A bubbling bottle. Touch it for one more life.'],
        [icons.droid(), 'Robo-Droid', 'Walks the grid and fires along the eight directions when you line up with it.'],
        [icons.drone(), 'Whirling Drone', 'Spirals in on you. It never fires, but touching it is fatal.'],
        [icons.jumper(), 'Snap-Jumper', 'Crouches, then hops at you. From Blue Sector on it zaps after it lands.'],
        [icons.sniffer(), 'Sniffer', 'Follows your trail. Its armored front takes two hits. Blue Sector and deeper.'],
        [icons.warden(), 'Warden', 'A turret that stays put and fires bursts down eight lines. Green Sector and deeper.'],
        [icons.shadow(), 'The Shadow', 'Linger and he comes through the walls. You can’t kill him, only stun him with a shot. Leave the room.'],
      ];
      const body = h(
        'div',
        { class: 'screen-body scrolls', tabindex: '-1' },
        h('h3', {}, 'Controls'),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'controls' },
            h('thead', {}, h('tr', {}, h('td', {}), h('th', { scope: 'col' }, 'Keyboard'), h('th', { scope: 'col' }, 'Gamepad'), h('th', { scope: 'col' }, 'Touch'))),
            h(
              'tbody',
              {},
              row('Move', 'Arrows or WASD', 'Stick or d-pad', 'Left thumb'),
              row('Fire', 'Space, J, Z, or Enter', 'A or X', 'FIRE button'),
              row('Aim and shoot', 'Hold fire, press a direction', 'Hold A, push the stick', 'Hold FIRE, move the stick'),
              row('Pause', 'Esc or P', 'Start', 'Pause button'),
              row('Map', 'M or Tab', 'Back or Select', 'Map button'),
            ),
          ),
        ),
        h('h3', {}, 'Shooting, the Shamus way'),
        h(
          'p',
          {},
          'Shamus can’t walk and shoot at the same time. Hold fire and he plants his feet. Push a direction while you hold it and he fires that way, in any of eight directions. Let go of fire to walk again. Only two ION-SHIVs fly at once.',
        ),
        h('h3', {}, 'Things you meet'),
        h(
          'ul',
          { class: 'cast' },
          cast.map(([icon, name, note]) => h('li', {}, h('span', { class: 'cast-icon', html: icon }), h('span', { class: 'cast-text' }, h('strong', {}, name), h('span', {}, note)))),
        ),
        h('h3', {}, 'Staying alive'),
        h(
          'ul',
          { class: 'tips' },
          h('li', {}, 'Electric walls kill on touch. So do yellow pod gates while they’re lit: wait for them to drop.'),
          h('li', {}, 'Robots come back every time you enter a room. Clear them all and Shamus runs faster in that room.'),
          h('li', {}, 'A low pulsing sound means the Shadow is coming. Get to a door.'),
          h('li', {}, 'The map shows every room you’ve found, locked doors, and items you left behind.'),
          h('li', {}, 'Reaching a new sector saves a checkpoint. Continue from it after a game over.'),
        ),
      );
      const el = card('howto', 'How to play', body, h('div', { class: 'menu menu-foot' }, btn('Back', () => back(), { id: 'back', cls: 'menu-back' })));
      return { el, focus: 'back' };
    },

    scores() {
      const listEl = h('div', { class: 'scores-list' });
      const status = h('p', { class: 'note', 'aria-live': 'polite' });
      const paint = (list) => {
        listEl.innerHTML = '';
        const top = (list || []).slice(0, 5);
        if (!top.length) {
          listEl.append(h('p', { class: 'empty' }, 'No scores yet. Be the first detective on the board.'));
          return;
        }
        listEl.append(
          h(
            'table',
            { class: 'scores' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Name'), h('th', { scope: 'col', class: 'num' }, 'Score'), h('th', { scope: 'col' }, 'Reached'), h('th', { scope: 'col' }, 'Skill'))),
            h(
              'tbody',
              {},
              top.map((s, i) =>
                h('tr', {}, h('td', {}, i + 1), h('td', { class: 'name' }, s.name), h('td', { class: 'num' }, fmtScore(s.score)), h('td', { style: ZONES[s.level] ? `color:${ZONES[s.level].color}` : null }, ZONES[s.level] ? ZONES[s.level].short : '–'), h('td', {}, s.note || '')),
              ),
            ),
          ),
        );
      };
      paint(save.scores);
      status.textContent = ctx.scoresOnline?.() === false ? 'Scores on this device.' : 'Checking the arcade scoreboard…';
      ctx.refreshScores?.().then((list) => {
        if (!listEl.isConnected) return;
        if (list) {
          paint(list);
          status.textContent = 'From the arcade scoreboard.';
        } else {
          status.textContent = 'The arcade scoreboard didn’t answer. Showing scores saved on this device.';
        }
      });
      const el = card(
        'scores',
        'High scores',
        listEl,
        status,
        save.best > 0 ? h('p', { class: 'note' }, `Your best on this device: ${fmtScore(save.best)}`) : null,
        h('div', { class: 'menu menu-foot' }, btn('Back', () => back(), { id: 'back', cls: 'menu-back' })),
      );
      return { el, focus: 'back' };
    },

    settings() {
      const s = save.settings;
      const opts = {
        sound: [true, false],
        music: [true, false],
        quality: ['auto', 'high', 'medium', 'low'],
        motion: ['system', 'reduce'],
      };
      const label = {
        sound: (v) => `Sound effects: ${v ? 'On' : 'Off'}`,
        music: (v) => `Music: ${v ? 'On' : 'Off'}`,
        quality: (v) => `Graphics: ${v[0].toUpperCase()}${v.slice(1)}`,
        motion: (v) => (v === 'reduce' ? 'Reduced motion: On' : `Reduced motion: Follow system (${ctx.osReducedMotion() ? 'on' : 'off'})`),
      };
      const hint = {
        quality: 'Lower it if the game stutters.',
        motion: 'No camera moves, slides, or pulsing.',
      };
      const rows = Object.keys(opts).map((key) => {
        const b = btn(label[key](s[key]), () => cycle(1), { id: `set-${key}`, cls: 'cycle-btn', sub: hint[key] ?? null, attrs: { 'data-cycle': key } });
        const cycle = (d) => {
          const list = opts[key];
          const i = list.indexOf(save.settings[key]);
          const v = list[(i + d + list.length) % list.length];
          actions.setSetting(key, v);
          b.querySelector('.menu-btn-label').textContent = label[key](v);
        };
        b.addEventListener('cycle', (e) => {
          audio.blip('move');
          cycle(e.detail);
        });
        return b;
      });
      const el = card(
        'settings',
        'Settings',
        h('p', { class: 'lede' }, 'Left and right change a setting too.'),
        h('div', { class: 'menu' }, rows),
        h('div', { class: 'menu menu-foot' }, btn('Back', () => back(), { id: 'back', cls: 'menu-back' })),
      );
      return { el, focus: 'set-sound' };
    },

    credits() {
      const el = card(
        'credits',
        'Credits',
        h(
          'div',
          { class: 'screen-body' },
          h('p', { class: 'credit-big' }, 'A spiritual successor to Shamus by Cathryn Mataga, Synapse Software, 1982.'),
          h('p', {}, 'Dead End rebuilds the original’s 128-room lair, its colored keys, its electric walls, and the Shadow who punishes anyone who lingers, as a 3D diorama for the Gardner family arcade.'),
          h('p', {}, 'Every sound and the music are synthesized in your browser. 3D by three.js.'),
        ),
        h('div', { class: 'menu menu-foot' }, btn('Back', () => back(), { id: 'back', cls: 'menu-back' })),
      );
      return { el, focus: 'back' };
    },

    pause() {
      const g = ctx.getGame();
      const cp = ctx.getCheckpoint?.();
      const room = g && g.room ? `Room ${g.room.id} · ${zoneName(g.room.zone)}` : '';
      const el = card(
        'pause',
        'Paused',
        h('p', { class: 'lede', style: g && g.room ? `color:${ZONES[g.room.zone].color}` : null }, room),
        h(
          'div',
          { class: 'menu' },
          btn('Resume', () => actions.resume(), { id: 'resume' }),
          btn('Map', () => push('map', { from: 'pause' }), { id: 'map' }),
          btn('Settings', () => push('settings'), { id: 'settings' }),
          btn('How to play', () => push('howto'), { id: 'howto' }),
          btn('Quit to title', () => actions.quitToTitle(), { id: 'quit', sub: cp ? `Your checkpoint in ${zoneName(cp.zoneReached)} is saved.` : null }),
        ),
      );
      return {
        el,
        focus: 'resume',
        onBack: () => actions.resume(),
        onAction: (a, source) => {
          if (a === 'pause') {
            actions.resume();
            return true;
          }
          // M and Back/Select open the map here; Tab keeps moving focus through the menu.
          if (a === 'map' && source !== 'tab') {
            push('map', { from: 'pause' });
            return true;
          }
          return false;
        },
      };
    },

    map(data = {}) {
      const g = ctx.getGame();
      const stats = mapStats(g);
      const canvas = h('canvas', { class: 'map-canvas', role: 'img', 'aria-label': 'Map of the rooms you have found' });
      const scroller = h('div', { class: 'map-scroll' }, canvas);
      const keys = h('div', { class: 'map-keys' });
      for (const c of ['blue', 'green', 'brown', 'purple', 'cyan']) {
        const n = g.keys?.[c] ?? 0;
        if (n) keys.append(h('span', { class: 'map-key', html: icons.key(KEY_COLORS[c].hex) }, n > 1 ? `×${n}` : ''));
      }
      if (!keys.childNodes.length) keys.append(h('span', { class: 'muted' }, 'No keys'));
      const legend = h(
        'ul',
        { class: 'map-legend' },
        [1, 2, 3, 4].map((z) => h('li', {}, h('span', { class: 'swatch', style: `background:${ZONES[z].color}` }), ZONES[z].short)),
        h('li', {}, h('span', { class: 'legend-icon', html: icons.keyhole('#c8c2b4') }), 'Keyhole'),
        h('li', {}, h('span', { class: 'legend-dash' }), 'Locked door'),
        h('li', {}, h('span', { class: 'legend-icon', html: icons.mystery() }), 'Mystery'),
        h('li', {}, h('span', { class: 'legend-icon', html: icons.life() }), 'Life'),
        h('li', {}, h('span', { class: 'legend-you' }), 'You'),
      );
      const here = g.room ? `You are in room ${g.room.id}, ${zoneName(g.room.zone)}.` : '';
      const zoomLabel = () => (mapZoomed ? 'Show what you have found' : 'Show the whole lair');
      const zoomBtn = btn(zoomLabel(), () => {
        mapZoomed = !mapZoomed;
        zoomBtn.querySelector('.menu-btn-label').textContent = zoomLabel();
      }, { id: 'zoom', cls: 'menu-back', sub: 'Left and right scroll the map' });
      const el = card(
        'map',
        'The lair',
        h('div', { class: 'map-head' }, h('p', { class: 'lede' }, `Rooms found: ${stats.visited} of ${stats.total}. ${here}`), h('div', { class: 'map-keys-wrap' }, h('span', { class: 'muted' }, 'Keys'), keys)),
        scroller,
        legend,
        h(
          'div',
          { class: 'menu menu-foot' },
          zoomBtn,
          btn(data.from === 'pause' ? 'Back' : 'Back to the case', () => back(), { id: 'back', cls: 'menu-back', sub: 'M, Tab, or Esc' }),
        ),
      );
      let lastCell = '';
      const close = () => back();
      return {
        el,
        focus: 'back',
        onAction: (a) => {
          if (a === 'map') {
            close();
            return true;
          }
          if (a === 'pause' && data.from !== 'pause') {
            close();
            return true;
          }
          if (a === 'left' || a === 'right') {
            scroller.scrollBy({ left: a === 'left' ? -160 : 160 });
            return true;
          }
          return false;
        },
        onBack: data.from === 'pause' ? null : () => actions.resume(),
        frame() {
          const game = ctx.getGame();
          if (!game) return;
          // Fit what has been found; the whole lair scrolls sideways when it can't fit.
          const win = mapWindow(game, mapZoomed);
          const { cell } = mapSize(scroller.clientWidth - 2, Math.max(120, scroller.clientHeight - 2), win);
          drawAutomap(canvas, game, { t: clock, reduced: ctx.reducedMotion(), cell, win });
          const view = `${cell.toFixed(2)}|${win.gx0}|${win.gy0}|${win.cols}`;
          if (view !== lastCell) {
            // Keep the current room in view whenever the view changes.
            lastCell = view;
            if (game.room) {
              const c = roomCenter(game.room.id, cell, win);
              scroller.scrollLeft = c.x - scroller.clientWidth / 2;
              scroller.scrollTop = c.y - scroller.clientHeight / 2;
            }
          }
        },
      };
    },

    // Game over and case closed share one layout.
    end(data) {
      const g = data.game;
      const won = data.kind === 'won';
      const stats = mapStats(g);
      const cp = data.checkpoint;
      const stat = (k, v, style) => h('div', { class: 'stat' }, h('dt', {}, k), h('dd', { style }, v));
      const postStatus = h('p', { class: 'note post-status', 'aria-live': 'polite' });
      const nameNeeded = data.needName;
      let form = null;

      const setPost = (text) => {
        postStatus.textContent = text;
      };
      const showResult = (res, name) => {
        if (!postStatus.isConnected) return;
        if (res && res.rank) setPost(`Saved as ${name}: #${res.rank} on the arcade board.`);
        else if (res) setPost(`Saved as ${name}.`);
        else setPost(ctx.scoresOnline?.() === false ? `Saved on this device as ${name}.` : `The arcade scoreboard didn’t answer. Saved on this device as ${name}.`);
      };
      if (data.posting) {
        setPost(`Posting as ${data.autoName}…`);
        data.posting.then((res) => showResult(res, data.autoName));
      }

      if (nameNeeded) {
        const input = h('input', {
          id: 'name-input',
          class: 'name-input',
          maxlength: '12',
          autocomplete: 'off',
          autocapitalize: 'characters',
          spellcheck: 'false',
          value: save.initials || '',
          'aria-describedby': 'name-help',
        });
        const add = (ch) => {
          if (input.value.length < 12) input.value += ch;
        };
        const grid = h(
          'div',
          { class: 'letter-grid', role: 'group', 'aria-label': 'Letter picker' },
          [...LETTERS].map((ch) => {
            const b = h('button', { type: 'button', class: 'letter', tabindex: '-1', 'data-nav': '' }, ch);
            b.addEventListener('click', () => {
              audio.blip('move');
              add(ch);
            });
            hoverFocus(b);
            return b;
          }),
          (() => {
            const b = h('button', { type: 'button', class: 'letter letter-wide', tabindex: '-1', 'data-nav': '', 'aria-label': 'Space' }, 'Space');
            b.addEventListener('click', () => add(' '));
            hoverFocus(b);
            return b;
          })(),
          (() => {
            const b = h('button', { type: 'button', class: 'letter letter-wide', tabindex: '-1', 'data-nav': '', 'aria-label': 'Delete a letter' }, '⌫ Delete');
            b.addEventListener('click', () => {
              input.value = input.value.slice(0, -1);
            });
            hoverFocus(b);
            return b;
          })(),
        );
        const submit = h('button', { type: 'submit', class: 'menu-btn save-btn', 'data-id': 'save-name' }, h('span', { class: 'menu-btn-label' }, 'Save score'));
        hoverFocus(submit);
        form = h(
          'form',
          { class: 'name-form', autocomplete: 'off' },
          h('label', { for: 'name-input', class: 'name-label' }, 'Your name or initials for the scoreboard'),
          h('div', { class: 'name-row' }, input, submit),
          h('p', { id: 'name-help', class: 'note' }, 'Up to 12 letters. Type them, or pick them below with the stick and A.'),
          grid,
        );
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!guardOk(stack.at(-1)) || (!padClick && keyDown.repeat)) return;
          const name = ctx.cleanName(input.value);
          if (!name) {
            setPost('Type a name or some initials first.');
            input.focus();
            return;
          }
          audio.blip('select');
          form.replaceWith(postStatus);
          setPost(`Posting as ${name}…`);
          const p = actions.submitScore(name) || Promise.resolve(null);
          // Remember it, so coming back to this screen shows the result, not the form.
          data.needName = false;
          data.autoName = name;
          data.posting = p;
          p.then((res) => showResult(res, name));
          const next = el.querySelector('.menu-end .menu-btn');
          next?.focus({ preventScroll: true });
        });
      }

      const buttons = won
        ? [
            btn('Play again, harder', () => actions.playAgain(), { id: 'again', sub: 'The Shadow comes back faster.' }),
            btn('Title', () => actions.quitToTitle(), { id: 'title' }),
          ]
        : [
            cp ? btn(`Continue from ${zoneName(cp.zoneReached)}`, () => actions.continueRun(), { id: 'continue', sub: `With ${SKILLS[cp.skill]?.lives ?? 5} lives and ${fmtScore(cp.score)} points` }) : null,
            btn('New case', () => push('skill'), { id: 'new' }),
            btn('Title', () => actions.quitToTitle(), { id: 'title' }),
          ];

      const el = card(
        'end',
        won ? 'Case closed' : 'Game over',
        h('p', { class: 'lede' }, won ? 'You beat the Shadow in his own lair.' : 'The Shadow wins this round.'),
        h(
          'dl',
          { class: 'stats' },
          stat('Score', fmtScore(g.score)),
          stat('Rooms found', `${stats.visited} of ${stats.total}`),
          stat('Time', fmtTime(g.stats?.time)),
          stat('Deepest', zoneName(g.zoneReached), `color:${ZONES[g.zoneReached]?.color ?? 'inherit'}`),
          stat('Skill', SKILLS[g.skill]?.name ?? ''),
        ),
        data.newBest ? h('p', { class: 'best' }, 'New best on this device!') : null,
        form || (data.posting ? postStatus : null),
        h('div', { class: 'menu menu-end' }, buttons),
      );
      el.classList.add(won ? 'is-won' : 'is-over');
      return { el, focus: nameNeeded ? 'name-input' : won ? 'again' : cp ? 'continue' : 'new', guard: 900, onBack: () => true };
    },
  };

  // ------------------------------------------------------------------ the stack

  function render() {
    root.innerHTML = '';
    const top = stack.at(-1);
    root.hidden = !top;
    if (!top) return;
    top.screen = screens[top.name](top.data || {});
    root.append(top.screen.el);
    shownAt = performance.now();
    const want = top.restore || top.screen.focus;
    const target = (want && (top.screen.el.querySelector(`[data-id="${want}"]`) || top.screen.el.querySelector(`#${want}`))) || focusables(top.screen.el)[0];
    target?.focus({ preventScroll: true });
  }

  function remember() {
    const top = stack.at(-1);
    const a = document.activeElement;
    if (top && a && top.screen?.el.contains(a)) top.restore = a.dataset.id || null;
  }

  function show(name, data) {
    stack.length = 0;
    stack.push({ name, data });
    render();
  }

  function push(name, data) {
    remember();
    stack.push({ name, data });
    render();
  }

  function pop() {
    stack.pop();
    render();
  }

  function back() {
    const top = stack.at(-1);
    if (!top) return;
    audio.blip('back');
    if (stack.length > 1) return pop();
    if (top.screen.onBack) top.screen.onBack();
  }

  function focusables(scope) {
    return [...scope.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
  }

  function navigate(dir) {
    const top = stack.at(-1);
    const items = focusables(top.screen.el);
    if (!items.length) return false;
    const cur = document.activeElement;
    if (!items.includes(cur)) {
      items[0].focus({ preventScroll: true });
      return true;
    }
    const [dx, dy] = DIRS[dir];
    const r0 = cur.getBoundingClientRect();
    const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    let best = null;
    let bestScore = Infinity;
    for (const n of items) {
      if (n === cur) continue;
      const r = n.getBoundingClientRect();
      const vx = r.left + r.width / 2 - c0.x;
      const vy = r.top + r.height / 2 - c0.y;
      const along = vx * dx + vy * dy;
      if (along <= 2) continue;
      const across = Math.abs(vx * dy - vy * dx);
      // Prefer items that overlap on the cross axis (the same row or column).
      const overlap = dy ? r.right > r0.left && r.left < r0.right : r.bottom > r0.top && r.top < r0.bottom;
      const score = along + across * (overlap ? 0.5 : 3);
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (!best) {
      // Nothing that way: scroll long screens, then wrap vertical menus.
      const body = top.screen.el.querySelector('.scrolls');
      if (body && dy) {
        const before = body.scrollTop;
        body.scrollBy({ top: dy * 140 });
        if (body.scrollTop !== before || (dy > 0 ? before + body.clientHeight < body.scrollHeight - 1 : before > 0)) return true;
      }
      if (dy) {
        const column = items.filter((n) => {
          const r = n.getBoundingClientRect();
          return r.right > r0.left && r.left < r0.right;
        });
        best = dy > 0 ? column[0] : column.at(-1);
        if (best === cur) best = null;
      }
    }
    if (!best) return true;
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    audio.blip('move');
    return true;
  }

  function handle(action, source) {
    const top = stack.at(-1);
    if (!top) return false;
    if (top.screen.onAction && top.screen.onAction(action, source)) return true;
    const a = document.activeElement;
    const inside = a && top.screen.el.contains(a);
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        if ((action === 'left' || action === 'right') && inside && a.dataset.cycle) {
          a.dispatchEvent(new CustomEvent('cycle', { detail: action === 'left' ? -1 : 1 }));
          return true;
        }
        return navigate(action);
      case 'confirm':
        if (source === 'keyboard') {
          // Enter and Space press the focused button natively.
          if (inside && a.matches('button, a, input')) return false;
          focusables(top.screen.el)[0]?.focus({ preventScroll: true });
          return true;
        }
        padClick = true;
        try {
          if (inside && a.tagName === 'INPUT') a.form?.requestSubmit();
          else if (inside && typeof a.click === 'function') a.click();
          else focusables(top.screen.el)[0]?.focus({ preventScroll: true });
        } finally {
          padClick = false;
        }
        return true;
      case 'back':
        back();
        return true;
      default:
        return false;
    }
  }

  return {
    show,
    push,
    pop,
    back,
    handle,
    hide() {
      stack.length = 0;
      render();
    },
    // Re-render the top screen (settings changed elsewhere, a save appeared).
    refresh() {
      if (!stack.length) return;
      remember();
      render();
    },
    frame(dt) {
      clock += dt;
      const top = stack.at(-1);
      if (top && top.screen.frame) top.screen.frame(dt);
    },
    get current() {
      return stack.at(-1)?.name ?? null;
    },
    get depth() {
      return stack.length;
    },
  };
}
