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
      <div class="hud-frame">
        
        <!-- Top Score Bar -->
        <div class="hud-scorebar">
          <span id="hud-home">BESAID AUROCHS: 0</span>
          <span id="hud-timer" style="color: #facc15;">05:00</span>
          <span id="hud-away">LUCA GOERS: 0</span>
        </div>

        <!-- FFX 2D Mini-Map Radar (Sphere Pool) -->
        <div class="hud-radar">
          <canvas id="radar-canvas" width="140" height="140"></canvas>
        </div>

        <!-- FFX Encounter Command Window -->
        <div id="encounter-window" class="encounter-window">
          <div class="encounter-title">ENCOUNTER!</div>
          
          <div id="carrier-stats" class="encounter-stats">
            <!-- Carrier EN / PAS / SH readouts -->
          </div>

          <div class="encounter-actions">
            <button id="btn-breakthrough">BREAKTHROUGH</button>
            <button id="btn-shoot">SHOOT</button>
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
