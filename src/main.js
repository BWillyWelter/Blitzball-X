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
import { BenchPanel } from './ui/bench.js';
import { ReplayOverlay } from './ui/replay.js';
import { MontageOverlay } from './ui/montage.js';
import { ReplayDirector, ReplayRecorder } from './game/replay.js';
import { Commentary } from './ui/commentary.js';
import { loadState, saveState, clearState } from './ui/save.js';
import { TouchControls, isTouchDevice } from './ui/touch.js';
import {
  createCareer,
  currentOpponent,
  recordResult,
  careerTitle,
  awardPlayerProgress,
  fixtureFor,
  rollInjuries,
} from './game/career.js';
import { TEAMS, TEAM_BY_ID } from './data/teams.js';
import { PHYS } from './data/constants.js';

/**
 * Ceiling on fixed sim steps per rendered frame. Bounds the worst-case cost of one slow frame,
 * and pairs with the accumulator clamp below so a hitch can't leave an undrainable backlog.
 */
const MAX_STEPS_PER_FRAME = 5;
import * as Screens from './ui/screens.js';
import { startAnimBench } from './dev/animbench.js';
import { FrameMonitor, PerfOverlay, perfEnabled } from './dev/perf.js';

/**
 * Probe what this browser/device can actually do with WebGL. Used for two things: the start-of-match
 * failure alert must name the real cause instead of always blaming the GPU, and `?diag` renders the
 * same report on screen so a phone can screenshot it (headless swiftshader can never reproduce a
 * real device's GPU failure).
 */
/**
 * Seed for the next match.
 *
 * Normal play is clock-seeded so every match feels fresh. But the browser QA harnesses drive the
 * real app through startMatch(), and a clock seed made them a lottery: a run could begin inside a
 * kickoff reset where the controlled swimmer is legally frozen, and a check that passes locally
 * would fail CI on an unlucky roll. An explicit seed — passed to startMatch, set on
 * window.__BBX_SEED__, or given as ?seed= in the URL — pins the sim stream so a harness can replay
 * a known-good match exactly. Real players never set any of these.
 */
function matchSeed(explicit) {
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    const n = Number(explicit);
    if (Number.isFinite(n)) return n >>> 0;
  }
  try {
    const q = new URLSearchParams(window.location.search).get('seed');
    if (q !== null) {
      const n = Number(q);
      if (Number.isFinite(n)) return n >>> 0;
    }
    if (window.__BBX_SEED__ !== undefined && window.__BBX_SEED__ !== null) {
      const n = Number(window.__BBX_SEED__);
      if (Number.isFinite(n)) return n >>> 0;
    }
  } catch {
    // No window (or no location) — fall through to the clock seed.
  }
  return (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
}

export function probeWebGL() {
  const out = { webgl2: false, webgl: false, renderer: '-', vendor: '-', maxTexture: 0, error: '' };
  for (const type of ['webgl2', 'webgl']) {
    let gl = null;
    try {
      gl = document.createElement('canvas').getContext(type);
    } catch (e) {
      out.error = e && e.message ? e.message : String(e);
    }
    if (!gl) continue;
    out[type] = true;
    if (out.renderer === '-') {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      try {
        out.renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
        out.vendor = String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
        out.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      } catch {
        /* some drivers throw on these queries; the booleans are what matter */
      }
    }
  }
  return out;
}

class App {
  constructor() {
    this.state = loadState();
    this.input = new InputManager();
    this.audio = new AudioSystem(this.state.settings);
    this.root = document.getElementById('app');
    this.screen = null;
    this.match = null;
    this.teams = TEAMS; // exposed for QA tooling
    this.lastStartError = null; // last failed match start, shown by ?diag
    this.overlay = null;
    this.settingsOverlay = null;
    this.raf = null;
    this.lastT = performance.now();
    this.accum = 0;
    // Frame-tail instrumentation (see ./dev/perf.js). Recording is always on because a CI run and
    // a player's own phone should both be able to report a stutter without a flag; `?perf` only
    // adds the on-screen readout.
    this.perf = new FrameMonitor();
    this.perfOverlay = perfEnabled() ? new PerfOverlay(document.body) : null;
    window.__BB_PERF__ = {
      summary: () => this.perf.summary(),
      reset: () => this.perf.reset(),
    };
    // Balance workbench (`?tune`): edits the tuning constants in place and prints the diff as lines
    // for src/data/constants.js. Loaded on demand rather than with the game — it is a dev tool, and
    // players should not download it to play a match.
    this.tuning = null;
    if (new URLSearchParams(window.location.search).has('tune')) {
      import('./dev/tuning.js').then((m) => { this.tuning = m.startTuning(this); });
    }
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
      squad: Screens.SquadScreen,
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
    // The squad screen only exists inside a live run.
    if (name === 'squad' && !this.isCareerValid()) return this.go('title');
    this.screen = f(this, params);
    this.screen.name = name;
    this.root.appendChild(this.screen.el);
    // The index.html boot splash has painted its last frame once anything real replaces it.
    document.getElementById('boot')?.remove();
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

  startMatch({ home = TEAMS[0], away = TEAMS[1], userTeam = 0, mode = 'quick', seed = undefined }) {
    // A finished match's delayed results transition must never fire into a NEW match (it would
    // dispose it and route to results mid-game).
    clearTimeout(this.finishTimer);
    if (this.screen) {
      this.screen.el.remove();
      this.screen = null;
    }
    if (this.match) this.endMatch();
    // Career fixtures come from the ladder and the coach's own seven, and alternate venue — the
    // crew is not always the away side any more. Resolved before the tip card is built so the
    // matchup on screen is the one that actually starts.
    let careerFixture = null;
    if (mode === 'career' && this.state.career) {
      const fx = fixtureFor(this.state.career);
      if (fx) {
        careerFixture = fx;
        home = fx.home;
        away = fx.away;
        userTeam = fx.userTeam;
      }
    }
    const wrap = document.createElement('div');
    wrap.className = 'match-wrap';
    wrap.innerHTML = `<canvas class="game-canvas"></canvas><div class="hud"></div><div class="tip-overlay"><div class="tip-box"><div class="tip-teams"><span style="--c1:${home.primary}">${home.city} ${home.name}</span><em>VS</em><span style="--c1:${away.primary}">${away.city} ${away.name}</span></div><div class="tip-rule">7-A-SIDE · THREE-RING ZONE · TOP RING 3 · LOW RINGS 1${careerFixture ? ` · ${careerFixture.atHome ? 'HOME WATER' : 'AWAY TRIP'}` : ''}</div></div></div>`;
    this.root.appendChild(wrap);
    const canvas = wrap.querySelector('.game-canvas');
    const difficulty = mode === 'career' && this.state.career ? this.state.career.difficulty : this.state.settings.difficulty;
    const simSeed = matchSeed(seed);
    const sim = new MatchSim({ home, away, difficulty, seed: simSeed, userTeam });

    let renderer;
    try {
      renderer = new MatchRenderer(canvas, sim, {
        ...this.state.settings,
        onContextLost: () => this.handleContextLost(),
        onContextRestored: () => this.handleContextRestored(),
      });
    } catch (e) {
      // Anything thrown while building the scene lands here, not just a genuine WebGL failure.
      // Never guess: report the real error AND the probe, so a phone screenshot is actionable.
      console.error(e);
      wrap.remove();
      const gl = probeWebGL();
      this.lastStartError = { message: e && e.message ? e.message : String(e), gl };
      alert(gl.webgl2 || gl.webgl
        ? `The match failed to start.\n\n${this.lastStartError.message}\n\nWebGL: ${gl.renderer}`
        : `This browser gave us no WebGL context.\n\nError: ${this.lastStartError.message}\n\n`
          + 'Turn on hardware acceleration, or open the page outside an in-app/embedded browser.');
      this.go('title');
      return;
    }
    const hud = new HUD(wrap.querySelector('.hud'), sim);
    const bench = new BenchPanel(wrap, { onSub: () => this.audio.uiConfirm() });
    const replay = new ReplayOverlay(wrap);
    const montage = new MontageOverlay(wrap);
    const replayRecorder = new ReplayRecorder();
    const replayDirector = new ReplayDirector();
    const commentary = new Commentary(sim, (line, pr) => {
      if (this.state.settings.commentary) hud.ticker(line, pr);
      // The announcer speaks the same line it prints. speech() is a no-op on browsers
      // with no usable voice, and the ticker carries the line either way.
      if (this.state.settings.commentary) this.audio.speak(line, pr);
    });
    this.match = { sim, renderer, hud, commentary, bench, replay, montage, replayRecorder, replayDirector, wrap, mode, userTeam, home, away, careerFixture, paused: false, tipTimer: 2.2, finished: false, resultsTimer: 0, touchControls: null };
    // Halftime: the break is dead air unless something is said about it. The montage runs over the
    // frozen pool and auto-dismisses before the second-half kickoff.
    sim.events.on('halftime', () => {
      const m = this.match;
      if (m && m.sim === sim) m.montage.show(sim);
    });
    // The goal replay: cut the clip the instant the ball is in, hold the dead ball still while it
    // plays, then hand the pool back exactly as it was. Recording is a ring buffer fed from the
    // sim clock, so a dropped frame thins the clip instead of stretching it.
    sim.events.on('score', (e) => {
      const m = this.match;
      if (!m || m.sim !== sim || m.finished) return;
      if (this.state.settings.replay === 'off') return;
      const clip = m.replayRecorder.cut({
        scorer: e.player,
        scorerId: e.player ? e.player.id : null,
        team: e.team,
        ring: e.ring,
        points: e.points,
        type: e.type,
        gb: e.gb,
      });
      if (!clip) return;
      m.replayDirector.capture(sim);
      if (m.replayDirector.start(clip, { reducedMotion: this.state.settings.reducedMotion })) {
        m.replay.show(clip);
        this.audio.stinger('style');
      } else m.replayDirector.restore(sim);
    });
    bench.attach(sim);
    // Replay skip: any key or any tap. One-shot, so holding a key through the cut doesn't skip
    // the replay that starts a moment later.
    this._replayTap = false;
    const tapToSkip = () => { this._replayTap = true; };
    wrap.addEventListener('pointerdown', tapToSkip, { passive: true });
    this._replayTapOff = () => wrap.removeEventListener('pointerdown', tapToSkip);
    // On-screen controls for touch devices (and anyone who forces them on in Settings).
    if (this.touchEnabled()) {
      this.match.touchControls = new TouchControls(wrap, this.input, { onPause: () => this.pause(), settings: this.state.settings });
      wrap.classList.add('touch');
      // The touch scheme drives the camera by hand: the boom holds the player's yaw instead of
      // swinging behind their travel heading. That swing is exactly what would make the left-hand
      // stick (read relative to the camera) spiral, so the two cannot coexist.
      renderer.gameCam.manual = true;
      renderer.gameCam.recentre();
      this.input.touch.camYaw = renderer.gameCam.pYaw;
    }
    hud.setHint(
      userTeam === null
        ? this.touchEnabled()
          ? 'WATCHING'
          : 'WATCHING · ESC to leave'
        : this.touchEnabled() || isTouchDevice()
          ? 'LEFT half swims · RIGHT half drag to swing the camera · STRIKE pad: hold to wind up, swipe to aim, lift to shoot · PASS · BURST hold · BLOCK · HIT · TACKLE · GK takes the cage'
          : 'WASD move & aim (aim the pass lead) · SHIFT burst · J shoot (E = gamebreaker) · K pass/call · L juke/slide tackle · I hit · U breach/dive · Q switch · V cage: A/D shuffle, R/F height, U/J dive · 1-3/7-9 plays',
    );
    this.bindMatchAudio(sim);
    if (this.audio.unlocked) {
      this.audio.startBeat('match');
      this.audio.startCrowd();
      this.audio.whistle();
    }
    setTimeout(() => wrap.querySelector('.tip-overlay')?.classList.add('out'), 1800);
    this.input.setKeeperContext(false);
    this.accum = 0;
    this.lastT = performance.now();
  }

  /** Did the player ask to skip the replay? Any key or any tap, one-shot. */
  replaySkipPressed() {
    const tap = this._replayTap;
    const key = this.input.pressed && this.input.pressed.size > 0;
    this._replayTap = false;
    return !!(tap || key);
  }

  /** Hand the pool back: restore every value the replay moved, drop the letterbox, resume. */
  endReplay(m) {
    m.replayDirector.restore(m.sim);
    m.replay.hide();
    m.renderer.gameCam.clearReplay();
    m.replayRecorder.reset();
    // The dead-ball timer kept running while the clip played, so hand the pool back a little
    // more room to breathe before the restart — no one wants the whistle the instant you cut in.
    if (m.sim.state === 'dead') m.sim.stateTimer = Math.max(m.sim.stateTimer, 1.1);
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

  bindMatchAudio(sim) {
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
    ev.on('save', ({ big, dived }) => {
      a.blockHit();
      a.crowdSwell(dived ? 1.3 : big ? 1.1 : 0.6);
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
    // Discipline has its own sound language: the whistle stops everything, a booking is a short
    // sting over a groan, and a red card is the loudest thing in the pool. Subs are a soft blip
    // so a coach's change never masks live action.
    ev.on('foul', ({ red }) => {
      a.whistle();
      if (!red) {
        a.stinger('style');
        a.crowdGroan();
      }
    });
    ev.on('card', ({ red }) => {
      if (red) {
        a.buzzer();
        a.stinger('big');
        a.crowdSwell(1.6);
      } else a.crowdGroan();
    });
    ev.on('sub', () => a.uiConfirm());
    // Taking the cage is its own sound: a low confirm going in, and a whoosh as the keeper dives.
    ev.on('cage', ({ on }) => {
      if (on) {
        a.uiConfirm();
        a.crowdGroan();
      } else a.uiMove();
    });
    ev.on('keeperdive', () => a.whoosh(1.3));
    ev.on('leadpass', ({ big }) => {
      a.whoosh(0.9);
      if (big) a.stinger('style');
    });
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
    this.input.onBlur();
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
    this.input.setEnabled(true);
    this.audio.resume();
    if (this.overlay) this.overlay.el.remove();
    this.overlay = null;
    if (this.settingsOverlay) {
      this.settingsOverlay.el.remove();
      this.settingsOverlay = null;
    }
    this.lastT = performance.now();
  }

  /**
   * The GPU context vanished (driver reset, tab eviction, mobile backgrounding). Freeze the
   * fixed-step clock so the match doesn't keep playing behind a black canvas, and tell the player
   * what happened instead of leaving them staring at an unresponsive pool.
   */
  handleContextLost() {
    const m = this.match;
    if (!m) return;
    m.pausedBeforeLoss = m.paused;
    m.contextLost = true;
    m.paused = true;
    this.audio.suspend();
    m.hud?.popup('SIGNAL LOST', 'RECOVERING…', 0, true, 0);
  }

  /**
   * The browser handed us a fresh context and the renderer rebuilt its post chain. Unfreeze the
   * clock unless the player had deliberately paused before the loss, and reset the frame timer so
   * the first frame back can't consume a huge dt.
   */
  handleContextRestored() {
    const m = this.match;
    if (!m) return;
    m.contextLost = false;
    if (!m.pausedBeforeLoss) {
      m.paused = false;
      this.lastT = performance.now();
      this.accum = 0;
      this.audio.resume();
    }
    m.pausedBeforeLoss = false;
    m.hud?.popup('SIGNAL BACK', 'PLAY ON', 0, true, 0);
  }

  /** Settings over a paused match (pause menu → SETTINGS). BACK returns to the pause menu. */
  openSettingsOverlay() {
    if (!this.match) return;
    const close = () => {
      s.el.remove();
      if (this.settingsOverlay === s) this.settingsOverlay = null;
    };
    const s = Screens.SettingsScreen(this, { onBack: close });
    s.el.classList.add('overlay-screen', 'in');
    this.settingsOverlay = s;
    this.match.wrap.appendChild(s.el);
  }

  endMatch() {
    clearTimeout(this.finishTimer);
    // Both overlays live inside the match wrapper and are removed with it, but leaving stale
    // references here made the NEXT match's pause menu swallow its first ESC: the key handler
    // found a "settings overlay", removed the detached element and returned instead of resuming.
    this.overlay = null;
    this.settingsOverlay = null;
    this._replayTapOff?.();
    this._replayTapOff = null;
    if (!this.match) return;
    this.match.touchControls?.dispose();
    this.match.bench?.dispose();
    this.match.replay?.dispose();
    this.match.montage?.dispose();
    this.match.replayDirector?.dispose();
    this.match.renderer.dispose();
    this.match.wrap.remove();
    this.match = null;
    this.audio.stopCrowd();
    this.audio.stopVoice();
    this.audio.resume();
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
        const venue = m.careerFixture && m.careerFixture.atHome ? 'HOME' : 'AWAY';
        recordResult(c, { won, score: [...sim.score], style: myStyle, margin });
        const progression = awardPlayerProgress(c, { won, style: myStyle, margin });
        c.lastUnlocks = progression.unlocked;
        // Knock-on effects for the next fixture: injuries bite, form swings.
        const hurt = rollInjuries(c, sim, m.userTeam);
        const bits = [`+${c.rep - before} REP`, careerTitle(c)];
        if (progression.unlocked.length) bits.push(progression.unlocked.join(' + '));
        if (hurt.length) bits.push(`OUT: ${hurt.map((i) => `${i.nick}${i.matches > 1 ? ` (${i.matches})` : ''}`).join(', ')}`);
        careerResult = won
          ? `${venue} · ${bits.join(' · ')}${c.complete ? ' · YOU BEAT EVERY CREW. LEGEND DIFFICULTY UNLOCKED.' : ` · NEXT: ${currentOpponent(c).city.toUpperCase()}`}`
          : `${venue} · ${bits.join(' · ')} · Run it back to move up the ladder.`;
        if (c.complete) this.state.unlocked.legendMode = true;
      }
      this.save();
    }
    this.finishTimer = setTimeout(() => {
      if (!this.match) return;
      const params = { sim, mode: m.mode, userTeam: m.userTeam, careerResult };
      // A natural game end used to dispose the match inline, which skipped the overlay bookkeeping
      // endMatch() does — so a settings overlay open at the final whistle stayed referenced and
      // made the next match's pause menu swallow its first ESC. Route it through endMatch so there
      // is exactly one teardown path.
      this.endMatch();
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
    // Frame interval first: every path below (menu, paused, montage, replay, live) is a rendered
    // frame and the player feels all of them. `lastT` is deliberately not used for this — it is
    // reset on resume/start so it cannot measure a gap it did not cause.
    this.perf.frame(now);
    this.perfOverlay?.update(this.perf.summary(), now);
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
      this.input.setKeeperContext(m.sim.inCage, m.sim.attackDir(m.sim.userTeam));
      const input = this.input.poll();
      // Touch camera: hand this frame's drag to the boom. The yaw comes back the other way, just
      // below, so the left-hand stick is read relative to the camera.
      if (m.touchControls) {
        const look = this.input.consumeLook();
        if (!m.sim.inCage && (look.x || look.y)) m.renderer.gameCam.orbit(look.x, look.y);
      }
      // Halftime montage: runs over the frozen pool, dismissed by a tap or a key, and always
      // closes itself before the second half starts so it can never sit on top of live play.
      if (m.montage.shown) {
        m.montage.tick(dt);
        if (this.replaySkipPressed()) m.montage.dismiss();
        m.bench?.close();
        m.renderer.update(dt);
        m.hud.update();
        m.renderer.render();
        if (m.sim.state === 'live') m.montage.hide();
        return;
      }
      // A goal replay owns the frame: the sim is frozen (the ball is dead anyway) and the recorded
      // pose is driven straight onto the entities, so the character rig and ball mesh replay the
      // move for free. Any tap or key skips straight back to live.
      const replaying = m.replayDirector.playing;
      if (replaying) {
        if (this.replaySkipPressed()) this.endReplay(m);
        else {
          m.replayDirector.pose(m.sim);
          const ball = m.replayDirector.ballAt();
          const focus = m.sim.players.find((p) => p.id === m.replayDirector.clip.scorerId) || null;
          const prog = m.replayDirector.progress;
          m.replay.progress(prog);
          m.renderer.gameCam.replayShot(m.sim, ball, prog, focus, m.replayDirector.clip.team, dt);
          m.renderer.update(dt, true);
          m.hud.update();
          m.renderer.render();
          m.replayDirector.advance(dt);
          if (!m.replayDirector.playing) this.endReplay(m);
        }
        return;
      }
      if (m.userTeam !== null) m.sim.setUserInput(input);
      // Bench hotkeys: T opens the panel; while it is open 1-4 make a change. Handled here rather
      // than in InputManager because they are UI navigation, not simulation input — and they must
      // not reach the sim at all, or a sub keypress would also fire a play call.
      if (m.bench) {
        if (m.bench.open) {
          for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyT', 'Escape']) {
            if (this.input.justPressed(code)) m.bench.handleKey(code);
          }
        } else if (this.input.justPressed('KeyT') && m.sim.state !== 'live') {
          m.bench.show();
        }
      }
      // Fixed-step simulation
      this.accum += dt;
      const step = PHYS.fixedDt;
      let n = 0;
      const simT0 = performance.now();
      while (this.accum >= step && n < MAX_STEPS_PER_FRAME) {
        m.sim.step(step);
        m.replayRecorder.record(m.sim, step);
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
        input.cage = false;
        input.playcall = 0;
      }
      this.perf.sample('sim', performance.now() - simT0);
      // Spiral-of-death guard: the loop above can only drain MAX_STEPS_PER_FRAME steps, but a slow
      // frame can hand it more than that (dt is clamped to 0.1s, which is six steps at 1/60). Any
      // leftover is a backlog we have already fallen behind by — keeping it makes the sim run
      // permanently behind the wall clock, so the match crawls in slow motion and never recovers,
      // and each slow frame adds more. Drop the excess instead and let the sim fall back onto real
      // time; the match clock is simulated anyway, so losing backlog only skips catch-up frames.
      if (this.accum > step) this.accum = step;
      // Only release latched edges once a step has actually consumed them, otherwise a tap that
      // lands on a frame with no fixed step (120 Hz displays) is silently dropped.
      if (n > 0) this.input.flushOneShots();
      // Light up the SHOOT anchor as soon as the controlled side's meter is full. The pad itself
      // is permanent — no button relabels or reroutes itself during play.
      if (m.touchControls && m.userTeam !== null) {
        m.touchControls.setMatchState(m.sim);
        m.touchControls.setGamebreakerReady(!!m.sim.gbReady[m.userTeam]);
        m.touchControls.setCage(!m.sim.inCage && m.sim.keeperSwitchCd <= 0 && m.sim.cageAvailable(), m.sim.inCage);
      }
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
      if (m.touchControls) this.input.touch.camYaw = m.renderer.gameCam.pYaw;
      m.hud.update();
      // Bench panel: opens itself at a stoppage (foul, goal reset, the break) so the change can be
      // made while the ball is dead, and never covers live play.
      if (m.bench && m.sim.subWindow > 0 && m.sim.state !== 'live' && m.sim.userTeam !== null) m.bench.show();
      else if (m.bench && m.bench.open && m.sim.state === 'live') m.bench.close();
      // CPU cost of submitting the frame (gl.finish() is never called in the real loop, so the
      // GPU's own time is not included — this is the budget the game can actually act on).
      const info = m.renderer.renderer.info;
      // The composer draws several passes per frame and three resets these counters at the start of
      // every render() call, so reading them after composer.render() would report only the last pass
      // (a full-screen quad: one draw call). Reset by hand instead and read the whole frame — the
      // same thing tools/perfshot.mjs and tools/mergecheck.mjs measure.
      info.autoReset = false;
      info.reset();
      const renderT0 = performance.now();
      m.renderer.render();
      this.perf.sample('render', performance.now() - renderT0);
      this.perf.counters({
        calls: info.render.calls,
        triangles: info.render.triangles,
        programs: info.programs.length,
      });
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

/**
 * `?diag` paints an on-screen capability report instead of the game. A real phone's WebGL failure
 * cannot be reproduced headlessly (swiftshader always succeeds), so this is how we read the actual
 * device state off a screenshot: which contexts exist, the unmasked GPU string, and the real error
 * from the last failed match start, if any.
 */
function showDiag() {
  const gl = probeWebGL();
  const err = window.app && window.app.lastStartError;
  const rows = [
    ['user agent', navigator.userAgent],
    ['webgl2', String(gl.webgl2)],
    ['webgl', String(gl.webgl)],
    ['gpu', gl.renderer],
    ['vendor', gl.vendor],
    ['max texture', String(gl.maxTexture || '-')],
    ['screen', `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`],
    ['dpr capped', String(window.devicePixelRatio || 1)],
    ['last start error', err ? err.message : 'none yet — start a match and come back'],
  ];
  const pre = document.createElement('pre');
  pre.id = 'diag';
  pre.style.cssText = 'position:fixed;inset:0;z-index:99999;margin:0;padding:16px;'
    + 'background:#06101a;color:#8ff7ff;font:12px/1.5 ui-monospace,monospace;'
    + 'white-space:pre-wrap;word-break:break-word;overflow:auto;';
  pre.textContent = `BLITZBALL X — device report\n\n${rows.map(([k, v]) => `${k.padEnd(16)} ${v}`).join('\n')}\n`;
  document.body.appendChild(pre);
  window.__diag = { gl, rows };
}

window.addEventListener('DOMContentLoaded', () => {
  // `?bench=anim` swaps in the single-swimmer animation bench (see ./dev/animbench.js); it
  // returns null for a normal load, so the real App always wins by default.
  window.app = startAnimBench() || new App();
  if (new URLSearchParams(window.location.search).has('diag')) showDiag();
});
