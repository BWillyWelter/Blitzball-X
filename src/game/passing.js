import { Vec3, clamp } from '../core/vec3.js';
import { ACTION } from '../data/constants.js';

/**
 * Pass targeting and ball release, extracted from MatchSim. Functions take the sim as
 * their first argument and mutate it exactly as the original class methods did;
 * MatchSim keeps thin delegating methods. No DOM/three.js dependency.
 */

export function choosePassTarget(sim, p, lob) {
    const mates = sim.teammatesOf(p).filter((q) => q.state !== 'fallen' && !q.isKeeper);
    if (!mates.length) return null;
    const inp = p.input;
    const dir = new Vec3(inp.moveX, 0, inp.moveZ);
    const hasDir = dir.length() > 0.3;
    if (hasDir) dir.normalize();
    let best = null;
    let bs = -Infinity;
    for (const q of mates) {
      const d = p.pos.distanceToXZ(q.pos);
      let s = 10 - d * 0.5;
      if (hasDir) s += Vec3.dirXZ(p.pos, q.pos).dot(dir) * 8;
      if (q.ai.cutting) s += 4;
      if (lob && sim.distToGoal(q) < 6) s += 3;
      // open?
      for (const o of sim.opponentsOf(p)) if (o.pos.distanceToXZ(q.pos) < 1.6) s -= 3;
      if (s > bs) {
        bs = s;
        best = q;
      }
    }
    return best;
  }

export function tryPass(sim, p, targetOverride, lob) {
    const target = targetOverride || choosePassTarget(sim, p, lob);
    if (!target) return false;
    p.shot = null;
    p.hasBall = false;
    sim.ball.holder = null;
    p.lastPassTime = sim.time;
    p.facing = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
    sim.setState(p, 'pass', 0.25);
    const from = new Vec3(p.pos.x, 0.9 + p.y, p.pos.z);
    const useLob = !!lob && sim.distToGoal(target) < ACTION.volleyRange + 2;
    if (useLob) {
      // Lob toward a spot in front of the goal for a breach-volley finish.
      const g = sim.goalPos(p.team);
      const dir = Vec3.dirXZ(target.pos, g);
      const to = new Vec3(target.pos.x + dir.x * 1.2, ACTION.lobHeight + 0.6, target.pos.z + dir.z * 1.2);
      const dist = from.distanceTo(to);
      const dur = clamp(dist / ACTION.lobSpeed, 0.5, 1.2);
      sim.ball.flight = { kind: 'lob', from, to, t: 0, dur, arc: 1.6, passer: p, target, checked: new Set() };
      target.ai.oop = { t: 0, dur };
      sim.ball.releaseCooldown = { player: p, t: 0.3 };
      sim.events.emit('pass', { from: p, to: target, alley: true });
    } else {
      const lead = target.vel.clone().scale(0.28);
      const to = new Vec3(target.pos.x + lead.x, 0.9, target.pos.z + lead.z);
      const dist = from.distanceTo(to);
      const dur = clamp(dist / ACTION.passSpeed, 0.14, 0.95);
      sim.ball.flight = { kind: 'pass', from, to, t: 0, dur, arc: 0.25, passer: p, target, checked: new Set() };
      sim.ball.releaseCooldown = { player: p, t: 0.25 };
      sim.events.emit('pass', { from: p, to: target, alley: false });
    }
    sim.ball.lastTeam = p.team;
    return true;
  }
