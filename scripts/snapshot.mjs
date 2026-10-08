/**
 * Deterministic behavior snapshot for the match sim.
 *
 * The sim is seeded and headless, so a fixed set of seeds plays a fixed match: scoreline, length,
 * stats and event census. Committing that as a baseline turns "did this change behavior?" into a
 * test (tests/golden.test.mjs) instead of a manual sweep — the check that caught the
 * `diff.tactleRate` extraction bug, automated. Rebalances are expected to move it; regenerating
 * the baseline is then a deliberate, reviewable act.
 *
 * Usage:
 *   node scripts/snapshot.mjs            # print the current snapshot as JSON
 *   node scripts/snapshot.mjs --update   # rewrite tests/golden/sim-baseline.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MatchSim } from '../src/game/match.js';
import { TEAMS } from '../src/data/teams.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = path.join(here, '..', 'tests', 'golden', 'sim-baseline.json');

/** One fixed seed per behavior family worth protecting: CPU-vs-CPU, the user-controlled path, and
 * the hardest difficulty (whose tuning multipliers are the easiest thing to break by typo). */
export const CASES = [
  { seed: 1000, difficulty: 'pro', userTeam: null },
  { seed: 777, difficulty: 'pro', userTeam: 0 },
  { seed: 4242, difficulty: 'legend', userTeam: null },
];

/** Play one case to full time (or the same 30-minute ceiling the balance sweep uses). */
export function runCase({ seed, difficulty, userTeam }) {
  const home = TEAMS[seed % TEAMS.length];
  const away = TEAMS[(seed * 3 + 1) % TEAMS.length];
  const sim = new MatchSim({ home, away, difficulty, seed, userTeam });
  const census = {};
  sim.events.on('*', (type) => { census[type] = (census[type] || 0) + 1; });
  const dt = 1 / 60;
  let steps = 0;
  const maxSteps = 60 * 60 * 30;
  while (sim.state !== 'over' && steps < maxSteps) { sim.step(dt); steps++; }
  return {
    home: home.abbr,
    away: away.abbr,
    seed,
    difficulty,
    userTeam,
    score: sim.score,
    seconds: +sim.time.toFixed(2),
    finished: sim.state === 'over',
    overtime: sim.overtime,
    stats: { ...sim.stats },
    census,
  };
}

export function collectSnapshot() {
  return { version: 1, cases: CASES.map(runCase) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const snapshot = collectSnapshot();
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (process.argv.includes('--update')) {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(BASELINE_PATH, text);
    console.log(`wrote ${path.relative(process.cwd(), BASELINE_PATH)} (${snapshot.cases.length} cases)`);
    for (const c of snapshot.cases) {
      console.log(`  ${c.home} ${c.score[0]}-${c.score[1]} ${c.away}  ${c.seconds.toFixed(0)}s  ${c.finished ? 'complete' : 'TIMEOUT'}  seed=${c.seed} ${c.difficulty}`);
    }
  } else {
    process.stdout.write(text);
  }
}
