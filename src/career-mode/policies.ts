import type { Player } from './models.js';
import { clamp, finite, nonnegative } from './math.js';
export interface InjuryRiskInput { impact: number; fatigue: number; PHY: number; statusModifier: 0 | 0.5 }
/** The user did not supply these three equations. A shipped ruleset must supply all of them. */
export interface CareerPolicies {
  version: string;
  levelXPFactor(level: number): number;
  marketValue(player: Player, demand: number): number;
  injuryProbability(input: InjuryRiskInput): number;
}
export function sigmoid(x: number): number {
  finite(x, 'sigmoid input');
  // Stable for very large positive/negative inputs.
  return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}
/** Illustrative balancing choices ONLY; not confirmed user formulas, not claimed FFX rules. */
export class ExamplePolicies implements CareerPolicies {
  readonly version = 'EXAMPLE-UNCONFIRMED-v1';
  levelXPFactor(level: number): number { return 1 / (1 + 0.05 * (level - 1)); }
  marketValue(player: Player, demand: number): number {
    return player.baseMarketValue * clamp(1 + 0.25 * demand + 0.5 * player.performance, 0.5, 2);
  }
  injuryProbability({ impact, fatigue, PHY, statusModifier }: InjuryRiskInput): number {
    // Demonstration logistic risk, with a 30% cap. impact/fatigue are normalized [0,1].
    return 0.3 * sigmoid(4 * impact + 2 * fatigue - PHY / 25 - 4 + statusModifier);
  }
}
export function probability(value: number): number {
  if (finite(value, 'probability') < 0 || value > 1) throw new RangeError('Probability outside [0,1]');
  return value;
}
export function policyValue(value: number): number { return nonnegative(value, 'policy result'); }
