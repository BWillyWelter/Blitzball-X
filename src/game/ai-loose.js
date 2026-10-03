import { Vec3 } from '../core/vec3.js';
import { moveToward, nearestOpponentDist } from './ai-core.js';

/**
 * Loose ball.
 *
 * With a ball in flight this splits three ways: the intended receiver runs the ball down, an
 * opponent within lunging range tries to jump the lane, and everyone else drops into shape
 * (attackers stay open ahead of the ball, defenders recover goal-side). With the ball at rest the
 * closest swimmer races it and everyone else holds — which keeps a scramble from turning into
 * seven swimmers converging on one spot.
 */
export function looseBallAI(sim, p, dt, roll) {
  const b = sim.ball;
  const f = b.flight;
  const rng = sim.rng;
  // Is a pass to me in flight?
  if (f && (f.kind === 'pass' || f.kind === 'lob')) {
    if (f.target === p) {
      moveToward(p, new Vec3(f.to.x, 0, f.to.z), 1, false);
      if (f.kind === 'lob' && f.t / f.dur > 0.55 && p.pos.distanceToXZ(f.to) < 1.2 && p.cd.breach <= 0) p.input.breach = true;
      return;
    }
    if (f.passer.team !== p.team) {
      // Jump the lane if I'm close
      const d = p.pos.distanceToXZ(b.pos);
      if (d < 1.6 && p.cd.tackle <= 0 && roll && p.ai.lungedFor !== f && rng.chance(0.4 * sim.difficulty.tackleRate * (sim.defenseMods(p.team).lane || 1))) {
        p.ai.lungedFor = f;
        p.input.trick = true;
      }
      // otherwise fall back into defensive shape
      const ownGoal = sim.ownGoalPos(p.team);
      const mid = new Vec3((f.to.x + ownGoal.x) / 2, 0, f.to.z * 0.5);
      moveToward(p, mid, 0.9, false);
      return;
    }
    // Teammate's pass to someone else: get open
    const g = sim.goalPos(p.team);
    moveToward(p, new Vec3(g.x - sim.attackDir(p.team) * 5, 0, p.pos.z > 0 ? 3.5 : -3.5), 0.8, false);
    return;
  }
  // Shot in flight (either team): attackers crash for rebounds, defenders try to block
  if (f && f.kind === 'shot') {
    const mine = f.shooter.team === p.team;
    if (!mine) {
      const d = p.pos.distanceToXZ(b.pos);
      if (d < 1.9 && p.cd.breach <= 0 && roll && rng.chance(0.5 * sim.difficulty.aiReaction)) p.input.breach = true;
      // Recover goal-side instead of chasing the ball into our own net.
      const ownGoal = sim.ownGoalPos(p.team);
      moveToward(p, new Vec3((b.pos.x + ownGoal.x) / 2, 0, b.pos.z * 0.6), 1, false);
      return;
    }
    // Our shot: crash the crease for the rebound.
    const g = sim.goalPos(p.team);
    moveToward(p, new Vec3(g.x - sim.attackDir(p.team) * 2.2, 0, (b.pos.z >= 0 ? 1 : -1) * 2.4), 1, true);
    return;
  }
  // Resting loose ball: the closest swimmer races it (and can breach for a floating ball),
  // everyone else holds their shape.
  const g = sim.goalPos(p.team);
  const ownGoal = sim.ownGoalPos(p.team);
  const mates = [...sim.outfield(p.team)].sort((a, q) => a.pos.distanceToXZ(b.pos) - q.pos.distanceToXZ(b.pos));
  const contest = p === mates[0] || nearestOpponentDist(sim, p, b.pos).d < 2.5;
  if (contest) {
    moveToward(p, new Vec3(b.pos.x, 0, b.pos.z), 1, p.turbo > 35 && p.pos.distanceToXZ(b.pos) > 3);
    if (b.pos.y > 1.2 && p.pos.distanceToXZ(b.pos) < 1.4 && p.cd.breach <= 0) p.input.breach = true;
    return;
  }
  if (sim.possession === p.team) {
    // Supporting the chase: stay open, ahead of the ball and on our shooting side.
    moveToward(p, new Vec3(g.x - sim.attackDir(p.team) * 5, 0, p.pos.z > 0 ? 3.5 : -3.5), 0.85, false);
  } else {
    moveToward(p, new Vec3((b.pos.x + ownGoal.x) / 2, 0, b.pos.z * 0.5), 0.9, p.turbo > 25);
  }
}
