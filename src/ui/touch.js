/**
 * On-screen touch controls: a free-floating virtual stick on one side and an adaptive action pad
 * on the other.
 *
 * The pad is built around a single giant anchor. SHOOT (hold to charge, release in the PERFECT
 * window) sits in the thumb corner with three *ring* buttons on a one-thumb arc around it: PASS,
 * TURBO (hold) and a *contextual* button that remaps to whatever matters right now — TRICK while
 * carrying, TACKLE on defense, JUMP when the ball is loose or when we are supporting off it.
 *
 * Above the pad sits the expert row (HIT / JUMP / SWAP / GB / CAM). It auto-swaps: every play state
 * ranks the row most-practical-first, so the prime slots move to the near edge of the row under
 * the thumb and light up, while actions the sim ignores in that state (BREACH while carrying, GB
 * off the dribble) dim right down instead of inviting a wasted press.
 *
 * Writes into the same InputManager struct the keyboard and gamepad use, so touch play goes
 * through identical rules. Built with pointer events (touch, pen and mouse all work) and pointer
 * capture, so a thumb that slides off a button still releases it cleanly.
 */

const STICK_RADIUS = 58; // px of travel for full deflection
const STICK_DEADZONE = 0.16;

// Primary pad geometry, in unscaled CSS pixels. SHOOT is the anchor tucked into the corner; the
// three ring buttons sit `radius` from its centre. Kept here rather than in styles.css so the ring
// math and the CSS variables build() publishes can never drift apart.
const PAD = { size: 182, shoot: 104, ring: 60, radius: 94 };

// Ring slots in thumb-arc order: out to the side, up the diagonal, then straight up. Angles are
// screen-space degrees (0 = right, -90 = up). Variant classes are prefixed `t-`: the bare names
// (`turbo`, `shoot`, …) collide with HUD rules in styles.css (e.g. the turbo meter is `.turbo`),
// which would restyle the buttons themselves.
const RING = [
  { action: 'turbo', label: 'TURBO', cls: 't-turbo', angle: 180 },
  { action: 'context', label: 'TRICK', cls: 't-context', angle: -135 },
  { action: 'pass', label: 'PASS', cls: 't-pass', angle: -90 },
].map((slot) => {
  const rad = (slot.angle * Math.PI) / 180;
  const centre = PAD.size - PAD.shoot / 2; // SHOOT's centre, from the pad's top-left
  return {
    ...slot,
    x: Math.round(centre + Math.cos(rad) * PAD.radius - PAD.ring / 2),
    y: Math.round(centre + Math.sin(rad) * PAD.radius - PAD.ring / 2),
  };
});

// Secondary cluster: expert actions, compact and semi-transparent.
const SECONDARY = [
  { action: 'hit', label: 'HIT', cls: 't-hit' },
  { action: 'breach', label: 'JUMP', cls: 't-breach' },
  { action: 'switch', label: 'SWAP', cls: 't-swap' },
  { action: 'gamebreaker', label: 'GB', cls: 't-gb' },
  // CAM toggles ball-cam lock / forward look — writes a ballCamToggle edge (KeyC / RS click).
  { action: 'ballcam', label: 'CAM', cls: 't-cam' },
];

// The top N ranks of the auto-swap order get the prime spot and the bright treatment.
const HOT_SLOTS = 3;

// Live play states. `action` is a real InputManager edge, so the contextual button routes through
// exactly the same rules as the dedicated keys. `order` auto-swaps the expert row
// most-practical-first; `dead` lists actions the sim ignores in that state, which dim right down.
//   carrying:  GB only fires off the dribble, and BREACH is not read at all while carrying
//   off ball:  BREACH is the leap/block/volley, and GB needs the ball
const CONTEXTS = {
  ball: { label: 'TRICK', action: 'trick', order: ['gamebreaker', 'switch', 'hit', 'ballcam', 'breach'], dead: ['breach'] },
  support: { label: 'JUMP', action: 'breach', order: ['switch', 'breach', 'hit', 'ballcam', 'gamebreaker'], dead: ['gamebreaker'] },
  defense: { label: 'TACKLE', action: 'hit', order: ['hit', 'breach', 'switch', 'gamebreaker', 'ballcam'], dead: ['gamebreaker'] },
  loose: { label: 'JUMP', action: 'breach', order: ['breach', 'hit', 'switch', 'gamebreaker', 'ballcam'], dead: ['gamebreaker'] },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

export class TouchControls {
  constructor(container, input, { onPause, settings } = {}) {
    this.input = input;
    this.onPause = onPause;
    this.settings = settings || {};
    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.buttons = new Map();
    this.contextKey = 'ball';

    this.el = this.build();
    this.applySettings(this.settings);
    container.appendChild(this.el);
    this.el.querySelector('.touch-pause').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onPause?.();
    });
  }

  build() {
    const el = document.createElement('div');
    el.className = 'touch-ui';
    el.dataset.layout = 'right';
    // Publish the pad geometry so styles.css sizes the buttons to match the ring math.
    el.style.setProperty('--pad-size', `${PAD.size}px`);
    el.style.setProperty('--shoot-size', `${PAD.shoot}px`);
    el.style.setProperty('--ring-size', `${PAD.ring}px`);
    el.innerHTML = `
      <div class="touch-stick-zone">
        <div class="touch-stick">
          <div class="touch-stick-ring"></div>
          <div class="touch-stick-nub"></div>
        </div>
      </div>
      <div class="touch-actions">
        <div class="touch-secondary">
          ${SECONDARY.map((b) => `<button class="touch-btn sec ${b.cls}" data-action="${b.action}" type="button"><span>${b.label}</span></button>`).join('')}
        </div>
        <div class="touch-primary">
          ${RING.map((b) => `<button class="touch-btn pri ${b.cls}" data-action="${b.action}"${b.action === 'context' ? ' data-context="ball"' : ''} type="button" style="left:${b.x}px;top:${b.y}px"><span>${b.label}</span></button>`).join('')}
          <button class="touch-btn pri t-shoot" data-action="shoot" type="button"><span>SHOOT</span></button>
        </div>
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
      } else if (action === 'context') t.edges.add(CONTEXTS[this.contextKey].action);
      else t.edges.add(action === 'ballcam' ? 'ballcamToggle' : action);
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

  /**
   * Remap the contextual anchor and auto-swap the expert row for the controlled swimmer's state:
   * TRICK on the ball, TACKLE on defense, JUMP on a loose ball or when supporting off it.
   * Fed from the frame loop; cheap enough to call every frame (it no-ops unless the state flips).
   */
  setContext({ onBall = false, defending = false, looseBall = false, support = false } = {}) {
    const key = onBall ? 'ball' : defending ? 'defense' : looseBall ? 'loose' : support ? 'support' : 'ball';
    if (key === this.contextKey) return;
    this.contextKey = key;
    const btn = this.buttons.get('context');
    if (btn) {
      btn.dataset.context = key;
      btn.querySelector('span').textContent = CONTEXTS[key].label;
    }
    this.rankSecondary();
  }

  /**
   * Auto-swap the expert row: rank 0 takes the slot nearest the thumb (right-most for a
   * right-handed pad, left-most when mirrored) and the top few light up, while actions the sim
   * ignores in this state dim right down. Flex `order` is used so re-ranking never has to move a
   * node a finger is already holding.
   */
  rankSecondary() {
    const ctx = CONTEXTS[this.contextKey] || CONTEXTS.ball;
    const flip = this.settings.touchLayout === 'left';
    const last = ctx.order.length - 1;
    ctx.order.forEach((action, rank) => {
      const btn = this.buttons.get(action);
      if (!btn) return;
      btn.style.order = String(flip ? rank : last - rank);
      btn.classList.toggle('hot', rank < HOT_SLOTS);
      btn.classList.toggle('idle', ctx.dead.includes(action));
    });
  }

  /**
   * Mirror the ring for a left-handed pad so the SHOOT anchor always sits under the resting thumb
   * and the other three fan away from it.
   */
  placeRing() {
    const flip = this.settings.touchLayout === 'left';
    for (const slot of RING) {
      const btn = this.buttons.get(slot.action);
      if (btn) btn.style.left = `${flip ? PAD.size - PAD.ring - slot.x : slot.x}px`;
    }
  }

  /** Apply player layout preferences (handedness, size, opacity) live. */
  applySettings(settings = {}) {
    if (!this.el) return;
    this.settings = settings;
    this.el.dataset.layout = settings.touchLayout === 'left' ? 'left' : 'right';
    this.el.style.setProperty('--touch-scale', String(clamp(settings.touchScale, 0.8, 1.3)));
    this.el.style.setProperty('--touch-opacity', String(clamp(settings.touchOpacity, 0.4, 1)));
    this.placeRing();
    this.rankSecondary();
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
