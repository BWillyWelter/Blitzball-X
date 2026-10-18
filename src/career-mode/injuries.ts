import type { Attributes, Injury, Player } from './models.js';
import { clamp, nonnegative, SeededRandom } from './math.js';
import type { CareerPolicies, InjuryRiskInput } from './policies.js';
import { probability } from './policies.js';
export class InjurySystem {
  constructor(private readonly rng: SeededRandom, private readonly policies: CareerPolicies) {}
  private readonly processedCollisions = new Set<string>();
  collide(player: Player, input: InjuryRiskInput, eventId: string, fixtureId?: string): Injury | null {
    if (!eventId || this.processedCollisions.has(`${player.id}:${eventId}`)) throw new Error('Collision ID missing or duplicate');
    nonnegative(input.impact, 'impact'); nonnegative(input.fatigue, 'fatigue');
    if (input.impact < 0 || input.impact > 1 || input.fatigue < 0 || input.fatigue > 1) throw new RangeError('Normalize impact and fatigue to [0,1]');
    nonnegative(input.PHY, 'PHY');
    if (![0, 0.5].includes(input.statusModifier)) throw new RangeError('Invalid status modifier');
    const risk = probability(this.policies.injuryProbability(input));
    this.processedCollisions.add(`${player.id}:${eventId}`);
    if (this.rng.next() >= risk) return null;
    // Classification is a tunable policy choice; durations are specified by the request.
    const severe = input.impact >= 0.8 && this.rng.next() < 0.35;
    const injury: Injury = {
      id: eventId, kind: severe ? (this.rng.next() < 0.5 ? 'fracture' : 'tear') : (this.rng.next() < 0.5 ? 'strain' : 'bruise'),
      severity: severe ? 'severe' : 'minor', remainingMatches: this.rng.whole(severe ? 4 : 1, severe ? 8 : 2),
      affectedStats: ['SPD', 'PHY'], statMultiplier: severe ? 0 : 0.85,
    };
    if (fixtureId) injury.acquiredFixtureId = fixtureId;
    player.injuries.push(injury); return injury;
  }
  static available(player: Player): boolean { return !player.injuries.some(i => i.severity === 'severe' && i.remainingMatches > 0); }
  static attributes(player: Player): Attributes {
    const stats = { ...player.attributes };
    for (const injury of player.injuries) if (injury.remainingMatches > 0) {
      for (const stat of injury.affectedStats) stats[stat] *= injury.statMultiplier;
    }
    return stats;
  }
  /** Called ONCE after a scheduled team fixture, including fixtures the injured player misses. */
  static fixtureElapsed(player: Player, fixtureId?: string): void {
    for (const injury of player.injuries) if (!fixtureId || injury.acquiredFixtureId !== fixtureId) injury.remainingMatches = Math.max(0, injury.remainingMatches - 1);
    player.injuries = player.injuries.filter(i => i.remainingMatches > 0);
  }
  /** Natural logarithm, fractional recovery preserved; display uses ceil, never negative matches. */
  static therapy(player: Player, injuryId: string, C: number, D: number): number {
    nonnegative(C, 'currency'); nonnegative(D, 'off days');
    if (C > player.money) throw new RangeError('Insufficient funds');
    const injury = player.injuries.find(i => i.id === injuryId);
    if (!injury) throw new Error('Unknown injury');
    const newTime = clamp(injury.remainingMatches - Math.log(C + 1) * D, 0, injury.remainingMatches);
    if (newTime === injury.remainingMatches) return newTime; // zero spending or days must not charge
    player.money -= C; injury.remainingMatches = newTime;
    player.injuries = player.injuries.filter(i => i.remainingMatches > 0);
    return newTime;
  }
}
