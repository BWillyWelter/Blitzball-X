import '@fontsource/bangers/400.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/900.css';
import '@fontsource/permanent-marker/400.css';
import './styles.css';

import { MatchSim } from './game/match.js';
import { MatchRenderer } from './render/renderer.js';
import { InputManager } from './ui/input.js';
import { AudioSystem } from './ui/audio.js';
import { HUD } from './ui/hud.js';
import { Commentary } from './ui/commentary.js';
import { loadState, saveState, clearState } from './ui/save.js';
import { TouchControls, isTouchDevice } from './ui/touch.js';
import { createCareer, currentOpponent, recordResult, careerTitle, awardPlayerProgress } from './game/career.js';
import { TEAMS, TEAM_BY_ID } from './data/teams.js';
import { PHYS } from './data/constants.js';
import * as Screens from './ui/screens.js';

class App {
  constructor() {
    this.state = loadState();
    this.input = new InputManager();
    this.audio = new AudioSystem(this.state.settings);
    this.root = document.getElementById('app');
    this.screen = null;
    this.match = null;
    this.teams = TEAMS; // exposed for QA tooling
    this.overlay = null;
    this.settingsOverlay = null;
    this.raf = null;
    this.lastT = performance.now();
    this.accum = 0;
    const unlock = () => {
      this.audio.unlock();
      if (!this.match && !this.audio.beat) this.audio.startBeat('menu');
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    window.addEventListener('resize', () => this.match && this.match.renderer.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.match && !this.match.paused && this.match.sim.state !== 'over') this.pause();
    });
    this.input.onPause = () => {
      if (!this.match || this.match.sim.state === 'over' || this.match.finished) return false;
      if (this.match.paused) {
        // Settings overlay on top of the pause menu closes first.
        if (this.settingsOverlay) {
          this.settingsOverlay.el.remove();
          this.settingsOverlay = null;
        } else this.resume();
      } else this.pause();
      return true;
    };
    this.go('title');
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  save() {
    saveState(this.state);
    this.audio.applyVolumes();
  }

  resetAll() {
    clearState();
    this.state = loadState();
    this.audio.settings = this.state.settings;
    this.audio.applyVolumes();
    this.go('title');
  }

  // ---------------------------------------------------------------------------
  // Screen routing
  // ---------------------------------------------------------------------------

  go(name, params = {}) {
    if (this.screen && this.screen.destroy) this.screen.destroy();
    if (this.screen) this.screen.el.remove();
    this.screen = null;
    const factories = {
      title: Screens.TitleScreen,
      teamselect: Screens.TeamSelectScreen,
      career: Screens.CareerScreen,
      roster: Screens.RosterScreen,
      howto: Screens.HowToScreen,
      settings: Screens.SettingsScreen,
      results: Screens.ResultsScreen,
    };
    const f = factories[name];
    if (!f) return;
    if (name !== 'results' && this.match) this.endMatch();
    if (name === 'career' && !this.isCareerValid()) {
      this.state.career = null;
      this.save();
      return this.go('title');
    }
    this.screen = f(this, params);
    this.screen.name = name;
    this.root.appendChild(this.screen.el);
    requestAnimationFrame(() => this.screen && this.screen.el.classList.add('in'));
    if (this.audio.unlocked && !this.match && (!this.audio.beat || this.audio.beat.style !== 'menu')) this.audio.startBeat('menu');
  }

  isCareerValid() {
    const c = this.state.career;
    return !!(c && TEAM_BY_ID[c.teamId] && Array.isArray(c.ladder) && c.ladder.every((id) => TEAM_BY_ID[id]) && (c.complete || TEAM_BY_ID[c.ladder[c.stage]]));
  }

  startCareer(teamId, player = {}) {
    if (!TEAM_BY_ID[teamId]) return this.go('title');
    this.state.career = createCareer(teamId, this.state.settings.difficulty, player);
    this.save();
    this.go('career');
  }

  // ---------------------------------------------------------------------------
  // Match lifecycle
  // ---------------------------------------------------------------------------

  startMatch({ home, away, userTeam = 0, mode = 'quick' }) {
    if (this.screen) {
      this.screen.el.remove();
      this.screen = null;
    }
    if (this.match) this.endMatch();
    const wrap = document.createElement('div');
    wrap.className = 'match-wrap';
    wrap.innerHTML = `<canvas class="game-canvas"></canvas><div class="hud"></div><div class="tip-overlay"><div class="tip-box"><div class="tip-teams"><span style="--c1:${home.primary}">${home.city} ${home.name}</span><em>VS</em><span style="--c1:${away.primary}">${away.city} ${away.name}</span></div><div class="tip-rule">TWO HALVES · MOST GOALS WINS · ${mode === 'career' ? 'THEIR SPHERE' : `${home.city.toUpperCase()} SPHERE`}</div></div></div>`;
    this.root.appendChild(wrap);
    const canvas = wrap.querySelector('.game-canvas');
    if (mode === 'career' && this.state.career) {
      const base = TEAM_BY_ID[this.state.career.teamId];
      const player = this.state.career.player;
      home = { ...base, roster: [player, ...base.roster.filter((p) => p.role !== 'GK').slice(1), base.roster.find((p) => p.role === 'GK')] };
      away = currentOpponent(this.state.career);
      userTeam = 1;
    }
    const difficulty = mode === 'career' && this.state.career ? this.state.career.difficulty : this.state.settings.difficulty;
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const sim = new MatchSim({ home: mode === 'career' ? away : home, away: mode === 'career' ? home : away, difficulty, seed, userTeam: mode === 'career' ? 1 : userTeam });
    let renderer;
    try {
      renderer = new MatchRenderer(canvas, sim, { ...this.state.settings, firstPerson: this.state.settings.camera === 'firstPerson' });
    } catch (e) {
      console.error(e);
      wrap.remove();
      alert('WebGL is required to play. Please enable hardware acceleration or try another browser.');
      this.go('title');
      return;
    }
    const hud = new HUD(wrap.querySelector('.hud'), sim);
    const commentary = new Commentary(sim, (line, pr) => {
      if (this.state.settings.commentary) hud.ticker(line, pr);
    });
    this.match = { sim, renderer, hud, commentary, wrap, mode, userTeam, home, away, paused: false, tipTimer: 2.2, finished: false, resultsTimer: 0, touchControls: null };
    // On-screen controls for touch devices (and anyone who forces them on in Settings).
    if (this.touchEnabled()) {
      this.match.touchControls = new TouchControls(wrap, this.input, { onPause: () => this.pause() });
      wrap.classList.add('touch');
    }
    hud.setHint(
      userTeam === null
        ? this.touchEnabled()
          ? 'WATCHING'
          : 'WATCHING · ESC to leave'
        : this.touchEnabled() || isTouchDevice()
          ? 'LEFT STICK move · SHOOT hold, release in the PERFECT window · TURBO to burn meters'
          : 'WASD move & aim · SHIFT turbo · J shoot · K pass/call · L slide tackle · I hit · U breach · E gamebreaker · Q switch · C ball cam · 1-3/7-9 plays',
    );
    this.bindMatchAudio(sim, renderer);
    if (this.audio.unlocked) {
      this.audio.startBeat('match');
      this.audio.startCrowd();
      this.audio.whistle();
    }
    setTimeout(() => wrap.querySelector('.tip-overlay')?.classList.add('out'), 1800);
    this.accum = 0;
    this.lastT = performance.now();
  }

  /** Should the on-screen touch controls be shown for this match? */
  touchEnabled() {
    const mode = this.state.settings.touchControls || 'auto';
    if (mode === 'off') return false;
    if (mode === 'on') return true;
    return isTouchDevice();
  }

  bindMatchAudio(sim, renderer) {
    const a = this.audio;
    const ev = sim.events;
    ev.on('wall', ({ speed }) => a.bounce(Math.min(1, speed / 6)));
    ev.on('post', ({ hard }) => a.rim(hard));
    ev.on('score', ({ gb }) => {
      a.swish();
      a.slam();
      a.crowdSwell(gb ? 1.5 : 1.1);
      if (gb) a.stinger('gb');
    });
    ev.on('save', ({ big }) => {
      a.blockHit();
      a.crowdSwell(big ? 1.1 : 0.6);
    });
    ev.on('shot', ({ gb }) => a.whoosh(gb ? 0.7 : 1.1));
    ev.on('pass', ({ alley }) => a.whoosh(alley ? 0.8 : 1.4));
    ev.on('knockdown', () => {
      a.thud();
      a.crowdSwell(0.5);
    });
    ev.on('washed', () => {
      a.stinger('big');
      a.crowdSwell(1.3);
    });
    ev.on('tackle', () => {
      a.stealHit();
      a.crowdSwell(0.6);
    });
    ev.on('bighit', () => {
      a.thud();
      a.crowdSwell(0.8);
    });
    ev.on('block', () => {
      a.blockHit();
      a.crowdSwell(1.1);
    });
    ev.on('style', ({ big, team }) => {
      if (sim.userTeam === null || team === sim.userTeam) a.stinger(big ? 'big' : 'style');
    });
    ev.on('gbready', () => a.stinger('gb'));
    ev.on('gamebreaker', () => {
      a.gbCharge();
      a.crowdSwell(1.5);
    });
    ev.on('trick', ({ turbo }) => {
      a.whoosh(turbo ? 1.6 : 1.2);
    });
    ev.on('breach', () => a.whoosh(0.9));
    ev.on('splash', () => a.bounce(0.4));
    ev.on('miss', ({ type }) => {
      if (type !== 'blocked') a.crowdGroan();
    });
    ev.on('turnover', () => a.whistle());
    ev.on('violation', () => a.whistle());
    ev.on('shotclock', () => a.buzzer());
    ev.on('horn', () => a.buzzer());
    ev.on('halftime', () => a.crowdSwell(0.8));
    ev.on('overtime', () => a.stinger('gb'));
    ev.on('gameover', () => {
      a.buzzer();
      a.crowdSwell(2);
    });
    this._dribbleT = 0;
  }

  pause() {
    if (!this.match || this.match.paused) return;
    this.match.paused = true;
    this.audio.suspend();
    const ov = Screens.PauseOverlay(this, {
      onResume: () => this.resume(),
      onQuit: () => this.go('title'),
      onRestart: () => {
        const m = this.match;
        this.startMatch({ home: m.home, away: m.away, userTeam: m.userTeam, mode: m.mode });
      },
    });
    this.overlay = ov;
    this.match.wrap.appendChild(ov.el);
  }

  resume() {
    if (!this.match || !this.match.paused) return;
    this.match.paused = false;
    this.audio.resume();
    if (this.overlay) this.overlay.el.remove();
    this.overlay = null;
    if (this.settingsOverlay) {
      this.settingsOverlay.el.remove();
      this.settingsOverlay = null;
    }
    this.lastT = performance.now();
  }

  openSettingsOverlay() {
    if (!this.match) return;
    const s = Screens.SettingsScreen(this, {});
    s.el.classList.add('overlay-screen', 'in');
    s.el.querySelector('.back-btn').onclick = () => {
      s.el.remove();
      this.settingsOverlay = null;
    };
    this.settingsOverlay = s;
    this.match.wrap.appendChild(s.el);
  }

  endMatch() {
    if (!this.match) return;
    this.match.touchControls?.dispose();
    this.persistBallCam();
    this.match.renderer.dispose();
    this.match.wrap.remove();
    this.match = null;
    this.overlay = null;
    this.audio.stopCrowd();
    this.audio.resume();
  }

  /** Persist the in-match ball-cam toggle so the next match and Settings reflect it. */
  persistBallCam() {
    if (this.match?.renderer?.gameCam) {
      this.state.settings.ballCam = this.match.renderer.gameCam.ballCam;
      saveState(this.state);
    }
  }

  finishMatch() {
    const m = this.match;
    if (!m || m.finished) return;
    m.finished = true;
    const sim = m.sim;
    const rec = this.state.records;
    let careerResult = null;
    if (m.userTeam !== null) {
      const won = sim.winner === m.userTeam;
      const myStyle = sim.teamPlayers(m.userTeam).reduce((s, p) => s + p.stats.style, 0);
      const margin = sim.score[m.userTeam] - sim.score[1 - m.userTeam];
      if (won) rec.wins++;
      else rec.losses++;
      rec.styleBest = Math.max(rec.styleBest, myStyle);
      rec.gamebreakers += sim.teamPlayers(m.userTeam).reduce((s, p) => s + p.stats.gb, 0);
      rec.goals = (rec.goals || 0) + sim.score[m.userTeam];
      rec.saves = (rec.saves || 0) + sim.teamPlayers(m.userTeam).reduce((s, p) => s + p.stats.saves, 0);
      rec.washed = (rec.washed || 0) + sim.teamPlayers(m.userTeam).reduce((s, p) => s + p.stats.washed, 0);
      rec.bestMargin = Math.max(rec.bestMargin, margin);
      if (m.mode === 'career' && this.state.career) {
        const c = this.state.career;
        const before = c.rep;
          recordResult(c, { won, score: [...sim.score], style: myStyle, margin });
          const progression = awardPlayerProgress(c, { won, style: myStyle, margin });
          c.lastUnlocks = progression.unlocked;
        careerResult = won
          ? `+${c.rep - before} REP · ${careerTitle(c)}${c.complete ? ' · YOU BEAT EVERY CREW. LEGEND DIFFICULTY UNLOCKED.' : ` · NEXT: ${currentOpponent(c).city.toUpperCase()}`}`
          : `+${c.rep - before} REP · Run it back to move up the ladder.`;
        if (c.complete) this.state.unlocked.legendMode = true;
      }
      this.save();
    }
    setTimeout(() => {
      if (!this.match) return;
      const params = { sim, mode: m.mode, userTeam: m.userTeam, careerResult };
      this.match.touchControls?.dispose();
      // A natural game end never goes through endMatch, so persist the toggle here too.
      this.persistBallCam();
      this.match.renderer.dispose();
      this.match.wrap.remove();
      this.match = null;
      this.audio.stopCrowd();
      this.go('results', params);
    }, 3200);
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    // Use performance.now() rather than the rAF timestamp: the latter is the frame's vsync time
    // and can be EARLIER than a performance.now() sampled when a match started/resumed, which
    // would produce a negative dt (and a camera lerp that extrapolates off into space).
    const now = performance.now();
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;

    if (this.match) {
      const m = this.match;
      if (m.paused) {
        const nav = this.input.menuPoll();
        if (this.settingsOverlay) {
          if (nav.back) {
            this.settingsOverlay.el.remove();
            this.settingsOverlay = null;
          }
        } else if (this.overlay) this.overlay.onNav(nav);
        m.renderer.render();
        return;
      }
      const input = this.input.poll();
      // Latch the ball-cam edge before the fixed-step loop zeroes the one-shots; it is consumed
      // below only once a step has actually run, so no-step frames can't double-fire the toggle.
      const ballCamEdge = input.ballCamToggle;
      if (m.userTeam !== null) m.sim.setUserInput(input);
      // Fixed-step simulation
      this.accum += dt;
      const step = PHYS.fixedDt;
      let n = 0;
      while (this.accum >= step && n < 5) {
        m.sim.step(step);
        this.accum -= step;
        n++;
        // One-shot inputs only apply for one sim step.
        input.shootPressed = false;
        input.shootReleased = false;
        input.pass = false;
        input.trick = false;
        input.hit = false;
        input.breach = false;
        input.switchPlayer = false;
        input.gamebreaker = false;
        input.ballCamToggle = false;
        input.playcall = 0;
      }
      // Only release latched edges once a step has actually consumed them, otherwise a tap that
      // lands on a frame with no fixed step (120 Hz displays) is silently dropped.
      if (n > 0) this.input.flushOneShots();
      // BALL CAM toggle (C / RS click / touch CAM): flips the player cam between hard-locking
      // the ball and looking where the swimmer is headed. Popup feedback so the swap reads.
      if (ballCamEdge && n > 0 && m.renderer.gameCam && m.sim.controlled) {
        const on = m.renderer.gameCam.toggleBallCam();
        m.hud.popup(on ? 'BALL CAM' : 'PLAYER CAM', on ? 'LOCKED ON' : 'LOOK AHEAD', m.sim.controlled.team, false, 0);
      }
      // Light up the Gamebreaker button as soon as the controlled side's meter is full.
      if (m.touchControls && m.userTeam !== null) m.touchControls.setGamebreakerReady(!!m.sim.gbReady[m.userTeam]);
      // Swim stroke sound for the controlled / carrying swimmer
      const swimmer = m.sim.controlled || m.sim.ball.holder;
      if (swimmer && swimmer.state === 'swim' && swimmer.speedNorm > 0.25) {
        this._dribbleT -= dt;
        if (this._dribbleT <= 0) {
          this.audio.stroke(swimmer.turboActive ? 1 : 0.6);
          this._dribbleT = swimmer.turboActive ? 0.3 : 0.5;
        }
      }
      m.renderer.update(dt);
      m.hud.update();
      m.renderer.render();
      this.audio.setCrowdLevel(m.renderer.crowdEnergy);
      if (m.sim.state === 'over' && !m.finished) this.finishMatch();
      if (m.userTeam === null && input.switchPlayer) {
        /* spectator: nothing */
      }
    } else if (this.screen) {
      const nav = this.input.menuPoll();
      if (this.screen.onNav) this.screen.onNav(nav);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
