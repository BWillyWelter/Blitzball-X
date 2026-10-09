/**
 * Mobile-Adapted HUD Module for Blitzball-X
 */

export class HUD {
  /**
   * @param {HTMLElement} containerElement
   */
  constructor(containerElement) {
    this.container = containerElement;
    this.elements = {};
    this.buildDOM();
  }

  buildDOM() {
    this.container.innerHTML = `
      <div class="hud-overlay" style="
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        pointer-events: none;
        padding: env(safe-area-inset-top, 12px) env(safe-area-inset-right, 16px) env(safe-area-inset-bottom, 12px) env(safe-area-inset-left, 16px);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        font-family: system-ui, -apple-system, sans-serif;
        color: #ffffff;
        user-select: none;
      ">
        <!-- Top Scoreboard Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(8px); padding: 8px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span id="hud-home-name" style="font-weight: 700; text-transform: uppercase; font-size: 14px;">HOME</span>
            <span id="hud-home-score" style="font-size: 22px; font-weight: 900; color: #38bdf8;">0</span>
          </div>
          
          <div style="text-align: center;">
            <div id="hud-timer" style="font-size: 18px; font-weight: 800; letter-spacing: 1px; color: #facc15;">01:00</div>
            <div id="hud-period" style="font-size: 10px; opacity: 0.8; text-transform: uppercase;">PERIOD 1</div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <span id="hud-away-score" style="font-size: 22px; font-weight: 900; color: #f43f5e;">0</span>
            <span id="hud-away-name" style="font-weight: 700; text-transform: uppercase; font-size: 14px;">AWAY</span>
          </div>
        </div>

        <!-- Center Notification Toast -->
        <div id="hud-banner" style="
          align-self: center;
          font-size: 28px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 2px;
          color: #ffffff;
          text-shadow: 0 4px 12px rgba(0,0,0,0.6);
          opacity: 0;
          transform: scale(0.8);
          transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease;
        ">GOAL!</div>

        <!-- Bottom Controls & Stamina Indicator -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; width: 100%;">
          <!-- Active Player Stamina -->
          <div style="width: 140px; background: rgba(15, 23, 42, 0.7); padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="font-size: 10px; font-weight: 700; margin-bottom: 4px; display: flex; justify-content: space-between;">
              <span>STAMINA</span>
              <span id="hud-stamina-val">100%</span>
            </div>
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden;">
              <div id="hud-stamina-bar" style="width: 100%; height: 100%; background: #22c55e; transition: width 0.1s linear, background-color 0.2s;"></div>
            </div>
          </div>

          <!-- Touch Action Buttons Container for Mobile Overlay -->
          <div id="hud-touch-controls" style="pointer-events: auto; display: flex; gap: 12px;">
            <button id="btn-action-pass" style="width: 56px; height: 56px; border-radius: 50%; background: rgba(56, 189, 248, 0.8); border: 2px solid #ffffff; color: white; font-weight: 800; font-size: 12px; active: scale(0.95);">PASS</button>
            <button id="btn-action-shoot" style="width: 64px; height: 64px; border-radius: 50%; background: rgba(244, 63, 94, 0.85); border: 2px solid #ffffff; color: white; font-weight: 900; font-size: 14px; active: scale(0.95);">SHOOT</button>
          </div>
        </div>
      </div>
    `;

    this.elements = {
      homeName: this.container.querySelector('#hud-home-name'),
      awayName: this.container.querySelector('#hud-away-name'),
      homeScore: this.container.querySelector('#hud-home-score'),
      awayScore: this.container.querySelector('#hud-away-score'),
      timer: this.container.querySelector('#hud-timer'),
      period: this.container.querySelector('#hud-period'),
      banner: this.container.querySelector('#hud-banner'),
      staminaBar: this.container.querySelector('#hud-stamina-bar'),
      staminaVal: this.container.querySelector('#hud-stamina-val'),
      btnPass: this.container.querySelector('#btn-action-pass'),
      btnShoot: this.container.querySelector('#btn-action-shoot')
    };
  }

  /**
   * Updates state variables on the display
   * @param {Object} state 
   */
  update(state) {
    if (state.homeScore !== undefined) this.elements.homeScore.textContent = state.homeScore;
    if (state.awayScore !== undefined) this.elements.awayScore.textContent = state.awayScore;
    if (state.homeName) this.elements.homeName.textContent = state.homeName;
    if (state.awayName) this.elements.awayName.textContent = state.awayName;

    if (state.secondsRemaining !== undefined) {
      const mins = Math.floor(state.secondsRemaining / 60);
      const secs = Math.floor(state.secondsRemaining % 60);
      this.elements.timer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    if (state.stamina !== undefined) {
      const pct = Math.max(0, Math.min(100, state.stamina));
      this.elements.staminaBar.style.width = `${pct}%`;
      this.elements.staminaVal.textContent = `${Math.round(pct)}%`;
      this.elements.staminaBar.style.backgroundColor = pct > 50 ? '#22c55e' : pct > 20 ? '#eab308' : '#ef4444';
    }
  }

  /**
   * Triggers timed center screen banner text
   * @param {string} text 
   * @param {number} [duration=1500] 
   */
  showBanner(text, duration = 1500) {
    this.elements.banner.textContent = text;
    this.elements.banner.style.opacity = '1';
    this.elements.banner.style.transform = 'scale(1)';

    setTimeout(() => {
      this.elements.banner.style.opacity = '0';
      this.elements.banner.style.transform = 'scale(0.8)';
    }, duration);
  }
}
