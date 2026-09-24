/**
 * On-screen touch controls: a virtual stick on the left and action buttons on the right.
 *
 * Writes into the same InputManager struct the keyboard and gamepad use, so touch play goes
 * through identical rules. Built with pointer events (touch, pen and mouse all work) and pointer
 * capture, so a thumb that slides off a button still releases it cleanly.
 */

const STICK_RADIUS = 58; // px of travel for full deflection
const STICK_DEADZONE = 0.16;

const BUTTONS = [
  // action, label, class, kind ('tap' | 'hold')
  { action: 'shoot', label: 'SHOOT', cls: 'shoot', kind: 'hold' },
  { action: 'turbo', label: 'TURBO', cls: 'turbo', kind: 'hold' },
  { action: 'pass', label: 'PASS', cls: 'pass', kind: 'tap' },
  { action: 'trick', label: 'TRICK', cls: 'trick', kind: 'tap' },
  { action: 'hit', label: 'HIT', cls: 'hit', kind: 'tap' },
  { action: 'breach', label: 'JUMP', cls: 'breach', kind: 'tap' },
  { action: 'switch', label: 'SWAP', cls: 'swap', kind: 'tap' },
  { action: 'gamebreaker', label: 'GB', cls: 'gb', kind: 'tap' },
  // CAM toggles ball-cam lock / forward look — writes a ballCamToggle edge (KeyC / RS click).
  { action: 'ballcam', label: 'CAM', cls: 'cam', kind: 'tap' },
];

export class TouchControls {
  constructor(container, input, { onPause } = {}) {
    this.input = input;
    this.onPause = onPause;
    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.buttons = new Map();
    this.el = this.build();
    container.appendChild(this.el);
    this.el.querySelector('.touch-pause').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onPause?.();
    });
  }

  build() {
    const el = document.createElement('div');
    el.className = 'touch-ui';
    el.innerHTML = `
      <div class="touch-stick-zone">
        <div class="touch-stick">
          <div class="touch-stick-ring"></div>
          <div class="touch-stick-nub"></div>
        </div>
      </div>
      <div class="touch-actions">
        ${BUTTONS.map((b) => `<button class="touch-btn ${b.cls}" data-action="${b.action}" type="button"><span>${b.label}</span></button>`).join('')}
      </div>
      <button class="touch-pause" type="button" aria-label="Pause">II</button>
      <div class="touch-rotate">ROTATE YOUR DEVICE<br /><span>Blitzball X plays in landscape</span></div>
    `;
    this.stick = el.querySelector('.touch-stick');
    this.nub = el.querySelector('.touch-stick-nub');
    this.zone = el.querySelector('.touch-stick-zone');
    this.bindStick();
    for (const btn of el.querySelectorAll('.touch-btn')) this.bindButton(btn);
    return el;
  }

  bindStick() {
    const zone = this.zone;
    const t = this.input.touch;
    const place = (x, y) => {
      this.stick.style.left = `${x}px`;
      this.stick.style.top = `${y}px`;
    };
    const move = (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      this.nub.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
      const nx = dx / STICK_RADIUS;
      const ny = dy / STICK_RADIUS;
      const mag = Math.hypot(nx, ny);
      if (mag < STICK_DEADZONE) {
        t.moveX = 0;
        t.moveZ = 0;
        t.active = false;
        return;
      }
      // Rescale past the deadzone so the swimmer still reaches full speed at the rim.
      const scale = Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / mag;
      t.moveX = nx * scale;
      t.moveZ = ny * scale; // screen-down is +z, matching the camera looking down +z at the pool
      t.active = true;
    };
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      t.moveX = 0;
      t.moveZ = 0;
      t.active = false;
      this.nub.style.transform = 'translate(-50%, -50%)';
      this.stick.classList.remove('engaged');
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      place(e.clientX, e.clientY);
      this.stick.classList.add('engaged');
      zone.setPointerCapture(e.pointerId);
      move(e);
    });
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  bindButton(btn) {
    const action = btn.dataset.action;
    const t = this.input.touch;
    this.buttons.set(action, btn);
    const press = (e) => {
      e.preventDefault();
      if (btn.classList.contains('down')) return;
      btn.classList.add('down');
      if (action === 'turbo') t.turbo = true;
      else if (action === 'shoot') {
        t.shootHeld = true;
        t.edges.add('shoot');
      } else t.edges.add(action === 'ballcam' ? 'ballcamToggle' : action);
      btn.setPointerCapture?.(e.pointerId);
    };
    const release = (e) => {
      e?.preventDefault?.();
      if (!btn.classList.contains('down')) return;
      btn.classList.remove('down');
      if (action === 'turbo') t.turbo = false;
      else if (action === 'shoot') {
        t.shootHeld = false;
        t.edges.add('shootRelease');
      }
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Highlight the Gamebreaker button when a meter is full. */
  setGamebreakerReady(ready) {
    const b = this.buttons.get('gamebreaker');
    if (b) b.classList.toggle('ready', !!ready);
  }

  dispose() {
    const t = this.input.touch;
    t.moveX = 0;
    t.moveZ = 0;
    t.active = false;
    t.turbo = false;
    t.shootHeld = false;
    t.edges.clear();
    this.el.remove();
  }
}

/** True when the primary pointing device is a finger (phones, tablets). */
export function isTouchDevice() {
  try {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  } catch (e) {
    return false;
  }
}
