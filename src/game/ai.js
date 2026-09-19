import { Vec3, clamp } from '../core/vec3.js';
import { ARENA, ACTION, MOVE, RULES } from '../data/constants.js';

/**
 * CPU brains for Blitzball. Called once per sim step for every non-user-controlled player.
 * Writes into p.input (same struct the human uses) so AI and human go through identical rules.
 *
 * Randomised decisions are rolled on a cadence (every 0.25 s) rather than per frame so that
 * probabilities are meaningful and reproducible.
 */

export function updateAI(sim, p, dt) {
  const inp = p.input;
  inp.moveX = 0;
  inp.moveZ = 0;
  inp.turbo = false;
  inp.shootPressed = false;
  inp.shootReleased = false;
  inp.pass = false;
  inp.trick = false;
  inp.hit = false;
  inp.breach = false;
  inp.switchPlayer = false;
  inp.gamebreaker = false;
  const ai = p.ai;
  ai.rollTimer = (ai.rollTimer || 0) - dt;
  const roll = ai.rollTimer <= 0;
  if (roll) ai.rollTimer = 0.25;
  if (p.state === 'fallen' || p.state === 'stumble' || sim.state !== 'live' && sim.state !== 'gamebreaker') return;

  // Team playcalling: any outfielder rolls for it (state is team-level, so it doesn't matter
  // which player's roll fires). Uses the dedicated play-RNG so calling plays never shifts the
  // main deterministic stream that gameplay rolls, tests and balance sims depend on.
  if (roll && !p.isKeeper) cpuCallPlay(sim, p, sim.playRng);

  if (p.isKeeper) return keeperAI(sim, p, dt, roll);
  const ball = sim.ball;
  const holder = ball.holder;
  if (holder === p) return carrierAI(sim, p, dt, roll);
  if (holder && holder.team === p.team) return offBallOffenseAI(sim, p, dt, roll);
  if (holder) return defenseAI(sim, p, dt, roll);
  return looseBallAI(sim, p, dt, roll);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function moveToward(p, target, speedScale = 1, turbo = false) {
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

function nearestOpponentDist(sim, p, pos = p.pos) {
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

function shotLaneOpen(sim, p) {
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

// ---------------------------------------------------------------------------
// CPU playcalling
// ---------------------------------------------------------------------------

/**
 * CPU teams run their own playbook: presses/zones situationally on defense, iso/spread on
 * offense. Calls are infrequent (plays "stick" once set) so the sim's baseline balance —
 * which assumes the neutral default plays — barely moves.
 */
function cpuCallPlay(sim, p, rng) {
  const team = p.team;
  const attacking = sim.possession === team;
  const deficit = sim.score[1 - team] - sim.score[team]; // positive = we trail
  const cur = attacking ? sim.offPlay[team] : sim.defPlay[team];
  // Plays stick: entering a look is uncommon, and abandoning a called one is rarer still,
  // so a play typically holds for ~20-40s before the team re-evaluates.
  if (!rng.chance(cur === 0 ? 0.02 : 0.006)) return;
  if (attacking) {
    // Trailing late? Isolation and let the star go to work. Otherwise mix in Spread.
    const i = deficit >= 2 && sim.time > RULES.halfLength ? 2 : rng.chance(0.2) ? 1 : 0;
    if (i !== cur) sim.callPlay('offense', i, team);
  } else {
    // Trailing? Full Press to hunt turnovers. Otherwise occasional Drop Zone.
    const i = deficit >= 1 ? 2 : rng.chance(0.2) ? 1 : 0;
    if (i !== cur) sim.callPlay('defense', i, team);
  }
}

// ---------------------------------------------------------------------------
// Ball carrier
// ---------------------------------------------------------------------------

function carrierAI(sim, p, dt, roll) {
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
    const target = ai.releaseAt || 0.77;
    if (u >= target) p.input.shootReleased = true;
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
    shootDesire *= 0.6 + (p.data.sht / 99) * 0.6;
  } else if (clockLow && dist < ACTION.shotMaxRange) shootDesire = 0.9;

  if (roll && rng.chance(clamp(shootDesire, 0, 0.95))) {
    p.input.shootPressed = true;
    // timing skill: better shooters release closer to perfect
    const skill = (p.data.sht / 99) * diff.shotAccuracy;
    ai.releaseAt = 0.77 + (rng.next() - 0.5) * (0.5 - skill * 0.36);
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
    // Lob into the strike zone when the target is near the goal and not marked closely.
    const lob = bestMate.pos.distanceToXZ(g) < 7 && (nearestOpponentDist(sim, bestMate).d > 1.2 || bestMate.ai.cutting) && rng.chance(0.6);
    p.input.pass = true;
    p.input.turbo = lob;
    // steer the pass selection toward that mate
    const d = Vec3.dirXZ(p.pos, bestMate.pos);
    p.input.moveX = d.x;
    p.input.moveZ = d.z;
    return;
  }

  // Tricks: when a defender is closing in front of us
  if (roll && near.q && near.d < 2.4 && p.cd.trick <= 0) {
    const toDef = Vec3.dirXZ(p.pos, near.q.pos);
    const toGoal = Vec3.dirXZ(p.pos, g);
    const inFront = toDef.dot(toGoal) > 0.3;
    let trickDesire = inFront ? 0.28 : 0.08;
    trickDesire *= 0.5 + (p.data.hnd / 99) * 0.8;
    if (near.q.state === 'tackle') trickDesire += 0.3;
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

// ---------------------------------------------------------------------------
// Offense, off the ball
// ---------------------------------------------------------------------------

function offBallOffenseAI(sim, p, dt, roll) {
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
  // Spacing: two lanes (wide left / wide right) and a spot near the crease. The lanes sit a
  // little closer to the goal than before so volleys come from inside the strike zone instead
  // of from the edge of it. SPREAD FLOOR widens the whole shape for safer passing lanes.
  const spacing = sim.offensePlayOf(p.team).spacing || 1;
  const slotIdx = (p.slot + (holder.slot || 0)) % 3;
  const spots = [
    new Vec3(g.x - dir * 4.8, 0, 3.4 * spacing),
    new Vec3(g.x - dir * 4.8, 0, -3.4 * spacing),
    new Vec3(g.x - dir * (5.5 + 2 * spacing), 0, 0),
  ];
  let spot = spots[slotIdx];
  if (ai.cutting) spot = new Vec3(g.x - dir * 3.8, 0, (p.pos.z > 0 ? 1 : -1) * 1.6);
  // Occasional cut to the crease
  if (roll && !ai.cutting && holder.pos.distanceToXZ(g) < 9 && rng.chance(0.12)) {
    ai.cutting = true;
    ai.cutTimer = 1.5;
  }
  // Stay behind the ball line a bit if the carrier is far back (support)
  if ((holder.pos.x - p.pos.x) * dir < -6) spot = new Vec3(holder.pos.x + dir * 2.5, 0, p.pos.z);
  moveToward(p, spot, 0.95, ai.cutting && p.turbo > 30);
  // Defender in our face while we're a cutter: hit them
  if (roll && p.data.pow > 78 && p.cd.hit <= 0) {
    const near = nearestOpponentDist(sim, p);
    if (near.d < ACTION.hitRange && rng.chance(0.1 * sim.difficulty.hitRate)) p.input.hit = true;
  }
}

// ---------------------------------------------------------------------------
// Defense
// ---------------------------------------------------------------------------

function defenseAI(sim, p, dt, roll) {
  const ai = p.ai;
  const diff = sim.difficulty;
  const rng = sim.rng;
  const holder = sim.ball.holder;
  const ownGoal = sim.ownGoalPos(p.team);
  const dir = sim.attackDir(p.team);
  const mates = sim.outfield(p.team);
  // Assign: closest to carrier presses; others mark the remaining attackers / protect crease.
  const byDist = [...mates].sort((a, b) => a.pos.distanceToXZ(holder.pos) - b.pos.distanceToXZ(holder.pos));
  const presser = byDist[0];
  const attackers = sim.outfield(1 - p.team).filter((q) => q !== holder);
  const reaction = diff.aiReaction;

  if (p === presser) {
    const dHolder = p.pos.distanceToXZ(holder.pos);
    // Get goal-side of the carrier (FULL PRESS collapses the cushion and sits on their hip)
    const toGoal = Vec3.dirXZ(holder.pos, ownGoal);
    const cushion = (holder.state === 'trick' ? 1.3 : 0.9) * (sim.defenseMods(p.team).cushion || 1);
    const target = new Vec3(holder.pos.x + toGoal.x * cushion, 0, holder.pos.z + toGoal.z * cushion);
    moveToward(p, target, 1, dHolder > 3 && p.turbo > 25 && rng.next() < diff.aiTurbo);
    if (roll) {
      // Tackle attempt (more aggressive than before: defenders should actually win the ball)
      if (dHolder < ACTION.tackleRange + 0.1 && p.cd.tackle <= 0 && !holder.airborne) {
        let pTackle = 0.16 + diff.tackleRate * 0.16;
        if (holder.state === 'idle' && holder.stateTime > 0.8) pTackle *= 1.8;
        if (holder.state === 'trick') pTackle *= 0.35;
        if (holder.state === 'shoot') pTackle *= 1.5;
        if (p.data.tkl > 80) pTackle *= 1.4;
        if (rng.chance(clamp(pTackle, 0, 0.45))) p.input.trick = true;
      }
      // Big hit
      if (!p.input.trick && dHolder < ACTION.hitRange && p.cd.hit <= 0 && p.data.pow > 68 && rng.chance((0.06 + (p.data.pow - 68) / 250) * diff.hitRate)) p.input.hit = true;
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

  // Marking
  const idx = byDist.indexOf(p) - 1;
  const mark = attackers.sort((a, b) => a.pos.distanceToXZ(ownGoal) - b.pos.distanceToXZ(ownGoal))[idx] || attackers[0];
  if (mark) {
    const toGoal = Vec3.dirXZ(mark.pos, ownGoal);
    let target = new Vec3(mark.pos.x + toGoal.x * 1.2, 0, mark.pos.z + toGoal.z * 1.2);
    // DROP ZONE: sag off the mark toward the crease, clogging the middle of the pool
    if (sim.defenseMods(p.team).block) {
      const crease = new Vec3(ownGoal.x + dir * 3.2, 0, mark.pos.z * 0.35);
      target = new Vec3(target.x + (crease.x - target.x) * 0.45, 0, target.z + (crease.z - target.z) * 0.45);
    }
    // Pass lane awareness: if a pass is coming to our mark, step into it
    if (f && f.kind === 'pass' && f.target === mark && sim.ball.pos.distanceToXZ(p.pos) < 1.6 && p.cd.tackle <= 0 && roll && rng.chance(0.4 * diff.tackleRate)) p.input.trick = true;
    moveToward(p, target, 0.95, false);
  } else {
    // Protect the crease
    moveToward(p, new Vec3(ownGoal.x + dir * 3.5, 0, 0), 0.9, false);
  }
}

// ---------------------------------------------------------------------------
// Loose ball
// ---------------------------------------------------------------------------

function looseBallAI(sim, p, dt, roll) {
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

// ---------------------------------------------------------------------------
// Keeper
// ---------------------------------------------------------------------------

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
 */
function keeperAI(sim, p, dt, roll) {
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

  // Read the shot: lead the ball to the point it will cross the goal line.
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
}

/** Steer the keeper's vertical position toward `targetY` at a limited dive speed. */
function keeperDive(p, dt, targetY, scale = 1) {
  const want = clamp(targetY, ARENA.keeperMinY, ARENA.keeperMaxY);
  const step = clamp(want - p.y, -MOVE.keeperDiveSpeed * scale * dt, MOVE.keeperDiveSpeed * scale * dt);
  p.y = clamp(p.y + step, ARENA.keeperMinY, ARENA.keeperMaxY);
}
