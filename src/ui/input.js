import { emptyInput } from '../game/entities.js';

/**
 * Keyboard + gamepad input mapped into the sim's input struct.
 *
 * Keyboard:  WASD/Arrows move (also steers shot aim, and aims the pass lead) · SHIFT turbo ·
 *            J/Space shoot (hold to charge) · K pass / call for pass off-ball (K+turbo = lob) ·
 *            L slide/poke tackle · I big hit · U breach (jump/block) · Q switch player ·
 *            E gamebreaker · V take the cage (control your keeper) · ESC pause
 * Gamepad:   Left stick move · RT/RB turbo · A/Cross shoot · X/Square pass ·
 *            B/Circle trick/tackle · Y/Triangle hit · LB switch · LT+RT gamebreaker ·
 *            L3 (left-stick click) take the cage · Start pause
 */
/** One-shot input fields: true for a single fixed step, then consumed. */
const ONE_SHOT = [
  'shootPressed',
  'shootReleased',
  'pass',
  'trick',
  'hit',
  'breach',
  'switchPlayer',
  'gamebreaker',
  'cage',
];

const PLAY_KEYS = {
  Digit1: 1,
  Digit2: 2,
  Digit3: 3,
  Digit7: 7,
  Digit8: 8,
  Digit9: 9,
};

const TOUCH_EDGE = {
  shoot: 'shootPressed',
  pass: 'pass',
  trick: 'trick',
  tackle: 'trick',
  hit: 'hit',
  breach: 'breach',
  switch: 'switchPlayer',
  gamebreaker: 'gamebreaker',
  cage: 'cage',
};

const GAMEPLAY_CODES = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
  'KeyV',
]);

function axisWithDeadZone(value, deadZone = 0.18) {
  const amount = Math.abs(value);

  if (amount <= deadZone) {
    return 0;
  }

  const scaled =
    (amount - deadZone) /
    (1 - deadZone);

  return Math.sign(value) * Math.min(1, scaled);
}

function connectedGamepad() {
  if (!navigator.getGamepads) {
    return null;
  }

  const pads = navigator.getGamepads();

  return Array.from(pads || []).find(
    (pad) => pad && pad.connected
  ) || null;
}

/** Every connected pad, in browser order — a local duel can bind one seat per pad. */
function connectedGamepads() {
  if (!navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads() || []).filter((pad) => pad && pad.connected);
}

/**
 * PLAYER TWO KEYBOARD — the numpad half of a shared keyboard.
 *
 * Arrows swim, PageUp/PageDown rise and dive, right shift bursts. The numpad is the action pad:
 * 0 strike, 1 pass, 2 trick/tackle, 3 big hit, 4 switch, 5 breach, 6 gamebreaker, 9 cage,
 * 7 and 8 cycle the offense and defense playbook.
 */
const P2_BINDINGS = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  rise: ['PageUp'],
  dive: ['PageDown'],
  turbo: ['ShiftRight'],
  shoot: ['Numpad0', 'NumpadEnter'],
  pass: ['Numpad1'],
  trick: ['Numpad2'],
  hit: ['Numpad3'],
  swap: ['Numpad4'],
  breach: ['Numpad5'],
  gamebreaker: ['Numpad6'],
  cage: ['Numpad9'],
  offense: ['Numpad7'],
  defense: ['Numpad8'],
};

export class InputManager {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();

    this.input = emptyInput();

    // LOCAL DUEL. A second seat means arrows belong to player two, so player one's movement
    // stops listening to them. `dualSeat` turns that split on; `input2` is the second seat's
    // struct, wired into the sim through `setSeatInput(1, …)`.
    this.dualSeat = false;
    this.input2 = emptyInput();
    this.padPrev2 = Object.create(null);
    this.pending2 = new Set();
    this.pendingPlaycall2 = 0;
    // Cycling playbook selectors for the second seat (Numpad7 / Numpad8).
    this.playIndex2 = [0, 0];

    this.padPrev = Object.create(null);
    this.menuPadPrev = Object.create(null);

    this.pending = new Set();
    this.pendingPlaycall = 0;
    this.pendingJukeDir = null;
    this.pendingKeeperAim = null;

    this.onPause = null;
    this.enabled = true;
    this.lastDevice = 'keyboard';

    this.touch = {
      moveX: 0,
      moveZ: 0,
      moveY: 0,
      active: false,
      turbo: false,
      shootHeld: false,
      jukeHeld: false,
      jukeDir: null, // stick direction captured mid-flick while JUKE is held
      aimX: 0, // world-space shot aim from a strike-pad swipe
      aimZ: 0,
      lookX: 0, // unread camera drag, in screen pixels (see consumeLook)
      lookY: 0,
      keeperAim: null,
      camYaw: 0, // published by the frame loop: the stick is read relative to the camera
      edges: new Set(),
    };

    this.onKeyDown = (event) => {
      if (!this.enabled) {
        return;
      }

      const code = event.code;

      if (event.repeat) {
        return;
      }

      if (
        GAMEPLAY_CODES.has(code) ||
        code === 'Space'
      ) {
        event.preventDefault();
      }

      this.keys.add(code);
      this.lastDevice = 'keyboard';

      if (
        code === 'Escape' &&
        this.onPause &&
        this.onPause() === true
      ) {
        return;
      }

      this.pressed.add(code);
    };

    this.onKeyUp = (event) => {
      if (!this.enabled) {
        return;
      }

      this.keys.delete(event.code);
      this.released.add(event.code);
    };

    this.onBlur = () => {
      this.keys.clear();
      this.pressed.clear();
      this.released.clear();
      this.padPrev = Object.create(null);
      this.menuPadPrev = Object.create(null);

      // Do not allow held actions to fire after tab switching.
      this.pending.clear();
      this.pendingPlaycall = 0;
      this.pendingJukeDir = null;
      this.pendingKeeperAim = null;
      this.pending2.clear();
      this.pendingPlaycall2 = 0;
      Object.assign(this.touch, {
        moveX: 0, moveZ: 0, moveY: 0, active: false,
        turbo: false, shootHeld: false, jukeHeld: false, jukeDir: null, playcall: 0,
        aimX: 0, aimZ: 0, lookX: 0, lookY: 0, keeperAim: null,
      });
      Object.assign(this.input, emptyInput());
      Object.assign(this.input2, emptyInput());
      this.touch.edges.clear();
      this.onTouchReset?.();
    };

    window.addEventListener(
      'keydown',
      this.onKeyDown,
      { passive: false }
    );

    window.addEventListener(
      'keyup',
      this.onKeyUp,
      { passive: true }
    );

    window.addEventListener(
      'blur',
      this.onBlur,
      { passive: true }
    );
  }

  destroy() {
    window.removeEventListener(
      'keydown',
      this.onKeyDown
    );

    window.removeEventListener(
      'keyup',
      this.onKeyUp
    );

    window.removeEventListener(
      'blur',
      this.onBlur
    );

    this.keys.clear();
    this.pressed.clear();
    this.released.clear();
    this.pending.clear();
    this.pending2.clear();
    this.touch.edges.clear();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;

    if (!this.enabled) {
      this.onBlur();
    }
  }

  down(...codes) {
    return codes.some((code) =>
      this.keys.has(code)
    );
  }

  justPressed(...codes) {
    return codes.some((code) =>
      this.pressed.has(code)
    );
  }

  justReleased(...codes) {
    return codes.some((code) =>
      this.released.has(code)
    );
  }

  gamepadButton(pad, index) {
    return !!(
      pad &&
      pad.buttons &&
      pad.buttons[index] &&
      pad.buttons[index].pressed
    );
  }

  gamepadPressed(pad, index) {
    const now = this.gamepadButton(pad, index);
    const was = !!this.padPrev[index];

    this.padPrev[index] = now;

    return now && !was;
  }

  gamepadReleased(pad, index) {
    const now = this.gamepadButton(pad, index);
    const key = `release_${index}`;
    const was = !!this.padPrev[key];

    this.padPrev[key] = now;

    return !now && was;
  }

  menuGamepadPressed(pad, index) {
    const now = this.gamepadButton(pad, index);
    const was = !!this.menuPadPrev[index];

    this.menuPadPrev[index] = now;

    return now && !was;
  }

  menuAxisPressed(pad, axis, direction) {
    const value = pad?.axes?.[axis] || 0;
    const now =
      direction < 0
        ? value < -0.6
        : value > 0.6;

    const key = `axis_${axis}_${direction}`;
    const was = !!this.menuPadPrev[key];

    this.menuPadPrev[key] = now;

    return now && !was;
  }

  /**
   * Turn local-duel mode on or off. Turning it on hands the arrow keys to seat two; turning it
   * off releases the second seat's struct so nothing stale keeps firing.
   */
  setDualSeat(on) {
    this.dualSeat = !!on;
    if (!this.dualSeat) {
      Object.assign(this.input2, emptyInput());
      this.pending2.clear();
      this.pendingPlaycall2 = 0;
      this.padPrev2 = Object.create(null);
    }
  }

  /**
   * Sample seat two. Runs at the top of `poll()` so it sees the same live edge sets player one
   * reads before `poll()` consumes them for the frame.
   */
  sampleSeat2() {
    const out = this.input2;
    const held = (list) => list.some((code) => this.keys.has(code));
    const hit = (list) => list.some((code) => this.pressed.has(code));
    const up = (list) => list.some((code) => this.released.has(code));

    let moveX = 0;
    let moveZ = 0;
    let moveY = 0;
    if (held(P2_BINDINGS.left)) moveX -= 1;
    if (held(P2_BINDINGS.right)) moveX += 1;
    if (held(P2_BINDINGS.up)) moveZ -= 1;
    if (held(P2_BINDINGS.down)) moveZ += 1;
    if (held(P2_BINDINGS.rise)) moveY += 1;
    if (held(P2_BINDINGS.dive)) moveY -= 1;

    let turbo = held(P2_BINDINGS.turbo);
    let shoot = held(P2_BINDINGS.shoot);
    let shootPressed = hit(P2_BINDINGS.shoot);
    let shootReleased = up(P2_BINDINGS.shoot);
    let pass = hit(P2_BINDINGS.pass);
    let trick = hit(P2_BINDINGS.trick);
    let bigHit = hit(P2_BINDINGS.hit);
    let breach = hit(P2_BINDINGS.breach);
    let swap = hit(P2_BINDINGS.swap);
    let gamebreaker = hit(P2_BINDINGS.gamebreaker);
    let cage = hit(P2_BINDINGS.cage);

    let playcall = 0;
    if (hit(P2_BINDINGS.offense)) {
      this.playIndex2[0] = (this.playIndex2[0] + 1) % 3;
      playcall = this.playIndex2[0] + 1;
    }
    if (hit(P2_BINDINGS.defense)) {
      this.playIndex2[1] = (this.playIndex2[1] + 1) % 3;
      playcall = this.playIndex2[1] + 7;
    }

    // Second pad, if there is one. A duel with two controllers is the nicest way to play it.
    const pads = connectedGamepads();
    const pad = pads[1] || null;
    if (pad) {
      const axisX = axisWithDeadZone(pad.axes?.[0] || 0);
      const axisZ = axisWithDeadZone(pad.axes?.[1] || 0);
      if (axisX !== 0 || axisZ !== 0) {
        moveX = axisX;
        moveZ = axisZ;
      }
      const axisY = -axisWithDeadZone(pad.axes?.[3] || 0);
      if (axisY !== 0) moveY = axisY;
      const pressed = (index) => {
        const now = this.gamepadButton(pad, index);
        const was = !!this.padPrev2[index];
        this.padPrev2[index] = now;
        return now && !was;
      };
      const releasedBtn = (index) => {
        const now = this.gamepadButton(pad, index);
        const was = !!this.padPrev2[`r${index}`];
        this.padPrev2[`r${index}`] = now;
        return !now && was;
      };
      if (this.gamepadButton(pad, 0)) shoot = true;
      if (pressed(0)) shootPressed = true;
      if (releasedBtn(0)) shootReleased = true;
      if (this.gamepadButton(pad, 7) || this.gamepadButton(pad, 5)) turbo = true;
      if (pressed(2)) pass = true;
      if (pressed(1)) trick = true;
      if (pressed(3)) bigHit = true;
      if (pressed(4)) swap = true;
      if (pressed(10)) cage = true;
      if (this.gamepadButton(pad, 6) && this.gamepadButton(pad, 7) && (pressed(6) || pressed(7))) gamebreaker = true;
      if ([12, 13, 14, 15].some((b) => this.gamepadButton(pad, b))) {
        moveZ = this.gamepadButton(pad, 12) ? -1 : this.gamepadButton(pad, 13) ? 1 : moveZ;
        moveX = this.gamepadButton(pad, 14) ? -1 : this.gamepadButton(pad, 15) ? 1 : moveX;
      }
    } else {
      this.padPrev2 = Object.create(null);
    }

    const magnitude = Math.hypot(moveX, moveZ);
    if (magnitude > 1) {
      moveX /= magnitude;
      moveZ /= magnitude;
    }

    out.moveX = Math.max(-1, Math.min(1, moveX));
    out.moveZ = Math.max(-1, Math.min(1, moveZ));
    out.moveY = Math.max(-1, Math.min(1, moveY));
    out.aimX = 0;
    out.aimZ = 0;
    out.turbo = !!turbo;
    out.shoot = !!shoot;
    out.shootPressed = !!shootPressed;
    out.shootReleased = !!shootReleased;
    out.pass = !!pass;
    out.jukeDir = null;
    out.jukeHeld = false;
    out.trick = !!trick;
    out.hit = !!bigHit;
    out.breach = !!breach;
    out.keeperAim = null;
    out.switchPlayer = !!swap;
    out.gamebreaker = !!gamebreaker;
    out.cage = !!cage;
    out.playcall = playcall;

    // One-shots survive until a fixed step consumes them, exactly like seat one.
    for (const action of ONE_SHOT) {
      if (out[action]) this.pending2.add(action);
      else if (this.pending2.has(action)) out[action] = true;
    }
    if (out.playcall) this.pendingPlaycall2 = out.playcall;
    else if (this.pendingPlaycall2) out.playcall = this.pendingPlaycall2;

    return out;
  }

  poll() {
    // Seat two must sample the live edge sets before this frame consumes them.
    if (this.dualSeat) this.sampleSeat2();

    const output = this.input;

    let moveX = 0;
    let moveZ = 0;
    let moveY = 0;
    let worldMove = false;
    let turbo = this.down(
      'ShiftLeft',
      'ShiftRight'
    );

    let shootHeld = this.down(
      'KeyJ',
      'Space'
    );

    let shootPressed = this.justPressed(
      'KeyJ',
      'Space'
    );

    let shootReleased = this.justReleased(
      'KeyJ',
      'Space'
    );

    let pass = this.justPressed('KeyK');
    let trick = this.justPressed('KeyL');
    let hit = this.justPressed('KeyI');
    let breach = this.justPressed('KeyU');

    let switchPlayer = this.justPressed(
      'KeyQ',
      'Tab'
    );

    let gamebreaker = this.justPressed('KeyE');
    // Take the cage: hand control to your own keeper (and take it back again).
    let cage = this.justPressed('KeyV');
    let playcall = this.touch.playcall || 0;

    // In a local duel the arrows drive seat two, so player one swims on WASD alone.
    const p1 = this.dualSeat ? (code) => code : null;
    const p1Keys = p1 ? ['KeyA', 'KeyD', 'KeyW', 'KeyS'] : ['KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight', 'KeyW', 'ArrowUp', 'KeyS', 'ArrowDown'];

    if (this.down(p1Keys[0], p1Keys[1])) {
      moveX -= 1;
    }

    if (this.down(p1Keys[2], p1Keys[3])) {
      moveX += 1;
    }

    if (this.down(p1Keys[4], p1Keys[5])) {
      moveZ -= 1;
    }

    if (this.down(p1Keys[6], p1Keys[7])) {
      moveZ += 1;
    }

    // Free-swim depth: R rises, F dives.
    if (this.down('KeyR')) {
      moveY += 1;
    }

    if (this.down('KeyF')) {
      moveY -= 1;
    }

    for (const code in PLAY_KEYS) {
      if (this.justPressed(code)) {
        playcall = PLAY_KEYS[code];
      }
    }

    const touch = this.touch;

    if (touch.active) {
      worldMove = true;
      // The stick is read relative to the camera: pushing it up swims away from the lens, which
      // is the only thing that makes a hand-driven camera usable. Rotate the thumb vector into
      // world space here so the simulation (and the shot aim) keep working in world axes.
      const yaw = Number.isFinite(touch.camYaw) ? touch.camYaw : 0;
      const stickX = Number.isFinite(touch.moveX) ? touch.moveX : 0;
      const stickZ = Number.isFinite(touch.moveZ) ? touch.moveZ : 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      moveX = cos * stickX - sin * stickZ;
      moveZ = -sin * stickX - cos * stickZ;

      this.lastDevice = 'touch';
    }

    if (touch.moveY) {
      moveY = touch.moveY;
      this.lastDevice = 'touch';
    }

    if (touch.turbo) {
      turbo = true;
      this.lastDevice = 'touch';
    }

    if (touch.shootHeld) {
      shootHeld = true;
      this.lastDevice = 'touch';
    }

    for (const action of touch.edges) {
      const field = TOUCH_EDGE[action];

      if (!field) {
        continue;
      }

      this.lastDevice = 'touch';

      // Route through the same locals the keyboard and gamepad set: the final assignment block
      // below overwrites output.* from these locals, so writing output here directly would be
      // clobbered (touch PASS/SWAP/JUMP/… would silently do nothing).
      if (field === 'shootPressed') {
        shootPressed = true;
      } else if (field === 'pass') {
        pass = true;
      } else if (field === 'trick') {
        trick = true;
      } else if (field === 'hit') {
        hit = true;
      } else if (field === 'breach') {
        breach = true;
      } else if (field === 'switchPlayer') {
        switchPlayer = true;
      } else if (field === 'gamebreaker') {
        gamebreaker = true;
      } else if (field === 'cage') {
        cage = true;
      }
    }

    if (touch.edges.has('shootRelease')) {
      shootReleased = true;
      this.lastDevice = 'touch';
    }

    const pad = connectedGamepad();

    if (pad) {
      const axisX = axisWithDeadZone(
        pad.axes?.[0] || 0
      );

      const axisZ = axisWithDeadZone(
        pad.axes?.[1] || 0
      );

      if (
        axisX !== 0 ||
        axisZ !== 0
      ) {
        worldMove = false;
        moveX = axisX;
        moveZ = axisZ;
        this.lastDevice = 'gamepad';
      }

      // Right stick Y dives / rises (up on the stick is negative on the axis).
      const axisY = -axisWithDeadZone(
        pad.axes?.[3] || 0
      );

      if (axisY !== 0) {
        moveY = axisY;
        this.lastDevice = 'gamepad';
      }

      const aPressed =
        this.gamepadPressed(pad, 0);

      const aReleased =
        this.gamepadReleased(pad, 0);

      if (this.gamepadButton(pad, 0)) {
        shootHeld = true;
      }

      if (aPressed) {
        shootPressed = true;
      }

      if (aReleased) {
        shootReleased = true;
      }

      if (
        this.gamepadButton(pad, 7) ||
        this.gamepadButton(pad, 5)
      ) {
        turbo = true;
      }

      if (this.gamepadPressed(pad, 2)) {
        pass = true;
      }

      if (this.gamepadPressed(pad, 1)) {
        trick = true;
      }

      if (this.gamepadPressed(pad, 3)) {
        hit = true;
      }

      if (this.gamepadPressed(pad, 4)) {
        switchPlayer = true;
      }

      if (this.gamepadPressed(pad, 10)) {
        cage = true;
      }

      // R3 (button 11) is unused now that ball-cam is gone.

      const leftTrigger =
        this.gamepadButton(pad, 6);

      const rightTrigger =
        this.gamepadButton(pad, 7);

      if (
        leftTrigger &&
        rightTrigger &&
        (
          this.gamepadPressed(pad, 6) ||
          this.gamepadPressed(pad, 7)
        )
      ) {
        gamebreaker = true;
      }

      if (this.gamepadPressed(pad, 9)) {
        if (this.onPause) {
          this.onPause();
        }
      }

      if ([12, 13, 14, 15].some((b) => this.gamepadButton(pad, b))) worldMove = false;
      if (this.gamepadButton(pad, 12)) {
        moveZ = -1;
      }

      if (this.gamepadButton(pad, 13)) {
        moveZ = 1;
      }

      if (this.gamepadButton(pad, 14)) {
        moveX = -1;
      }

      if (this.gamepadButton(pad, 15)) {
        moveX = 1;
      }

      if (
        pad.buttons.some(
          (button) => button && button.pressed
        )
      ) {
        this.lastDevice = 'gamepad';
      }
    } else {
      this.padPrev = Object.create(null);
    }

    // In the fixed cage view screen-right is -attackDir along z. Touch already rotated
    // through the camera basis; keyboard/pad use that same basis only inside the cage.
    if (this.keeperDir && !worldMove) {
      const side = moveX;
      moveX = -moveZ * this.keeperDir;
      moveZ = -side * this.keeperDir;
    }
    const magnitude = Math.hypot(
      moveX,
      moveZ
    );

    if (magnitude > 1) {
      moveX /= magnitude;
      moveZ /= magnitude;
    }

    output.moveX = Math.max(
      -1,
      Math.min(1, moveX)
    );

    output.moveZ = Math.max(
      -1,
      Math.min(1, moveZ)
    );

    output.moveY = Math.max(
      -1,
      Math.min(1, moveY)
    );

    // A strike-pad swipe aims the shot itself. It is already world space (the touch controller
    // rotates it with the same camera yaw as the stick) and only the shot reads it.
    output.aimX = Number.isFinite(touch.aimX) ? touch.aimX : 0;
    output.aimZ = Number.isFinite(touch.aimZ) ? touch.aimZ : 0;

    output.turbo = !!turbo;
    output.shoot = !!shootHeld;
    output.shootPressed = !!shootPressed;
    output.shootReleased = !!shootReleased;
    output.pass = !!pass;
    // Skill aim is a snapshot for this action, never a replacement for locomotion.
    if (trick && touch.jukeDir) this.pendingJukeDir = { ...touch.jukeDir };
    output.jukeDir = (trick || this.pending.has('trick')) ? this.pendingJukeDir : null;
    output.jukeHeld = !!touch.jukeHeld;
    output.trick = !!trick;
    output.hit = !!hit;
    output.breach = !!breach;
    if ((breach || shootPressed) && touch.keeperAim) this.pendingKeeperAim = { ...touch.keeperAim };
    output.keeperAim = (breach || shootPressed || this.pending.has('breach') || this.pending.has('shootPressed'))
      ? this.pendingKeeperAim
      : null;
    output.switchPlayer = !!switchPlayer;
    output.gamebreaker = !!gamebreaker;
    output.cage = !!cage;
    output.playcall = playcall;

    // Preserve one-shot actions until a fixed simulation
    // step confirms that it consumed them.
    for (const action of ONE_SHOT) {
      if (output[action]) {
        this.pending.add(action);
      } else if (this.pending.has(action)) {
        output[action] = true;
      }
    }

    if (output.playcall) {
      this.pendingPlaycall = output.playcall;
    } else if (this.pendingPlaycall) {
      output.playcall = this.pendingPlaycall;
    }

    this.pressed.clear();
    this.released.clear();
    touch.edges.clear();
    touch.jukeDir = null;
    touch.keeperAim = null;
    touch.playcall = 0;

    return output;
  }

  /** Hand the frame loop this frame's camera drag (screen pixels) and reset the accumulator. */
  consumeLook() {
    const out = { x: this.touch.lookX, y: this.touch.lookY };
    this.touch.lookX = 0;
    this.touch.lookY = 0;
    return out;
  }

  flushOneShots() {
    this.pending.clear();
    this.pendingPlaycall = 0;
    this.pendingJukeDir = null;
    this.pendingKeeperAim = null;
    this.pending2.clear();
    this.pendingPlaycall2 = 0;
    // MatchSim consumes these on its first step. Clear the shared sampled struct as well, so a
    // queued action cannot repeat forever or leak out of a warm-up / pause transition.
    for (const action of ONE_SHOT) this.input[action] = false;
    this.input.playcall = 0;
    this.input.jukeDir = null;
    this.input.keeperAim = null;
    for (const action of ONE_SHOT) this.input2[action] = false;
    this.input2.playcall = 0;
    this.input2.jukeDir = null;
    this.input2.keeperAim = null;
  }

  setKeeperContext(active, dir = 1) {
    this.keeperDir = active ? dir : null;
  }

  menuPoll() {
    const result = {
      up: false,
      down: false,
      left: false,
      right: false,
      confirm: false,
      back: false,
    };

    result.up = this.justPressed(
      'KeyW',
      'ArrowUp'
    );

    result.down = this.justPressed(
      'KeyS',
      'ArrowDown'
    );

    result.left = this.justPressed(
      'KeyA',
      'ArrowLeft'
    );

    result.right = this.justPressed(
      'KeyD',
      'ArrowRight'
    );

    result.confirm = this.justPressed(
      'Enter',
      'Space',
      'KeyJ'
    );

    result.back = this.justPressed(
      'Escape',
      'Backspace',
      'KeyK'
    );

    const pad = connectedGamepad();

    if (pad) {
      if (
        this.menuGamepadPressed(pad, 12) ||
        this.menuAxisPressed(pad, 1, -1)
      ) {
        result.up = true;
      }

      if (
        this.menuGamepadPressed(pad, 13) ||
        this.menuAxisPressed(pad, 1, 1)
      ) {
        result.down = true;
      }

      if (
        this.menuGamepadPressed(pad, 14) ||
        this.menuAxisPressed(pad, 0, -1)
      ) {
        result.left = true;
      }

      if (
        this.menuGamepadPressed(pad, 15) ||
        this.menuAxisPressed(pad, 0, 1)
      ) {
        result.right = true;
      }

      if (
        this.menuGamepadPressed(pad, 0) ||
        this.menuGamepadPressed(pad, 9)
      ) {
        result.confirm = true;
      }

      if (this.menuGamepadPressed(pad, 1)) {
        result.back = true;
      }
    } else {
      this.menuPadPrev = Object.create(null);
    }

    this.pressed.clear();
    this.released.clear();

    return result;
  }
          }
