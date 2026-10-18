import type { Quaternion, Vec3 } from './models.js';
export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
export function finite(n: number, name: string): number {
  if (!Number.isFinite(n)) throw new RangeError(`${name} must be finite`);
  return n;
}
export function nonnegative(n: number, name: string): number {
  if (finite(n, name) < 0) throw new RangeError(`${name} must be nonnegative`);
  return n;
}
export function integer(n: number, min: number, name: string): number {
  if (!Number.isSafeInteger(n) || n < min) throw new RangeError(`${name} must be an integer >= ${min}`);
  return n;
}
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });
export const sub = (a: Vec3, b: Vec3): Vec3 => add(a, scale(b, -1));
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export function checkVec(v: Vec3): void { finite(v.x, 'x'); finite(v.y, 'y'); finite(v.z, 'z'); }
export const unit = (v: Vec3): Vec3 => length(v) > 0 ? scale(v, 1 / length(v)) : { x: 0, y: 0, z: 0 };
export function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export function normalize(q: Quaternion): Quaternion {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(n) || n === 0) throw new RangeError('Invalid orientation');
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}
export function rotate(q: Quaternion, v: Vec3): Vec3 {
  const r = multiply(multiply(q, { ...v, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w });
  return { x: r.x, y: r.y, z: r.z };
}
/** Separate serializable PRNG streams should be used for matches and the league economy. */
export class SeededRandom {
  public state: number;
  constructor(seed: number) { integer(seed, 0, 'seed'); if (seed > 0xffffffff) throw new RangeError('seed overflow'); this.state = seed; }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    finite(min, 'minimum'); finite(max, 'maximum'); if (max < min) throw new RangeError('Reversed range');
    return min + (max - min) * this.next();
  }
  whole(min: number, max: number): number { integer(min, 0, 'minimum'); integer(max, min, 'maximum'); return Math.floor(this.range(min, max + 1)); }
}
