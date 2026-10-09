import { FFX_CONSTANTS } from '../data/constants.js';
import { createSeedableRNG } from '../core/rng.js';

export class EncounterEngine {
  /**
   * Calculates FFX Stat Variance: Stat * RNG(0.5 to 1.5)
   */
  static applyVariance(baseStat, rng) {
    const mult = FFX_CONSTANTS.ENCOUNTER.RNG_MIN + (rng.nextFloat() * (FFX_CONSTANTS.ENCOUNTER.RNG_MAX - FFX_CONSTANTS.ENCOUNTER.RNG_MIN));
    return Math.floor(baseStat * mult);
  }

  /**
   * Resolves Carrier breaking through selected defenders
   * @param {Object} carrier { en, hp, ... }
   * @param {Array<Object>} chosenDefenders Array of { id, name, tck, ... }
   * @param {Object} rng Seedable RNG instance
   */
  static resolveBreakthrough(carrier, chosenDefenders, rng) {
    let currentEN = carrier.en;
    const combatLog = [];

    for (const defender of chosenDefenders) {
      const effectiveTCK = this.applyVariance(defender.tck, rng);
      currentEN -= effectiveTCK;

      combatLog.push({
        defender: defender.name,
        tckDamage: effectiveTCK,
        remainingEN: Math.max(0, currentEN)
      });

      if (currentEN <= 0) {
        return {
          success: false,
          remainingEN: 0,
          interceptedBy: defender,
          log: combatLog
        };
      }
    }

    return {
      success: true,
      remainingEN: currentEN,
      interceptedBy: null,
      log: combatLog
    };
  }

  /**
   * Resolves Pass/Shot against remaining blocking defenders
   */
  static resolveBlockPhase(actionStat, defenders, rng) {
    let currentStat = actionStat;
    const blockLog = [];

    for (const defender of defenders) {
      const effectiveBLK = this.applyVariance(defender.blk, rng);
      currentStat -= effectiveBLK;

      blockLog.push({
        defender: defender.name,
        blkAmount: effectiveBLK,
        remainingStat: Math.max(0, currentStat)
      });

      if (currentStat <= 0) {
        return {
          blocked: true,
          blocker: defender,
          remainingStat: 0,
          log: blockLog
        };
      }
    }

    return {
      blocked: false,
      blocker: null,
      remainingStat: currentStat,
      log: blockLog
    };
  }

  /**
   * Resolves final Shot vs Keeper Catch (CAT)
   */
  static resolveKeeperCatch(finalSH, keeper, rng) {
    const effectiveCAT = this.applyVariance(keeper.cat, rng);
    const isGoal = finalSH > effectiveCAT;

    return {
      isGoal,
      finalSH,
      effectiveCAT,
      margin: Math.abs(finalSH - effectiveCAT)
    };
  }
}
