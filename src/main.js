/** Blitzball-X browser entry point: modern MatchSim, 3D presentation, menus, HUD, and touch. */

import * as THREE from 'three';
import { Capacitor } from '@capacitor/core';
import '@fontsource/bangers/latin-400.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/permanent-marker/latin-400.css';
import './styles.css';
import { GameRenderer } from './render/renderer.js';
import { SpherePoolEnvironment } from './render/court.js';
import { MatchScene } from './render/match-scene.js';
import { MatchSim } from './game/match.js';
import { TEAMS, TEAM_BY_ID } from './data/teams.js';
import {
  awardPlayerProgress,
  createCareer,
  currentOpponent,
  fixtureFor,
  recordResult,
  rollInjuries,
} from './game/career.js';
import { FrameMonitor, PerfOverlay, perfEnabled } from './dev/perf.js';
import { InputManager } from './ui/input.js';
import { MatchHUD } from './ui/match-hud.js';
import { TouchControls } from './ui/touch.js';
import { BenchPanel } from './ui/bench.js';
import { SoundEngine } from './ui/audio.js';
import {
  CareerScreen,
  HowToScreen,
  PauseOverlay,
  ResultsScreen,
  RosterScreen,
  SettingsScreen,
  SquadScreen,
  TeamSelectScreen,
  TitleScreen,
} from './ui/screens.js';

const SAVE_KEY = 'blitzball_x_save_data_v1';

/** Dev-tool flag convention shared with src/dev/* (“?perf”, “?tune”, “?bench”). */
function hasFlag(name) {
  try {
    return new URLSearchParams(window.location.search).has(name);
  } catch {
    return false;
  }
}
const DEFAULT_SETTINGS = Object.freeze({
  // The channel gains default to 1 so existing saves keep the old overall loudness.
  masterVolume: 0.8,
  musicVolume: 1,
  sfxVolume: 1,
  quality: 'medium',
  resolution: 'auto',
  fullscreen: false,
  difficulty: 'pro',
  screenShake: true,
  reducedMotion: false,
  touchControls: 'auto',
  touchLayout: 'right',
  touchScale: 1,
  touchOpacity: 0.82,
});

function freshState() {
  return {
    career: null,
    records: { wins: 0, losses: 0, styleBest: 0 },
    settings: { ...DEFAULT_SETTINGS },
  };
}

function readState() {
  const defaults = freshState();
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return defaults;
    const career = raw.career && typeof raw.career.teamId === 'string' && Array.isArray(raw.career.ladder)
      ? raw.career
      : null;
    const settings = { ...defaults.settings, ...(raw.settings || {}) };
    if (!['low', 'medium', 'high'].includes(settings.quality)) settings.quality = DEFAULT_SETTINGS.quality;
    if (!['auto', '720p', '1080p', '1440p'].includes(settings.resolution)) settings.resolution = DEFAULT_SETTINGS.resolution;
    if (!['easy', 'pro', 'legend'].includes(settings.difficulty)) settings.difficulty = DEFAULT_SETTINGS.difficulty;
    if (!['auto', 'on', 'off'].includes(settings.touchControls)) settings.touchControls = DEFAULT_SETTINGS.touchControls;
    if (!['left', 'right'].includes(settings.touchLayout)) settings.touchLayout = DEFAULT_SETTINGS.touchLayout;
    for (const key of ['masterVolume', 'musicVolume', 'sfxVolume']) {
      const value = Number(settings[key]);
      settings[key] = Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : DEFAULT_SETTINGS[key];
    }
    // Fullscreen is permission-gated and is never restored without a fresh user gesture.
    settings.fullscreen = false;
    const records = { ...defaults.records, ...(raw.records || {}) };
    return { career, records, settings };
  } catch (error) {
    console.warn('[Blitzball-X] Could not read local save; starting fresh.', error);
    return defaults;
  }
}

function cleanPlayerName(name) {
  return String(name || 'Rookie').replace(/[<>]/g, '').trim().slice(0, 18) || 'Rookie';
}

export class BlitzballApp {
  constructor() {
    this.container = document.getElementById('app') || document.body;
    document.getElementById('boot')?.remove();
    this.state = readState();
    this.onFullscreenChange = () => this.handleFullscreenChange();
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.teams = TEAMS;
    this.audio = new SoundEngine();
    this.input = new InputManager();
    this.input.onPause = () => this.togglePause();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020c17);
    this.camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 120);
    this.camera.position.set(0, 8, 22);
    this.camera.lookAt(0, 0, 0);
    this.environment = new SpherePoolEnvironment(this.scene);

    this.matchWrap = document.createElement('div');
    this.matchWrap.className = 'match-wrap';
    this.matchWrap.style.display = 'none';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.matchWrap.appendChild(this.canvas);
    this.container.appendChild(this.matchWrap);

    this.renderer = new GameRenderer(this.canvas);
    this.renderer.setQuality(this.state.settings.quality);
    this.hud = new MatchHUD(this.matchWrap, this.audio);
    this.touchControls = new TouchControls(this.matchWrap, this.input, this.state.settings, {
      onPause: () => this.togglePause(),
    });
    this.bench = new BenchPanel(this.matchWrap, {
      onSub: () => {
        this.audio.playWaterSplash(0.45);
        this.hud.showTicker('CHANGE QUEUED · NEXT STOPPAGE', 1400);
      },
    });

    this.match = null;
    this.sceneView = null;
    this.currentScreen = null;
    this.currentScreenObject = null;
    this.pauseOverlay = null;
    this.settingsOverlay = null;
    this.matchSequence = 0;
    this.lastTime = performance.now();
    this.isRunning = true;

    this.onResize = () => {
      this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this.onResize, { passive: true });

    // Frame instrumentation (src/dev/perf.js). Recording is always on — one timestamp and one
    // ring-buffer write per frame — so the QA tools (tools/probe.mjs, tools/perfshot.mjs), a
    // player's own device and the CI gates all read the same tail through window.__BB_PERF__.
    // Only the on-screen readout is opt-in, via ?perf.
    this.monitor = new FrameMonitor();
    window.__BB_PERF__ = this.monitor;
    this.perfOverlay = perfEnabled() ? new PerfOverlay(document.body) : null;
    // Dev panels are dynamically imported: a normal load never fetches them, and tools/devtools.mjs
    // fails loudly if either stops mounting.
    this.tuningPanel = null;
    if (hasFlag('tune')) import('./dev/tuning.js').then(({ startTuning }) => { this.tuningPanel = startTuning(this); });
    if (hasFlag('bench')) import('./dev/animbench.js').then(({ startAnimBench }) => startAnimBench());

    this.audio.applyVolumes(this.state.settings);
    this.audio.startSpherePoolAmbience();
    this.applyQuality(this.state.settings.quality);
    this.go('title');
    requestAnimationFrame((time) => this.gameLoop(time));
  }

  get screen() {
    return this.currentScreen ? { name: this.currentScreen } : null;
  }

  touchEnabled() {
    return !!this.touchControls?.enabledByMode;
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...this.state, updatedAt: Date.now() }));
    } catch (error) {
      console.warn('[Blitzball-X] Save unavailable in this browser session.', error);
    }
  }

  /** Apply the graphics profile and render-buffer target from the saved settings model. */
  applyQuality(quality = this.state.settings.quality) {
    this.renderer.setQuality(quality);
    this.renderer.setResolution(this.state.settings.resolution);
  }

  /** Keep the settings model and visible selector in sync with browser-initiated exits too. */
  handleFullscreenChange() {
    const fullscreen = !!document.fullscreenElement;
    if (this.state?.settings) {
      this.state.settings.fullscreen = fullscreen;
      const selector = this.container.querySelector('.set-row[data-key="fullscreen"] select');
      if (selector) selector.value = fullscreen ? 'true' : 'false';
      this.save();
    }
  }

  /** Fullscreen is a browser permission, so this must be called directly from a user gesture. */
  async setFullscreen(enabled) {
    const root = document.documentElement;
    try {
      if (enabled) {
        if (document.fullscreenElement) return true;
        if (!document.fullscreenEnabled || typeof root.requestFullscreen !== 'function') return false;
        await root.requestFullscreen();
      } else if (document.fullscreenElement) {
        if (typeof document.exitFullscreen !== 'function') return false;
        await document.exitFullscreen();
      }
      return !!document.fullscreenElement === !!enabled;
    } catch (error) {
      console.warn('[Blitzball-X] The browser denied the fullscreen request.', error);
      return false;
    }
  }

  /**
   * A web page cannot force-close a tab. Native Capacitor builds use the App plugin; browsers get
   * a best-effort window.close() followed by a clear, non-blocking explanation if it stays open.
   */
  async requestQuit() {
    if (Capacitor.isNativePlatform()) {
      // iOS apps should be left with the system Home gesture rather than terminated by code.
      if (Capacitor.getPlatform() === 'ios') {
        this.showNotice('Use your device’s Home gesture or app switcher to leave Blitzball-X.');
        return;
      }
      try {
        const { App } = await import('@capacitor/app');
        await App.exitApp();
        return;
      } catch (error) {
        console.warn('[Blitzball-X] Native exit was unavailable.', error);
        this.showNotice('Use your device’s Home button or app switcher to leave Blitzball-X.');
        return;
      }
    }

    if (import.meta.env.DEV) {
      console.info('[Blitzball-X] Browser development builds cannot close their own tab.');
    }
    try { window.close(); } catch { /* Browser policy may reject closing a user-opened tab. */ }
    window.setTimeout(() => {
      if (!window.closed) this.showNotice('Close this browser tab or window to exit Blitzball-X.');
    }, 80);
  }

  showNotice(message) {
    this.container.querySelector('.app-notice')?.remove();
    const notice = document.createElement('div');
    notice.className = 'app-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = message;
    this.container.appendChild(notice);
    requestAnimationFrame(() => notice.classList.add('show'));
    window.setTimeout(() => {
      notice.classList.remove('show');
      window.setTimeout(() => notice.remove(), 250);
    }, 4200);
  }

  releasePointerLock() {
    if (document.pointerLockElement && typeof document.exitPointerLock === 'function') {
      document.exitPointerLock();
    }
  }

  returnToTitleFromPause() {
    if (this.match) this.match.paused = false;
    this.releasePointerLock();
    this.go('title');
  }

  resetAll() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* private browsing may block storage */ }
    if (document.fullscreenElement) this.setFullscreen(false);
    this.state = freshState();
    this.audio.applyVolumes(this.state.settings);
    this.applyQuality(this.state.settings.quality);
    this.go('title');
  }

  clearScreen() {
    if (!this.currentScreenObject?.el) return;
    const old = this.currentScreenObject;
    old.el.classList.remove('in');
    old.el.style.pointerEvents = 'none';
    setTimeout(() => old.el.remove(), 280);
    this.currentScreenObject = null;
    this.currentScreen = null;
  }

  go(name, params = {}) {
    if (this.match && name !== 'results') this.disposeMatch();
    else if (this.match && name === 'results') this.match.paused = true;
    this.matchWrap.style.display = 'none';
    this.touchControls?.setMatchVisible(false);
    this.pauseOverlay?.el?.remove();
    this.pauseOverlay = null;
    this.settingsOverlay?.remove();
    this.settingsOverlay = null;
    this.clearScreen();

    const routes = {
      title: () => TitleScreen(this),
      teamselect: () => TeamSelectScreen(this, params),
      career: () => CareerScreen(this),
      squad: () => SquadScreen(this),
      roster: () => RosterScreen(this, params),
      howto: () => HowToScreen(this),
      settings: () => SettingsScreen(this, params),
      results: () => ResultsScreen(this, params),
    };
    const create = routes[name];
    if (!create) {
      console.warn(`[Blitzball-X] Unknown screen: ${name}`);
      return this.go('title');
    }
    try {
      const screen = create();
      screen.el.classList.add('in');
      this.container.appendChild(screen.el);
      this.currentScreen = name;
      this.currentScreenObject = screen;
      if (name === 'settings') this.audio.applyVolumes(this.state.settings);
      return screen;
    } catch (error) {
      console.error(`[Blitzball-X] Could not open ${name} screen.`, error);
      if (name !== 'title') return this.go('title');
      throw error;
    }
  }

  startCareer(teamId, player = {}) {
    if (!TEAM_BY_ID[teamId]) return;
    const name = cleanPlayerName(player.name);
    this.state.career = createCareer(teamId, this.state.settings.difficulty, { ...player, name });
    this.save();
    this.startMatch({ mode: 'career' });
  }

  startMatch(options = {}) {
    this.disposeMatch();
    let { home, away, userTeam = 0, mode = 'quick', seed: suppliedSeed } = options;
    if (mode === 'career') {
      const career = this.state.career;
      const fixture = career && fixtureFor(career);
      if (!fixture || !currentOpponent(career)) {
        this.go('career');
        return null;
      }
      home = fixture.home;
      away = fixture.away;
      userTeam = fixture.userTeam;
    }
    if (!home || !away) {
      home = TEAMS[0];
      away = TEAMS[1];
    }

    this.matchSequence++;
    const seed = Number.isInteger(suppliedSeed)
      ? suppliedSeed >>> 0
      : (Date.now() ^ (this.matchSequence * 2654435761)) >>> 0;
    const sim = new MatchSim({
      home,
      away,
      difficulty: this.state.settings.difficulty,
      seed,
      userTeam,
    });
    this.sceneView = new MatchScene(this.scene, this.camera, this.environment, this.state.settings);
    this.sceneView.attach(sim);
    this.sceneView.update(sim, 0);
    this.hud.attach(sim);
    this.hud.showBanner('DIVE IN', 'WARM-UP LAPS · GET A FEEL FOR THE POOL', 1700);
    this.touchControls.attach(sim, this.sceneView.gameCam);
    this.bench.attach(sim);
    this.match = {
      sim,
      mode,
      userTeam,
      renderer: this.sceneView,
      hud: this.hud,
      touchControls: this.touchControls,
      bench: this.bench,
      paused: false,
      completeHandled: false,
      settingsOverlay: null,
    };
    this.clearScreen();
    this.matchWrap.style.display = 'block';
    this.currentScreen = 'match';
    this.currentScreenObject = null;
    this.audio.unlock();
    this.audio.playRefWhistle();
    return this.match;
  }

  disposeMatch() {
    if (!this.match && !this.sceneView) return;
    this.releasePointerLock();
    this.pauseOverlay?.el?.remove();
    this.pauseOverlay = null;
    this.settingsOverlay?.remove();
    this.settingsOverlay = null;
    this.bench.dispose();
    this.hud.detach();
    this.touchControls.attach(null, null);
    this.sceneView?.dispose();
    this.sceneView = null;
    this.match = null;
    this.matchWrap.classList.remove('touch');
    this.matchWrap.style.display = 'none';
    this.input.flushOneShots();
    this.input.touch.active = false;
    this.input.touch.shootHeld = false;
    this.input.touch.turbo = false;
  }

  togglePause() {
    if (!this.match) return false;
    if (this.settingsOverlay) {
      this.closeSettingsOverlay();
      return true;
    }
    if (this.match.paused) {
      this.resumeMatch();
      return true;
    }
    this.match.paused = true;
    this.releasePointerLock();
    this.input.flushOneShots();
    this.pauseOverlay = PauseOverlay(this, {
      onResume: () => this.resumeMatch(),
      onQuit: () => this.returnToTitleFromPause(),
      onRestart: () => this.startMatch({
        home: this.match?.sim.teams[0],
        away: this.match?.sim.teams[1],
        userTeam: this.match?.userTeam,
        mode: this.match?.mode,
      }),
    });
    this.matchWrap.appendChild(this.pauseOverlay.el);
    return true;
  }

  resumeMatch() {
    this.pauseOverlay?.el?.remove();
    this.pauseOverlay = null;
    if (this.match) this.match.paused = false;
    this.input.flushOneShots();
  }

  openSettingsOverlay() {
    if (!this.match || this.settingsOverlay) return;
    const screen = SettingsScreen(this, { onBack: () => this.closeSettingsOverlay() });
    screen.el.classList.add('in', 'overlay-screen');
    this.matchWrap.appendChild(screen.el);
    this.settingsOverlay = screen.el;
    this.match.settingsOverlay = screen.el;
  }

  closeSettingsOverlay() {
    this.settingsOverlay?.remove();
    this.settingsOverlay = null;
    if (this.match) this.match.settingsOverlay = null;
  }

  handleMatchCompletion() {
    if (!this.match || this.match.completeHandled) return;
    this.match.completeHandled = true;
    const { sim, mode, userTeam } = this.match;
    let careerResult = '';
    if (userTeam !== null) {
      const won = sim.winner === userTeam;
      const style = sim.teamPlayers(userTeam).reduce((total, p) => total + p.stats.style, 0);
      this.state.records[won ? 'wins' : 'losses']++;
      this.state.records.styleBest = Math.max(this.state.records.styleBest || 0, style);
      if (mode === 'career' && this.state.career) {
        const margin = sim.score[userTeam] - sim.score[1 - userTeam];
        recordResult(this.state.career, { won, score: [...sim.score], style, margin });
        const injuries = rollInjuries(this.state.career, sim, userTeam);
        const progress = awardPlayerProgress(this.state.career, { won, margin, style });
        careerResult = `+${progress.earned} XP · ${won ? 'REP EARNED' : 'LESSON LEARNED'}`;
        if (progress.unlocked.length) careerResult += ` · UNLOCKED ${progress.unlocked.join(', ')}`;
        if (injuries.length) careerResult += ` · ${injuries.length} SWIMMER${injuries.length === 1 ? '' : 'S'} BANGED UP`;
      }
      this.save();
    }
    this.audio.playRefWhistle();
    this.go('results', { sim, mode, userTeam, careerResult });
  }

  gameLoop(now) {
    if (!this.isRunning) return;
    const dt = Math.max(0, Math.min((now - this.lastTime) / 1000, 0.1));
    this.lastTime = now;
    // Match simulation time is stopped while paused. Keep rendering the overlay, but do not advance
    // the shared water environment or any match presentation clocks behind it.
    this.environment.update(this.match?.paused ? 0 : dt);

    if (this.match && this.currentScreen === 'match') {
      const { sim } = this.match;
      if (!this.match.paused) {
        const drag = this.input.consumeLook();
        this.sceneView.gameCam.orbit(drag.x, drag.y);
        this.input.touch.camYaw = this.sceneView.gameCam.pYaw + this.sceneView.gameCam.orbitYaw;
        this.input.setKeeperContext(sim.inCage, sim.userTeam === null ? 1 : sim.attackDir(sim.userTeam));
        const sampled = this.input.poll();
        if (!this.match.paused) {
          sim.setUserInput(sampled);
          const simStart = performance.now();
          sim.step(dt);
          this.monitor.sample('sim', performance.now() - simStart);
        }
        this.input.flushOneShots();
      } else {
        this.input.consumeLook();
        this.pauseOverlay?.onNav(this.input.menuPoll());
      }
      this.sceneView.update(sim, this.match.paused ? 0 : dt);
      this.hud.update(sim);
      this.touchControls.update(sim);
      if (sim.state === 'over') this.handleMatchCompletion();
    } else {
      this.currentScreenObject?.onNav?.(this.input.menuPoll());
    }

    const renderStart = performance.now();
    this.renderer.render(this.scene, this.camera, dt);
    this.monitor.sample('render', performance.now() - renderStart);
    // What the frame actually asked the GPU to do, read back for the overlay and the perf gate.
    const info = this.renderer.renderer.info;
    this.monitor.counters({
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs ? info.programs.length : 0,
    });
    this.monitor.frame(now);
    this.perfOverlay?.update(this.monitor.summary());
    requestAnimationFrame((time) => this.gameLoop(time));
  }

  destroy() {
    this.isRunning = false;
    this.perfOverlay?.dispose();
    this.tuningPanel?.dispose?.();
    this.disposeMatch();
    this.touchControls.destroy();
    this.input.destroy();
    this.renderer.destroy();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = new BlitzballApp();
  });
}
