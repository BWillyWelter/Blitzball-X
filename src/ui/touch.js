/**
 * On-screen touch controls: a free-floating virtual stick on one side and an action pad on the
 * other.
 *
 * Every button is PERMANENT: same label, same action, for the whole match. Nothing on this pad
 * relabels or reroutes itself when possession flips — the pad used to swap its skill button
 * between JUKE / TACKLE / JUMP / DIVE mid-play, which read as the controls changing under your
 * thumb. Now:
 *
 *   SHOOT (anchor)  hold to charge, release in the PERFECT window; glows while the GAMEBREAKER
 *                   meter is ready (it still fires off this button — the glow is the only cue)
 *   PASS            lead pass on the ball / call-for-pass off it
 *   SKILL           your signature move on the ball, the poke-slide tackle defending, the dive
 *                   in the cage — the sim routes one edge by possession, the button never moves
 *   BURST           underwater sprint (hold)
 *   RISE / DIVE     free-swim depth
 *
 * Juke aiming: SKILL held + a stick flick plays the signature move (or dive tackle) in that
 * direction (see input.js jukeDir). A plain tap plays it forward. Expert actions (big hit,
 * manual jump, player switch, play calls) stay on keyboard + gamepad only.
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
  { action: 'turbo', label: 'BURST', cls: 't-turbo', angle: 180 },
  { action: 'context', label: 'SKILL', cls: 't-context', angle: -135 },
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

// The SKILL button always fires the same InputManager edge (`trick`): the SIM routes that edge by
// possession — signature move with the ball, poke-slide tackle defending, dive in the cage — so
// the pad itself never changes under the player's thumb.
const SKILL_EDGE = 'trick';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

export class TouchControls {
  constructor(container, input, { onPause, settings } = {}) {
    this.input = input;
    this.onPause = onPause;
    this.settings = settings || {};
    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.buttons = new Map();

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
        <div class="touch-vertical">
          <button class="touch-btn vert t-rise" data-action="rise" type="button" aria-label="Swim up"><span>&#9650;</span></button>
          <button class="touch-btn vert t-dive" data-action="dive" type="button" aria-label="Swim down"><span>&#9660;</span></button>
        </div>
        <div class="touch-stick">
          <div class="touch-stick-ring"></div>
          <div class="touch-stick-nub"></div>
        </div>
      </div>
      <div class="touch-actions">
        <div class="touch-primary">
          ${RING.map((b) => `<button class="touch-btn pri ${b.cls}" data-action="${b.action}" type="button" style="left:${b.x}px;top:${b.y}px"><span>${b.label}</span></button>`).join('')}
          <button class="touch-btn pri t-shoot" data-action="shoot" type="button"><span>SHOOT</span></button>
        </div>
      </div>
      <button class="touch-cage" type="button" data-action="cage" aria-label="Take the cage"><span>GK</span></button>
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
      // style.left/top are measured from the stick's offset parent (the zone), not the viewport,
      // so subtract the zone origin. Without this the ring rendered a whole zone-height too low —
      // usually off the bottom of the screen (the joystick "placement" bug).
      const r = zone.getBoundingClientRect();
      this.stick.style.left = `${x - r.left}px`;
      this.stick.style.top = `${y - r.top}px`;
      this.stick.style.bottom = 'auto';
    };
    let jukeFired = false; // one juke aim per JUKE hold: flick once, then steer freely
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
      // JUKE held + a sharp stick flick aims the signature move in that direction (one aim per
      // hold, so the flick is a deliberate gesture rather than a steering accident).
      if (t.jukeHeld && !jukeFired && mag > 0.62) {
        jukeFired = true;
        t.jukeDir = { x: nx / mag, y: ny / mag };
        t.edges.add('trick');
      }
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
      jukeFired = false;
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
      e.stopPropagation(); // a pad button must not also engage the stick zone it sits over
      if (btn.classList.contains('down')) return;
      btn.classList.add('down');
      if (action === 'turbo') t.turbo = true;
      else if (action === 'rise') t.moveY = 1;
      else if (action === 'dive') t.moveY = -1;
      else if (action === 'shoot') {
        t.shootHeld = true;
        t.edges.add('shoot');
      } else if (action === 'context') {
        t.jukeHeld = true;
        t.edges.add(SKILL_EDGE);
      } else t.edges.add(action);
      btn.setPointerCapture?.(e.pointerId);
    };
    const release = (e) => {
      e?.preventDefault?.();
      if (!btn.classList.contains('down')) return;
      btn.classList.remove('down');
      if (action === 'turbo') t.turbo = false;
      else if (action === 'rise') { if (t.moveY > 0) t.moveY = 0; }
      else if (action === 'dive') { if (t.moveY < 0) t.moveY = 0; }
      else if (action === 'shoot') {
        t.shootHeld = false;
        t.edges.add('shootRelease');
      } else if (action === 'context') {
        t.jukeHeld = false;
        t.jukeDir = null;
      }
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
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
  }

  /**
   * Light the SHOOT anchor up while the GAMEBREAKER meter is full. The label stays SHOOT — the
   * glow is the cue. Buttons on this pad never change their name mid-match.
   */
  setGamebreakerReady(ready) {
    const shoot = this.buttons.get('shoot');
    if (shoot) shoot.classList.toggle('gb-ready', !!ready);
  }

  /** Light the GK button when the cage is open (play is at your end) and latch it while you hold it. */
  setCage(available, active) {
    const btn = this.buttons.get('cage');
    if (!btn) return;
    btn.classList.toggle('on', !!active);
    btn.style.opacity = active ? '1' : available ? '0.85' : '0.3';
  }

  dispose() {
    const t = this.input.touch;
    t.moveX = 0;
    t.moveZ = 0;
    t.moveY = 0;
    t.active = false;
    t.turbo = false;
    t.shootHeld = false;
    t.jukeHeld = false;
    t.jukeDir = null;
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
