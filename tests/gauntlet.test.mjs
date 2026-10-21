/**
 * GAUNTLET — the run engine's tests.
 *
 * A gauntlet is only a mode if the run actually behaves like one: the rungs must escalate, the
 * rules on a rung must reach the simulation, a loss must cost a life, and a run must survive a
 * round trip through the save file. These tests assert exactly that.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchSim } from '../src/game/match.js';
import { TEAMS, TEAM_BY_ID, teamOverall } from '../src/data/teams.js';
import { ARENA } from '../src/data/constants.js';
import {
  GAUNTLET_LIVES,
  GAUNTLET_RUNGS,
  applyGauntletResult,
  createGauntletRun,
  crewsByStrength,
  gauntletMatch,
  gauntletOpponent,
  gauntletProgress,
  gauntletRung,
  sanitizeGauntletRun,
} from '../src/game/gauntlet.js';

const DT = 1 / 60;

function toLive(s) {
  let guard = 0;
  while (s.state !== 'live' && guard++ < 60 * 30) s.step(DT);
  return s;
}

test('a fresh run starts on rung one with two lives and nothing cleared', () => {
  const run = createGauntletRun(TEAMS[0].id);
  assert.equal(run.stage, 0);
  assert.equal(run.lives, GAUNTLET_LIVES);
  assert.equal(run.wins, 0);
  assert.equal(run.losses, 0);
  assert.equal(run.cleared, false);
  assert.equal(run.over, false);
  assert.equal(gauntletRung(run).id, 'surge');
});

test('the rungs escalate: harder crew, tighter clock, fewer tools', () => {
  const run = createGauntletRun(TEAMS[0].id);
  const first = gauntletMatch(run, TEAMS);
  const second = gauntletMatch({ ...run, stage: 1 }, TEAMS);
  const third = gauntletMatch({ ...run, stage: 2 }, TEAMS);
  // The crew ladder is narrow, so the escalation is asserted on the position in the ladder
  // rather than on a single rating point: rung one is the bottom of the pool, rung two the
  // middle, rung three the champion.
  const ladder = crewsByStrength().filter((t) => t.id !== TEAMS[0].id);
  const position = (team) => ladder.findIndex((t) => t.id === team.id);
  assert.ok(position(first.away) < position(second.away), 'rung two faces a stronger crew');
  assert.ok(position(second.away) < position(third.away), 'rung three faces the strongest');
  assert.ok(first.rules.halfLength < third.rules.halfLength, 'the last rung plays the full clock');
  assert.ok(second.rules.goalWindows.length === 1, 'rung two scores through one window only');
  assert.ok(third.rules.gamebreakerMeterMax >= 100000, 'rung three kills the Gamebreaker meter');
  assert.equal(first.difficulty, 'pro');
  assert.equal(third.difficulty, 'legend');
});

test('the crew ladder is ordered weakest first', () => {
  const ordered = crewsByStrength();
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(teamOverall(ordered[i]) >= teamOverall(ordered[i - 1]), 'the ladder climbs');
  }
});

test('the player never faces its own crew', () => {
  const run = createGauntletRun(TEAMS[0].id);
  for (let stage = 0; stage < GAUNTLET_RUNGS.length; stage++) {
    const opponent = gauntletOpponent({ ...run, stage }, TEAMS);
    assert.notEqual(opponent.id, TEAMS[0].id);
    assert.ok(TEAM_BY_ID[opponent.id]);
  }
});

test('a rung rule reaches the simulation, not just the screen', () => {
  const run = createGauntletRun(TEAMS[0].id);
  const fixture = gauntletMatch({ ...run, stage: 1 }, TEAMS);
  const sim = new MatchSim({
    home: fixture.home,
    away: fixture.away,
    difficulty: fixture.difficulty,
    seed: 7,
    rules: fixture.rules,
  });
  toLive(sim);
  assert.deepEqual(sim.rules.goalWindows, [0], 'rung two only scores through the top window');
  assert.equal(sim.rules.targetGoals, 1);

  // A ball through a low ring is dead in this rung; the top ring still scores.
  const goalX = -ARENA.goalX * sim.attackDir(0);
  const low = sim.checkGoalCrossing(
    { x: goalX + 0.4, y: ARENA.zone.lowY, z: ARENA.zone.lowSpread },
    { x: goalX - 0.4, y: ARENA.zone.lowY, z: ARENA.zone.lowSpread },
  );
  assert.equal(low, null, 'the low rings are dead on rung two');
  const top = sim.checkGoalCrossing(
    { x: goalX + 0.4, y: ARENA.zone.topY, z: 0 },
    { x: goalX - 0.4, y: ARENA.zone.topY, z: 0 },
  );
  assert.equal(top, 0, 'the top ring still counts');
});

test('a win clears the rung and moves the run on', () => {
  const run = createGauntletRun(TEAMS[0].id);
  const result = applyGauntletResult(run, { won: true, score: [3, 1] });
  assert.equal(result.advanced, true);
  assert.equal(result.complete, false);
  assert.equal(result.over, false);
  assert.equal(run.stage, 1);
  assert.equal(run.wins, 1);
  assert.equal(run.lives, GAUNTLET_LIVES, 'a win costs no life');
  assert.match(result.summary, /RUNG 1/);
  assert.equal(gauntletRung(run).id, 'apex');
});

test('clearing the third rung ends the run as cleared', () => {
  const run = createGauntletRun(TEAMS[0].id);
  applyGauntletResult(run, { won: true });
  applyGauntletResult(run, { won: true });
  const last = applyGauntletResult(run, { won: true });
  assert.equal(last.complete, true);
  assert.equal(last.over, true);
  assert.equal(run.cleared, true);
  assert.equal(run.stage, GAUNTLET_RUNGS.length);
  assert.equal(gauntletRung(run), null, 'a cleared run has no rung left');
  assert.match(last.summary, /CLEARED/);
});

test('a loss spends a life and the second loss ends the run', () => {
  const run = createGauntletRun(TEAMS[0].id);
  const first = applyGauntletResult(run, { won: false, score: [0, 3] });
  assert.equal(first.retry, true);
  assert.equal(first.over, false);
  assert.equal(run.lives, GAUNTLET_LIVES - 1);
  assert.equal(run.losses, 1);
  assert.equal(run.stage, 0, 'a lost rung is replayed');

  const second = applyGauntletResult(run, { won: false, score: [0, 3] });
  assert.equal(second.over, true);
  assert.equal(run.over, true);
  assert.equal(run.lives, 0);
  assert.equal(gauntletRung(run), null);
  assert.match(second.summary, /RUN OVER/);
});

test('a draw replays the rung without costing a life', () => {
  const run = createGauntletRun(TEAMS[0].id);
  const drawn = applyGauntletResult(run, { won: false, draw: true, score: [2, 2] });
  assert.equal(drawn.retry, true);
  assert.equal(drawn.advanced, false);
  assert.equal(run.lives, GAUNTLET_LIVES, 'a draw costs nothing');
  assert.equal(run.losses, 0, 'and it is not a loss');
  assert.equal(run.stage, 0);
  assert.match(drawn.summary, /DRAWN/);
});

test('a finished run ignores further results', () => {
  const run = createGauntletRun(TEAMS[0].id);
  applyGauntletResult(run, { won: false });
  applyGauntletResult(run, { won: false });
  const extra = applyGauntletResult(run, { won: true });
  assert.equal(extra.advanced, false);
  assert.equal(extra.over, true);
  assert.equal(run.wins, 0, 'a dead run does not score');
});

test('progress describes where the run stands', () => {
  const run = createGauntletRun(TEAMS[0].id);
  assert.deepEqual(
    { stage: gauntletProgress(run).stage, total: gauntletProgress(run).total, wins: gauntletProgress(run).wins },
    { stage: 0, total: GAUNTLET_RUNGS.length, wins: 0 },
  );
  applyGauntletResult(run, { won: true });
  const mid = gauntletProgress(run);
  assert.equal(mid.stage, 1);
  assert.equal(mid.wins, 1);
  assert.equal(mid.label, GAUNTLET_RUNGS[1].label);
  applyGauntletResult(run, { won: true });
  applyGauntletResult(run, { won: true });
  assert.equal(gauntletProgress(run).label, 'CLEARED');
});

test('a saved run survives the round trip, and a broken one is discarded', () => {
  const run = createGauntletRun(TEAMS[0].id);
  applyGauntletResult(run, { won: true });
  const clean = sanitizeGauntletRun(JSON.parse(JSON.stringify(run)));
  assert.equal(clean.stage, 1);
  assert.equal(clean.lives, GAUNTLET_LIVES);
  assert.equal(clean.wins, 1);
  assert.equal(clean.teamId, TEAMS[0].id);

  assert.equal(sanitizeGauntletRun(null), null);
  assert.equal(sanitizeGauntletRun({ teamId: 'NOT_A_CREW' }), null);
  assert.equal(sanitizeGauntletRun({ teamId: TEAMS[0].id, stage: 99 }), null, 'a run past the last rung is nonsense');

  const clamped = sanitizeGauntletRun({ teamId: TEAMS[0].id, stage: -4, lives: 99, difficulty: 'godlike' });
  assert.equal(clamped.stage, 0);
  assert.equal(clamped.lives, GAUNTLET_LIVES);
  assert.equal(clamped.difficulty, 'pro');
});
