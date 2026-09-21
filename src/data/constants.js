/**
 * BLITZBALL X — tuning constants.
 *
 * World units are metres. The match is played inside a sphere of water. Gameplay happens on a
 * horizontal "playing plane" through the sphere's centre (x/z), with height (y) used for
 * breaches (vertical bursts), lobs and shots. Team 0 attacks +x, team 1 attacks -x.
 */

export const ARENA = {
  sphereRadius: 24, // inner wall of the water sphere (visual + far ball bound)
  fieldRadius: 13, // playable circle for players
  ballRadius: 13.4, // ball reflects off the "current" here
  goalX: 11.6, // goal plane |x|
  goalY: 1.1, // goal centre height (body-centre height of a swimmer at rest)
  goalRadius: 1.7, // hoop radius
  postRadius: 0.16,
  playerMaxX: 11.3, // outfield swimmers cannot enter the goal
  keeperMinX: 9.4, // keeper box inner edge (|x| >= this)
  keeperMaxX: 11.1,
  keeperMaxZ: 1.9,
  creaseRadius: 4.2, // holographic crease arc radius around each goal
  centerCircle: 3.0,
  ceilingY: 3.4, // ball vertical bounds
  floorY: -1.7,
  playerMinY: 0,
  keeperMinY: -1.1,
  keeperMaxY: 1.7,
};

export const RULES = {
  halfLength: 150, // game seconds per half
  halves: 2,
  mercyLead: 8,
  possessionClock: 20, // shoot within this many seconds of gaining possession
  keeperHold: 4, // keeper must release within this
  goalPoints: 1,
  gbPoints: 2,
  gbSteal: 1,
  gamebreakerMeterMax: 4500, // ~1 GB per team per match (was 3000 ≈ 1.8, spammy)
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
};

export const PHYS = {
  fixedDt: 1 / 60,
  gravityPlayer: -7.5, // buoyancy-damped
  gravityLoose: -0.9, // loose ball sinks slowly
  looseDrag: 1.35,
  wallRestitution: 0.72,
  currentStrength: 6, // pulls a ball that got behind the goal line back into play
};

export const MOVE = {
  accel: 17,
  decel: 8.5,
  maxSpeed: 5.4,
  turboMult: 1.45,
  turboDrain: 30, // per second while turbo swimming
  turboRegen: 13,
  turboMin: 6,
  carrierMult: 0.95,
  keeperSpeed: 6.0,
  keeperDiveSpeed: 7.5,
  breachVel: 5.6,
  breachCooldown: 0.45,
  fallenDuration: 1.15,
  stumbleDuration: 0.85,
  separation: 0.72,
};

export const ACTION = {
  shotMinSpeed: 13,
  shotMaxSpeed: 24,
  shotChargeTime: 0.75,
  perfectLo: 0.68,
  perfectHi: 0.86,
  goodLo: 0.45,
  goodHi: 0.97,
  shotMaxRange: 14,
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
  volleyRange: 7.5,
  pickupRadius: 1.15,
  keeperPickupRadius: 1.6,
  keeperReach: 1.0,
  gbDriveSpeed: 9.5,
  gbDriveTime: 2.2,
  gbShotRange: 7,
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
  goal: 120,
  goalLong: 220,
  goalVolley: 260,
  goalPerfect: 50,
  assist: 60,
  dribble: 45, // beaten a slide tackle while carrying (glue-dribble duel reward)
  breachCatch: 20,
  lossOnTurnover: 60,
  comboWindow: 2.2,
  comboStep: 0.25,
  comboMax: 2.5,
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
    userBonus: 0.9,
  },
};

export const ROLES = { FW: 'Striker', MF: 'Midfield', DF: 'Defender', GK: 'Keeper' };
