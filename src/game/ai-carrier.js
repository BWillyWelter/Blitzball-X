import { Vec3, clamp } from '../core/vec3.js';
import { ACTION, ARENA } from '../data/constants.js';
import { moveFor } from './moves.js';
import { moveToward, nearestOpponentDist, shotLaneOpen } from './ai-core.js';

/**
 * The ball carrier.
 *
 * The decision order is deliberate and reads like a player: take the shot if the look is there,
 * otherwise move the ball, otherwise reach for a signature move that fits the situation, otherwise
 * drive at the goal. Shoot desire is a weighted sum (range, lane, pressure, clock, momentum, role)
 * so the CPU's shot selection emerges from the same pressures the human feels rather than a
 * scripted table.
 */
export function carrierAI(sim, p, dt, roll) {
  const ai = p.ai;
  const diff = sim.difficulty;
  const rng = sim.rng;
  const g = sim.goalPos(p.team);
  const dist = p.pos.distanceToXZ(g);
  const near = nearestOpponentDist(sim, p);
  const pressure = near.d < 1.9;
  const clockLow = sim.possessionClock < 4.5;
  const laneOpen = shotLaneOpen(sim, p);

  // Gamebreaker
  if (roll && sim.gbReady[p.team] && sim.state === 'live' && dist < 11 && rng.chance(0.5 * diff.aiGbRate)) {
    p.input.gamebreaker = true;
    return;
  }

  // Shooting: keep the shot logic on the timing window like a human would.
  if (p.state === 'shoot' && p.shot && !p.shot.released) {
    const u = p.stateTime / p.shot.wind;
    // In FLOW the striker's timing sharpens — release closer to perfect.
    const target = sim.flow[p.team] ? 0.86 : (ai.releaseAt || 0.77);
    if (u >= target) {
      p.input.shootReleased = true;
    } else {
      // Rise for the top ring, stay flat for a low ring — depth at release picks the tier.
      p.input.moveY = ai.wantTopRing ? 1 : -0.4;
    }
    return;
  }

  const inRange = dist < ACTION.shotMaxRange - 3;
  const goodRange = dist < 6.5;
  let shootDesire = 0;
  if (inRange) {
    shootDesire = goodRange ? 0.12 : 0.04;
    if (laneOpen) shootDesire += goodRange ? 0.12 : 0.05;
    if (pressure) shootDesire += 0.1;
    if (clockLow) shootDesire += 0.6;
    if (sim.momentum[p.team] >= 2) shootDesire += 0.12;
    // Shooters hunt their shot; fielders only shoot as a last resort.
    if (p.isShooter) shootDesire *= 1.35;
    // In the zone the CPU striker becomes an egoist: hunt the goal instead of recycling.
    if (sim.flow[p.team]) shootDesire += 0.5;
    shootDesire *= 0.6 + (p.data.sht / 99) * 0.6;
  } else if (clockLow && dist < ACTION.shotMaxRange) shootDesire = 0.9;

  if (roll && rng.chance(clamp(shootDesire, 0, 0.95))) {
    p.input.shootPressed = true;
    // timing skill: better shooters release closer to perfect
    const skill = (p.data.sht / 99) * diff.shotAccuracy;
    ai.releaseAt = 0.77 + (rng.next() - 0.5) * (0.5 - skill * 0.36);
    // Ring choice: a confident sniper rises for the 3-ring; everyone else drills a low ring.
    // The swimmer's depth at release drives which tier the shot aims at (see fireShot).
    const wantTop = p.data.sht > 78 && rng.chance(0.45 + (p.data.sht - 78) / 60);
    ai.wantTopRing = wantTop;
    return;
  }

  // Passing
  let passDesire = 0;
  const mates = sim.teammatesOf(p).filter((q) => !q.isKeeper && q.state !== 'fallen');
  let bestMate = null;
  let bestScore = -Infinity;
  for (const q of mates) {
    const qd = q.pos.distanceToXZ(g);
    const open = nearestOpponentDist(sim, q).d;
    let s = (dist - qd) * 0.9 + Math.min(open, 4) * 1.2;
    if (q.ai.cutting) s += 3;
    if (qd < 6 && open > 1.4) s += 3;
    if (s > bestScore) {
      bestScore = s;
      bestMate = q;
    }
  }
  if (bestMate) {
    passDesire = 0.08 + clamp(bestScore / 12, 0, 0.6) * (0.5 + (p.data.pas / 99) * 0.6);
    if (pressure) passDesire += 0.25;
    if (p.isKeeper) passDesire = 0.9;
    if (near.d < 1.2 && near.q && near.q.state === 'tackle') passDesire += 0.3;
  }
  if (roll && bestMate && rng.chance(clamp(passDesire, 0, 0.85))) {
    // The alley-oop is a highlight, not the metagame. It takes a genuine set: the target cutting
    // into open water near the ring, a clear lane to weigh it, and the time to play it — otherwise
    // the ball goes to feet and the build-up stays on the ground.
    const lob =
      !pressure &&
      bestMate.pos.distanceToXZ(g) < 6 &&
      bestMate.ai.cutting &&
      nearestOpponentDist(sim, bestMate).d > 1.6 &&
      shotLaneOpen(sim, p) &&
      rng.chance(0.35);
    p.input.pass = true;
    p.input.turbo = lob;
    // Steer the pass selection toward that mate. The aim vector doubles as the lead (see
    // passing.js), so where the CPU POINTS decides where the ball lands: a mate who is running
    // into space is aimed at down his run (a real lead pass, and the one the player is trying to
    // play by hand), and a mate who is standing still or tightly marked gets a plain ball at
    // his feet. It never aims backwards — that would select a different receiver.
    let aimAt = bestMate.pos;
    if (!lob && bestMate.vel.lengthXZ() > 2 && nearestOpponentDist(sim, bestMate).d > 1.8) {
      aimAt = new Vec3(bestMate.pos.x + bestMate.vel.x * 0.5, 0, bestMate.pos.z + bestMate.vel.z * 0.5);
    }
    const d = Vec3.dirXZ(p.pos, aimAt);
    p.input.moveX = d.x;
    p.input.moveZ = d.z;
    return;
  }

  // Signature move: what this swimmer's move is actually FOR decides when they reach for it, so
  // the CPU uses each move the way the move is meant to be used instead of mashing TRICK.
  if (roll && near.q && near.d < 2.4 && p.cd.trick <= 0) {
    const toDef = Vec3.dirXZ(p.pos, near.q.pos);
    const toGoal = Vec3.dirXZ(p.pos, g);
    const inFront = toDef.dot(toGoal) > 0.3;
    const kind = moveFor(p).kind;
    let trickDesire = inFront ? 0.28 : 0.08;
    trickDesire *= 0.5 + (p.data.hnd / 99) * 0.8;
    if (near.q.state === 'tackle') trickDesire += 0.3;
    // Reach for the move when its mechanic actually fits the situation.
    if (kind === 'surge') trickDesire *= 0.4 + (p.data.pow / 99) * 1.1; // only worth it if you can hit hard
    else if (kind === 'spin') trickDesire *= near.q.state === 'tackle' ? 1.5 : 0.7; // wants a defender staring at you
    else if (kind === 'feint') trickDesire *= near.q.state === 'tackle' ? 1.6 : 0.6; // wants a committed defender
    else if (kind === 'roll' || kind === 'vault' || kind === 'undertow') trickDesire *= near.q.state === 'tackle' ? 1.4 : 0.8;
    else if (kind === 'dash' || kind === 'climb') trickDesire *= 0.85;
    else trickDesire *= near.d < 1.6 ? 1.25 : 0.75; // glance: tight and close
    if (rng.chance(clamp(trickDesire, 0, 0.8))) {
      p.input.trick = true;
      // side-step direction: perpendicular to the defender, biased toward goal
      const side = (toDef.x * toGoal.z - toDef.z * toGoal.x) > 0 ? -1 : 1;
      const perp = new Vec3(-toGoal.z * side, 0, toGoal.x * side);
      const dir = new Vec3(toGoal.x * 0.7 + perp.x, 0, toGoal.z * 0.7 + perp.z).normalize();
      p.input.moveX = dir.x;
      p.input.moveZ = dir.z;
      p.input.turbo = p.turbo > 40 && rng.chance(0.55 * diff.aiTurbo);
      return;
    }
  }

  // Hit a defender who is right on us (strong players)
  if (roll && near.q && near.d < ACTION.hitRange && p.data.pow > 70 && p.cd.hit <= 0 && rng.chance(0.12 * diff.hitRate)) {
    p.input.hit = true;
    return;
  }

  // Drive: toward the goal, arcing around the nearest defender.
  let target = new Vec3(g.x - sim.attackDir(p.team) * 2.0, 0, 0);
  if (near.q && near.d < 3.5) {
    const toDef = Vec3.dirXZ(p.pos, near.q.pos);
    const toGoal = Vec3.dirXZ(p.pos, g);
    if (toDef.dot(toGoal) > 0.2) {
      ai.driveSide = ai.driveSide || (rng.chance(0.5) ? 1 : -1);
      const perp = new Vec3(-toGoal.z * ai.driveSide, 0, toGoal.x * ai.driveSide);
      target = new Vec3(p.pos.x + toGoal.x * 2 + perp.x * 3, 0, p.pos.z + toGoal.z * 2 + perp.z * 3);
    }
  } else ai.driveSide = null;
  // Don't hug the wall
  if (target.lengthXZ() > ARENA.fieldRadius - 1) target.scale((ARENA.fieldRadius - 1) / target.lengthXZ());
  const wantTurbo = p.turbo > 35 && (near.d > 2.5 || sim.momentum[p.team] >= 2) && rng.next() < diff.aiTurbo;
  moveToward(p, target, 1, wantTurbo);
}
