/**
 * FFX Techcopy & Ability Unlocking Engine
 */

export class TechcopyEngine {
  constructor() {
    this.markedTargets = new Map(); // Map<PlayerId, Array<TechId>>
  }

  /**
   * Assigns techcopy tracking targets for the upcoming match
   * @param {string} playerId 
   * @param {Array<string>} techIds 
   */
  markTechsToCopy(playerId, techIds) {
    this.markedTargets.set(playerId, techIds);
  }

  /**
   * Checks if an executed technique triggers a Techcopy prompt
   * @param {Object} executor { id, name }
   * @param {string} techId 
   * @returns {boolean}
   */
  canCopyTech(executor, techId) {
    const targetTechs = this.markedTargets.get(executor.id);
    return targetTechs ? targetTechs.includes(techId) : false;
  }

  /**
   * Resolves Techcopy QTE attempt window
   * @param {number} promptTimeMs Time when "TECHCOPY!" flashed on screen
   * @param {number} inputTimeMs Player button press timestamp
   * @returns {{ success: boolean, timingDiffMs: number }}
   */
  resolveQTE(promptTimeMs, inputTimeMs) {
    const windowStart = promptTimeMs + 200; // 200ms delay window
    const windowEnd = promptTimeMs + 800;   // 600ms reaction window

    const success = inputTimeMs >= windowStart && inputTimeMs <= windowEnd;
    return {
      success,
      timingDiffMs: Math.abs(inputTimeMs - (promptTimeMs + 500))
    };
  }
}
