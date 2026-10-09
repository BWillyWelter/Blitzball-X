/**
 * FFX Blitzball HUD & Sphere Pool 2D Radar
 */

export class FFXHUD {
  /**
   * @param {HTMLElement} container 
   */
  constructor(container) {
    this.container = container;
    this.buildDOM();
    this.radarCanvas = this.container.querySelector('#radar-canvas');
    this.radarCtx = this.radarCanvas.getContext('2d');
  }

  buildDOM() {
    this.container.innerHTML = `
      <div style="position: absolute; inset: 0; pointer-events: none; font-family: monospace; color: white;">
        
        <!-- Top Score Bar -->
        <div style="position: absolute; top: 12px; left: 50%; transform: translateX(-50%); background: rgba(2, 132, 199, 0.85); padding: 8px 24px; border-radius: 8px; border: 2px solid #38bdf8; display: flex; gap: 20px; font-weight: bold; font-size: 18px;">
          <span id="hud-home">BESAID AUROCHS: 0</span>
          <span id="hud-timer" style="color: #facc15;">05:00</span>
          <span id="hud-away">LUCA GOERS: 0</span>
        </div>

        <!-- FFX 2D Mini-Map Radar (Sphere Pool) -->
        <div style="position: absolute; bottom: 16px; left: 16px; width: 140px; height: 140px; background: rgba(15, 23, 42, 0.85); border-radius: 50%; border: 2px solid #38bdf8; overflow: hidden;">
          <canvas id="radar-canvas" width="140" height="140"></canvas>
        </div>

        <!-- FFX Encounter Command Window -->
        <div id="encounter-window" style="
          display: none;
          pointer-events: auto;
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(15, 23, 42, 0.95);
          border: 2px solid #38bdf8;
          border-radius: 12px;
          padding: 20px;
          width: 320px;
          box-shadow: 0 0 20px rgba(56, 189, 248, 0.4);
        ">
          <div style="text-align: center; color: #38bdf8; font-size: 18px; font-weight: bold; margin-bottom: 12px;">ENCOUNTER!</div>
          
          <div id="carrier-stats" style="font-size: 12px; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 8px;">
            <!-- Carrier EN / PAS / SH readouts -->
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button id="btn-breakthrough" style="padding: 10px; background: #0284c7; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">BREAKTHROUGH</button>
            <button id="btn-pass" style="padding: 10px; background: #0284c7; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">PASS</button>
            <button id="btn-shoot" style="padding: 10px; background: #f43f5e; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">SHOOT</button>
          </div>
        </div>

      </div>
    `;
  }

  /**
   * Renders 3D player positions onto the 2D sphere pool radar
   */
  drawRadar(match) {
    const ctx = this.radarCtx;
    ctx.clearRect(0, 0, 140, 140);

    const center = 70;
    const scale = 4.0; // Fit 15m radius sphere

    // Draw home players (Blue)
    match.homeTeam.players.forEach(p => {
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(center + p.position.x * scale, center + p.position.z * scale, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw away players (Red)
    match.awayTeam.players.forEach(p => {
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(center + p.position.x * scale, center + p.position.z * scale, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Ball (Yellow)
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(center + match.ball.position.x * scale, center + match.ball.position.z * scale, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  showEncounterMenu(carrier, defenders, onActionSelect) {
    const win = this.container.querySelector('#encounter-window');
    const statsDiv = this.container.querySelector('#carrier-stats');

    statsDiv.innerHTML = `
      <div><strong>${carrier.name}</strong> (HP: ${Math.round(carrier.currentHP)})</div>
      <div>EN: ${carrier.en} | PAS: ${carrier.pas} | SH: ${carrier.sh}</div>
      <div style="color: #f43f5e; margin-top: 4px;">Defenders: ${defenders.map(d => d.name + ' (TCK:' + d.tck + ')').join(', ')}</div>
    `;

    win.style.display = 'block';

    win.querySelector('#btn-breakthrough').onclick = () => {
      win.style.display = 'none';
      onActionSelect('BREAKTHROUGH', { chosenDefenders: defenders });
    };

    win.querySelector('#btn-shoot').onclick = () => {
      win.style.display = 'none';
      onActionSelect('SHOOT', { chosenDefenders: [] });
    };
  }
}
