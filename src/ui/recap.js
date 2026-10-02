import { buildReport, headline } from '../game/report.js';

/**
 * MATCH RECAP — the full-time story, above the box score.
 *
 * The results screen already had two full stat tables, which answer "what are the numbers" but
 * never "how did this match actually go". The recap answers that in one screen: a shot chart of
 * every goal in the order it happened, the ring split (the top ring is worth double, so where a
 * side's points came from is the difference between a team that finishes and one that doesn't),
 * the biggest hit of the night, and the discipline and bench bill.
 *
 * Built from the same report the halftime montage reads, so the two can never disagree.
 */
const RECAP_CSS = `
.recap {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 12px;
  margin: 12px 0 4px;
  text-align: left;
}
.recap-card {
  padding: 12px 14px 14px;
  border-radius: 14px;
  border: 2px solid rgba(255, 255, 255, 0.14);
  background: linear-gradient(180deg, rgba(14, 19, 32, 0.9), rgba(7, 10, 20, 0.94));
  font-family: var(--font-cond, sans-serif);
  color: #fff;
}
.recap-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-weight: 900;
  font-size: 12px;
  letter-spacing: 2.2px;
  color: rgba(255, 255, 255, 0.62);
  margin-bottom: 9px;
}
.recap-head em {
  font-style: normal;
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.4);
}
/* Shot chart: one pip per goal, in order, left to right, split by the two goals. */
.chart {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.chart-side {
  flex: 1;
  display: flex;
  flex-wrap: wrap-reverse;
  align-content: flex-end;
  gap: 4px;
  min-height: 34px;
  padding: 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 2px solid var(--c1, #fff);
}
.chart-side b {
  font-size: 11px;
  letter-spacing: 1.4px;
  color: var(--c1, #fff);
  align-self: center;
  margin-right: 2px;
}
.pip {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 9px;
  font-weight: 900;
  color: #06101a;
  background: var(--c1, #fff);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
}
.pip.top { background: var(--yellow, #ffd23f); }
.pip.gb { background: linear-gradient(135deg, #ff2d55, #ffd23f); color: #fff; }
.pip.own { background: #6b7280; color: #fff; }
.recap-empty {
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.4);
  padding: 6px;
}
.rings {
  display: grid;
  gap: 6px;
}
.ring-row {
  display: grid;
  grid-template-columns: 74px 1fr 34px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.2px;
}
.ring-bar {
  height: 10px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  display: flex;
}
.ring-bar i { display: block; height: 100%; }
.ring-n {
  text-align: right;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.85);
}
.recap-lines {
  display: grid;
  gap: 5px;
}
.recap-line {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.8px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.recap-line span { color: rgba(255, 255, 255, 0.6); }
.recap-line b { color: #fff; }
.recap-line.hit b { color: #ff6a8a; }
.recap-title {
  font-family: var(--font-cond, sans-serif);
  font-weight: 900;
  font-size: clamp(15px, 2.4vw, 22px);
  letter-spacing: 1px;
  text-align: center;
  margin: 2px 0 0;
  color: #fff;
}
@media (max-width: 720px) {
  .recap { grid-template-columns: 1fr; }
}
`;

const clock = (t) => `${Math.floor(t / 60)}'${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** The recap block, as an HTML string. */
export function RecapPanel(sim) {
  if (!document.getElementById('recap-styles')) {
    const style = document.createElement('style');
    style.id = 'recap-styles';
    style.textContent = RECAP_CSS;
    document.head.appendChild(style);
  }
  const r = buildReport(sim);
  const [a, b] = r.teams;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Shot chart: a pip per goal, ring-weighted. Top-ring and Gamebreaker goals stand out.
  const side = (t) => {
    const goals = r.goals.filter((g) => g.team === t.team);
    if (!goals.length) return `<div class="chart-side" style="--c1:${t.primary}"><b>${t.abbr}</b><span class="recap-empty">—</span></div>`;
    const pips = goals
      .slice()
      .reverse()
      .map((g) => {
        const cls = g.gb || g.type === 'gamebreaker' ? 'gb' : g.ownGoal ? 'own' : g.ring === 0 ? 'top' : '';
        return `<span class="pip ${cls}" title="${clock(g.t)} ${esc(g.nick)} +${g.points}">${g.points}</span>`;
      })
      .join('');
    return `<div class="chart-side" style="--c1:${t.primary}"><b>${t.abbr}</b>${pips}</div>`;
  };

  // Ring split: the two sides stacked so you can see who took the premium window.
  const maxRing = Math.max(1, ...r.teams.map((t) => t.rings.top + t.rings.blue + t.rings.white));
  const ringRow = (label, pick, total) => {
    const seg = r.teams.map((t) => {
      const n = pick(t);
      return n ? `<i style="width:${(n / maxRing) * 100}%;background:${t.primary}"></i>` : '';
    }).join('');
    return `<div class="ring-row"><span>${label}</span><span class="ring-bar">${seg}</span><span class="ring-n">${total}</span></div>`;
  };

  const lines = [];
  for (const t of r.teams) {
    const top = t.scorers[0];
    lines.push(`<div class="recap-line"><span>${t.abbr} · ${t.shots} SHOTS · ${t.accuracy}%</span><b>${top ? `${top.nick} ${top.points}` : 'no scorers'}</b></div>`);
  }
  if (r.biggest) {
    lines.push(`<div class="recap-line hit"><span>BIGGEST HIT · ${clock(r.biggest.t)}</span><b>${esc(r.biggest.hitter)} → ${esc(r.biggest.victim)}${r.biggest.fouled ? ' (foul)' : ''}</b></div>`);
  }
  if (r.run) {
    lines.push(`<div class="recap-line"><span>BIGGEST RUN</span><b>${r.teams[r.run.team].abbr} ×${r.run.count} in a row</b></div>`);
  }
  lines.push(`<div class="recap-line"><span>DISCIPLINE</span><b>${r.discipline.fouls} fouls · ${r.discipline.cards} booked${r.discipline.reds ? ` · ${r.discipline.reds} off` : ''} · ${r.discipline.subs} changes</b></div>`);

  return `
    <div class="recap-title">${esc(headline(sim, r))}</div>
    <div class="recap">
      <div class="recap-card">
        <div class="recap-head">SHOT CHART<em>every goal, in order</em></div>
        <div class="chart">${side(a)}${side(b)}</div>
        <div class="recap-head" style="margin-top:12px">HALVES<em>first / second</em></div>
        <div class="recap-lines">
          <div class="recap-line"><span>${a.abbr}</span><b>${r.halves[0][0]} / ${r.halves[0][1]}</b></div>
          <div class="recap-line"><span>${b.abbr}</span><b>${r.halves[1][0]} / ${r.halves[1][1]}</b></div>
        </div>
      </div>
      <div class="recap-card">
        <div class="recap-head">WHERE THE POINTS CAME FROM<em>top ring is worth 3</em></div>
        <div class="rings">
          ${ringRow('TOP RING', (t) => t.rings.top, `${a.rings.top} – ${b.rings.top}`)}
          ${ringRow('LOW RINGS', (t) => t.rings.blue + t.rings.white, `${a.rings.blue + a.rings.white} – ${b.rings.blue + b.rings.white}`)}
        </div>
        <div class="recap-head" style="margin-top:12px">THE MATCH<em>how it was won</em></div>
        <div class="recap-lines">${lines.join('')}</div>
      </div>
    </div>`;
}
