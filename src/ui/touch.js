/** Multi-touch controller. Every pointer owns exactly one control until release. */
const DEADZONE = 0.12;
const PAD = { size: 182, shoot: 104, ring: 60, radius: 94 };
const RING = [
  { action: 'turbo', label: 'BURST', cls: 't-turbo', angle: 180 },
  { action: 'context', label: 'SKILL', cls: 't-context', angle: -135 },
  { action: 'pass', label: 'PASS', cls: 't-pass', angle: -90 },
].map((slot) => {
  const centre = PAD.size - PAD.shoot / 2;
  const angle = slot.angle * Math.PI / 180;
  return { ...slot, x: Math.round(centre + Math.cos(angle) * PAD.radius - PAD.ring / 2),
    y: Math.round(centre + Math.sin(angle) * PAD.radius - PAD.ring / 2) };
});
const setting = (value, fallback, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(value) ? value : fallback));

export class TouchControls {
  constructor(container, input, { onPause, settings = {} } = {}) {
    this.input = input;
    this.onPause = onPause;
    this.settings = settings;
    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.buttons = new Map();
    this.owners = new Map();
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
    for (const [key, value] of Object.entries({ 'pad-size': PAD.size, 'shoot-size': PAD.shoot, 'ring-size': PAD.ring })) {
      el.style.setProperty(`--${key}`, `${value}px`);
    }
    el.innerHTML = `
      <div class="touch-stick-zone" aria-label="Movement joystick">
        <div class="touch-vertical">
          <button class="touch-btn vert t-rise" data-action="rise" type="button" aria-label="Swim up"><span>▲</span></button>
          <button class="touch-btn vert t-dive" data-action="dive" type="button" aria-label="Swim down"><span>▼</span></button>
        </div>
        <div class="touch-stick"><div class="touch-stick-ring"></div><div class="touch-stick-nub"></div></div>
      </div>
      <div class="touch-actions"><div class="touch-primary">
        ${RING.map((b) => `<button class="touch-btn pri ${b.cls}" data-action="${b.action}" type="button" style="left:${b.x}px;top:${b.y}px"><span>${b.label}</span></button>`).join('')}
        <button class="touch-btn pri t-shoot" data-action="shoot" type="button" aria-label="Hold to charge, release to shoot"><span>SHOOT</span></button>
      </div></div>
      <div class="touch-defense" aria-label="Defense controls">
        <button class="touch-btn" data-action="tackle" type="button"><span>TACKLE</span></button>
        <button class="touch-btn" data-action="hit" type="button"><span>HIT</span></button>
        <button class="touch-btn" data-action="breach" type="button"><span>BLOCK</span></button>
        <button class="touch-btn" data-action="switch" type="button"><span>SWITCH</span></button>
      </div>
      <div class="touch-tactics" aria-label="Team tactics">
        <button data-action="offensePlay" type="button">ATTACK: DRIVE</button>
        <button data-action="defensePlay" type="button">DEFEND: MAN</button>
        <span>Spread for passing lanes · Zone protects the goal · Press costs stamina</span>
      </div>
      <button class="touch-cage" data-action="cage" type="button" aria-label="Take the cage"><span>GK</span></button>
      <button class="touch-pause" type="button" aria-label="Pause">II</button>
      <div class="touch-rotate">ROTATE YOUR DEVICE<br /><span>Blitzball X plays in landscape</span></div>`;
    this.zone = el.querySelector('.touch-stick-zone');
    this.stick = el.querySelector('.touch-stick');
    this.nub = el.querySelector('.touch-stick-nub');
    this.bindStick();
    for (const btn of el.querySelectorAll('[data-action]')) this.bindButton(btn);
    el.querySelector('.touch-pause').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.reset();
      this.onPause?.();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  bindStick() {
    const t = this.input.touch;
    const move = (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const length = Math.hypot(dx, dy);
      const radius = this.stick.getBoundingClientRect().width * 0.45 || 58;
      const visualScale = this.stick.getBoundingClientRect().width / this.stick.offsetWidth || 1;
      const deflection = Math.min(1, length / radius);
      const visual = length > 0 ? Math.min(length, radius) / length : 0;
      this.nub.style.transform = `translate(-50%, -50%) translate(${dx * visual / visualScale}px, ${dy * visual / visualScale}px)`;
      const amount = Math.max(0, (deflection - DEADZONE) / (1 - DEADZONE));
      t.moveX = length ? dx / length * amount : 0;
      t.moveZ = length ? dy / length * amount : 0;
      // Ownership, not deflection, determines which device is steering.
      t.active = true;
    };
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      t.moveX = t.moveZ = 0;
      t.active = false;
      this.nub.style.transform = 'translate(-50%, -50%)';
      this.stick.classList.remove('engaged');
      this.stick.style.left = this.stick.style.top = this.stick.style.bottom = '';
    };
    this.zone.addEventListener('pointerdown', (e) => {
      if (!this.input.enabled || this.stickId !== null || e.button > 0) return;
      e.preventDefault();
      const rect = this.zone.getBoundingClientRect();
      const inset = Math.min(64, rect.width / 2, rect.height / 2);
      this.stickOrigin = {
        x: Math.max(rect.left + inset, Math.min(rect.right - inset, e.clientX)),
        y: Math.max(rect.top + inset, Math.min(rect.bottom - inset, e.clientY)),
      };
      this.stickId = e.pointerId;
      this.stick.style.left = `${this.stickOrigin.x - rect.left}px`;
      this.stick.style.top = `${this.stickOrigin.y - rect.top}px`;
      this.stick.style.bottom = 'auto';
      this.stick.classList.add('engaged');
      this.zone.setPointerCapture(e.pointerId);
      move(e);
    });
    this.zone.addEventListener('pointermove', move);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.zone.addEventListener(name, end);
  }

  syncHeld() {
    const t = this.input.touch;
    t.turbo = this.owners.has('turbo');
    t.shootHeld = this.owners.has('shoot');
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
      if (action === 'context') {
        // One press, one skill. Aim with the current stick without stealing future steering.
        const length = Math.hypot(t.moveX, t.moveZ);
        t.jukeDir = length > 0.2 ? { x: t.moveX / length, y: t.moveZ / length } : null;
        t.edges.add('trick');
      } else if (action === 'offensePlay' || action === 'defensePlay') {
        const side = action === 'offensePlay' ? 'offense' : 'defense';
        const index = ((this.playIndices?.[side] || 0) + 1) % 3;
        t.playcall = (side === 'offense' ? 1 : 7) + index;
      } else if (action === 'shoot') t.edges.add('shoot');
      else if (!['turbo', 'rise', 'dive'].includes(action)) t.edges.add(action);
      btn.setPointerCapture(e.pointerId);
    });
    const end = (e) => {
      if (this.owners.get(action) !== e.pointerId) return;
      e.preventDefault();
      this.owners.delete(action);
      btn.classList.remove('down');
      btn.setAttribute('aria-pressed', 'false');
      this.syncHeld();
      if (action === 'shoot') {
        if (e.type === 'pointerup') t.edges.add('shootRelease');
        else this.input.onBlur();
      }
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(name, end);
  }

  reset() {
    const stickId = this.stickId;
    const owners = [...this.owners];
    this.stickId = null;
    this.owners.clear();
    const t = this.input.touch;
    t.moveX = t.moveZ = t.moveY = 0;
    t.active = t.turbo = t.shootHeld = t.jukeHeld = false;
    t.jukeDir = null;
    t.edges.clear();
    t.playcall = 0;
    this.stick.classList.remove('engaged');
    this.stick.style.left = this.stick.style.top = this.stick.style.bottom = '';
    this.nub.style.transform = 'translate(-50%, -50%)';
    for (const btn of this.buttons.values()) {
      btn.classList.remove('down');
      btn.setAttribute('aria-pressed', 'false');
    }
    if (stickId !== null && this.zone.hasPointerCapture(stickId)) this.zone.releasePointerCapture(stickId);
    for (const [action, id] of owners) {
      const btn = this.buttons.get(action);
      if (btn.hasPointerCapture(id)) btn.releasePointerCapture(id);
    }
  }

  placeRing() {
    for (const slot of RING) {
      this.buttons.get(slot.action).style.left = `${this.settings.touchLayout === 'left' ? PAD.size - PAD.ring - slot.x : slot.x}px`;
    }
  }

  applySettings(settings = {}) {
    this.reset();
    this.settings = settings;
    this.el.dataset.layout = settings.touchLayout === 'left' ? 'left' : 'right';
    this.el.style.setProperty('--touch-scale', String(setting(settings.touchScale, 1, 0.8, 1.3)));
    this.el.style.setProperty('--touch-opacity', String(setting(settings.touchOpacity, 1, 0.4, 1)));
    this.placeRing();
  }

  setMatchState(sim) {
    const team = sim.userTeam;
    if (team === null) return;
    this.playIndices = { offense: sim.offPlay[team], defense: sim.defPlay[team] };
    const names = { offense: ['DRIVE', 'SPREAD', 'ISOLATE'], defense: ['MAN', 'ZONE', 'PRESS'] };
    for (const side of ['offense', 'defense']) {
      const btn = this.buttons.get(`${side}Play`);
      const label = `${side === 'offense' ? 'ATTACK' : 'DEFEND'}: ${names[side][this.playIndices[side]]}`;
      if (btn.textContent !== label) btn.textContent = label;
    }
    const phase = sim.possession === team ? 'offense' : 'defense';
    if (this.el.dataset.phase !== phase) this.el.dataset.phase = phase;
  }

  setGamebreakerReady(ready) { this.buttons.get('shoot').classList.toggle('gb-ready', !!ready); }

  setCage(available, active) {
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
