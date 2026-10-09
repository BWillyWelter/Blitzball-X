/**
 * FFX League Standings, Tournament Brackets & Prize Overlay UI
 */

import { COMPETITION_TYPES } from '../game/league.js';
import { TEAMS } from '../data/teams.js';

export class LeagueViewUI {
  /**
   * @param {HTMLElement} container Parent DOM element
   */
  constructor(container) {
    this.container = container;
    this.overlayElement = null;
    this.activeTab = 'STANDINGS'; // 'STANDINGS' | 'BRACKET' | 'PRIZES'
    this.leagueManager = null;
    
    this.initDOM();
  }

  initDOM() {
    this.overlayElement = document.createElement('div');
    this.overlayElement.id = 'ffx-league-overlay';
    this.overlayElement.style.cssText = `
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(2, 132, 199, 0.88);
      backdrop-filter: blur(8px);
      z-index: 100;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: #ffffff;
      padding: 24px;
      box-sizing: border-box;
      pointer-events: auto;
    `;

    this.container.appendChild(this.overlayElement);
  }

  /**
   * Opens the League/Tournament Overlay
   * @param {Object} leagueManager Instance of LeagueManager from src/game/league.js
   * @param {Function} onStartMatch Callback when player confirms next scheduled match
   */
  open(leagueManager, onStartMatch) {
    this.leagueManager = leagueManager;
    this.onStartMatch = onStartMatch;
    this.overlayElement.style.display = 'block';
    this.render();
  }

  close() {
    this.overlayElement.style.display = 'none';
  }

  render() {
    if (!this.leagueManager) return;

    const isTournament = this.leagueManager.type === COMPETITION_TYPES.TOURNAMENT;

    this.overlayElement.innerHTML = `
      <div style="max-width: 900px; margin: 0 auto; height: 100%; display: flex; flex-direction: column;">
        
        <!-- Header & Nav Tabs -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #38bdf8; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="margin: 0; font-size: 24px; letter-spacing: 1px; color: #facc15; text-shadow: 0 0 8px rgba(250, 204, 21, 0.5);">
            ${isTournament ? 'SPIRA TOURNAMENT BRACKET' : 'SPIRA BLITZBALL LEAGUE'}
          </h2>
          
          <div style="display: flex; gap: 8px;">
            <button id="tab-standings" style="${this.getTabStyle('STANDINGS')}">STANDINGS</button>
            ${isTournament ? `<button id="tab-bracket" style="\${this.getTabStyle('BRACKET')}">BRACKET</button>` : ''}
            <button id="tab-prizes" style="${this.getTabStyle('PRIZES')}">PRIZES</button>
          </div>
        </div>

        <!-- Dynamic Content Body -->
        <div id="league-view-body" style="flex: 1; overflow-y: auto; padding-right: 8px;">
          ${this.renderActiveTabContent()}
        </div>

        <!-- Footer Control Bar -->
        <div style="border-top: 2px solid #38bdf8; padding-top: 16px; margin-top: 16px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 14px; color: #e0f2fe;">
            Round ${this.leagueManager.currentRound} of ${this.leagueManager.maxRounds}
          </div>
          
          <div style="display: flex; gap: 12px;">
            <button id="btn-close-league" style="padding: 10px 20px; background: rgba(15, 23, 42, 0.6); color: #94a3b8; border: 1px solid #475569; border-radius: 6px; font-weight: bold; cursor: pointer;">
              BACK TO MENU
            </button>
            <button id="btn-play-next" style="padding: 10px 28px; background: #f59e0b; color: #0f172a; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; box-shadow: 0 0 12px rgba(245, 158, 11, 0.4);">
              PLAY NEXT MATCH
            </button>
          </div>
        </div>

      </div>
    `;

    this.bindEvents();
  }

  getTabStyle(tabName) {
    const isActive = this.activeTab === tabName;
    return `
      padding: 8px 16px;
      background: ${isActive ? '#38bdf8' : 'rgba(15, 23, 42, 0.5)'};
      color: ${isActive ? '#0f172a' : '#e0f2fe'};
      border: 1px solid #38bdf8;
      border-radius: 6px;
      font-weight: bold;
      cursor: pointer;
    `;
  }

  renderActiveTabContent() {
    if (this.activeTab === 'STANDINGS') {
      return this.renderStandingsTable();
    } else if (this.activeTab === 'BRACKET') {
      return this.renderTournamentBracket();
    } else if (this.activeTab === 'PRIZES') {
      return this.renderPrizesList();
    }
    return '';
  }

  /**
   * Renders round-robin league standings table
   */
  renderStandingsTable() {
    const sorted = this.leagueManager.getSortedStandings();

    return `
      <table style="width: 100%; border-collapse: collapse; text-align: left; background: rgba(15, 23, 42, 0.4); border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background: rgba(2, 132, 199, 0.6); color: #facc15; font-size: 14px;">
            <th style="padding: 12px;">POS</th>
            <th style="padding: 12px;">TEAM</th>
            <th style="padding: 12px; text-align: center;">P</th>
            <th style="padding: 12px; text-align: center;">W</th>
            <th style="padding: 12px; text-align: center;">D</th>
            <th style="padding: 12px; text-align: center;">L</th>
            <th style="padding: 12px; text-align: center;">GF</th>
            <th style="padding: 12px; text-align: center;">GA</th>
            <th style="padding: 12px; text-align: center;">PTS</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((team, idx) => `
            <tr style="border-bottom: 1px solid rgba(56, 189, 248, 0.2); background: \${team.teamId === 'besaid_aurochs' ? 'rgba(56, 189, 248, 0.25)' : 'transparent'};">
              <td style="padding: 12px; font-weight: bold;">\${idx + 1}</td>
              <td style="padding: 12px; font-weight: bold; color: ${team.teamId === 'besaid_aurochs' ? '#38bdf8' : '#ffffff'};">${team.name}</td>
              <td style="padding: 12px; text-align: center;">\${team.played}</td>
              <td style="padding: 12px; text-align: center;">\${team.wins}</td>
              <td style="padding: 12px; text-align: center;">\${team.draws}</td>
              <td style="padding: 12px; text-align: center;">\${team.losses}</td>
              <td style="padding: 12px; text-align: center;">\${team.goalsFor}</td>
              <td style="padding: 12px; text-align: center;">\${team.goalsAgainst}</td>
              <td style="padding: 12px; text-align: center; font-weight: bold; color: #facc15;">\${team.points}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  /**
   * Renders 3-Round Tournament Knockout Bracket Tree
   */
  renderTournamentBracket() {
    const b = this.leagueManager.bracket;

    const getTeamName = (id) => id ? (TEAMS[id]?.name || id) : 'TBD';

    return `
      <div style="display: flex; justify-content: space-around; align-items: center; height: 100%; padding: 20px 0;">
        
        <!-- Round 1 -->
        <div style="display: flex; flex-direction: column; gap: 40px;">
          <div style="text-align: center; font-size: 12px; color: #38bdf8; font-weight: bold; margin-bottom: 8px;">ROUND 1</div>
          ${b.round1.map(m => `
            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid #38bdf8; border-radius: 6px; padding: 10px; width: 180px;">
              <div style="color: ${m.winner === m.home ? '#facc15' : '#ffffff'}">${getTeamName(m.home)}</div>
              <div style="color: ${m.winner === m.away ? '#facc15' : '#ffffff'}">${getTeamName(m.away)}</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 4px; text-align: right;">\${m.score || 'VS'}</div>
            </div>
          `).join('')}
        </div>

        <!-- Semifinals -->
        <div style="display: flex; flex-direction: column; gap: 60px;">
          <div style="text-align: center; font-size: 12px; color: #38bdf8; font-weight: bold; margin-bottom: 8px;">SEMIFINALS</div>
          ${b.semiFinals.map(m => `
            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid #38bdf8; border-radius: 6px; padding: 10px; width: 180px;">
              <div style="color: ${m.winner === m.home ? '#facc15' : '#ffffff'}">${getTeamName(m.home)}</div>
              <div style="color: ${m.winner === m.away ? '#facc15' : '#ffffff'}">${getTeamName(m.away)}</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 4px; text-align: right;">\${m.score || 'VS'}</div>
            </div>
          `).join('')}
        </div>

        <!-- Finals -->
        <div style="display: flex; flex-direction: column; align-items: center;">
          <div style="text-align: center; font-size: 12px; color: #facc15; font-weight: bold; margin-bottom: 8px;">CHAMPIONSHIP</div>
          <div style="background: rgba(15, 23, 42, 0.9); border: 2px solid #facc15; border-radius: 8px; padding: 14px; width: 200px; box-shadow: 0 0 16px rgba(250, 204, 21, 0.3);">
            <div style="color: ${b.finals.winner === b.finals.home ? '#facc15' : '#ffffff'}; font-weight: bold;">${getTeamName(b.finals.home)}</div>
            <div style="color: ${b.finals.winner === b.finals.away ? '#facc15' : '#ffffff'}; font-weight: bold;">${getTeamName(b.finals.away)}</div>
            <div style="font-size: 12px; color: #facc15; margin-top: 6px; text-align: right; font-weight: bold;">${b.finals.score || 'FINAL'}</div>
          </div>
        </div>

      </div>
    `;
  }

  /**
   * Renders Spira League/Tournament Prizes Showcase
   */
  renderPrizesList() {
    const p = this.leagueManager.prizes;

    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 10px 0;">
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid #facc15; border-radius: 8px; padding: 16px;">
          <div style="color: #facc15; font-weight: bold; font-size: 16px;">🥇 1st Place Prize</div>
          <div style="font-size: 18px; font-weight: bold; margin-top: 8px;">${p.firstPlace.name}</div>
          <div style="color: #e0f2fe; font-size: 13px; margin-top: 4px;">Bonus: +${p.firstPlace.gil} Gil</div>
        </div>

        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid #94a3b8; border-radius: 8px; padding: 16px;">
          <div style="color: #94a3b8; font-weight: bold; font-size: 16px;">🥈 2nd Place Prize</div>
          <div style="font-size: 18px; font-weight: bold; margin-top: 8px;">${p.secondPlace.name}</div>
          <div style="color: #e0f2fe; font-size: 13px; margin-top: 4px;">Bonus: +${p.secondPlace.gil} Gil</div>
        </div>

        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid #b45309; border-radius: 8px; padding: 16px;">
          <div style="color: #b45309; font-weight: bold; font-size: 16px;">🥉 3rd Place Prize</div>
          <div style="font-size: 18px; font-weight: bold; margin-top: 8px;">${p.thirdPlace.name}</div>
        </div>

        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid #38bdf8; border-radius: 8px; padding: 16px;">
          <div style="color: #38bdf8; font-weight: bold; font-size: 16px;">⚽ Top Scorer Award</div>
          <div style="font-size: 18px; font-weight: bold; margin-top: 8px;">${p.topScorer.name}</div>
          <div style="color: #e0f2fe; font-size: 13px; margin-top: 4px;">Bonus: +${p.topScorer.gil} Gil</div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const body = this.overlayElement;

    // Nav Tabs
    const btnStandings = body.querySelector('#tab-standings');
    if (btnStandings) {
      btnStandings.onclick = () => {
        this.activeTab = 'STANDINGS';
        this.render();
      };
    }

    const btnBracket = body.querySelector('#tab-bracket');
    if (btnBracket) {
      btnBracket.onclick = () => {
        this.activeTab = 'BRACKET';
        this.render();
      };
    }

    const btnPrizes = body.querySelector('#tab-prizes');
    if (btnPrizes) {
      btnPrizes.onclick = () => {
        this.activeTab = 'PRIZES';
        this.render();
      };
    }

    // Action buttons
    const btnClose = body.querySelector('#btn-close-league');
    if (btnClose) {
      btnClose.onclick = () => this.close();
    }

    const btnPlay = body.querySelector('#btn-play-next');
    if (btnPlay) {
      btnPlay.onclick = () => {
        this.close();
        if (this.onStartMatch) this.onStartMatch();
      };
    }
  }
  }
