/**
 * Server-Side Blitzball Match Replay & Anti-Cheat Validator
 * Re-runs encounter physics, stat variance, and goal resolutions deterministically.
 */

import { FFX_CONSTANTS } from '../src/data/constants.js';
import { EncounterEngine } from '../src/game/encounter-engine.js';
import { TEAMS } from '../src/data/ffx-teams.js';
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
    if (!submission || typeof submission !== 'object' || Array.isArray(submission)) {
      return { valid: false, errors: ['Invalid match submission schema.'], verifiedHomeScore: 0, verifiedAwayScore: 0, verifiedGil: 0 };
    }
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
    if (!Number.isSafeInteger(matchSeed) || matchSeed < 0) {
      errors.push('Invalid or missing matchSeed.');
    }
    if (!Array.isArray(actionLog) || !Number.isSafeInteger(reportedHomeScore) || reportedHomeScore < 0 || !Number.isSafeInteger(reportedAwayScore) || reportedAwayScore < 0 || !Number.isFinite(reportedGilEarned) || reportedGilEarned < 0) {
      errors.push('Invalid match submission schema.');
      return { valid: false, errors, verifiedHomeScore: 0, verifiedAwayScore: 0, verifiedGil: 0 };
    }

    if (homeTeamId === awayTeamId) {
      errors.push('Home and away teams must be different.');
      return { valid: false, errors, verifiedHomeScore: 0, verifiedAwayScore: 0, verifiedGil: 0 };
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
    actionLog.forEach((action, _index) => {
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        errors.push(`Invalid action at index ${_index}.`);
        return;
      }
      const { type, carrierId, defenderIds = [], isHomeCarrier, shotDistance = 0 } = action;
      if (!['BREAKTHROUGH', 'SHOOT'].includes(type) || typeof isHomeCarrier !== 'boolean' || !Array.isArray(defenderIds) || !Number.isFinite(shotDistance) || shotDistance < 0) {
        errors.push(`Invalid action at index ${_index}.`);
        return;
      }

      // Find character profiles in team rosters
      const teamPlayers = isHomeCarrier ? homeTeam.players : awayTeam.players;
      const enemyPlayers = isHomeCarrier ? awayTeam.players : homeTeam.players;

      const carrier = teamPlayers.find(p => p.id === carrierId);
      const defenders = enemyPlayers.filter(p => defenderIds.includes(p.id));
      const keeper = enemyPlayers.find((p) => p.pos === 'KP');
      if (!carrier || !keeper || defenders.length !== new Set(defenderIds).size || defenderIds.some((id) => !enemyPlayers.some((p) => p.id === id)) || defenderIds.includes(keeper.id)) {
        errors.push(`Invalid player reference at action ${_index}.`);
        return;
      }

      if (type === 'BREAKTHROUGH') {
        // Re-calculate Breakthrough EN vs TCK
        EncounterEngine.resolveBreakthrough(carrier, defenders, serverRNG);
      } else if (type === 'SHOOT') {
        // Step A: Breakthrough defenders
        const breakRes = EncounterEngine.resolveBreakthrough(carrier, defenders, serverRNG);
        
        if (breakRes.success) {
          // Step B: Block phase
          // The action log's defender list is the encounter boundary. Players outside
          // that boundary do not participate in this discrete block phase.
          const remainingDefs = [];
          const blockRes = EncounterEngine.resolveBlockPhase(carrier.sh, remainingDefs, serverRNG);

          if (!blockRes.blocked) {
            // Step C: Calculate Hydrodynamic Water Stat Decay
            const decayedSH = EncounterEngine.applyWaterDecay(blockRes.remainingStat, shotDistance, FFX_CONSTANTS.WATER.STAT_DECAY_PER_METER);

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
