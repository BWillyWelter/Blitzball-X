/**
 * Touch Input & Native Haptics Manager for Blitzball-X
 */

// Haptic feedback pattern presets (in milliseconds)
const HAPTIC_PATTERNS = {
  light: [10],
  medium: [25],
  heavy: [45],
  impact: [15, 30, 15],
  goal: [50, 50, 100, 50, 150]
};

export class TouchController {
  /**
   * @param {HTMLCanvasElement} canvasElement 
   * @param {Object} [options]
   * @param {boolean} [options.hapticsEnabled=true]
   */
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.hapticsEnabled = options.hapticsEnabled ?? true;
    this.touchState = {
      activeTouches: new Map(),
      swipeVector: { x: 0, y: 0 },
      virtualStick: { x: 0, y: 0, active: false }
    };

    this.listeners = new Set();
    this.init();
  }

  init() {
    if (!this.canvas) return;

    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
    this.canvas.addEventListener('touchcancel', this.handleTouchEnd.bind(this), { passive: false });
  }

  /**
   * Triggers native device haptic feedback
   * @param {'light'|'medium'|'heavy'|'impact'|'goal'} type 
   */
  triggerHaptic(type = 'light') {
    if (!this.hapticsEnabled || typeof window === 'undefined') return;

    if ('vibrate' in navigator) {
      const pattern = HAPTIC_PATTERNS[type] || HAPTIC_PATTERNS.light;
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Restricted permissions or unhandled vibration call
      }
    }
  }

  /**
   * @param {TouchEvent} e 
   */
  handleTouchStart(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      this.touchState.activeTouches.set(touch.identifier, {
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
        startTime: performance.now()
      });
    }
    this.notifyListeners('touchstart', this.touchState);
  }

  /**
   * @param {TouchEvent} e 
   */
  handleTouchMove(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const touchData = this.touchState.activeTouches.get(touch.identifier);

      if (touchData) {
        touchData.currentX = touch.clientX - rect.left;
        touchData.currentY = touch.clientY - rect.top;
      }
    }
    this.notifyListeners('touchmove', this.touchState);
  }

  /**
   * @param {TouchEvent} e 
   */
  handleTouchEnd(e) {
    e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const touchData = this.touchState.activeTouches.get(touch.identifier);

      if (touchData) {
        const dx = touchData.currentX - touchData.startX;
        const dy = touchData.currentY - touchData.startY;
        const duration = performance.now() - touchData.startTime;

        // Swipe gesture evaluation
        if (Math.hypot(dx, dy) > 25 && duration < 350) {
          const velocity = Math.hypot(dx, dy) / duration;
          this.triggerHaptic('medium');
          this.notifyListeners('swipe', { 
            dx, 
            dy, 
            velocity,
            duration, 
            startX: touchData.startX, 
            startY: touchData.startY 
          });
        }

        this.touchState.activeTouches.delete(touch.identifier);
      }
    }
    this.notifyListeners('touchend', this.touchState);
  }

  /**
   * Event listener registration
   * @param {string} event 
   * @param {Function} callback 
   */
  on(event, callback) {
    this.listeners.add({ event, callback });
  }

  notifyListeners(event, data) {
    for (const listener of this.listeners) {
      if (listener.event === event || listener.event === '*') {
        listener.callback(data);
      }
    }
  }

  destroy() {
    if (!this.canvas) return;
    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    this.canvas.removeEventListener('touchmove', this.handleTouchMove);
    this.canvas.removeEventListener('touchend', this.handleTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.handleTouchEnd);
    this.listeners.clear();
  }
  }
