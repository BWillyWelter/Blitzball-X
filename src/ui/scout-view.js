/**
 * FFX Free Agent Scout & Contract Negotiation UI Overlay Component
 */

import { FREE_AGENTS, SCOUT_LEVELS } from '../game/scout.js';

export class ScoutViewUI {
  /**
   * @param {HTMLElement} container Parent DOM container
   */
  constructor(container) {
    this.container = container;
    this.overlayElement = null;
    this.scoutManager = null;
    this.selectedAgentId = 'p_brother';
    this.contractGames = 3; // Default contract offer length
    this.onContractSigned = null;

    this.initDOM();
  }

  initDOM() {
    this.overlayElement = document.createElement('div');
    this.overlayElement.id = 'ffx-scout-overlay';
    this.overlayElement.style.cssText = `
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(2, 132, 199, 0.90);
      backdrop-filter: blur(10px);
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
   * Opens the Scout & Contract Overlay
   * @param {Object} scoutManager Instance of ScoutManager from src/game/scout.js
   * @param {Function} [onContractSigned] Callback invoked when a player signs
   */
  open(scoutManager, onContractSigned) {
    this.scoutManager = scoutManager;
    this.onContractSigned = onContractSigned;
    this.overlayElement.style.display = 'block';
    this.render();
  }

  close() {
    this.overlayElement.style.display = 'none';
  }

  render() {
    if (!this.scoutManager) return;

    const currentGil = this.scoutManager.gil;
    const currentScoutLevel = this.scoutManager.scoutLevel;
    const nextLevelConfig = SCOUT_LEVELS[currentScoutLevel + 1];

    this.overlayElement.innerHTML = `
      <div style="max-width: 960px; margin: 0 auto; height: 100%; display: flex; flex-direction: column;">
        
        <!-- Header Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #38bdf8; padding-bottom: 12px; margin-bottom: 16px;">
          <div>
            <h2 style="margin: 0; font-size: 24px; color: #facc15; letter-spacing: 1px; text-shadow: 0 0 8px rgba(250, 204, 21, 0.5);">
              SPIRA PLAYER SCOUTING & CONTRACTS
            </h2>
            <div style="font-size: 13px; color: #e0f2fe; margin-top: 4px;">
              Scout Level: <span style="color: #38bdf8; font-weight: bold;">Level ${currentScoutLevel}</span>
            </div>
          </div>

          <div style="display: flex; gap: 16px; align-items: center;">
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid #facc15; border-radius: 6px; padding: 8px 16px; font-weight: bold; color: #facc15;">
              💰 ${currentGil.toLocaleString()} Gil
            </div>

            ${nextLevelConfig ? `
              <button id="btn-upgrade-scout" style="padding: 8px 16px; background: #0284c7; color: #ffffff; border: 1px solid #38bdf8; border-radius: 6px; font-weight: bold; cursor: pointer;">
                UPGRADE SCOUT (Lv ${currentScoutLevel + 1}:${nextLevelConfig.cost} Gil)
              </button>
            ` : '<span style="color: #10b981; font-size: 12px; font-weight: bold;">MAX SCOUT LEVEL</span>'}
          </div>
        </div>

        <!-- Main Body Grid: Free Agent List vs Selected Player Details -->
        <div style="flex: 1; display: grid; grid-template-columns: 320px 1fr; gap: 20px; overflow: hidden;">
          
          <!-- Free Agent Roster List -->
          <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 8px; overflow-y: auto; padding: 12px;">
            <div style="font-size: 12px; font-weight: bold; color: #38bdf8; margin-bottom: 10px; text-transform: uppercase;">
              Available Free Agents Across Spira
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${Object.keys(FREE_AGENTS).map(agentId => {
                const agent = FREE_AGENTS[agentId];
                const contract = this.scoutManager.agentContracts[agentId];
                const isSelected = agentId === this.selectedAgentId;
                const isSigned = contract.contractGames > 0;

                return `
                  <div class="agent-card" data-id="\${agent.id}" style="
                    padding: 10px;
                    border-radius: 6px;
                    border: 1px solid \${isSelected ? '#facc15' : 'rgba(56, 189, 248, 0.3)'};
                    background: \${isSelected ? 'rgba(56, 189, 248, 0.25)' : 'rgba(15, 23, 42, 0.4)'};
                    cursor: pointer;
                    transition: all 0.15s ease;
                  ">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div style="font-weight: bold; color: \${isSelected ? '#facc15' : '#ffffff'};">${agent.name} (${agent.pos})</div>
                      <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: \${isSigned ? '#059669' : '#0284c7'};">
                        \${isSigned ? `${contract.contractGames} Games` : 'Free Agent'}
                      </span>
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">📍 \${agent.location}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Selected Player Inspector & Contract Panel -->
          <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 8px; padding: 20px; display: flex; flex-direction: column; overflow-y: auto;">
            ${this.renderPlayerInspector()}
          </div>

        </div>

        <!-- Footer Control Bar -->
        <div style="border-top: 2px solid #38bdf8; padding-top: 14px; margin-top: 16px; display: flex; justify-content: flex-end;">
          <button id="btn-close-scout" style="padding: 10px 24px; background: rgba(15, 23, 42, 0.6); color: #94a3b8; border: 1px solid #475569; border-radius: 6px; font-weight: bold; cursor: pointer;">
            CLOSE SCOUT MENU
          </button>
        </div>

      </div>
    `;

    this.bindEvents();
  }

  /**
   * Renders details and negotiation pickers for selected agent
   */
  renderPlayerInspector() {
    const agent = this.scoutManager.scoutPlayer(this.selectedAgentId);
    if (!agent) return '<div style="color: #94a3b8;">Select a free agent to inspect stats.</div>';

    const level = this.scoutManager.scoutLevel;
    const contract = this.scoutManager.agentContracts[this.selectedAgentId];
    const totalCost = agent.salary * this.contractGames;
    const canAfford = this.scoutManager.gil >= totalCost;

    return `
      <div style="border-bottom: 1px solid rgba(56, 189, 248, 0.3); padding-bottom: 12px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h3 style="margin: 0; font-size: 22px; color: #facc15;">${agent.name}</h3>
            <div style="font-size: 13px; color: #38bdf8; margin-top: 2px;">Position: ${agent.pos} | Location: ${agent.location}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 16px; font-weight: bold; color: #facc15;">${agent.salary} Gil / Game</div>
            <div style="font-size: 12px; color: #94a3b8;">Base Salary</div>
          </div>
        </div>
      </div>

      <!-- Attributes Table (Masked by Scout Level) -->
      <div style="flex: 1; margin-bottom: 16px;">
        <div style="font-size: 13px; font-weight: bold; color: #38bdf8; margin-bottom: 8px;">PLAYER STAT ANALYSIS</div>
        
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px;">
          <div style="background: rgba(2, 132, 199, 0.3); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8;">HP</div>
            <div style="font-size: 16px; font-weight: bold; color: #ffffff;">${level >= 2 ? agent.hp : '???'}</div>
          </div>
          <div style="background: rgba(2, 132, 199, 0.3); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8;">EN</div>
            <div style="font-size: 16px; font-weight: bold; color: #ffffff;">${level >= 2 ? agent.en : '???'}</div>
          </div>
          <div style="background: rgba(2, 132, 199, 0.3); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8;">PAS</div>
            <div style="font-size: 16px; font-weight: bold; color: #ffffff;">${level >= 3 ? agent.pas : '???'}</div>
          </div>
          <div style="background: rgba(2, 132, 199, 0.3); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8;">SH</div>
            <div style="font-size: 16px; font-weight: bold; color: #ffffff;">${level >= 3 ? agent.sh : '???'}</div>
          </div>
          <div style="background: rgba(2, 132, 199, 0.3); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8;">TCK</div>
            <div style="font-size: 16px; font-weight: bold; color: #ffffff;">${level >= 3 ? agent.tck : '???'}</div>
          </div>
          <div style="background: rgba(2, 132, 199, 0.3); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8;">BLK</div>
            <div style="font-size: 16px; font-weight: bold; color: #ffffff;">${level >= 3 ? agent.blk : '???'}</div>
          </div>
          <div style="background: rgba(2, 132, 199, 0.3); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8;">CUT</div>
            <div style="font-size: 16px; font-weight: bold; color: #ffffff;">${level >= 3 ? agent.cut : '???'}</div>
          </div>
          <div style="background: rgba(2, 132, 199, 0.3); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8;">CAT</div>
            <div style="font-size: 16px; font-weight: bold; color: #ffffff;">${level >= 2 ? agent.cat : '???'}</div>
          </div>
        </div>

        <!-- Techniques Section -->
        <div style="font-size: 13px; font-weight: bold; color: #38bdf8; margin-bottom: 6px;">EQUIPPED TECHNIQUES</div>
        <div style="font-size: 12px; color: #e0f2fe; background: rgba(15, 23, 42, 0.4); padding: 8px; border-radius: 4px; margin-bottom: 12px;">
          ${level >= 4 ? (agent.techs?.join(', ') || 'None') : '🔒 Upgrade to Scout Level 4 to view Equipped Techs'}
        </div>

        <div style="font-size: 13px; font-weight: bold; color: #38bdf8; margin-bottom: 6px;">KEY TECHNIQUES (TECHCOPY SLOTS)</div>
        <div style="font-size: 12px; color: #e0f2fe; background: rgba(15, 23, 42, 0.4); padding: 8px; border-radius: 4px;">
          ${level >= 5 ? (agent.keyTechs?.join(', ') || 'None') : '🔒 Upgrade to Scout Level 5 to view Key Techs'}
        </div>
      </div>

      <!-- Contract Negotiation Control Box -->
      <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid #38bdf8; border-radius: 8px; padding: 14px;">
        <div style="font-size: 13px; font-weight: bold; color: #facc15; margin-bottom: 10px;">CONTRACT OFFER NEGOTIATION</div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <label style="font-size: 13px;">Contract Length (Games):</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button id="btn-contract-minus" style="width: 28px; height: 28px; background: #0284c7; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">-</button>
            <span id="contract-games-display" style="font-size: 16px; font-weight: bold; width: 32px; text-align: center;">${this.contractGames}</span>
            <button id="btn-contract-plus" style="width: 28px; height: 28px; background: #0284c7; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">+</button>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
          <div>
            <div style="font-size: 11px; color: #94a3b8;">Total Salary Cost</div>
            <div style="font-size: 18px; font-weight: bold; color: ${canAfford ? '#facc15' : '#f43f5e'};">${totalCost.toLocaleString()} Gil</div>
          </div>

          <button id="btn-sign-contract" style="
            padding: 10px 24px;
            background: ${canAfford ? '#f59e0b' : '#475569'};
            color: ${canAfford ? '#0f172a' : '#94a3b8'};
            border: none;
            border-radius: 6px;
            font-weight: bold;
            font-size: 15px;
            cursor: ${canAfford ? 'pointer' : 'not-allowed'};
            box-shadow: ${canAfford ? '0 0 12px rgba(245, 158, 11, 0.4)' : 'none'};
          " ${!canAfford ? 'disabled' : ''}>
            SIGN CONTRACT
          </button>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const el = this.overlayElement;

    // Agent Selection Cards
    el.querySelectorAll('.agent-card').forEach(card => {
      card.onclick = () => {
        this.selectedAgentId = card.getAttribute('data-id');
        this.render();
      };
    });

    // Upgrade Scout Level
    const btnUpgrade = el.querySelector('#btn-upgrade-scout');
    if (btnUpgrade) {
      btnUpgrade.onclick = () => {
        const res = this.scoutManager.upgradeScoutLevel();
        if (res.success) {
          this.render();
        } else {
          alert(res.message);
        }
      };
    }

    // Contract Length Adjustments
    const btnMinus = el.querySelector('#btn-contract-minus');
    if (btnMinus) {
      btnMinus.onclick = () => {
        this.contractGames = Math.max(1, this.contractGames - 1);
        this.render();
      };
    }

    const btnPlus = el.querySelector('#btn-contract-plus');
    if (btnPlus) {
      btnPlus.onclick = () => {
        this.contractGames = Math.min(99, this.contractGames + 1);
        this.render();
      };
    }

    // Sign Contract Action
    const btnSign = el.querySelector('#btn-sign-contract');
    if (btnSign) {
      btnSign.onclick = () => {
        const res = this.scoutManager.offerContract(this.selectedAgentId, this.contractGames, 'besaid_aurochs');
        if (res.success) {
          alert(res.message);
          this.render();
          if (this.onContractSigned) this.onContractSigned(this.selectedAgentId);
        } else {
          alert(res.message);
        }
      };
    }

    // Close Button
    const btnClose = el.querySelector('#btn-close-scout');
    if (btnClose) {
      btnClose.onclick = () => this.close();
    }
  }
                }
