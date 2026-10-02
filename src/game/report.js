import { RULES, ARENA } from '../data/constants.js';

/**
 * MATCH REPORT — the story of a match, derived from sim state.
 *
 * The halftime montage and the full-time recap show the same numbers, and both should be
 * explaining what actually happened rather than dumping a stat table. This builds that once, from
 * state the sim has already recorded, so the two screens can never disagree with each other or
 * with the results tables below them.
 *
 * Pure: takes the sim, returns plain data. No DOM, no three.js, no RNG — so it is testable in
 * node and safe to call from anywhere.
 */

const RING_NAMES = ARENA.zone.rings.map((r) => r.name);

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

function topScorers(sim, team) {
  return sim.players
    .filter((p) => p.team === team && p.stats.goals > 0)
    .map((p) => ({ nick: p.data.nick, points: p.stats.goals, goals: p.stats.sog }))
    .sort((a, b) => b.points - a.points);
}

function teamLine(sim, team) {
  const own = sim.players.filter((p) => p.team === team);
  const shots = own.reduce((n, p) => n + p.stats.shots, 0);
  const sog = own.reduce((n, p) => n + p.stats.sog, 0);
  const saves = own.reduce((n, p) => n + p.stats.saves, 0);
  const rings = sim.ringGoals ? sim.ringGoals[team] : [0, 0, 0];
  return {
    team,
    name: `${sim.teams[team].city} ${sim.teams[team].name}`,
    abbr: sim.teams[team].abbr,
    primary: sim.teams[team].primary,
    accent: sim.teams[team].accent,
    shots,
    sog,
    saves,
    accuracy: pct(sog, shots),
    // Ring split: where the points came from. Index 0 is the top ring.
    rings: { top: rings[0] || 0, blue: rings[1] || 0, white: rings[2] || 0 },
    scorers: topScorers(sim, team),
    cards: sim.cards ? sim.cards[team].length : 0,
    // The cards log is the authoritative record: a red removes the swimmer from `sim.players`, so
    // counting the live roster and the log would double-count the same send-off.
    reds: sim.cards ? new Set(sim.cards[team].filter((c) => c.player.sentOff).map((c) => c.player.id)).size : 0,
  };
}

/**
 * Build the report. `upTo` limits the goal log to the first half, which is what the halftime
 * montage shows; the full-time recap passes nothing and gets everything.
 */
export function buildReport(sim, { half = 2 } = {}) {
  const goals = (sim.goalLog || []).filter((g) => g.half <= half);
  const halves = sim.halfScore || [[0, 0], [0, 0]];
  const teams = [teamLine(sim, 0), teamLine(sim, 1)];
  const hit = sim.biggestHit;
  const biggest = hit
    ? {
      ...hit,
      // A hit on a half that has not happened yet cannot be on the halftime card.
      relevant: half >= 2,
    }
    : null;

  // Biggest run: the longest unbroken streak of goals by one side, which is usually the thing
  // that decides a match and the thing a player wants explained at full time.
  let run = { team: -1, count: 0, from: 0, to: 0 };
  let cur = { team: -1, count: 0, from: 0 };
  for (const g of goals) {
    if (g.team === cur.team) cur.count++;
    else {
      if (cur.count > run.count) run = { team: cur.team, count: cur.count, from: cur.from, to: g.t };
      cur = { team: g.team, count: 1, from: g.t };
    }
  }
  if (cur.count > run.count && cur.count > 0) run = { team: cur.team, count: cur.count, from: cur.from, to: goals.length ? goals[goals.length - 1].t : 0 };

  return {
    score: [...sim.score],
    half,
    halves,
    goals,
    teams,
    biggest: half >= 2 ? biggest : null,
    run: run.count > 1 ? run : null,
    // Discipline and bench, the two new dimensions of the match.
    discipline: {
      fouls: sim.stats.fouls || 0,
      cards: sim.cards ? sim.cards[0].length + sim.cards[1].length : 0,
      reds: sim.cards ? sim.cards[0].filter((c) => c.player.sentOff).length + sim.cards[1].filter((c) => c.player.sentOff).length : 0,
      subs: sim.stats.subs || 0,
    },
    ringNames: RING_NAMES,
    finished: sim.state === 'over',
    mercy: sim.state === 'over' && Math.abs(sim.score[0] - sim.score[1]) >= RULES.mercyLead,
  };
}

/** One-line summary a headline can sit on. */
export function headline(sim, report) {
  const winner = sim.winner;
  const won = report.teams[winner] ? report.teams[winner].name : 'They';
  if (report.mercy) return `${won} won it on the mercy rule`;
  if (report.score[0] === report.score[1]) return 'Dead level — off to overtime';
  // Only hang the headline on the biggest hit when the hitter's side actually won it. Otherwise
  // the copy credits the winning team with a moment that belongs to the team that lost.
  if (report.biggest && report.biggest.team === winner) {
    return `${won} won on ${report.biggest.hitter}'s biggest hit of the night`;
  }
  if (report.run && report.run.team === winner && report.run.count >= 3) {
    return `${won} ran away with it — ${report.run.count} goals in a row`;
  }
  return `${won} take it`;
}
