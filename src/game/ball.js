import { GAME_CONSTANTS } from '../data/constants.js';

export class Ball {
  constructor() {
    this.position = { x: 0, y: 1.0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.spin = { x: 0, y: 0, z: 0 }; // Spin vector causing Magnus effect breaking pitches
    this.isAirborne = false;
    this.radius = GAME_CONSTANTS.BALL.RADIUS;
    this.mass = GAME_CONSTANTS.BALL.MASS;
  }

  /**
   * Applies a pitch velocity and spin vector
   * @param {{x: number, y: number, z: number}} vel 
   * @param {{x: number, y: number, z: number}} spinVector 
   */
  launch(vel, spinVector = { x: 0, y: 0, z: 0 }) {
    this.velocity = { ...vel };
    this.spin = { ...spinVector };
    this.isAirborne = true;
  }

  /**
   * Physics step execution
   * @param {number} delta Seconds elapsed
   */
  update(delta) {
    if (!this.isAirborne) return;

    // Air Drag calculation
    const speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
    const dragForce = 0.5 * GAME_CONSTANTS.BALL.DRAG_COEFFICIENT * speed * speed;
    
    if (speed > 0) {
      this.velocity.x -= (this.velocity.x / speed) * dragForce * delta;
      this.velocity.y -= (this.velocity.y / speed) * dragForce * delta;
      this.velocity.z -= (this.velocity.z / speed) * dragForce * delta;
    }

    // Magnus Effect calculation (Spin-induced trajectory breaking)
    const magnusMult = GAME_CONSTANTS.BALL.MAGNUS_EFFECT_MULT;
    this.velocity.x += (this.spin.y * this.velocity.z - this.spin.z * this.velocity.y) * magnusMult * delta;
    this.velocity.y += (this.spin.z * this.velocity.x - this.spin.x * this.velocity.z) * magnusMult * delta;
    this.velocity.z += (this.spin.x * this.velocity.y - this.spin.y * this.velocity.x) * magnusMult * delta;

    // Gravity
    this.velocity.y -= 9.81 * delta;

    // Position integration
    this.position.x += this.velocity.x * delta;
    this.position.y += this.velocity.y * delta;
    this.position.z += this.velocity.z * delta;

    // Turf ground bounce handling
    if (this.position.y <= this.radius) {
      this.position.y = this.radius;
      this.velocity.y = -this.velocity.y * GAME_CONSTANTS.BALL.RESTITUTION;
      this.velocity.x *= 0.8; // Ground friction
      this.velocity.z *= 0.8;

      if (Math.abs(this.velocity.y) < 0.2) {
        this.velocity.y = 0;
        this.isAirborne = false;
      }
    }
  }

  /**
   * Checks if the ball crosses the strike zone target
   * @param {Object} strikeZone { x, y, z, width, height }
   * @returns {boolean}
   */
  checkStrikeZoneCollision(strikeZone) {
    const inZ = Math.abs(this.position.z - strikeZone.z) < 0.2;
    const inX = Math.abs(this.position.x - strikeZone.x) <= strikeZone.width / 2;
    const inY = this.position.y >= strikeZone.y && this.position.y <= strikeZone.y + strikeZone.height;

    return inZ && inX && inY;
  }

  reset() {
    this.position = { x: 0, y: 1.0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.spin = { x: 0, y: 0, z: 0 };
    this.isAirborne = false;
  }
}
