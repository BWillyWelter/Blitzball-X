import { Vec3 } from '../core/vec3.js';
import { moveToward } from './ai-core.js';

/**
 * Offense, off the ball.
 *
 * Role shapes: shooters live high near the zone looking for their shot; fielders work the wings
 * and the slot, moving the ball and setting screens so the shooters can release. A shooter often
 * cuts to the crease (they are the scorers); a fielder mostly holds shape. The called offensive
 * play scales the shape's width, so ISO really does pull them apart.
 */
export function offBallOffenseAI(sim, p, dt, roll) {
  const ai = p.ai;
  const g = sim.goalPos(p.team);
  const dir = sim.attackDir(p.team);
  const holder = sim.ball.holder;
  const rng = sim.rng;
  // Lob incoming? Get under it.
  if (ai.oop && sim.ball.flight && sim.ball.flight.kind === 'lob' && sim.ball.flight.target === p) {
    const to = sim.ball.flight.to;
    moveToward(p, new Vec3(to.x, 0, to.z), 1, true);
    if (p.pos.distanceToXZ(to) < 1.0 && sim.ball.flight.t / sim.ball.flight.dur > 0.6 && p.cd.breach <= 0) p.input.breach = true;
    return;
  }
  if (ai.cutTimer > 0) {
    ai.cutTimer -= dt;
    if (ai.cutTimer <= 0) ai.cutting = false;
  }
  const spacing = sim.offensePlayOf(p.team).spacing || 1;
  const shooterIdx = p.isShooter ? (p.slot === 1 ? 0 : 1) : null;
  const fieldIdx = ((p.slot - 3) % 4 + 4) % 4;
  const spots = p.isShooter
    ? [new Vec3(g.x - dir * 3.2, 0, 2.2 * spacing), new Vec3(g.x - dir * 3.4, 0, -2.2 * spacing)]
    : [
        new Vec3(g.x - dir * 5.6, 0, 4.4 * spacing),
        new Vec3(g.x - dir * 5.6, 0, -4.4 * spacing),
        new Vec3(g.x - dir * 7.4, 0, 1.6 * spacing),
        new Vec3(g.x - dir * 7.4, 0, -1.6 * spacing),
      ];
  const slotIdx = p.isShooter ? shooterIdx : fieldIdx;
  let spot = spots[slotIdx % spots.length];
  if (sim.offensePlayOf(p.team).id === 'iso') {
    // Clear the central drive lane while keeping shooters on opposite shoulders.
    spot = new Vec3(holder.pos.x + dir * (p.isShooter ? 3 : -2), 0,
      (slotIdx % 2 === 0 ? 1 : -1) * (p.isShooter ? 5.5 : 7 + Math.floor(slotIdx / 2)));
    ai.cutting = false;
  }
  if (ai.cutting) spot = new Vec3(g.x - dir * 3.0, 0, (p.pos.z > 0 ? 1 : -1) * 1.6);
  // Shooters cut to the crease often (they are the scorers); fielders mostly hold shape.
  const cutChance = p.isShooter ? 0.2 : 0.06;
  const anotherCut = sim.outfield(p.team).some((mate) => mate !== p && mate.ai.cutting && mate.ai.cutTimer > 0);
  if (sim.offensePlayOf(p.team).id !== 'iso' && roll && !ai.cutting && !anotherCut && holder.pos.distanceToXZ(g) < 9 && rng.chance(cutChance)) {
    ai.cutting = true;
    ai.cutTimer = 1.5;
  }
  // Stay behind the ball line a bit if the carrier is far back (support)
  if ((holder.pos.x - p.pos.x) * dir < -6) spot = new Vec3(holder.pos.x + dir * (p.isShooter ? 4 : -1.5), 0, spot.z);
  moveToward(p, spot, 0.95, ai.cutting && p.turbo > 30);
}
