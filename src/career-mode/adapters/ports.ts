import type { Body } from '../models.js';
import type { CameraEffects, FOVTarget, SwimInput } from '../physics.js';
import type { CareerLogger } from '../session.js';
/** Implement with Three.js/Unity/Unreal; simulation never references scene/camera objects. */
export interface FirstPersonRenderPort {
  setPose(body: Body): void;
  setUnderwaterEffects(effects: CameraEffects, reducedMotion: boolean): void;
  drawTargets(targets: FOVTarget[]): void;
  isOccluded(targetId: string): boolean;
}
export interface InputPort { poll(): SwimInput }
export class ConsoleCareerLogger implements CareerLogger {
  log(event: string, data: unknown): void { console.log(`[career:${event}]`, JSON.stringify(data)); }
}
/** Intentionally not a renderer: mock output makes engine-specific work explicit. */
export class MockFirstPersonRenderer implements FirstPersonRenderPort {
  constructor(private readonly logger: CareerLogger) {}
  setPose(body: Body): void { this.logger.log('camera-pose', { position: body.position, orientation: body.orientation }); }
  setUnderwaterEffects(effects: CameraEffects, reducedMotion: boolean): void {
    this.logger.log('underwater-effects', { ...effects, peripheralBlur: reducedMotion ? 0 : effects.peripheralBlur });
  }
  drawTargets(targets: FOVTarget[]): void { this.logger.log('fov-targets', targets.filter(t => t.visible)); }
  isOccluded(_targetId: string): boolean { return false; } // engine raycast placeholder
}
