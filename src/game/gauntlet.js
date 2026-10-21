/**
 * GAUNTLET — a run of three escalating fixtures, not a single match.
 *
 * The mode's identity is the *run*: each rung tightens a different dial (clock, scoring window,
 * then the Gamebreaker meter), the crew you face gets stronger, and you carry two lives through
 * the whole thing. State lives in the save file, so a run survives a refresh — a "mode" that
 * forgets where you were after one reload is a menu entry, not a mode.
 *
 * Pure data + pure functions: no DOM, no sim import. The match itself is built by the app from
 * `gauntletMatch`, which is what keeps the rung rules identical to the ones the tests assert.
 */

import { TEAMS, TEAM_BY_ID, teamOverall } from '../data/teams.js';
import { RULES } from '../data/constants.js';

/** Lives a run starts with. Two losses and the run is over. */
export const GAUNTLET_LIVES = 2;

/**
 * The three rungs. `rules` are merged over the player's mode rules, so a rung only states what it
 * changes — exactly like the mode table itself.
 */
export const GAUNTLET_RUNGS = [
  {
    n: 1,
    id: 'surge',
    label: 'RUNG 1 · SURGE',
    tagline: 'A short clock and a short bench.',
    detail: 'Ninety second halves, a ten second shot clock and two substitutions. First to three, nobody gets to settle.',
    rules: {
      halves: 2,
      halfLength: 90,
      possessionClock: 10,
      targetGoals: 3,
      mercyLead: 99,
      subsPerTeam: 2,
      warmupDuration: 4,
      halftimeDuration: 2,
      resetDuration: 1.2,
    },
  },
  {
    n: 2,
    id: 'apex',
    label: 'RUNG 2 · APEX',
    tagline: 'The low rings are gone.',
    detail: 'Top window only, and the first crew through it wins the rung. A Gamebreaker through the orange ring is worth six on the way.',
    rules: {
      halves: 2,
      halfLength: 90,
      goalWindows: [0],
      targetGoals: 1,
      mercyLead: 99,
      possessionClock: 16,
      gbPoints: 6,
      gamebreakerMeterMax: 5200,
      warmupDuration: 4,
      halftimeDuration: 1.5,
    },
  },
  {
    n: 3,
    id: 'blackout',
    label: 'RUNG 3 · BLACKOUT',
    tagline: 'The meter is dead. The referee is not.',
    detail: 'A legend crew, no Gamebreaker for either side, a tight whistle and the full clock. Win it with structure.',
    rules: {
      halves: 2,
      halfLength: 150,
      possessionClock: 15,
      mercyLead: 99,
      gamebreakerMeterMax: 1000000,
      foulCallChance: 0.85,
      warmupDuration: 5,
      halftimeDuration: 2.5,
    },
  },
];

/**
 * Stable strength order: weakest first, ties broken by id.
 *
 * The crew ratings sit in a narrow band, so a plain sort leaves equal crews in whatever order the
 * roster happened to be in — which would make a run non-reproducible. The id tie-break keeps the
 * ladder the same on every machine and in every session.
 */
function byStrength(a, b) {
  const diff = teamOverall(a) - teamOverall(b);
  return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
}

/** Crews weakest-first, which is the order the rungs climb. */
export function crewsByStrength() {
  return [...TEAMS].sort(byStrength);
}

/** The crew a rung puts in the water, excluding the player's own. */
export function gauntletOpponent(run, teams = TEAMS) {
  const pool = teams.filter((t) => t.id !== run?.teamId).sort(byStrength);
  if (!pool.length) return teams[0];
  // Weakest → middle → strongest. A run is meant to be lost at the top, not at the door.
  const stage = Math.min(GAUNTLET_RUNGS.length - 1, Math.max(0, run?.stage || 0));
  const index = stage === 0 ? 0 : stage === 1 ? Math.floor((pool.length - 1) / 2) : pool.length - 1;
  return pool[index] || pool[0];
}

/** Difficulty climbs with the rung, floored by whatever the player chose. */
const RUNG_DIFFICULTY = ['pro', 'pro', 'legend'];

/** A fresh run for one crew. */
export function createGauntletRun(teamId, { difficulty = 'pro', seed = null } = {}) {
  return {
    teamId: TEAM_BY_ID[teamId] ? teamId : TEAMS[0].id,
    stage: 0,
    lives: GAUNTLET_LIVES,
    wins: 0,
    losses: 0,
    cleared: false,
    over: false,
    difficulty,
    seed: Number.isInteger(seed) ? seed >>> 0 : null,
    results: [],
  };
}

/** The rung currently being played, or null once the run has nothing left. */
export function gauntletRung(run) {
  if (!run || run.over || run.cleared) return null;
  return GAUNTLET_RUNGS[Math.min(GAUNTLET_RUNGS.length - 1, Math.max(0, run.stage || 0))] || null;
}

/**
 * The next match of a run: crews, rules, difficulty and the copy the screen shows.
 * Returns null when the run has no rung left to play.
 */
export function gauntletMatch(run, teams = TEAMS, base = RULES) {
  const rung = gauntletRung(run);
  if (!rung) return null;
  const home = TEAM_BY_ID[run.teamId] || teams[0];
  const away = gauntletOpponent(run, teams);
  return {
    home,
    away,
    difficulty: RUNG_DIFFICULTY[Math.min(RUNG_DIFFICULTY.length - 1, run.stage)] || run.difficulty || 'pro',
    rules: { ...base, ...rung.rules },
    rung,
    stage: run.stage,
    totalRungs: GAUNTLET_RUNGS.length,
    lives: run.lives,
  };
}

/**
 * Fold one finished match into a run.
 *
 * A win clears the rung, a loss spends a life, and a draw is a draw: no credit, no life — the rung
 * is simply replayed (the target-goal rungs make a draw rare, but a one-period rung can go 0–0).
 * Mutates the run, which is the saved object, and returns a summary for the results screen.
 *
 * @param {Object} run
 * @param {{ won: boolean, draw?: boolean, score?: number[] }} result
 */
export function applyGauntletResult(run, { won, draw = false, score = [0, 0] } = {}) {
  if (!run || run.over || run.cleared) {
    return { advanced: false, retry: false, complete: false, over: true, summary: 'RUN OVER' };
  }
  const stage = run.stage;
  const rung = GAUNTLET_RUNGS[Math.min(GAUNTLET_RUNGS.length - 1, Math.max(0, stage))];
  const clean = !!won && !draw;
  run.results.push({ stage, rung: rung.id, won: clean, draw: !!draw && !won, score: [...score] });

  if (clean) {
    run.wins += 1;
    run.stage += 1;
    if (run.stage >= GAUNTLET_RUNGS.length) {
      run.cleared = true;
      run.over = true;
      return { advanced: true, retry: false, complete: true, over: true, summary: 'GAUNTLET CLEARED · ALL THREE RUNGS' };
    }
    return {
      advanced: true,
      retry: false,
      complete: false,
      over: false,
      summary: `${rung.label} CLEARED · ${run.stage + 1} OF ${GAUNTLET_RUNGS.length}`,
    };
  }

  if (draw) {
    return { advanced: false, retry: true, complete: false, over: false, summary: `${rung.label} DRAWN · THE RUNG REPLAYS` };
  }

  run.losses += 1;
  run.lives = Math.max(0, run.lives - 1);
  if (run.lives <= 0) {
    run.over = true;
    return {
      advanced: false,
      retry: false,
      complete: false,
      over: true,
      summary: `RUN OVER · ${run.wins} OF ${GAUNTLET_RUNGS.length} RUNGS CLEARED`,
    };
  }
  return {
    advanced: false,
    retry: true,
    complete: false,
    over: false,
    summary: `${rung.label} LOST · ${run.lives} LIFE${run.lives === 1 ? '' : 'S'} LEFT`,
  };
}

/** How far a run got, for the hub and the save. */
export function gauntletProgress(run) {
  if (!run) return null;
  return {
    stage: Math.min(GAUNTLET_RUNGS.length, run.stage || 0),
    total: GAUNTLET_RUNGS.length,
    wins: run.wins || 0,
    losses: run.losses || 0,
    lives: run.lives ?? GAUNTLET_LIVES,
    cleared: !!run.cleared,
    over: !!run.over,
    label: run.cleared
      ? 'CLEARED'
      : run.over
        ? 'RUN OVER'
        : GAUNTLET_RUNGS[Math.min(GAUNTLET_RUNGS.length - 1, run.stage || 0)].label,
  };
}

/** A saved run that no longer makes sense (older build, hand-edited save) is discarded. */
export function sanitizeGauntletRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!TEAM_BY_ID[raw.teamId]) return null;
  const stage = Number.isInteger(raw.stage) ? Math.max(0, Math.min(GAUNTLET_RUNGS.length, raw.stage)) : 0;
  if (stage >= GAUNTLET_RUNGS.length && !raw.cleared) return null;
  return {
    teamId: raw.teamId,
    stage,
    lives: Number.isInteger(raw.lives) ? Math.max(0, Math.min(GAUNTLET_LIVES, raw.lives)) : GAUNTLET_LIVES,
    wins: Number.isInteger(raw.wins) && raw.wins >= 0 ? raw.wins : 0,
    losses: Number.isInteger(raw.losses) && raw.losses >= 0 ? raw.losses : 0,
    cleared: !!raw.cleared,
    over: !!raw.over,
    difficulty: ['easy', 'pro', 'legend'].includes(raw.difficulty) ? raw.difficulty : 'pro',
    seed: Number.isInteger(raw.seed) ? raw.seed >>> 0 : null,
    results: Array.isArray(raw.results) ? raw.results.slice(-8) : [],
  };
}
