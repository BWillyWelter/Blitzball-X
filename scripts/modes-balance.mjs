/**
 * MODE BALANCE — does each mode actually produce the match its card promises?
 *
 * A mode is a rule snapshot, and a rule snapshot can be wrong in ways a unit test cannot see:
 * a "first to 3" that no crew reaches, a top-ring-only mode that ends 0–0, a sixty-second Blitz
 * that never gets going. This script plays each mode headlessly, CPU vs CPU, and prints the
 * numbers the cards are written from.
 *
 *   node scripts/modes-balance.mjs [matches-per-mode] [seed]
 *
 * It is deliberately informational (no exit code on a soft miss) except for the hard checks:
 * every match has to finish, and every "first to N" objective has to be reachable.
 */
import { MatchSim } from '../src/game/match.js';
import { MODES, MODE_ORDER, rulesFor } from '../src/game/modes.js';
import { GAUNTLET_RUNGS } from '../src/game/gauntlet.js';
import { TEAMS } from '../src/data/teams.js';
import { RULES } from '../src/data/constants.js';

const runs = Math.max(1, parseInt(process.argv[2] || '6', 10));
const baseSeed = parseInt(process.argv[3] || '4000', 10);
const DT = 1 / 60;

function play(rules, seed, difficulty = 'pro') {
  const home = TEAMS[seed % TEAMS.length];
  const away = TEAMS[(seed * 3 + 2) % TEAMS.length];
  const sim = new MatchSim({ home, away, difficulty, seed, userTeam: null, rules });
  let steps = 0;
  while (sim.state !== 'over' && steps < 60 * 60 * 40) {
    sim.step(DT);
    steps += 1;
  }
  return {
    score: [...sim.score],
    goals: [...sim.goals],
    finished: sim.state === 'over',
    time: sim.time,
    ot: sim.overtime,
    topRingGoals: sim.ringGoals ? sim.ringGoals.reduce((sum, rings) => sum + rings[0], 0) : 0,
  };
}

function report(label, rules) {
  const games = [];
  for (let i = 0; i < runs; i++) games.push(play(rules, baseSeed + i * 17));
  const unfinished = games.filter((g) => !g.finished).length;
  const avgGoals = games.reduce((sum, g) => sum + g.goals[0] + g.goals[1], 0) / games.length;
  const margin = games.reduce((sum, g) => sum + Math.abs(g.goals[0] - g.goals[1]), 0) / games.length;
  const ot = games.filter((g) => g.ot).length;
  const target = Number(rules.targetGoals) || 0;
  const reached = target
    ? games.filter((g) => Math.max(g.goals[0], g.goals[1]) >= target).length
    : 0;
  const avgTime = games.reduce((sum, g) => sum + g.time, 0) / games.length;
  const top = games.reduce((sum, g) => sum + g.topRingGoals, 0) / games.length;
  const flags = [];
  if (unfinished) flags.push(`${unfinished} UNFINISHED`);
  if (target && reached === 0) flags.push('TARGET UNREACHABLE');
  if (target && reached === games.length) flags.push('TARGET ALWAYS HIT');
  if (!target && avgGoals < 1) flags.push('NO SCORING');
  return {
    label,
    avgGoals: avgGoals.toFixed(2),
    margin: margin.toFixed(2),
    avgTime: avgTime.toFixed(0),
    target,
    reached,
    ot,
    top: top.toFixed(2),
    flags,
    unfinished,
  };
}

const rows = [];
for (const id of MODE_ORDER) {
  if (id === 'custom' || id === 'watch') continue;
  rows.push(report(MODES[id].label, rulesFor(id, RULES)));
}
for (const rung of GAUNTLET_RUNGS) {
  rows.push(report(`GAUNTLET · ${rung.label}`, { ...RULES, ...rung.rules }));
}

const pad = (value, width) => String(value).padEnd(width);
console.log(`${pad('MODE', 30)} ${pad('GF/G', 6)} ${pad('MRG', 6)} ${pad('TIME', 6)} ${pad('TGT', 5)} ${pad('HIT', 7)} ${pad('OT', 4)} ${pad('TOPR', 6)} FLAGS`);
for (const row of rows) {
  console.log(`${pad(row.label, 30)} ${pad(row.avgGoals, 6)} ${pad(row.margin, 6)} ${pad(row.avgTime, 6)} ${pad(row.target, 5)} ${pad(row.reached ? `${row.reached}/${runs}` : '—', 7)} ${pad(row.ot, 4)} ${pad(row.top, 6)} ${row.flags.join(' · ')}`);
}

const broken = rows.filter((row) => row.unfinished || row.flags.includes('TARGET UNREACHABLE'));
if (broken.length) {
  console.error(`\n${broken.length} mode(s) need tuning: ${broken.map((r) => r.label).join(', ')}`);
  process.exit(1);
}
console.log(`\nAll ${rows.length} rule sets finish and every target is reachable.`);
