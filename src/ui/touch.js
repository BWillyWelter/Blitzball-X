/** Touch controls for the legacy FFX shell and the modern MatchSim shell. */

export class FFXTouchController {
  constructor(canvas) {
    this.canvas = canvas;
    this.touchStartPos = { x: 0, y: 0 };
    this.currentVector = { x: 0, y: 0 };
    this.isSwiping = false;
    this.bindEvents();
  }

  bindEvents() {
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isSwiping = true;
        this.touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    });
    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.isSwiping || e.touches.length === 0) return;
      const dx = e.touches[0].clientX - this.touchStartPos.x;
      const dy = e.touches[0].clientY - this.touchStartPos.y;
      const maxRadius = 60;
      this.currentVector = { x: Math.max(-1, Math.min(1, dx / maxRadius)), y: Math.max(-1, Math.min(1, dy / maxRadius)) };
    });
    this.canvas.addEventListener('touchend', () => {
      this.isSwiping = false;
      this.currentVector = { x: 0, y: 0 };
    });
  }

  getSwimDirection() {
    return { x: this.currentVector.x, y: 0, z: this.currentVector.y };
  }

  triggerHaptic(type = 'light') {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    if (type === 'light') navigator.vibrate(25);
    if (type === 'encounter') navigator.vibrate([40, 30, 80]);
    if (type === 'goal') navigator.vibrate([100, 50, 100, 50, 200]);
  }
}

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

/**
 * Discoverable twin-thumb touch scheme for InputManager. Every visual action is wired into the
 * same input struct as keyboard/gamepad play; the left half moves and the right half orbits.
 */
export class TouchControls {
  constructor(wrap, input, settings = {}, callbacks = {}) {
    this.wrap = wrap;
    this.input = input;
    this.settings = settings;
    this.callbacks = callbacks;
    this.sim = null;
    this.gameCamera = null;
    this.enabledByMode = false;
    this.pointer = { move: null, look: null, strike: null };
    // Depth buttons currently held, in press order: the pad has one depth axis, so releasing DIVE
    // has to fall back to a RISE that is still held rather than snapping the swimmer to neutral.
    this.depthHolds = [];
    // A window blur wipes InputManager's held state but knows nothing about this controller's own
    // pointer ownership, so without this the pad stays "pressed" and ignores the next tap.
    this.input.onTouchReset = () => this.clearTouchInput();
    this.el = document.createElement('div');
    this.el.className = 'touch-ui';
    this.el.innerHTML = `
      <div class="touch-move" aria-label="Swim movement area"></div>
      <div class="touch-look" aria-label="Camera look area"></div>
      <div class="touch-look-hint">DRAG RIGHT HALF TO LOOK</div>
      <div class="touch-stick" aria-hidden="true"><div class="touch-stick-ring"></div><div class="touch-stick-nub"></div></div>
      <div class="touch-vertical" aria-label="Swim depth">
        <button class="touch-btn vert t-rise" data-depth="1" aria-label="Rise"><span>RISE ▲</span></button>
        <button class="touch-btn vert t-dive" data-depth="-1" aria-label="Dive"><span>DIVE ▼</span></button>
      </div>
      <div class="touch-actions">
        <div class="touch-pad" aria-label="Match actions">
          <button class="touch-btn" data-action="pass" aria-label="Pass"><span>PASS</span></button>
          <button class="touch-btn t-burst" data-action="turbo" aria-label="Hold to turbo"><span>BURST</span></button>
          <button class="touch-btn t-block t-breach" data-action="breach" aria-label="Block or breach"><span>BLOCK</span></button>
          <button class="touch-btn t-hit" data-action="hit" aria-label="Big hit"><span>HIT</span></button>
          <button class="touch-btn t-tackle" data-action="tackle" aria-label="Tackle or signature move"><span>TACKLE / MOVE</span></button>
        </div>
        <button class="touch-strike" aria-label="Hold, swipe to aim, and release to shoot">
          <span class="touch-strike-label">SHOOT</span>
          <span class="touch-strike-hint">HOLD · SWIPE · RELEASE</span>
          <i class="touch-strike-dot"></i>
        </button>
      </div>
      <button class="touch-pause" aria-label="Pause match">Ⅱ</button>
      <button class="touch-cage" aria-label="Take or leave the goalkeeper">GK</button>
    `;
    this.stick = this.el.querySelector('.touch-stick');
    this.nub = this.el.querySelector('.touch-stick-nub');
    this.strike = this.el.querySelector('.touch-strike');
    this.strikeLabel = this.el.querySelector('.touch-strike-label');
    this.strikeHint = this.el.querySelector('.touch-strike-hint');
    this.strikeDot = this.el.querySelector('.touch-strike-dot');
    this.bindGestures();
    this.applySettings(settings);
  }

  isCoarsePointer() {
    return !!(
      (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
    );
  }

  applySettings(settings = this.settings) {
    this.settings = settings || {};
    const mode = this.settings.touchControls || 'auto';
    this.enabledByMode = mode === 'on' || (mode === 'auto' && this.isCoarsePointer());
    if (this.gameCamera) this.gameCamera.manual = this.enabledByMode;
    this.el.dataset.layout = this.settings.touchLayout === 'left' ? 'left' : 'right';
    // Test for a usable number rather than truthiness: `0 || 0.82` read a deliberately-minimum
    // opacity as "unset" and quietly used the default instead of clamping it.
    const scale = Number(this.settings.touchScale);
    const opacity = Number(this.settings.touchOpacity);
    this.el.style.setProperty('--touch-scale', String(clamp(Number.isFinite(scale) ? scale : 1, 0.8, 1.3)));
    this.el.style.setProperty('--touch-opacity', String(clamp(Number.isFinite(opacity) ? opacity : 0.82, 0.4, 1)));
    this.syncVisibility();
  }

  attach(sim, gameCamera) {
    if (!sim) this.clearTouchInput();
    this.sim = sim;
    this.gameCamera = gameCamera;
    this.visibleForMatch = !!sim;
    if (sim && this.enabledByMode && gameCamera) gameCamera.manual = true;
    this.syncVisibility();
    this.update(sim);
  }

  setMatchVisible(visible) {
    this.visibleForMatch = !!visible;
    if (!visible) this.clearTouchInput();
    this.syncVisibility();
  }

  clearTouchInput() {
    const touch = this.input.touch;
    Object.assign(touch, {
      moveX: 0, moveZ: 0, moveY: 0, active: false, turbo: false, shootHeld: false,
      jukeHeld: false, jukeDir: null, aimX: 0, aimZ: 0, lookX: 0, lookY: 0, keeperAim: null,
    });
    touch.edges.clear();
    this.pointer = { move: null, look: null, strike: null };
    this.depthHolds = [];
    this.moveAnchorX = this.moveAnchorY = undefined;
    this.lastLook = this.strikeOrigin = null;
    this.stick?.classList.remove('engaged');
    this.strike?.classList.remove('down');
    this.nub && (this.nub.style.transform = 'translate(-50%, -50%)');
    this.strikeDot && (this.strikeDot.style.transform = 'translate(-50%, -50%)');
    this.el?.querySelectorAll('.down').forEach((button) => button.classList.remove('down'));
  }

  syncVisibility() {
    const hasPlayer = !!this.sim && this.sim.userTeam !== null;
    const visible = this.enabledByMode && hasPlayer && this.visibleForMatch !== false;
    if (visible && !this.el.isConnected) this.wrap.appendChild(this.el);
    else if (!visible && this.el.isConnected) this.el.remove();
    this.wrap.classList.toggle('touch', visible);
  }

  bindGestures() {
    const moveZone = this.el.querySelector('.touch-move');
    const lookZone = this.el.querySelector('.touch-look');
    moveZone.addEventListener('pointerdown', (event) => this.startMove(event));
    moveZone.addEventListener('pointermove', (event) => this.moveStick(event));
    moveZone.addEventListener('pointerup', (event) => this.endMove(event));
    moveZone.addEventListener('pointercancel', (event) => this.endMove(event));
    moveZone.addEventListener('lostpointercapture', (event) => this.endMove(event));

    lookZone.addEventListener('pointerdown', (event) => this.startLook(event));
    lookZone.addEventListener('pointermove', (event) => this.moveLook(event));
    lookZone.addEventListener('pointerup', (event) => this.endLook(event));
    lookZone.addEventListener('pointercancel', (event) => this.endLook(event));
    lookZone.addEventListener('lostpointercapture', (event) => this.endLook(event));

    this.el.querySelectorAll('[data-depth]').forEach((button) => {
      this.bindHold(button, (down) => {
        this.setDepth(Number(button.dataset.depth), down);
        button.classList.toggle('down', down);
      });
    });

    this.el.querySelectorAll('[data-action]').forEach((button) => {
      const action = button.dataset.action;
      this.bindHold(button, (down) => this.setAction(action, down));
    });

    this.strike.addEventListener('pointerdown', (event) => this.startStrike(event));
    this.strike.addEventListener('pointermove', (event) => this.moveStrike(event));
    this.strike.addEventListener('pointerup', (event) => this.endStrike(event));
    // A cancelled gesture (browser takeover, palm rejection, lost capture) must never be read as a
    // lift-off: release the pad silently instead of firing a shot nobody asked for.
    this.strike.addEventListener('pointercancel', (event) => this.cancelStrike(event));
    this.strike.addEventListener('lostpointercapture', (event) => this.cancelStrike(event));

    this.el.querySelector('.touch-pause').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.input.lastDevice = 'touch';
      this.callbacks.onPause?.();
    });
    this.el.querySelector('.touch-cage').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.input.touch.edges.add('cage');
      this.input.lastDevice = 'touch';
      this.el.querySelector('.touch-cage').classList.toggle('on', !this.sim?.inCage);
    });
  }

  bindHold(element, callback) {
    const release = (event) => {
      if (event && event.pointerId !== undefined && element.dataset.pointer !== String(event.pointerId)) return;
      if (!element.classList.contains('down')) return;
      element.classList.remove('down');
      delete element.dataset.pointer;
      callback(false, event);
    };
    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (element.classList.contains('down')) return;
      element.dataset.pointer = String(event.pointerId);
      element.classList.add('down');
      try { element.setPointerCapture(event.pointerId); } catch { /* capture may be unavailable in an embedded webview */ }
      this.input.lastDevice = 'touch';
      callback(true, event);
    });
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('lostpointercapture', release);
  }

  /**
   * Depth is one axis driven by two buttons: remember which are held and publish the most recent
   * one, so pressing the opposite button takes over immediately and releasing it hands the axis
   * back to the button still under a finger (rather than dropping the swimmer to neutral).
   */
  setDepth(depth, down) {
    this.depthHolds = this.depthHolds.filter((d) => d !== depth);
    if (down) this.depthHolds.push(depth);
    this.input.touch.moveY = this.depthHolds.length ? this.depthHolds[this.depthHolds.length - 1] : 0;
  }

  setAction(action, down) {
    const touch = this.input.touch;
    if (action === 'turbo') touch.turbo = down;
    else if (!down) return;
    else if (action === 'pass') touch.edges.add('pass');
    else if (action === 'block' || action === 'breach') touch.edges.add('breach');
    else if (action === 'hit') touch.edges.add('hit');
    else if (action === 'tackle') touch.edges.add('trick');
  }

  startMove(event) {
    if (this.pointer.move !== null) return;
    event.preventDefault();
    this.pointer.move = event.pointerId;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
    this.stick.classList.add('engaged');
    const bounds = this.el.getBoundingClientRect();
    this.moveAnchorX = event.clientX - bounds.left;
    this.moveAnchorY = event.clientY - bounds.top;
    this.placeStick(this.moveAnchorX, this.moveAnchorY);
    this.moveStick(event);
    this.input.lastDevice = 'touch';
  }

  placeStick(x, y) {
    this.stick.style.left = `${x}px`;
    this.stick.style.top = `${y}px`;
  }

  moveStick(event) {
    if (this.pointer.move !== event.pointerId) return;
    const bounds = this.el.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const dx = event.clientX - (bounds.left + this.moveAnchorX);
    const dy = event.clientY - (bounds.top + this.moveAnchorY);
    const radius = 58;
    const length = Math.hypot(dx, dy);
    const amount = Math.min(1, length / radius);
    const nx = length > 0 ? (dx / length) * amount : 0;
    const ny = length > 0 ? (dy / length) * amount : 0;
    this.nub.style.transform = `translate(calc(-50% + ${nx * radius}px), calc(-50% + ${ny * radius}px))`;
    this.input.touch.moveX = nx;
    this.input.touch.moveZ = ny;
    this.input.touch.active = true;
    // Keep the stick anchored to its first touch, not the latest move.
    if (!Number.isFinite(this.moveAnchorX)) {
      this.moveAnchorX = x;
      this.moveAnchorY = y;
    }
  }

  endMove(event) {
    if (this.pointer.move !== event.pointerId) return;
    this.pointer.move = null;
    this.moveAnchorX = undefined;
    this.moveAnchorY = undefined;
    this.stick.classList.remove('engaged');
    this.nub.style.transform = 'translate(-50%, -50%)';
    Object.assign(this.input.touch, { moveX: 0, moveZ: 0, active: false });
  }

  startLook(event) {
    if (this.pointer.look !== null) return;
    event.preventDefault();
    this.pointer.look = event.pointerId;
    this.lastLook = { x: event.clientX, y: event.clientY };
    event.currentTarget.classList.add('engaged');
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* optional */ }
    this.input.lastDevice = 'touch';
  }

  moveLook(event) {
    if (this.pointer.look !== event.pointerId || !this.lastLook) return;
    const dx = event.clientX - this.lastLook.x;
    const dy = event.clientY - this.lastLook.y;
    this.lastLook = { x: event.clientX, y: event.clientY };
    this.input.touch.lookX += dx;
    this.input.touch.lookY += dy;
    this.gameCamera && (this.gameCamera.manual = true);
    this.el.classList.add('looked');
  }

  endLook(event) {
    if (this.pointer.look !== event.pointerId) return;
    this.pointer.look = null;
    this.lastLook = null;
    event.currentTarget.classList.remove('engaged');
  }

  startStrike(event) {
    if (this.pointer.strike !== null) return;
    event.preventDefault();
    this.pointer.strike = event.pointerId;
    this.strikeOrigin = { x: event.clientX, y: event.clientY };
    this.strike.classList.add('down');
    const inCage = !!this.sim?.inCage;
    this.input.touch.shootHeld = !inCage;
    if (!inCage) this.input.touch.edges.add('shoot');
    this.input.lastDevice = 'touch';
    try { this.strike.setPointerCapture(event.pointerId); } catch { /* optional */ }
  }

  moveStrike(event) {
    if (this.pointer.strike !== event.pointerId || !this.strikeOrigin) return;
    const radius = 58;
    let x = (event.clientX - this.strikeOrigin.x) / radius;
    let y = (this.strikeOrigin.y - event.clientY) / radius;
    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) { x /= magnitude; y /= magnitude; }
    this.strikeDot.style.transform = `translate(-50%, -50%) translate(${x * radius}px, ${-y * radius}px)`;
    if (this.sim?.inCage) {
      this.input.touch.keeperAim = { z: clamp(x, -1, 1), height: clamp(y, -1, 1) };
      return;
    }
    // Same camera-relative rotation as the movement stick (see InputManager.poll): a swipe up is
    // "forward", a swipe right is camera-right, and both stay true as the camera turns. The two
    // axes are rotated together — flipping only one of them aimed the shot behind the shooter.
    const yaw = Number.isFinite(this.input.touch.camYaw) ? this.input.touch.camYaw : 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    this.input.touch.aimX = clamp(cos * x + sin * y, -1, 1);
    this.input.touch.aimZ = clamp(-sin * x + cos * y, -1, 1);
  }

  endStrike(event) {
    if (this.pointer.strike !== event.pointerId) return;
    const inCage = !!this.sim?.inCage;
    this.releaseStrike();
    if (inCage) this.input.touch.edges.add('shoot');
    else this.input.touch.edges.add('shootRelease');
  }

  /** Drop the strike gesture without publishing an edge (cancelled or lost pointer). */
  cancelStrike(event) {
    if (this.pointer.strike !== event.pointerId) return;
    this.releaseStrike();
    // Drop the keeper aim with it: a cancelled dive must not be handed to the next one.
    this.input.touch.keeperAim = null;
  }

  // The swipe aim is deliberately NOT cleared here: the lift is what fires, and the shot (or the
  // keeper dive) reads the aim published on that same frame.
  releaseStrike() {
    this.pointer.strike = null;
    this.strikeOrigin = null;
    this.strike.classList.remove('down');
    this.strikeDot.style.transform = 'translate(-50%, -50%)';
    this.input.touch.shootHeld = false;
  }

  update(sim = this.sim) {
    if (!sim) return;
    this.sim = sim;
    this.syncVisibility();
    const playerTeam = sim.userTeam;
    if (playerTeam === null) return;
    const holder = sim.ball.holder;
    this.el.dataset.phase = holder?.team === playerTeam || (!holder && sim.possession === playerTeam) ? 'offense' : 'defense';
    this.el.classList.toggle('in-cage', !!sim.inCage);
    this.el.querySelector('.touch-cage').classList.toggle('on', !!sim.inCage);
    const ready = !!sim.gbReady[playerTeam];
    this.setGamebreakerReady(ready);
  }

  setGamebreakerReady(ready) {
    const active = !!ready;
    const inCage = !!this.sim?.inCage;
    this.strike.classList.toggle('gb-ready', active && !inCage);
    this.strikeLabel.textContent = inCage ? 'DIVE' : active ? 'GAMEBREAKER' : 'SHOOT';
    this.strikeHint.textContent = inCage ? 'SWIPE · RELEASE TO DIVE' : 'HOLD · SWIPE · RELEASE';
    this.strike.setAttribute('aria-label', inCage
      ? 'Swipe to aim the keeper, then release to dive'
      : 'Hold, swipe to aim, and release to shoot');
  }

  destroy() {
    this.clearTouchInput();
    this.wrap.classList.remove('touch');
    this.el.remove();
    this.sim = null;
    this.gameCamera = null;
  }
}
