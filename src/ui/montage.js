import { buildReport } from '../game/report.js';

/**
 * HALFTIME MONTAGE — the break, explained.
 *
 * A two-minute pause where the game just stops is dead air, and the numbers a player actually
 * wants at the break are the ones nobody showed them: which window their points came through, who
 * is carrying the scoring, and what the biggest hit of the half cost. The montage runs over the
 * frozen pool, auto-dismisses before the second-half kickoff so nobody has to press anything, and
 * can be tapped through early.
 *
 * Deliberately not a stat table — the full box score is on the results screen. This is the story
 * of the half in five lines.
 */
const MONTAGE_CSS = `
.montage {
  position: absolute;
  inset: 0;
  z-index: 55;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, rgba(6, 10, 20, 0.72), rgba(4, 6, 14, 0.95));
  opacity: 0;
  transition: opacity 0.35s;
  pointer-events: none;
  font-family: var(--font-cond, sans-serif);
  color: #fff;
}
.montage.on {
  opacity: 1;
  pointer-events: auto;
}
.montage-box {
  width: min(720px, 92vw);
  padding: 22px 26px 24px;
  border-radius: 18px;
  border: 2px solid rgba(255, 255, 255, 0.16);
  background: linear-gradient(180deg, rgba(12, 17, 30, 0.95), rgba(6, 9, 18, 0.97));
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
  text-align: center;
}
.montage-kicker {
  font-family: var(--font-cond, sans-serif);
  font-weight: 900;
  font-size: 14px;
  letter-spacing: 5px;
  color: var(--yellow, #ffd23f);
}
.montage-score {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin: 6px 0 2px;
  font-family: var(--font-display, sans-serif);
  font-size: clamp(40px, 9vw, 76px);
  line-height: 1;
}
.montage-score .side {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.montage-score .abbr {
  font-size: 15px;
  letter-spacing: 2px;
  color: var(--c1, #fff);
  opacity: 0.9;
}
.montage-score .num { color: #fff; }
.montage-score .dash { opacity: 0.4; }
.montage-head {
  font-family: var(--font-cond, sans-serif);
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 1.2px;
  color: rgba(255, 255, 255, 0.78);
  margin-bottom: 16px;
}
.montage-rows {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 18px;
  text-align: left;
}
.montage-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  border-left: 3px solid var(--c1, rgba(255, 255, 255, 0.3));
}
.montage-row .k {
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 1.4px;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
}
.montage-row .v {
  font-weight: 900;
  font-size: 15px;
  text-align: right;
  min-width: 0;
}
.montage-row .v small {
  display: block;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.6px;
  color: rgba(255, 255, 255, 0.55);
}
.montage-row.hit .v { color: #ff6a8a; }
.montage-foot {
  margin-top: 16px;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 2px;
  color: rgba(255, 255, 255, 0.4);
}
.montage-count {
  display: block;
  width: 120px;
  height: 2px;
  margin: 10px auto 0;
  background: rgba(255, 255, 255, 0.14);
  overflow: hidden;
}
.montage-count i {
  display: block;
  height: 100%;
  width: 0%;
  background: var(--yellow, #ffd23f);
  transition: width 0.2s linear;
}
@media (max-width: 560px) {
  .montage-rows { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .montage { transition: none; }
  .montage-count i { transition: none; }
}
`;

export class MontageOverlay {
  constructor(wrap) {
    if (!document.getElementById('montage-styles')) {
      const style = document.createElement('style');
      style.id = 'montage-styles';
      style.textContent = MONTAGE_CSS;
      document.head.appendChild(style);
    }
    this.el = document.createElement('div');
    this.el.className = 'montage';
    this.el.innerHTML = `
      <div class="montage-box">
        <div class="montage-kicker">HALFTIME</div>
        <div class="montage-score"></div>
        <div class="montage-head"></div>
        <div class="montage-rows"></div>
        <div class="montage-foot">TAP OR PRESS TO GO BACK IN<span class="montage-count"><i></i></span></div>
      </div>`;
    wrap.appendChild(this.el);
    this.box = this.el.querySelector('.montage-box');
    this.scoreEl = this.el.querySelector('.montage-score');
    this.headEl = this.el.querySelector('.montage-head');
    this.rowsEl = this.el.querySelector('.montage-rows');
    this.countEl = this.el.querySelector('.montage-count i');
    this.shown = false;
    this.timer = 0;
    this.duration = 0;
  }

  show(sim) {
    const r = buildReport(sim, { half: 1 });
    const [a, b] = r.teams;
    this.scoreEl.innerHTML = `
      <div class="side"><span class="abbr" style="--c1:${a.primary}">${a.abbr}</span><span class="num">${r.score[0]}</span></div>
      <span class="dash">–</span>
      <div class="side"><span class="abbr" style="--c1:${b.primary}">${b.abbr}</span><span class="num">${r.score[1]}</span></div>`;
    this.headEl.textContent = sim.state === 'over' ? 'FULL TIME' : 'SECOND HALF NEXT';

    const rows = [];
    // Where the points came from: the top ring is worth double, so this is the real story.
    for (const t of r.teams) {
      const rings = t.rings;
      const total = rings.top + rings.blue + rings.white;
      rows.push({
        c: t.primary,
        k: `${t.abbr} · WINDOWS`,
        v: total ? `${rings.top} TOP · ${rings.blue + rings.white} LOW` : '—',
        s: total ? `of ${total} scoring ${t.rings.top * 3 + (rings.blue + rings.white)} pts` : 'nothing yet',
      });
    }
    // Who is carrying it.
    const star = r.teams.flatMap((t) => t.scorers.map((s) => ({ ...s, abbr: t.abbr, c: t.primary })))
      .sort((x, y) => y.points - x.points)[0];
    rows.push(star
      ? { c: star.c, k: 'TOP SCORER', v: star.nick, s: `${star.points} pts` }
      : { c: 'rgba(255,255,255,0.3)', k: 'TOP SCORER', v: 'NOBODY', s: 'the water is still silent' });

    // Discipline, now that it exists.
    rows.push({
      c: r.discipline.cards ? 'var(--yellow, #ffd23f)' : 'rgba(255,255,255,0.3)',
      k: 'DISCIPLINE',
      v: r.discipline.cards ? `${r.discipline.cards} BOOKED` : 'CLEAN',
      s: r.discipline.reds ? `${r.discipline.reds} sent off · ${r.discipline.fouls} fouls` : `${r.discipline.fouls} fouls · ${r.discipline.subs} changes`,
    });

    // The hit of the half, if there was one worth naming.
    const halfHit = r.biggest;
    rows.push(halfHit
      ? { c: '#ff6a8a', k: 'BIGGEST HIT', v: `${halfHit.hitter} → ${halfHit.victim}`, s: halfHit.fouled ? 'and it was a foul' : 'clean', hit: true }
      : { c: 'rgba(255,255,255,0.3)', k: 'BIGGEST HIT', v: 'NONE YET', s: 'nobody has connected' });

    this.rowsEl.innerHTML = rows.map((row) => `
      <div class="montage-row ${row.hit ? 'hit' : ''}" style="--c1:${row.c}">
        <span class="k">${row.k}</span>
        <span class="v">${row.v}<small>${row.s}</small></span>
      </div>`).join('');

    // Auto-dismiss well before the second-half kickoff; the tap is an accelerator, not a gate.
    this.duration = 7.5;
    this.timer = 0;
    this.countEl.style.width = '0%';
    this.el.classList.add('on');
    this.shown = true;
  }

  /** Countdown tick, or the tap-to-continue. Returns true when the montage has finished. */
  tick(dt) {
    if (!this.shown) return true;
    this.timer += dt;
    this.countEl.style.width = `${Math.min(100, (this.timer / this.duration) * 100)}%`;
    if (this.timer >= this.duration) {
      this.hide();
      return true;
    }
    return false;
  }

  dismiss() {
    if (!this.shown) return false;
    this.hide();
    return true;
  }

  hide() {
    this.el.classList.remove('on');
    this.shown = false;
  }

  dispose() {
    this.hide();
    this.el.remove();
  }
}
