/**
 * Techcopy QTE Animation Controller & Visual Overlay for Blitzball-X
 * Manages "TECHCOPY!" prompt timing windows, progress bar tracking,
 * touch/keyboard input hooks, and technique unlock feedback.
 */

export class TechcopyQTEController {
  /**
   * @param {HTMLElement} container Parent DOM container
   * @param {Object} [audioEngine] Optional SoundEngine instance for sound triggers
   */
  constructor(container, audioEngine = null) {
    this.container = container;
    this.audio = audioEngine;
    this.overlayElement = null;
    this.animationFrameId = null;

    // QTE Engine State
    this.isActive = false;
    this.promptStartTime = 0;
    this.durationMs = 800;    // Total timing window duration (ms)
    this.windowStartMs = 200; // Success window start threshold
    this.windowEndMs = 700;   // Success window end threshold
    this.currentTech = null;
    this.targetPlayer = null;
    this.onResult = null;

    this.initDOM();
  }

  initDOM() {
    this.overlayElement = document.createElement('div');
    this.overlayElement.id = 'ffx-techcopy-qte-overlay';
    this.overlayElement.style.cssText = `
      display: none;
      position: absolute;
      top: 22%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 200;
      font-family: 'Segoe UI', Roboto, sans-serif;
      text-align: center;
      pointer-events: auto;
      user-select: none;
    `;

    this.container.appendChild(this.overlayElement);
  }

  /**
   * Triggers a Techcopy QTE prompt on screen
   * 
   * @param {Object} config
   * @param {string} config.techName Name of technique being executed by opponent
   * @param {string} config.playerName Name of opponent executing technique
   * @param {number} [config.durationMs=800] Total timing window duration in ms
   * @param {Function} onResult Callback invoked with { success, timingDiffMs, techName, targetPlayer }
   */
  triggerPrompt({ techName, playerName, durationMs = 800 }, onResult) {
    if (this.isActive) this.cancel();

    this.isActive = true;
    this.promptStartTime = performance.now();
    this.durationMs = durationMs;
    this.currentTech = techName;
    this.targetPlayer = playerName;
    this.onResult = onResult;

    if (this.audio && typeof this.audio.playBubblePop === 'function') {
      this.audio.playBubblePop();
    }

    this.overlayElement.style.display = 'block';
    this.overlayElement.innerHTML = `
      <div id="qte-box" style="
        background: rgba(15, 23, 42, 0.94);
        border: 3px solid #facc15;
        border-radius: 12px;
        padding: 20px 32px;
        box-shadow: 0 0 28px rgba(250, 204, 21, 0.7);
        backdrop-filter: blur(8px);
      ">
        <div style="font-size: 28px; font-weight: 900; color: #facc15; letter-spacing: 2px; text-shadow: 0 0 10px rgba(250, 204, 21, 0.8);">
          ⚡ TECHCOPY! ⚡
        </div>
        <div style="font-size: 14px; color: #38bdf8; margin: 6px 0 14px 0; font-weight: bold;">
          ${playerName}: <span style="color: #ffffff;">${techName}</span>
        </div>

        <!-- Target Timing Progress Bar -->
        <div style="width: 260px; height: 14px; background: rgba(255, 255, 255, 0.2); border-radius: 7px; overflow: hidden; margin: 0 auto; border: 1px solid #38bdf8; position: relative;">
          <!-- Green Success Zone -->
          <div style="
            position: absolute;
            left: ${(this.windowStartMs / this.durationMs) * 100}%;
            width: ${((this.windowEndMs - this.windowStartMs) / this.durationMs) * 100}%;
            height: 100%;
            background: rgba(16, 185, 129, 0.6);
          "></div>
          
          <!-- Moving Reaction Cursor -->
          <div id="qte-progress-bar" style="
            width: 0%;
            height: 100%;
            background: #f43f5e;
            transition: none;
          "></div>
        </div>

        <div style="font-size: 12px; color: #94a3b8; margin-top: 10px; font-weight: bold;">
          TAP SCREEN / PRESS [SPACE] NOW!
        </div>
      </div>
    `;

    this.bindInputEvents();
    this.updateLoop();
  }

  bindInputEvents() {
    this.handleInput = (e) => {
      if (!this.isActive) return;
      if (e.type === 'keydown' && e.code !== 'Space') return;
      e.preventDefault();
      this.resolveInput();
    };

    window.addEventListener('keydown', this.handleInput);
    this.overlayElement.addEventListener('touchstart', this.handleInput);
    this.overlayElement.addEventListener('click', this.handleInput);
  }

  unbindInputEvents() {
    if (this.handleInput) {
      window.removeEventListener('keydown', this.handleInput);
      this.overlayElement.removeEventListener('touchstart', this.handleInput);
      this.overlayElement.removeEventListener('click', this.handleInput);
    }
  }

  updateLoop() {
    if (!this.isActive) return;

    const now = performance.now();
    const elapsed = now - this.promptStartTime;
    const progressPercent = Math.min(100, (elapsed / this.durationMs) * 100);

    const progressBar = this.overlayElement.querySelector('#qte-progress-bar');
    if (progressBar) {
      progressBar.style.width = `${progressPercent}%`;
      if (elapsed >= this.windowStartMs && elapsed <= this.windowEndMs) {
        progressBar.style.background = '#10b981'; // Green inside timing window
      } else {
        progressBar.style.background = '#f43f5e'; // Red outside timing window
      }
    }

    if (elapsed >= this.durationMs) {
      // Timeout failure
      this.resolveInput(true);
      return;
    }

    this.animationFrameId = requestAnimationFrame(this.updateLoop.bind(this));
  }

  /**
   * Evaluates timing of player input press
   * @param {boolean} [isTimeout=false]
   */
  resolveInput(isTimeout = false) {
    if (!this.isActive) return;

    const inputTimeMs = performance.now();
    const elapsed = inputTimeMs - this.promptStartTime;

    const success = !isTimeout && elapsed >= this.windowStartMs && elapsed <= this.windowEndMs;
    const timingDiffMs = Math.abs(elapsed - (this.windowStartMs + this.windowEndMs) / 2);

    this.isActive = false;
    this.unbindInputEvents();
    cancelAnimationFrame(this.animationFrameId);

    // Render success or failure flash feedback
    this.showFeedback(success, () => {
      this.overlayElement.style.display = 'none';
      if (this.onResult) {
        this.onResult({
          success,
          timingDiffMs,
          techName: this.currentTech,
          targetPlayer: this.targetPlayer
        });
      }
    });
  }

  /**
   * Displays SUCCESS / FAILED flash banner
   */
  showFeedback(success, callback) {
    const qteBox = this.overlayElement.querySelector('#qte-box');
    if (!qteBox) return callback();

    if (success) {
      if (this.audio && typeof this.audio.playCrowdCheer === 'function') {
        this.audio.playCrowdCheer(1.2);
      }
      qteBox.style.borderColor = '#10b981';
      qteBox.style.boxShadow = '0 0 36px rgba(16, 185, 129, 0.8)';
      qteBox.innerHTML = `
        <div style="font-size: 32px; font-weight: 900; color: #10b981; letter-spacing: 3px;">
          TECH LEARNED!
        </div>
        <div style="font-size: 16px; color: #ffffff; margin-top: 6px; font-weight: bold;">
          + ${this.currentTech} Unlocked!
        </div>
      `;
    } else {
      qteBox.style.borderColor = '#f43f5e';
      qteBox.style.boxShadow = '0 0 36px rgba(244, 63, 94, 0.8)';
      qteBox.innerHTML = `
        <div style="font-size: 32px; font-weight: 900; color: #f43f5e; letter-spacing: 3px;">
          FAILED!
        </div>
        <div style="font-size: 14px; color: #94a3b8; margin-top: 6px;">
          Timing Missed
        </div>
      `;
    }

    setTimeout(() => {
      callback();
    }, 900);
  }

  cancel() {
    this.isActive = false;
    this.unbindInputEvents();
    cancelAnimationFrame(this.animationFrameId);
    this.overlayElement.style.display = 'none';
  }
      }
