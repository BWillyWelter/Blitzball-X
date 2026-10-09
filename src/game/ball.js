import { FFX_CONSTANTS } from '../data/constants.js';

export class WaterBall {
  constructor() {
    this.position = { x: 0, y: 0, z: 0 };
    this.targetPosition = { x: 0, y: 0, z: 0 };
    this.currentStat = 0; // PAS or SH value in flight
    this.isMoving = false;
    this.speed = 12.0; // Swim travel speed m/s
    this.carrier = null;
  }

  /**
   * Launches a pass or shot through water
   */
  launch(originPos, targetPos, initialStat) {
    this.position = { ...originPos };
    this.targetPosition = { ...targetPos };
    this.currentStat = initialStat;
    this.isMoving = true;
    this.carrier = null;
  }

  update(delta) {
    if (!this.isMoving) return;

    const dx = this.targetPosition.x - this.position.x;
    const dy = this.targetPosition.y - this.position.y;
    const dz = this.targetPosition.z - this.position.z;
    const distanceLeft = Math.hypot(dx, dy, dz);

    const stepDist = this.speed * delta;

    if (distanceLeft <= stepDist) {
      this.position = { ...this.targetPosition };
      this.isMoving = false;
    } else {
      // Step position toward target
      this.position.x += (dx / distanceLeft) * stepDist;
      this.position.y += (dy / distanceLeft) * stepDist;
      this.position.z += (dz / distanceLeft) * stepDist;

      // Decay stat per water distance traveled
      this.currentStat = Math.max(0, this.currentStat - (stepDist * FFX_CONSTANTS.WATER.STAT_DECAY_PER_METER));
    }
  }

  attachToCarrier(character) {
    this.carrier = character;
    this.isMoving = false;
    this.position = { ...character.position };
  }
}
