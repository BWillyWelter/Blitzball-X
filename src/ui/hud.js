import { RULES, ARENA, MOVE } from '../data/constants.js';
import { moveFor } from '../game/moves.js';

/**
 * Compact HUD override. Injected once as a scoped <style>; !important guarantees it wins over
 * the external stylesheet's selectors regardless of source order. Only sizes shrink — colors,
 * positioning and layout structure from the base CSS are left alone.
 */
const HUD_CSS = `
.hud-compact .scoreboard {
  gap: 8px !important;
}
.hud-compact .sb-team {
  padding: 4px 10px !important;
  gap: 3px !important;
}
.hud-compact .sb-name {
  font-size: 10px !important;
  letter-spacing: 0.5px !important;
}
.hud-compact .sb-score {
  font-size: 20px !important;
  line-height: 1 !important;
}
.hud-compact .gb-meter {
  height: 4px !important;
  width: 54px !important;
}
.hud-compact .gb-label {
  font-size: 8px !important;
}
.hud-compact .sb-mid {
  gap: 2px !important;
}
.hud-compact .sb-title {
  font-size: 9px !important;
}
.hud-compact .sb-clock {
  font-size: 16px !important;
  line-height: 1.1 !important;
}
.hud-compact .sb-pclock {
  font-size: 10px !important;
}
.hud-compact .sb-clear {
  font-size: 9px !important;
  padding: 2px 6px !important;
}
.hud-compact .pcard {
  padding: 5px 10px !important;
  gap: 8px !important;
}
.hud-compact .pcard-num {
  font-size: 16px !important;
  line-height: 1 !important;
}
.hud-compact .pcard-nick {
  font-size: 12px !important;
}
.hud-compact .pcard-name {
  font-size: 9px !important;
}
.hud-compact .turbo {
  height: 4px !important;
}
.hud-compact .turbo span {
  font-size: 7px !important;
}
/* Stamina bar: sits under turbo on the player card. Cool when there's plenty left, amber as a
   change becomes worth considering, red when this swimmer is done. */
.stam {
  position: relative;
  margin-top: 3px;
  height: 4px;
  border-radius: 3px;
  background: rgba(10, 14, 26, 0.6);
  overflow: hidden;
}
.stam-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 100%;
  background: linear-gradient(90deg, #4ad6a0, #8ff7ff);
  transition: width 0.15s linear, background 0.2s;
}
.stam.low .stam-fill {
  background: linear-gradient(90deg, #ffb347, #ffd23f);
}
.stam.out .stam-fill {
  background: linear-gradient(90deg, #ff5a5a, #ff2ea6);
  animation: stamPulse 0.6s infinite alternate;
}
@keyframes stamPulse {
  from { opacity: 0.55; }
  to { opacity: 1; }
}
.stam span {
  position: absolute;
  right: 2px;
  top: -8px;
  font-size: 7px;
  font-weight: 900;
  letter-spacing: 0.6px;
  color: rgba(255, 255, 255, 0.6);
}
/* Bookings on the player card. */
.pcard-cards {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 13px;
  line-height: 1;
  letter-spacing: 2px;
  color: var(--yellow, #ffd23f);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}
/* Two bookings is the end of the match, and the card should say so before the whistle does. */
.pcard-cards.red {
  color: #ff2d55;
  animation: cardFlash 0.5s ease-in-out infinite alternate;
}
@keyframes cardFlash {
  from { opacity: 0.55; }
  to { opacity: 1; }
}
.pcard.cage {
  border-color: var(--cyan, #5cf2ff);
  box-shadow: 0 0 22px rgba(92, 242, 255, 0.4);
}
.pcard.booked {
  box-shadow: 0 0 0 2px rgba(255, 210, 63, 0.55), 0 6px 18px rgba(0, 0, 0, 0.45);
}
.pcard.off {
  box-shadow: 0 0 0 2px rgba(255, 45, 85, 0.85), 0 6px 18px rgba(0, 0, 0, 0.45);
}
.pcard.off .pcard-nick,
.pcard.off .pcard-name,
.pcard.off .pcard-move,
.pcard.off .pcard-num {
  opacity: 0.5;
  text-decoration: line-through;
}
/* Bench strip: substitutions left + who is waiting. Only visible when it matters. */
.subs-strip {
  position: absolute;
  left: 50%;
  bottom: 74px;
  transform: translateX(-50%) translateY(8px);
  padding: 4px 14px;
  border-radius: 20px;
  border: 2px solid rgba(255, 255, 255, 0.22);
  background: rgba(8, 12, 22, 0.78);
  color: #fff;
  font-family: var(--font-cond, sans-serif);
  font-weight: 900;
  font-size: 13px;
  letter-spacing: 1.4px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
}
.subs-strip.show {
  opacity: 0.9;
  transform: translateX(-50%) translateY(0);
}
.subs-strip.urgent {
  border-color: var(--yellow, #ffd23f);
  color: var(--yellow, #ffd23f);
}
.hud-compact .ticker {
  font-size: 11px !important;
  padding: 3px 10px !important;
}
.hud-compact .ticker-mic {
  font-size: 11px !important;
}
.hud-compact .plays {
  gap: 6px !important;
}
.hud-compact .play {
  font-size: 9px !important;
  padding: 3px 8px !important;
}
.hud-compact .play-key {
  font-size: 8px !important;
}
.hud-compact .heat {
  font-size: 10px !important;
  padding: 2px 8px !important;
}
.hud-compact .combo {
  font-size: 12px !important;
}
.hud-compact .flowchip {
  font-size: 9px !important;
  padding: 2px 8px !important;
}
.hud-compact .banner-text {
  font-size: 24px !important;
}
.hud-compact .banner-sub {
  font-size: 11px !important;
}
`;

let hudStyleEl = null;

function ensureHudStyle() {
  if (!hudStyleEl) {
    hudStyleEl = document.createElement('style');
    hudStyleEl.textContent = HUD_CSS;
    document.head.appendChild(hudStyleEl);
  }
}

/**
 * In-match HUD: scoreboard, game clock + possession clock, gamebreaker meters, turbo bar,
 * style popups, commentary ticker, banners (GAMEBREAKER / WASHED / HUGE SAVE), controls hint.
 */
export class HUD {
  constructor(root, sim) {
    this.root = root;
    this.sim = sim;
    ensureHudStyle();
    this.root.classList.add('hud-compact');
    this.root.innerHTML = this.template();
    this.$ = (s) => this.root.querySelector(s);
    this.els = {
      homeName: this.$('.sb-team.home .sb-name'),
      awayName: this.$('.sb-team.away .sb-name'),
      homeScore: this.$('.sb-team.home .sb-score'),
      awayScore: this.$('.sb-team.away .sb-score'),
      homeGb: this.$('.sb-team.home .gb-fill'),
      awayGb: this.$('.sb-team.away .gb-fill'),
      homeGbWrap: this.$('.sb-team.home .gb-meter'),
      awayGbWrap: this.$('.sb-team.away .gb-meter'),
      clock: this.$('.sb-clock'),
      pclock: this.$('.sb-pclock'),
      period: this.$('.sb-title'),
      clear: this.$('.sb-clear'),
      turbo: this.$('.turbo-fill'),
      turboWrap: this.$('.turbo'),
      stam: this.$('.stam-fill'),
      stamWrap: this.$('.stam'),
      cards: this.$('.pcard-cards'),
      subsStrip: this.$('.subs-strip'),
      pcard: this.$('.pcard'),
      pname: this.$('.pcard-name'),
      pnick: this.$('.pcard-nick'),
      pmove: this.$('.pcard-move'),
      pnum: this.$('.pcard-num'),
      popups: this.$('.popups'),
      banner: this.$('.banner'),
      bannerText: this.$('.banner-text'),
      bannerSub: this.$('.banner-sub'),
      ticker: this.$('.ticker-text'),
      tickerWrap: this.$('.ticker'),
      hint: this.$('.hint'),
      combo: this.$('.combo'),
      heat: this.$('.heat'),
      timing: this.$('.timing'),
      flow: this.$('.flowchip'),
      plays: this.$('.plays'),
      keeperRead: this.$('.keeper-read'),
      keeperAim: this.$('.keeper-read-aim'),
      keeperPosition: this.$('.keeper-read-position'),
      keeperState: this.$('.keeper-read-state'),
    };
    const [h, a] = sim.teams;
    this.els.homeName.textContent = h.abbr;
    this.els.awayName.textContent = a.abbr;
    this.root.style.setProperty('--home', h.primary);
    this.root.style.setProperty('--home-accent', h.accent);
    this.root.style.setProperty('--away', a.primary);
    this.root.style.setProperty('--away-accent', a.accent);
    this.bannerTimer = null;
    this.tickerTimer = null;
    this.tickerQueue = [];
    this.lastScore = [0, 0];
    this.bind();
    this.renderPlays();
  }

  template() {
    return `
      <div class="scoreboard">
        <div class="sb-team home">
          <div class="sb-name">HOME</div>
          <div class="sb-score">0</div>
          <div class="gb-meter"><div class="gb-fill"></div><span class="gb-label">GB</span></div>
        </div>
        <div class="sb-mid">
          <div class="sb-title">1ST HALF</div>
          <div class="sb-clock">${fmtClock(RULES.halfLength)}</div>
          <div class="sb-pclock">${RULES.possessionClock}</div>
          <div class="sb-clear">SHOOT IT</div>
        </div>
        <div class="sb-team away">
          <div class="sb-name">AWAY</div>
          <div class="sb-score">0</div>
          <div class="gb-meter"><div class="gb-fill"></div><span class="gb-label">GB</span></div>
        </div>
      </div>
      <div class="popups"></div>
      <div class="banner"><div class="banner-text"></div><div class="banner-sub"></div></div>
      <div class="keeper-read" hidden aria-label="Keeper commitment">
        <div class="keeper-read-map" aria-hidden="true"><span class="keeper-read-position"></span><span class="keeper-read-aim"></span></div>
        <div><strong class="keeper-read-state">SET</strong><small>MOVE: SET POSITION · HEIGHT: R/F / RIGHT STICK / ▲▼<br>DIVE: U/J / A/B / SWIPE & LIFT · V/L3/GK: LEAVE</small></div>
      </div>
      <div class="timing"></div>
      <div class="combo"></div>
      <div class="heat">ON FIRE</div>
      <div class="flowchip"><span class="flowchip-label">FLOW</span><span class="flowchip-time"></span></div>
      <div class="pcard">
        <div class="pcard-num">00</div>
        <div class="pcard-info">
          <div class="pcard-nick">NICK</div>
          <div class="pcard-name">Name</div>
          <div class="pcard-move">MOVE</div>
          <div class="turbo"><div class="turbo-fill"></div><span>TURBO</span></div>
          <div class="stam"><div class="stam-fill"></div><span>STAM</span></div>
        </div>
        <div class="pcard-cards"></div>
      </div>
      <div class="subs-strip"></div>
      <div class="ticker"><span class="ticker-mic">🎙</span><span class="ticker-text"></span></div>
      <div class="plays">
        <div class="play t0" data-side="offense"><span class="play-key">1·2·3</span><span class="play-name"></span></div>
        <div class="play t1" data-side="defense"><span class="play-key">7·8·9</span><span class="play-name"></span></div>
      </div>
      <div class="hint"></div>
    `;
  }

  setHint(text) {
    this.els.hint.textContent = text;
  }

  bind() {
    const ev = this.sim.events;
    ev.on('style', ({ points, label, combo, big, team }) => {
      if (this.sim.userTeam !== null && team !== this.sim.userTeam && !big) return; // only show CPU big plays
      this.popup(`${label}`, `+${points}`, team, big, combo);
    });
    ev.on('gbready', ({ team }) => {
      this.banner('GAMEBREAKER READY', this.sim.userTeam === team ? 'PRESS E / LT+RT' : `${this.sim.teams[team].name.toUpperCase()}`, team, 2000);
      this.flashGb(team);
    });
    ev.on('gamebreaker', ({ team, player }) => this.banner('GAMEBREAKER!', player.data.signature.toUpperCase(), team, 2600, true));
    ev.on('washed', ({ player }) => this.banner('WASHED', '', player.team, 1400));
    // Discipline: the whistle, the card, and the red. Read them loudly — a booking is a real
    // consequence and the player needs to know which of their swimmers is one hit from the bench.
    ev.on('foul', ({ team, offender, victim, red }) => {
      if (!red) this.popup('FOUL', `${offender.data.nick} ON ${victim.data.nick}`, team, false, 0);
    });
    ev.on('card', ({ team, player, red }) => {
      if (red) this.banner('RED CARD', `${player.data.nick} OFF`, team, 2800, true);
      else this.banner('YELLOW CARD', player.data.nick, team, 1400);
      this.popup(red ? 'OFF' : 'BOOKED', player.data.nick, team, red, 0);
    });
    ev.on('sub', ({ team, in: incoming }) => {
      this.popup(incoming.data.nick, `ON · ${incoming.data.role}`, team, false, 0);
    });
    ev.on('block', ({ blocker }) => this.banner('DENIED', '', blocker.team, 1100));
    ev.on('save', ({ keeper, big, dived, read }) => {
      if (read) this.banner('READ SAVE', keeper.data.nick, keeper.team, 1300);
      else if (dived) this.banner('DIVING SAVE', keeper.data.nick, keeper.team, 1300);
      else if (big) this.banner('HUGE SAVE', keeper.data.nick, keeper.team, 1300);
    });
    ev.on('cage', ({ keeper, on }) => {
      if (on) this.banner('IN THE CAGE', `${keeper.data.nick} · SET SIDE + HEIGHT, THEN DIVE`, keeper.team, 1400);
    });
    ev.on('bighit', ({ player, hadBall }) => {
      if (hadBall) this.banner('BIG HIT', 'BALL LOOSE', player.team, 1200);
    });
    ev.on('alleyoop', ({ finisher }) => this.banner('LOB & VOLLEY', '', finisher.team, 1300));
    ev.on('score', ({ team, points, gb, stolen, player, type, ownGoal, ring }) => {
      if (gb) this.banner(`+${points}  /  -${stolen}`, 'GAMEBREAKER GOAL', team, 2400, true);
      else if (type === 'topring') this.banner(`TOP RING +${points}`, 'THROUGH THE ORANGE', team, 1800, true);
      else if (type === 'volley') this.banner('GOAL!', 'VOLLEY FINISH', team, 1600, true);
      else if (type === 'long') this.banner('GOAL!', 'FROM DOWNTOWN', team, 1600, true);
      else if (ownGoal) this.banner('GOAL!', 'OWN GOAL', team, 1600, true);
      else if (points > 1 && ring === 0) this.banner(`+${points}`, 'TOP RING', team, 1500, true);
      else this.banner(`GOAL +${points}`, player.data.nick, team, 1500, true);
      this.pulseScore(team);
    });
    ev.on('halftime', () => this.banner('HALFTIME', '', null, 2600, true));
    ev.on('overtime', () => this.banner('OVERTIME', 'GOLDEN GOAL', null, 2600, true));
    ev.on('shotclock', ({ team }) => this.banner('POSSESSION CLOCK', 'TURNOVER', 1 - team, 1500));
    ev.on('heating', ({ team }) => {
      if (this.sim.userTeam === null || team === this.sim.userTeam) this.showHeat(true);
    });
    ev.on('flowstart', ({ team }) => {
      if (this.sim.userTeam === team) this.banner('FLOW', 'YOU ARE THE MOMENTUM', team, 2400, true);
      else this.banner('FLOW', `${this.sim.teams[team].name.toUpperCase()} ENTERS THE ZONE`, team, 2000);
    });
    ev.on('callpass', ({ target }) => {
      this.popup('CALLED', target.data.nick, target.team, false, 0);
    });
    ev.on('turnover', ({ reason, team }) => {
      if (reason !== 'POSSESSION CLOCK') this.banner(reason, 'TURNOVER', 1 - team, 1500);
    });
    ev.on('violation', ({ reason }) => this.banner(reason, 'RELEASE IT', null, 1200));
    ev.on('possession', ({ team }) => {
      if (this.sim.momentum[1 - team] === 0) this.showHeat(false);
    });
    ev.on('timing', ({ label, good }) => this.showTiming(label, good));
    ev.on('playcall', ({ team, side, play }) => {
      if (this.sim.userTeam !== null && team !== this.sim.userTeam) {
        // CPU play calls aren't visible anywhere else; surface them on the ticker.
        this.ticker(`${side === 'offense' ? 'OFFENSE' : 'DEFENSE'}: ${play.name} — ${this.sim.teams[team].name.toUpperCase()}`, 1);
        return;
      }
      this.banner(play.name, side === 'offense' ? 'OFFENSE' : 'DEFENSE', team, 1100);
    });
    ev.on('gameover', ({ winner }) => this.banner('GAME', `${this.sim.teams[winner].city.toUpperCase()} ${this.sim.teams[winner].name.toUpperCase()} WIN`, winner, 5000, true));
  }

  popup(label, sub, team, big, combo) {
    const el = document.createElement('div');
    el.className = `popup ${big ? 'big' : ''} t${team}`;
    el.innerHTML = `<span class="popup-label">${label}</span><span class="popup-pts">${sub}</span>${combo > 1 ? `<span class="popup-combo">x${combo}</span>` : ''}`;
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 10}deg`);
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    this.els.popups.appendChild(el);
    while (this.els.popups.children.length > 5) this.els.popups.firstChild.remove();
    setTimeout(() => el.classList.add('out'), big ? 1400 : 950);
    setTimeout(() => el.remove(), big ? 1900 : 1400);
    if (combo > 1) {
      this.els.combo.textContent = `COMBO x${combo}`;
      this.els.combo.classList.add('show');
      clearTimeout(this.comboTimer);
      this.comboTimer = setTimeout(() => this.els.combo.classList.remove('show'), 1200);
    }
  }

  banner(text, sub, team, ms = 1200, huge = false) {
    const b = this.els.banner;
    this.els.bannerText.textContent = text;
    this.els.bannerSub.textContent = sub || '';
    b.className = `banner show ${huge ? 'huge' : ''} ${team === null ? '' : `t${team}`}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
  }

  showTiming(label, good) {
    const t = this.els.timing;
    t.textContent = label;
    t.className = `timing show ${good ? 'good' : 'bad'} ${label === 'PERFECT' ? 'perfect' : ''}`;
    clearTimeout(this.timingTimer);
    this.timingTimer = setTimeout(() => t.classList.remove('show'), 800);
  }

  showHeat(on) {
    this.els.heat.classList.toggle('show', on);
  }

  flashGb(team) {
    const w = team === 0 ? this.els.homeGbWrap : this.els.awayGbWrap;
    w.classList.add('ready');
  }

  pulseScore(team) {
    const el = team === 0 ? this.els.homeScore : this.els.awayScore;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  ticker(line, priority) {
    if (priority >= 2) this.tickerQueue = [];
    this.tickerQueue.push(line);
    if (!this.tickerTimer) this.nextTicker();
  }

  nextTicker() {
    const line = this.tickerQueue.shift();
    if (!line) {
      this.tickerTimer = null;
      this.els.tickerWrap.classList.remove('show');
      return;
    }
    this.els.ticker.textContent = line;
    this.els.tickerWrap.classList.add('show');
    this.tickerTimer = setTimeout(() => {
      this.tickerTimer = null;
      if (this.tickerQueue.length) this.nextTicker();
      else this.els.tickerWrap.classList.remove('show');
    }, 2600);
  }

  /** Keep the play chips in sync with the sim's live play state (CPU calls included). */
  renderPlays() {
    const sim = this.sim;
    const myTeam = sim.userTeam ?? 0;
    const key = `${sim.offPlay[myTeam]}|${sim.defPlay[myTeam]}|${sim.possession === myTeam}`;
    if (key === this._playKey) return;
    this._playKey = key;
    const set = (el, play, active) => {
      el.querySelector('.play-name').textContent = play.name;
      el.classList.toggle('active', active);
    };
    set(this.root.querySelector('.play.t0'), sim.offensePlayOf(myTeam), sim.possession === myTeam);
    set(this.root.querySelector('.play.t1'), sim.defensePlayOf(myTeam), sim.possession !== myTeam);
  }

  update() {
    const sim = this.sim;
    this.renderPlays();
    this.renderKeeper();
    const [h, a] = sim.score;
    this.els.homeScore.textContent = h;
    this.els.awayScore.textContent = a;
    const max = sim.rules.gamebreakerMeterMax;
    this.els.homeGb.style.width = `${(sim.gb[0] / max) * 100}%`;
    this.els.awayGb.style.width = `${(sim.gb[1] / max) * 100}%`;
    this.els.homeGbWrap.classList.toggle('ready', sim.gbReady[0]);
    this.els.awayGbWrap.classList.toggle('ready', sim.gbReady[1]);
    const pclock = Math.max(0, Math.ceil(sim.possessionClock));
    this.els.clock.textContent = sim.overtime ? fmtClock(sim.otTime) : fmtClock(sim.clock);
    this.els.clock.classList.toggle('urgent', !sim.overtime && sim.clock <= 10 && sim.state === 'live');
    this.els.pclock.textContent = sim.state === 'live' ? pclock : '--';
    this.els.pclock.classList.toggle('urgent', pclock <= 5 && sim.state === 'live');
    const period = sim.overtime ? 'OVERTIME' : sim.half === 1 ? '1ST HALF' : '2ND HALF';
    if (this._period !== period) {
      this._period = period;
      this.els.period.textContent = period;
    }
    this.els.clear.classList.toggle('show', pclock <= 5 && sim.possession === sim.userTeam && sim.state === 'live');
    // FLOW chip: a live countdown while anyone is in the zone (banner fades, the zone doesn't).
    const ft = sim.flow ? (sim.flow[0] ? 0 : sim.flow[1] ? 1 : -1) : -1;
    this.els.flow.classList.toggle('show', ft >= 0);
    this.els.flow.classList.toggle('enemy', ft !== (sim.userTeam ?? 0));
    this.els.flow.style.setProperty('--flow-color', ft >= 0 ? sim.teams[ft].accent : '#8ff7ff');
    if (ft >= 0) this.els.flow.querySelector('.flowchip-time').textContent = `${Math.ceil(sim.flowTimer[ft])}s`;
    // Player card: the controlled player, or (spectating) whoever has the ball.
    const p = sim.controlled || sim.ball.holder || this._lastCard;
    if (p) {
      this._lastCard = p;
      // Stamina: the body meter. Turns amber when a change is worth making and red when this
      // swimmer is done — that readout is what turns the bench from a menu into a decision.
      this.els.stam.style.width = `${Math.max(0, Math.min(100, p.stamina))}%`;
      this.els.stamWrap.classList.toggle('low', p.stamina < 45);
      this.els.stamWrap.classList.toggle('out', p.stamina < 18);
      // In the cage the dive REPLACES turbo as the thing you are watching, so the bar shows the
      // dive cooldown filling: a dive on cooldown has to read as "not yet", not "broken".
      const inCage = !!sim.inCage && p.isKeeper;
      this.els.pcard.classList.toggle('cage', inCage);
      if (inCage) {
        const ready = p.cd.dive <= 0;
        this.els.turbo.style.width = `${ready ? 100 : Math.max(0, 100 - (p.cd.dive / MOVE.keeperDiveCooldown) * 100)}%`;
        this.els.turboWrap.classList.toggle('low', !ready);
        // Refreshed here rather than inside the card guard below: the cooldown changes every
        // frame, and a label that only updated on a player swap would lie about being ready.
        this.els.pmove.textContent = ready ? 'DIVE READY' : 'DIVE RECOVER';
      } else {
        this.els.turbo.style.width = `${p.turbo}%`;
        this.els.turboWrap.classList.toggle('low', p.turbo < 20);
      }
      if (this._cardId !== p.id || this._cardCards !== p.cards || this._cardOff !== !!p.sentOff || this._cardCage !== !!sim.inCage) {
        this._cardId = p.id;
        this._cardCards = p.cards;
        this._cardOff = !!p.sentOff;
        this._cardCage = !!sim.inCage;
        this.els.pname.textContent = p.data.name;
        this.els.pnick.textContent = p.data.nick;
        // Signature move lives on the card so you always know what TRICK is about to do.
        this.els.pmove.textContent = p.isKeeper ? 'KEEPER' : moveFor(p).name;
        this.els.pnum.textContent = `#${p.data.number}`;
        this.els.pcard.style.setProperty('--c1', sim.teams[p.team].primary);
        this.els.pcard.style.setProperty('--c2', sim.teams[p.team].secondary);
        this.els.cards.textContent = p.cards > 0 ? '●'.repeat(Math.min(2, p.cards)) : '';
        this.els.cards.classList.toggle('red', p.sentOff || p.cards >= 2);
        this.els.pcard.classList.toggle('booked', !p.sentOff && p.cards > 0);
        this.els.pcard.classList.toggle('off', !!p.sentOff);
        if (p.sentOff) {
          this.els.pnick.textContent = 'SENT OFF';
          this.els.pmove.textContent = p.sentOffAt != null ? `OUT ${Math.round(p.sentOffAt)}'` : 'OFF';
        }
        // In the cage the dive label is owned by the per-frame block above; don't stomp it.
        if (inCage) this.els.pmove.textContent = p.cd.dive <= 0 ? 'DIVE READY' : 'DIVE RECOVER';
      }
    }
    this.renderSubs();
  }

  renderKeeper() {
    const sim = this.sim;
    const p = sim.controlled;
    const el = this.els.keeperRead;
    el.hidden = !(sim.inCage && p?.isKeeper && sim.state === 'live');
    if (el.hidden) return;
    const committed = p.diveT > 0;
    const inp = sim.userInput;
    const aim = committed ? { z: p.diveDir, height: p.diveHeight } : inp.keeperAim || { z: inp.moveZ || 0, height: inp.moveY || 0 };
    const side = -sim.attackDir(p.team) * aim.z;
    const level = aim.height > 0.2 ? 'HIGH' : aim.height < -0.2 ? 'LOW' : 'FLAT';
    const direction = side > 0.2 ? 'RIGHT' : side < -0.2 ? 'LEFT' : 'CENTRE';
    const age = MOVE.keeperDiveWindow - p.diveT;
    const phase = committed ? age < MOVE.keeperReadMin ? 'COMMITTING' : 'READ WINDOW' : p.cd.dive > 0 ? 'RECOVER' : 'SET';
    this.els.keeperState.textContent = `${phase} · ${direction} ${level}`;
    el.dataset.phase = phase;
    this.els.keeperAim.style.left = `${50 + Math.max(-1, Math.min(1, side)) * 36}%`;
    this.els.keeperAim.style.top = `${50 - aim.height * 36}%`;
    this.els.keeperPosition.style.left = `${50 - sim.attackDir(p.team) * p.pos.z / ARENA.keeperMaxZ * 42}%`;
    const height = (p.y - ARENA.keeperMinY) / (ARENA.keeperMaxY - ARENA.keeperMinY);
    this.els.keeperPosition.style.top = `${92 - height * 84}%`;
  }

  /**
   * Bench strip: how many changes are left and who is waiting. Only shown for the player's crew,
   * and only when it matters (a change in reserve, someone gassed, or the window is open), so it
   * never becomes permanent HUD furniture.
   */
  renderSubs() {
    const sim = this.sim;
    const team = sim.userTeam;
    const strip = this.els.subsStrip;
    if (!strip || team === null) {
      if (strip) strip.classList.remove('show');
      return;
    }
    const left = sim.subsLeft ? sim.subsLeft[team] : 0;
    const bench = sim.benchOf ? sim.benchOf(team) : [];
    const gassed = sim.players.some((p) => p.team === team && p.stamina < 30);
    const open = sim.subWindow > 0 && sim.state !== 'live';
    if (!open && !(gassed && left > 0) && left >= sim.rules.subsPerTeam) {
      strip.classList.remove('show');
      return;
    }
    const waiting = bench.filter((b) => !b.subbedIn).length;
    strip.textContent = open
      ? `SUBS ${left} · TAP THE BENCH`
      : `SUBS ${left} · ${gassed ? 'SWIMMER GASSED' : `${waiting} WAITING`}`;
    strip.classList.add('show');
    strip.classList.toggle('urgent', open || gassed);
  }
}

function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
  }
