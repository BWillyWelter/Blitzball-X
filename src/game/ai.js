/**
 * Spira Opponent Tactical AI & Defensive Formations Engine for Blitzball-X
 * Handles dynamic tactical shifts, field positioning vectors, ball possession decision trees,
 * and team-specific AI strategies across Spira Blitzball teams.
 */

export const FORMATIONS = {
  NORMAL: 'NORMAL',          // Standard balanced positioning
  MARK_MAN: 'MARK_MAN',      // Strict 1-on-1 defender marking
  OFFENSE: 'OFFENSE',        // Forward push, line pressing
  DEFENSE: 'DEFENSE',        // Goalie box density, shot containment
  COUNTER: 'COUNTER'         // Fast break out on turnover
};

export const AI_STRATEGIES = {
  LUCA_GOERS: {
    preferredFormations: [FORMATIONS.OFFENSE, FORMATIONS.MARK_MAN],
    aggressiveness: 0.85,
    passThresholdSH: 12,    // Will shoot if SH >= 12 or close to goal
    breakthroughBias: 0.70   // High chance to attempt physical EN breakthrough
  },
  AL_BHED_PSYCHES: {
    preferredFormations: [FORMATIONS.COUNTER, FORMATIONS.DEFENSE],
    aggressiveness: 0.65,
    passThresholdSH: 15,
    breakthroughBias: 0.40   // Prefers fast long-range passing
  },
  GUADO_GLORIES: {
    preferredFormations: [FORMATIONS.COUNTER, FORMATIONS.NORMAL],
    aggressiveness: 0.50,
    passThresholdSH: 14,
    breakthroughBias: 0.20   // Relies on high SPD and quick passing
  },
  RONSO_FANGS: {
    preferredFormations: [FORMATIONS.OFFENSE, FORMATIONS.NORMAL],
    aggressiveness: 0.90,
    passThresholdSH: 10,
    breakthroughBias: 0.85   // Extremely physical, forces EN breakthroughs
  },
  KILIKA_BEASTS: {
    preferredFormations: [FORMATIONS.DEFENSE, FORMATIONS.NORMAL],
    aggressiveness: 0.40,
    passThresholdSH: 16,
    breakthroughBias: 0.30
  }
};

export class TacticalAIEngine {
  /**
   * @param {Object} team Opponent team configuration
   */
  constructor(team) {
    this.team = team;
    this.strategy = AI_STRATEGIES[team.id?.toUpperCase()] || AI_STRATEGIES.LUCA_GOERS;
    this.currentFormation = FORMATIONS.NORMAL;
    this.markingAssignments = new Map(); // Map<AIDefenderId, TargetPlayerId>
    this.lastFormationSwitchTime = 0;
  }

  /**
   * Evaluates match state and dynamically updates team tactical formation
   * @param {Object} match Current FFXMatch instance
   */
  updateTactics(match) {
    const now = performance.now();
    // Throttle tactical changes to every 10 seconds of match time
    if (now - this.lastFormationSwitchTime < 10000) return;

    const isAIHome = match.homeTeam.id === this.team.id;
    const aiScore = isAIHome ? match.homeScore : match.awayScore;
    const opponentScore = isAIHome ? match.awayScore : match.homeScore;
    const scoreDiff = aiScore - opponentScore;
    const timeRemaining = match.timeRemaining || 180; // Seconds left in half

    // 1. Desperation Offense: Trailing near end of match
    if (scoreDiff < 0 && timeRemaining < 60) {
      this.setFormation(FORMATIONS.OFFENSE);
    }
    // 2. Protect Lead: Leading near end of match
    else if (scoreDiff > 0 && timeRemaining < 60) {
      this.setFormation(FORMATIONS.DEFENSE);
    }
    // 3. Mark Man-to-Man if opponent has a high-scoring ball carrier
    else if (match.ballCarrier && match.ballCarrier.teamId !== this.team.id && match.ballCarrier.sh > 14) {
      this.setFormation(FORMATIONS.MARK_MAN);
      this.assignMarkingTargets(match);
    }
    // 4. Fallback to team strategy default
    else {
      this.setFormation(this.strategy.preferredFormations[0] || FORMATIONS.NORMAL);
    }

    this.lastFormationSwitchTime = now;
  }

  /**
   * Sets the active tactical formation
   * @param {string} formation 
   */
  setFormation(formation) {
    this.currentFormation = formation;
  }

  /**
   * Assigns individual defenders to mark specific opponent players
   * @param {Object} match 
   */
  assignMarkingTargets(match) {
    const isAIHome = match.homeTeam.id === this.team.id;
    const opponentTeam = isAIHome ? match.awayTeam : match.homeTeam;
    const aiDefenders = this.team.players.filter(p => p.pos === 'DF' || p.pos === 'MF');

    this.markingAssignments.clear();

    opponentTeam.players.forEach((oppPlayer, idx) => {
      const assignedDefender = aiDefenders[idx % aiDefenders.length];
      if (assignedDefender) {
        this.markingAssignments.set(assignedDefender.id, oppPlayer.id);
      }
    });
  }

  /**
   * Computes target movement velocity vectors for AI controlled players
   * @param {Object} player Active AI player instance
   * @param {Object} match Active match instance
   * @returns {{ x: number, z: number }} Target direction vector
   */
  calculatePlayerMovement(player, match) {
    const ballPos = match.ballPosition || { x: 0, z: 0 };
    const goalPos = { x: 0, z: -18 }; // Target goal coordinates
    const ownGoalPos = { x: 0, z: 18 };

    // Goalkeepers stay near goal line
    if (player.pos === 'GK') {
      const targetX = Math.max(-4, Math.min(4, ballPos.x * 0.3));
      return {
        x: (targetX - player.position.x) * 0.5,
        z: (ownGoalPos.z - player.position.z) * 0.5
      };
    }

    // Ball Carrier AI Movement
    if (match.ballCarrier && match.ballCarrier.id === player.id) {
      // Drive toward opponent goal line
      const dx = goalPos.x - player.position.x;
      const dz = goalPos.z - player.position.z;
      const dist = Math.hypot(dx, dz);
      return { x: dx / dist, z: dz / dist };
    }

    // Defensive & Marking Positioning
    switch (this.currentFormation) {
      case FORMATIONS.MARK_MAN: {
        const targetId = this.markingAssignments.get(player.id);
        const targetPlayer = match.allPlayers?.find(p => p.id === targetId);
        if (targetPlayer) {
          const dx = targetPlayer.position.x - player.position.x;
          const dz = targetPlayer.position.z - player.position.z;
          const dist = Math.hypot(dx, dz) || 1;
          return { x: dx / dist, z: dz / dist };
        }
        break;
      }

      case FORMATIONS.OFFENSE: {
        // Shift entire formation forward toward opponent zone
        const dx = ballPos.x - player.position.x;
        const dz = (ballPos.z - 8) - player.position.z;
        const dist = Math.hypot(dx, dz) || 1;
        return { x: dx / dist, z: dz / dist };
      }

      case FORMATIONS.DEFENSE: {
        // Collapse back toward own goal box
        const dx = (ballPos.x * 0.5) - player.position.x;
        const dz = (ownGoalPos.z * 0.7) - player.position.z;
        const dist = Math.hypot(dx, dz) || 1;
        return { x: dx / dist, z: dz / dist };
      }

      default: {
        // Normal Formation: Press ball carrier
        const dx = ballPos.x - player.position.x;
        const dz = ballPos.z - player.position.z;
        const dist = Math.hypot(dx, dz) || 1;
        return { x: dx / dist, z: dz / dist };
      }
    }

    return { x: 0, z: 0 };
  }

  /**
   * Decides action (SHOOT, PASS, BREAKTHROUGH) during encounter decisions
   * @param {Object} carrier AI player holding ball
   * @param {Array<Object>} defenders Intercepting defenders
   * @param {Object} keeper Opponent goalkeeper
   * @param {number} distToGoal Distance from goal line in meters
   * @returns {{ action: string, targetPlayer?: Object, tech?: string }}
   */
  selectEncounterAction(carrier, defenders, keeper, distToGoal) {
    const effectiveSH = carrier.sh || 10;
    const totalDef TCK = defenders.reduce((sum, d) => sum + (d.tck || 0), 0);

    // 1. Shoot Decision: Close range or high SH stat relative to keeper CAT
    if (distToGoal <= 12 || (effectiveSH >= keeper.cat + 3 && distToGoal <= 18)) {
      return { action: 'SHOOT', tech: carrier.techs?.find(t => t.includes('shot')) || null };
    }

    // 2. Breakthrough Decision: High carrier EN vs total defender TCK
    if (carrier.en > totalDefTCK * 0.8 && Math.random() < this.strategy.breakthroughBias) {
      return { action: 'BREAKTHROUGH' };
    }

    // 3. Pass Decision: Pass to open teammate with better field position
    return { action: 'PASS', tech: carrier.techs?.find(t => t.includes('pass')) || null };
  }
}
