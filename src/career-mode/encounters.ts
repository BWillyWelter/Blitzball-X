import type { Vec3 } from './models.js';
import { checkVec, distance, finite, nonnegative, SeededRandom } from './math.js';
export interface Defender { id: string; ATK: number }
export interface BreakthroughResult { remainingEND: number; turnoverBy: string | null; battles: Array<{ id: string; variance: number; damage: number }> }
export class EncounterMath {
  constructor(private readonly rng: SeededRandom) {}
  breakthrough(END: number, defenders: Defender[]): BreakthroughResult {
    nonnegative(END, 'END');
    if (END === 0) throw new RangeError('Exhausted carrier cannot initiate breakthrough');
    for (const d of defenders) nonnegative(d.ATK, 'ATK');
    if (new Set(defenders.map(d => d.id)).size !== defenders.length) throw new Error('Duplicate defender');
    const result: BreakthroughResult = { remainingEND: END, turnoverBy: null, battles: [] };
    // Caller supplies stable ordered defenders; no Math.random or frame-dependent sorting.
    for (const defender of defenders) {
      const variance = this.rng.range(0.5, 1.5);
      const damage = defender.ATK * variance;
      result.remainingEND -= damage;
      result.battles.push({ id: defender.id, variance, damage });
      if (result.remainingEND <= 0) { result.turnoverBy = defender.id; break; }
    }
    return result;
  }
  static decay(initial: number, k: number, pathDistance: number): number {
    nonnegative(initial, 'initial'); nonnegative(k, 'k'); nonnegative(pathDistance, 'distance');
    return initial * Math.exp(-k * pathDistance);
  }
  contest(initial: number, k: number, pathDistance: number, BLKorCAT: number): { currentStat: number; opposingStat: number; variance: number; success: boolean } {
    nonnegative(BLKorCAT, 'BLK/CAT');
    const currentStat = EncounterMath.decay(initial, k, pathDistance);
    const variance = this.rng.range(0.5, 1.5);
    const opposingStat = BLKorCAT * variance;
    return { currentStat, opposingStat, variance, success: currentStat > opposingStat }; // ties defended
  }
}
/** Debounced boundary: stay latched until all opponents leave the larger release radius. */
export class ProximityEncounter {
  private latched = false;
  private encounterResolved = false;
  constructor(private readonly radius = 3.5, private readonly releaseRadius = 4.5, private readonly encounterScale = 0) {
    nonnegative(radius, 'radius'); finite(releaseRadius, 'release radius'); finite(encounterScale, 'encounter scale');
    if (releaseRadius <= radius || encounterScale < 0 || encounterScale > 1) throw new RangeError('Invalid encounter gate');
  }
  update(user: Vec3, opponents: Array<{ id: string; position: Vec3 }>): { entered: boolean; timeScale: number; defenderIds: string[] } {
    checkVec(user); for (const o of opponents) checkVec(o.position);
    if (this.latched && opponents.every(o => distance(o.position, user) > this.releaseRadius)) { this.latched = false; this.encounterResolved = false; }
    const defenderIds = opponents.filter(o => distance(o.position, user) <= this.radius).map(o => o.id).sort();
    const entered = !this.latched && defenderIds.length > 0;
    if (entered) { this.latched = true; this.encounterResolved = false; }
    return { entered, defenderIds, timeScale: this.latched && !this.encounterResolved ? this.encounterScale : 1 };
  }
  /** Resolution releases movement, but re-entry cannot trigger while still inside the boundary. */
  resolve(): void { this.encounterResolved = true; }
}
