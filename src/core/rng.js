/**
 * Deterministic PRNG (mulberry32).
 * The whole simulation pulls randomness from one seeded stream so that
 * headless tests and balance sims are reproducible.
 */
export class RNG {
  constructor(seed = 0x1badb002) {
    this.state = seed >>> 0;
  }

  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  chance(p) {
    return this.next() < p;
  }
}
