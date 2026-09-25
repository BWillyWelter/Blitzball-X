import { Vec3, clamp } from '../core/vec3.js';
import { ARENA, PHYS, MOVE, ACTION } from '../data/constants.js';

/**
 * Movement / physics for MatchSim: locomotion + turbo fatigue, glue dribbling,
 * player separation, and arena constraints (keeper box, sphere wall, goal mouths).
 *
 * All functions take the sim as their first argument (same convention as ./combat.js).
 */

export function updatePlayerPhysics(sim, p, dt, deadBall) {
  p.stateTime += dt;
  if (p.stun > 0) p.stun -= dt;
  const inp = p.input;
  const isCarrier = sim.ball.holder === p;

  // Turbo (defensive fatigue: press costs more stamina, zone recovers some)
  const wantsTurbo = !deadBall && inp.turbo && (inp.moveX !== 0 || inp.moveZ !== 0) && p.turbo > MOVE.turboMin && (p.state === 'swim' || p.state === 'idle');
  p.turboActive = wantsTurbo;
  const endur = 0.7 + (p.data.end / 99) * 0.6;
  const onDefense = sim.possession !== p.team;
  const fatigue = onDefense ? sim.defenseMods(p.team).fatigue || 1 : 1;
  // FLOW: sprinting costs nothing while the zone is live.
  if (p.turboActive && !sim.flow[p.team]) p.turbo = Math.max(0, p.turbo - ((MOVE.turboDrain / endur) * fatigue) * dt);
  else p.turbo = Math.min(100, p.turbo + (MOVE.turboRegen * endur / fatigue) * dt);
  // FLOW: tight window, empowered movement, no turbo cost while it lasts (timer lives in step()).

  // Locomotion
  let maxSpeed = (p.isKeeper ? MOVE.keeperSpeed : MOVE.maxSpeed) * (0.82 + (p.data.spd / 99) * 0.36);
  if (p.turboActive) maxSpeed *= MOVE.turboMult;
  if (isCarrier) maxSpeed *= MOVE.carrierMult * (sim.offensePlayOf(p.team).speed || 1);
  const canMove = !deadBall && p.stun <= 0 && (p.state === 'idle' || p.state === 'swim' || p.state === 'catch' || p.state === 'shoot' && p.shot && !p.shot.released && p.shot.kind !== 'volley');
  if (p.state === 'trick' && p.trick) {
    // scripted trick motion
    const tr = p.trick;
    const u = clamp(p.stateTime / tr.def.dur, 0, 1);
    const speed = (tr.def.dist / tr.def.dur) * (1 - u * 0.6) * (tr.turbo ? 1.25 : 1);
    p.vel.set(tr.dir.x * speed, 0, tr.dir.z * speed);
    if (tr.def.vertical) p.y = Math.sin(u * Math.PI) * 0.9;
  } else if (p.state === 'gbdrive' && p.gbTarget) {
    const dir = Vec3.dirXZ(p.pos, p.gbTarget);
    p.vel.set(dir.x * ACTION.gbDriveSpeed, 0, dir.z * ACTION.gbDriveSpeed);
    p.facing = Math.atan2(dir.x, dir.z);
  } else if (canMove && (inp.moveX !== 0 || inp.moveZ !== 0)) {
    const accel = MOVE.accel * (0.8 + (p.data.spd / 99) * 0.4);
    const flowBoost = sim.flow[p.team] ? 1.12 : 1;
    const tx = inp.moveX * maxSpeed * flowBoost;
    const tz = inp.moveZ * maxSpeed * flowBoost;
    p.vel.x += (tx - p.vel.x) * Math.min(1, accel * dt / maxSpeed * 1.4);
    p.vel.z += (tz - p.vel.z) * Math.min(1, accel * dt / maxSpeed * 1.4);
    const target = Math.atan2(inp.moveX, inp.moveZ);
    p.facing = turnToward(p.facing, target, dt * 11);
    if (p.state === 'idle') sim.setState(p, 'swim');
  } else {
    const dec = p.state === 'fallen' ? 2.5 : MOVE.decel;
    const k = Math.max(0, 1 - dec * dt);
    p.vel.x *= k;
    p.vel.z *= k;
    if (p.state === 'swim' && p.vel.lengthXZ() < 0.3) sim.setState(p, 'idle');
  }

  // Vertical (breach)
  if (p.airborne) {
    p.vy += PHYS.gravityPlayer * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0;
      p.vy = 0;
      p.airborne = false;
      if (p.state === 'breach' || p.state === 'volley') sim.setState(p, 'idle');
      sim.events.emit('splash', { player: p, pos: p.pos.clone(), size: 0.6 });
    }
  } else if (p.state !== 'trick') {
    p.y *= Math.max(0, 1 - dt * 6);
  }

  // Integrate
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  constrainPlayer(sim, p);
  p.speedNorm = clamp(p.vel.lengthXZ() / (MOVE.maxSpeed * MOVE.turboMult), 0, 1);

  // State timeouts
  if (p.stateDur > 0 && p.stateTime >= p.stateDur) {
    switch (p.state) {
      case 'trick':
        sim.finishTrick(p);
        break;
      case 'shoot':
        if (p.shot && !p.shot.released) sim.releaseShot(p);
        else sim.setState(p, 'idle');
        break;
      case 'gbwind':
        sim.startGbDrive(p);
        break;
      case 'gbdrive':
        sim.gbShoot(p);
        break;
      case 'fallen':
      case 'stumble':
      case 'tackle':
      case 'hit':
      case 'catch':
      case 'pass':
      case 'celebrate':
      case 'save':
      case 'volley':
        sim.setState(p, 'idle');
        break;
      default:
        break;
    }
  }
}

export function constrainPlayer(sim, p) {
  const dir = sim.attackDir(p.team);
  if (p.isKeeper) {
    // Keeper stays in its box in front of its own goal.
    const own = -ARENA.goalX * dir;
    const inner = own + dir * (ARENA.goalX - ARENA.keeperMinX); // toward centre
    const outer = own + dir * (ARENA.goalX - ARENA.keeperMaxX);
    const lo = Math.min(inner, outer);
    const hi = Math.max(inner, outer);
    p.pos.x = clamp(p.pos.x, lo, hi);
    p.pos.z = clamp(p.pos.z, -ARENA.keeperMaxZ, ARENA.keeperMaxZ);
    return;
  }
  const r = p.pos.lengthXZ();
  if (r > ARENA.fieldRadius) {
    const s = ARENA.fieldRadius / r;
    p.pos.x *= s;
    p.pos.z *= s;
    // slide along the wall
    const nx = p.pos.x / ARENA.fieldRadius;
    const nz = p.pos.z / ARENA.fieldRadius;
    const vn = p.vel.x * nx + p.vel.z * nz;
    if (vn > 0) {
      p.vel.x -= vn * nx;
      p.vel.z -= vn * nz;
    }
  }
  // Cannot swim through either goal mouth
  for (const gx of [ARENA.goalX, -ARENA.goalX]) {
    if (Math.abs(p.pos.x) > ARENA.playerMaxX && Math.abs(p.pos.z) < ARENA.goalRadius + 0.4 && Math.sign(p.pos.x) === Math.sign(gx)) {
      p.pos.x = Math.sign(gx) * ARENA.playerMaxX;
      if (Math.sign(p.vel.x) === Math.sign(gx)) p.vel.x = 0;
    }
  }
}

/**
 * Rematch-style glue dribbling: the ball rides just ahead of the carrier's feet and is only
 * released by shooting, passing, or being poke/slide-tackled. A touch counter drives style;
 * a FLOW carrier can't be poked at all.
 */
export function updateGlueDribble(sim, dt) {
  const holder = sim.ball.holder;
  if (!holder) return;
  const f = sim.forwardOf(holder);
  const ahead = 0.55 + Math.min(0.5, holder.vel.lengthXZ() * 0.09);
  sim.ball.pos.x = holder.pos.x + f.x * ahead;
  sim.ball.pos.z = holder.pos.z + f.z * ahead;
  sim.ball.pos.y = 0.5 + Math.sin(sim.time * 9) * 0.06;
  sim.ball.vel.set(holder.vel.x, 0, holder.vel.z);
  holder.dribbleTouch += dt;
}

export function separatePlayers(sim) {
  const n = sim.players.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = sim.players[i];
      const b = sim.players[j];
      if (a.airborne !== b.airborne && Math.abs(a.y - b.y) > 0.9) continue;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const min = MOVE.separation;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        const wa = a.state === 'fallen' || a.isKeeper ? 0 : 1;
        const wb = b.state === 'fallen' || b.isKeeper ? 0 : 1;
        const tot = wa + wb || 1;
        a.pos.x -= nx * push * 2 * (wa / tot);
        a.pos.z -= nz * push * 2 * (wa / tot);
        b.pos.x += nx * push * 2 * (wb / tot);
        b.pos.z += nz * push * 2 * (wb / tot);
      }
    }
  }
  for (const p of sim.players) constrainPlayer(sim, p);
}

function turnToward(
  current,
  target,
  maxDelta
) {
  let delta = target - current;

  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }

  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }

  if (Math.abs(delta) <= maxDelta) {
    return target;
  }

  return (
    current +
    Math.sign(delta) *
      maxDelta
  );
}
