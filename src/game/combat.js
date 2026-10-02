import { Vec3, clamp } from '../core/vec3.js';
import { ACTION, MOVE, STYLE, COMBAT } from '../data/constants.js';
import { MOVES, moveFor, movePower, isEvading } from './moves.js';

/**
 * Signature moves, dive tackles, big hits, knockdowns and breaches.
 *
 * Every function takes the sim as its first argument and mutates it exactly as the original class
 * methods did; MatchSim keeps thin delegating methods so call sites, tests and the AI are untouched.
 * This module has no DOM/three.js dependency.
 *
 * Contact model (arcade-first, commitment is punished):
 *  - every impact carries an ANGLE (a clipped shoulder hurts less than a square hit), an IMPULSE
 *    scaled by the hitter's power, and a HITSTOP that freezes the pool for a beat;
 *  - soft contact staggers into a new `reel` state, hard contact into `fallen`;
 *  - diving for a tackle and swinging a big hit both leave you off balance if they miss.
 */

// The move library lives in ./moves.js. Re-exported under the old name so match.js and the
// animation bench keep working against the same table.
export { MOVES, moveFor, movePower, isEvading } from './moves.js';
export const TRICKS = MOVES;

// ---------------------------------------------------------------------------
// Impact helpers
// ---------------------------------------------------------------------------

/**
 * How squarely a blow lands. 1.0 dead-on, ~0.55 clipped off the shoulder, ~1.35 in the back — so
 * turning your back to the ball is the worst thing you can do in a contact sport.
 */
function impactOf(attacker, from, to) {
  const d = sim_fwd(attacker).dot(Vec3.dirXZ(from, to));
  return COMBAT.impactFloor + COMBAT.impactSpan * clamp(d, -1, 1);
}

function sim_fwd(p) {
  return new Vec3(Math.sin(p.facing), 0, Math.cos(p.facing));
}

/** Freeze the whole sim for `seconds` of real time. Longest request wins. */
function hitstop(sim, seconds) {
  sim.freeze = Math.max(sim.freeze || 0, seconds);
}

/**
 * Stamina bill for a committed action. Contact is what drains a swimmer fastest: a dive tackle is
 * a full-body commitment, a big hit costs more than everything else, and taking a fall hurts too.
 * `end` softens every one of them.
 */
export function spendStamina(p, kind) {
  const cost = (MOVE.staminaContactDrain[kind] || 0) * (1.3 - (p.data.end / 99) * 0.6);
  p.stamina = Math.max(0, p.stamina - cost);
  p.gassed = p.stamina <= 1;
}

/** Big contact: drop the pool into slow motion so the player sees the hit land. */
function impactSlowmo(sim, impact) {
  if (impact < COMBAT.slowmoImpact) return;
  sim.slowmo = Math.max(sim.slowmo || 0, COMBAT.slowmo);
  sim.timeScale = COMBAT.slowmoScale;
}

// ---------------------------------------------------------------------------
// Signature moves
// ---------------------------------------------------------------------------

/**
 * Play this swimmer's signature move. `dir` is the stick direction at the moment of the input, so
 * the move is aimed, not auto-targeted.
 */
export function tryTrick(sim, p, dir, turbo) {
  const def = moveFor(p);
  const useTurbo = !!(turbo && p.turbo > 15);
  spendStamina(p, 'trick');
  const power = movePower(def, p);
  const d = (dir || sim.forwardOf(p)).clone();
  p.trick = { def, dir: d, turbo: useTurbo, washed: new Set(), power };
  if (useTurbo) p.turbo = Math.max(0, p.turbo - MOVE.moveTurboCost);
  p.cd.trick = ACTION.trickCooldown + def.dur;
  p.facing = Math.atan2(d.x, d.z);
  // `armor` runs until the move ends (or the swimmer leaves the playing plane, see isEvading).
  p.moveArmor = def.kind === 'armor' || def.kind === 'vault' ? def.dur : 0;
  sim.setState(p, 'trick', def.dur);
  sim.stats.tricks++;
  sim.events.emit('trick', { player: p, name: def.name, move: def, turbo: useTurbo, power });
  applyMoveEffect(sim, p, def, d, power);
  sim.addStyle(p, STYLE.trick + (useTurbo ? STYLE.trickTurbo : 0), def.name);
  return true;
}

/** Each `kind` does something genuinely different to the defender it is used on. */
function applyMoveEffect(sim, p, def, d, power) {
  switch (def.kind) {
    case 'wash':
      // Only beats a defender who is looking at you — that is the trade: you stand up and spin.
      coneWash(sim, p, def, d, power, { needsFacing: true, state: 'reel', falloff: true });
      break;
    case 'feint':
      // Punishes the defender who already committed to the challenge.
      coneWash(sim, p, def, d, power, { needsClosing: true, state: 'reel' });
      break;
    case 'surge':
      // Heavy frontal slam: anyone in the arc goes down.
      coneWash(sim, p, def, d, power, { state: 'fallen', wide: true });
      break;
    case 'armor':
      brushAside(sim, p, d, power * COMBAT.brushSpeed);
      break;
    case 'spear':
      spearContest(sim, p, def, d, power);
      break;
    case 'cut':
      // No damage: an instant lateral release that kills the challenge and opens the lane.
      brushAside(sim, p, d, power * COMBAT.brushSpeed * 0.6);
      p.vel.x += sideX(d) * 3.2 * power;
      p.vel.z += sideZ(d) * 3.2 * power;
      break;
    case 'vault':
    case 'low':
    case 'climb':
    case 'dash':
    default:
      // Motion-only moves: the travel and the height are the whole mechanic (see movement.js).
      break;
  }
}

function sideX(d) {
  return -d.z;
}
function sideZ(d) {
  return d.x;
}

/**
 * Defenders inside a forward cone. `needsFacing` only catches swimmers staring at you,
 * `needsClosing` only catches swimmers who have already committed to a challenge.
 */
function coneWash(sim, p, def, d, power, opts = {}) {
  const range = (def.range ?? 1.8) * (0.82 + power * 0.28);
  const cone = (def.cone ?? 1.1) * (opts.wide ? 1.15 : 1);
  const minDot = Math.cos(cone);
  for (const q of sim.opponentsOf(p)) {
    if (q.isKeeper || q.state === 'fallen' || q.airborne) continue;
    if (p.trick.washed.has(q.id)) continue;
    const dist = q.pos.distanceToXZ(p.pos);
    if (dist > range) continue;
    if (d.dot(Vec3.dirXZ(p.pos, q.pos)) < minDot) continue;
    const toMe = Vec3.dirXZ(q.pos, p.pos);
    const facingMe = sim.forwardOf(q).dot(toMe) > 0.2;
    const closing = q.state === 'tackle' || q.state === 'hit';
    if (opts.needsFacing && !facingMe) continue;
    if (opts.needsClosing && !closing && dist > 1.0) continue;

    const impact = impactOf(p, p.pos, q.pos) * (opts.falloff ? clamp(1.25 - dist / range, 0.55, 1) : 1);
    // Handles decide whether a move actually connects; the defender's tackling skill resists it.
    let prob = 0.34 + power * 0.3 + (opts.wide ? 0.12 : 0) - (q.data.tkl / 99) * 0.22;
    if (!facingMe) prob *= 0.7;
    if (sim.isUser(p)) prob *= sim.difficulty.userBonus;
    prob = clamp(prob, 0.08, 0.92);
    if (!sim.rng.chance(prob)) continue;

    p.trick.washed.add(q.id);
    knockDown(sim, q, p, 'washed', opts.state || 'reel', impact);
    p.stats.washed++;
    sim.addStyle(p, STYLE.washed, 'WASHED!', { big: true });
    sim.events.emit('washed', { player: p, victim: q, name: def.name, impact });
  }
}

/** Shove a defender out of the lane without felling them — roll, cut and vault all use this. */
function brushAside(sim, p, d, push) {
  for (const q of sim.opponentsOf(p)) {
    if (q.isKeeper || q.state === 'fallen') continue;
    const dist = q.pos.distanceToXZ(p.pos);
    if (dist > COMBAT.brushRange) continue;
    if (d.dot(Vec3.dirXZ(p.pos, q.pos)) < 0.1) continue;
    const away = Vec3.dirXZ(p.pos, q.pos);
    q.vel.x += away.x * push;
    q.vel.z += away.z * push;
    q.stun = Math.max(q.stun, 0.18);
    break;
  }
}

/** Straight power contest. Win and you keep your momentum; lose and the move costs you. */
function spearContest(sim, p, def, d, power) {
  let target = null;
  let bd = Infinity;
  for (const q of sim.opponentsOf(p)) {
    if (q.isKeeper || q.state === 'fallen') continue;
    const dist = q.pos.distanceToXZ(p.pos);
    if (dist > (def.range ?? 1.7) + power) continue;
    if (d.dot(Vec3.dirXZ(p.pos, q.pos)) < Math.cos(def.cone ?? 0.9)) continue;
    if (dist < bd) {
      bd = dist;
      target = q;
    }
  }
  if (!target) return;
  const edge = (p.data.pow - target.data.pow) / 99;
  let prob = clamp(0.5 + edge * 0.9 + (target.state === 'tackle' ? 0.18 : 0), 0.08, 0.92);
  if (sim.isUser(p)) prob *= sim.difficulty.userBonus;
  if (sim.rng.chance(prob)) {
    const impact = impactOf(p, p.pos, target.pos) * (0.9 + power * 0.25);
    knockDown(sim, target, p, 'spear', 'reel', impact);
    p.vel.x += d.x * 2.4 * power;
    p.vel.z += d.z * 2.4 * power;
    p.stats.washed++;
    sim.addStyle(p, STYLE.washed, 'PIERCED!', { big: true });
    sim.events.emit('washed', { player: p, victim: target, name: def.name, impact });
  } else {
    // Bounced off a stronger defender: you are the one off balance.
    p.stun = Math.max(p.stun, 0.3);
    p.vel.x -= d.x * 1.6;
    p.vel.z -= d.z * 1.6;
    sim.events.emit('spearfail', { player: p, victim: target });
  }
}

/** End of a signature move — and the bill for committing to it. */
export function finishTrick(sim, p) {
  const tr = p.trick;
  p.trick = null;
  p.moveArmor = 0;
  if (tr) {
    const power = tr.power ?? 1;
    // Every move leaves you recovering; the big commitments (dash, surge, spear) hurt the most.
    p.stun = Math.max(p.stun, (tr.def.commit ?? MOVE.moveCommitBase) * (1.2 - power * 0.3) * (tr.turbo ? 1.1 : 1));
    if (tr.def.kind === 'surge') {
      // WAVE CREST ends facing backwards: you have to turn around before you are a player again.
      p.facing += Math.PI;
    }
  }
  sim.setState(p, 'swim');
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export function tryTackle(sim, p) {
  const carrier = sim.ball.holder;
  p.cd.tackle = ACTION.tackleCooldown;
  spendStamina(p, 'tackle');
  sim.setState(p, 'tackle', 0.4);
  // Dive: real forward commitment, not a nudge.
  const f = sim.forwardOf(p);
  p.vel.x += f.x * COMBAT.diveSpeed;
  p.vel.z += f.z * COMBAT.diveSpeed;
  p.tackleDir = { x: f.x, z: f.z };
  sim.events.emit('tackleattempt', { player: p });
  if (!carrier || carrier.team === p.team) {
    p.ai.diving = 0.3;
    return false;
  }
  if (carrier.isKeeper) return false;
  const d = p.pos.distanceToXZ(carrier.pos);
  if (d > ACTION.tackleRange) return false;
  if (carrier.airborne || (carrier.state === 'shoot' && carrier.shot && carrier.shot.released)) return false;
  // A live Gamebreaker drive is untackleable — the payoff moment shouldn't end in a fumble.
  if (carrier === sim.gbPlayer && sim.gbDriveShield) return false;
  // A swimmer rolling, vaulting or sliding under the challenge simply isn't there any more.
  if (isEvading(carrier)) return false;
  const facing = f.dot(Vec3.dirXZ(p.pos, carrier.pos)) > 0.1;
  if (!facing) return false;
  let prob = 0.22 + ((p.data.tkl - carrier.data.hnd) / 99) * 0.35;
  // Glue dribbling means the ball is shielded at the carrier's feet — tackles are the whole
  // contest now, so the base window is friendlier (FIFA/Rematch-style poke-and-slide).
  prob *= 1.25;
  // FLOW carriers can't be poked — beat them with position, not buttons.
  if (sim.flow[carrier.team]) return false;
  if (carrier.state === 'trick') prob *= 0.6; // mid-move you're committed too
  if (carrier.state === 'idle' && carrier.stateTime > 1.0) prob += 0.14;
  if (carrier.state === 'pass' || carrier.state === 'shoot') prob += 0.12;
  if (!sim.isUser(p)) prob *= sim.difficulty.tackleRate * 1.5;
  else prob *= 1.15 * sim.difficulty.userBonus;
  if (sim.momentum[carrier.team] >= sim.rules.onFireGoals) prob *= 0.8;
  prob *= sim.rubber[p.team];
  prob *= sim.defenseMods(p.team).tackle || 1;
  prob = clamp(prob, 0.05, 0.78);
  if (sim.rng.chance(prob)) {
    const impact = impactOf(p, p.pos, carrier.pos);
    carrier.stats.to++;
    p.stats.tkl++;
    sim.stats.tackles++;
    sim.loseStyle(carrier.team, STYLE.lossOnTurnover);
    carrier.trick = null;
    carrier.shot = null;
    carrier.moveArmor = 0;
    // Rattled: the carrier reels away from the contact instead of just losing the ball.
    knockDown(sim, carrier, p, 'tackle', 'reel', impact * 0.8);
    sim.giveBall(p);
    sim.setState(p, 'catch', 0.14);
    sim.addStyle(p, STYLE.tackle, 'PICKED', { big: true });
    hitstop(sim, COMBAT.hitstop.tackle);
    sim.events.emit('tackle', { player: p, victim: carrier, impact });
    return true;
  }
  // Missed: you are on the ground and out of the play. That is the cost of diving.
  p.stun = COMBAT.diveCommit;
  p.ai.diving = 0.4;
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
  spendStamina(p, 'bigHit');
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
    // A committed roll / vault / slide goes straight through a big hit too.
    if (isEvading(q)) continue;
    const d = q.pos.distanceToXZ(p.pos);
    if (d < ACTION.hitRange && f.dot(Vec3.dirXZ(p.pos, q.pos)) > 0 && d < bd) {
      bd = d;
      best = q;
    }
  }
  if (!best) {
    p.stun = COMBAT.hitWhiff;
    return false;
  }
  const impact = impactOf(p, p.pos, best.pos);
  let prob = 0.45 + ((p.data.pow - best.data.pow) / 99) * 0.5;
  if (best.state === 'trick') prob -= 0.15;
  if (best.state === 'shoot' || best.state === 'pass') prob += 0.15;
  if (!sim.isUser(p)) prob *= sim.difficulty.hitRate * 1.25;
  prob *= sim.rubber[p.team];
  prob = clamp(prob, 0.15, 0.9);
  if (sim.rng.chance(prob)) {
    const hadBall = sim.ball.holder === best;
    const severity = impact;
    // Swiping someone who is already staggering (reel / stumble / stunned) is the one thing that is
    // always a foul. `fallen` players are out of the play entirely and can't be targeted at all,
    // so the rule reads on the ones who are going down but not yet out.
    const wasDown = best.state === 'reel' || best.state === 'stumble' || best.stun > 0;
    knockDown(sim, best, p, 'hit', 'fallen', severity);
    p.stats.hits++;
    sim.stats.hits++;
    // Discipline: a squared-up big hit over the line is a whistle, not just a knockdown. Judged
    // AFTER the hit lands so the contact still reads, then the ball is handed back by the rules.
    if (sim.callFoul(p, best, severity, 'bigHit', wasDown)) return true;
    if (hadBall) {
      // ball pops loose
      best.stats.to++;
      sim.loseStyle(best.team, STYLE.lossOnTurnover);
      const dir = Vec3.dirXZ(p.pos, best.pos);
      sim.releaseLoose(best, new Vec3(dir.x * 4 + (sim.rng.next() - 0.5) * 2, 2.2, dir.z * 4 + (sim.rng.next() - 0.5) * 2));
    }
    sim.addStyle(p, STYLE.hit, 'BIG HIT', { big: true });
    hitstop(sim, severity >= 1.1 ? COMBAT.hitstop.bigHit : COMBAT.hitstop.hit);
    impactSlowmo(sim, severity);
    sim.events.emit('bighit', { player: p, victim: best, hadBall, impact: severity });
    // Match story: keep the hardest connect of the match, whatever the whistle made of it. A foul
    // is still a highlight — arguably more of one.
    if (sim.biggestHit !== undefined && (!sim.biggestHit || severity > sim.biggestHit.severity)) {
      sim.biggestHit = {
        severity,
        t: sim.time,
        team: p.team,
        hitterId: p.id,
        hitter: p.data.nick,
        victimId: best.id,
        victim: best.data.nick,
        hadBall,
        fouled: wasDown || severity >= 0.88,
      };
    }
    return true;
  }
  // Bounced off: you swung and missed, and you're standing there.
  p.stun = COMBAT.hitWhiff;
  return false;
}

/**
 * Put a swimmer on the floor. `impact` (0.5 clipped … 1.35 from behind) scales the impulse, the
 * time they are out and the hitstop, so the same button produces a shove or a knockdown.
 */
export function knockDown(sim, victim, by, reason, state = 'fallen', impact = 1) {
  victim.shot = null;
  victim.trick = null;
  spendStamina(victim, 'fall');
  victim.airborne = false;
  victim.moveArmor = 0;
  const hard = state === 'fallen';
  const base = hard ? MOVE.fallenDuration : MOVE.reelDuration;
  const dur = base * (0.75 + 0.45 * clamp(impact, 0.5, 1.35));
  sim.setState(victim, hard ? 'fallen' : 'reel', dur);
  const dir = Vec3.dirXZ(by.pos, victim.pos);
  victim.knockDir.copy(dir);
  const push = (hard ? COMBAT.pushFallen : COMBAT.pushReel) * (0.7 + (by.data?.pow ?? 60) / 140) * impact;
  victim.vel.set(dir.x * push, 0, dir.z * push);
  victim.stun = Math.max(victim.stun, dur * 0.6);
  // Where the two bodies met — the renderer puts the impact FX here rather than on the victim.
  const contact = {
    x: (by.pos.x + victim.pos.x) / 2,
    y: 0.9,
    z: (by.pos.z + victim.pos.z) / 2,
  };
  sim.events.emit('knockdown', { victim, by, reason, state, impact, contact });
  if (reason === 'tackle') hitstop(sim, COMBAT.hitstop.tackle);
  else if (reason === 'washed') hitstop(sim, COMBAT.hitstop.wash);
  return dur;
}

export function tryBreach(sim, p) {
  p.cd.breach = MOVE.breachCooldown;
  spendStamina(p, 'breach');
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
