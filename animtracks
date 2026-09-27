/**
 * BLITZBALL X — authored pose tracks.
 *
 * Every discrete sim state maps to one track here, normalized over the state's sim duration
 * (u = stateTime / stateDur, so difficulty and tuning never desync the pose). Continuous
 * states (swim / tread / gbdrive) stay procedural in swimcycle.js — they need an unbroken
 * phase, not a fixed arc.
 *
 * Motion language, per action:
 *   - Anticipation: a slow key before the hit (players read "something is coming").
 *   - Contact: a very short, ease-IN segment — accelerating into the hit reads as power.
 *   - Follow-through: an ease-OUT segment that settles well past the hit point.
 * Tricks use opts.raw on J.body so full rotations lerp without wrapping.
 *
 * Tune by editing numbers and re-screenshotting tools/anim.mjs — no logic changes needed.
 */

import { J, k, buildTrack } from './posetracks.js';

// ---------------------------------------------------------------------------
// SHOOT — authored for the default windup (ACTION.shotChargeTime = 0.75s, +0.3s follow).
// Callers compute u = stateTime / (shot.wind + 0.3); the release lands at u ~= 0.714.
// ---------------------------------------------------------------------------
export const SHOOT = buildTrack('shoot', [
  k(0.00, {
    [J.torso]: [0, -0.35, 0], [J.body]: [-0.08, 0, 0],
    [J.shR]: [-2.7, 0, 0.5], [J.elR]: [-1.9, 0, 0], [J.wrR]: [-0.3, 0, 0],
    [J.shL]: [-1.5, 0, -0.2], [J.elL]: [-0.2, 0, 0],
    [J.hipR]: [0.2, 0, 0], [J.hipL]: [-0.25, 0, 0],
  }, { hy: 1.05, by: -0.05 }),
  k(0.55, {
    [J.torso]: [0, -0.65, 0], [J.body]: [-0.15, 0, 0],
    [J.shR]: [-3.0, 0, 0.55], [J.elR]: [-1.5, 0, 0],
    [J.hipL]: [0.45, 0, 0], [J.hipR]: [-0.55, 0, 0],
  }, { hy: 1.12, by: -0.08 }),
  // Segment starting here is ease-IN and only spans ~0.09: the release snap.
  k(0.714, { e: null }, {
    [J.torso]: [0, -0.65, 0], [J.body]: [-0.15, 0, 0],
    [J.shR]: [-3.0, 0, 0.55], [J.elR]: [-1.5, 0, 0],
    [J.hipL]: [0.45, 0, 0], [J.hipR]: [-0.55, 0, 0],
  }, { hy: 1.12, by: -0.08 }),
  k(0.80, {
    [J.torso]: [0, 0.5, 0], [J.body]: [0.5, 0, 0],
    [J.shR]: [-0.5, 0, 0.2], [J.elR]: [-0.1, 0, 0], [J.wrR]: [0.2, 0, 0],
    [J.shL]: [0.3, 0, -0.9], [J.elL]: [-0.3, 0, 0],
    [J.hipL]: [-0.55, 0, 0], [J.hipR]: [0.65, 0, 0], [J.kneeR]: [0.75, 0, 0],
    [J.neck]: [0.2, 0, 0],
  }, { hy: 1.0, by: 0.05, bz: 0.15 }),
  k(1.00, {
    [J.torso]: [0, 0.25, 0], [J.body]: [0.25, 0, 0],
    [J.shR]: [-1.1, 0, 0.3], [J.elR]: [-0.4, 0, 0],
    [J.shL]: [-0.1, 0, -0.5], [J.elL]: [-0.5, 0, 0],
    [J.hipL]: [-0.25, 0, 0], [J.hipR]: [0.3, 0, 0], [J.kneeR]: [0.35, 0, 0],
    [J.neck]: [0.1, 0, 0],
  }, { hy: 1.02, by: 0, bz: 0.05 }),
]);

// ---------------------------------------------------------------------------
// PASS — accelerating two-hand push, then a settle. Duration: sim 'pass' state (~0.22s).
// ---------------------------------------------------------------------------
export const PASS = buildTrack('pass', [
  k(0.00, { e: 'in' }, {
    [J.body]: [0.1, 0, 0],
    [J.shL]: [-0.6, 0, -0.3], [J.elL]: [-1.1, 0, 0],
    [J.shR]: [-0.6, 0, 0.3], [J.elR]: [-1.1, 0, 0],
  }, { hy: 1.0 }),
  k(0.45, {
    [J.body]: [0.35, 0, 0],
    [J.shL]: [-1.9, 0, -0.25], [J.elL]: [-0.15, 0, 0],
    [J.shR]: [-1.9, 0, 0.25], [J.elR]: [-0.15, 0, 0],
    [J.wrL]: [0.4, 0, 0], [J.wrR]: [0.4, 0, 0],
  }, { hy: 0.98, by: -0.02, bz: 0.15 }),
  k(1.00, {
    [J.body]: [0.15, 0, 0],
    [J.shL]: [-0.8, 0, -0.35], [J.elL]: [-0.8, 0, 0],
    [J.shR]: [-0.8, 0, 0.35], [J.elR]: [-0.8, 0, 0],
  }, { hy: 1.0, bz: 0.05 }),
]);

// ---------------------------------------------------------------------------
// CATCH ABSORB — hands meet the ball, give with it, tuck. Duration: sim 'catch' (0.14s).
// ---------------------------------------------------------------------------
export const CATCH_ABSORB = buildTrack('catch', [
  k(0.00, { e: 'out' }, {
    [J.shL]: [-1.6, 0, -0.3], [J.elL]: [-0.2, 0, 0],
    [J.shR]: [-1.6, 0, 0.3], [J.elR]: [-0.2, 0, 0],
  }, { hy: 1.0 }),
  k(0.5, {
    [J.shL]: [-1.0, 0, -0.25], [J.elL]: [-1.8, 0, 0],
    [J.shR]: [-1.0, 0, 0.25], [J.elR]: [-1.8, 0, 0],
    [J.body]: [0.15, 0, 0], [J.neck]: [0.1, 0, 0],
  }, { hy: 0.98 }),
  k(1.00, {
    [J.shL]: [-0.9, 0, -0.25], [J.elL]: [-1.9, 0, 0],
    [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
  }, { hy: 1.0 }),
]);

// ---------------------------------------------------------------------------
// TACKLE — crouch anticipation, explosive lunge with a reaching arm, low recovery.
// ---------------------------------------------------------------------------
export const TACKLE = buildTrack('tackle', [
  k(0.00, { e: 'inout' }, {
    [J.body]: [0.35, 0, 0],
    [J.hipL]: [0.6, 0, 0], [J.kneeL]: [0.9, 0, 0],
    [J.hipR]: [0.6, 0, 0], [J.kneeR]: [0.9, 0, 0],
    [J.shL]: [-2.2, 0, -0.3], [J.elL]: [-0.5, 0, 0],
    [J.shR]: [-0.8, 0, 0.5], [J.elR]: [-0.8, 0, 0],
  }, { hy: 0.88, by: -0.05 }),
  k(0.25, { e: 'out' }, {
    [J.body]: [1.45, 0, 0], [J.neck]: [-0.5, 0, 0],
    [J.hipL]: [-1.1, 0, 0], [J.kneeL]: [0.15, 0, 0],
    [J.hipR]: [0.5, 0, 0], [J.kneeR]: [0.7, 0, 0],
    [J.shR]: [-2.9, 0, 0.1], [J.elR]: [-0.1, 0, 0],
    [J.shL]: [-1.8, 0, -0.4], [J.elL]: [-0.4, 0, 0],
  }, { hy: 0.9, by: -0.15, bz: 0.35 }),
  k(1.00, {
    [J.body]: [0.5, 0, 0],
    [J.hipL]: [-0.3, 0, 0], [J.kneeL]: [0.5, 0, 0],
    [J.hipR]: [0.3, 0, 0], [J.kneeR]: [0.5, 0, 0],
    [J.shR]: [-1.5, 0, 0.2], [J.elR]: [-0.6, 0, 0],
    [J.shL]: [-1.2, 0, -0.3], [J.elL]: [-0.6, 0, 0],
  }, { hy: 0.95, by: -0.3, bz: 0.2 }),
]);

// ---------------------------------------------------------------------------
// BIG HIT — shoulder wind, two-hand shove with a leg drive, recoil.
// ---------------------------------------------------------------------------
export const HIT = buildTrack('hit', [
  k(0.00, { e: 'out' }, {
    [J.torso]: [0, 0.55, 0], [J.body]: [-0.1, 0, 0],
    [J.shR]: [-0.4, 0, 0.9], [J.elR]: [-1.7, 0, 0],
    [J.shL]: [0.5, 0, -0.5], [J.elL]: [-0.6, 0, 0],
  }, { hy: 1.0 }),
  k(0.3, { e: 'in' }, {
    [J.torso]: [0, -0.55, 0], [J.body]: [0.35, 0, 0],
    [J.shR]: [-1.5, 0, 0.4], [J.elR]: [-0.15, 0, 0],
    [J.shL]: [-1.1, 0, -0.5], [J.elL]: [-0.3, 0, 0],
    [J.hipL]: [0.5, 0, 0], [J.kneeL]: [0.7, 0, 0],
  }, { hy: 0.98, by: -0.02, bz: 0.25 }),
  k(1.00, {
    [J.torso]: [0, -0.1, 0], [J.body]: [0.1, 0, 0],
    [J.shR]: [-0.6, 0, 0.5], [J.elR]: [-0.8, 0, 0],
    [J.shL]: [-0.4, 0, -0.4], [J.elL]: [-0.7, 0, 0],
    [J.hipL]: [0.2, 0, 0], [J.kneeL]: [0.3, 0, 0],
  }, { hy: 1.0, bz: 0.05 }),
]);

// ---------------------------------------------------------------------------
// KEEPER SAVE — full extension dive. Sample with applyTrack, then multiply
// this.body.rotation.z by sign(knockDir.z): the track authors the +z dive only.
// ---------------------------------------------------------------------------
export const SAVE = buildTrack('save', [
  k(0.00, { e: 'in' }, {
    [J.shL]: [-2.6, 0, -0.15], [J.elL]: [-0.3, 0, 0],
    [J.shR]: [-2.6, 0, 0.15], [J.elR]: [-0.3, 0, 0],
    [J.body]: [-0.1, 0, 0], [J.neck]: [-0.2, 0, 0],
  }, { hy: 0.95 }),
  k(0.35, {
    [J.body]: [-0.1, 0, 1.25], [J.neck]: [-0.35, 0, 0],
    [J.shL]: [-3.0, 0, -0.1], [J.elL]: [-0.05, 0, 0],
    [J.shR]: [-3.0, 0, 0.1], [J.elR]: [-0.05, 0, 0],
    [J.hipR]: [0.5, 0, 0], [J.kneeR]: [0.8, 0, 0],
    [J.hipL]: [-0.2, 0, 0], [J.kneeL]: [0.3, 0, 0],
  }, { hy: 1.05, by: 0.15 }),
  k(1.00, {
    [J.body]: [-0.1, 0, 1.3],
    [J.shL]: [-2.8, 0, -0.2], [J.shR]: [-2.8, 0, 0.2],
    [J.hipR]: [0.4, 0, 0], [J.kneeR]: [0.6, 0, 0],
  }, { hy: 1.0, by: 0.1 }),
]);

// ---------------------------------------------------------------------------
// VOLLEY — leg swings through, body counter-rotates, landing give.
// ---------------------------------------------------------------------------
export const VOLLEY = buildTrack('volley', [
  k(0.00, { e: 'inout' }, {
    [J.body]: [-0.35, 0, 0],
    [J.hipR]: [-0.6, 0, 0], [J.kneeR]: [1.3, 0, 0],
    [J.hipL]: [0.3, 0, 0], [J.kneeL]: [0.5, 0, 0],
    [J.shL]: [-2.2, 0, -0.5], [J.shR]: [0.6, 0, 0.6],
  }, { hy: 1.0 }),
  k(0.5, { e: 'out' }, {
    [J.body]: [0.55, 0, 0], [J.torso]: [0, -0.4, 0],
    [J.hipR]: [-1.9, 0, 0], [J.kneeR]: [0.15, 0, 0],
    [J.hipL]: [0.5, 0, 0], [J.kneeL]: [0.6, 0, 0],
    [J.shL]: [-0.6, 0, -1.0], [J.shR]: [-0.6, 0, 1.0],
    [J.elL]: [-0.3, 0, 0], [J.elR]: [-0.3, 0, 0],
  }, { hy: 0.95, by: -0.05 }),
  k(1.00, {
    [J.body]: [0.1, 0, 0],
    [J.hipR]: [-0.3, 0, 0], [J.kneeR]: [0.6, 0, 0],
    [J.hipL]: [0.2, 0, 0], [J.kneeL]: [0.4, 0, 0],
    [J.shL]: [-0.8, 0, -0.6], [J.shR]: [-0.8, 0, 0.6],
  }, { hy: 0.98 }),
]);

// ---------------------------------------------------------------------------
// STUMBLE / FALLEN — reaction states with variable sim durations (normalized u).
// ---------------------------------------------------------------------------
export const STUMBLE = buildTrack('stumble', [
  k(0.00, { e: 'inout' }, {
    [J.body]: [0.75, 0, 0.5],
    [J.shL]: [-0.4, 0, -1.6], [J.shR]: [-0.4, 0, 1.6],
    [J.elL]: [-0.3, 0, 0], [J.elR]: [-0.3, 0, 0],
  }, { hy: 0.95, by: -0.1 }),
  k(0.5, {
    [J.body]: [-0.3, 0.6, -0.4],
    [J.shL]: [-0.9, 0, -1.4], [J.shR]: [-0.9, 0, 1.4],
  }, { hy: 0.92 }),
  k(1.00, {
    [J.body]: [0.08, 0, 0],
    [J.shL]: [-0.4, 0, -1.0], [J.elL]: [-0.9, 0, 0],
    [J.shR]: [-0.4, 0, 1.0], [J.elR]: [-0.9, 0, 0],
    [J.hipL]: [0.25, 0, 0], [J.kneeL]: [0.55, 0, 0],
    [J.hipR]: [0.25, 0, 0], [J.kneeR]: [0.55, 0, 0],
  }, { hy: 1.0 }),
]);

export const FALLEN = buildTrack('fallen', [
  k(0.00, { e: 'out' }, {
    [J.shL]: [-0.5, 0, -1.4], [J.shR]: [-0.5, 0, 1.4],
  }, { hy: 1.0 }),
  // Full tumble: raw body rotation, no angle wrapping.
  k(0.4, {
    [J.body]: [Math.PI * 2, 0, 0.7],
    [J.shL]: [-0.5, 0, -1.4], [J.shR]: [-0.5, 0, 1.4],
    [J.hipL]: [-0.3, 0, 0], [J.hipR]: [0.5, 0, 0], [J.kneeR]: [0.9, 0, 0],
  }, { hy: 0.85, by: -0.5, bz: 0.2 }),
  k(0.72, {
    [J.body]: [Math.PI * 2, 0, 0],
    [J.shL]: [-0.5, 0, -1.2], [J.shR]: [-0.5, 0, 1.2],
  }, { hy: 0.9, by: -0.3 }),
  k(1.00, {
    [J.body]: [0, 0, 0],
    [J.shL]: [-0.4, 0, -1.0], [J.elL]: [-0.9, 0, 0],
    [J.shR]: [-0.4, 0, 1.0], [J.elR]: [-0.9, 0, 0],
    [J.hipL]: [0.25, 0, 0], [J.kneeL]: [0.55, 0, 0],
    [J.hipR]: [0.25, 0, 0], [J.kneeR]: [0.55, 0, 0],
  }, { hy: 1.0 }),
], { raw: [J.body] });

// ---------------------------------------------------------------------------
// CELEBRATE — looped, so any sim duration just works.
// ---------------------------------------------------------------------------
export const CELEBRATE = buildTrack('celebrate', [
  k(0.00, {
    [J.shL]: [-2.7, 0, -0.5], [J.elL]: [-0.6, 0, 0],
    [J.shR]: [-2.7, 0, 0.5], [J.elR]: [-0.6, 0, 0],
    [J.body]: [-0.1, 0, 0], [J.neck]: [-0.3, 0, 0],
  }, { hy: 1.0 }),
  k(0.5, {
    [J.shL]: [-2.95, 0, -0.55], [J.shR]: [-2.95, 0, 0.55],
    [J.body]: [-0.12, 0, 0],
  }, { hy: 1.12 }),
  k(1.00, {
    [J.shL]: [-2.7, 0, -0.5], [J.elL]: [-0.6, 0, 0],
    [J.shR]: [-2.7, 0, 0.5], [J.elR]: [-0.6, 0, 0],
    [J.body]: [-0.1, 0, 0], [J.neck]: [-0.3, 0, 0],
  }, { hy: 1.0 }),
], { loop: true });

// ---------------------------------------------------------------------------
// GAMEBREAKER WIND-UP.
// ---------------------------------------------------------------------------
export const GBWIND = buildTrack('gbwind', [
  k(0.00, { e: 'out' }, {
    [J.shL]: [-0.6, 0, -0.4], [J.elL]: [-0.9, 0, 0],
    [J.shR]: [-0.6, 0, 0.4], [J.elR]: [-0.9, 0, 0],
  }, { hy: 1.0 }),
  k(1.00, {
    [J.body]: [-0.25, 0, 0], [J.neck]: [-0.4, 0, 0],
    [J.shL]: [-2.9, 0, -0.4], [J.elL]: [-0.4, 0, 0],
    [J.shR]: [-2.9, 0, 0.4], [J.elR]: [-0.4, 0, 0],
  }, { hy: 1.2 }),
]);

// ---------------------------------------------------------------------------
// TRICKS — articulated replacements for the old statue spins. Indexed by TRICKS def id
// from game/combat.js. Ball-carry arm pose (shR/elR tuck) is authored into every key.
// ---------------------------------------------------------------------------
export const TRICKS = [
  // 0 SPIN -> corkscrew: yaw rotation with a mid-spin tuck and opposite arm sweep.
  buildTrack('trick_spin', [
    k(0.00, { e: 'inout' }, {
      [J.body]: [0.9, 0, 0],
      [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0], // ball arm stays tucked
      [J.shL]: [-2.6, 0, -0.3], [J.elL]: [-0.4, 0, 0],
      [J.hipL]: [-0.4, 0, 0], [J.hipR]: [0.4, 0, 0],
    }, { hy: 1.0 }),
    k(0.5, { e: 'linear' }, {
      [J.body]: [0.9, Math.PI, 0],
      [J.shR]: [-1.4, 0, 0.4], [J.elR]: [-1.2, 0, 0],
      [J.shL]: [-1.0, 0, -0.8], [J.elL]: [-0.2, 0, 0],
      [J.hipL]: [-1.3, 0, 0], [J.kneeL]: [1.6, 0, 0],
      [J.hipR]: [-1.3, 0, 0], [J.kneeR]: [1.6, 0, 0],
      [J.neck]: [0, 0.6, 0],
    }, { hy: 0.95 }),
    k(1.00, {
      [J.body]: [0.9, Math.PI * 2, 0],
      [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
      [J.shL]: [-2.6, 0, -0.3], [J.elL]: [-0.4, 0, 0],
      [J.hipL]: [-0.4, 0, 0], [J.hipR]: [0.4, 0, 0],
    }, { hy: 1.0 }),
  ], { raw: [J.body] }),

  // 1 BARREL ROLL: roll around the forward axis, asymmetric arm timing breaks the statue read.
  buildTrack('trick_barrel', [
    k(0.00, { e: 'linear' }, {
      [J.body]: [0.9, 0, 0],
      [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
      [J.shL]: [-1.2, 0, -0.6], [J.elL]: [-0.8, 0, 0],
    }, { hy: 1.0 }),
    k(0.25, {
      [J.body]: [0.9, 0, Math.PI * 0.5],
      [J.shL]: [-2.8, 0, -0.2], [J.elL]: [-0.2, 0, 0],
      [J.shR]: [-0.6, 0, 0.8], [J.elR]: [-1.6, 0, 0],
      [J.hipL]: [-0.8, 0, 0], [J.kneeL]: [1.2, 0, 0],
    }),
    k(0.5, {
      [J.body]: [0.9, 0, Math.PI],
      [J.shL]: [-2.8, 0, -0.2], [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
      [J.hipL]: [-1.3, 0, 0], [J.kneeL]: [1.6, 0, 0],
      [J.hipR]: [-1.3, 0, 0], [J.kneeR]: [1.6, 0, 0],
      [J.neck]: [0, 0, 0.5],
    }),
    k(0.75, {
      [J.body]: [0.9, 0, Math.PI * 1.5],
      [J.shL]: [-1.2, 0, -0.6], [J.elL]: [-0.8, 0, 0],
      [J.shR]: [-2.2, 0, 0.4], [J.elR]: [-0.4, 0, 0],
      [J.hipL]: [-0.8, 0, 0], [J.kneeL]: [1.2, 0, 0],
    }),
    k(1.00, {
      [J.body]: [0.9, 0, Math.PI * 2],
      [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
      [J.shL]: [-1.2, 0, -0.6], [J.elL]: [-0.8, 0, 0],
    }, { hy: 1.0 }),
  ], { raw: [J.body] }),

  // 2 DOLPHIN KICK: undulating body wave; fast flutter is added procedurally in character.js.
  buildTrack('trick_dolphin', [
    k(0.00, { e: 'inout' }, {
      [J.body]: [1.0, 0, 0], [J.spine]: [0.25, 0, 0],
      [J.shL]: [-2.9, 0, -0.15], [J.elL]: [-0.1, 0, 0],
      [J.shR]: [-2.9, 0, 0.15], [J.elR]: [-0.1, 0, 0],
      [J.hipL]: [0.3, 0, 0], [J.hipR]: [0.3, 0, 0],
      [J.kneeL]: [0.15, 0, 0], [J.kneeR]: [0.15, 0, 0],
    }, { hy: 1.0 }),
    k(0.5, {
      [J.body]: [0.25, 0, 0], [J.spine]: [-0.3, 0, 0],
      [J.hipL]: [-0.5, 0, 0], [J.hipR]: [-0.5, 0, 0],
      [J.kneeL]: [0.6, 0, 0], [J.kneeR]: [0.6, 0, 0],
    }, { hy: 0.95 }),
    k(1.00, {
      [J.body]: [0.8, 0, 0], [J.spine]: [0.2, 0, 0],
      [J.shL]: [-2.9, 0, -0.15], [J.elL]: [-0.1, 0, 0],
      [J.shR]: [-2.9, 0, 0.15], [J.elR]: [-0.1, 0, 0],
      [J.hipL]: [0.3, 0, 0], [J.hipR]: [0.3, 0, 0],
      [J.kneeL]: [0.15, 0, 0], [J.kneeR]: [0.15, 0, 0],
    }, { hy: 1.0 }),
  ]),

  // 3 CORKSCREW (turbo): full roll with a lateral sway — reads as a helix, not a rotor.
  buildTrack('trick_corkscrew', [
    k(0.00, { e: 'linear' }, {
      [J.body]: [0.9, 0, 0],
      [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
      [J.shL]: [-2.5, 0, -0.25], [J.elL]: [-0.3, 0, 0],
    }, { hy: 1.0 }),
    k(0.25, {
      [J.body]: [0.9, 0.55, Math.PI * 0.5],
      [J.hipL]: [-1.2, 0, 0], [J.kneeL]: [1.5, 0, 0],
    }),
    k(0.5, {
      [J.body]: [0.9, 0, Math.PI],
      [J.hipL]: [-1.4, 0, 0], [J.kneeL]: [1.6, 0, 0],
      [J.hipR]: [-1.4, 0, 0], [J.kneeR]: [1.6, 0, 0],
    }),
    k(0.75, {
      [J.body]: [0.9, -0.55, Math.PI * 1.5],
      [J.hipL]: [-1.2, 0, 0], [J.kneeL]: [1.5, 0, 0],
    }),
    k(1.00, {
      [J.body]: [0.9, 0, Math.PI * 2],
      [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
      [J.shL]: [-2.5, 0, -0.25], [J.elL]: [-0.3, 0, 0],
    }, { hy: 1.0 }),
  ], { raw: [J.body] }),

  // 4 BACK-FLIP FEINT: full backward pitch rotation, then held feint crouch.
  buildTrack('trick_flip', [
    k(0.00, { e: 'inout' }, {
      [J.body]: [0.9, 0, 0],
      [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
      [J.shL]: [-2.4, 0, -0.3], [J.elL]: [-0.5, 0, 0],
      [J.hipL]: [-0.4, 0, 0], [J.hipR]: [0.4, 0, 0],
    }, { hy: 1.0 }),
    k(0.55, { e: 'out' }, {
      [J.body]: [0.9 - Math.PI * 2, 0, 0],
      [J.shL]: [-1.0, 0, -0.9], [J.elL]: [-0.2, 0, 0],
      [J.hipL]: [-1.2, 0, 0], [J.kneeL]: [1.5, 0, 0],
      [J.hipR]: [-1.2, 0, 0], [J.kneeR]: [1.5, 0, 0],
    }, { hy: 0.92 }),
    k(1.00, {
      [J.body]: [0.4, 0, 0],
      [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
      [J.shL]: [-1.6, 0, -0.4], [J.elL]: [-0.7, 0, 0],
      [J.hipL]: [0.5, 0, 0], [J.kneeL]: [0.8, 0, 0],
      [J.hipR]: [0.5, 0, 0], [J.kneeR]: [0.8, 0, 0],
    }, { hy: 0.9 }),
  ], { raw: [J.body] }),

  // 5 JET STREAM: torpedo streamline — the old "lean forward" with arms that actually
  // reach. Fast flutter added procedurally in character.js.
  buildTrack('trick_jet', [
    k(0.00, { e: 'inout' }, {
      [J.body]: [1.3, 0, 0],
      [J.shL]: [-2.9, 0, -0.1], [J.elL]: [-0.05, 0, 0],
      [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
      [J.hipL]: [0.15, 0, 0], [J.hipR]: [0.15, 0, 0],
      [J.kneeL]: [0.1, 0, 0], [J.kneeR]: [0.1, 0, 0],
    }, { hy: 0.98 }),
    k(0.5, {
      [J.body]: [1.35, 0, 0.12],
      [J.shL]: [-2.95, 0, -0.1], [J.elL]: [-0.05, 0, 0],
    }, { hy: 0.96 }),
    k(1.00, {
      [J.body]: [1.3, 0, 0],
      [J.shL]: [-2.9, 0, -0.1], [J.elL]: [-0.05, 0, 0],
      [J.shR]: [-0.9, 0, 0.25], [J.elR]: [-1.9, 0, 0],
      [J.hipL]: [0.15, 0, 0], [J.hipR]: [0.15, 0, 0],
      [J.kneeL]: [0.1, 0, 0], [J.kneeR]: [0.1, 0, 0],
    }, { hy: 0.98 }),
  ]),
];

// Lookup mirrors the old render switch: trick def id -> track.
export function trickTrack(id) {
  return TRICKS[id] || TRICKS[0];
}
