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
];

// Compact layout: smaller footprint, tight gaps, perfectly centered labels.
// Scoped under .touch-ui so it can't leak into the rest of the HUD, and the
// <style> element is removed in dispose() so it never survives a rematch.
const TOUCH_CSS = `
.touch-ui .touch-actions {
  gap: 8px;
  right: 10px;
  bottom: 12px;
}
.touch-ui .touch-btn {
  width: 48px;
  height: 48px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  margin: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  line-height: 1;
  letter-spacing: 0.2px;
  font-size: 10px;
  font-weight: 800;
  box-sizing: border-box;
  overflow: hidden;
}
.touch-ui .touch-btn span {
  display: block;
  transform: translateY(0.5px);
  pointer-events: none;
  white-space: nowrap;
}
.touch-ui .touch-btn.gb {
  width: 44px;
  height: 44px;
}
.touch-ui .touch-pause {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  padding: 0;
}
.touch-ui .touch-stick-zone {
  width: 150px;
  height: 150px;
}
`;

export class TouchControls {
  constructor(container, input, { onPause } = {}) {
    this.input = input;
    this.onPause = onPause;
    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.buttons = new Map();

    this.styleEl = document.createElement('style');
    this.styleEl.textContent = TOUCH_CSS;
    document.head.appendChild(this.styleEl);

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
      // Rescale past the deadzone so the swimmer still reaches full speed at the rim
      
