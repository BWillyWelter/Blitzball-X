/**
 * Headless balance report: plays a slate of CPU-vs-CPU matches and says what the current tuning
 * actually produced — not just that the games finished.
 *
 * `scripts/simulate.mjs` prints one line per game and is the quick "did I break the sim" check.
 * This one answers the balance questions that line-per-game cannot: how long matches last, how
 * close they are, whether the 3-point top ring is worth the risk, which crews the ladder favours,
 * and how often each kind of play actually happens. It also checks the accounting the match report
 * depends on (goal log + gamebreaker steals must add up to the final score), so a scoring bug
 * shows up as a failure rather than as an odd-looking average.
 *
 * Usage:
 *   node scripts/balance.mjs [--games 24] [--diff pro] [--seed 1000] [--json path] [--quiet]
 *   npm run balance -- --games 40 --diff legend --json balance-report.json
 *
 * Exits 1 when a match fails to finish, a value comes out non-finite, or the score accounting does
 * not reconcile — never on the shape of the numbers themselves, which is the thing being judged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MatchSim } from '../src/game/match.js';
import { TEAMS } from '../src/data/teams.js';
import { RULES, ARENA } from '../src/data/constants.js';

/** Event types worth counting per match, in report order. Everything else the sim emits is
 *  presentation chatter. */
export const CENSUS_KEYS = [
  'score', 'shot', 'save', 'block', 'post', 'turnover', 'violation', 'shotclock',
  'tackle', 'bighit', 'washed', 'knockdown', 'spearfail', 'pass', 'leadpass', 'alleyoop',
  'volleyshot', 'trick', 'breach', 'foul', 'card', 'sub', 'gbready', 'gamebreaker',
  'flow', 'overtime', 'halftime', 'horn',
];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(1) : 0);
const round1 = (n) => +n.toFixed(1);

/** Play one match to full time (or the same 30-minute ceiling the golden snapshot uses). */
export function playMatch({ home, away, difficulty = 'pro', seed = 1, userTeam = null, maxSteps = 60 * 60 * 30 }) {
  const sim = new MatchSim({ home, away, difficulty, seed, userTeam });
  const census = {};
  const stolenAgainst = [0, 0];
  sim.events.on('*', (type) => { census[type] = (census[type] || 0) + 1; });
  sim.events.on('score', ({ team, stolen }) => {
    if (stolen) stolenAgainst[1 - team] += stolen;
  });
  const dt = 1 / 60;
  let steps = 0;
  while (sim.state !== 'over' && steps < maxSteps) { sim.step(dt); steps++; }
  const goalPoints = [0, 0];
  for (const g of sim.goalLog) goalPoints[g.team] += g.points;
  return {
    home: home.abbr,
    away: away.abbr,
    seed,
    difficulty,
    score: [...sim.score],
    winner: sim.state === 'over' ? sim.winner : null,
    seconds: round1(sim.time),
    finished: sim.state === 'over',
    overtime: !!sim.overtime,
    margin: Math.abs(sim.score[0] - sim.score[1]),
    // Goals (not points): the ring split counts goals, so this is what it must reconcile with.
    goalCount: sim.goalLog.length,
    // Goals per ring window, index 0 = the 3-point top ring.
    rings: sim.ringGoals.map((r) => [...r]),
    cards: [sim.cards[0].length, sim.cards[1].length],
    reds: [sim.cards[0].filter((c) => c.player.sentOff).length, sim.cards[1].filter((c) => c.player.sentOff).length],
    stats: { ...sim.stats },
    census,
    // The scoring audit: banked points minus what gamebreakers stole must equal the score.
    goalPoints,
    stolenAgainst,
  };
}

/** Aggregate a slate of matches into the balance picture. Pure: matches in, plain data out. */
export function summarize(matches, { difficulty = 'pro' } = {}) {
  const games = matches.length;
  const problems = [];
  const goalsPerMatch = matches.map((m) => m.score[0] + m.score[1]);
  const margins = matches.map((m) => m.margin);
  const seconds = matches.map((m) => m.seconds);

  // Accounting: the goal log and the steal ledger are two independent records of the same match,
  // so they must agree with the score the sim reports.
  for (const m of matches) {
    for (const t of [0, 1]) {
      const expected = m.goalPoints[t] - m.stolenAgainst[t];
      if (m.score[t] !== expected) {
        problems.push(`${m.home} ${m.score[0]}-${m.score[1]} ${m.away} (seed ${m.seed}): `
          + `team ${t} scored ${m.goalPoints[t]} - ${m.stolenAgainst[t]} stolen = ${expected}, but the score says ${m.score[t]}`);
      }
    }
    if (!Number.isFinite(m.seconds) || m.score.some((s) => !Number.isFinite(s))) {
      problems.push(`${m.home} vs ${m.away} (seed ${m.seed}): non-finite score/time`);
    }
    if (!m.finished) problems.push(`${m.home} vs ${m.away} (seed ${m.seed}): did not finish in ${m.seconds}s`);
    // The ring split and the goal log are both written per goal: they must agree, always.
    const ringGoals = m.rings[0].reduce((a, b) => a + b, 0) + m.rings[1].reduce((a, b) => a + b, 0);
    if (ringGoals !== m.goalCount) {
      problems.push(`${m.home} vs ${m.away} (seed ${m.seed}): ${m.goalCount} goals logged but ${ringGoals} in the ring split`);
    }
  }
  if (games && !matches.some((m) => m.stats.shots > 0)) {
    problems.push('no shots were taken in any match — the sim never got going');
  }

  // Ring split, in points: the top ring pays 3, the two low rings 1 each (gamebreakers are their
  // own flat payout and land on ring 0, which is why this is read as a share, not an audit).
  const ringGoals = [0, 0, 0];
  for (const m of matches) for (let r = 0; r < 3; r++) ringGoals[r] += m.rings[0][r] + m.rings[1][r];
  const ringPoints = [ringGoals[0] * RULES.topRingPoints, ringGoals[1] * RULES.goalPoints, ringGoals[2] * RULES.goalPoints];
  const ringTotal = ringPoints.reduce((a, b) => a + b, 0);

  // Per-crew table: the ladder only works if the crews are roughly comparable.
  const teams = new Map();
  const touch = (abbr) => {
    if (!teams.has(abbr)) teams.set(abbr, { abbr, games: 0, wins: 0, losses: 0, ties: 0, goalsFor: 0, goalsAgainst: 0 });
    return teams.get(abbr);
  };
  for (const m of matches) {
    for (const [t, own] of [[0, m.home], [1, m.away]]) {
      const row = touch(own);
      row.games++;
      row.goalsFor += m.score[t];
      row.goalsAgainst += m.score[1 - t];
      if (m.winner === null) row.ties++;
      else if (m.winner === t) row.wins++;
      else row.losses++;
    }
  }
  const table = [...teams.values()]
    .map((r) => ({ ...r, winPct: pct(r.wins, r.games), diff: r.goalsFor - r.goalsAgainst }))
    .sort((a, b) => b.winPct - a.winPct || b.diff - a.diff);

  const events = {};
  for (const key of CENSUS_KEYS) {
    const total = matches.reduce((n, m) => n + (m.census[key] || 0), 0);
    if (total) events[key] = { total, perMatch: +((total / games) || 0).toFixed(2) };
  }

  return {
    difficulty,
    games,
    finished: matches.filter((m) => m.finished).length,
    seconds: { mean: round1(mean(seconds)), min: round1(Math.min(...seconds)), max: round1(Math.max(...seconds)) },
    overtime: { games: matches.filter((m) => m.overtime).length, pct: pct(matches.filter((m) => m.overtime).length, games) },
    goals: {
      perMatch: round1(mean(goalsPerMatch)),
      perTeam: round1(mean(goalsPerMatch) / 2),
      min: Math.min(...goalsPerMatch),
      max: Math.max(...goalsPerMatch),
      teamSplit: [round1(mean(matches.map((m) => m.score[0]))), round1(mean(matches.map((m) => m.score[1])))],
    },
    margin: {
      mean: round1(mean(margins)),
      closest: Math.min(...margins),
      widest: Math.max(...margins),
      oneGoalPct: pct(margins.filter((d) => d <= 1).length, games),
      blowoutPct: pct(margins.filter((d) => d >= RULES.mercyLead * 0.5).length, games),
    },
    rings: {
      goals: ringGoals,
      points: ringPoints,
      topSharePct: pct(ringPoints[0], ringTotal),
      blueSharePct: pct(ringPoints[1], ringTotal),
      whiteSharePct: pct(ringPoints[2], ringTotal),
    },
    averages: {
      shots: round1(mean(matches.map((m) => m.stats.shots))),
      saves: round1(mean(matches.map((m) => m.stats.saves))),
      // Goals per shot, over the whole slate (not the mean of per-match ratios, which would
      // over-weight matches with only a couple of attempts).
      goalsPerShotPct: pct(matches.reduce((n, m) => n + m.goalCount, 0), matches.reduce((n, m) => n + m.stats.shots, 0)),
      possessions: round1(mean(matches.map((m) => m.stats.possessions))),
      fouls: round1(mean(matches.map((m) => m.stats.fouls))),
      cards: round1(mean(matches.map((m) => m.cards[0] + m.cards[1]))),
      reds: round1(mean(matches.map((m) => m.reds[0] + m.reds[1]))),
      subs: round1(mean(matches.map((m) => m.stats.subs))),
    },
    teams: table,
    events,
    problems,
  };
}

/** Human-readable report. Column-aligned so two runs can be diffed by eye. */
export function formatReport(summary) {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (n, n2 = 6) => String(n).padStart(n2);
  const out = [];
  const line = (s = '') => out.push(s);

  line(`BALANCE REPORT — ${summary.games} CPU matches at ${summary.difficulty.toUpperCase()}`);
  line(`finished ${summary.finished}/${summary.games}   length: mean ${summary.seconds.mean}s (${summary.seconds.min}–${summary.seconds.max})   overtime ${summary.overtime.games} (${summary.overtime.pct}%)`);
  line(`goals/match ${summary.goals.perMatch} (${summary.goals.min}–${summary.goals.max})   home ${summary.goals.teamSplit[0]} / away ${summary.goals.teamSplit[1]}`);
  line(`margin: mean ${summary.margin.mean}   one-goal games ${summary.margin.oneGoalPct}%   blowouts ${summary.margin.blowoutPct}%   closest ${summary.margin.closest} / widest ${summary.margin.widest}`);
  line();
  line('SHOT QUALITY');
  line(`  shots/match ${num(summary.averages.shots)}   goals per shot ${num(summary.averages.goalsPerShotPct, 5)}%   saves/match ${num(summary.averages.saves)}`);
  line(`  possessions/match ${num(summary.averages.possessions)}   fouls ${num(summary.averages.fouls)}   cards ${num(summary.averages.cards)}   reds ${num(summary.averages.reds)}   subs ${num(summary.averages.subs)}`);
  line();
  line('WHERE THE POINTS CAME FROM (ring split)');
  const names = ARENA.zone.rings.map((r) => `${r.name} (${r.pts})`);
  summary.rings.goals.forEach((g, i) => {
    line(`  ${pad(names[i], 14)} ${num(g, 5)} goals   ${num(summary.rings.points[i], 6)} pts   ${num([summary.rings.topSharePct, summary.rings.blueSharePct, summary.rings.whiteSharePct][i], 5)}%`);
  });
  line();
  line('CREWS');
  line(`  ${pad('', 6)}${pad('G', 4)}${pad('W', 4)}${pad('L', 4)}${pad('T', 4)}${num('win%')}${num('GF')}${num('GA')}${num('diff')}`);
  for (const t of summary.teams) {
    line(`  ${pad(t.abbr, 6)}${pad(t.games, 4)}${pad(t.wins, 4)}${pad(t.losses, 4)}${pad(t.ties, 4)}${num(t.winPct)}${num(t.goalsFor)}${num(t.goalsAgainst)}${num(t.diff)}`);
  }
  line();
  line('EVENT RATES (per match)');
  const entries = Object.entries(summary.events);
  for (let i = 0; i < entries.length; i += 4) {
    line(`  ${entries.slice(i, i + 4).map(([k, v]) => `${k} ${v.perMatch}`.padEnd(17)).join('')}`.trimEnd());
  }
  if (summary.problems.length) {
    line();
    line(`PROBLEMS (${summary.problems.length})`);
    for (const p of summary.problems) line(`  - ${p}`);
  }
  return `${out.join('\n')}\n`;
}

/** The seeded slate: a round-robin-ish sweep, same pairing rule as scripts/simulate.mjs so the two
 *  tools stay comparable run for run. */
export function slate(games, seed = 1000) {
  const out = [];
  for (let i = 0; i < games; i++) {
    out.push({
      home: TEAMS[i % TEAMS.length],
      away: TEAMS[(i * 3 + 1) % TEAMS.length],
      seed: seed + i,
    });
  }
  return out;
}

function parseArgs(argv) {
  const opts = { games: 24, diff: 'pro', seed: 1000, json: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--games') opts.games = parseInt(argv[++i], 10);
    else if (a === '--diff') opts.diff = argv[++i];
    else if (a === '--seed') opts.seed = parseInt(argv[++i], 10);
    else if (a === '--json') opts.json = argv[++i] || 'balance-report.json';
    else if (a === '--quiet') opts.quiet = true;
  }
  return opts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const games = slate(opts.games, opts.seed);
  const matches = [];
  for (const g of games) {
    const m = playMatch({ home: g.home, away: g.away, difficulty: opts.diff, seed: g.seed });
    matches.push(m);
    if (!opts.quiet) {
      process.stdout.write(`  ${m.home} ${m.score[0]}-${m.score[1]} ${m.away}  ${String(m.seconds).padStart(5)}s`
        + `${m.overtime ? ' OT' : ''}  shots ${String(m.stats.shots).padStart(3)}  hit ${String(m.census.bighit || 0).padStart(2)}`
        + `  foul ${String(m.stats.fouls).padStart(2)}${m.finished ? '' : '  TIMEOUT'}\n`);
    }
  }
  const summary = summarize(matches, { difficulty: opts.diff });
  process.stdout.write(`\n${formatReport(summary)}`);
  if (opts.json) {
    const payload = { version: 1, generatedFor: { ...opts }, matches, summary };
    fs.writeFileSync(opts.json, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(`wrote ${opts.json}\n`);
  }
  process.exit(summary.problems.length ? 1 : 0);
}
