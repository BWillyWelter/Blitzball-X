import { Vec3, clamp } from '../core/vec3.js';
import { ACTION, ARENA, STYLE } from '../data/constants.js';

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

  /**
  * Where the ball actually lands.
  *
  * The receiver's own velocity always contributes (you cannot pass to where someone is going to
  * be in 90 ms without leading them at all). On top of that the stick biases the spot ALONG the
  * line the passer is aiming, which is what makes the lead a decision rather than an automatic:
  * hold the run and the ball is pushed in front of the receiver into the space they are attacking;
  * hold it short and it drops at their feet. The reward scales with how far ahead of the run the
  * ball actually was and how clear that landing spot is, so a pass threaded past a marker pays and
  * a pass thrown at a defender's hands does not.
  *
  * The aim is scaled by `pas`, so a good passer genuinely threads leads a poor passer cannot.
  */
export function passLanding(sim, p, target, aim) {
    const skill = 0.55 + (p.data.pas / 99) * 0.75;
    const toTarget = Vec3.dirXZ(p.pos, target.pos);
    // Lead the receiver by the time the ball will actually take to get there — not by a fixed
    // guess. The old fixed 0.28 s lead was shorter than the flight time of anything but a short
    // pass, so every long ball was dropping behind a runner instead of in front of them.
    // Solved in two passes: a ball led PAST the receiver travels further than one thrown at them,
    // so the flight time has to be worked out against the led spot, not against where they are
    // standing — otherwise the ball lands a little short of the point it was supposed to reach.
    const gap = p.pos.distanceToXZ(target.pos);
    const speed = Math.hypot(target.vel.x, target.vel.z);
    let dur = clamp(gap / ACTION.passSpeed, 0.14, 0.95);
    if (speed > 0.01) {
      // Three passes converges well inside a hand's width; one was not enough to land on the
      // intercept point, and a lead that stops a fifth of a metre short is not a lead.
      for (let i = 0; i < 3; i++) dur = clamp((gap + speed * dur) / ACTION.passSpeed, 0.14, 0.95);
    }
    // The intercept point is where the receiver will BE when the ball arrives. The aim then moves
    // the landing spot either side of it: ahead of it is a lead, behind it is a check pass.
    const base = new Vec3(target.pos.x + target.vel.x * dur, 0.9, target.pos.z + target.vel.z * dur);
    const dist = p.pos.distanceToXZ(base);
    let x = base.x;
    let z = base.z;
    let pushed = 0;
    if (aim && aim.length() > 0.3) {
      // Only the component of the aim down the pass line can move the ball — aiming sideways
      // picks a different RECEIVER (choosePassTarget), it does not bend the pass around anyone.
      const along = clamp(aim.x * toTarget.x + aim.z * toTarget.z, -1, 1);
      const ahead = Math.max(0, along) * ACTION.leadAimAhead * skill * clamp(dist / 8, 0.35, 1);
      const check = Math.max(0, -along) * ACTION.leadAimCheck * skill * clamp(dist / 8, 0.35, 1);
      x = base.x + toTarget.x * (ahead - check);
      z = base.z + toTarget.z * (ahead - check);
      pushed = ahead - check;
    }
    // Keep the landing spot inside the pool and off the glass.
    const r = Math.hypot(x, z);
    if (r > ARENA.ballRadius) {
      const s = ARENA.ballRadius / r;
      x *= s;
      z *= s;
    }
    return { x, z, pushed };
  }

export function tryPass(sim, p, targetOverride, lob) {
    const target = targetOverride || choosePassTarget(sim, p, lob);
    if (!target) return false;
    // Pass-and-move: the passer never stands still after releasing. Cutting away from the
    // pass pulls their marker with them and reopens the lane the ball just travelled.
    if (!p.isKeeper) {
      p.ai.cutting = true;
      p.ai.cutTimer = 1.4;
    }
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
      // The aimed lead. `p.input` is the stick at the moment of release, so the pass is where you
      // pointed it — and the landing spot is remembered so the catch can be graded.
      const aim = new Vec3(p.input.moveX, 0, p.input.moveZ);
      const spot = passLanding(sim, p, target, aim.length() > 0.3 ? aim.normalize() : null);
      const to = new Vec3(spot.x, 0.9, spot.z);
      const dist = from.distanceTo(to);
      const dur = clamp(dist / ACTION.passSpeed, 0.14, 0.95);
      sim.ball.flight = {
        kind: 'pass',
        from,
        to,
        t: 0,
        dur,
        arc: 0.25,
        passer: p,
        target,
        checked: new Set(),
        // The receiver's position and heading AT RELEASE. Grading the catch against the receiver's
        // state when the ball arrives measures how they changed their mind mid-flight, not
        // whether the pass was led — so the frame of reference is frozen here.
        releasedAt: { x: target.pos.x, z: target.pos.z },
        releasedVel: { x: target.vel.x, z: target.vel.z },
      };
      sim.ball.releaseCooldown = { player: p, t: 0.25 };
      sim.events.emit('pass', { from: p, to: target, alley: false, lead: spot.pushed });
    }
    sim.ball.lastTeam = p.team;
    return true;
  }

/**
 * Grade a completed pass. A pass is a lead pass when the ball was genuinely thrown ahead of the
 * receiver into space rather than dumped at their feet, and nobody was standing in that space.
 * That is the payoff for aiming it: more style, and the receiver catches on the move, which is
 * the only way a pass beats a tight marker.
 */
export function gradePass(sim, flight, receiver) {
    if (!flight || flight.kind !== 'pass' || !flight.target || flight.target !== receiver) return null;
    // Measured against the receiver's state AT RELEASE, not at the catch: a ball that lands
    // beyond where they were going is a lead, whether or not they changed their mind in flight.
    const from = flight.releasedAt || { x: receiver.pos.x, z: receiver.pos.z };
    const vel = flight.releasedVel || { x: receiver.vel.x, z: receiver.vel.z };
    const speed = Math.hypot(vel.x, vel.z);
    // The receiver has to be RUNNING. A ball thrown ahead of someone standing still is just a
    // pass; a ball thrown ahead of a runner is a lead. Without this the grade fires on most passes
    // in the match, which turns the style meter into a metronome.
    if (speed < 2) return null;
    const vx = vel.x / speed;
    const vz = vel.z / speed;
    const dur = flight.dur || 0.3;
    const dx = flight.to.x - (from.x + vel.x * dur);
    const dz = flight.to.z - (from.z + vel.z * dur);
    const lead = dx * vx + dz * vz;
    if (lead < ACTION.leadPassMin) return null;
    // How clear the landing spot was at the moment it was aimed.
    let closest = Infinity;
    for (const o of sim.opponentsOf(receiver)) closest = Math.min(closest, o.pos.distanceToXZ(flight.to));
    if (closest < ACTION.leadPassOpen) return null;
    const big = receiver.pos.distanceToXZ(sim.goalPos(receiver.team)) < 12;
    sim.addStyle(
      flight.passer,
      big ? STYLE.leadPassBig : STYLE.leadPass,
      big ? 'LEAD PASS · ON THE MOVE' : 'LEAD PASS',
      { big, lead, open: closest }
    );
    const out = { lead, open: closest, big, from: flight.passer };
    sim.events.emit('leadpass', out);
    return out;
  }