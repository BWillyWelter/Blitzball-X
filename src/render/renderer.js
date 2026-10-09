import * as THREE from 'three';
import { GAME_CONSTANTS } from '../data/constants.js';

export class GameRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.currentDPR = GAME_CONSTANTS.GRAPHICS.MAX_DPR;
    
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });

    this.renderer.setPixelRatio(this.currentDPR);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Performance Monitoring for Dynamic Resolution Scaling
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fpsHistory = [];

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  /**
   * Dynamically adjusts DPR if performance drops below target
   * @param {number} delta Seconds elapsed
   */
  adaptQuality(delta) {
    this.frameCount++;
    const now = performance.now();

    if (now - this.lastTime >= 1000) {
      const currentFPS = (this.frameCount * 1000) / (now - this.lastTime);
      this.fpsHistory.push(currentFPS);

      if (this.fpsHistory.length > 3) this.fpsHistory.shift();

      const avgFPS = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;

      // Downscale resolution if framerate drops consistently
      if (avgFPS < GAME_CONSTANTS.GRAPHICS.LOW_PERF_THRESHOLD_FPS && this.currentDPR > GAME_CONSTANTS.GRAPHICS.MIN_DPR) {
        this.currentDPR = Math.max(GAME_CONSTANTS.GRAPHICS.MIN_DPR, this.currentDPR - 0.25);
        this.renderer.setPixelRatio(this.currentDPR);
        console.warn(`[GameRenderer] Throttling render scale to ${this.currentDPR} to preserve 60FPS`);
      }

      this.frameCount = 0;
      this.lastTime = now;
    }
  }

  /**
   * Renders the current frame
   * @param {THREE.Scene} scene 
   * @param {THREE.Camera} camera 
   * @param {number} delta 
   */
  render(scene, camera, delta) {
    this.adaptQuality(delta);
    this.renderer.render(scene, camera);
  }

  onWindowResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  destroy() {
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.dispose();
  }
}
