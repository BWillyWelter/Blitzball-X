/**
 * Career Mode & Progression System for Blitzball-X
 */

export class CareerManager {
  /**
   * @param {Object} [initialData]
   * @param {Object} [saveManager]
   */
  constructor(initialData = {}, saveManager = null) {
    this.saveManager = saveManager;
    this.data = {
      matchesPlayed: initialData.matchesPlayed || 0,
      wins: initialData.wins || 0,
      losses: initialData.losses || 0,
      goalsScored: initialData.goalsScored || 0,
      goalsConceded: initialData.goalsConceded || 0,
      coins: initialData.coins || 0,
      xp: initialData.xp || 0,
      level: initialData.level || 1,
      unlockedCosmetics: new Set(initialData.unlockedCosmetics || ['ball_standard', 'bat_standard', 'court_backyard']),
      equipped: {
        ball: initialData.equipped?.ball || 'ball_standard',
        bat: initialData.equipped?.bat || 'bat_standard',
        court: initialData.equipped?.court || 'court_backyard'
      }
    };
  }

  /**
   * Records match outcome and calculates XP/rewards
   * @param {Object} matchResult 
   */
  recordMatch(matchResult) {
    const { isWin, userScore, opponentScore, steals = 0, strikeOuts = 0 } = matchResult;

    this.data.matchesPlayed++;
    if (isWin) {
      this.data.wins++;
    } else {
      this.data.losses++;
    }

    this.data.goalsScored += userScore;
    this.data.goalsConceded += opponentScore;

    // Reward calculations
    const baseXP = isWin ? 150 : 50;
    const performanceXP = (userScore * 20) + (steals * 10) + (strikeOuts * 15);
    const totalXP = baseXP + performanceXP;

    const baseCoins = isWin ? 100 : 35;
    const performanceCoins = (userScore * 15);
    const totalCoins = baseCoins + performanceCoins;

    this.addXP(totalXP);
    this.data.coins += totalCoins;

    this.syncSave();

    return {
      xpEarned: totalXP,
      coinsEarned: totalCoins,
      leveledUp: this.checkLevelUp()
    };
  }

  addXP(amount) {
    this.data.xp += amount;
    this.checkLevelUp();
  }

  checkLevelUp() {
    const requiredXP = this.data.level * 250;
    if (this.data.xp >= requiredXP) {
      this.data.level++;
      this.data.xp -= requiredXP;
      return true;
    }
    return false;
  }

  unlockCosmetic(id, cost = 0) {
    if (this.data.unlockedCosmetics.has(id)) return true;
    if (this.data.coins < cost) return false;

    this.data.coins -= cost;
    this.data.unlockedCosmetics.add(id);
    this.syncSave();
    return true;
  }

  equipCosmetic(type, id) {
    if (!this.data.unlockedCosmetics.has(id)) return false;
    if (this.data.equipped[type] !== undefined) {
      this.data.equipped[type] = id;
      this.syncSave();
      return true;
    }
    return false;
  }

  serialize() {
    return {
      ...this.data,
      unlockedCosmetics: Array.from(this.data.unlockedCosmetics)
    };
  }

  async syncSave() {
    if (this.saveManager) {
      await this.saveManager.save({ career: this.serialize() });
    }
  }
}
