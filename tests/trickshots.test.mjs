/**
 * Trick shots, dribbling, and heat system.
 *
 * These tests pin down the NBA Street-style mechanics:
 *  - Current Break (crossover): freezes the nearest presser
 *  - Blind Pass: auto-targets nearest teammate, risky through traffic
 *  - Spin/Bank/Heave shots: trick shot variants with bonuses
 *  - Heat/On Fire: style-driven meter that doubles style when maxed
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchSim } from '../src/game/match.js';
import { TEAMS } from '../src/data/teams.js';
import { ACTION, STYLE, MOVE } from '../src/data/constants.js';
import { emptyInput, copyInput } from '../src/game/entities.js';
import { tryCurrentBreak } from '../src/game/combat.js';
import { tryBlindPass } from '../src/game/passing.js';
import { fireShot, tryShoot } from '../src/game/shooting.js';
import { packInput, unpackInput } from '../src/net/protocol.js';
import { Vec3 } from '../src/core/vec3.js';

const DT = 1 / 60;

function freshSim(seed = 4242) {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed, userTeam: 0 });
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
  return sim;
}

/** Park a defender in front of `p`, facing them. */
function parkDefender(sim, p, dist = 1.2) {
  const q = sim.opponentsOf(p).find((o) => !o.isKeeper && o.state !== 'fallen');
  const to = Vec3.dirXZ(p.pos, sim.goalPos(p.team));
  q.pos.set(p.pos.x + to.x * dist, 0, p.pos.z + to.z * dist);
  q.vel.set(0, 0, 0);
  q.facing = Math.atan2(p.pos.x - q.pos.x, p.pos.z - q.pos.z);
  q.stun = 0;
  return q;
}

// ===========================================================================
// Current Break (crossover)
// ===========================================================================

test('currentBreak freezes a committed defender', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, 0);
  p.facing = Math.PI / 2;
  sim.ball.holder = p;
  const defender = parkDefender(sim, p, 1.2);

  const dir = new Vec3(1, 0, 0);
  const result = tryCurrentBreak(sim, p, dir);

  assert.ok(result, 'current break should succeed against a committed defender');
  assert.ok(defender.stun > 0, 'defender should be stunned');
  assert.ok(p.stats.currentBreaks >= 1, 'should increment currentBreaks stat');
});

test('currentBreak whiffs when no defender is in range', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, 0);
  p.facing = Math.PI / 2;
  sim.ball.holder = p;
  // Move all defenders far away
  for (const o of sim.opponentsOf(p)) {
    o.pos.set(50, 0, 50);
  }

  const dir = new Vec3(1, 0, 0);
  const result = tryCurrentBreak(sim, p, dir);

  assert.ok(!result, 'current break should fail with no defenders in range');
  assert.ok(p.stun > 0, 'whiffed current break should leave player briefly stunned');
});

test('currentBreak has a cooldown', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, 0);
  p.facing = Math.PI / 2;
  sim.ball.holder = p;
  parkDefender(sim, p, 1.2);

  const dir = new Vec3(1, 0, 0);
  // Force the break to succeed by setting RNG to always succeed
  sim.rng.chance = () => true;
  tryCurrentBreak(sim, p, dir);

  assert.ok(p.cd.currentBreak > 0, 'cooldown should be set after use');

  // Try again immediately — should fail due to cooldown
  const result = tryCurrentBreak(sim, p, dir);
  assert.ok(!result, 'should not be able to use current break during cooldown');
});

test('currentBreak awards style points', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, 0);
  p.facing = Math.PI / 2;
  sim.ball.holder = p;
  parkDefender(sim, p, 1.2);

  const beforeStyle = p.stats.style;
  sim.rng.chance = () => true;
  tryCurrentBreak(sim, p, new Vec3(1, 0, 0));

  assert.ok(p.stats.style > beforeStyle, 'should award style for current break');
});

// ===========================================================================
// Blind Pass
// ===========================================================================

test('blindPass finds nearest open teammate', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, 0);
  p.facing = Math.PI / 2;
  sim.ball.holder = p;

  // Move a teammate into open space
  const mate = sim.outfield(0)[1];
  mate.pos.set(3, 0, 2);

  const result = tryBlindPass(sim, p);

  assert.ok(result, 'blind pass should succeed');
  assert.ok(sim.ball.flight, 'should create a ball flight');
  assert.equal(sim.ball.flight.kind, 'pass');
  assert.ok(sim.ball.flight.blind, 'flight should be marked as blind');
});

test('blindPass through traffic pays big style', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, 0);
  sim.ball.holder = p;

  // Move all other teammates far away so choosePassTarget picks our intended target
  const mates = sim.outfield(0).filter((q) => q !== p);
  for (const m of mates) m.pos.set(50 + Math.random(), 0, 50 + Math.random());
  // Intended target in open space
  const mate = mates[0];
  mate.pos.set(8, 0, 0);

  // Defender in the passing lane
  const defender = sim.opponentsOf(p).find((o) => !o.isKeeper);
  defender.pos.set(4, 0, 0.3); // very close to the line between p and mate

  const beforeStyle = p.stats.style;
  const result = tryBlindPass(sim, p);

  assert.ok(result, 'blind pass should succeed');
  assert.ok(sim.ball.flight.laneRead, 'should detect defender in lane');
  assert.ok(p.stats.style > beforeStyle, 'should award style, especially through traffic');
});

test('blindPass sets laneRead flag when defender is near pass line', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, 0);
  sim.ball.holder = p;

  // Move all other teammates far away
  const mates = sim.outfield(0).filter((q) => q !== p);
  for (const m of mates) m.pos.set(50 + Math.random(), 0, 50 + Math.random());
  const mate = mates[0];
  mate.pos.set(6, 0, 0);

  // Defender right on the passing line
  const defender = sim.opponentsOf(p).find((o) => !o.isKeeper);
  defender.pos.set(3, 0, 0); // exactly on the line

  tryBlindPass(sim, p);

  assert.ok(sim.ball.flight.laneRead, 'defender on the pass line should be detected');
});

// ===========================================================================
// Heat / On Fire System
// ===========================================================================

test('heat meter fills from style points', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.heat = 0;
  p.onFire = false;

  const beforeHeat = p.heat;
  sim.addStyle(p, 100, 'TEST');

  assert.ok(p.heat > beforeHeat, 'heat should increase when style is earned');
});

test('heat meter triggers ON FIRE at max', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.heat = 0;
  p.onFire = false;

  // Add enough style to max out the heat meter
  const stylePerHeat = 100 / ACTION.heatGain;
  sim.addStyle(p, stylePerHeat * 2, 'BIG STYLE');

  assert.ok(p.onFire, 'player should be on fire after maxing heat');
  assert.ok(p.onFireTimer > 0, 'ON FIRE timer should be set');
});

test('ON FIRE doubles style gains', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];

  // First, earn some style normally
  p.heat = 0;
  p.onFire = false;
  const beforeStyle = p.stats.style;
  sim.addStyle(p, 100, 'NORMAL');
  const normalGain = p.stats.style - beforeStyle;

  // Now trigger ON FIRE
  p.onFire = true;
  p.onFireTimer = ACTION.heatDuration;
  const beforeFireStyle = p.stats.style;
  sim.addStyle(p, 100, 'ON FIRE STYLE');
  const fireGain = p.stats.style - beforeFireStyle;

  assert.ok(fireGain > normalGain * 1.5, 'ON FIRE should roughly double style gains');
});

test('ON FIRE timer ticks down and resets to half heat', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.heat = ACTION.heatMax;
  p.onFire = true;
  p.onFireTimer = 0.05; // almost expired

  // Step the sim a few frames to let the timer expire
  for (let i = 0; i < 10; i++) sim.step(DT);

  assert.ok(!p.onFire, 'ON FIRE should end after timer expires');
  assert.ok(p.heat < ACTION.heatMax * 0.6, 'heat should reset to ~half after ON FIRE ends');
});

test('heat decays when not on fire', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.heat = 50;
  p.onFire = false;

  const beforeHeat = p.heat;
  sim.step(DT);
  sim.step(DT);

  assert.ok(p.heat < beforeHeat, 'heat should decay when not on fire');
});

// ===========================================================================
// Trick Shots: Spin, Bank, Heave
// ===========================================================================

test('spin shot adds curve and reduces accuracy', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, -8);
  sim.ball.holder = p;
  p.input = emptyInput();
  p.input.spinShot = true;
  p.input.shootPressed = true;

  // Wind up the shot
  tryShoot(sim, p);
  assert.equal(p.shot.trick, 'spin', 'shot should be detected as spin type');

  // Release with full charge
  p.shot.charge = ACTION.shotChargeTime;
  sim.releaseShot(p);

  // The flight should have extra spin
  assert.ok(sim.ball.flight, 'should create a shot flight');
  assert.ok(Math.abs(sim.ball.flight.spin) > 0, 'spin shot should have spin on the ball');
  assert.equal(sim.ball.flight.trick, 'spin');
});

test('bank shot is detected and tagged', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, -8);
  sim.ball.holder = p;
  p.input = emptyInput();
  p.input.bankShot = true;
  p.input.shootPressed = true;

  tryShoot(sim, p);
  assert.equal(p.shot.trick, 'bank', 'shot should be detected as bank type');

  p.shot.charge = ACTION.shotChargeTime;
  sim.releaseShot(p);

  assert.ok(sim.ball.flight, 'should create a shot flight');
  assert.equal(sim.ball.flight.trick, 'bank');
  assert.ok(sim.ball.flight.bank, 'flight should be marked as bank');
});

test('heave is detected at long range', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  // Place player far from goal
  p.pos.set(0, 0, -20);
  sim.ball.holder = p;
  p.input = emptyInput();

  tryShoot(sim, p);
  assert.equal(p.shot.trick, 'heave', 'long-range shot should be detected as heave');
});

test('heave awards bonus style', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, -20);
  sim.ball.holder = p;

  const beforeStyle = p.stats.style;
  sim.fireShot(p, 0.5, { trick: 'heave' });
  assert.ok(p.stats.style > beforeStyle, 'heave should award style');
  assert.ok(p.stats.heaves >= 1, 'should increment heaves stat');
});

// ===========================================================================
// Input Serialization
// ===========================================================================

test('copyInput copies all new fields', () => {
  const src = emptyInput();
  src.currentBreak = true;
  src.blindPass = true;
  src.spinShot = true;
  src.bankShot = true;

  const dst = emptyInput();
  copyInput(dst, src);

  assert.ok(dst.currentBreak, 'currentBreak should be copied');
  assert.ok(dst.blindPass, 'blindPass should be copied');
  assert.ok(dst.spinShot, 'spinShot should be copied');
  assert.ok(dst.bankShot, 'bankShot should be copied');
});

test('protocol pack/unpack roundtrips new input fields', () => {
  const input = emptyInput();
  input.currentBreak = true;
  input.blindPass = true;
  input.spinShot = true;
  input.bankShot = true;
  input.moveX = 0.5;
  input.moveZ = -0.3;

  const packed = packInput(input);
  const unpacked = unpackInput(packed);

  assert.ok(unpacked.currentBreak, 'currentBreak should survive roundtrip');
  assert.ok(unpacked.blindPass, 'blindPass should survive roundtrip');
  assert.ok(unpacked.spinShot, 'spinShot should survive roundtrip');
  assert.ok(unpacked.bankShot, 'bankShot should survive roundtrip');
  assert.ok(Math.abs(unpacked.moveX - 0.5) < 0.01, 'moveX should roundtrip');
});

// ===========================================================================
// Player Entity Defaults
// ===========================================================================

test('player entity has heat and onFire fields initialized', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];

  assert.equal(p.heat, 0, 'heat should start at 0');
  assert.equal(p.onFire, false, 'onFire should start false');
  assert.equal(p.onFireTimer, 0, 'onFireTimer should start at 0');
});

test('player entity has new stats initialized', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];

  assert.equal(p.stats.currentBreaks, 0, 'currentBreaks stat should start at 0');
  assert.equal(p.stats.blindPasses, 0, 'blindPasses stat should start at 0');
  assert.equal(p.stats.bankShots, 0, 'bankShots stat should start at 0');
  assert.equal(p.stats.heaves, 0, 'heaves stat should start at 0');
});

test('currentBreak cooldown starts at 0', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  assert.equal(p.cd.currentBreak, 0, 'currentBreak cooldown should start at 0');
});

// ===========================================================================
// Integration: New mechanics in processInput
// ===========================================================================

test('processInput handles currentBreak input when carrier', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, 0);
  p.facing = Math.PI / 2;
  sim.ball.holder = p;
  parkDefender(sim, p, 1.2);

  const inp = emptyInput();
  inp.currentBreak = true;
  inp.moveX = 1;
  p.input = inp;

  sim.rng.chance = () => true;
  sim.processInput(p);

  assert.ok(p.cd.currentBreak > 0, 'currentBreak cooldown should be set after processing input');
});

test('processInput handles blindPass input when carrier', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, 0);
  sim.ball.holder = p;

  // Teammate in open space
  const mate = sim.outfield(0)[1];
  mate.pos.set(3, 0, 2);

  const inp = emptyInput();
  inp.blindPass = true;
  p.input = inp;

  sim.processInput(p);

  assert.ok(sim.ball.flight, 'blind pass should create a flight');
  assert.ok(sim.ball.flight.blind, 'flight should be marked as blind');
});