import { FFX_CONSTANTS } from '../data/constants.js';
import { EncounterEngine } from './combat.js';
import { WaterBall } from './ball.js';
import { createSeedableRNG } from '../core/rng.js';

export const MATCH_STATES = {
  FREE_SWIM: 'FREE_SWIM',
  ENCOUNTER_MENU: 'ENCOUNTER_MENU',
  ENCOUNTER_RESOLVING: 'ENCOUNTER_RESOLVING',
  SHOT_IN_FLIGHT: 'SHOT_IN_FLIGHT',
  GOAL_SCORED: 'GOAL_SCORED'
};

export class FFXMatch {
  constructor(homeTeam, awayTeam, seed = Date.now()) {
    this.homeTeam = homeTeam; // Array of 6 players
    this.awayTeam = awayTeam;
    this.rng = createSeedableRNG(seed);
    
    this.ball = new WaterBall();
    this.ballCarrier = null;
    this.state = MATCH_STATES.FREE_SWIM;
    
    this.nearbyDefenders = [];
    this.homeScore = 0;
    this.awayScore = 0;
    this.timeRemaining = 300; // 5-minute half (300 seconds)

    this.initPositions();
  }

  initPositions() {
    // Position players inside 3D Sphere Pool
    this.homeTeam.players.forEach((p, idx) => {
      p.position = { x: (idx - 2.5) * 4, y: 0, z: -8 };
      p.currentHP = p.hp;
    });

    this.awayTeam.players.forEach((p, idx) => {
      p.position = { x: (idx - 2.5) * 4, y: 0, z: 8 };
      p.currentHP = p.hp;
    });

    // Give ball to Home Center Forward
    this.ballCarrier = this.homeTeam.players[0];
    this.ball.attachToCarrier(this.ballCarrier);
  }

  step(delta) {
    if (this.state === MATCH_STATES.FREE_SWIM) {
      this.timeRemaining = Math.max(0, this.timeRemaining - delta);
      
      // Drain carrier HP while swimming
      if (this.ballCarrier) {
        this.ballCarrier.currentHP = Math.max(0, this.ballCarrier.currentHP - delta * FFX_CONSTANTS.WATER.SWIM_HP_COST_PER_SEC);
        this.ball.position = { ...this.ballCarrier.position };
        
        // Check for defender encounter trigger
        this.checkEncounterTriggers();
      }
    } else if (this.state === MATCH_STATES.SHOT_IN_FLIGHT) {
      this.ball.update(delta);
      if (!this.ball.isMoving) {
        this.resolveShotArrival();
      }
    }
  }

  checkEncounterTriggers() {
    const opposingPlayers = this.homeTeam.players.includes(this.ballCarrier)
      ? this.awayTeam.players
      : this.homeTeam.players;

    this.nearbyDefenders = opposingPlayers.filter(def => {
      const dist = Math.hypot(
        def.position.x - this.ballCarrier.position.x,
        def.position.y - this.ballCarrier.position.y,
        def.position.z - this.ballCarrier.position.z
      );
      return dist <= FFX_CONSTANTS.ENCOUNTER.TRIGGER_RADIUS;
    });

    if (this.nearbyDefenders.length > 0) {
      this.state = MATCH_STATES.ENCOUNTER_MENU;
    }
  }

  /**
   * Player selects action in Encounter Menu
   * @param {'BREAKTHROUGH'|'PASS'|'SHOOT'} action 
   * @param {Object} payload { chosenDefenders, targetPlayer }
   */
  executeEncounterAction(action, payload = {}) {
    if (this.state !== MATCH_STATES.ENCOUNTER_MENU) return;

    const { chosenDefenders = [], targetPlayer = null } = payload;

    if (action === 'BREAKTHROUGH') {
      const result = EncounterEngine.resolveBreakthrough(this.ballCarrier, chosenDefenders, this.rng);
      if (!result.success) {
        // Turnover
        this.ballCarrier = result.interceptedBy;
        this.ball.attachToCarrier(this.ballCarrier);
        this.state = MATCH_STATES.FREE_SWIM;
        return result;
      }
      this.state = MATCH_STATES.FREE_SWIM;
      return result;
    }

    if (action === 'SHOOT') {
      // 1. Resolve Breakthrough for chosen defenders
      const breakRes = EncounterEngine.resolveBreakthrough(this.ballCarrier, chosenDefenders, this.rng);
      if (!breakRes.success) {
        this.ballCarrier = breakRes.interceptedBy;
        this.ball.attachToCarrier(this.ballCarrier);
        this.state = MATCH_STATES.FREE_SWIM;
        return breakRes;
      }

      // 2. Resolve Block Phase for remaining unpassed defenders
      const remainingDefs = this.nearbyDefenders.filter(d => !chosenDefenders.includes(d));
      const blockRes = EncounterEngine.resolveBlockPhase(this.ballCarrier.sh, remainingDefs, this.rng);

      if (blockRes.blocked) {
        this.ballCarrier = blockRes.blocker;
        this.ball.attachToCarrier(this.ballCarrier);
        this.state = MATCH_STATES.FREE_SWIM;
        return blockRes;
      }

      // 3. Launch Shot towards Goal
      const enemyGoalPos = this.homeTeam.players.includes(this.ballCarrier)
        ? FFX_CONSTANTS.POOL.GOAL_POS_AWAY
        : FFX_CONSTANTS.POOL.GOAL_POS_HOME;

      this.ball.launch(this.ballCarrier.position, enemyGoalPos, blockRes.remainingStat);
      this.state = MATCH_STATES.SHOT_IN_FLIGHT;
      return { success: true };
    }
  }

  resolveShotArrival() {
    const enemyKeeper = this.homeTeam.players.includes(this.ballCarrier)
      ? this.awayTeam.players[5] // Keeper index
      : this.homeTeam.players[5];

    const result = EncounterEngine.resolveKeeperCatch(this.ball.currentStat, enemyKeeper, this.rng);

    if (result.isGoal) {
      if (this.homeTeam.players.includes(this.ballCarrier)) {
        this.homeScore++;
      } else {
        this.awayScore++;
      }
      this.state = MATCH_STATES.GOAL_SCORED;
    } else {
      this.ballCarrier = enemyKeeper;
      this.ball.attachToCarrier(enemyKeeper);
      this.state = MATCH_STATES.FREE_SWIM;
    }
  }
                    }
