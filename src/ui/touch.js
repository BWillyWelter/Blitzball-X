/**
 * Sphere Pool Touch & Gesture Controls for Blitzball-X
 */

export class FFXTouchController {
  /**
   * @param {HTMLCanvasElement} canvas 
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.touchStartPos = { x: 0, y: 0 };
    this.currentVector = { x: 0, y: 0 }; // Normalized Joystick Vector (-1 to +1)
    this.isSwiping = false;

    this.bindEvents();
  }

  bindEvents() {
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isSwiping = true;
        this.touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    });

    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.isSwiping || e.touches.length === 0) return;

      const dx = e.touches[0].clientX - this.touchStartPos.x;
      const dy = e.touches[0].clientY - this.touchStartPos.y;

      const maxRadius = 60.0;
      this.currentVector = {
        x: Math.max(-1.0, Math.min(1.0, dx / maxRadius)),
        y: Math.max(-1.0, Math.min(1.0, dy / maxRadius))
      };
    });

    this.canvas.addEventListener('touchend', () => {
      this.isSwiping = false;
      this.currentVector = { x: 0, y: 0 };
    });
  }

  /**
   * Returns current 3D underwater swim directional vector
   * @returns {{ x: number, y: number, z: number }}
   */
  getSwimDirection() {
    return {
      x: this.currentVector.x,
      y: 0, // Depth adjusted via vertical tilt gestures
      z: this.currentVector.y
    };
  }

  triggerHaptic(type = 'light') {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      if (type === 'light') navigator.vibrate(25);
      if (type === 'encounter') navigator.vibrate([40, 30, 80]);
      if (type === 'goal') navigator.vibrate([100, 50, 100, 50, 200]);
    }
  }
}
