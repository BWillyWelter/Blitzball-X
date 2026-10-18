import type { Agent, CalendarDay, DayKind, Player, Team } from './models.js';
import { clamp, integer, nonnegative } from './math.js';
export const AGENTS: ReadonlyArray<Agent & { hiringCost: number; salaryMultiplier: number; endorsement: number }> = [
  { tier: 1, name: 'Local Representative', hiringCost: 100, salaryMultiplier: 1, endorsement: 0 },
  { tier: 2, name: 'Regional Partner', hiringCost: 1000, salaryMultiplier: 1.15, endorsement: 50 },
  { tier: 3, name: 'Elite Agency', hiringCost: 5000, salaryMultiplier: 1.35, endorsement: 150 },
];
export class ContractNegotiator {
  hire(player: Player, tier: Agent['tier']): void {
    const agent = AGENTS.find(a => a.tier === tier)!;
    if (!agent || (player.agent?.tier ?? 0) >= tier || player.money < agent.hiringCost) throw new Error('Agent unavailable/insufficient currency');
    player.money -= agent.hiringCost; player.agent = { tier, name: agent.name };
  }
  quote(player: Player, team: Team, duration: number, baseSalary: number): { salary: number; endorsement: number; goalBonus: number; winBonus: number; guaranteed: number } {
    integer(duration, 1, 'duration'); nonnegative(baseSalary, 'salary');
    const agent = AGENTS.find(a => a.tier === player.agent?.tier);
    const salary = Math.ceil(baseSalary * (agent?.salaryMultiplier ?? 0.9));
    const endorsement = player.reputation >= 25 ? agent?.endorsement ?? 0 : 0;
    const goalBonus = agent ? Math.ceil(salary * 0.1) : 0;
    const winBonus = agent ? Math.ceil(salary * 0.2) : 0;
    const guaranteed = (salary + endorsement) * duration;
    if (guaranteed > team.budget) throw new Error('Club cannot guarantee offer');
    return { salary, endorsement, goalBonus, winBonus, guaranteed };
  }
  sign(player: Player, team: Team, duration: number, baseSalary: number): void {
    if (player.contract || team.playerIds.length >= team.capacity || team.playerIds.includes(player.id)) throw new Error('Roster/contract unavailable');
    const quote = this.quote(player, team, duration, baseSalary);
    team.budget -= quote.guaranteed; team.playerIds.push(player.id);
    player.contract = { teamId: team.id, remainingMatches: duration, salaryPerMatch: quote.salary, endorsementPerMatch: quote.endorsement, goalBonus: quote.goalBonus, winBonus: quote.winBonus };
  }
  payFixture(player: Player, team: Team, goals: number, won: boolean): number {
    integer(goals, 0, 'goals');
    const contract = player.contract;
    if (!contract || contract.teamId !== team.id) return 0;
    const bonus = goals * contract.goalBonus + (won ? contract.winBonus : 0);
    const payableBonus = Math.min(team.budget, bonus);
    team.budget -= payableBonus;
    const compensation = contract.salaryPerMatch + contract.endorsementPerMatch + payableBonus;
    player.money += compensation; return compensation;
  }
}
export type DialogueChoice = 'credit-teammates' | 'take-responsibility' | 'blame-team';
export class ChemistrySystem {
  static dialogue(team: Team, choice: DialogueChoice, context: 'halftime' | 'press'): void {
    const delta = { 'credit-teammates': 4, 'take-responsibility': 2, 'blame-team': -8 }[choice];
    team.chemistry = clamp(team.chemistry + delta * (context === 'halftime' ? 1 : 0.75), 0, 100);
  }
  static performance(team: Team, won: boolean, contribution: number): void {
    nonnegative(contribution, 'contribution');
    team.chemistry = clamp(team.chemistry + (won ? 3 : -2) + Math.min(3, contribution / 10), 0, 100);
  }
  static modifiers(team: Team): { passAccuracy: number; responseSeconds: number } {
    return { passAccuracy: 0.7 + 0.3 * clamp(team.chemistry, 0, 100) / 100, responseSeconds: 1.2 - 0.8 * clamp(team.chemistry, 0, 100) / 100 };
  }
}
/** All off-field mutations are driven by this sequence; matches must settle before advancing. */
export class CareerCalendar {
  private static readonly WEEK: readonly DayKind[] = ['training', 'travel', 'match', 'recovery', 'negotiation', 'recovery', 'training'];
  constructor(public dayIndex = 0) { integer(dayIndex, 0, 'day index'); }
  current(): CalendarDay { return { index: this.dayIndex, round: Math.floor(this.dayIndex / 7) + 1, kind: CareerCalendar.WEEK[this.dayIndex % 7]! }; }
  advance(): CalendarDay { integer(this.dayIndex + 1, 0, 'calendar overflow'); this.dayIndex++; return this.current(); }
}
