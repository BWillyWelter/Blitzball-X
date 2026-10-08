/**
 * Live tuning panel: field discovery, edit round-trip, and the paste-ready diff.
 *
 * The panel's whole value is that a dial edited on screen lands in the same object the sim reads —
 * a silent miss (a wrong path, a stale copy, a diff that does not match the file format) would send
 * a tuning session down a blind alley, so the plumbing is pinned here rather than by eye.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELDS, collectFields, diffSnapshot, formatDiff, readValue, sliderRange, snapshot,
  tuningEnabled, writeValue,
} from '../src/dev/tuning.js';
import { MatchSim } from '../src/game/match.js';
import { TEAMS } from '../src/data/teams.js';
import { RULES } from '../src/data/constants.js';

/** Edit `path`, run the assertion, always put the constant back. */
function withValue(path, value, fn) {
  const before = readValue(path);
  try {
    writeValue(path, value);
    fn(before);
  } finally {
    writeValue(path, before);
  }
  assert.equal(readValue(path), before, `${path} was not restored`);
}

test('every dial in the constants is discovered, nested ones included', () => {
  assert.ok(FIELDS.length > 100, `expected the whole tuning surface, found ${FIELDS.length}`);
  for (const path of ['RULES.possessionClock', 'MOVE.maxSpeed', 'ACTION.shotMaxRange',
    'STYLE.goalVolley', 'PHYS.ballCurve', 'COMBAT.hitstop.tackle', 'MOVE.staminaContactDrain.wash',
    'DIFFICULTY.pro.aiReaction', 'DIFFICULTY.legend.keeperSkill']) {
    assert.ok(FIELDS.includes(path), `missing dial: ${path}`);
  }
  assert.ok(FIELDS.every((p) => Number.isFinite(readValue(p))), 'a discovered dial is not a number');
  assert.ok(!FIELDS.some((p) => p.startsWith('ARENA.')),
    'ARENA is built into the geometry — editing it live would desync the pool from its own physics');
  assert.deepEqual(collectFields([['X', { a: 1, b: { c: 2 }, d: 'text', e: [1, 2], f: null }]]), ['X.a', 'X.b.c']);
});

test('a dial edit is visible to the sim and reversible', () => {
  withValue('MOVE.maxSpeed', 6.9, () => assert.equal(readValue('MOVE.maxSpeed'), 6.9));
  withValue('DIFFICULTY.legend.aiReaction', 1.9, () => assert.equal(readValue('DIFFICULTY.legend.aiReaction'), 1.9));
  assert.deepEqual(diffSnapshot(snapshot()), [], 'reading the constants must not look like an edit');
});

test('the diff is grouped and pasted straight into src/data/constants.js', () => {
  const base = snapshot();
  const quiet = diffSnapshot(base, { ...base, 'MOVE.maxSpeed': 6.4, 'RULES.possessionClock': 23, 'DIFFICULTY.pro.aiReaction': 1.1 });
  assert.deepEqual(quiet.map((c) => c.path), ['DIFFICULTY.pro.aiReaction', 'MOVE.maxSpeed', 'RULES.possessionClock']);
  assert.equal(formatDiff(quiet), [
    '// DIFFICULTY.pro',
    'aiReaction: 1.1,',
    '',
    '// MOVE',
    'maxSpeed: 6.4,',
    '',
    '// RULES',
    'possessionClock: 23,',
    '',
  ].join('\n'));
  assert.equal(formatDiff([]), '', 'no changes means empty text, not an empty header');
  assert.equal(formatDiff(diffSnapshot(base, base)), '');
});

test('slider bounds always contain the dial they edit', () => {
  for (const path of FIELDS) {
    const value = readValue(path);
    const { min, max, step } = sliderRange(value);
    assert.ok(step > 0, `${path}: a zero step makes the slider unusable`);
    assert.ok(min <= value && value <= max, `${path}: slider ${min}..${max} cannot reach ${value}`);
  }
  assert.equal(sliderRange(-7.5).max, 0, 'gravity is a negative dial: its slider runs up to zero');
  assert.ok(sliderRange(-7.5).min < -7.5);
  assert.equal(sliderRange(0).max, 1, 'a zero value needs a sane default range');
});

test('MatchSim.syncTuning pushes a live rules edit into a running match', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 7, userTeam: 0 });
  const before = RULES.subWindow;
  try {
    RULES.subWindow = before + 5;
    assert.equal(sim.rules.subWindow, before, 'the sim owns a snapshot taken at construction');
    sim.syncTuning();
    assert.equal(sim.rules.subWindow, before + 5, 'syncTuning must hand the new value to the sim');
  } finally {
    RULES.subWindow = before;
    sim.syncTuning();
  }
  assert.equal(sim.rules.subWindow, before);
});

test('the panel flag follows the ?tune convention', () => {
  assert.equal(tuningEnabled({ search: '?tune' }), true);
  assert.equal(tuningEnabled({ search: '?perf' }), false);
  assert.equal(tuningEnabled(null), false);
});
