import * as THREE from 'three';
import { GameRenderer } from './render/renderer.js';
import { TouchController } from './ui/touch.js';
import { HUD } from './ui/hud.js';
import { SaveManager } from './ui/save.js';
import { CareerManager } from './game/career.js';
import { FXManager } from './render/fx.js';
import { Match } from './game/match.js';
import { TEAMS } from './data/teams.js';
import { GAME_CONSTANTS } from './data/constants.js';

export class BlitzballApp {
  constructor() {
    this.container = document.getElementById('app') || document.body;
    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);

    // Core Managers Initialization
    this.renderer = new GameRenderer(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    this.fx = new FXManager(this.scene);
    this.touch = new TouchController(this.canvas, { hapticsEnabled: true });
    this.hud = new HUD(this.container);
    this.saveManager = new SaveManager();
    this.career = null;

    this.match = null;
    this.lastFrameTime = performance.now();
    this.isRunning = false;

    this.init();
  }

  async init() {
    // Load local/cloud save state
    const saveData = await this.saveManager.load();
    this.career = new CareerManager(saveData.career, this.saveManager);

    this.setupScene();
    this.bindEvents();
    this.startMatch('tokyo_samurai', 'new_york_aces');
    
    this.isRunning = true;
    requestAnimationFrame(this.gameLoop.bind(this));
  }

  setupScene() {
    this.scene.background = new THREE.Color(0x0f172a);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(10, 20, 15);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    this.camera.position.set(0, 12, 22);
    this.camera.lookAt(0, 0, 0);
  }

  bindEvents() {
    this.touch.on('swipe', (data) => {
      if (!this.match) return;

      // Map swipe vector to pitching or passing velocity
      const pitchVector = {
        x: (data.dx / window.innerWidth) * GAME_CONSTANTS.TOUCH.MAX_PITCH_CURVE_OFFSET,
        y: Math.min(data.velocity * 10, GAME_CONSTANTS.BALL.MAX_VELOCITY),
        z: (data.dy / window.innerHeight) * -15
      };

      this.match.applyPlayerInput('SWIPE_PITCH', pitchVector);
      this.touch.triggerHaptic('medium');
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  startMatch(homeId, awayId) {
    this.match = new Match({
      homeTeam: TEAMS[homeId] || TEAMS.tokyo_samurai,
      awayTeam: TEAMS[awayId] || TEAMS.new_york_aces],
      headless: false
    });

    this.match.on('goal', (data) => {
      this.hud.showBanner(`${data.scoringTeam.name} GOAL!`);
      this.touch.triggerHaptic('goal');
      this.fx.spawnBurst({ x: 0, y: 2, z: -GAME_CONSTANTS.FIELD.LENGTH / 2 }, 'goal', 40);
    });

    this.hud.update({
      homeName: TEAMS[homeId]?.name || 'HOME',
      awayName: TEAMS[awayId]?.name || 'AWAY'
    });
  }

  gameLoop(now) {
    if (!this.isRunning) return;

    const delta = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;

    if (this.match) {
      this.match.step(delta);

      // Sync HUD state with engine state
      this.hud.update({
        homeScore: this.match.homeScore,
        awayScore: this.match.awayScore,
        secondsRemaining: this.match.getTimeRemaining(),
        stamina: this.match.getActivePlayerStamina()
      });
    }

    this.fx.update(delta, this.camera);
    this.renderer.render(this.scene, this.camera, delta);

    requestAnimationFrame(this.gameLoop.bind(this));
  }
}

// Auto-start application when DOM is ready
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = new BlitzballApp();
  });
        }
