/** Blitzball-X browser entry point: modern MatchSim, 3D presentation, menus, HUD, and touch. */

import * as THREE from 'three';
import { Capacitor } from '@capacitor/core';
import '@fontsource/bangers/latin-400.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/permanent-marker/latin-400.css';
import './styles.css';
import { GameRenderer } from './render/renderer.js';
import { RULES } from './data/constants.js';
import { getMode, rulesFor } from './game/modes.js';
import {
  applyGauntletResult,
  createGauntletRun,
  gauntletMatch,
  gauntletProgress,
  sanitizeGauntletRun,
} from './game/gauntlet.js';
import { gradeTrials } from './game/trials.js';
import { createRankedProfile } from './game/ranked.js';
import { Commentary } from './ui/commentary.js';
import { MontageOverlay } from './ui/montage.js';
import { ReplayRecorder, ReplayDirector } from './game/replay.js';
import { ReplayOverlay } from './ui/replay.js';
import { ModesScreen, RankedScreen, CustomScreen, LobbyScreen, recordRankedResult } from './ui/modes-screen.js';
import { CloudApi } from './net/api.js';
import { GauntletScreen } from './ui/gauntlet-screen.js';
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
    // Competitive state: the ladder profile, the crew the player runs with on it, and the last
    // custom rule set so a custom match does not start from scratch every time.
    ranked: null,
    rankedTeamId: null,
    customRules: null,
    playerName: '',
    // A Gauntlet run is a saved object, not a match: it has to survive a reload for the mode to
    // mean anything. `gauntletBest` is the record the hub shows between runs.
    gauntlet: null,
    gauntletTeamId: null,
    gauntletBest: null,
  };
}

/**
 * Rebuild a state object from a raw payload — the local save, or a copy pulled from the cloud.
 *
 * Both go through the same rules: anything that does not make sense is dropped rather than
 * trusted, so a hand-edited save or a stale cloud copy cannot poison the game.
 *
 * @param {any} raw
 */
export function sanitizeState(raw) {
  const defaults = freshState();
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
  // Ladder saves come from an older build too, so only keep shapes that still make sense.
  const ranked = raw.ranked && Number.isFinite(Number(raw.ranked.rating))
    ? { ...createRankedProfile(), ...raw.ranked }
    : null;
  const rankedTeamId = typeof raw.rankedTeamId === 'string' ? raw.rankedTeamId : null;
  const customRules = raw.customRules && typeof raw.customRules === 'object' ? raw.customRules : null;
  const playerName = typeof raw.playerName === 'string' ? raw.playerName.slice(0, 18) : '';
  const gauntlet = sanitizeGauntletRun(raw.gauntlet);
  const gauntletTeamId = typeof raw.gauntletTeamId === 'string' ? raw.gauntletTeamId : null;
  const gauntletBest = raw.gauntletBest && Number.isInteger(raw.gauntletBest.stage)
    ? { stage: raw.gauntletBest.stage, cleared: !!raw.gauntletBest.cleared }
    : null;
  const updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0;
  return {
    career,
    records,
    settings,
    ranked,
    rankedTeamId,
    customRules,
    playerName,
    gauntlet,
    gauntletTeamId,
    gauntletBest,
    updatedAt,
  };
}

function readState() {
  try {
    return sanitizeState(JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'));
  } catch (error) {
    console.warn('[Blitzball-X] Could not read local save; starting fresh.', error);
    return freshState();
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
    this.splitCamera = null;
    this.montage = null;
    this.commentary = null;
    this.online = null;
    // The optional backend: a cloud copy of the save, the global board, the duel server's rooms.
    // Nothing here is required to play — with no backend the game behaves exactly as before.
    this.cloud = new CloudApi();
    this.currentScreen = null;
    this.currentScreenObject = null;
    this.pauseOverlay = null;
    this.settingsOverlay = null;
    // Latest series tally from the duel server, for the HUD, the results screen and the lobby.
    this.duelSeries = null;
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
    // Reconcile the save with the cloud in the background: the game is already playable while it
    // runs, and a backend that is not there simply leaves the local save alone.
    this.syncCloud();
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
      this.state.updatedAt = Date.now();
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.warn('[Blitzball-X] Save unavailable in this browser session.', error);
    }
    // The cloud copy follows the local one, batched: a match writes the save several times a
    // second and the server only needs the last write.
    this.cloud?.schedulePush(this.state);
  }

  /**
   * Reconcile the local save with the cloud copy.
   *
   * Newest wins, in both directions: a cloud copy that is newer than the local one is adopted,
   * otherwise the local one is pushed. The server applies the same rule, so two devices can race
   * without either one corrupting the other.
   *
   * @returns {Promise<Object|null>} the cloud copy that was adopted, if any
   */
  async syncCloud() {
    const device = await this.cloud.ensureDevice();
    if (!device) return null;
    const cloud = await this.cloud.pullSave();
    const localAt = Number(this.state.updatedAt) || 0;
    if (cloud && Number(cloud.updatedAt) > localAt) {
      this.state = sanitizeState(cloud);
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
      } catch {
        /* a blocked storage just means the cloud copy stays the newest one */
      }
      this.cloud.schedulePush(this.state);
      return cloud;
    }
    await this.cloud.pushSave(this.state);
    return null;
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
    // The lobby and the results screen are the two places a duel socket has to stay open: one is
    // where a series is formed, the other is where the next round is agreed. Everywhere else the
    // session is closed so a player who walks away does not leave a ghost in a room.
    if (this.online && name !== 'lobby' && name !== 'results') {
      this.online.leave();
      this.online = null;
      this.duelSeries = null;
    }
    this.matchWrap.style.display = 'none';
    this.touchControls?.setMatchVisible(false);
    this.pauseOverlay?.el?.remove();
    this.pauseOverlay = null;
    this.settingsOverlay?.remove();
    this.settingsOverlay = null;
    this.clearScreen();

    const routes = {
      title: () => TitleScreen(this),
      modes: () => ModesScreen(this),
      ranked: () => RankedScreen(this),
      custom: () => CustomScreen(this),
      gauntlet: () => GauntletScreen(this),
      lobby: () => LobbyScreen(this, params),
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

  /**
   * Start a match under a mode from the registry.
   *
   * Everything mode-specific is decided here in one place: the seat list, the rule snapshot, the
   * number of cameras and whether input comes from the keyboard, a second keyboard or a socket.
   * @param {{ home?:Object, away?:Object, modeId?:string, seats?:number[], rules?:Object,
   *           seed?:number, difficulty?:string, online?:Object, cameraSeat?:number }} options
   */
  startMatch(options = {}) {
    this.disposeMatch();
    const ALIAS = { versus: 'watch', online: 'series', exhibition: 'quick', blitzball: 'quick' };
    let { home, away, seats = null, rules = null } = options;
    // `mode` is the older spelling and `modeId` the registry one. Both are accepted, because a
    // caller that gets the spelling wrong would otherwise start a match under the wrong
    // rulebook and never know why it felt different.
    let modeId = options.modeId || options.mode || 'quick';
    const { seed: suppliedSeed, online = null, cameraSeat = 0, round = 1, series = null } = options;
    modeId = ALIAS[modeId] || modeId;
    let difficulty = options.difficulty || this.state.settings.difficulty;

    // A Gauntlet match is built from the saved run: crews, rung rules and difficulty all come
    // from the run object, so the screen and the sim can never disagree about the rung.
    if (modeId === 'gauntlet' && !rules) {
      const run = this.state.gauntlet;
      const fixture = run && !run.over ? gauntletMatch(run, TEAMS) : null;
      if (!fixture) {
        this.go('gauntlet');
        return null;
      }
      home = home || fixture.home;
      away = away || fixture.away;
      rules = fixture.rules;
      difficulty = fixture.difficulty;
    }

    if (modeId === 'career') {
      const career = this.state.career;
      const fixture = career && fixtureFor(career);
      if (!fixture || !currentOpponent(career)) {
        this.go('career');
        return null;
      }
      home = fixture.home;
      away = fixture.away;
      // The career side alternates home and away, so the seat has to follow the fixture: the
      // player pilots their own crew even when it is the one playing away.
      seats = seats || [fixture.userTeam ?? 0];
      difficulty = career.difficulty || difficulty;
    }
    if (!home || !away) {
      home = TEAMS[0];
      away = TEAMS[1];
    }

    const mode = getMode(modeId);
    const seatTeams = Array.isArray(seats)
      ? seats.slice(0, 2)
      : mode.seats <= 0
        ? []
        : mode.seats >= 2
          ? [0, 1]
          : [0];

    this.matchSequence++;
    const seed = Number.isInteger(suppliedSeed)
      ? suppliedSeed >>> 0
      : (Date.now() ^ (this.matchSequence * 2654435761)) >>> 0;
    const sim = new MatchSim({
      home,
      away,
      difficulty,
      seed,
      seats: seatTeams,
      rules: rulesFor(modeId, RULES, rules),
      mode: modeId,
    });
    this.sceneView = new MatchScene(this.scene, this.camera, this.environment, this.state.settings);
    this.sceneView.attach(sim);
    this.sceneView.update(sim, 0);

    // A local duel gets a second camera and a split render; an online duel shares one screen but
    // rides whichever seat this client owns.
    const split = seatTeams.length > 1 && !online;
    if (split) {
      if (!this.splitCamera) this.splitCamera = new THREE.PerspectiveCamera(68, window.innerWidth / 2 / Math.max(1, window.innerHeight), 0.1, 120);
      this.splitCamera.aspect = window.innerWidth / 2 / Math.max(1, window.innerHeight);
      this.splitCamera.updateProjectionMatrix();
      this.sceneView.enableSecondCamera(this.splitCamera);
    }
    if (online) this.sceneView.gameCam.seatIndex = cameraSeat;
    this.input.setDualSeat(split);

    this.hud.attach(sim);
    this.hud.showBanner('DIVE IN', 'WARM-UP LAPS · GET A FEEL FOR THE POOL', 1700);
    this.touchControls.attach(sim, this.sceneView.gameCam);
    this.bench.attach(sim);

    // Announcer + halftime montage: both were written and neither was wired into a match until
    // now. The commentary goes through the HUD ticker so it reads over the pool, not instead of it.
    this.commentary = new Commentary(sim, (line, priority) => this.hud.showTicker(line, priority >= 3 ? 3200 : 2400));
    this.montage = new MontageOverlay(this.matchWrap);
    sim.events.on('halftime', () => this.montage?.show(sim));

    // Goal replays: the recorder has always existed; nothing was feeding it. It samples live play
    // off the sim clock, and a goal cuts the last few seconds into a clip the director poses back
    // onto the same entities, so the existing rigs animate it with no second scene graph.
    this.recorder = new ReplayRecorder();
    this.director = new ReplayDirector();
    this.replayOverlay = new ReplayOverlay(this.matchWrap);
    sim.events.on('score', (info) => this.beginReplay(sim, info));

    // The crew this client actually pilots. Seat 0 in a normal match, the camera seat in an
    // online round: the guest of a duel must never be handed the host's result.
    const localTeam = sim.seats[cameraSeat]?.team ?? sim.userTeam;

    this.match = {
      sim,
      mode: modeId,
      modeId,
      userTeam: localTeam,
      online,
      split,
      cameraSeat,
      round,
      series,
      seriesReported: false,
      renderer: this.sceneView,
      hud: this.hud,
      touchControls: this.touchControls,
      bench: this.bench,
      montage: this.montage,
      commentary: this.commentary,
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

  /**
   * Cut a goal replay and take over the screen. Returns false when there is nothing to show (a
   * score inside the first second of play, or a build where recording is off), in which case the
   * match simply carries on with its normal celebration.
   */
  beginReplay(sim, { player, team, points, type, gb, ring } = {}) {
    if (!this.recorder || !this.director || !this.match || this.match.replaying) return false;
    const clip = this.recorder.cut({
      scorer: player || null,
      scorerId: player?.id || null,
      team: Number.isInteger(team) ? team : 0,
      ring: Number.isInteger(ring) ? ring : 0,
      points: points || 1,
      type: type || 'shot',
      gb: !!gb,
      at: sim.time,
    });
    if (!clip) return false;
    if (!this.director.start(clip, { reducedMotion: this.state.settings.reducedMotion })) return false;
    // The clip stands in for the goal's dead ball, so it has to read briskly: a slow replay would
    // add seconds to every score. Reduced motion keeps it quick and still.
    this.director.rate = this.state.settings.reducedMotion ? 0.9 : 0.62;
    this.director.capture(sim);
    this.replayOverlay?.show(clip);
    this.match.replaying = true;
    this.hud.setReplay?.(true);
    if (this.sceneView) this.sceneView.replayActive = true;
    this.recorder.reset();
    return true;
  }

  /** Hand the pool back exactly as the goal left it, and shrink the dead ball we just spent. */
  endReplay(sim) {
    this.director?.restore(sim);
    this.replayOverlay?.hide();
    this.hud.setReplay?.(false);
    this.sceneView?.gameCam?.clearReplay();
    this.sceneView?.gameCam2?.clearReplay();
    if (this.sceneView) this.sceneView.replayActive = false;
    if (this.match) this.match.replaying = false;
    if (sim.state === 'dead') sim.stateTimer = Math.min(sim.stateTimer, 0.45);
  }

  /** A round that starts from a `start` message off the duel server. */
  startOnlineMatch(payload = {}) {
    const home = TEAM_BY_ID[payload.home];
    const away = TEAM_BY_ID[payload.away];
    if (!home || !away) {
      this.showNotice('The duel server sent crews this build does not know.');
      this.go('modes');
      return null;
    }
    const session = this.online;
    const cameraSeat = Number.isInteger(payload.seat) ? payload.seat : 0;
    // A new round invalidates last round's tally; the server sends a fresh one after this match.
    this.duelSeries = null;
    const match = this.startMatch({
      home,
      away,
      modeId: payload.modeId || 'series',
      seed: payload.seed,
      difficulty: payload.difficulty,
      seats: [0, 1],
      cameraSeat,
      round: Number.isInteger(payload.round) ? payload.round : 1,
      series: payload.series || null,
      // The server owns the rule snapshot for an online room, so both pools run the same book.
      rules: payload.rules || null,
      online: session || { detached: true, seat: cameraSeat },
    });
    if (!match || !session) return match;
    session.attachSim(match.sim);
    this.bindDuelSession(session);
    const series = payload.series;
    if (series) {
      match.series = series;
      this.hud.setSeries?.(series, cameraSeat);
      if (series.round > 1) this.hud.showBanner(`ROUND ${series.round}`, `${series.wins[0]}–${series.wins[1]} IN THE SERIES`, 1800);
    }
    match.online = session;
    return match;
  }

  /** Route duel-socket events to one handler for the whole session, not just the lobby. */
  bindDuelSession(session) {
    if (!session) return;
    session.onEvent = (type, payload = {}) => this.handleDuelEvent(type, payload);
  }

  handleDuelEvent(type, payload = {}) {
    const match = this.match;
    switch (type) {
      case 'series': {
        const series = payload.series || null;
        this.duelSeries = series;
        this.hud.setSeries?.(series, match?.cameraSeat || this.online?.seat || 0);
        this.currentScreenObject?.onSeries?.(series);
        if (!match) break;
        match.series = series || match.series;
        // A concession closes the set and the match at the same time: the pool has nothing left
        // to play for, so the result screen takes over rather than simulating on.
        if (series && series.forfeit !== null && series.forfeit !== undefined && !match.seriesClosed) {
          match.seriesClosed = true;
          const mySeat = match.cameraSeat || 0;
          const opponentSeat = 1 - mySeat;
          match.sim.winner = match.sim.seats[opponentSeat]?.team ?? null;
          match.sim.state = 'over';
          match.sim.stateTimer = 0;
          this.hud.showBanner(series.forfeit === mySeat ? 'YOU CONCEDED' : 'OPPONENT CONCEDED', 'THE SERIES IS CLOSED', 2200);
        }
        break;
      }
      case 'opponent-left':
        if (match) match.paused = true;
        this.showNotice('The other pilot disconnected.');
        break;
      case 'desync':
        if (match) match.paused = true;
        this.showNotice('The pools drifted apart — the match was stopped.');
        break;
      case 'close':
        if (match && match.sim.state !== 'over') {
          match.paused = true;
          this.showNotice('Lost the duel server.');
        }
        break;
      default:
        break;
    }
  }

  /** Start (or continue) a Gauntlet run. */
  beginGauntlet(teamId) {
    this.state.gauntlet = createGauntletRun(teamId, { difficulty: this.state.settings.difficulty });
    this.state.gauntletTeamId = this.state.gauntlet.teamId;
    this.save();
    return this.startGauntletMatch();
  }

  startGauntletMatch() {
    const run = this.state.gauntlet;
    const fixture = run && !run.over ? gauntletMatch(run, TEAMS) : null;
    if (!fixture) {
      this.go('gauntlet');
      return null;
    }
    return this.startMatch({
      home: fixture.home,
      away: fixture.away,
      modeId: 'gauntlet',
      difficulty: fixture.difficulty,
      rules: fixture.rules,
    });
  }

  disposeMatch() {
    if (!this.match && !this.sceneView) return;
    this.montage?.dispose();
    this.montage = null;
    this.replayOverlay?.dispose();
    this.replayOverlay = null;
    this.director?.dispose();
    this.director = null;
    this.recorder = null;
    if (this.sceneView) this.sceneView.replayActive = false;
    this.commentary = null;
    this.input.setDualSeat(false);
    // Detach, do not leave: a series continues through the results screen and back into the lobby.
    this.match?.online?.detach?.();
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
    const online = this.match.online;
    this.pauseOverlay = PauseOverlay(this, {
      onResume: () => this.resumeMatch(),
      onQuit: () => this.returnToTitleFromPause(),
      // Restarting an online round would fork the two simulations, so it is not offered there.
      onRestart: online ? null : () => this.startMatch({
        home: this.match?.sim.teams[0],
        away: this.match?.sim.teams[1],
        userTeam: this.match?.userTeam,
        modeId: this.match?.modeId,
      }),
      onForfeit: online ? () => this.forfeitSeries() : null,
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

  /**
   * Walk away from an online series. The server awards the set to the other pilot; if the socket
   * has already died, the same outcome is applied locally so the player is never stuck in a match
   * nobody else is playing.
   */
  forfeitSeries() {
    const match = this.match;
    if (!match?.online || match.seriesClosed) return false;
    match.online.concede();
    this.resumeMatch();
    this.hud.showTicker('CONCEDED · WAITING FOR THE SERIES TO CLOSE', 2200);
    window.setTimeout(() => {
      if (!this.match || this.match.seriesClosed || this.match.sim.state === 'over') return;
      this.match.seriesClosed = true;
      const mySeat = this.match.cameraSeat || 0;
      this.match.sim.winner = this.match.sim.seats[1 - mySeat]?.team ?? null;
      this.match.sim.state = 'over';
      this.match.sim.stateTimer = 0;
    }, 1600);
    return true;
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
    const { sim, mode, userTeam } = this.match;
    const online = this.match.online;
    const mySeat = this.match.cameraSeat || 0;

    // An online round is not just a match: the server has to record it before the results screen
    // can say where the series stands. Report once, then give the tally a moment to land.
    if (online) {
      if (!this.match.seriesReported) {
        this.match.seriesReported = true;
        this.match.seriesWaitStart = performance.now();
        const seat = sim.winner === null ? null : sim.seats.findIndex((s) => s.team === sim.winner);
        online.reportResult(seat === -1 ? null : seat);
      }
      const round = this.match.round || 1;
      const settled = this.duelSeries && this.duelSeries.round >= round;
      const waited = performance.now() - (this.match.seriesWaitStart || 0);
      if (!settled && waited < 700) return;
    }

    this.match.completeHandled = true;
    let careerResult = '';
    let rankedResult = '';
    let trial = null;
    let duel = null;
    let gauntlet = null;
    const series = online ? (this.duelSeries || this.match.series || online.series || null) : null;

    // A duel is decided between two people, so the result screen names the seat that won rather
    // than a crew the player may not own.
    const seatsInPlay = sim.seats.filter((s) => s.team !== null);
    if (seatsInPlay.length > 1) {
      duel = {
        online: !!online,
        me: mySeat,
        winnerSeat: sim.winner === null ? -1 : seatsInPlay.findIndex((s) => s.team === sim.winner),
        labels: sim.seats.map((s) => `P${s.index + 1}`),
        forfeitSeat: series?.forfeit ?? null,
      };
    }

    if (userTeam !== null) {
      const won = sim.winner === userTeam;
      const style = sim.teamPlayers(userTeam).reduce((total, p) => total + p.stats.style, 0);
      this.state.records[won ? 'wins' : 'losses']++;
      this.state.records.styleBest = Math.max(this.state.records.styleBest || 0, style);
      // The global board is fed from the player's point of view, so the score is written in the
      // order the player saw it. A failure here is invisible: the board is a bonus, not a
      // dependency.
      this.cloud?.reportMatch({
        mode,
        score: userTeam === 1 ? [sim.score[1], sim.score[0]] : [sim.score[0], sim.score[1]],
        won,
        style,
        username: this.state.playerName || this.cloud?.readDevice()?.username || 'PLAYER',
      });
      if (mode === 'career' && this.state.career) {
        const margin = sim.score[userTeam] - sim.score[1 - userTeam];
        recordResult(this.state.career, { won, score: [...sim.score], style, margin });
        const injuries = rollInjuries(this.state.career, sim, userTeam);
        const progress = awardPlayerProgress(this.state.career, { won, margin, style });
        careerResult = `+${progress.earned} XP · ${won ? 'REP EARNED' : 'LESSON LEARNED'}`;
        if (progress.unlocked.length) careerResult += ` · UNLOCKED ${progress.unlocked.join(', ')}`;
        if (injuries.length) careerResult += ` · ${injuries.length} SWIMMER${injuries.length === 1 ? '' : 'S'} BANGED UP`;
      }
      if (mode === 'ladder') rankedResult = recordRankedResult(this, sim, userTeam);
      if (mode === 'proving') trial = gradeTrials(sim, userTeam);
      if (mode === 'gauntlet' && this.state.gauntlet) {
        gauntlet = applyGauntletResult(this.state.gauntlet, {
          won,
          draw: sim.winner === null,
          score: [...sim.score],
        });
        gauntlet.progress = gauntletProgress(this.state.gauntlet);
        const best = this.state.gauntletBest;
        const stage = this.state.gauntlet.stage;
        if (!best || stage > best.stage || (this.state.gauntlet.cleared && !best.cleared)) {
          this.state.gauntletBest = { stage, cleared: this.state.gauntlet.cleared };
        }
        this.state.gauntletTeamId = this.state.gauntlet.teamId;
      }
      this.save();
    }
    this.audio.playRefWhistle();
    this.go('results', { sim, mode, userTeam, careerResult, rankedResult, trial, duel, gauntlet, series, mySeat });
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
        const pilotTeam = sim.seats[this.match.cameraSeat]?.team;
        this.input.setKeeperContext(
          !!sim.seats[this.match.cameraSeat]?.inCage,
          pilotTeam === null || pilotTeam === undefined ? 1 : sim.attackDir(pilotTeam),
        );
        const sampled = this.input.poll();

        // A goal replay owns the screen: the sim is frozen, the director poses the recorded
        // move onto the live entities, and any action skips straight back to the pool.
        if (this.match.replaying) {
          const keepGoing = this.director.advance(dt);
          this.director.pose(sim);
          this.replayOverlay?.progress(this.director.progress);
          this.sceneView.gameCam.replayShot(
            sim,
            this.director.ballAt(),
            this.director.progress,
            this.director.clip?.scorer,
            this.director.clip?.team ?? 0,
            dt,
          );
          const skip = sampled.shootPressed || sampled.pass || sampled.hit || sampled.trick;
          if (!keepGoing || skip) this.endReplay(sim);
        } else if (this.match.montage?.shown) {
          // The halftime montage is a real break: the pool holds still until it clears.
          if (sampled.shootPressed || sampled.pass || sampled.confirm) this.match.montage.dismiss();
          this.match.montage.tick(dt);
        } else if (!this.match.paused) {
          const simStart = performance.now();
          if (this.match.online?.pump) {
            // Lockstep: the local input goes on the wire, both seat inputs come back in tick order.
            const session = this.match.online;
            const seat = this.match.cameraSeat;
            session.queueInput(sampled);
            session.pump((mine, theirs) => {
              sim.setSeatInput(seat, mine);
              sim.setSeatInput(1 - seat, theirs);
              sim.step(session.tickSeconds);
            });
          } else {
            sim.setUserInput(sampled);
            if (this.match.split) sim.setSeatInput(1, this.input.input2);
            sim.step(dt);
            // Feed the goal-replay ring from the sim clock, never the render clock.
            this.recorder?.record(sim, dt);
          }
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
    if (this.match?.split && this.splitCamera && this.currentScreen === 'match') {
      this.renderer.renderSplit(this.scene, this.sceneView.gameCam.cam, this.sceneView.gameCam2?.cam || this.splitCamera, dt);
    } else {
      this.renderer.render(this.scene, this.camera, dt);
    }
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
