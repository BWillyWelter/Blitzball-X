/**
 * FFX Techniques Engine & Status Effects
 */

export const TECHNIQUES = {
  JECHT_SHOT: {
    id: 'JECHT_SHOT',
    name: 'Jecht Shot',
    hpCost: 120,
    shBonus: 5,
    knockoutCount: 2, // Automatically eliminates up to 2 defenders before block phase
    description: 'Knocks out 2 defenders and boosts SH by +5.'
  },

  SPHERE_SHOT: {
    id: 'SPHERE_SHOT',
    name: 'Sphere Shot',
    hpCost: 90,
    shBonus: 0, // Adds 0 to 1.5x base SH dynamically via RNG
    isDynamicRNG: true,
    description: 'Adds a massive random boost to SH.'
  },

  VENOM_TACKLE_1: {
    id: 'VENOM_TACKLE_1',
    name: 'Venom Tackle',
    hpCost: 40,
    tckBonus: 3,
    statusEffect: 'POISON',
    statusChance: 0.6,
    description: '+3 TCK and 60% chance to inflict Poison.'
  },

  NAP_PASS_1: {
    id: 'NAP_PASS_1',
    name: 'Nap Pass',
    hpCost: 40,
    pasBonus: 3,
    statusEffect: 'SLEEP',
    statusChance: 0.6,
    description: '+3 PAS and 60% chance to put blocker to sleep.'
  },

  WITHER_TACKLE_1: {
    id: 'WITHER_TACKLE_1',
    name: 'Wither Tackle',
    hpCost: 40,
    tckBonus: 3,
    statusEffect: 'WITHER',
    statusChance: 0.6,
    description: '+3 TCK and 60% chance to halve target stats.'
  }
};

export class TechniqueManager {
  /**
   * Executes Jecht Shot defender knockouts prior to block phase
   */
  static processJechtShot(defenders) {
    const knockedOut = defenders.slice(0, 2);
    const remainingDefenders = defenders.slice(2);

    return {
      knockedOutNames: knockedOut.map(d => d.name),
      remainingDefenders
    };
  }

  /**
   * Calculates technique modifications to base stats
   */
  static applyTechBonuses(techId, baseStat, rng) {
    const tech = TECHNIQUES[techId];
    if (!tech) return baseStat;

    let totalStat = baseStat;

    if (tech.shBonus) totalStat += tech.shBonus;
    if (tech.pasBonus) totalStat += tech.pasBonus;
    if (tech.tckBonus) totalStat += tech.tckBonus;

    if (tech.isDynamicRNG) {
      // Sphere Shot bonus formula: Adds 0 to baseStat * 1.5
      const bonus = Math.floor(rng.nextFloat() * baseStat * 1.5);
      totalStat += bonus;
    }

    return totalStat;
  }

  /**
   * Handles status ailment applications (Poison, Sleep, Wither)
   */
  static processStatusAilment(techId, targetPlayer, rng) {
    const tech = TECHNIQUES[techId];
    if (!tech || !tech.statusEffect) return null;

    if (rng.nextFloat() <= tech.statusChance) {
      targetPlayer.status = {
        type: tech.statusEffect,
        duration: 90 // 90 seconds in-game duration
      };
      return tech.statusEffect;
    }

    return null;
  }
      }
