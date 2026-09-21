import { emptyInput } from '../game/entities.js';

/**
 * Keyboard + gamepad input mapped into the sim's input struct.
 *
 * Keyboard:  WASD/Arrows move (also steers shot aim) · SHIFT turbo · J/Space shoot (hold to charge) ·
 *            K pass / call for pass off-ball (K+turbo = lob) · L slide/poke tackle · I big hit ·
 *            U breach (jump/block) · Q switch player · E gamebreaker · ESC pause
 * Gamepad:   Left stick move · RT/RB turbo · A/Cross shoot · X/Square pass ·
 *            B/Circle trick/tackle · Y/Triangle hit · LB switch · LT+RT gamebreaker · Start pause
 */
/** One-shot input fields: true for a single fixed step, then consumed. */
const ONE_SHOT = ['shootPressed', 'shootReleased', 'pass', 'trick', 'hit', 'breach', 'switchPlayer', 'gamebreaker'];

/** Digit keys that call plays: 1-3 offense, 7-9 defense (sim maps them via inp.playcall). */
const PLAY_KEYS = {
  Digit1: 1,
  Digit2: 2,
  Digit3: 3,
  Digit7: 7,
  Digit8: 8,
  Digit9: 9,
};

/** Touch action name -> input field it drives. */
const TOUCH_EDGE = {
  shoot: 'shootPressed',
  pass: 'pass',
  trick: 'trick',
  hit: 'hit',
  breach: 'breach',
  switch: 'switchPlayer',
  gamebreaker: 'gamebreaker',
};

export class InputManager {
  constructor() {
    this.keys = new Set();
    this.input = emptyInput();
    this.pressed = new Set(); // edge-triggered this frame
    this.released = new Set();
    this.padPrev = {};
    this.onPause = null;
    this.enabled = true;
    this.lastDevice = 'keyboard';
    this.moveVec = { x: 0, z: 0 };
    // Virtual stick / buttons (src/ui/touch.js writes here).
    this.touch = { moveX: 0, moveZ: 0, active: false, turbo: false, shootHeld: false, edges: new Set() };
    // One-shot actions that have not yet been consumed by a fixed simulation step. Without this
    // latch an edge is lost whenever a rendered frame runs *no* fixed step, which is every other
    // frame on a 120 Hz phone or 144 Hz monitor — taps and key presses would feel unresponsive.
    this.pending = new Set();
    this.pendingPlaycall = 0; // see `pending`: same latch, numeric field

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this.lastDevice = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
      // Escape toggles pause during a match. When the pause handler consumes the key we must
      // NOT also register it as an edge, otherwise the pause menu reads it as "back" and resumes.
      if (k === 'Escape' && this.onPause && this.onPause()) return;
      this.pressed.add(k);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
    });
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  justPressed(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  justReleased(...codes) {
    return codes.some((c) => this.released.has(c));
  }

  /** Read the current frame's input into a struct suitable for MatchSim.setUserInput. */
  poll() {
    const i = this.input;
    let mx = 0;
    let mz = 0;
    if (this.down('KeyA', 'ArrowLeft')) mx -= 1;
    if (this.down('KeyD', 'ArrowRight')) mx += 1;
    if (this.down('KeyW', 'ArrowUp')) mz -= 1;
    if (this.down('KeyS', 'ArrowDown')) mz += 1;
    let turbo = this.down('ShiftLeft', 'ShiftRight');
    let shootHeld = this.down('KeyJ', 'Space');
    let shootPressed = this.justPressed('KeyJ', 'Space');
    let shootReleased = this.justReleased('KeyJ', 'Space');
    let pass = this.justPressed('KeyK');
    let trick = this.justPressed('KeyL');
    let hit = this.justPressed('KeyI');
    let breach = this.justPressed('KeyU');
    let switchPlayer = this.justPressed('KeyQ', 'Tab');
    let gamebreaker = this.justPressed('KeyE');
    let playcall = 0;
    for (const code in PLAY_KEYS) if (this.justPressed(code)) playcall = PLAY_KEYS[code];
    let pause = false;

    // Touch overlay
    const t = this.touch;
    if (t.active) {
      mx = t.moveX;
      mz = t.moveZ;
      this.lastDevice = 'touch';
    }
    if (t.turbo) {
      turbo = true;
      this.lastDevice = 'touch';
    }
    if (t.shootHeld) {
      shootHeld = true; // held state only; the press edge below starts the wind-up exactly once
      this.lastDevice = 'touch';
    }
    for (const action of t.edges) {
      const field = TOUCH_EDGE[action];
      if (!field) continue;
      this.lastDevice = 'touch';
      if (field === 'shootPressed') shootPressed = true;
      else if (field === 'pass') pass = true;
      else if (field === 'trick') trick = true;
      else if (field === 'hit') hit = true;
      else if (field === 'breach') breach = true;
      else if (field === 'switchPlayer') switchPlayer = true;
      else if (field === 'gamebreaker') gamebreaker = true;
    }
    if (t.edges.has('shootRelease')) {
      shootReleased = true;
      this.lastDevice = 'touch';
    }

    // Gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (pad) {
      const dz = 0.18;
      const ax = pad.axes[0] || 0;
      const az = pad.axes[1] || 0;
      if (Math.abs(ax) > dz || Math.abs(az) > dz) {
        mx = ax;
        mz = az;
        this.lastDevice = 'gamepad';
      }
      const b = (n) => !!(pad.buttons[n] && pad.buttons[n].pressed);
      const edge = (n) => {
        const now = b(n);
        const was = !!this.padPrev[n];
        this.padPrev[n] = now;
        return now && !was;
      };
      const edgeUp = (n) => {
        const now = b(n);
        const was = !!this.padPrev['u' + n];
        this.padPrev['u' + n] = now;
        return !now && was;
      };
      // Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 9 Start, 12-15 dpad
      if (b(7) || b(5)) turbo = true;
      const aNow = b(0);
      if (aNow) shootHeld = true;
      if (edge(0)) shootPressed = true;
      if (edgeUp(0)) shootReleased = true;
      if (edge(2)) pass = true;
      if (edge(1)) trick = true;
      if (edge(3)) hit = true;
      if (edge(4)) switchPlayer = true;
      if (b(6) && b(7) && edge(6)) gamebreaker = true;
      if (b(6) && edge(7)) gamebreaker = true;
      if (edge(9)) pause = true;
      if (b(12)) mz = -1;
      if (b(13)) mz = 1;
      if (b(14)) mx = -1;
      if (b(15)) mx = 1;
      if (edge(14) || edge(15)) {
        /* d-pad reserved */
      }
      if (pad.buttons.some((x) => x.pressed)) this.lastDevice = 'gamepad';
    }
    if (pause && this.onPause) this.onPause();

    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    i.moveX = mx;
    i.moveZ = mz;
    i.turbo = turbo;
    i.shoot = shootHeld;
    i.pass = pass;
    i.trick = trick;
    i.hit = hit;
    i.breach = breach;
    i.switchPlayer = switchPlayer;
    i.gamebreaker = gamebreaker;
    i.playcall = playcall;
    i.shootPressed = shootPressed;
    i.shootReleased = shootReleased;

    // Latch one-shot actions until a fixed step actually consumes them (see `pending`).
    for (const k of ONE_SHOT) {
      if (i[k]) this.pending.add(k);
      else if (this.pending.has(k)) i[k] = true;
    }
    if (i.playcall) this.pendingPlaycall = i.playcall;
    else if (this.pendingPlaycall) i.playcall = this.pendingPlaycall;

    this.pressed.clear();
    this.released.clear();
    t.edges.clear();
    return i;
  }

  /**
   * Called by the frame loop once at least one fixed simulation step has consumed the current
   * one-shot flags, so the next poll() may report them as released.
   */
  flushOneShots() {
    this.pending.clear();
    this.pendingPlaycall = 0;
  }

  /** Menu navigation helpers (edge-triggered). */
  menuPoll() {
    const out = { up: false, down: false, left: false, right: false, confirm: false, back: false };
    out.up = this.justPressed('KeyW', 'ArrowUp');
    out.down = this.justPressed('KeyS', 'ArrowDown');
    out.left = this.justPressed('KeyA', 'ArrowLeft');
    out.right = this.justPressed('KeyD', 'ArrowRight');
    out.confirm = this.justPressed('Enter', 'Space', 'KeyJ');
    out.back = this.justPressed('Escape', 'Backspace', 'KeyK');
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (pad) {
      const b = (n) => !!(pad.buttons[n] && pad.buttons[n].pressed);
      const edge = (n) => {
        const now = b(n);
        const was = !!this.padPrev['m' + n];
        this.padPrev['m' + n] = now;
        return now && !was;
      };
      const axisEdge = (idx, dir) => {
        const v = pad.axes[idx] || 0;
        const now = dir < 0 ? v < -0.6 : v > 0.6;
        const key = 'ax' + idx + dir;
        const was = !!this.padPrev[key];
        this.padPrev[key] = now;
        return now && !was;
      };
      if (edge(12) || axisEdge(1, -1)) out.up = true;
      if (edge(13) || axisEdge(1, 1)) out.down = true;
      if (edge(14) || axisEdge(0, -1)) out.left = true;
      if (edge(15) || axisEdge(0, 1)) out.right = true;
      if (edge(0) || edge(9)) out.confirm = true;
      if (edge(1)) out.back = true;
    }
    this.pressed.clear();
    this.released.clear();
    return out;
  }
}
