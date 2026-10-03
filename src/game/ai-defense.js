import { Vec3, clamp } from '../core/vec3.js';
import { ACTION } from '../data/constants.js';
import { moveToward } from './ai-core.js';

/**
 * Defense.
 *
 * One presser plus stable-ish man marks. Assignments are recomputed from current distances, so a
 * cut-back or a loose-ball recovery naturally rotates the nearest defender onto the threat.
 *
 * Stoppers mirror the enemy shooters: fielders take the two enemy shooters as their primary marks
 * (goal-side, tight), so the scorers never get a free look at the rings. Lower difficulties sag
 * toward the crease; an explicit DROP ZONE play overrides that so the tactical choice stays readable.
 */
export function defenseAI(sim, p, dt, roll) {
  const ai = p.ai;
  const diff = sim.difficulty;
  const rng = sim.rng;
  const holder = sim.ball.holder;
  const ownGoal = sim.ownGoalPos(p.team);
  const dir = sim.attackDir(p.team);
  const { presser, marks } = defensiveAssignments(sim, p, holder);
  const reaction = diff.aiReaction;

  if (p === presser) {
    const dHolder = p.pos.distanceToXZ(holder.pos);
    // Get goal-side of the carrier (FULL PRESS collapses the cushion and sits on their hip)
    const toGoal = Vec3.dirXZ(holder.pos, ownGoal);
    // Rookie defenders give the carrier a wider cushion; Legend defenders sit on their hip.
    const baseCushion = diff.pressCushion || 0.9;
    const cushion = (holder.state === 'trick' ? 1.3 : baseCushion) * (sim.defenseMods(p.team).cushion || 1);
    const target = new Vec3(holder.pos.x + toGoal.x * cushion, 0, holder.pos.z + toGoal.z * cushion);
    moveToward(p, target, 1, dHolder > 3 && p.turbo > 25 && rng.next() < diff.aiTurbo);
    if (roll) {
      // Dive tackle. Committing costs real time on a miss, so the CPU only dives when the odds
      // justify going to ground — but when it does, it goes.
      if (dHolder < ACTION.tackleRange + 0.1 && p.cd.tackle <= 0 && !holder.airborne) {
        // Organized defending is about position first: the dive is the punctuation, not the
        // sentence — the CPU commits when the odds are there, not every time it is in range.
        let pTackle = 0.13 + diff.tackleRate * 0.16;
        if (holder.state === 'idle' && holder.stateTime > 0.8) pTackle *= 1.8;
        if (holder.state === 'trick') pTackle *= 0.35;
        if (holder.state === 'shoot') pTackle *= 1.5;
        if (p.data.tkl > 80) pTackle *= 1.4;
        if (rng.chance(clamp(pTackle, 0, 0.6))) p.input.trick = true;
      }
      // Big hit
      if (!p.input.trick && dHolder < ACTION.hitRange && p.cd.hit <= 0 && p.data.pow > 68 && rng.chance((0.1 + (p.data.pow - 68) / 200) * diff.hitRate)) p.input.hit = true;
      // Block a shot wind-up by breaching
      if (holder.state === 'shoot' && holder.shot && !holder.shot.released && dHolder < 2.2 && p.cd.breach <= 0 && rng.chance(0.35 * reaction)) p.input.breach = true;
    }
    return;
  }

  // Shot in flight toward our goal: nearby defenders breach to block
  const f = sim.ball.flight;
  if (f && f.kind === 'shot' && f.shooter.team !== p.team) {
    const d = p.pos.distanceToXZ(sim.ball.pos);
    if (d < 1.8 && p.cd.breach <= 0 && roll && rng.chance(0.5 * reaction)) p.input.breach = true;
  }

  // Marking: man coverage is the default, while lower difficulties sag toward the crease. The
  // explicit DROP ZONE play overrides that bias so the tactical choice remains readable.
  const mark = marks.get(p);
  if (mark) {
    const toGoal = Vec3.dirXZ(mark.pos, ownGoal);
    // Stoppers sit tighter on shooters than on anyone else — deny the ring look entirely.
    const cushion = mark.isShooter && p.isFielder ? 0.9 : 1.2;
    let target = new Vec3(mark.pos.x + toGoal.x * cushion, 0, mark.pos.z + toGoal.z * cushion);
    const zoneBias = sim.defenseMods(p.team).block ? 0.55 : (diff.zoneBias || 0) * (mark.isShooter ? 0.4 : 1);
    if (zoneBias > 0) {
      const crease = new Vec3(ownGoal.x + dir * 3.2, 0, mark.pos.z * 0.35);
      target = new Vec3(target.x + (crease.x - target.x) * zoneBias, 0, target.z + (crease.z - target.z) * zoneBias);
    }
    // Pass lane awareness: if a pass is coming to our mark, step into it
    if (f && f.kind === 'pass' && f.target === mark && sim.ball.pos.distanceToXZ(p.pos) < 1.6 && p.cd.tackle <= 0 && roll && rng.chance(0.4 * diff.tackleRate)) p.input.trick = true;
    moveToward(p, target, 0.95, false);
  } else {
    // Protect the crease
    moveToward(p, new Vec3(ownGoal.x + dir * 3.5, 0, 0), 0.9, false);
  }
}

/**
 * Assign one presser and stable-ish man marks.
 *
 * The nearest outfielder to the carrier presses. The rest take one attacker each, shooters first
 * (they are the designated scorers), then nearest-man. Recomputing every step from live distances
 * is what makes a cut-back rotate the defense instead of leaving a man stranded on a dead runner.
 */
function defensiveAssignments(sim, p, holder) {
  const mates = [...sim.outfield(p.team)].sort((a, b) => a.pos.distanceToXZ(holder.pos) - b.pos.distanceToXZ(holder.pos));
  const enemies = sim.outfield(1 - p.team).filter((q) => q !== holder && q.state !== 'fallen');
  // Enemy shooters first — they are the designated scorers.
  enemies.sort((a, b) => (b.isShooter ? 1 : 0) - (a.isShooter ? 1 : 0));
  const marks = new Map();
  for (let i = 1; i < mates.length; i++) {
    const defender = mates[i];
    // A fielder takes a shooter if one is unmarked; otherwise nearest-man marking.
    const priority = p.isFielder && i <= 2 ? enemies.find((q) => q.isShooter && ![...marks.values()].includes(q)) : null;
    const pool = priority ? [priority, ...enemies.filter((q) => q !== priority)] : enemies;
    pool.sort((a, b) => defender.pos.distanceToXZ(a.pos) - defender.pos.distanceToXZ(b.pos));
    const mark = pool.shift();
    if (mark) {
      marks.set(defender, mark);
      const idx = enemies.indexOf(mark);
      if (idx >= 0) enemies.splice(idx, 1);
    }
  }
  return { presser: mates[0], marks };
}
