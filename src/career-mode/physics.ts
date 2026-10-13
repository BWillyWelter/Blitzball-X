import type { Body, Quaternion, Vec3 } from './models.js';
import { add, checkVec, clamp, distance, dot, finite, length, multiply, nonnegative, normalize, rotate, scale, sub, unit } from './math.js';
export interface SwimInput { thrust: Vec3; pitch: number; yaw: number; roll: number }
export interface CameraEffects { visibility: number; peripheralBlur: number; tint: [number, number, number] }
export interface VisualTarget { id: string; teammate: boolean; position: Vec3 }
export interface FOVTarget { id: string; teammate: boolean; visible: boolean; depth: number; horizontal: number; vertical: number }
export class WaterSpherePhysics {
  constructor(public readonly sphereRadius = 15, public readonly drag = 1.2, public readonly thrust = 8, public readonly maxSpeed = 6) {
    nonnegative(sphereRadius, 'sphere radius'); nonnegative(drag, 'drag'); nonnegative(thrust, 'thrust'); nonnegative(maxSpeed, 'max speed');
    if (sphereRadius === 0 || maxSpeed === 0) throw new RangeError('Radius and speed must be positive');
  }
  /** Call at a fixed 1/60 s. Exponential damping; collision removes only outward velocity. */
  step(body: Body, input: SwimInput, dt: number, mobile = true): void {
    nonnegative(dt, 'dt'); if (dt > 0.1) throw new RangeError('Use fixed, bounded timesteps');
    checkVec(body.position); checkVec(body.velocity); checkVec(input.thrust); nonnegative(body.radius, 'body radius');
    if (body.radius >= this.sphereRadius) throw new RangeError('Body does not fit sphere');
    if (!mobile) { body.velocity = { x: 0, y: 0, z: 0 }; return; }
    const turn = (axis: Vec3, angle: number): Quaternion => ({ ...scale(axis, Math.sin(angle / 2)), w: Math.cos(angle / 2) });
    for (const n of [input.pitch, input.yaw, input.roll]) finite(n, 'angular input');
    const rotation = multiply(multiply(turn({ x: 0, y: 1, z: 0 }, input.yaw * dt), turn({ x: 1, y: 0, z: 0 }, input.pitch * dt)), turn({ x: 0, y: 0, z: 1 }, input.roll * dt));
    body.orientation = normalize(multiply(normalize(body.orientation), rotation));
    const local = length(input.thrust) > 1 ? unit(input.thrust) : input.thrust;
    const acceleration = scale(rotate(body.orientation, local), this.thrust);
    const decay = Math.exp(-this.drag * dt);
    body.velocity = add(scale(body.velocity, decay), scale(acceleration, this.drag === 0 ? dt : (1 - decay) / this.drag));
    if (length(body.velocity) > this.maxSpeed) body.velocity = scale(unit(body.velocity), this.maxSpeed);
    body.position = add(body.position, scale(body.velocity, dt));
    const limit = this.sphereRadius - body.radius;
    if (length(body.position) > limit) {
      const normal = unit(body.position);
      body.position = scale(normal, limit);
      body.velocity = sub(body.velocity, scale(normal, Math.max(0, dot(body.velocity, normal))));
    }
  }
}
export class FirstPersonCamera {
  constructor(public readonly near = 0.05, public readonly sightDistance = 30, public readonly waterAbsorption = 0.06, public readonly horizontalFOV = Math.PI / 2) {
    nonnegative(near, 'near'); nonnegative(waterAbsorption, 'absorption');
    if (finite(sightDistance, 'sight distance') <= near || finite(horizontalFOV, 'FOV') <= 0 || horizontalFOV >= Math.PI) throw new RangeError('Invalid camera frustum');
  }
  effects(speed: number, targetDistance: number): CameraEffects {
    nonnegative(speed, 'speed'); nonnegative(targetDistance, 'distance');
    return { visibility: targetDistance > this.sightDistance ? 0 : Math.exp(-this.waterAbsorption * targetDistance), peripheralBlur: clamp(speed / 6, 0, 1), tint: [0.08, 0.4, 0.5] };
  }
  /** Local forward is -Z. Occlusion is an engine raycast, not this geometric visibility check. */
  targets(body: Body, targets: VisualTarget[], aspect: number): FOVTarget[] {
    if (finite(aspect, 'aspect') <= 0) throw new RangeError('Invalid aspect');
    const q = normalize(body.orientation);
    const inverse = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    const tanH = Math.tan(this.horizontalFOV / 2);
    const tanV = tanH / aspect;
    return targets.map(t => {
      checkVec(t.position);
      const local = rotate(inverse, sub(t.position, body.position));
      const depth = -local.z;
      const horizontal = depth > 0 ? local.x / (depth * tanH) : 0;
      const vertical = depth > 0 ? local.y / (depth * tanV) : 0;
      return { id: t.id, teammate: t.teammate, depth, horizontal, vertical,
        visible: depth >= this.near && distance(t.position, body.position) <= this.sightDistance && Math.abs(horizontal) <= 1 && Math.abs(vertical) <= 1 };
    });
  }
}
