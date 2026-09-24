import { Vec3, clamp } from '../core/vec3.js';
import { ACTION, MOVE, STYLE } from '../data/constants.js';

/**
 * Tricks, tackles, big hits, knockdowns and breaches, extracted from MatchSim.
 *
 * Every function takes the sim as its first argument and mutates it exactly as the
 * original class methods did; MatchSim keeps thin delegating methods so call sites,
 * tests and the AI are untouched. This module has no DOM/three.js dependency.
 */

export const TRICKS = [
  { id: 0, name: 'SPIN', dur: 0.42, dist: 1.6, washRange: 1.5, turbo: false },
  { id: 1, name: 'BARREL ROLL', dur: 0.48, dist: 2.0, washRange: 1.7, turbo: false },
  { id: 2, name: 'DOLPHIN KICK', dur: 0.5, dist: 2.4, washRange: 1.6, turbo: true, vertical: true },
  { id: 3, name: 'CORKSCREW', dur: 0.55, dist: 2.6, washRange: 1.9, turbo: true },
  { id: 4, name: 'BACK-FLIP FEINT', dur: 0.46, dist: 1.4, washRange: 2.0, turbo: false },
  { id: 5, name: 'JET STREAM', dur: 0.6, dist: 3.2, washRange: 2.1, turbo: true },
];

export function tryTrick(sim, p, dir, turbo) {
    const useTurbo = turbo && p.turbo > 15;
    const pool = TRICKS.filter((t) => !!t.turbo === !!useTurbo);
    // Avoid repeating the same trick.
    let def = sim.rng.pick(pool);
    if (pool.length > 1 && def.id === p.lastTrickId) def = pool[(pool.indexOf(def) + 1) % pool.length];
    p.lastTrickId = def.id;
    const d = dir || sim.forwardOf(p);
    p.trick = { def, dir: d, turbo: useTurbo, washed: new Set() };
    if (useTurbo) p.turbo = Math.max(0, p.turbo - 18);
    p.cd.trick = ACTION.trickCooldown + def.dur;
    p.facing = Math.atan2(d.x, d.z);
    sim.setState(p, 'trick', def.dur);
    sim.stats.tricks++;
    sim.events.emit('trick', { player: p, name: def.name, turbo: useTurbo });
    // Wash check: defenders in range that are facing us get spun / knocked off.
    for (const q of sim.opponentsOf(p)) {
      if (q.isKeeper || q.state === 'fallen') continue;
      const dist = q.pos.distanceToXZ(p.pos);
      if (dist > def.washRange) continue;
      const toMe = Vec3.dirXZ(q.pos, p.pos);
      const facingMe = sim.forwardOf(q).dot(toMe) > 0.2;
      const closing = q.state === 'tackle' || q.state === 'swim';
      let prob = 0.12 + ((p.data.hnd - q.data.tkl) / 99) * 0.35 + (useTurbo ? 0.18 : 0) + (q.state === 'tackle' ? 0.35 : 0);
      if (!facingMe) prob *= 0.5;
      if (!closing) prob *= 0.7;
      if (sim.isUser(p)) prob *= sim.difficulty.userBonus;
      prob = clamp(prob, 0.03, 0.75);
      if (sim.rng.chance(prob)) {
        p.trick.washed.add(q.id);
        sim.knockDown(q, p, 'washed', q.state === 'tackle' ? 'fallen' : 'stumble');
        p.stats.washed++;
        sim.addStyle(p, STYLE.washed, 'WASHED!', { big: true });
        sim.events.emit('washed', { player: p, victim: q, name: def.name });
      }
    }
    sim.addStyle(p, STYLE.trick + (useTurbo ? STYLE.trickTurbo : 0), def.name);
    return true;
  }

export function finishTrick(sim, p) {
    p.trick = null;
    sim.setState(p, 'swim');
  }

export function tryTackle(sim, p) {
    const carrier = sim.ball.holder;
    p.cd.tackle = ACTION.tackleCooldown;
    sim.setState(p, 'tackle', 0.4);
    // lunge forward
    const f = sim.forwardOf(p);
    p.vel.x += f.x * 3.2;
    p.vel.z += f.z * 3.2;
    sim.events.emit('tackleattempt', { player: p });
    if (!carrier || carrier.team === p.team) {
      p.ai.diving = 0.3;
      return false;
    }
    if (carrier.isKeeper) return false;
    const d = p.pos.distanceToXZ(carrier.pos);
    if (d > ACTION.tackleRange) return false;
    if (carrier.airborne || carrier.state === 'shoot' && carrier.shot && carrier.shot.released) return false;
    // A live Gamebreaker drive is untackleable — the payoff moment shouldn't end in a fumble.
    if (carrier === sim.gbPlayer && sim.gbDriveShield) return false;
    const facing = f.dot(Vec3.dirXZ(p.pos, carrier.pos)) > 0.1;
    if (!facing) return false;
    let prob = 0.22 + ((p.data.tkl - carrier.data.hnd) / 99) * 0.35;
    // Glue dribbling means the ball is shielded at the carrier's feet — tackles are the whole
    // contest now, so the base window is friendlier (FIFA/Rematch-style poke-and-slide).
    prob *= 1.25;
    // FLOW carriers can't be poked — beat them with position, not buttons.
    if (sim.flow[carrier.team]) return false;
    if (carrier.state === 'trick') prob *= carrier.trick && carrier.trick.turbo ? 0.3 : 0.55;
    if (carrier.state === 'idle' && carrier.stateTime > 1.0) prob += 0.14;
    if (carrier.state === 'pass' || carrier.state === 'shoot') prob += 0.12;
    if (!sim.isUser(p)) prob *= sim.difficulty.tackleRate * 1.5;
    else prob *= 1.15 * sim.difficulty.userBonus;
    if (sim.momentum[carrier.team] >= sim.rules.onFireGoals) prob *= 0.8;
    prob *= sim.rubber[p.team];
    prob *= sim.defenseMods(p.team).tackle || 1;
    prob = clamp(prob, 0.05, 0.78);
    if (sim.rng.chance(prob)) {
      carrier.stats.to++;
      p.stats.tkl++;
      sim.stats.tackles++;
      sim.loseStyle(carrier.team, STYLE.lossOnTurnover);
      carrier.trick = null;
      carrier.shot = null;
      sim.setState(carrier, 'stumble', MOVE.stumbleDuration * 0.7);
      sim.giveBall(p);
      sim.setState(p, 'catch', 0.14);
      sim.addStyle(p, STYLE.tackle, 'PICKED', { big: true });
      sim.events.emit('tackle', { player: p, victim: carrier });
      return true;
    }
    p.stun = ACTION.tackleWhiffRecovery;
    // Beaten by the dribbler: style reward for carrying past pressure (Blue Lock flair).
    // dribbleTouch both throttles and scales this — one award per sustained carry.
    if (carrier.dribbleTouch >= 1.0) {
      carrier.dribbleTouch = 0;
      sim.addStyle(carrier, STYLE.dribble, 'DRIBBLE', {});
      sim.events.emit('dribble', { player: carrier, beaten: p });
    }
    return false;
  }

export function tryHit(sim, p) {
    p.cd.hit = ACTION.hitCooldown;
    sim.setState(p, 'hit', 0.42);
    const f = sim.forwardOf(p);
    p.vel.x += f.x * 2.6;
    p.vel.z += f.z * 2.6;
    sim.events.emit('hitattempt', { player: p });
    let best = null;
    let bd = Infinity;
    for (const q of sim.opponentsOf(p)) {
      if (q.isKeeper || q.state === 'fallen' || q.airborne) continue;
      // Shrug off big hits while the Gamebreaker drive is live.
      if (q === sim.gbPlayer && sim.gbDriveShield) continue;
      const d = q.pos.distanceToXZ(p.pos);
      if (d < ACTION.hitRange && f.dot(Vec3.dirXZ(p.pos, q.pos)) > 0 && d < bd) {
        bd = d;
        best = q;
      }
    }
    if (!best) {
      p.stun = ACTION.hitRecovery;
      return false;
    }
    let prob = 0.45 + ((p.data.pow - best.data.pow) / 99) * 0.5;
    if (best.state === 'trick') prob -= 0.15;
    if (best.state === 'shoot' || best.state === 'pass') prob += 0.15;
    if (!sim.isUser(p)) prob *= sim.difficulty.hitRate * 1.25;
    prob *= sim.rubber[p.team];
    prob = clamp(prob, 0.15, 0.9);
    if (sim.rng.chance(prob)) {
      const hadBall = sim.ball.holder === best;
      sim.knockDown(best, p, 'hit', 'fallen');
      p.stats.hits++;
      sim.stats.hits++;
      if (hadBall) {
        // ball pops loose
        best.stats.to++;
        sim.loseStyle(best.team, STYLE.lossOnTurnover);
        const dir = Vec3.dirXZ(p.pos, best.pos);
        sim.releaseLoose(best, new Vec3(dir.x * 4 + (sim.rng.next() - 0.5) * 2, 2.2, dir.z * 4 + (sim.rng.next() - 0.5) * 2));
      }
      sim.addStyle(p, STYLE.hit, 'BIG HIT', { big: true });
      sim.events.emit('bighit', { player: p, victim: best, hadBall });
      return true;
    }
    // bounced off
    p.stun = ACTION.hitRecovery;
    return false;
  }

export function knockDown(sim, victim, by, reason, state = 'fallen') {
    victim.shot = null;
    victim.trick = null;
    victim.airborne = false;
    sim.setState(victim, state, state === 'fallen' ? MOVE.fallenDuration : MOVE.stumbleDuration);
    const dir = Vec3.dirXZ(by.pos, victim.pos);
    victim.knockDir.copy(dir);
    victim.vel.set(dir.x * (state === 'fallen' ? 3.5 : 1.5), 0, dir.z * (state === 'fallen' ? 3.5 : 1.5));
    sim.events.emit('knockdown', { victim, by, reason, state });
  }

export function tryBreach(sim, p) {
    p.cd.breach = MOVE.breachCooldown;
    p.airborne = true;
    p.vy = MOVE.breachVel * (0.9 + (p.data.spd / 99) * 0.25);
    sim.setState(p, 'breach', 0);
    sim.events.emit('breach', { player: p });
    // Block check on shots in flight
    const f = sim.ball.flight;
    if (f && (f.kind === 'shot' || f.kind === 'lob') && f.shooter && f.shooter.team !== p.team) {
      p.ai.blockingFlight = f;
    }
    return true;
  }
