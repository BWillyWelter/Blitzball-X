/**
 * FFX Pre-Match Technique Assignment & Key Tech Equipment UI
 * Handles player roster selection, tech slot capacity scaling,
 * HP cost readouts, and Key Tech slot progression.
 */

import { TECHNIQUES } from '../data/techniques.js';

export class TechViewUI {
  /**
   * @param {HTMLElement} container Parent DOM container
   */
  constructor(container) {
    this.container = container;
    this.overlayElement = null;
    this.activeTeam = null;
    this.selectedPlayer = null;
    this.onConfirmCallback = null;

    this.initDOM();
  }

  initDOM() {
    this.overlayElement = document.createElement('div');
    this.overlayElement.id = 'ffx-tech-view-overlay';
    this.overlayElement.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(2, 13, 31, 0.92);
      z-index: 300;
      backdrop-filter: blur(10px);
      font-family: 'Segoe UI', Roboto, sans-serif;
      color: #ffffff;
      box-sizing: border-box;
      padding: 24px;
      user-select: none;
    `;

    this.container.appendChild(this.overlayElement);
  }

  /**
   * Opens the Technique Assignment View for a given team roster
   * @param {Object} team Team object with roster players
   * @param {Function} [onConfirm] Callback when exiting pre-match setup
   */
  open(team, onConfirm = null) {
    this.activeTeam = team;
    this.onConfirmCallback = onConfirm;
    this.selectedPlayer = team?.players[0] || null;

    this.render();
    this.overlayElement.style.display = 'block';
  }

  /**
   * Renders main tech view layout (Roster Sidebar, Equipped Slots, Available Techs)
   */
  render() {
    if (!this.activeTeam) return;

    this.overlayElement.innerHTML = `
      <div style="max-width: 1100px; margin: 0 auto; height: 100%; display: flex; flex-direction: column;">
        
        <!-- Header Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #38bdf8; padding-bottom: 12px; margin-bottom: 20px;">
          <div>
            <h1 style="margin: 0; font-size: 26px; font-weight: 900; color: #facc15; letter-spacing: 1px;">
              ⚡ PRE-MATCH TECHNIQUE EQUIPMENT
            </h1>
            <div style="font-size: 13px; color: #94a3b8; margin-top: 4px;">
              Assign unlocked abilities to active player Tech Slots before kickoff.
            </div>
          </div>
          <button id="btn-close-tech-view" style="
            background: linear-gradient(135deg, #0284c7, #0369a1);
            border: 1px solid #38bdf8;
            color: #ffffff;
            font-weight: bold;
            padding: 10px 24px;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 0 12px rgba(56, 189, 248, 0.4);
          ">CONFIRM & READY</button>
        </div>

        <!-- Main 2-Column Split Layout -->
        <div style="display: flex; gap: 20px; flex: 1; min-height: 0;">
          
          <!-- Column 1: Team Roster Selector -->
          <div style="width: 300px; background: rgba(15, 23, 42, 0.8); border: 1px solid #1e293b; border-radius: 12px; padding: 16px; overflow-y: auto;">
            <div style="font-size: 14px; font-weight: bold; color: #38bdf8; margin-bottom: 12px; text-transform: uppercase;">
              ${this.activeTeam.name || 'Besaid Aurochs'} Roster
            </div>
            <div id="roster-list-container" style="display: flex; flex-direction: column; gap: 8px;"></div>
          </div>

          <!-- Column 2: Selected Player Tech Slots & Inventory -->
          <div style="flex: 1; background: rgba(15, 23, 42, 0.8); border: 1px solid #1e293b; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto;">
            
            <!-- Player Summary Header -->
            <div id="player-summary-header" style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; border-radius: 8px; padding: 14px; display: flex; justify-content: space-between; align-items: center;"></div>

            <!-- Equipped Tech Slots Section -->
            <div>
              <div style="font-size: 15px; font-weight: bold; color: #facc15; margin-bottom: 10px;">
                EQUIPPED TECH SLOTS
              </div>
              <div id="equipped-slots-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;"></div>
            </div>

            <!-- Available Techs Inventory -->
            <div>
              <div style="font-size: 15px; font-weight: bold; color: #38bdf8; margin-bottom: 10px;">
                UNLOCKED TECHNIQUE INVENTORY
              </div>
              <div id="available-techs-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;"></div>
            </div>

          </div>

        </div>

      </div>
    `;

    this.bindEvents();
    this.renderRoster();
    if (this.selectedPlayer) {
      this.selectPlayer(this.selectedPlayer);
    }
  }

  bindEvents() {
    const btnClose = this.overlayElement.querySelector('#btn-close-tech-view');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.close());
    }
  }

  /**
   * Renders player selection list in sidebar
   */
  renderRoster() {
    const container = this.overlayElement.querySelector('#roster-list-container');
    if (!container || !this.activeTeam) return;

    container.innerHTML = '';

    this.activeTeam.players.forEach(player => {
      const isSelected = this.selectedPlayer && this.selectedPlayer.id === player.id;
      const card = document.createElement('div');
      card.style.cssText = `
        padding: 12px;
        border-radius: 8px;
        background: ${isSelected ? 'linear-gradient(135deg, rgba(14, 165, 233, 0.3), rgba(3, 105, 161, 0.2))' : 'rgba(30, 41, 59, 0.5)'};
        border: 1px solid ${isSelected ? '#38bdf8' : '#334155'};
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        justify-content: space-between;
        align-items: center;
      `;

      card.innerHTML = `
        <div>
          <div style="font-weight: bold; font-size: 14px; color: ${isSelected ? '#facc15' : '#ffffff'};">${player.name}</div>
          <div style="font-size: 11px; color: #94a3b8;">${player.pos} | LVL ${player.level || 1}</div>
        </div>
        <div style="font-size: 11px; background: rgba(56, 189, 248, 0.2); padding: 3px 8px; border-radius: 4px; color: #38bdf8; font-weight: bold;">
          ${(player.equippedTechs || []).length} / ${this.getSlotCapacity(player)} SLOTS
        </div>
      `;

      card.addEventListener('click', () => this.selectPlayer(player));
      container.appendChild(card);
    });
  }

  /**
   * Calculates maximum equipped tech slots based on character level and Key Techs
   * @param {Object} player 
   * @returns {number}
   */
  getSlotCapacity(player) {
    const lvl = player.level || 1;
    let baseSlots = 1;
    if (lvl >= 3) baseSlots = 2;
    if (lvl >= 7) baseSlots = 3;
    if (lvl >= 12) baseSlots = 4;
    if (lvl >= 20) baseSlots = 5;

    // Bonus slot for learning Key Techniques
    const keyTechBonus = player.keyTechsLearned || 0;
    return Math.min(5, baseSlots + keyTechBonus);
  }

  /**
   * Selects an active player character for equipment modification
   * @param {Object} player 
   */
  selectPlayer(player) {
    this.selectedPlayer = player;
    this.renderRoster();

    // 1. Render Summary Header
    const summaryHeader = this.overlayElement.querySelector('#player-summary-header');
    if (summaryHeader) {
      summaryHeader.innerHTML = `
        <div>
          <span style="font-size: 18px; font-weight: 900; color: #facc15; margin-right: 12px;">${player.name}</span>
          <span style="font-size: 13px; color: #38bdf8; font-weight: bold;">POSITION: ${player.pos}</span>
        </div>
        <div style="display: flex; gap: 16px; font-size: 13px;">
          <div><span style="color: #94a3b8;">HP:</span> <strong>${player.hp || 150}</strong></div>
          <div><span style="color: #94a3b8;">SH:</span> <strong>${player.sh || 10}</strong></div>
          <div><span style="color: #94a3b8;">PAS:</span> <strong>${player.pas || 10}</strong></div>
          <div><span style="color: #94a3b8;">TCK:</span> <strong>${player.tck || 8}</strong></div>
          <div><span style="color: #94a3b8;">KEY TECHS:</span> <strong style="color: #10b981;">${player.keyTechsLearned || 0} / 3</strong></div>
        </div>
      `;
    }

    // 2. Render Equipped Slots & Inventory
    this.renderEquippedSlots(player);
    this.renderAvailableTechs(player);
  }

  /**
   * Renders the equipped tech slots for the selected player
   */
  renderEquippedSlots(player) {
    const container = this.overlayElement.querySelector('#equipped-slots-grid');
    if (!container) return;

    container.innerHTML = '';
    const capacity = this.getSlotCapacity(player);
    const equipped = player.equippedTechs || [];

    for (let i = 0; i < capacity; i++) {
      const techId = equipped[i];
      const tech = TECHNIQUES[techId];
      const slotCard = document.createElement('div');

      slotCard.style.cssText = `
        background: ${tech ? 'rgba(16, 185, 129, 0.15)' : 'rgba(30, 41, 59, 0.4)'};
        border: 1px ${tech ? 'solid #10b981' : 'dashed #475569'};
        border-radius: 8px;
        padding: 12px;
        min-height: 70px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      `;

      if (tech) {
        slotCard.innerHTML = `
          <div>
            <div style="font-size: 13px; font-weight: bold; color: #ffffff;">${tech.name}</div>
            <div style="font-size: 11px; color: #facc15; margin-top: 2px;">HP COST: ${tech.hpCost || 0}</div>
          </div>
          <button style="
            margin-top: 8px;
            background: rgba(244, 63, 94, 0.2);
            border: 1px solid #f43f5e;
            color: #f43f5e;
            font-size: 10px;
            font-weight: bold;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
          ">UNEQUIP</button>
        `;
        slotCard.querySelector('button').addEventListener('click', () => this.unequipTech(player, i));
      } else {
        slotCard.innerHTML = `
          <div style="font-size: 12px; color: #64748b; font-weight: bold; text-align: center; margin: auto;">
            [ EMPTY SLOT ${i + 1} ]
          </div>
        `;
      }

      container.appendChild(slotCard);
    }
  }

  /**
   * Renders available unlocked techniques for selected player
   */
  renderAvailableTechs(player) {
    const container = this.overlayElement.querySelector('#available-techs-grid');
    if (!container) return;

    container.innerHTML = '';
    const unlocked = player.unlockedTechs || player.techs || ['JECHT_SHOT', 'SPHERE_SHOT', 'VENOM_PASS'];
    const equipped = player.equippedTechs || [];

    unlocked.forEach(techId => {
      const tech = TECHNIQUES[techId];
      if (!tech) return;

      const isEquipped = equipped.includes(techId);
      const isKeyTech = (player.keyTechList || []).includes(techId);

      const techCard = document.createElement('div');
      techCard.style.cssText = `
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid ${isKeyTech ? '#facc15' : '#334155'};
        border-radius: 8px;
        padding: 12px;
        opacity: ${isEquipped ? '0.5' : '1.0'};
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      `;

      techCard.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 13px; font-weight: bold; color: #ffffff;">${tech.name}</span>
            ${isKeyTech ? '<span style="font-size: 10px; background: rgba(250, 204, 21, 0.2); color: #facc15; padding: 2px 6px; border-radius: 4px; font-weight: bold;">KEY TECH</span>' : ''}
          </div>
          <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">${tech.description || 'Enhances encounter actions.'}</div>
          <div style="font-size: 11px; color: #38bdf8; margin-top: 6px; font-weight: bold;">HP COST: ${tech.hpCost || 0}</div>
        </div>
        <button style="
          margin-top: 10px;
          background: ${isEquipped ? 'rgba(100, 116, 139, 0.3)' : 'linear-gradient(135deg, #10b981, #059669)'};
          border: 1px solid ${isEquipped ? '#64748b' : '#10b981'};
          color: #ffffff;
          font-size: 11px;
          font-weight: bold;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: ${isEquipped ? 'default' : 'pointer'};
        " ${isEquipped ? 'disabled' : ''}>${isEquipped ? 'EQUIPPED' : 'EQUIP TECH'}</button>
      `;

      if (!isEquipped) {
        techCard.querySelector('button').addEventListener('click', () => this.equipTech(player, techId));
      }

      container.appendChild(techCard);
    });
  }

  equipTech(player, techId) {
    if (!player.equippedTechs) player.equippedTechs = [];
    const capacity = this.getSlotCapacity(player);

    if (player.equippedTechs.length >= capacity) {
      alert(`All ${capacity} tech slots are currently full. Unequip a technique first!`);
      return;
    }

    player.equippedTechs.push(techId);
    this.selectPlayer(player);
  }

  unequipTech(player, slotIndex) {
    if (!player.equippedTechs) return;
    player.equippedTechs.splice(slotIndex, 1);
    this.selectPlayer(player);
  }

  close() {
    this.overlayElement.style.display = 'none';
    if (this.onConfirmCallback) {
      this.onConfirmCallback(this.activeTeam);
    }
  }
}
