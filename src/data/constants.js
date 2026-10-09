/**
 * Global Constants & Tuning Parameters for Blitzball-X
 */

export const GAME_CONSTANTS = {
  FPS: 60,
  TICK_RATE: 1 / 60,
  
  // Pitch & Field Dimensions (in meters)
  FIELD: {
    LENGTH: 30.0,
    WIDTH: 18.0,
    GOAL_WIDTH: 3.5,
    GOAL_HEIGHT: 2.2,
    STRIKEZONE_WIDTH: 0.6,
    STRIKEZONE_HEIGHT: 0.8
  },

  // Physics & Ball Trajectories
  BALL: {
    RADIUS: 0.11,
    MASS: 0.14, // Lightweight Blitzball physics
    DRAG_COEFFICIENT: 0.25,
    MAGNUS_EFFECT_MULT: 1.85, // Curvability factor for breaking pitches
    MAX_VELOCITY: 38.0, // m/s
    RESTITUTION: 0.72 // Bounciness against turf/bat
  },

  // Mobile Touch Controls & Input
  TOUCH: {
    SWIPE_MIN_DISTANCE: 20, // Pixels
    SWIPE_MAX_DURATION: 350, // Ms
    VIRTUAL_STICK_DEADZONE: 0.15,
    MAX_PITCH_CURVE_OFFSET: 1.2 // Max horizontal curve displacement
  },

  // Performance Scaling Targets
  GRAPHICS: {
    TARGET_FPS: 60,
    MIN_DPR: 1.0,
    MAX_DPR: Math.min(window.devicePixelRatio || 1, 2.0),
    LOW_PERF_THRESHOLD_FPS: 45
  }
};
