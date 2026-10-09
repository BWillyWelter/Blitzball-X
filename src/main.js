import * as THREE from 'three';
import { GameRenderer } from './render/renderer.js';
import { SpherePoolEnvironment } from './render/court.js';
import { FFXMatch, MATCH_STATES } from './game/match.js';
import { FFXHUD } from './ui/hud.js';
import { FFXTouchController } from './ui/touch.js';
import { TEAMS } from './data/teams.js';

export class BlitzballApp {
  constructor() {
    this.container = document.getElementById('app') || document.body;
    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);

    // Renderer & 3D Underwater Scene
    this.renderer = new GameRenderer(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    this.environment = new SpherePoolEnvironment(this.scene);
    this.hud = new FFXHUD(this.container);
    this.touch = new FFXTouchController(this.canvas);

    this.match = null;
    this.lastTime = performance.now();
    this.isRunning = false;

    this.init();
  }

  init() {
    this.scene.background = new THREE.Color(0x0284c7);
    this.camera.position.set(0, 18, 22);
    this.camera.lookAt(0, 0, 0);

    // Initialize FFX Match: Besaid Aurochs vs. Luca Goers
    this.match = new FFXMatch(TEAMS.besaid_aurochs, TEAMS.luca_goers);

    this.isRunning = true;
    requestAnimationFrame(this.gameLoop.bind(this));
  }

  gameLoop(now) {
    if (!this.isRunning) return;

    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.match) {
      // 1. Process 3D Swimming Input during Free Swim
      if (this.match.state === MATCH_STATES.FREE_SWIM && this.match.ballCarrier) {
        const swimDir = this.touch.getSwimDirection();
        this.match.ballCarrier.position.x += swimDir.x * 4.0 * delta;
        this.match.ballCarrier.position.z += swimDir.z * 4.0 * delta;
      }

      // 2. Step Match Engine State
      this.match.step(delta);

      // 3. Trigger Encounter Menu on Intercept
      if (this.match.state === MATCH_STATES.ENCOUNTER_MENU) {
        this.touch.triggerHaptic('encounter');
        this.hud.showEncounterMenu(
          this.match.ballCarrier,
          this.match.nearbyDefenders,
          (action, payload) => this.match.executeEncounterAction(action, payload)
        );
      }

      // 4. Render HUD Radar
      this.hud.drawRadar(this.match);
    }

    // Update 3D Environment Caustics & Render Frame
    this.environment.update(delta);
    this.renderer.render(this.scene, this.camera, delta);

    requestAnimationFrame(this.gameLoop.bind(this));
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = new BlitzballApp();
  });
}
