import { emptyInput } from '../game/entities.js';

const ONE_SHOT = [
  'shootPressed',
  'shootReleased',
  'pass',
  'trick',
  'hit',
  'breach',
  'switchPlayer',
  'gamebreaker',
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
  hit: 'hit',
  breach: 'breach',
  switch: 'switchPlayer',
  gamebreaker: 'gamebreaker',
};

const GAMEPLAY_CODES = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
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

export class InputManager {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();

    this.input = emptyInput();

    this.padPrev = Object.create(null);
    this.menuPadPrev = Object.create(null);

    this.pending = new Set();
    this.pendingPlaycall = 0;

    this.onPause = null;
    this.enabled = true;
    this.lastDevice = 'keyboard';

    this.touch = {
      moveX: 0,
      moveZ: 0,
      active: false,
      turbo: false,
      shootHeld: false,
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
      this.touch.edges.clear();
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

  poll() {
    const output = this.input;

    let moveX = 0;
    let moveZ = 0;
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
    let playcall = 0;

    if (this.down('KeyA', 'ArrowLeft')) {
      moveX -= 1;
    }

    if (this.down('KeyD', 'ArrowRight')) {
      moveX += 1;
    }

    if (this.down('KeyW', 'ArrowUp')) {
      moveZ -= 1;
    }

    if (this.down('KeyS', 'ArrowDown')) {
      moveZ += 1;
    }

    for (const code in PLAY_KEYS) {
      if (this.justPressed(code)) {
        playcall = PLAY_KEYS[code];
      }
    }

    const touch = this.touch;

    if (touch.active) {
      moveX = Number.isFinite(touch.moveX)
        ? touch.moveX
        : 0;

      moveZ = Number.isFinite(touch.moveZ)
        ? touch.moveZ
        : 0;

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

      if (field === 'shootPressed') {
        shootPressed = true;
      } else {
        output[field] = true;
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
        moveX = axisX;
        moveZ = axisZ;
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

    output.turbo = !!turbo;
    output.shoot = !!shootHeld;
    output.shootPressed = !!shootPressed;
    output.shootReleased = !!shootReleased;
    output.pass = !!pass;
    output.trick = !!trick;
    output.hit = !!hit;
    output.breach = !!breach;
    output.switchPlayer = !!switchPlayer;
    output.gamebreaker = !!gamebreaker;
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

    return output;
  }

  flushOneShots() {
    this.pending.clear();
    this.pendingPlaycall = 0;
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
