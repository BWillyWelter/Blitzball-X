import type { Attributes, Stat } from './models.js';
import { finite, nonnegative } from './math.js';
export type StatusEffect =
  | { kind: 'poison'; remainingSeconds: number; tickSeconds: number; accumulator: number; maxHPFraction: number }
  | { kind: 'wither'; remainingSeconds: number; stats: Array<'PHY' | 'PAS' | 'SHT'> }
  | { kind: 'sleep'; remainingSeconds: number };
export interface VitalState { baseMaxHP: number; maxHP: number; HP: number }
/** Match-local effects. Poison reduces MAXIMUM stamina too, and clamps current stamina to it. */
export class StatusSystem {
  private effects: StatusEffect[] = [];
  apply(effect: StatusEffect): void {
    if (finite(effect.remainingSeconds, 'duration') <= 0) throw new RangeError('Positive duration required');
    if (effect.kind === 'poison') {
      if (finite(effect.tickSeconds, 'poison interval') <= 0 || effect.maxHPFraction <= 0 || effect.maxHPFraction > 1 || !Number.isFinite(effect.maxHPFraction)) throw new RangeError('Invalid poison settings');
      if (effect.accumulator !== 0) throw new Error('New poison starts with zero elapsed time');
    }
    if (effect.kind === 'wither' && (!effect.stats.length || effect.stats.some(s => !['PHY', 'PAS', 'SHT'].includes(s)))) throw new Error('Invalid withered stats');
    this.effects = this.effects.filter(e => e.kind !== effect.kind); // refresh, not exponential stacks
    this.effects.push(structuredClone(effect));
  }
  tick(dt: number, vitals: VitalState): void {
    nonnegative(dt, 'dt'); nonnegative(vitals.baseMaxHP, 'base HP');
    if (vitals.baseMaxHP < 1 || !Number.isFinite(vitals.maxHP) || vitals.maxHP < 1 || vitals.maxHP > vitals.baseMaxHP || !Number.isFinite(vitals.HP) || vitals.HP < 0 || vitals.HP > vitals.maxHP) throw new RangeError('Invalid stamina state');
    for (const effect of this.effects) {
      const activeTime = Math.min(dt, effect.remainingSeconds);
      if (effect.kind === 'poison') {
        effect.accumulator += activeTime;
        const ticks = Math.floor((effect.accumulator + 1e-9) / effect.tickSeconds);
        effect.accumulator = Math.max(0, effect.accumulator - ticks * effect.tickSeconds);
        vitals.maxHP = Math.max(1, vitals.maxHP - ticks * vitals.baseMaxHP * effect.maxHPFraction);
        vitals.HP = Math.min(vitals.HP, vitals.maxHP);
      }
      effect.remainingSeconds = Math.max(0, effect.remainingSeconds - dt);
    }
    this.effects = this.effects.filter(e => e.remainingSeconds > 0);
  }
  effective(base: Attributes): Attributes {
    const stats = { ...base };
    for (const effect of this.effects) if (effect.kind === 'wither') {
      for (const stat of new Set<Stat>(effect.stats)) stats[stat] *= 0.5;
    }
    return stats;
  }
  get mobile(): boolean { return !this.has('sleep'); }
  has(kind: StatusEffect['kind']): boolean { return this.effects.some(e => e.kind === kind); }
  get injuryModifier(): 0 | 0.5 { return this.has('poison') || this.has('wither') ? 0.5 : 0; }
  wake(event: 'pass-received' | 'opponent-hit'): void {
    if (event === 'pass-received' || event === 'opponent-hit') this.effects = this.effects.filter(e => e.kind !== 'sleep');
  }
  endMatch(vitals: VitalState): void { this.effects = []; vitals.maxHP = vitals.baseMaxHP; vitals.HP = vitals.baseMaxHP; }
}
