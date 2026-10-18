import type { Player } from './models.js';
import { integer } from './math.js';
import type { MatchXPTracker } from './progression.js';
import type { StatusEffect } from './statuses.js';
export interface Skill { id: string; name: string; staminaCost: number; minLevel: number; copyable: boolean; effect: StatusEffect | null }
export const SKILLS: ReadonlyArray<Skill> = [
  { id: 'spiral-shot', name: 'Spiral Shot', staminaCost: 12, minLevel: 1, copyable: true, effect: null },
  { id: 'venom-pass', name: 'Venom Pass', staminaCost: 8, minLevel: 3, copyable: true, effect: { kind: 'poison', remainingSeconds: 10, tickSeconds: 1, accumulator: 0, maxHPFraction: 0.02 } },
  { id: 'wither-hit', name: 'Wither Hit', staminaCost: 10, minLevel: 3, copyable: true, effect: { kind: 'wither', remainingSeconds: 10, stats: ['PHY', 'PAS', 'SHT'] } },
  { id: 'sleep-pass', name: 'Sleep Pass', staminaCost: 10, minLevel: 5, copyable: true, effect: { kind: 'sleep', remainingSeconds: 10 } },
];
export interface SkillExecution { id: string; opponentId: string; skillId: string; openedAtTick: number; closedAtTick: number }
/** Uses SIMULATION ticks, not browser Date.now/rAF; target/FOV come from authoritative match state. */
export class TechcopySystem {
  private observed: SkillExecution | null = null;
  private consumed = new Set<string>();
  observe(execution: SkillExecution, targetedOpponent: string, inFOV: boolean, isOpponent: boolean, player: Player): boolean {
    integer(execution.openedAtTick, 0, 'opening tick'); integer(execution.closedAtTick, execution.openedAtTick, 'closing tick');
    if (execution.closedAtTick - execution.openedAtTick > 120) throw new RangeError('Techcopy timing window too large');
    const skill = SKILLS.find(s => s.id === execution.skillId);
    if (!skill?.copyable || !isOpponent || targetedOpponent !== execution.opponentId || !inFOV || player.level < skill.minLevel || player.skills.includes(skill.id) || this.consumed.has(execution.id)) {
      this.observed = null; return false;
    }
    this.observed = structuredClone(execution); return true;
  }
  attempt(tick: number, targetedOpponent: string, inFOV: boolean, player: Player, xp: MatchXPTracker): boolean {
    integer(tick, 0, 'tick');
    const e = this.observed;
    if (!e || tick < e.openedAtTick || tick > e.closedAtTick || !inFOV || targetedOpponent !== e.opponentId || player.skills.includes(e.skillId) || this.consumed.has(e.id)) return false;
    // Validate ledger ownership before changing permanent learned skills.
    if (xp.ledger.playerId !== player.id || xp.ledger.settled) throw new Error('Invalid skill XP ledger');
    xp.AwardXP(`techcopy:${e.id}`, 'techcopy', player.id);
    player.skills.push(e.skillId); this.consumed.add(e.id); this.observed = null;
    return true;
  }
}
