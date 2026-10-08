/**
 * Frame instrumentation: the maths behind the `?perf` overlay and the CI frame snapshot.
 *
 * The overlay is only as trustworthy as what it reports, and a wrong percentile or a hitch count
 * that skips the worst frame would quietly hide the exact stutter it exists to catch. The numbers
 * are plain data, so they are pinned here rather than eyeballed in a browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameMonitor, HITCH_MS, percentile, perfEnabled } from '../src/dev/perf.js';

/** Feed `count` frames of `ms` each, plus any extra deltas. */
function frames(monitor, count, ms, start = 0) {
  let t = start;
  for (let i = 0; i < count; i++) {
    t += ms;
    monitor.frame(t);
  }
  return t;
}

test('percentile picks the nearest-rank value', () => {
  assert.equal(percentile([5, 1, 3], 0.5), 3);
  assert.equal(percentile([5, 1, 3], 0.99), 5);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([], 0.5), 0);
});

test('frame intervals are reported as p50/p99/max with an explicit hitch count', () => {
  const m = new FrameMonitor();
  let t = frames(m, 100, 16); // 100 intervals of 16 ms
  t += 120; // one long frame
  m.frame(t);
  const s = m.summary();
  assert.equal(s.frames, 100, '100 intervals: the first frame has nothing to measure against');
  assert.equal(s.frame.p50, 16);
  assert.equal(s.frame.max, 120);
  assert.equal(s.hitches, 1, 'a 120ms frame is a hitch');
  assert.equal(s.hitchMs, HITCH_MS);
  assert.equal(s.hitchPct, 1);
});

test('the first frame has no interval and a backgrounded tab is not a hitch', () => {
  const m = new FrameMonitor();
  m.frame(1000); // nothing to measure yet
  assert.equal(m.summary().frames, 0);
  m.frame(1016);
  m.frame(1016 + 6000); // alt-tab: a slept clock, not a stutter
  m.frame(1016 + 6000 - 5); // clock went backwards (rAF vs performance.now skew)
  const s = m.summary();
  assert.equal(s.frames, 1, 'only the genuine 16ms interval counts');
  assert.equal(s.hitches, 0);
});

test('named sub-costs are tracked independently and stay machine-readable', () => {
  const m = new FrameMonitor();
  frames(m, 20, 16.7);
  for (let i = 0; i < 20; i++) {
    m.sample('sim', 0.3 + i * 0.01);
    m.sample('render', 4);
  }
  m.counters({ calls: 664, triangles: 140500, programs: 22 });
  const s = m.summary();
  assert.equal(s.subs.sim.n, 20);
  assert.equal(s.subs.render.p50, 4);
  assert.equal(s.subs.sim.max, 0.49);
  assert.deepEqual(s.counters, { calls: 664, triangles: 140500, programs: 22 });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'summary must survive an artifact round-trip');
});

test('the rolling window keeps the tail without growing, and reset clears it', () => {
  const m = new FrameMonitor({ window: 10 });
  frames(m, 50, 16); // 50 frames -> 49 intervals
  assert.equal(m.summary().frames, 49, 'total frames is a count, not a buffer length');
  assert.equal(m.frames.values().length, 10);
  // A hitch older than the window is no longer reported: the readout says where the game is now.
  const m2 = new FrameMonitor({ window: 5 });
  frames(m2, 4, 16);
  m2.frame(4 * 16 + 200);
  assert.equal(m2.summary().hitches, 1);
  frames(m2, 20, 16, 4 * 16 + 200);
  assert.equal(m2.summary().hitches, 1, 'the hitch count is cumulative');
  assert.equal(m2.summary().frame.max, 16);
  m2.reset();
  const cleared = m2.summary();
  assert.equal(cleared.frames, 0);
  assert.equal(cleared.hitches, 0);
  assert.equal(cleared.frame.max, 0);
  assert.deepEqual(cleared.subs, {});
});

test('the overlay flag follows the ?perf convention', () => {
  assert.equal(perfEnabled({ search: '?perf' }), true);
  assert.equal(perfEnabled({ search: '?bench=anim' }), false);
  assert.equal(perfEnabled(null), false);
});
