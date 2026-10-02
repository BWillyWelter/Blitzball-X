/**
 * FX frame-rate independence.
 *
 * Particle drag and the ball-trail fade are authored as per-frame multipliers tuned at 60 fps.
 * Applying them once per rendered frame made everything decay faster on high-refresh displays and
 * slower on low ones. `frameDecay` converts those factors into a rate over the real frame time;
 * these tests pin that behaviour so a future edit can't quietly reintroduce per-frame decay.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameDecay } from '../src/render/fx.js';

const REF_DT = 1 / 60;
// The drag values actually used by the emitters in fx.js.
const DRAGS = [0.94, 0.95, 0.96, 0.98];

/** Simulate `seconds` of per-frame velocity decay, returning the surviving multiplier. */
function decayOver(drag, dt, seconds) {
  let v = 1;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) v *= frameDecay(drag, dt);
  return v;
}

test('frameDecay is a no-op at the 60 fps reference frame', () => {
  for (const drag of DRAGS) {
    assert.equal(frameDecay(drag, REF_DT), drag, `drag ${drag} must be unchanged at 60 fps`);
  }
});

test('frameDecay never decays a zero-length frame', () => {
  for (const drag of DRAGS) assert.equal(frameDecay(drag, 0), 1);
});

test('frameDecay composes: two half frames equal one full frame', () => {
  for (const drag of DRAGS) {
    assert.ok(
      Math.abs(frameDecay(drag, REF_DT / 2) ** 2 - drag) < 1e-12,
      `drag ${drag}: two half-frames should match one 60 fps frame`,
    );
    assert.ok(Math.abs(frameDecay(drag, 2 * REF_DT) - drag ** 2) < 1e-12);
  }
});

test('particle drag decays at the same rate regardless of frame rate', () => {
  const rates = [30, 60, 90, 120, 144, 240];
  for (const drag of DRAGS) {
    const baseline = decayOver(drag, REF_DT, 1);
    for (const fps of rates) {
      const dt = 1 / fps;
      const actual = decayOver(drag, dt, 1);
      assert.ok(
        Math.abs(actual - baseline) < 1e-9,
        `drag ${drag} at ${fps} fps survived ${actual}, expected ~${baseline}`,
      );
    }
  }
});

test('per-frame multiplication is the frame-rate-dependent bug being guarded', () => {
  // The old code did `v *= drag` once per frame, so 1 s of decay depended on the frame count.
  const naive = (fps) => 0.94 ** fps;
  assert.ok(
    Math.abs(naive(60) - naive(120)) > 1e-3,
    'the naive per-frame form must differ across frame rates, otherwise this test is meaningless',
  );
  assert.ok(Math.abs(decayOver(0.94, 1 / 120, 1) - decayOver(0.94, 1 / 60, 1)) < 1e-9);
});

test('trail fade factor stays frame-rate independent', () => {
  // updateTrail() lerps toward 0.95 while the ball flies, then multiplies opacity by 0.85 per frame
  // when it stops. Both are driven through frameDecay, so the fall to (near) zero takes the same
  // wall-clock time at any refresh rate.
  const fadeOver = (dt, seconds) => {
    let opacity = 1;
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) opacity *= frameDecay(0.85, dt);
    return opacity;
  };
  const at60 = fadeOver(REF_DT, 0.5);
  for (const fps of [30, 90, 144, 240]) {
    assert.ok(Math.abs(fadeOver(1 / fps, 0.5) - at60) < 1e-9, `trail fade differed at ${fps} fps`);
  }
  // The active-branch approach rate (0.3/frame toward 0.95) is likewise scaled by dt.
  const approachPerSecond = 1 - frameDecay(0.7, REF_DT);
  assert.ok(Math.abs(approachPerSecond - 0.3) < 1e-12);
  assert.ok(Math.abs(1 - frameDecay(0.7, REF_DT / 2) - 0.3) < 0.2, 'half a frame moves less');
});
