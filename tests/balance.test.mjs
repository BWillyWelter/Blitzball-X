/**
 * Balance report: the aggregation, the crew table, and the accounting audit.
 *
 * This is the tool a rebalance is judged with, so its own maths has to be right — an average that
 * silently skips a match, or a crew table that double-counts a game, would send tuning the wrong
 * way. The audit is the part that must never go quiet: it is what turns "the numbers look odd" into
 * "the scoring path is broken".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { playMatch, slate, summarize } from '../scripts/balance.mjs';
import { formatReport } from '../scripts/balance.mjs';
import { TEAMS } from '../src/data/teams.js';

/**
 * A match record in the shape playMatch produces. The ledger is DERIVED from the ring split, since
 * the audit is strict — a hand-typed fixture that disagrees with itself would fail for the wrong
 * reason and hide the bug the audit exists to catch.
 */
function record(over = {}) {
  const rings = over.rings || [[2, 0, 0], [1, 0, 1]];
  const points = (t) => rings[t][0] * 3 + rings[t][1] + rings[t][2];
  const goalCount = rings[0].reduce((a, b) => a + b, 0) + rings[1].reduce((a, b) => a + b, 0);
  const score = over.score || [points(0), points(1)];
  return {
    home: 'AAA',
    away: 'BBB',
    seed: 1,
    difficulty: 'pro',
    seconds: 340,
    finished: true,
    overtime: false,
    cards: [0, 0],
    reds: [0, 0],
    stats: { possessions: 80, shots: 30, saves: 14, tricks: 10, hits: 2, tackles: 20, volleys: 1, fouls: 1, subs: 2 },
    census: { score: goalCount, shot: 30, save: 14 },
    winner: score[0] === score[1] ? null : (score[0] > score[1] ? 0 : 1),
    ...over,
    score,
    rings,
    goalCount: over.goalCount ?? goalCount,
    goalPoints: over.goalPoints || [points(0), points(1)],
    stolenAgainst: over.stolenAgainst || [0, 0],
    margin: over.margin ?? Math.abs(score[0] - score[1]),
  };
}

test('the slate never pairs a crew with itself and gives every crew both roles', () => {
  const games = slate(16, 1000);
  assert.equal(games.length, 16);
  assert.ok(games.every((g) => g.home.abbr !== g.away.abbr), 'a crew must never play itself');
  const roles = new Map();
  for (const g of games.slice(0, TEAMS.length)) {
    for (const abbr of [g.home.abbr, g.away.abbr]) roles.set(abbr, (roles.get(abbr) || 0) + 1);
  }
  assert.equal(roles.size, TEAMS.length, 'one full cycle must feature every crew');
  assert.ok([...roles.values()].every((n) => n === 2), 'each crew appears once as home and once as away');
  assert.deepEqual(games.map((g) => g.seed), Array.from({ length: 16 }, (_, i) => 1000 + i));
});

test('the summary aggregates a slate into the balance picture', () => {
  const draw = record({ rings: [[1, 1, 0], [1, 0, 1]], seconds: 380, overtime: true });
  const s = summarize([record(), draw]);
  assert.equal(s.games, 2);
  assert.equal(s.finished, 2);
  assert.equal(s.overtime.games, 1);
  assert.equal(s.overtime.pct, 50);
  assert.equal(s.goals.perMatch, 9); // (10 + 8) / 2
  assert.equal(s.seconds.mean, 360);
  // "One-goal game" includes a dead-level draw: margins 2 and 0 => 50%.
  assert.equal(s.margin.oneGoalPct, 50);
  assert.equal(s.margin.mean, 1);
  assert.equal(s.margin.blowoutPct, 0);
  // Both teams' rings are summed across the slate: 5 top-ring goals, 1 blue, 2 white.
  assert.deepEqual(s.rings.goals, [5, 1, 2]);
  assert.deepEqual(s.rings.points, [15, 1, 2]); // the top ring pays 3, each low ring 1
  assert.equal(s.rings.topSharePct, 83.3); // 15 of 18 ring points
  assert.equal(s.rings.blueSharePct, 5.6);
  assert.equal(s.averages.shots, 30);
  assert.equal(s.averages.goalsPerShotPct, 13.3); // 8 goals on 60 shots
  const aaa = s.teams.find((t) => t.abbr === 'AAA');
  const bbb = s.teams.find((t) => t.abbr === 'BBB');
  assert.equal(aaa.games, 2);
  assert.equal(aaa.wins, 1);
  assert.equal(aaa.ties, 1);
  assert.equal(aaa.winPct, 50);
  assert.equal(aaa.goalsFor, 10);
  assert.equal(aaa.goalsAgainst, 8);
  assert.equal(aaa.diff, 2);
  assert.equal(bbb.losses, 1);
  assert.deepEqual(s.problems, [], 'a clean slate reports no problems');
});

test('the accounting audit fires when the score does not reconcile', () => {
  const drifted = summarize([record({ score: [7, 4] })]); // goal log says 6
  assert.equal(drifted.problems.length, 1);
  assert.match(drifted.problems[0], /scored 6 - 0 stolen = 6, but the score says 7/);

  // A gamebreaker pays 4 and steals up to 2 from the side that was scored on: both sides of that
  // ledger have to be counted, or every gamebreaker looks like an accounting bug.
  const stolen = summarize([record({ score: [4, 4], goalPoints: [6, 4], stolenAgainst: [2, 0] })]);
  assert.deepEqual(stolen.problems, [], 'a gamebreaker steal is part of the ledger, not a mismatch');

  const stranded = summarize([record({ rings: [[0, 0, 0], [0, 0, 0]], goalPoints: [0, 0], score: [0, 0], goalCount: 4 })]);
  assert.match(stranded.problems.join('\n'), /4 goals logged but 0 in the ring split/);

  const unfinished = summarize([record({ finished: false, winner: null })]);
  assert.match(unfinished.problems.join('\n'), /did not finish/);

  const dead = summarize([record({ census: { score: 4, shot: 0, save: 0 }, stats: { ...record().stats, shots: 0 } })]); // no attempts at all
  assert.match(dead.problems.join('\n'), /no shots were taken/);
});

test('the report is printable and names the problems it found', () => {
  const text = formatReport(summarize([record()]));
  assert.match(text, /BALANCE REPORT — 1 CPU matches at PRO/);
  assert.match(text, /TOP RING \(3\)/);
  assert.match(text, /AAA/);
  assert.match(text, /EVENT RATES/);
  assert.doesNotMatch(text, /PROBLEMS/);
  const withProblems = formatReport(summarize([record({ finished: false })]));
  assert.match(withProblems, /PROBLEMS \(1\)/);
  assert.match(withProblems, /- AAA vs BBB/);
});

test('a real match plays, finishes and reconciles its own scoring', () => {
  const m = playMatch({ home: TEAMS[0], away: TEAMS[5], difficulty: 'pro', seed: 1000 });
  assert.equal(m.finished, true, 'a full-time match must reach the final whistle inside the step ceiling');
  assert.ok(m.goalCount > 0, 'a CPU match should produce goals');
  assert.deepEqual(summarize([m]).problems, []);
  assert.equal(m.goalPoints.reduce((a, b) => a + b, 0) - m.stolenAgainst.reduce((a, b) => a + b, 0),
    m.score[0] + m.score[1], 'goal log minus steals must equal the final score');
});
