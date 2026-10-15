import * as THREE from 'three';

/**
 * Quality / dynamic-resolution targets for the WebGL view.
 * Read in the constructor (not at module load) so headless imports of this
 * module never touch `window`.
 */
const GRAPHICS = {
  MIN_DPR: 1.0,
  MAX_DPR_CAP: 2.0,
  LOW_PERF_THRESHOLD_FPS: 45,
  DPR_STEP: 0.25
};

/**
 * Thin WebGL presentation layer for BlitzballApp.
 *
 * Owns the THREE.WebGLRenderer only — scene composition lives in
 * SpherePoolEnvironment and game state lives in FFXMatch. Each frame the app
 * calls render(scene, camera, delta); resolution adapts downward when the
 * average frame rate sags so the game stays playable on weaker GPUs.
 */
export class GameRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.currentDPR = Math.min(
      (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
      GRAPHICS.MAX_DPR_CAP
    );

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
    this.quality = 'high';
    this.maxDPR = GRAPHICS.MAX_DPR_CAP;

    // Performance monitoring for dynamic resolution scaling.
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fpsHistory = [];
    this.contextLost = false;

    this.onWindowResize = this.onWindowResize.bind(this);
    this.onContextLost = (event) => {
      // Without preventDefault the browser never fires webglcontextrestored
      // and the pool stays black for the rest of the session.
      event.preventDefault();
      this.contextLost = true;
    };
    this.onContextRestored = () => {
      this.contextLost = false;
      this.renderer.setPixelRatio(this.currentDPR);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', this.onWindowResize);
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  /** Apply a user-facing quality preset without taking control away from the FPS fallback. */
  setQuality(level = 'high') {
    this.quality = ['low', 'medium', 'high'].includes(level) ? level : 'high';
    this.maxDPR = this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.4 : GRAPHICS.MAX_DPR_CAP;
    this.currentDPR = Math.max(GRAPHICS.MIN_DPR, Math.min(window.devicePixelRatio || 1, this.maxDPR));
    this.renderer.setPixelRatio(this.currentDPR);
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Drops the render scale one step when the average frame rate stays below
   * the playable threshold; never raises it back mid-session.
   */
  adaptQuality() {
    this.frameCount++;

    const now = performance.now();
    if (now - this.lastTime < 1000) return;

    const currentFPS = (this.frameCount * 1000) / (now - this.lastTime);
    this.fpsHistory.push(currentFPS);
    if (this.fpsHistory.length > 3) this.fpsHistory.shift();

    const avgFPS = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;

    if (
      avgFPS < GRAPHICS.LOW_PERF_THRESHOLD_FPS &&
      this.currentDPR > GRAPHICS.MIN_DPR
    ) {
      this.currentDPR = Math.max(
        GRAPHICS.MIN_DPR,
        this.currentDPR - GRAPHICS.DPR_STEP
      );
      this.renderer.setPixelRatio(this.currentDPR);
      console.warn(`[GameRenderer] Throttling render scale to ${this.currentDPR} to hold the frame rate`);
    }

    this.frameCount = 0;
    this.lastTime = now;
  }

  /**
   * Renders the current frame.
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {number} delta Seconds elapsed
   */
  render(scene, camera, delta) {
    if (this.contextLost) return;
    this.adaptQuality(delta);
    this.renderer.render(scene, camera);
  }

  onWindowResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Tears down GL resources and releases the context explicitly —
   * renderer.dispose() frees GL objects but keeps the context alive, and
   * browsers only allow a handful of live contexts per page.
   */
  destroy() {
    window.removeEventListener('resize', this.onWindowResize);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer.forceContextLoss?.();
    this.renderer.dispose();
  }
}
