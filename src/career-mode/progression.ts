import type { Action, MatchLedger, Outcome, Player, Rank, Stat } from './models.js';
import { integer, nonnegative } from './math.js';
import type { CareerPolicies } from './policies.js';
import { policyValue } from './policies.js';
export const ACTION_XP: Readonly<Record<Action, number>> = { pass: 2, tackle: 4, block: 4, goal: 10, techcopy: 15 };
export const OUTCOME_MULTIPLIERS: Readonly<Record<Outcome, number>> = { win: 1.5, draw: 1, loss: 0.7 };
export class Progression {
  static required(level: number): number { integer(level, 1, 'level'); return 100 * Math.pow(level, 1.5); }
  /** Explicit interpretation: the supplied XP requirement is CUMULATIVE, not a spendable cost. */
  static grant(player: Player, xp: number): number {
    integer(xp, 0, 'XP'); integer(player.totalXP, 0, 'total XP'); integer(player.level, 1, 'level');
    integer(player.totalXP + xp, 0, 'total XP overflow');
    player.totalXP += xp;
    let gained = 0;
    while (player.level < 100 && player.totalXP >= Progression.required(player.level)) {
      player.level++; player.attributePoints += 3; gained++;
    }
    return gained;
  }
  static distribute(player: Player, stat: Stat, points: number): void {
    integer(points, 1, 'points');
    if (points > player.attributePoints || player.attributes[stat] + points > 99) throw new RangeError('Attribute allocation exceeds budget/cap');
    player.attributePoints -= points; player.attributes[stat] += points;
  }
  static rank(player: Player): Rank {
    if (player.level >= 30 && player.reputation >= 75) return 'All-Star';
    if (player.level >= 15 && player.reputation >= 40) return 'Veteran';
    if (player.contract && player.reputation >= 10) return 'Professional';
    return 'Mature Amateur';
  }
}
export class MatchXPTracker {
  readonly ledger: MatchLedger;
  constructor(matchId: string, playerId: string, ledger?: MatchLedger) {
    if (!matchId || !playerId) throw new Error('Ledger identity required');
    if (ledger && (ledger.matchId !== matchId || ledger.playerId !== playerId)) throw new Error('Ledger identity mismatch');
    this.ledger = ledger ? structuredClone(ledger) : { matchId, playerId, actionIds: [], actionXP: 0, settled: false, awardedXP: 0 };
  }
  /** Invoke only for confirmed successful user actions; duplicate authoritative event IDs pay once. */
  AwardXP(eventId: string, action: Action, actorId: string): number {
    if (!eventId) throw new Error('Event ID required');
    if (this.ledger.settled) throw new Error('Match XP already settled');
    if (actorId !== this.ledger.playerId || this.ledger.actionIds.includes(eventId)) return 0;
    if (this.ledger.actionIds.length >= 10_000) throw new Error('Match event budget exceeded');
    this.ledger.actionIds.push(eventId); this.ledger.actionXP += ACTION_XP[action];
    return ACTION_XP[action];
  }
  settle(player: Player, outcome: Outcome, policies: CareerPolicies): number {
    if (player.id !== this.ledger.playerId) throw new Error('XP owner mismatch');
    if (this.ledger.settled) return 0;
    const factor = policyValue(policies.levelXPFactor(player.level));
    const xp = Math.floor(nonnegative(this.ledger.actionXP, 'action XP') * OUTCOME_MULTIPLIERS[outcome] * factor);
    Progression.grant(player, xp);
    this.ledger.awardedXP = xp; this.ledger.settled = true;
    return xp;
  }
}
