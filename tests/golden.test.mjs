/**
 * Golden behavior gate for the deterministic sim.
 *
 * The match sim is seeded and headless, so a fixed seed must always play the same match. This test
 * replays the committed baseline (tests/golden/sim-baseline.json) and fails if any scoreline, match
 * length, stat or event count moved. It is the automated form of the manual "run the seeds, compare
 * the census" check that has caught every silent behavior change so far.
 *
 * A failure means one of two things, and the diff says which:
 *   - an unintended change (a typo'd constant, a broken delegation) — fix it;
 *   - an intended rebalance — run `npm run golden:update` and review the new baseline in the diff.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectSnapshot, runCase, CASES, BASELINE_PATH } from '../scripts/snapshot.mjs';

/** Flat list of "path: expected -> actual" for everything that moved, so a failure names values. */
function diff(expected, actual, at, out = []) {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) out.push(`${at}.length: ${expected.length} -> ${actual.length}`);
    for (let i = 0; i < Math.max(expected.length, actual.length); i++) diff(expected[i], actual[i], `${at}[${i}]`, out);
    return out;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if (!(key in expected)) out.push(`${at}.${key}: (absent) -> ${JSON.stringify(actual[key])}`);
      else if (!(key in actual)) out.push(`${at}.${key}: ${JSON.stringify(expected[key])} -> (absent)`);
      else diff(expected[key], actual[key], `${at}.${key}`, out);
    }
    return out;
  }
  if (expected !== actual) out.push(`${at}: ${JSON.stringify(expected)} -> ${JSON.stringify(actual)}`);
  return out;
}

test('sim behavior matches the committed golden snapshot', () => {
  assert.ok(fs.existsSync(BASELINE_PATH), `missing baseline ${BASELINE_PATH} — run: npm run golden:update`);
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const current = collectSnapshot();
  assert.equal(current.version, baseline.version, 'snapshot format version');
  assert.equal(current.cases.length, baseline.cases.length, 'case count (did CASES change?)');
  const moved = [];
  baseline.cases.forEach((expected, i) => {
    const actual = current.cases[i];
    const label = `case ${i} ${expected.home} vs ${expected.away} seed=${expected.seed} ${expected.difficulty}`;
    moved.push(...diff(expected, actual, label));
  });
  assert.deepEqual(moved, [],
    `the sim's behavior moved:\n  ${moved.join('\n  ')}\n\n`
    + 'If that is intended (a rebalance), regenerate the baseline: npm run golden:update');
});

test('the golden snapshot is reproducible: the same seed plays the same match twice', () => {
  const a = runCase(CASES[0]);
  const b = runCase(CASES[0]);
  assert.deepEqual(b, a, 'two runs of the same seed disagreed — the sim is no longer deterministic');
});
