// Keyboard, mouse, gamepads, and touch, merged into the sim's input { x, y, fire, aim }
// (x and y are -1, 0, or 1) plus one stream of menu actions: up, down, left, right,
// confirm, back, pause, and map. Fire keys aim the original way: hold fire and push a
// direction to plant your feet and shoot that way. The mouse button fires toward the
// cursor instead (aim is that point in room cells), and Shamus keeps walking. The sim
// does the rest; input only reports what is held.
//
//   Keyboard  arrows or WASD move; Space, J, Z, or Enter fire; Esc or P pause; M or Tab map
//   Mouse     left button fires at the cursor (hold to keep firing)
//   Gamepad   stick or d-pad move (eight directions); A or X fire; Start pause; Back/Select map
//   Touch     a floating stick on the left half, a big fire button on the right

const DIR_KEYS = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};
const NAV_OF = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
const FIRE_KEYS = new Set(['Space', 'KeyJ', 'KeyZ', 'Enter', 'NumpadEnter']);

const PAD = { A: 0, B: 1, X: 2, Y: 3, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const STICK_DEAD = 0.4;
// After the mouse button comes up, keep reporting the cursor this long, so a quick click
// the sim queued (PLAYER.clickBuffer) still fires toward it.
const AIM_LINGER_MS = 450;
const NAV_DELAY = 0.38; // seconds before a held direction repeats in menus
const NAV_REPEAT = 0.13;

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

// Snap a vector to one of eight directions, as -1/0/1 components.
function octant(x, y) {
  const a = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
  return [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
}

// toRoom(clientX, clientY) maps a screen point to a room point ({ x, y } in cells) or
// null; mouse aiming needs it.
export function createInput({ touchRoot, toRoom = () => null } = {}) {
  const held = []; // keyboard direction codes, oldest first
  const fireKeys = new Set();
  // pressed latches a click until the next read, so a click shorter than a frame counts.
  const mouse = { down: false, pressed: false, cx: 0, cy: 0, upAt: -Infinity };
  let handler = () => false;
  let anyInput = () => {};
  let latch = false; // ignore fire until every fire control is released
  let lastSource = 'keyboard';

  const pad = { x: 0, y: 0, fire: false, prev: [], navDir: null, navT: 0, connected: false };
  const touch = { x: 0, y: 0, fire: false, stickId: null, fireId: null, ox: 0, oy: 0, enabled: false, visible: false };

  function emit(name, source, ev) {
    lastSource = source;
    return handler(name, source, ev) === true;
  }

  // ------------------------------------------------------------------ keyboard

  function onKeyDown(e) {
    anyInput();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = isTyping(e.target);
    const code = e.code;
    const key = (e.key || '').toLowerCase();

    if (typing) {
      // Text fields keep their keys; only Escape and the vertical arrows leave them.
      if (e.key === 'Escape' && emit('back', 'keyboard', e)) e.preventDefault();
      else if ((code === 'ArrowUp' || code === 'ArrowDown') && emit(NAV_OF[code], 'keyboard', e)) e.preventDefault();
      return;
    }

    if (DIR_KEYS[code]) {
      if (!held.includes(code)) held.push(code);
      e.preventDefault();
      emit(NAV_OF[code], 'keyboard', e);
      return;
    }
    if (FIRE_KEYS.has(code)) {
      fireKeys.add(code);
      // Enter and Space also press the focused menu button; the handler says whether
      // anything else should happen.
      if (!e.repeat && emit('confirm', 'keyboard', e)) e.preventDefault();
      else if (code === 'Space' && !e.target.closest?.('button, a')) e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (e.key === 'Escape') {
      if (emit('back', 'keyboard', e)) e.preventDefault();
    } else if (key === 'p') {
      if (emit('pause', 'keyboard', e)) e.preventDefault();
    } else if (key === 'm') {
      if (emit('map', 'keyboard', e)) e.preventDefault();
    } else if (e.key === 'Tab') {
      // Tab opens the map in play; in menus it keeps moving focus unless a screen wants it.
      if (emit('map', 'tab', e)) e.preventDefault();
    }
  }

  function onKeyUp(e) {
    const i = held.indexOf(e.code);
    if (i >= 0) held.splice(i, 1);
    fireKeys.delete(e.code);
  }

  function clearHeld() {
    held.length = 0;
    fireKeys.clear();
    mouse.down = false;
    mouse.pressed = false;
    mouse.upAt = -Infinity;
    touch.x = touch.y = 0;
    touch.fire = false;
    touch.stickId = touch.fireId = null;
    if (touchRoot) touchRoot.classList.remove('is-sticking', 'is-firing');
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearHeld);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearHeld();
  });

  // ------------------------------------------------------------------ mouse

  // Only a press on the game view itself fires, so the HUD's buttons and the menus keep
  // their clicks. Touch and pens have their own controls.
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouse.cx = e.clientX;
    mouse.cy = e.clientY;
  });
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target?.id !== 'view') return;
    anyInput();
    lastSource = 'mouse';
    mouse.down = true;
    mouse.pressed = true;
    mouse.cx = e.clientX;
    mouse.cy = e.clientY;
    e.preventDefault();
  });
  window.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !mouse.down) return;
    mouse.down = false;
    mouse.upAt = performance.now();
  });

  // ------------------------------------------------------------------ gamepads

  function pollPads(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let x = 0;
    let y = 0;
    let fire = false;
    let navDir = null;
    let connected = false;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      connected = true;
      const prev = (pad.prev[p.index] ||= []);
      const down = (i) => !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
      const pressed = (i) => down(i) && !prev[i];

      let px = 0;
      let py = 0;
      const ax = p.axes[0] || 0;
      const ay = p.axes[1] || 0;
      if (Math.hypot(ax, ay) > STICK_DEAD) [px, py] = octant(ax, ay);
      if (down(PAD.LEFT)) px = -1;
      if (down(PAD.RIGHT)) px = 1;
      if (down(PAD.UP)) py = -1;
      if (down(PAD.DOWN)) py = 1;
      if (px || py) {
        x = px;
        y = py;
        // Menus move one axis at a time: take the stronger one.
        const sx = Math.abs(ax) > STICK_DEAD ? ax : px;
        const sy = Math.abs(ay) > STICK_DEAD ? ay : py;
        navDir = Math.abs(sy) >= Math.abs(sx) ? (sy < 0 ? 'up' : 'down') : sx < 0 ? 'left' : 'right';
      }
      if (down(PAD.A) || down(PAD.X)) fire = true;

      if (pressed(PAD.A)) emit('confirm', 'pad');
      if (pressed(PAD.B)) emit('back', 'pad');
      if (pressed(PAD.START)) emit('pause', 'pad');
      if (pressed(PAD.BACK)) emit('map', 'pad');
      for (let i = 0; i < p.buttons.length; i++) {
        if (pressed(i)) anyInput();
        prev[i] = down(i);
      }
    }
    pad.x = x;
    pad.y = y;
    pad.fire = fire;
    pad.connected = connected;

    // Held directions repeat in menus after a short delay.
    if (navDir !== pad.navDir) {
      pad.navDir = navDir;
      pad.navT = NAV_DELAY;
      if (navDir) emit(navDir, 'pad');
    } else if (navDir) {
      pad.navT -= dt;
      if (pad.navT <= 0) {
        pad.navT = NAV_REPEAT;
        emit(navDir, 'pad');
      }
    }
  }

  // ------------------------------------------------------------------ touch

  let stickBase = null;
  let stickKnob = null;
  let fireBtn = null;
  const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };

  function buildTouch() {
    if (!touchRoot || stickBase) return;
    touchRoot.innerHTML = '';
    const zone = document.createElement('div');
    zone.className = 'touch-stick-zone';
    stickBase = document.createElement('div');
    stickBase.className = 'touch-stick';
    stickKnob = document.createElement('div');
    stickKnob.className = 'touch-knob';
    stickBase.append(stickKnob);
    zone.append(stickBase);
    fireBtn = document.createElement('div');
    fireBtn.className = 'touch-fire';
    fireBtn.setAttribute('aria-hidden', 'true');
    fireBtn.innerHTML = '<span>FIRE</span><small>hold + stick to aim</small>';
    touchRoot.append(zone, fireBtn);

    zone.addEventListener('pointerdown', (e) => {
      anyInput();
      if (touch.stickId !== null) return;
      touch.stickId = e.pointerId;
      zone.setPointerCapture?.(e.pointerId);
      const r = zone.getBoundingClientRect();
      touch.ox = e.clientX;
      touch.oy = e.clientY;
      stickBase.style.left = `${e.clientX - r.left}px`;
      stickBase.style.top = `${e.clientY - r.top}px`;
      stickKnob.style.transform = 'translate(-50%, -50%)';
      touchRoot.classList.add('is-sticking');
      e.preventDefault();
    });
    const moveStick = (e) => {
      if (e.pointerId !== touch.stickId) return;
      const dx = e.clientX - touch.ox;
      const dy = e.clientY - touch.oy;
      const len = Math.hypot(dx, dy);
      const max = 46;
      const k = len > max ? max / len : 1;
      stickKnob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
      if (len < 14) {
        touch.x = touch.y = 0;
      } else {
        [touch.x, touch.y] = octant(dx, dy);
      }
      e.preventDefault();
    };
    const endStick = (e) => {
      if (e.pointerId !== touch.stickId) return;
      touch.stickId = null;
      touch.x = touch.y = 0;
      touchRoot.classList.remove('is-sticking');
    };
    zone.addEventListener('pointermove', moveStick);
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    fireBtn.addEventListener('pointerdown', (e) => {
      anyInput();
      touch.fireId = e.pointerId;
      touch.fire = true;
      fireBtn.setPointerCapture?.(e.pointerId);
      touchRoot.classList.add('is-firing');
      e.preventDefault();
    });
    const endFire = (e) => {
      if (e.pointerId !== touch.fireId) return;
      touch.fireId = null;
      touch.fire = false;
      touchRoot.classList.remove('is-firing');
    };
    fireBtn.addEventListener('pointerup', endFire);
    fireBtn.addEventListener('pointercancel', endFire);
  }

  function refreshTouch() {
    if (!touchRoot) return;
    if (touch.enabled) buildTouch();
    touchRoot.hidden = !(touch.enabled && touch.visible);
    if (touchRoot.hidden) {
      touch.x = touch.y = 0;
      touch.fire = false;
      touch.stickId = touch.fireId = null;
    }
  }

  touch.enabled = coarse.matches;
  window.addEventListener(
    'touchstart',
    () => {
      if (!touch.enabled) {
        touch.enabled = true;
        refreshTouch();
      }
    },
    { passive: true },
  );

  // ------------------------------------------------------------------ the merged view

  function keyboardDir() {
    let x = 0;
    let y = 0;
    // The most recent key on each axis wins, so Left then Right goes right.
    for (let i = held.length - 1; i >= 0; i--) {
      const [dx, dy] = DIR_KEYS[held[i]];
      if (!x && dx) x = dx;
      if (!y && dy) y = dy;
    }
    return [x, y];
  }

  const out = { x: 0, y: 0, fire: false, aim: null };

  return {
    // Called once per animation frame, before reading.
    poll(dt) {
      pollPads(dt);
    },
    // The sim's input for this frame.
    read() {
      // One device steers at a time: keyboard, then gamepad, then touch.
      const [kx, ky] = keyboardDir();
      let x = touch.x;
      let y = touch.y;
      if (kx || ky) [x, y] = [kx, ky];
      else if (pad.x || pad.y) [x, y] = [pad.x, pad.y];
      const mouseFire = mouse.down || mouse.pressed;
      mouse.pressed = false;
      const fireHeld = fireKeys.size > 0 || pad.fire || touch.fire || mouseFire;
      if (latch && !fireHeld) latch = false;
      out.x = x;
      out.y = y;
      out.fire = fireHeld && !latch;
      const aiming = mouseFire || performance.now() - mouse.upAt < AIM_LINGER_MS;
      out.aim = aiming ? toRoom(mouse.cx, mouse.cy) : null;
      return out;
    },
    // (name, source, event) => handled. Sources: 'keyboard', 'tab', 'pad'. The mouse
    // sends no actions; menus take its clicks directly.
    onAction(fn) {
      handler = fn;
    },
    onAnyInput(fn) {
      anyInput = fn;
    },
    // After a menu button pressed with a fire key starts or resumes play, don't let that
    // same press fire a shot.
    latchFire() {
      latch = true;
    },
    clear: clearHeld,
    setTouchVisible(on) {
      touch.visible = on;
      refreshTouch();
    },
    get touchEnabled() {
      return touch.enabled;
    },
    get padConnected() {
      return pad.connected;
    },
    get lastSource() {
      return lastSource;
    },
  };
}
