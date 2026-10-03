/**
 * BLITZBALL X — tuning constants.
 *
 * World units are metres. The match is played inside a sphere of water. Gameplay happens on a
 * horizontal "playing plane" through the sphere's centre (x/z), with height (y) used for
 * breaches (vertical bursts), lobs and shots. Team 0 attacks +x, team 1 attacks -x.
 */

export const ARENA = {
  // Scale-up: the pool was tuned too tight for 7-a-side — play collapsed into a scrum around the
  // ball. ~1.32x the arena (13 -> 17.2 field radius) with player speed up only ~9% stretches the
  // game back out: more time on the ball, real lanes to pass through, defence has to travel.
  sphereRadius: 31.6, // inner wall of the water sphere (visual + far ball bound)
  fieldRadius: 17.2, // playable circle for players
  ballRadius: 17.7, // ball reflects off the "current" here
  goalX: 15.3, // goal plane |x|
  goalY: 1.1, // goal centre height (body-centre height of a swimmer at rest)
  goalRadius: 1.7, // hoop radius
  postRadius: 0.16,
  playerMaxX: 14.9, // outfield swimmers cannot enter the goal
  keeperMinX: 12.4, // keeper box inner edge (|x| >= this)
  keeperMaxX: 14.6,
  keeperMaxZ: 2.4,
  creaseRadius: 5.4, // holographic crease arc radius around each goal
  centerCircle: 3.8,
  // The touchdown zone: THREE rings in a triangle at each goal plane. The top ring is worth 3,
  // the two low rings are worth 1 — so the high look pays double-double but the window is small.
  zone: {
    ringRadius: 0.95,
    topY: 2.85, // top ring centre height
    lowY: 0.35, // low rings centre height
    lowSpread: 1.35, // lateral (z) offset of the low rings
    // Index 0 = top (orange, 3 pts), 1 = blue low (1 pt), 2 = white low (1 pt).
    rings: [
      { pts: 3, css: '#ff8a3d', name: 'TOP RING' },
      { pts: 1, css: '#3bb3ff', name: 'BLUE RING' },
      { pts: 1, css: '#f5f0e6', name: 'WHITE RING' },
    ],
  },
  ceilingY: 5.2, // ball vertical bounds (clears the top ring)
  floorY: -2.1,
  playerMinY: -1.9, // how deep a free-swimming outfield player can dive before buoyancy floats them home
  playerMaxY: 3.1, // …and how high they can rise (breaches still launch further on their own arc)
  keeperMinY: -1.4,
  keeperMaxY: 3.1, // the keeper has to be able to climb to contest the top ring
};

export const RULES = {
  halfLength: 150, // game seconds per half
  halves: 2,
  mercyLead: 12,
  possessionClock: 24, // shoot within this many seconds of gaining possession (bigger field)
  keeperHold: 4, // keeper must release within this
  goalPoints: 1, // a low ring (blue / white)
  topRingPoints: 3, // the top ring of the triangle
  gbPoints: 4,
  gbSteal: 2,
  // Pre-match presentation: teams swim an intro lap in their half, the ref brings the captains
  // to centre, then the tip-off race decides first possession. The clock does not tick.
  warmupDuration: 7,
  tipoffHold: 1.2, // ref holds the ball at centre before the whistle
  tipoffRace: 3.0, // captains race for the dropped ball; fallback decides if it stalls
  gamebreakerMeterMax: 6800, // 7-a-side: 14 swimmers feed style, so the bar is bigger (~1 GB/team/match)
  onFireGoals: 2, // consecutive goals to catch fire
  flowCombo: 3, // style combo that triggers FLOW (Blue Lock hero window)
  flowDuration: 10, // seconds of FLOW once triggered
  rubberLead: 2.5, // lead (goals) at which anti-blowout assistance kicks in
  rubberPerGoal: 0.06, // per-goal multiplier step for the trailing team
  rubberCap: 1.25, // max trailing-team multiplier
  resetDuration: 1.7,
  goalDeadTime: 2.6,
  halftimeDuration: 3.2,
  overtimeFatigueAfter: 120, // OT seconds after which keepers tire (guarantees a golden goal)
  // Fouls. Underwater contact is legal only so far: a squared-up big hit above the severity
  // threshold is a whistle. The victim's crew keeps the ball (a free-swim), the offender eats a
  // card, and the second offence sends them to the bench for the rest of the match. Turns contact
  // from "hit harder and nothing happens" into a real risk/reward dial.
  // Impact tops out at 1.0 for a dead-on hit, so only the cleanest big hits reach the threshold,
  // and even those are only called some of the time. Hitting a swimmer who is already down is
  // always one. Tackles never foul — violence lives on the big-hit button.
  foulThreshold: 0.82,
  foulCallChance: 0.6, // chance a clean enough hit is actually whistled
  foulFreeSwim: true, // the fouled side keeps possession, placed at the spot
  cardThreshold: 2, // offences before a swimmer is sent off
  redMinSeverity: 1.15, // a genuinely ugly one is an instant red regardless of the count
  sentOffDuration: 9999, // a red card is permanent for the match
  // Substitutions: five in the water, four on the bench. Coaches get four changes, made at a
  // stoppage or queued for the next whistle. A forced replacement (red card) doesn't count.
  subsPerTeam: 4,
  // Taking the cage: the player may hand control to their own keeper from any outfield swimmer.
  // It costs the outfield swimmer (who goes back on AI) and the keeper is slower to turn, so it
  // is a read on the play rather than a free upgrade — but inside the box you own the shot.
  keeperSwitchCooldown: 0.8,
  subDuration: 1.2, // seconds the incoming swimmer waits at the touch wall
  subWindow: 2.6, // seconds the bench panel stays open at a stoppage
};

export const PHYS = {
  fixedDt: 1 / 60,
  gravityPlayer: -7.5, // buoyancy-damped
  gravityLoose: -0.9, // used by shot arcs (a shot drops as it runs out of steam)
  looseDrag: 1.35,
  ballFloat: 0.9, // a loose ball is buoyant and drifts back to the playing plane…
  ballBuoyancy: 3.4, // …so a dropped ball never settles on the pool floor out of reach
  wallRestitution: 0.72,
  currentStrength: 6, // pulls a ball that got behind the goal line back into play
  // Struck spin. A shot is hit with english and the ball bends across its flight line
  // (Magnus-style lateral acceleration per unit spin), so a curled finish can come round the
  // keeper's dive and a skied strike wobbles off line.
  ballCurve: 4.2,
  // The pool is never dead water: a slow gyre nudges anything drifting (mostly a loose ball),
  // so a dropped ball wanders instead of hanging exactly where it stopped.
  drift: 0.32, // ambient current acceleration on a drifting ball (m/s^2)
  driftRate: 1, // how fast the gyre pattern rotates through the bowl
};

export const MOVE = {
  accel: 17,
  decel: 8.5,
  maxSpeed: 5.9, // raised with the arena scale-up (was 5.4): travel without deadening the pace
  turboMult: 1.5,
  turboDrain: 30, // per second while turbo swimming
  turboRegen: 13,
  turboMin: 6,
  carrierMult: 0.96,
  keeperSpeed: 6.4, // keeper must still cover a scaled box
  keeperDiveSpeed: 7.9,
  // Committed keeper dive. Taking the cage is a real choice, and the only verb you get in it is
  // the dive: a fast lateral lunge inside the box that buys reach and save probability for a
  // moment. It costs body (stamina), has a cooldown, and a mistimed one leaves you out of the
  // play — so the skill is reading the shooter, not mashing it.
  keeperDiveWindow: 0.5, // seconds the dive stays live
  keeperDiveLateral: 15.5, // lateral lunge speed while diving (m/s)
  keeperDiveCooldown: 1.0,
  keeperDiveStamina: 5.5,
  keeperDiveCommit: 0.22, // how long the lunge actually accelerates before you recover
  breachVel: 5.6,
  breachCooldown: 0.45,
  swimVertical: 2.8, // free-swim rise/dive speed (m/s)
  verticalAccel: 10, // how fast vertical velocity chases the input
  verticalDrag: 6, // vertical velocity decay when the stick/buttons are centred
  verticalHome: 5, // buoyancy: rate a swimmer eases back to the playing plane
  fallenDuration: 1.15,
  stumbleDuration: 0.85,
  reelDuration: 0.55, // soft knockdown: staggered but back on their feet fast
  // Stamina. A separate meter from turbo: turbo is the burst button, stamina is the body.
  // Cruising is nearly free (the sport is meant to be played continuously), sprinting is what
  // costs, and committed contact costs more than everything. `end` scales all of it, so a
  // high-endurance player can grind a whole half and a sprinter needs rotating.
  staminaMax: 100,
  staminaSprintDrain: 2.4, // per second under turbo
  staminaSwimDrain: 0.25, // per second cruising — deliberately gentle
  staminaContactDrain: { tackle: 3.5, wash: 1.6, bigHit: 6.5, trick: 4.5, breach: 2.5, fall: 3 },
  staminaRegen: 4.2, // per second, scaled down by how hard you are swimming
  staminaRegenFloor: 0.35, // effort (0-1) at which regen stops entirely
  staminaGassedSpeed: 0.82, // max-speed multiplier at an empty tank (floored, never a statue)
  staminaGassedTurbo: 0.12, // turbo regen bleed while gassed
  moveTurboCost: 22, // turbo burned by a turbo signature move
  moveTurboRefund: 12, // turbo handed back when a move actually beats someone — the payoff
  moveCommitBase: 0.3, // baseline off-balance window after any signature move
  separation: 0.72,
  // Momentum. A swimmer is a body in water, not a cursor: the velocity vector swings toward the
  // stick at a capped angular rate (faster travel and heavier bodies turn more lazily) and a hard
  // carve scrubs speed. Straight-line pace is untouched — it is the late cut that now costs real
  // distance, so beating a defender is a change of direction you have to earn.
  turnRate: 6.6, // rad/s a swimmer can swing their heading (scaled by spd, mass, speed)
  turnBleed: 1.1, // speed scrubbed per radian of hard turn
  massBase: 0.88, // body mass from `pow`: heavier = lazier turn, slower acceleration
  massPerPow: 0.24,
};

export const ACTION = {
  shotMinSpeed: 13,
  shotMaxSpeed: 24,
  shotChargeTime: 0.75,
  perfectLo: 0.68,
  perfectHi: 0.86,
  goodLo: 0.45,
  goodHi: 0.97,
  shotMaxRange: 17, // scaled with the arena (was 14) — long shots open up
  passSpeed: 15,
  lobSpeed: 9.5,
  lobHeight: 1.75,
  tackleRange: 1.65,
  tackleCooldown: 0.8,
  tackleWhiffRecovery: 0.45,
  hitRange: 1.4,
  hitCooldown: 1.3,
  hitRecovery: 0.35,
  trickDuration: 0.45,
  trickCooldown: 0.5,
  washRange: 1.9,
  volleyRange: 9.5, // scaled with the arena (was 7.5)
  pickupRadius: 1.15,
  keeperPickupRadius: 1.6,
  keeperReach: 1.0,
  keeperDiveReach: 0.9, // extra save reach while a dive is live
  keeperDiveSave: 0.16, // extra save probability while a dive is live (and aimed the right way)
  keeperDiveWrongSide: 0.1, // penalty when the dive went the other way — overcommitting is punished
  // Aiming the pass. The stick no longer picks only WHO you pass to: at the moment of release it
  // biases WHERE the ball lands, so the lead is a decision. Holding the run pushes the ball in
  // front of the receiver (a lead pass, worth style, but a defender can read it); holding it
  // short drops it at their feet (safe, worth nothing).
  leadAimAhead: 2.6, // metres the aim can push the landing spot down the aimed line
  leadAimCheck: 1.5, // metres the aim can pull it back to a check pass
  // What counts as a lead pass when it is caught. Tight on purpose: the receiver must be running,
  // the ball must genuinely be in front of them, and nobody may be standing in that spot.
  leadPassMin: 0.85,
  leadPassOpen: 1.8,
  gbDriveSpeed: 9.5,
  gbDriveTime: 2.2,
  gbShotRange: 9, // scaled with the arena (was 7)
  gbSlowmo: 0.42,
  blockRadius: 0.75,
};

export const STYLE = {
  trick: 40,
  trickTurbo: 30,
  washed: 150,
  tackle: 105,
  hit: 80,
  block: 150,
  save: 45,
  saveBig: 110,
  saveDive: 160, // keeper dove into the shot and kept it out
  leadPass: 34,
  leadPassBig: 75,
  goal: 120,
  goalLong: 220,
  goalVolley: 260,
  goalPerfect: 50,
  assist: 60,
  dribble: 45, // beaten a slide tackle while carrying (glue-dribble duel reward)
  breachCatch: 20,
  lossOnTurnover: 60,
  curve: 70, // curled finish: a goal struck with real spin
  comboWindow: 2.2,
  comboStep: 0.25,
  comboMax: 2.5,
};

// Contact. The sim is arcade-first: contact has to read instantly and punish a bad commitment, so
// impacts carry an angle, an impulse, a hitstop and a recovery that the loser actually feels.
export const COMBAT = {
  hitstop: { tackle: 0.05, wash: 0.06, hit: 0.075, bigHit: 0.13 },
  // Angle of impact. 1.0 is a dead-on hit, a clipped shoulder is ~0.55, catching someone from
  // behind is the worst case at ~1.35 — so defenders learn to turn their back to the ball.
  impactFloor: 0.55,
  impactSpan: 0.45,
  // Impulse given to the victim, scaled by the hitter's power and the impact angle.
  pushFallen: 3.6,
  pushReel: 2.1,
  // Reeling: a soft knockdown that keeps a defender out of the play for a beat.
  reelBase: 0.5,
  reelPerImpact: 0.45,
  // Dive tackle. This is the "commit harder" dial: you launch yourself, and a whiff costs real time.
  diveSpeed: 4.8,
  diveCommit: 0.8,
  hitWhiff: 0.62,
  // Big contact drops the pool into slow motion for a beat so the player can see it land.
  slowmo: 0.3,
  slowmoScale: 0.35,
  slowmoImpact: 0.95,
  // Signature moves shove a defender aside rather than felling them.
  brushRange: 1.5,
  brushSpeed: 2.2,
  // Real contact: a body behind the blow is what puts a swimmer on the floor. A standing swing
  // still connects but staggers; it is the hit taken at pace that flattens. Momentum scales the
  // severity between `hitMomentumLo` (standing) and `hitMomentumHi` (charging in).
  hitMomentumLo: 0.7,
  hitMomentumHi: 1.2,
  hitMomentumRef: 9, // closing speed (m/s) that reaches full momentum
  hitFallenSeverity: 0.95, // severity at which contact knocks down instead of staggering
  // The wow dial: beating a man with your signature move drops the pool into a beat of slow-mo.
  wowSlowmo: 0.2,
  wowSlowmoScale: 0.55,
};

export const DIFFICULTY = {
  rookie: {
    label: 'ROOKIE',
    aiReaction: 0.7,
    tackleRate: 0.55,
    hitRate: 0.4,
    shotAccuracy: 0.8,
    keeperSkill: 0.8,
    aiTurbo: 0.5,
    aiGbRate: 0.6,
    pressCushion: 1.2,
    zoneBias: 0.65,
    userBonus: 1.15,
  },
  pro: {
    label: 'PRO',
    aiReaction: 1.0,
    tackleRate: 0.95,
    hitRate: 0.8,
    shotAccuracy: 1.0,
    keeperSkill: 1.0,
    aiTurbo: 0.85,
    aiGbRate: 0.9,
    pressCushion: 0.9,
    zoneBias: 0.32,
    userBonus: 1.0,
  },
  legend: {
    label: 'LEGEND',
    aiReaction: 1.3,
    tackleRate: 1.3,
    hitRate: 1.1,
    shotAccuracy: 1.15,
    keeperSkill: 1.15,
    aiTurbo: 1.0,
    aiGbRate: 1.15,
    pressCushion: 0.72,
    zoneBias: 0.12,
    userBonus: 0.9,
  },
};

export const ROLES = { GK: 'KEEPER', FD: 'FIELDER', SH: 'SHOOTER' };

/** Starter shape: 1 keeper + 4 fielders + 2 shooters (the captains) = 7 in the water. */
export const STARTER_SHAPE = { GK: 1, FD: 4, SH: 2 };
