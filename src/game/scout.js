/**
 * FFX Free Agent Scout & Contract Negotiation Engine
 */

export const SCOUT_LEVELS = {
  1: { cost: 0, reveals: ['name', 'pos', 'salary', 'team'] },
  2: { cost: 100, reveals: ['hp', 'en', 'cat'] },
  3: { cost: 500, reveals: ['pas', 'sh', 'tck', 'blk', 'cut'] },
  4: { cost: 1500, reveals: ['techs'] },
  5: { cost: 3000, reveals: ['keyTechs', 'contractLength'] } // Full visibility
};

export const FREE_AGENTS = {
  p_brother: {
    id: 'p_brother',
    name: 'Brother',
    location: 'Fahrenheit Airship',
    baseSalary: 210, // Gil per game
    level: 1,
    pos: 'MF',
    hp: 145, en: 14, pas: 14, sh: 6, tck: 9, blk: 7, cut: 8, cat: 1,
    techs: ['SPHERE_SHOT', 'VENOM_PASS_1'],
    keyTechs: ['VENOM_TACKLE_2', 'WITHER_PASS_2', 'JECHT_SHOT']
  },
  p_ropp: {
    id: 'p_ropp',
    name: 'Ropp',
    location: 'Mi\'ihen Travel Agency',
    baseSalary: 200,
    level: 1,
    pos: 'LD',
    hp: 135, en: 11, pas: 10, sh: 1, tck: 11, blk: 12, cut: 10, cat: 1,
    techs: ['VENOM_TACKLE_1', 'NAP_PASS_1'],
    keyTechs: ['DRAIN_TACKLE', 'VENOM_TACKLE_2', 'WITHER_TACKLE_2']
  },
  p_wedge: {
    id: 'p_wedge',
    name: 'Wedge',
    location: 'Luca Stadium Guard',
    baseSalary: 160,
    level: 1,
    pos: 'RF',
    hp: 110, en: 9, pas: 3, sh: 17, tck: 4, blk: 2, cut: 2, cat: 2,
    techs: ['VENOM_SHOT_1'],
    keyTechs: ['WITHER_SHOT_1', 'NAP_SHOT_1']
  },
  p_biggs: {
    id: 'p_biggs',
    name: 'Biggs',
    location: 'Luca Stadium Guard',
    baseSalary: 180,
    level: 1,
    pos: 'LF',
    hp: 125, en: 10, pas: 4, sh: 13, tck: 7, blk: 3, cut: 3, cat: 1,
    techs: ['WITHER_SHOT_1'],
    keyTechs: ['VENOM_SHOT_2']
  },
  p_jumal: {
    id: 'p_jumal',
    name: 'Jumal',
    location: 'Luca Square Bench',
    baseSalary: 120,
    level: 1,
    pos: 'KP',
    hp: 95, en: 6, pas: 3, sh: 1, tck: 2, blk: 1, cut: 1, cat: 14,
    techs: ['SUPER_GOALIE'],
    keyTechs: ['ROUSE']
  },
  p_kyou: {
    id: 'p_kyou',
    name: 'Kyou',
    location: 'Djose Temple Bridge',
    baseSalary: 300,
    level: 1,
    pos: 'RD',
    hp: 140, en: 12, pas: 8, sh: 2, tck: 12, blk: 10, cut: 9, cat: 1,
    techs: ['VENOM_TACKLE_2'],
    keyTechs: ['DRAIN_TACKLE_2']
  },
  p_svanda: {
    id: 'p_svanda',
    name: 'Svanda',
    location: 'Calm Lands North',
    baseSalary: 130,
    level: 1,
    pos: 'MF',
    hp: 120, en: 10, pas: 9, sh: 8, tck: 6, blk: 5, cut: 6, cat: 1,
    techs: ['NAP_PASS_1'],
    keyTechs: ['VENOM_PASS_2']
  }
};

export class ScoutManager {
  /**
   * @param {Object} [savedState]
   */
  constructor(savedState = {}) {
    this.scoutLevel = savedState.scoutLevel || 1;
    this.gil = savedState.gil || 5000;
    
    // Track contract status of free agents
    this.agentContracts = savedState.agentContracts || this.initAgentContracts();
  }

  initAgentContracts() {
    const contracts = {};
    for (const id of Object.keys(FREE_AGENTS)) {
      contracts[id] = {
        agentId: id,
        contractGames: 0, // 0 = Free Agent, >0 = Signed to team
        signedTeam: null,
        currentSalary: FREE_AGENTS[id].baseSalary
      };
    }
    return contracts;
  }

  /**
   * Upgrades player Scout Level using Gil
   * @returns {{ success: boolean, newLevel: number, remainingGil: number }}
   */
  upgradeScoutLevel() {
    const nextLevel = this.scoutLevel + 1;
    const config = SCOUT_LEVELS[nextLevel];

    if (!config) {
      return { success: false, message: 'Maximum Scout Level reached.' };
    }

    if (this.gil < config.cost) {
      return { success: false, message: `Insufficient Gil. Need ${config.cost} Gil.` };
    }

    this.gil -= config.cost;
    this.scoutLevel = nextLevel;

    return {
      success: true,
      newLevel: this.scoutLevel,
      remainingGil: this.gil
    };
  }

  /**
   * Evaluates visible agent stats based on current Scout Level
   * @param {string} agentId 
   * @returns {Object} Filtered agent profile
   */
  scoutPlayer(agentId) {
    const agent = FREE_AGENTS[agentId];
    const contract = this.agentContracts[agentId];

    if (!agent) return null;

    const visibleProfile = {
      id: agent.id,
      name: agent.name,
      location: agent.location,
      pos: agent.pos,
      salary: contract.currentSalary,
      contractGames: contract.contractGames,
      signedTeam: contract.signedTeam
    };

    if (this.scoutLevel >= 2) {
      visibleProfile.hp = agent.hp;
      visibleProfile.en = agent.en;
      visibleProfile.cat = agent.cat;
    }

    if (this.scoutLevel >= 3) {
      visibleProfile.pas = agent.pas;
      visibleProfile.sh = agent.sh;
      visibleProfile.tck = agent.tck;
      visibleProfile.blk = agent.blk;
      visibleProfile.cut = agent.cut;
    }

    if (this.scoutLevel >= 4) {
      visibleProfile.techs = agent.techs;
    }

    if (this.scoutLevel >= 5) {
      visibleProfile.keyTechs = agent.keyTechs;
    }

    return visibleProfile;
  }

  /**
   * Offers a contract to a Free Agent
   * @param {string} agentId 
   * @param {number} games Count of games to offer (1 to 99)
   * @param {string} teamId Purchasing team ID
   * @returns {{ success: boolean, totalCost: number, message: string }}
   */
  offerContract(agentId, games, teamId = 'besaid_aurochs') {
    const agent = FREE_AGENTS[agentId];
    const contract = this.agentContracts[agentId];

    if (!agent || !contract) {
      return { success: false, message: 'Player not found in Spira.' };
    }

    if (contract.contractGames > 0 && contract.signedTeam !== teamId) {
      return { success: false, message: `Player is under contract with ${contract.signedTeam}.` };
    }

    const totalCost = contract.currentSalary * games;

    if (this.gil < totalCost) {
      return { success: false, message: `Insufficient Gil. Need ${totalCost} Gil.` };
    }

    this.gil -= totalCost;
    contract.contractGames += games;
    contract.signedTeam = teamId;

    return {
      success: true,
      totalCost,
      remainingGil: this.gil,
      message: `Signed ${agent.name} for ${games} games!`
    };
  }

  /**
   * Decrements contracts for signed players at the end of every match
   * @param {string} teamId 
   */
  decayMatchContracts(teamId) {
    const expiredPlayers = [];

    for (const [id, c] of Object.entries(this.agentContracts)) {
      if (c.signedTeam === teamId && c.contractGames > 0) {
        c.contractGames--;
        if (c.contractGames === 0) {
          c.signedTeam = null; // Released back into Free Agency
          expiredPlayers.push(FREE_AGENTS[id].name);
        }
      }
    }

    return expiredPlayers;
  }
      }
