import { createHash } from 'node:crypto';
import { createSeedableRNG } from '../src/core/rng.js';
import { Match } from '../src/game/match.js';
import { TEAMS } from '../src/data/teams.js';

export class MatchValidator {
  /**
   * Validates a client-submitted replay log headlessly.
   * 
   * @param {Object} payload
   * @param {number} payload.seed
   * @param {string} payload.homeTeamId
   * @param {string} payload.awayTeamId
   * @param {Array<{tick: number, action: string, payload: Object}>} payload.inputLog
   * @param {number} payload.claimedHomeScore
   * @param {number} payload.claimedAwayScore
   * @returns {{ valid: boolean, serverHomeScore: number, serverAwayScore: number, checksum: string, reason?: string }}
   */
  static validateMatch(payload) {
    const { seed, homeTeamId, awayTeamId, inputLog, claimedHomeScore, claimedAwayScore } = payload;

    if (!TEAMS[homeTeamId] || !TEAMS[awayTeamId]) {
      return { valid: false, serverHomeScore: 0, serverAwayScore: 0, checksum: '', reason: 'Invalid team configuration' };
    }

    const rng = createSeedableRNG(seed);
    const match = new Match({
      homeTeam: TEAMS[homeTeamId],
      awayTeam: TEAMS[awayTeamId],
      rng,
      headless: true
    });

    let inputIndex = 0;
    const totalTicks = match.totalTicks || 3600; // 60 FPS * 60s

    for (let tick = 0; tick < totalTicks; tick++) {
      // Process all input actions corresponding to the current tick
      while (inputIndex < inputLog.length && inputLog[inputIndex].tick === tick) {
        const input = inputLog[inputIndex];
        match.applyPlayerInput(input.action, input.payload);
        inputIndex++;
      }

      match.step();
      if (match.isFinished()) break;
    }

    const finalResult = match.getFinalResult();
    const matchesClaimed = finalResult.homeScore === claimedHomeScore && finalResult.awayScore === claimedAwayScore;

    // Generate cryptographic checksum of final state
    const hash = createHash('sha256');
    hash.update(`${seed}:${finalResult.homeScore}:${finalResult.awayScore}:${match.getTickCount()}`);
    const checksum = hash.digest('hex');

    if (!matchesClaimed) {
      return {
        valid: false,
        serverHomeScore: finalResult.homeScore,
        serverAwayScore: finalResult.awayScore,
        checksum,
        reason: `Score mismatch. Server evaluated ${finalResult.homeScore}-${finalResult.awayScore}, client reported ${claimedHomeScore}-${claimedAwayScore}.`
      };
    }

    return {
      valid: true,
      serverHomeScore: finalResult.homeScore,
      serverAwayScore: finalResult.awayScore,
      checksum
    };
  }
  }
