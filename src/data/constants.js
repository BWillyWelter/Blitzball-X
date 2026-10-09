/**
 * FFX Blitzball Constants & Formulas
 */

export const FFX_CONSTANTS = {
  // Sphere Pool Dimensions (Meters from center origin)
  POOL: {
    RADIUS: 15.0,
    GOAL_POS_HOME: { x: 0, y: 0, z: -14.0 },
    GOAL_POS_AWAY: { x: 0, y: 0, z: 14.0 },
    GOAL_RADIUS: 2.5
  },

  // Encounter System
  ENCOUNTER: {
    TRIGGER_RADIUS: 3.5, // Distance in meters that triggers an encounter
    RNG_MIN: 0.5,        // FFX Stat Variance: min multiplier
    RNG_MAX: 1.5         // FFX Stat Variance: max multiplier
  },

  // Hydrodynamics & Decay
  WATER: {
    STAT_DECAY_PER_METER: 0.8, // PAS/SH lost per meter of water traveled
    SWIM_HP_COST_PER_SEC: 2.0  // HP drained while holding/swimming with the ball
  },

  // Base Stat Bounds
  STATS: {
    MIN: 1,
    MAX: 99
  }
};
