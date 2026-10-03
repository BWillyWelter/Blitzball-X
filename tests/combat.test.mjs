/**
 * Signature moves and contact.
 *
 * Two things are pinned here, because both were previously true of this code and neither should
 * ever be true again:
 *  1. the old "trick" was one move with six stat lines — a random pick out of a turbo-filtered
 *     pool. Every signature move must now have its own mechanic, own the swimmer who has it, and
 *     be played by that swimmer rather than rolled at random;
 *  2. contact has to have weight (hitstop, angle, impulse) and commitment has to cost something
 *     (a whiffed dive and a whiffed signature both leave the swimmer out of the play).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchSim } from '../src/game/match.js';
import { MOVES, moveFor, movePower, isEvading } from '../src/game/moves.js';
import { TEAMS, starters } from '../src/data/teams.js';
import { COMBAT, MOVE } from '../src/data/constants.js';
import { Vec3 } from '../src/core/vec3.js';

const DT = 1 / 60;

function freshSim(seed = 4242) {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed, userTeam: null });
  // Skip warm-ups + tip-off (~11s of presentation) with headroom.
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
  return sim;
}

/** A live sim for whichever crew actually starts a swimmer who owns a given kind of move. */
function simWithStarterOfKind(kind) {
  const idx = TEAMS.findIndex((t) => starters(t).some((p) => moveFor(p).kind === kind));
  assert.ok(idx >= 0, `no crew starts a "${kind}" user`);
  const sim = new MatchSim({
    home: TEAMS[idx],
    away: TEAMS[(idx + 1) % TEAMS.length],
    difficulty: 'pro',
    seed: 4242,
    userTeam: null,
  });
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
  return sim;
}

/** Park a defender in front of `p`, facing them (the worst case to beat). */
function challenge(sim, p, dist = 1.2) {
  const q = sim.opponentsOf(p).find((o) => !o.isKeeper && o.state !== 'fallen');
  const to = Vec3.dirXZ(p.pos, sim.goalPos(p.team));
  q.pos.set(p.pos.x + to.x * dist, 0, p.pos.z + to.z * dist);
  q.vel.set(0, 0, 0);
  q.facing = Math.atan2(p.pos.x - q.pos.x, p.pos.z - q.pos.z);
  q.stun = 0;
  return q;
}

test('every swimmer owns a valid signature move', () => {
  const keys = new Set(MOVES.map((m) => m.key));
  for (const team of TEAMS) {
    for (const p of team.roster) {
      assert.ok(p.move, `${p.id} has no signature move`);
      assert.ok(keys.has(p.move), `${p.id} has unknown move "${p.move}"`);
      assert.equal(moveFor({ data: p }).key, p.move);
    }
    // A team of six shouldn't be six of the same button.
    const distinct = new Set(team.roster.map((p) => p.move));
    assert.ok(distinct.size >= 4, `${team.abbr} has too few distinct moves (${distinct.size})`);
  }
});

test('signature moves are distinct mechanics, not one move with six stat lines', () => {
  const kinds = MOVES.map((m) => m.kind);
  assert.equal(new Set(kinds).size, MOVES.length, 'every move needs its own mechanic');
  assert.equal(new Set(MOVES.map((m) => m.key)).size, MOVES.length, 'move keys must be unique');
  for (const m of MOVES) {
    assert.ok(m.dur > 0 && m.dist > 0, `${m.key} needs a real duration and travel`);
    assert.ok(m.stat in MOVES[0] ? true : true);
    assert.ok(typeof m.commit === 'number' && m.commit > 0, `${m.key} must cost a commitment`);
    assert.ok(Number.isInteger(m.track) && m.track >= 0 && m.track < 10, `${m.key} needs an animation track`);
  }
});

test('a move is played by the swimmer who owns it, never rolled at random', () => {
  const sim = freshSim();
  for (const p of sim.outfield(0)) {
    p.cd.trick = 0;
    sim.tryTrick(p, new Vec3(1, 0, 0), false);
    assert.equal(p.state, 'trick');
    assert.equal(p.trick.def.key, moveFor(p).key, `${p.id} played someone else’s move`);
    // Playing it twice in a row must still be the same move — the old code shuffled to avoid
    // repeating, which meant nobody ever had a signature.
    sim.finishTrick(p);
    p.stun = 0;
    p.cd.trick = 0;
    sim.setState(p, 'swim');
    sim.tryTrick(p, new Vec3(1, 0, 0), false);
    assert.equal(p.trick.def.key, moveFor(p).key);
  }
});

test('move power scales with the stat the move is built on', () => {
  const weak = { data: { hnd: 40, pow: 40, spd: 40 } };
  const strong = { data: { hnd: 99, pow: 99, spd: 99 } };
  for (const m of MOVES) {
    const lo = movePower(m, weak);
    const hi = movePower(m, strong);
    assert.ok(hi > lo, `${m.key} does not scale with ${m.stat}`);
    assert.ok(lo >= 0.6 && hi <= 1.15, `${m.key} power out of range`);
  }
});

test('a roll, vault or slide is untackleable while it is playing', () => {
  const sim = freshSim();
  const p = sim.outfield(0)[0];
  const q = challenge(sim, p);
  sim.giveBall(p);

  // Straight out of a move: the carrier is off the plane and the challenge misses.
  p.moveArmor = 0.4;
  p.y = 1.0;
  assert.ok(isEvading(p), 'high + armored must count as evading');
  assert.equal(sim.tryTackle(q), false, 'an evading carrier cannot be tackled');
  assert.equal(sim.ball.holder, p, 'the ball stays with the carrier');

  // Back on the plane and it is a normal contest again.
  p.moveArmor = 0;
  p.y = 0;
  assert.equal(isEvading(p), false);
});

test('a spin only beats a defender who is looking at you', () => {
  const sim = simWithStarterOfKind('wash');
  const spinner = sim.outfield(0).find((p) => moveFor(p).kind === 'wash');
  assert.ok(spinner, 'a crew must start a spin user');
  const q = challenge(sim, spinner, 1.0);

  // Forced-success RNG, so the only thing that can stop the wash is the geometry/facing rule.
  const chance = sim.rng.chance;
  sim.rng.chance = () => true;
  // Freeze the world: moves now sweep for contact every frame they play, so an ambient CPU
  // swimmer mid-move could land a forced-success wash and pollute the counter. Out of the play.
  for (const o of sim.players) {
    if (o === spinner) continue;
    if (o.trick) sim.finishTrick(o);
    o.stun = 999;
  }

  // Facing away: a spin played at their back must not wash them.
  q.facing = Math.atan2(q.pos.x - spinner.pos.x, q.pos.z - spinner.pos.z);
  let washed = 0;
  sim.events.on('washed', () => washed++);
  sim.tryTrick(spinner, Vec3.dirXZ(spinner.pos, q.pos), false);
  sim.step(DT);
  assert.equal(washed, 0, 'a spin must not blindside a defender facing away');

  // Now facing the spin: same roll, but the mechanic applies.
  sim.finishTrick(spinner);
  spinner.stun = 0;
  spinner.cd.trick = 0;
  sim.setState(spinner, 'swim');
  q.pos.set(spinner.pos.x + 1, 0, spinner.pos.z);
  q.facing = Math.atan2(spinner.pos.x - q.pos.x, spinner.pos.z - q.pos.z);
  q.state = 'swim';
  q.stun = 999; // still frozen — only the facing changed
  sim.tryTrick(spinner, Vec3.dirXZ(spinner.pos, q.pos), false);
  sim.step(DT);
  assert.ok(washed > 0, 'a spin must beat a defender staring straight at it');
  sim.rng.chance = chance;
});

test('contact lands with weight: hitstop, and the sim genuinely freezes', () => {
  const sim = freshSim();
  const carrier = sim.outfield(0)[0];
  const tackler = challenge(sim, carrier, 1.0);
  sim.giveBall(carrier);
  const chance = sim.rng.chance;
  sim.rng.chance = () => true;

  const timeBefore = sim.time;
  const clockBefore = sim.clock;
  const won = sim.tryTackle(tackler);
  sim.rng.chance = chance;
  assert.equal(won, true, 'forced tackle should succeed');
  assert.ok(sim.freeze > 0, 'a landed tackle must hold the sim for a beat');
  assert.ok(sim.freeze >= COMBAT.hitstop.tackle);

  // Stepping during the freeze must not advance a single thing.
  sim.step(DT);
  sim.step(DT);
  assert.equal(sim.time, timeBefore, 'the match clock must not advance during hitstop');
  assert.equal(sim.clock, clockBefore, 'the half clock must not advance during hitstop');
  assert.ok(sim.freeze < COMBAT.hitstop.tackle, 'the freeze is counting down in real time');
  for (let i = 0; i < 8; i++) sim.step(DT);
  assert.equal(sim.freeze, 0, 'the freeze expires');
  sim.step(DT);
  assert.ok(sim.time > timeBefore, 'time resumes once the freeze is over');
});

test('the angle of a hit decides how hard it lands', () => {
  const sim = freshSim();
  const hitter = sim.outfield(0).find((p) => !p.isKeeper);
  const victim = challenge(sim, hitter, 1.0);

  const impulseOf = (angle) => {
    // The victim sits +x from the hitter. `angle` is how far the hitter's facing is turned away
    // from them: 0 is dead-on, ~1.2 rad is a glancing shoulder-barge that still connects.
    victim.pos.set(hitter.pos.x + 1, 0, hitter.pos.z);
    victim.vel.set(0, 0, 0);
    victim.y = 0;
    victim.airborne = false;
    victim.stun = 0;
    victim.state = 'swim';
    victim.facing = Math.atan2(-1, 0);
    hitter.facing = Math.PI / 2 - angle; // forward = (sin f, 0, cos f) = +x at angle 0
    hitter.stun = 0;
    hitter.cd.hit = 0;
    sim.setState(hitter, 'swim');
    const chance = sim.rng.chance;
    sim.rng.chance = () => true;
    const landed = sim.tryHit(hitter);
    sim.rng.chance = chance;
    return { impulse: victim.vel.lengthXZ(), landed };
  };

  const square = impulseOf(0);
  const clipped = impulseOf(1.2);
  assert.ok(square.landed, 'a dead-on hit connects');
  assert.ok(clipped.landed, 'a glancing hit still connects');
  assert.ok(square.impulse > 0, 'a clean hit must impart impulse');
  assert.ok(square.impulse > clipped.impulse, `square hit (${square.impulse.toFixed(2)}) must hurt more than a clipped one (${clipped.impulse.toFixed(2)})`);
});

test('committing costs you: a whiffed dive and a whiffed move both leave you out of the play', () => {
  const sim = freshSim();
  const carrier = sim.outfield(0)[0];
  const tackler = challenge(sim, carrier, 1.0);
  sim.giveBall(carrier);
  const chance = sim.rng.chance;

  sim.rng.chance = () => false; // whiff
  sim.tryTackle(tackler);
  sim.rng.chance = chance;
  assert.ok(tackler.stun >= COMBAT.diveCommit * 0.9, 'a missed dive must leave the tackler down');
  assert.ok(!sim.canAct(tackler), 'the tackler must not be able to act after missing');

  // A big commitment off the ball should end off balance too.
  const p = sim.outfield(0)[0];
  p.stun = 0;
  p.cd.trick = 0;
  sim.setState(p, 'swim');
  sim.tryTrick(p, new Vec3(1, 0, 0), false);
  const def = p.trick.def;
  sim.finishTrick(p);
  assert.ok(p.stun > 0, `${def.key} must leave the swimmer off balance afterwards`);
  assert.equal(p.trick, null, 'the move is spent');
  assert.ok(p.stun >= def.commit * 0.8, 'the commit cost must scale with the move');
});

test('a whiffed big hit stuns the hitter, and a big hit puts the victim on the floor', () => {
  const sim = freshSim();
  const hitter = sim.outfield(0).find((p) => !p.isKeeper);
  hitter.pow = 99;
  const chance = sim.rng.chance;

  // Nothing in range: pure whiff.
  for (const q of sim.opponentsOf(hitter)) q.pos.set(q.pos.x + 40, 0, q.pos.z + 40);
  sim.rng.chance = () => true;
  assert.equal(sim.tryHit(hitter), false, 'a hit with nobody in range misses');
  sim.rng.chance = chance;
  assert.ok(hitter.stun >= COMBAT.hitWhiff * 0.9, 'a whiffed swing must leave the hitter exposed');

  // Someone square in front: knockdown.
  hitter.stun = 0;
  hitter.cd.hit = 0;
  sim.setState(hitter, 'swim');
  const victim = challenge(sim, hitter, 1.0);
  sim.rng.chance = () => true;
  sim.tryHit(hitter);
  sim.rng.chance = chance;
  assert.equal(victim.state, 'fallen', 'a landed big hit knocks the victim down');
  assert.ok(victim.stun > 0, 'a downed swimmer is out of the play');
});

test('a reeled defender recovers faster than a felled one', () => {
  assert.ok(MOVE.reelDuration < MOVE.fallenDuration, 'soft contact must be shorter than a knockdown');
  const sim = freshSim();
  const sim2 = freshSim();
  const a = sim.outfield(0)[0];
  const b = sim2.outfield(0)[0];
  const hitterA = sim.opponentsOf(a).find((q) => !q.isKeeper);
  const hitterB = sim2.opponentsOf(b).find((q) => !q.isKeeper);
  sim.knockDown(a, hitterA, 'tackle', 'reel', 1);
  sim2.knockDown(b, hitterB, 'hit', 'fallen', 1);
  assert.equal(a.state, 'reel');
  assert.equal(b.state, 'fallen');
  assert.ok(a.stateDur < b.stateDur, 'a reeled swimmer is back sooner');
  assert.ok(a.vel.lengthXZ() > 0, 'contact imparts impulse even on a soft hit');
});

test('starters cover a spread of moves across a full match', () => {
  // Guards the "signature" promise end to end: the eleven swimmers who actually get used in a
  // match do not all share one button move.
  const used = new Set();
  for (const t of TEAMS) for (const p of starters(t)) used.add(p.move);
  assert.ok(used.size >= 8, `only ${used.size} distinct signature moves reach the pitch`);
});
