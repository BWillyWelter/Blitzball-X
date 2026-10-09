/**
 * Touch controls.
 *
 * Twin-zone scheme, built for two thumbs and nothing else:
 *
 *   LEFT HALF   MOVE — press anywhere and a stick appears under your thumb. Push it forward,
 *               back, left or right to swim. The push is read relative to the camera, so
 *               "forward" always means away from you, whichever way the boom is pointing.
 *               RISE / DIVE sit in the bottom-left corner for depth.
 *   RIGHT HALF  CAMERA — drag anywhere that is not a button and the boom swings with your
 *               thumb: sideways turns the view, up and down lifts it.
 *   STRIKE PAD  the big corner pad: press to wind the shot up, swipe to aim it, lift to fire.
 *               It goes cyan when the meter is full — the same gesture then unleashes the
 *               Gamebreaker, exactly as the keyboard's shoot key does.
 *   ACTION PAD  PASS · BURST (hold) · BLOCK · HIT · TACKLE (which is also your signature move
 *               while you are carrying the ball).
 *
 * Every pointer owns exactly one control from press to release, so a thumb that starts on the
 * camera never steals the stick, and vice versa.
 */
const MOVE_DEADZONE = 0.12;
const STICK_RADIUS = 58; // px of nub travel for full deflection
const STICK_INSET = 72; // keep the stick ring fully on screen
const SWIPE_MIN = 16; // px before a strike drag counts as an aim
const SWIPE_REACH = 46; // px the aim dot can travel from the pad centre
const setting = (value, fallback, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(value) ? value : fallback));

export class TouchControls {
  constructor(container, input, { onPause, settings = {} } = {}) {
    this.input = input;
    this.onPause = onPause;
    this.settings = settings;
    this.stickId = null;
    this.lookId = null;
    this.strikeId = null;
    this.origin = { x: 0, y: 0 };
    this.strikeOrigin = { x: 0, y: 0 };
    this.lookFrom = { x: 0, y: 0 };
    this.owners = new Map(); // button action -> pointerId
    this.buttons = new Map(); // button action -> element
    this.el = this.build();
    container.appendChild(this.el);
    this.applySettings(settings);
    this.onReset = () => this.reset();
    this.onVisibility = () => { if (document.hidden) this.reset(); };
    input.onTouchReset = this.onReset;
    window.addEventListener('blur', this.onReset);
    window.addEventListener('resize', this.onReset);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  build() {
    const el = document.createElement('div');
    el.className = 'touch-ui';
    el.innerHTML = `
      <div class="touch-move" aria-label="Movement">
        <div class="touch-vertical">
          <button class="touch-btn vert t-rise" data-action="rise" type="button" aria-label="Swim up"><span>▲</span></button>
          <button class="touch-btn vert t-dive" data-action="dive" type="button" aria-label="Swim down"><span>▼</span></button>
        </div>
        <div class="touch-stick"><div class="touch-stick-ring"></div><div class="touch-stick-nub"></div></div>
      </div>
      <div class="touch-look" aria-label="Camera">
        <span class="touch-look-hint">DRAG TO LOOK</span>
      </div>
      <div class="touch-actions">
        <div class="touch-pad" aria-label="Actions">
          <button class="touch-btn t-pass" data-action="pass" type="button"><span>PASS</span></button>
          <button class="touch-btn t-burst" data-action="turbo" type="button"><span>BURST</span></button>
          <button class="touch-btn t-block" data-action="breach" type="button"><span>BLOCK</span></button>
          <button class="touch-btn t-hit" data-action="hit" type="button"><span>HIT</span></button>
          <button class="touch-btn t-tackle" data-action="tackle" type="button"><span>TACKLE</span></button>
        </div>
        <div class="touch-strike" role="button" aria-label="Press and swipe to shoot">
          <span class="touch-strike-label">SHOOT</span>
          <span class="touch-strike-hint">HOLD &amp; SWIPE</span>
          <span class="touch-strike-dot"></span>
        </div>
      </div>
      <div class="touch-tactics" aria-label="Team tactics">
        <button data-action="offensePlay" type="button">ATTACK: DRIVE</button>
        <button data-action="defensePlay" type="button">DEFEND: MAN</button>
        <span>Spread for passing lanes · Zone protects the goal · Press costs stamina</span>
      </div>
      <button class="touch-cage" data-action="cage" type="button" aria-label="Take the cage"><span>GK</span></button>
      <button class="touch-pause" type="button" aria-label="Pause">II</button>
      <div class="touch-rotate">ROTATE YOUR DEVICE<br /><span>Blitzball X plays in landscape</span></div>`;
    this.moveZone = el.querySelector('.touch-move');
    this.lookZone = el.querySelector('.touch-look');
    this.stick = el.querySelector('.touch-stick');
    this.nub = el.querySelector('.touch-stick-nub');
    this.strike = el.querySelector('.touch-strike');
    this.strikeDot = el.querySelector('.touch-strike-dot');
    this.bindMove();
    this.bindLook();
    this.bindStrike();
    for (const btn of el.querySelectorAll('[data-action]')) this.bindButton(btn);
    el.querySelector('.touch-pause').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.reset();
      this.onPause?.();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  /** Left half: a floating stick that materialises wherever the thumb lands. */
  bindMove() {
    const t = this.input.touch;
    const move = (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      const dx = e.clientX - this.origin.x;
      const dy = e.clientY - this.origin.y;
      const len = Math.hypot(dx, dy);
      const travel = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
      this.nub.style.transform = `translate(-50%, -50%) translate(${dx * travel}px, ${dy * travel}px)`;
      const deflection = len > 0 ? Math.min(1, len / STICK_RADIUS) : 0;
      const amount = Math.max(0, (deflection - MOVE_DEADZONE) / (1 - MOVE_DEADZONE));
      t.moveX = len > 0 ? (dx / len) * amount : 0;
      t.moveZ = len > 0 ? (dy / len) * amount : 0;
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
    this.moveZone.addEventListener('pointerdown', (e) => {
      if (!this.input.enabled || this.stickId !== null || e.button > 0) return;
      e.preventDefault();
      const rect = this.moveZone.getBoundingClientRect();
      const insetX = Math.min(STICK_INSET, rect.width / 2);
      const insetY = Math.min(STICK_INSET, rect.height / 2);
      this.origin = {
        x: Math.max(rect.left + insetX, Math.min(rect.right - insetX, e.clientX)),
        y: Math.max(rect.top + insetY, Math.min(rect.bottom - insetY, e.clientY)),
      };
      this.stickId = e.pointerId;
      this.stick.style.left = `${this.origin.x - rect.left}px`;
      this.stick.style.top = `${this.origin.y - rect.top}px`;
      this.stick.style.bottom = 'auto';
      this.stick.classList.add('engaged');
      this.moveZone.setPointerCapture(e.pointerId);
      move(e);
    });
    this.moveZone.addEventListener('pointermove', move);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.moveZone.addEventListener(name, end);
  }

  /**
   * Right half: drag to swing the boom. Deltas are published in screen pixels and consumed by
   * the frame loop, which feeds them to the camera — the controls deliberately know nothing
   * about the camera beyond the yaw they need for camera-relative movement.
   */
  bindLook() {
    const t = this.input.touch;
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (!this.input.enabled || this.lookId !== null || e.button > 0) return;
      e.preventDefault();
      this.lookId = e.pointerId;
      this.lookFrom = { x: e.clientX, y: e.clientY };
      this.lookZone.classList.add('engaged');
      this.lookZone.setPointerCapture(e.pointerId);
    });
    this.lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      e.preventDefault();
      t.lookX += e.clientX - this.lookFrom.x;
      t.lookY += e.clientY - this.lookFrom.y;
      this.lookFrom = { x: e.clientX, y: e.clientY };
      this.el.classList.add('looked');
    });
    const end = (e) => {
      if (e.pointerId !== this.lookId) return;
      this.lookId = null;
      this.lookZone.classList.remove('engaged');
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.lookZone.addEventListener(name, end);
  }

  /**
   * The strike pad. Press = wind the shot up. Drag = aim, in screen space: right/left bends the
   * shot to that side and up/down picks the ring tier (the sim reads depth at release). Lift =
   * fire. A flick with no drag is still a shot — just an early-timed one.
   */
  bindStrike() {
    const t = this.input.touch;
    const aim = (dx, dy) => {
      if (this.cageActive) {
        t.keeperAim = {
          z: -this.input.keeperDir * Math.max(-1, Math.min(1, dx / SWIPE_REACH)),
          height: Math.max(-1, Math.min(1, -dy / SWIPE_REACH)),
        };
        return;
      }
      const len = Math.hypot(dx, dy);
      if (len < SWIPE_MIN) return;
      const yaw = Number.isFinite(t.camYaw) ? t.camYaw : 0;
      // Screen basis on the ground plane: right = camera right, up = camera forward.
      const side = dx / len;
      const ahead = -dy / len;
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      t.aimX = side * rx + ahead * fx;
      t.aimZ = side * rz + ahead * fz;
    };
    const move = (e) => {
      if (e.pointerId !== this.strikeId) return;
      e.preventDefault();
      const dx = e.clientX - this.strikeOrigin.x;
      const dy = e.clientY - this.strikeOrigin.y;
      const len = Math.hypot(dx, dy);
      const travel = len > SWIPE_REACH ? SWIPE_REACH / len : 1;
      this.strikeDot.style.transform = `translate(-50%, -50%) translate(${dx * travel}px, ${dy * travel}px)`;
      aim(dx, dy);
    };
    this.strike.addEventListener('pointerdown', (e) => {
      if (!this.input.enabled || this.strikeId !== null || e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.strikeId = e.pointerId;
      this.strikeOrigin = { x: e.clientX, y: e.clientY };
      t.keeperAim = this.cageActive ? { z: 0, height: 0 } : null;
      t.aimX = 0;
      t.aimZ = 0;
      t.shootHeld = !this.cageActive;
      if (!this.cageActive) t.edges.add('shoot');
      this.strike.classList.add('down');
      this.strike.setPointerCapture(e.pointerId);
    });
    this.strike.addEventListener('pointermove', move);
    const end = (e) => {
      if (e.pointerId !== this.strikeId) return;
      e.preventDefault();
      this.strikeId = null;
      t.shootHeld = false;
      this.strike.classList.remove('down');
      this.strikeDot.style.transform = 'translate(-50%, -50%)';
      // A cancelled pointer loses its match: never leave a shot wound up behind the menu.
      if (e.type === 'pointerup') {
        if (this.cageActive) {
          aim(e.clientX - this.strikeOrigin.x, e.clientY - this.strikeOrigin.y);
          t.edges.add('breach');
        } else t.edges.add('shootRelease');
      }
      else this.input.onBlur();
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.strike.addEventListener(name, end);
  }

  syncHeld() {
    const t = this.input.touch;
    t.turbo = this.owners.has('turbo');
    t.shootHeld = this.strikeId !== null && !this.cageActive;
    t.moveY = Number(this.owners.has('rise')) - Number(this.owners.has('dive'));
  }

  bindButton(btn) {
    const action = btn.dataset.action;
    const t = this.input.touch;
    this.buttons.set(action, btn);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.input.enabled || this.owners.has(action) || e.button > 0) return;
      this.owners.set(action, e.pointerId);
      btn.classList.add('down');
      btn.setAttribute('aria-pressed', 'true');
      this.syncHeld();
      if (action === 'tackle') {
        // One press, one move. Aim it with the stick without stealing future steering.
        const len = Math.hypot(t.moveX, t.moveZ);
        t.jukeDir = len > 0.2 ? { x: t.moveX / len, y: t.moveZ / len } : null;
        t.edges.add('trick');
      } else if (action === 'offensePlay' || action === 'defensePlay') {
        const side = action === 'offensePlay' ? 'offense' : 'defense';
        const index = ((this.playIndices?.[side] || 0) + 1) % 3;
        t.playcall = (side === 'offense' ? 1 : 7) + index;
      } else if (!['turbo', 'rise', 'dive'].includes(action)) t.edges.add(action);
      btn.setPointerCapture(e.pointerId);
    });
    const end = (e) => {
      if (this.owners.get(action) !== e.pointerId) return;
      e.preventDefault();
      this.owners.delete(action);
      btn.classList.remove('down');
      btn.setAttribute('aria-pressed', 'false');
      this.syncHeld();
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(name, end);
  }

  reset() {
    const stickId = this.stickId;
    const owners = [...this.owners];
    this.stickId = null;
    this.lookId = null;
    this.strikeId = null;
    this.owners.clear();
    const t = this.input.touch;
    t.moveX = 0;
    t.moveZ = 0;
    t.moveY = 0;
    t.aimX = 0;
    t.aimZ = 0;
    t.keeperAim = null;
    t.lookX = 0;
    t.lookY = 0;
    t.active = false;
    t.turbo = false;
    t.shootHeld = false;
    t.jukeHeld = false;
    t.jukeDir = null;
    t.edges.clear();
    t.playcall = 0;
    this.stick.classList.remove('engaged');
    this.nub.style.transform = 'translate(-50%, -50%)';
    this.lookZone.classList.remove('engaged');
    this.strike.classList.remove('down');
    this.strikeDot.style.transform = 'translate(-50%, -50%)';
    for (const btn of this.buttons.values()) {
      btn.classList.remove('down');
      btn.setAttribute('aria-pressed', 'false');
    }
    if (stickId !== null && this.moveZone.hasPointerCapture(stickId)) this.moveZone.releasePointerCapture(stickId);
    for (const [action, id] of owners) {
      const btn = this.buttons.get(action);
      if (btn && btn.hasPointerCapture(id)) btn.releasePointerCapture(id);
    }
  }

  applySettings(settings = {}) {
    this.reset();
    this.settings = settings;
    this.el.dataset.layout = settings.touchLayout === 'left' ? 'left' : 'right';
    this.el.style.setProperty('--touch-scale', String(setting(settings.touchScale, 1, 0.8, 1.3)));
    this.el.style.setProperty('--touch-opacity', String(setting(settings.touchOpacity, 1, 0.4, 1)));
  }

  setMatchState(sim) {
    const team = sim.userTeam;
    if (team === null) return;
    this.playIndices = { offense: sim.offPlay[team], defense: sim.defPlay[team] };
    const names = { offense: ['DRIVE', 'SPREAD', 'ISOLATE'], defense: ['MAN', 'ZONE', 'PRESS'] };
    for (const side of ['offense', 'defense']) {
      const btn = this.buttons.get(`${side}Play`);
      const label = `${side === 'offense' ? 'ATTACK' : 'DEFEND'}: ${names[side][this.playIndices[side]]}`;
      if (btn && btn.textContent !== label) btn.textContent = label;
    }
    const phase = sim.possession === team ? 'offense' : 'defense';
    if (this.el.dataset.phase !== phase) this.el.dataset.phase = phase;
  }

  setGamebreakerReady(ready) { this.strike.classList.toggle('gb-ready', !!ready && !this.cageActive); }

  setCage(available, active) {
    if (this.cageActive !== !!active) {
      // A shot gesture may not carry through a role switch and become an accidental dive.
      this.input.onBlur();
      this.cageActive = !!active;
      this.el.classList.toggle('in-cage', this.cageActive);
      this.strike.querySelector('.touch-strike-label').textContent = active ? 'DIVE' : 'SHOOT';
      this.strike.querySelector('.touch-strike-hint').textContent = active ? 'AIM · LIFT TO DIVE' : 'HOLD & SWIPE';
      this.strike.setAttribute('aria-label', active ? 'Swipe side and height, release to dive' : 'Press and swipe to shoot');
      this.buttons.get('breach').querySelector('span').textContent = active ? 'DIVE' : 'BLOCK';
      this.buttons.get('rise').setAttribute('aria-label', active ? 'Aim high / rise' : 'Swim up');
      this.buttons.get('dive').setAttribute('aria-label', active ? 'Aim low / sink' : 'Swim down');
    }
    const btn = this.buttons.get('cage');
    btn.classList.toggle('on', !!active);
    btn.style.opacity = active ? '1' : available ? '0.85' : '0.3';
  }

  dispose() {
    this.reset();
    if (this.input.onTouchReset === this.onReset) this.input.onTouchReset = null;
    window.removeEventListener('blur', this.onReset);
    window.removeEventListener('resize', this.onReset);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.el.remove();
  }
}

export function isTouchDevice() {
  return !!(window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
}
