/**
 * Shared helpers for the CPU brains.
 *
 * Every brain needs the same three primitives: steer toward a spot, measure the nearest threat, and
 * ask whether the shooting lane is clear. They live here so the per-role modules
 * (carrier/offense/defense/loose/keeper) each hold only their own decision-making.
 */
import { Vec3 } from '../core/vec3.js';

/**
 * Steer `p` toward `target` on the XZ plane. Returns the remaining distance.
 * Speed eases in over the last 1.2 m so the CPU doesn't jitter when it arrives, and turbo is only
 * requested if the swimmer actually has some in the tank.
 */
export function moveToward(p, target, speedScale = 1, turbo = false) {
  const dx = target.x - p.pos.x;
  const dz = target.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) return d;
  const s = Math.min(1, d / 1.2) * speedScale;
  p.input.moveX = (dx / d) * s;
  p.input.moveZ = (dz / d) * s;
  p.input.turbo = turbo && p.turbo > 20;
  return d;
}

/**
 * Nearest live outfield opponent to `pos` (defaults to the swimmer themselves), as { d, q }.
 * Fallen swimmers and keepers are ignored — they are not a threat to steer around.
 */
export function nearestOpponentDist(sim, p, pos = p.pos) {
  let bd = Infinity;
  let best = null;
  for (const q of sim.opponentsOf(p)) {
    if (q.isKeeper || q.state === 'fallen') continue;
    const d = q.pos.distanceToXZ(pos);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return { d: bd, q: best };
}

/** True when no live defender stands between `p` and their own goal. */
export function shotLaneOpen(sim, p) {
  const g = sim.goalPos(p.team);
  const dir = Vec3.dirXZ(p.pos, g);
  const dist = p.pos.distanceToXZ(g);
  for (const q of sim.opponentsOf(p)) {
    if (q.isKeeper || q.state === 'fallen') continue;
    const rel = Vec3.sub(q.pos, p.pos);
    const along = rel.x * dir.x + rel.z * dir.z;
    if (along < 0.3 || along > dist) continue;
    const perp = Math.abs(rel.x * dir.z - rel.z * dir.x);
    if (perp < 0.9) return false;
  }
  return true;
}
