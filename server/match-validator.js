/**
 * Server-Side Blitzball Match Replay & Anti-Cheat Validator
 * Re-runs encounter physics, stat variance, and goal resolutions deterministically.
 */

import { FFX_CONSTANTS } from '../src/data/constants.js';
import { EncounterEngine } from '../src/game/combat.js';
import { TEAMS } from '../src/data/teams.js';
import { createSeedableRNG } from '../src/core/rng.js';

export class MatchReplayValidator {
  /**
   * Validates a client match submission against a deterministic server replay
   * 
   * @param {Object} submission
   * @param {number} submission.matchSeed Initial RNG seed for the match
   * @param {string} submission.homeTeamId Home team identifier
   * @param {string} submission.awayTeamId Away team identifier
   * @param {Array<Object>} submission.actionLog Sequence of player encounters and shot actions
   * @param {number} submission.reportedHomeScore Home score claimed by client
   * @param {number} submission.reportedAwayScore Away score claimed by client
   * @param {number} submission.reportedGilEarned Gil addition claimed by client
   * @returns {{ valid: boolean, errors: string[], verifiedHomeScore: number, verifiedAwayScore: number, verifiedGil: number }}
   */
  static validateMatchSubmission(submission) {
    const errors = [];
    const {
      matchSeed,
      homeTeamId,
      awayTeamId,
      actionLog = [],
      reportedHomeScore,
      reportedAwayScore,
      reportedGilEarned
    } = submission;

    // 1. Basic Schema & Team Checks
    if (!matchSeed || typeof matchSeed !== 'number') {
      errors.push('Invalid or missing matchSeed.');
    }

    const homeTeam = TEAMS[homeTeamId];
    const awayTeam = TEAMS[awayTeamId];

    if (!homeTeam || !awayTeam) {
      errors.push(`Invalid team IDs: home="${homeTeamId}", away="${awayTeamId}".`);
      return { valid: false, errors, verifiedHomeScore: 0, verifiedAwayScore: 0, verifiedGil: 0 };
    }

    // Initialize seedable server RNG matching client match start seed
    const serverRNG = createSeedableRNG(matchSeed);

    let serverHomeScore = 0;
    let serverAwayScore = 0;

    // 2. Re-simulate Encounter Actions in Sequence
    actionLog.forEach((action, index) => {
      const { type, carrierId, defenderIds = [], isHomeCarrier, shotDistance = 0 } = action;

      // Find character profiles in team rosters
      const teamPlayers = isHomeCarrier ? homeTeam.players : awayTeam.players;
      const enemyPlayers = isHomeCarrier ? awayTeam.players : homeTeam.players;

      const carrier = teamPlayers.find(p => p.id === carrierId) || teamPlayers[0];
      const defenders = enemyPlayers.filter(p => defenderIds.includes(p.id));
      const keeper = enemyPlayers[enemyPlayers.length - 1]; // Keeper is last roster slot

      if (type === 'BREAKTHROUGH') {
        // Re-calculate Breakthrough EN vs TCK
        EncounterEngine.resolveBreakthrough(carrier, defenders, serverRNG);
      } else if (type === 'SHOOT') {
        // Step A: Breakthrough defenders
        const breakRes = EncounterEngine.resolveBreakthrough(carrier, defenders, serverRNG);
        
        if (breakRes.success) {
          // Step B: Block phase
          const remainingDefs = enemyPlayers.filter(p => !defenderIds.includes(p.id) && p !== keeper);
          const blockRes = EncounterEngine.resolveBlockPhase(carrier.sh, remainingDefs, serverRNG);

          if (!blockRes.blocked) {
            // Step C: Calculate Hydrodynamic Water Stat Decay
            const decayedSH = Math.max(0, blockRes.remainingStat - Math.floor(shotDistance * FFX_CONSTANTS.WATER.STAT_DECAY_PER_METER));

            // Step D: Keeper Catch (CAT) Resolution
            const keeperRes = EncounterEngine.resolveKeeperCatch(decayedSH, keeper, serverRNG);

            if (keeperRes.isGoal) {
              if (isHomeCarrier) {
                serverHomeScore++;
              } else {
                serverAwayScore++;
              }
            }
          }
        }
      }
    });

    // 3. Verify Claimed Scores vs Re-simulated Scores
    if (reportedHomeScore !== serverHomeScore) {
      errors.push(`Home score mismatch: client claimed ${reportedHomeScore}, server calculated ${serverHomeScore}.`);
    }

    if (reportedAwayScore !== serverAwayScore) {
      errors.push(`Away score mismatch: client claimed ${reportedAwayScore}, server calculated ${serverAwayScore}.`);
    }

    // 4. Calculate Allowed Gil Rewards
    let calculatedGil = 0;
    if (serverHomeScore > serverAwayScore) {
      calculatedGil = 1000; // Base Win Gil
    } else if (serverHomeScore === serverAwayScore) {
      calculatedGil = 500;  // Draw Gil
    } else {
      calculatedGil = 300;  // Participation Loss Gil
    }

    // Goal bonus (+50 Gil per home goal, max +250)
    calculatedGil += Math.min(250, serverHomeScore * 50);

    if (reportedGilEarned > calculatedGil) {
      errors.push(`Gil reward inflation detected: client requested ${reportedGilEarned} Gil, server cap is ${calculatedGil} Gil.`);
    }

    const isValid = errors.length === 0;

    return {
      valid: isValid,
      errors,
      verifiedHomeScore: serverHomeScore,
      verifiedAwayScore: serverAwayScore,
      verifiedGil: isValid ? reportedGilEarned : calculatedGil
    };
  }
}
