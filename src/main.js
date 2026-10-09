/**
 * Blitzball-X Application Entry Point & Core Game Engine Loop
 * Connects 3D Sphere Pool WebGL, FFX Match State Machine, Audio Engine,
 * League Brackets, Scout Systems, and SaveManager Auto-Persistence.
 */

import * as THREE from 'three';
import { GameRenderer } from './render/renderer.js';
import { SpherePoolEnvironment } from './render/court.js';
import { FFXMatch, MATCH_STATES } from './game/match.js';
import { FFXHUD } from './ui/hud.js';
import { FFXTouchController } from './ui/touch.js';
import { SaveManager } from './ui/save.js';
import { LeagueManager } from './game/league.js';
import { ScoutManager } from './game/scout.js';
import { LeagueViewUI } from './ui/league-view.js';
import { ScoutViewUI } from './ui/scout-view.js';
import { SoundEngine } from './ui/audio.js';
import { TEAMS } from './data/teams.js';

export class BlitzballApp {
  constructor() {
    this.container = document.getElementById('app') || document.body;
    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);

    // Core Managers
    this.saveManager = new SaveManager();
    this.audio = new SoundEngine();
    
    // 3D Rendering & Scene
    this.renderer = new GameRenderer(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.environment = new SpherePoolEnvironment(this.scene);

    // UI & Touch Controls
    this.hud = new FFXHUD(this.container);
    this.touch = new FFXTouchController(this.canvas);
    this.leagueView = new LeagueViewUI(this.container);
    this.scoutView = new ScoutViewUI(this.container);

    // Active Game State Handles
    this.league = null;
    this.scout = null;
    this.match = null;
    this.savedState = null;

    this.lastTime = performance.now();
    this.isRunning = false;

    this.init();
  }

  /**
   * Initializes application state and loads local/cloud save payload
   */
  async init() {
    this.scene.background = new THREE.Color(0x0284c7);
    this.camera.position.set(0, 18, 22);
    this.camera.lookAt(0, 0, 0);

    // 1. Load persisted game state (or default state)
    this.savedState = await this.saveManager.load();

    // 2. Instantiate League & Scout Managers with saved nodes
    this.league = new LeagueManager(this.savedState.league);
    this.scout = new ScoutManager(this.savedState.scout);

    // 3. Initialize default match (Besaid Aurochs vs. Luca Goers)
    this.startNewMatch('besaid_aurochs', 'luca_goers');

    // 4. Bind UI top-bar triggers for League and Scout overlays
    this.bindGlobalMenuTriggers();

    // 5. Start audio ambience & render loop
    this.audio.startSpherePoolAmbience();
    this.isRunning = true;
    requestAnimationFrame(this.gameLoop.bind(this));
  }

  /**
   * Initializes a new FFX Match session
   */
  startNewMatch(homeTeamId, awayTeamId) {
    const homeTeam = TEAMS[homeTeamId] || TEAMS.besaid_aurochs;
    const awayTeam = TEAMS[awayTeamId] || TEAMS.luca_goers;

    this.match = new FFXMatch(homeTeam, awayTeam);
    this.audio.playRefWhistle();
  }

  /**
   * Binds UI overlay shortcuts for League Standings and Free Agent Scouting
   */
  bindGlobalMenuTriggers() {
    // Esc key or HUD buttons to toggle menus
    window.addEventListener('keydown', (e) => {
      if (e.key === 'l' || e.key === 'L') {
        this.leagueView.open(this.league, () => this.handleNextScheduledMatch());
      }
      if (e.key === 's' || e.key === 'S') {
        this.scoutView.open(this.scout, () => this.autoSaveProgress());
      }
    });
  }

  /**
   * Main 60 FPS Game Render Loop
   */
  gameLoop(now) {
    if (!this.isRunning) return;

    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.match) {
      // 1. Process 3D Swimming Controls during Free Swim
      if (this.match.state === MATCH_STATES.FREE_SWIM && this.match.ballCarrier) {
        const swimDir = this.touch.getSwimDirection();
        this.match.ballCarrier.position.x += swimDir.x * 4.0 * delta;
        this.match.ballCarrier.position.z += swimDir.z * 4.0 * delta;
      }

      // 2. Step Match Engine State Machine
      const previousState = this.match.state;
      this.match.step(delta);

      // 3. Trigger Encounter Menu Modal on defender interception
      if (this.match.state === MATCH_STATES.ENCOUNTER_MENU && previousState !== MATCH_STATES.ENCOUNTER_MENU) {
        this.touch.triggerHaptic('encounter');
        this.hud.showEncounterMenu(
          this.match.ballCarrier,
          this.match.nearbyDefenders,
          (action, payload) => this.match.executeEncounterAction(action, payload)
        );
      }

      // 4. Detect Match Completion & Trigger Auto-Save Pipeline
      if (this.match.state === MATCH_STATES.MATCH_OVER && previousState !== MATCH_STATES.MATCH_OVER) {
        this.handleMatchCompletion();
      }

      // 5. Draw Mini-Map Radar
      this.hud.drawRadar(this.match);
    }

    // 6. Update 3D Water Volume & Render
    this.environment.update(delta);
    this.renderer.render(this.scene, this.camera, delta);

    requestAnimationFrame(this.gameLoop.bind(this));
  }

  /**
   * Handles post-match updates: records scores, decays contracts, awards Gil, and auto-saves
   */
  async handleMatchCompletion() {
    this.audio.playRefWhistle();
    this.touch.triggerHaptic('goal');

    // 1. Record match result into League / Tournament manager
    this.league.recordMatchResult(
      this.match.homeTeam.id,
      this.match.awayTeam.id,
      this.match.homeScore,
      this.match.awayScore
    );

    // 2. Simulate AI match results for other teams in Spira
    this.league.simulateAIMatches();

    // 3. Award victory Gil & XP
    if (this.match.homeScore > this.match.awayScore) {
      this.scout.gil += 1000; // Match win bonus
    } else {
      this.scout.gil += 300;  // Participation bonus
    }

    // 4. Decay player contracts by 1 game
    const expiredAgents = this.scout.decayMatchContracts('besaid_aurochs');
    if (expiredAgents.length > 0) {
      console.log(`[Contracts Expired] Released: ${expiredAgents.join(', ')}`);
    }

    // 5. Persist auto-save payload to local & cloud endpoints
    await this.autoSaveProgress();

    // 6. Display League Standings View with updated results
    this.leagueView.open(this.league, () => this.handleNextScheduledMatch());
  }

  /**
   * Progresses tournament/league to the next round and launches the match
   */
  handleNextScheduledMatch() {
    this.league.currentRound++;
    this.startNewMatch('besaid_aurochs', 'al_bhed_psyches');
  }

  /**
   * Serializes active state modules and writes to local & cloud storage
   */
  async autoSaveProgress() {
    const payload = {
      ...this.savedState,
      league: this.saveManager.serializeLeague(this.league),
      scout: this.saveManager.serializeScout(this.scout),
      updatedAt: Date.now()
    };

    const success = await this.saveManager.save(payload);
    if (success) {
      console.log('[AutoSave] Progress successfully synced to local & cloud storage.');
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = new BlitzballApp();
  });
  }
