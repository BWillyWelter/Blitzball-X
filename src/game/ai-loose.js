import { Vec3 } from '../core/vec3.js';
import { moveToward } from './ai-core.js';

/** One designated chaser per team. Everyone else preserves a distinct support lane. */
export function looseBallAI(sim, p, dt, roll) {
  const b = sim.ball;
  const f = b.flight;
  const mates = sim.outfield(p.team).filter((q) => q.stun <= 0 && q.state !== 'fallen' && !q.sentOff);
  let chaser = null;
  let nearest = Infinity;
  for (const mate of mates) {
    const distance = mate.pos.distanceToXZ(b.pos);
    if (distance < nearest) { nearest = distance; chaser = mate; }
  }
  const dir = sim.attackDir(p.team);
  const goal = sim.goalPos(p.team);
  const own = sim.ownGoalPos(p.team);
  const lanes = [2.8, -2.8, 5.8, -5.8, 1.8, -1.8];
  const lane = lanes[(p.slot - 1) % lanes.length];
  if (f && (f.kind === 'pass' || f.kind === 'lob')) {
    if (f.target === p) {
      moveToward(p, f.to, 1, false);
      if (f.kind === 'lob' && f.t / f.dur > 0.55 && p.pos.distanceToXZ(f.to) < 1.2 && p.cd.breach <= 0) p.input.breach = true;
      return;
    }
    if (f.passer.team !== p.team) {
      if (p === chaser && nearest < 1.6 && p.cd.tackle <= 0 && roll && p.ai.lungedFor !== f &&
          sim.rng.chance(0.4 * sim.difficulty.tackleRate * (sim.defenseMods(p.team).lane || 1))) {
        p.ai.lungedFor = f;
        p.input.trick = true;
      }
      moveToward(p, new Vec3((f.to.x + own.x) / 2 + dir * (p.slot <= 2 ? 1.5 : -1), 0, lane), 0.9, false);
    } else {
      moveToward(p, new Vec3(goal.x - dir * (p.isShooter ? 4 : 7), 0, lane), 0.8, false);
    }
    return;
  }
  if (f?.kind === 'shot') {
    const attacking = f.shooter.team === p.team;
    if (!attacking && p === chaser && nearest < 1.9 && p.cd.breach <= 0 && roll && sim.rng.chance(0.5 * sim.difficulty.aiReaction)) p.input.breach = true;
    // Only the nearest attacker crashes the rebound; the rest remain passing outlets.
    const depth = attacking ? (p === chaser ? 2.2 : p.isShooter ? 4.5 : 7) : 3.5 + (p.slot % 3) * 1.4;
    const end = attacking ? goal : own;
    moveToward(p, new Vec3(end.x + (attacking ? -dir : dir) * depth, 0, lane), 0.9, attacking && p === chaser);
    return;
  }
  if (p === chaser) {
    moveToward(p, b.pos, 1, p.turbo > 35 && nearest > 3);
    if (b.pos.y > 1.2 && nearest < 1.4 && p.cd.breach <= 0) p.input.breach = true;
    return;
  }
  const attacking = sim.possession === p.team;
  const x = attacking ? b.pos.x + dir * (p.isShooter ? 4 : -2) : (b.pos.x + own.x) / 2;
  moveToward(p, new Vec3(x, 0, lane), 0.85, false);
}
