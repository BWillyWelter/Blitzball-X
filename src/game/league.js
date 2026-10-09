/**
 * FFX League, Tournament & Prize Manager for Blitzball-X
 */

import { TEAMS } from '../data/teams.js';
import { createSeedableRNG } from '../core/rng.js';

export const COMPETITION_TYPES = {
  LEAGUE: 'LEAGUE',             // 10-game round-robin season
  TOURNAMENT: 'TOURNAMENT',     // 3-round knockout bracket (6 teams, seed-based)
  EXHIBITION: 'EXHIBITION'     // Single casual match (no prize rewards or contract changes)
};

export class LeagueManager {
  /**
   * @param {Object} [saveData]
   */
  constructor(saveData = {}) {
    this.type = saveData.type || COMPETITION_TYPES.LEAGUE;
    this.currentRound = saveData.currentRound || 1;
    this.maxRounds = saveData.maxRounds || 10;
    this.isCompleted = saveData.isCompleted || false;
    
    // Participating team IDs across Spira
    this.teams = saveData.teams || Object.keys(TEAMS);
    
    // Standings table for League mode
    this.standings = saveData.standings || this.initStandings();
    
    // Elimination bracket structure for Tournament mode
    this.bracket = saveData.bracket || this.initBracket();
    
    // Active Prizes (1st Place, 2nd Place, 3rd Place, Top Scorer)
    this.prizes = saveData.prizes || this.generatePrizes();
  }

  /**
   * Initializes round-robin league standings table
   */
  initStandings() {
    const table = {};
    for (const teamId of this.teams) {
      table[teamId] = {
        teamId,
        name: TEAMS[teamId]?.name || teamId,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0 // 3 for win, 1 for draw, 0 for loss
      };
    }
    return table;
  }

  /**
   * Initializes a 6-team seeded knockout bracket (FFX Spira Tournament format)
   */
  initBracket() {
    const seeded = [...this.teams].sort(() => Math.random() - 0.5);
    return {
      round1: [
        { home: seeded[0], away: seeded[1], winner: null, score: null },
        { home: seeded[2], away: seeded[3], winner: null, score: null }
      ],
      semiFinals: [
        { home: null, away: seeded[4], winner: null, score: null }, // Seeded bye
        { home: null, away: seeded[5], winner: null, score: null }  // Seeded bye
      ],
      finals: { home: null, away: null, winner: null, score: null }
    };
  }

  /**
   * Generates FFX-accurate Spira prizes for 1st, 2nd, 3rd place and Top Scorer
   */
  generatePrizes() {
    const possibleTechs = ['JECHT_SHOT', 'SPHERE_SHOT', 'VENOM_TACKLE_2', 'NAP_PASS_2', 'WITHER_SHOT_2'];
    const randomTech = possibleTechs[Math.floor(Math.random() * possibleTechs.length)];

    return {
      firstPlace: { type: 'TECH', value: randomTech, name: `Technique: ${randomTech}`, gil: 5000 },
      secondPlace: { type: 'ITEM', value: 'RETURN_SPHERE', name: 'Return Sphere x1', gil: 2500 },
      thirdPlace: { type: 'GIL', value: 1000, name: '1,000 Gil', gil: 1000 },
      topScorer: { type: 'TECH', value: 'VOLLEY_SHOT', name: 'Technique: Volley Shot', gil: 1500 }
    };
  }

  /**
   * Records completed match result and updates points/standings
   */
  recordMatchResult(homeId, awayId, homeGoals, awayGoals) {
    if (this.type === COMPETITION_TYPES.LEAGUE) {
      this.updateLeagueStandings(homeId, awayId, homeGoals, awayGoals);
    } else if (this.type === COMPETITION_TYPES.TOURNAMENT) {
      this.updateTournamentBracket(homeId, awayId, homeGoals, awayGoals);
    }
  }

  updateLeagueStandings(homeId, awayId, homeGoals, awayGoals) {
    const home = this.standings[homeId];
    const away = this.standings[awayId];

    if (!home || !away) return;

    home.played++;
    away.played++;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.wins++;
      home.points += 3;
      away.losses++;
    } else if (awayGoals > homeGoals) {
      away.wins++;
      away.points += 3;
      home.losses++;
    } else {
      home.draws++;
      away.draws++;
      home.points += 1;
      away.points += 1;
    }
  }

  updateTournamentBracket(homeId, awayId, homeGoals, awayGoals) {
    const winner = homeGoals >= awayGoals ? homeId : awayId;
    
    // Progress winner through bracket nodes
    if (this.currentRound === 1) {
      const matchNode = this.bracket.round1.find(m => m.home === homeId && m.away === awayId);
      if (matchNode) {
        matchNode.winner = winner;
        matchNode.score = `${homeGoals}-${awayGoals}`;
        
        // Slot into semifinals
        if (!this.bracket.semiFinals[0].home) {
          this.bracket.semiFinals[0].home = winner;
        } else {
          this.bracket.semiFinals[1].home = winner;
        }
      }
    } else if (this.currentRound === 2) {
      const matchNode = this.bracket.semiFinals.find(m => m.home === homeId || m.away === homeId);
      if (matchNode) {
        matchNode.winner = winner;
        matchNode.score = `${homeGoals}-${awayGoals}`;
        
        if (!this.bracket.finals.home) {
          this.bracket.finals.home = winner;
        } else {
          this.bracket.finals.away = winner;
        }
      }
    } else if (this.currentRound === 3) {
      this.bracket.finals.winner = winner;
      this.bracket.finals.score = `${homeGoals}-${awayGoals}`;
      this.isCompleted = true;
    }
  }

  /**
   * Simulates non-player AI matches headlessly for other teams in Spira
   */
  simulateAIMatches(rngSeed = Date.now()) {
    const rng = createSeedableRNG(rngSeed);

    if (this.type === COMPETITION_TYPES.LEAGUE) {
      const unplayedTeams = this.teams.filter(id => id !== 'besaid_aurochs');
      
      for (let i = 0; i < unplayedTeams.length; i += 2) {
        if (i + 1 < unplayedTeams.length) {
          const home = unplayedTeams[i];
          const away = unplayedTeams[i + 1];
          const homeGoals = Math.floor(rng.nextFloat() * 4);
          const awayGoals = Math.floor(rng.nextFloat() * 4);

          this.recordMatchResult(home, away, homeGoals, awayGoals);
        }
      }
    }
  }

  /**
   * Sorts standings by points, goal difference, and total goals scored
   */
  getSortedStandings() {
    return Object.values(this.standings).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const diffA = a.goalsFor - a.goalsAgainst;
      const diffB = b.goalsFor - b.goalsAgainst;
      if (diffB !== diffA) return diffB - diffA;
      return b.goalsFor - a.goalsFor;
    });
  }
    }
