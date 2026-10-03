import { Vec3, clamp } from '../core/vec3.js';
import { ARENA, ACTION, MOVE } from '../data/constants.js';
import { moveToward, nearestOpponentDist } from './ai-core.js';

/**
 * Keeper brain.
 *
 * Keepers swim freely inside the water sphere, so on top of the usual lateral movement they also
 * steer vertically: `p.y` is driven between ARENA.keeperMinY (low dive) and ARENA.keeperMaxY
 * (high grab) at up to MOVE.keeperDiveSpeed, which is what the save check reads
 * (`ARENA.goalY + keeper.y`). The water drag in updatePlayerPhysics damps y back toward the
 * playing plane, so a dive settles a touch short of its target — which keeps the corners of the
 * goal open and the keeper beatable.
 *
 * With the ball the keeper is a distributor: it feeds an outlet before the hold clock expires.
 * Without it the keeper holds the line, stays goal-side and mirrors the ball, reads the lead
 * point of any shot and dives for it, and sweeps up loose balls inside the crease.
 *
 * The lateral dive is the same committed lunge the player gets, aimed at where the ball is crossing
 * the line. The CPU keeper is not allowed to be worse at the one verb the mechanic is built on, so
 * both sides read the shot the same way; difficulty only changes how reliably they do it.
 */
export function keeperAI(sim, p, dt, roll) {
  const rng = sim.rng;
  const diff = sim.difficulty;
  const ai = p.ai;
  const b = sim.ball;
  const own = sim.ownGoalPos(p.team);
  const out = sim.attackDir(p.team); // from our own goal back toward the middle of the pool
  const holder = b.holder;

  // ------------------------------------------------------------------ holding
  if (holder === p) {
    const hold = p.keeperHold || 0;
    const pressure = nearestOpponentDist(sim, p).d;
    const outlet = sim.choosePassTarget(p, false);
    const late = hold > sim.rules.keeperHold - 1.0;
    if (outlet && (late || sim.possessionClock < 3 || pressure < 2.0 || (roll && rng.chance(0.3)))) {
      const d = Vec3.dirXZ(p.pos, outlet.pos);
      p.input.moveX = d.x;
      p.input.moveZ = d.z;
      p.input.pass = true;
      return;
    }
    // No outlet yet: drift along the line with the ball rather than camping behind the goal.
    moveToward(p, new Vec3(own.x + out * 1.0, 0, clamp(b.pos.z, -ARENA.keeperMaxZ, ARENA.keeperMaxZ)), 0.5, false);
    keeperDive(p, dt, 0, 0.5);
    return;
  }

  // -------------------------------------------------------------- positioning
  const flight = b.flight;
  const shot = flight && flight.kind === 'shot' && flight.shooter && flight.shooter.team !== p.team ? flight : null;
  const windUp = holder && holder.team !== p.team && holder.state === 'shoot' && holder.shot && !holder.shot.released;
  const ballToGoal = b.pos.distanceToXZ(own);

  // Read the shot: lead the ball to the point it will cross the goal line. The three-ring zone
  // is tall (top ring near the ceiling of the goal frame), so the keeper climbs with the ball.
  let targetZ = b.pos.z;
  let targetY = b.pos.y - ARENA.goalY;
  if ((shot || windUp) && Math.abs(b.vel.x) > 1) {
    const t = clamp((own.x - b.pos.x) / (Math.abs(b.vel.x) > 0.5 ? b.vel.x : -1), 0, 1.1);
    targetZ = b.pos.z + b.vel.z * t;
    targetY = b.pos.y + b.vel.y * t - ARENA.goalY;
  }
  // Mirroring is deliberately lazy: the keeper always trails the true target a little, so a
  // well-placed or late-moving shot still beats it. (Slightly sharper than before — keepers
  // now save the straight shots but remain beatable by aiming away from them.)
  const react = clamp(4.4 * diff.aiReaction, 1, 9);
  ai.trackZ = ai.trackZ === undefined ? b.pos.z : ai.trackZ + (targetZ - ai.trackZ) * Math.min(1, react * dt);
  ai.trackZ = clamp(ai.trackZ, -ARENA.keeperMaxZ, ARENA.keeperMaxZ);

  const danger = !!shot || !!windUp || (holder && holder.team !== p.team && ballToGoal < 12);

  // Sweep loose balls inside the crease instead of leaving them for the attackers.
  if (!holder && (!flight || flight.kind === 'loose') && ballToGoal < ARENA.creaseRadius * 0.9) {
    const d = p.pos.distanceToXZ(b.pos);
    moveToward(p, new Vec3(b.pos.x, 0, b.pos.z), 1, d > 2.5 && p.turbo > 25);
    keeperDive(p, dt, b.pos.y - ARENA.goalY, 1);
    return;
  }

  // Come off the line when the ball is close; otherwise sit on the goal line.
  const depth = clamp(1.0 + (9 - ballToGoal) * 0.1, 1.0, 1.7);
  const target = new Vec3(own.x + out * (danger ? depth : 1.0), 0, ai.trackZ);
  moveToward(p, target, shot ? 1 : 0.9, (shot || windUp) && p.turbo > 25);
  keeperDive(p, dt, targetY, shot || windUp ? 1 : 0.35);

  // Committed dive: going for a live shot buys reach on the save check and a wider pickup radius.
  if (roll && (shot || windUp) && ballToGoal < 12 && b.pos.distanceToXZ(p.pos) < ACTION.keeperReach + 1.5) {
    if (rng.chance(0.5 * diff.aiReaction)) {
      ai.diving = 0.4;
      keeperDive(p, dt, targetY, 1.6);
    }
  }

  // Lateral dive — aimed at where the ball is crossing the line.
  if (roll && (shot || windUp) && p.diveT <= 0 && p.cd.dive <= 0 && p.stamina > 18 && ballToGoal < 11) {
    const want = clamp(b.pos.z + b.vel.z * 0.18, -ARENA.keeperMaxZ, ARENA.keeperMaxZ);
    const dz = want - p.pos.z;
    if (Math.abs(dz) > 0.7 && rng.chance((0.12 + (p.data.cat / 99) * 0.22) * diff.aiReaction)) {
      sim.keeperDive(p, { z: dz, x: 0 });
    }
  }
}

/** Steer the keeper's vertical position toward `targetY` at a limited dive speed. */
export function keeperDive(p, dt, targetY, scale = 1) {
  const want = clamp(targetY, ARENA.keeperMinY, ARENA.keeperMaxY);
  const step = clamp(want - p.y, -MOVE.keeperDiveSpeed * scale * dt, MOVE.keeperDiveSpeed * scale * dt);
  p.y = clamp(p.y + step, ARENA.keeperMinY, ARENA.keeperMaxY);
}
