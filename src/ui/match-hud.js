import { ARENA } from '../data/constants.js';

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function clockText(seconds) {
  const whole = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Modern scoreboard, player card, and pool radar for the native MatchSim. */
export class MatchHUD {
  constructor(container, audio = null) {
    this.container = container;
    this.audio = audio;
    this.sim = null;
    this.unsubscribers = [];
    this.lastScore = [0, 0];
    this.bannerTimer = 0;
    this.tickerTimer = 0;
    this.root = document.createElement('div');
    this.root.className = 'hud match-hud';
    this.root.innerHTML = `
      <div class="scoreboard" aria-label="Match score">
        <div class="sb-team home">
          <span class="sb-name">HOME</span><span class="sb-city">SPHERE POOL</span>
          <span class="sb-score">0</span>
          <div class="gb-meter"><div class="gb-fill"></div><span class="gb-label">GB</span></div>
        </div>
        <div class="sb-mid">
          <span class="sb-title">FIRST HALF</span>
          <span class="sb-clock">2:30</span>
          <span class="sb-clear">SHOT 24</span>
        </div>
        <div class="sb-team away">
          <span class="sb-name">AWAY</span><span class="sb-city">SPHERE POOL</span>
          <span class="sb-score">0</span>
          <div class="gb-meter"><div class="gb-fill"></div><span class="gb-label">GB</span></div>
        </div>
      </div>
      <div class="pcard" aria-label="Controlled swimmer">
        <div class="pcard-num">10</div>
        <div class="pcard-info">
          <div class="pcard-nick">ROOKIE</div>
          <div class="pcard-name">CONTROLLED SWIMMER</div>
          <div class="pcard-move">ALL-AROUND · SH</div>
          <div class="turbo"><div class="turbo-fill"></div><span>STAMINA 100%</span></div>
        </div>
      </div>
      <div class="hud-radar" role="img" aria-label="Live pool radar">
        <canvas width="180" height="180"></canvas>
        <span class="radar-label">POOL RADAR</span>
      </div>
      <div class="hint">WASD MOVE · SHIFT BURST · J / SPACE SHOOT · K PASS<br>L TACKLE · I HIT · U BREACH · Q SWAP · ESC PAUSE</div>
      <div class="popups" aria-live="polite"></div>
      <div class="banner" aria-live="assertive"><div class="banner-text"></div><div class="banner-sub"></div></div>
      <div class="ticker" role="status"><span class="ticker-mic">◉</span><span class="ticker-text"></span></div>
    `;
    container.appendChild(this.root);
    this.scoreEls = [...this.root.querySelectorAll('.sb-score')];
    this.teamEls = [...this.root.querySelectorAll('.sb-team')];
    this.gbEls = [...this.root.querySelectorAll('.gb-meter')];
    this.gbFills = [...this.root.querySelectorAll('.gb-fill')];
    this.radarCanvas = this.root.querySelector('.hud-radar canvas');
    this.radarCtx = this.radarCanvas.getContext('2d');
    this.bannerEl = this.root.querySelector('.banner');
    this.bannerText = this.root.querySelector('.banner-text');
    this.bannerSub = this.root.querySelector('.banner-sub');
    this.tickerEl = this.root.querySelector('.ticker');
    this.tickerText = this.root.querySelector('.ticker-text');
    this.cardEl = this.root.querySelector('.pcard');
    this.cardNumber = this.root.querySelector('.pcard-num');
    this.cardNick = this.root.querySelector('.pcard-nick');
    this.cardName = this.root.querySelector('.pcard-name');
    this.cardMove = this.root.querySelector('.pcard-move');
    this.turboEl = this.root.querySelector('.turbo');
    this.turboFill = this.root.querySelector('.turbo-fill');
    this.turboLabel = this.root.querySelector('.turbo span');
    this.centerTitle = this.root.querySelector('.sb-title');
    this.centerClock = this.root.querySelector('.sb-clock');
    this.shotClock = this.root.querySelector('.sb-clear');
    this.lastScore = [0, 0];
  }

  attach(sim) {
    this.detach();
    this.sim = sim;
    if (!sim) return;
    const [home, away] = sim.teams;
    this.root.style.setProperty('--home', home.primary);
    this.root.style.setProperty('--away', away.primary);
    this.root.style.setProperty('--home-accent', home.accent);
    this.root.style.setProperty('--away-accent', away.accent);
    this.teamEls.forEach((el, i) => {
      el.querySelector('.sb-name').textContent = sim.teams[i].abbr;
      el.querySelector('.sb-city').textContent = `${sim.teams[i].city} ${sim.teams[i].name}`.toUpperCase();
      el.setAttribute('aria-label', `${sim.teams[i].city} ${sim.teams[i].name}`);
    });
    this.lastScore = [...sim.score];
    this.listen('score', (event) => this.onScore(event));
    this.listen('style', ({ label, player, points, big, team }) => {
      if (!label || (player?.team !== sim.userTeam && sim.userTeam !== null)) return;
      this.popup(label, big ? 'big' : '', team);
      if (points >= 100) this.showTicker(`${player?.data?.nick || 'SWIMMER'} · ${label}`, 1600);
    });
    this.listen('warmup', () => this.showBanner('DIVE IN', 'WARM-UP LAPS · GET A FEEL FOR THE POOL', 1700));
    this.listen('tipoff', () => this.showBanner('TIP-OFF', 'WIN THE FIRST TOUCH', 1400));
    this.listen('whistle', () => this.audio?.playRefWhistle?.());
    this.listen('live', ({ half, tipoff }) => {
      if (half === 2) this.showBanner('SECOND HALF', 'SWITCH SIDES · FINISH THE JOB', 1600);
      else if (tipoff) this.showBanner('PLAY BALL', 'TAKE THE SPACE · FIND THE RINGS', 900);
    });
    this.listen('halftime', () => {
      this.audio?.playRefWhistle?.();
      this.showBanner('HALF TIME', 'RESET · THE NEXT HALF STARTS AT CENTRE', 2300);
    });
    this.listen('overtime', () => {
      this.audio?.playRefWhistle?.();
      this.showBanner('OVERTIME', 'GOLDEN GOAL · NEXT SCORE WINS', 2800, 'huge');
    });
    this.listen('gameover', ({ winner }) => {
      this.audio?.playRefWhistle?.();
      this.showBanner(winner === sim.userTeam ? 'POOL’S YOURS' : 'FULL TIME', 'FINAL WHISTLE', 1800);
    });
    this.listen('gbready', ({ team }) => {
      if (team === sim.userTeam) {
        this.audio?.playCrowdCheer?.(0.6);
        this.showBanner('GAMEBREAKER READY', 'HOLD SHOOT · RELEASE TO BREAK THROUGH', 2200);
      } else this.showTicker(`${sim.teams[team].abbr} GAMEBREAKER READY`, 1900);
    });
    this.listen('flowstart', ({ team }) => {
      this.showBanner(team === sim.userTeam ? 'FLOW STATE' : 'THEY’RE IN FLOW', 'THE POOL IS MOVING THEIR WAY', 1700);
    });
    this.listen('bighit', ({ player, victim }) => {
      this.audio?.playWaterSplash?.(0.72);
      this.showTicker(`${player?.data?.nick || 'SWIMMER'} ROCKS ${victim?.data?.nick || 'THE CARRIER'}`, 1450);
    });
    this.listen('tackle', () => this.audio?.playWaterSplash?.(0.38));
    this.listen('save', ({ keeper }) => {
      this.audio?.playWaterSplash?.(0.55);
      this.showTicker(`${keeper?.data?.nick || 'KEEPER'} SHUTS THE WINDOW`, 1350);
    });
    this.listen('turnover', ({ team }) => {
      if (team === sim.userTeam) this.showTicker('BALL BACK · PUSH THE BREAK', 1200);
    });
    this.update(sim);
  }

  listen(type, handler) {
    const off = this.sim?.events?.on(type, handler);
    if (off) this.unsubscribers.push(off);
  }

  detach() {
    for (const off of this.unsubscribers) off?.();
    this.unsubscribers.length = 0;
    this.sim = null;
  }

  onScore({ team, player, points, gb, ownGoal }) {
    this.audio?.playGoalBuzzer?.(gb ? 1.5 : 1.0);
    if (gb) this.audio?.playCrowdFanfare?.();
    else this.audio?.playCrowdCheer?.(0.75);
    this.popup(`+${points}`, 'big', team);
    this.showBanner(gb ? 'GAMEBREAKER' : ownGoal ? 'OWN GOAL' : 'RING SHOT', `${player?.data?.nick || 'SWIMMER'} · +${points} ${points === 1 ? 'POINT' : 'POINTS'}`, 1950, gb ? 'huge' : '');
    this.scoreEls[team]?.classList.remove('pulse');
    // Force a reflow so a second score by the same side restarts the impact animation.
    void this.scoreEls[team]?.offsetWidth;
    this.scoreEls[team]?.classList.add('pulse');
  }

  showBanner(title, subtitle = '', duration = 1600, extraClass = '') {
    this.bannerText.textContent = title;
    this.bannerSub.textContent = subtitle;
    this.bannerEl.className = `banner show ${extraClass}`.trim();
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.bannerEl.classList.remove('show'), duration);
  }

  showTicker(message, duration = 1800) {
    this.tickerText.textContent = message;
    this.tickerEl.classList.add('show');
    clearTimeout(this.tickerTimer);
    this.tickerTimer = setTimeout(() => this.tickerEl.classList.remove('show'), duration);
  }

  popup(text, extraClass = '', team = null) {
    const el = document.createElement('div');
    el.className = `popup ${extraClass} ${team === 0 ? 't0' : team === 1 ? 't1' : ''}`.trim();
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 28}px`);
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 8}deg`);
    el.textContent = text;
    this.root.querySelector('.popups').appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  update(sim = this.sim) {
    if (!sim) return;
    for (let i = 0; i < 2; i++) {
      const score = sim.score[i] || 0;
      this.scoreEls[i].textContent = String(score);
      const max = Math.max(1, sim.rules?.gamebreakerMeterMax || 6800);
      const pct = clamp((sim.gb[i] / max) * 100, 0, 100);
      this.gbFills[i].style.width = `${pct}%`;
      this.gbEls[i].classList.toggle('ready', !!sim.gbReady[i]);
    }
    this.lastScore = [...sim.score];

    let label = sim.half === 2 ? 'SECOND HALF' : 'FIRST HALF';
    if (sim.overtime) label = 'OVERTIME';
    if (sim.state === 'warmup') label = 'WARM-UP';
    else if (sim.state === 'tipoff') label = 'TIP-OFF';
    else if (sim.state === 'halftime') label = 'HALF TIME';
    else if (sim.state === 'over') label = 'FINAL';
    this.centerTitle.textContent = label;
    const shownTime = sim.overtime ? sim.otTime : sim.clock;
    this.centerClock.textContent = sim.state === 'halftime' ? 'BREAK' : sim.state === 'over' ? 'FINAL' : clockText(shownTime);
    this.centerClock.classList.toggle('urgent', !sim.overtime && sim.state === 'live' && sim.clock <= 15);
    const possessionTime = Number.isFinite(sim.shotClock) ? sim.shotClock : sim.possessionClock;
    this.shotClock.textContent = `SHOT ${Math.max(0, Math.ceil(possessionTime || 0))}`;
    this.shotClock.classList.toggle('show', sim.state === 'live' && possessionTime <= 5);

    const player = sim.controlled;
    this.cardEl.hidden = !player || sim.userTeam === null;
    if (player && sim.userTeam !== null) {
      this.cardNumber.textContent = String(player.data.number ?? '—');
      this.cardNick.textContent = player.data.nick || player.data.name || 'SWIMMER';
      this.cardName.textContent = player.data.name || '';
      this.cardMove.textContent = `${player.data.archetype || 'ALL-AROUND'} · ${player.role || player.data.role || 'FD'}`.toUpperCase();
      this.cardEl.style.setProperty('--c1', sim.teams[player.team].primary);
      const stamina = clamp(Number(player.stamina) || 0, 0, 100);
      this.turboFill.style.width = `${stamina}%`;
      this.turboLabel.textContent = `${player.gassed ? 'GASSED' : 'STAMINA'} ${Math.round(stamina)}%`;
      this.turboEl.classList.toggle('low', stamina < 25);
    }
    this.drawRadar(sim);
  }

  drawRadar(sim) {
    const ctx = this.radarCtx;
    const size = this.radarCanvas.width;
    const center = size / 2;
    const radius = size * 0.415;
    const scale = radius / ARENA.fieldRadius;
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.translate(center, center);
    ctx.fillStyle = 'rgba(3, 25, 39, 0.94)';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(145, 241, 255, 0.76)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(166, 220, 229, 0.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, radius);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(166, 220, 229, 0.4)';
    ctx.beginPath();
    ctx.arc(0, 0, ARENA.centerCircle * scale, 0, Math.PI * 2);
    ctx.stroke();

    for (const player of sim.players) {
      const x = clamp(player.pos.x * scale, -radius + 3, radius - 3);
      const y = clamp(player.pos.z * scale, -radius + 3, radius - 3);
      ctx.beginPath();
      ctx.fillStyle = sim.teams[player.team].primary;
      ctx.arc(x, y, player.controlled ? 5.4 : player.isKeeper ? 4.1 : 3.6, 0, Math.PI * 2);
      ctx.fill();
      if (player.controlled) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      if (sim.ball.holder === player) {
        ctx.beginPath();
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 1.5;
        ctx.arc(x, y, 7.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    const bx = clamp(sim.ball.pos.x * scale, -radius + 3, radius - 3);
    const by = clamp(sim.ball.pos.z * scale, -radius + 3, radius - 3);
    ctx.fillStyle = '#ffbd3c';
    ctx.shadowColor = '#ffc746';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(bx, by, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  dispose() {
    this.detach();
    clearTimeout(this.bannerTimer);
    clearTimeout(this.tickerTimer);
    this.root.remove();
  }
}
