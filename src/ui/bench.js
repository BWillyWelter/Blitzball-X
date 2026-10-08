import { playerOverall } from '../data/teams.js';

/**
 * The bench panel.
 *
 * Substitution is a stoppage decision, so the UI is too: the panel only exists while the sim is
 * between plays (or paused), it lists the five swimmers in the water against the four on the
 * wall, and tapping a name makes the change. Nothing here is permanent HUD — the pad stayed
 * deliberately small, so this is a panel you open, not a row of buttons you live with.
 *
 * Keyboard 1-4 makes a change to the most tired swimmer; Q still switches who you pilot, so the
 * panel can never steal a control that was already spoken for.
 */
const PANEL_CSS = `
.bench-panel {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(560px, 92vw);
  max-height: 86vh;
  overflow-y: auto;
  padding: 18px 20px 20px;
  border-radius: 16px;
  border: 3px solid rgba(255, 255, 255, 0.22);
  background: linear-gradient(180deg, rgba(10, 14, 26, 0.94), rgba(6, 9, 18, 0.96));
  color: #fff;
  font-family: var(--font-cond, sans-serif);
  z-index: 70;
  pointer-events: auto;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.bench-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 4px;
}
.bench-title {
  font-weight: 900;
  font-size: 26px;
  letter-spacing: 2px;
}
.bench-left {
  font-weight: 900;
  font-size: 14px;
  letter-spacing: 1px;
  color: var(--yellow, #ffd23f);
}
.bench-hint {
  font-size: 12px;
  letter-spacing: 0.6px;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 12px;
}
.bench-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.bench-col h3 {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 1.6px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 900;
}
.bench-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  margin-bottom: 4px;
  border-radius: 9px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  font-size: 14px;
  cursor: default;
}
.bench-row.tappable { cursor: pointer; }
.bench-row.tappable:hover { background: rgba(255, 210, 63, 0.16); border-color: rgba(255, 210, 63, 0.6); }
.bench-row.gassed { border-color: rgba(255, 90, 90, 0.7); background: rgba(255, 90, 90, 0.12); }
.bench-nick { font-weight: 900; letter-spacing: 0.6px; min-width: 68px; }
.bench-role { font-size: 11px; color: rgba(255, 255, 255, 0.5); min-width: 26px; }
.bench-ovr { font-weight: 900; color: var(--cyan, #5cf2ff); }
.bench-bar {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.bench-bar > i { display: block; height: 100%; background: linear-gradient(90deg, #4ad6a0, #8ff7ff); }
.bench-bar.low > i { background: linear-gradient(90deg, #ffb347, #ffd23f); }
.bench-bar.out > i { background: linear-gradient(90deg, #ff5a5a, #ff2ea6); }
.bench-key {
  font-size: 11px;
  font-weight: 900;
  color: var(--yellow, #ffd23f);
  min-width: 14px;
}
.bench-empty { font-size: 12px; color: rgba(255, 255, 255, 0.4); padding: 7px 2px; }
.bench-card { color: var(--yellow, #ffd23f); font-size: 12px; letter-spacing: 1px; }
`;

export class BenchPanel {
  /**
   * @param {HTMLElement} wrap the match wrapper the panel lives inside
   * @param {object} opts { onSub } — optional hook so the app can react (sound, HUD refresh)
   */
  constructor(wrap, opts = {}) {
    this.wrap = wrap;
    this.onSub = opts.onSub;
    this.open = false;
    this.sim = null;
    this.el = null;
    if (!document.getElementById('bench-style')) {
      const style = document.createElement('style');
      style.id = 'bench-style';
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }
  }

  /** Bind to a match. Closes and drops any panel from the previous one. */
  attach(sim) {
    this.sim = sim;
    this.close();
  }

  /** Is the player allowed to make changes right now? */
  available() {
    const sim = this.sim;
    if (!sim || sim.userTeam === null) return false;
    if (sim.state === 'over' || sim.state === 'gamebreaker') return false;
    return sim.canSub(sim.userTeam);
  }

  show() {
    if (!this.available() || this.open) return;
    this.open = true;
    const el = document.createElement('div');
    el.className = 'bench-panel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Substitutions');
    this.wrap.appendChild(el);
    this.el = el;
    this.render();
  }

  close() {
    this.open = false;
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  /** Rebuild the panel body. Cheap enough to call on every open and every change. */
  render() {
    if (!this.open || !this.el) return;
    const sim = this.sim;
    const team = sim.userTeam;
    const teamName = sim.teams[team].name.toUpperCase();
    const left = sim.subsLeft[team];
    const water = sim.players.filter((p) => p.team === team);
    const bench = sim.benchOf(team);

    const row = (p, opts = {}) => {
      const stam = Math.max(0, Math.min(100, p.stamina));
      const cls = ['bench-row'];
      if (opts.tappable) cls.push('tappable');
      if (stam < 22) cls.push('gassed');
      return `<div class="${cls.join(' ')}"${opts.index !== undefined ? ` data-sub="${opts.index}"` : ''}>
        <span class="bench-key">${opts.key || ''}</span>
        <span class="bench-nick">${p.data.nick}</span>
        <span class="bench-role">${p.isKeeper ? 'GK' : p.isShooter ? 'SH' : 'FD'}</span>
        <span class="bench-ovr">${playerOverall(p.data)}</span>
        <span class="bench-bar ${stam < 18 ? 'out' : stam < 45 ? 'low' : ''}"><i style="width:${stam}%"></i></span>
        ${p.cards ? `<span class="bench-card">${'●'.repeat(Math.min(2, p.cards))}</span>` : ''}
      </div>`;
    };

    const waterRows = water
      .map((p, i) => row(p, { key: i < 4 ? String(i + 1) : '' }))
      .join('');
    const benchRows = bench.length
      ? bench.map((b, i) => row(b, { tappable: true, index: i })).join('')
      : '<div class="bench-empty">Nobody left on the wall.</div>';

    this.el.innerHTML = `
      <div class="bench-head">
        <div class="bench-title">BENCH · ${teamName}</div>
        <div class="bench-left">CHANGES LEFT ${left}</div>
      </div>
      <div class="bench-hint">TAP A SWIMMER ON THE WALL TO BRING HIM ON — HE REPLACES THE MOST TIRED PLAYER. TAP AGAIN OR PRESS T TO CLOSE.</div>
      <div class="bench-cols">
        <div class="bench-col"><h3>IN THE WATER</h3>${waterRows}</div>
        <div class="bench-col"><h3>ON THE WALL</h3>${benchRows}</div>
      </div>
    `;

    this.el.querySelectorAll('[data-sub]').forEach((node) => {
      node.addEventListener('click', () => {
        const incoming = bench[Number(node.dataset.sub)];
        if (this.substitute(incoming)) this.render();
      });
    });
  }

  /** Swap `incoming` on for the most tired swimmer his role allows. */
  substitute(incoming) {
    const sim = this.sim;
    if (!incoming || !this.available()) return false;
    const team = sim.userTeam;
    const candidates = sim.players
      .filter((p) => p.team === team && sim.subIsSafe(team, p))
      .sort((a, b) => a.stamina - b.stamina);
    const out = candidates.find((p) => (incoming.isKeeper ? p.isKeeper : !p.isKeeper));
    if (!out) return false;
    const done = sim.queueSub(team, out, incoming);
    if (done) this.onSub?.();
    return done;
  }

  /** Keyboard: 1-4 pick a bench swimmer, T/Esc closes. Called from the app's input handling. */
  handleKey(code) {
    if (!this.open) return false;
    if (code === 'KeyT' || code === 'Escape') {
      this.close();
      return true;
    }
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
    if (n < 0) return false;
    const bench = this.sim.benchOf(this.sim.userTeam);
    if (bench[n]) {
      this.substitute(bench[n]);
      this.render();
    }
    return true;
  }

  dispose() {
    this.close();
    this.sim = null;
  }
}