import type { MatchRecord, Player, Rivalry, Role, Standing, Team } from './models.js';
import { clamp, integer, SeededRandom } from './math.js';
import type { CareerPolicies } from './policies.js';
import { policyValue } from './policies.js';
import { InjurySystem } from './injuries.js';
export interface Bid { id: string; playerId: string; teamId: string; duration: number; salary: number; total: number }
export class RivalryTracker {
  readonly rivalries: Rivalry[];
  constructor(saved: Rivalry[] = []) { this.rivalries = structuredClone(saved); }
  private get(a: string, b: string): Rivalry {
    const pair: [string, string] = a < b ? [a, b] : [b, a];
    let rivalry = this.rivalries.find(r => r.teamIds[0] === pair[0] && r.teamIds[1] === pair[1]);
    if (!rivalry) { rivalry = { teamIds: pair, matches: 0, closeGames: 0, intensity: 0, history: [] }; this.rivalries.push(rivalry); }
    return rivalry;
  }
  record(match: MatchRecord): void {
    const r = this.get(match.homeTeamId, match.awayTeamId);
    if (r.history.some(m => m.id === match.id)) return;
    const close = Math.abs(match.homeScore - match.awayScore) <= 1;
    r.matches++; if (close) r.closeGames++;
    r.intensity = clamp(r.intensity + (close ? 8 : 2), 0, 100);
    r.history.push(structuredClone(match));
    if (r.history.length > 100) r.history.shift();
  }
  derby(a: string, b: string, baseAggression: number): { derby: boolean; aggression: number; mediaPressure: number } {
    const r = this.get(a, b);
    const derby = r.matches >= 3 && r.intensity >= 24;
    return { derby, aggression: clamp(baseAggression + (derby ? 0.25 * r.intensity / 100 : 0), 0, 1), mediaPressure: derby ? r.intensity : 0 };
  }
}
/** Full roster has 6 starters + a bench vacancy. Five original rival identities, not licensed names. */
export function createLeagueData(): { teams: Team[]; players: Player[] } {
  const profiles: Array<{ id: string; name: string; style: Team['style']; aggression: number }> = [
    { id: 'harbor', name: 'Harbor Mariners', style: 'balanced', aggression: 0.4 }, // potential user club
    { id: 'tide', name: 'Tidebreak Union', style: 'balanced', aggression: 0.45 },
    { id: 'neon', name: 'Neon Barracudas', style: 'aggressive', aggression: 0.7 },
    { id: 'alloy', name: 'Alloy Depths', style: 'technical', aggression: 0.3 },
    { id: 'glade', name: 'Glade Runners', style: 'speed', aggression: 0.4 },
    { id: 'basalt', name: 'Basalt Titans', style: 'physical', aggression: 0.8 },
  ];
  const roles: Role[] = ['forward', 'forward', 'midfielder', 'defender', 'defender', 'keeper'];
  const players: Player[] = [];
  const teams: Team[] = profiles.map((profile, teamIndex) => {
    const playerIds = roles.map((role, i) => {
      const p = createPlayer(`${profile.id}-${i}`, `${profile.name} ${i + 1}`, role);
      p.attributes = { END: 12 + teamIndex, ATK: 10 + teamIndex, PAS: 12, SHT: role === 'forward' ? 18 : 8, CAT: role === 'keeper' ? 20 : 2, BLK: 10, PHY: 15 + teamIndex, SPD: profile.style === 'speed' ? 18 : 12 };
      p.contract = { teamId: profile.id, remainingMatches: 2 + (i % 4), salaryPerMatch: 100, goalBonus: 0, winBonus: 0, endorsementPerMatch: 0 };
      players.push(p); return p.id;
    });
    return { id: profile.id, name: profile.name, style: profile.style, playerIds, capacity: 7, budget: 150_000, chemistry: 60, demand: { forward: 0.6, defender: 0.3 }, baseAggression: profile.aggression };
  });
  return { teams, players };
}
export function createPlayer(id: string, name: string, role: Role = 'forward'): Player {
  return { id, name, age: 29, role, attributes: { END: 12, ATK: 10, PAS: 14, SHT: 16, CAT: 3, BLK: 9, PHY: 14, SPD: 13 }, baseMaxHP: 100,
    level: 1, totalXP: 0, attributePoints: 0, reputation: 0, money: 1500, skills: [], inventory: [], injuries: [], contract: null, agent: null,
    baseMarketValue: 500, marketValue: 500, performance: 0 };
}
export class FreeAgencyMarket {
  private readonly issuedBids = new Map<string, Bid>();
  constructor(private readonly players: Player[], private readonly teams: Team[], private readonly rng: SeededRandom, private readonly policies: CareerPolicies) {}
  quotes(player: Player): Bid[] {
    if (player.contract) return [];
    const bids = this.teams.filter(t => t.playerIds.length < t.capacity).map(t => {
      const demand = clamp((t.demand[player.role] ?? 0) + (t.playerIds.length < 6 ? 0.3 : 0), -1, 1);
      const value = policyValue(this.policies.marketValue(player, demand));
      const duration = this.rng.whole(2, 6);
      const salary = Math.ceil(value * this.rng.range(0.9, 1.1));
      return { id: `${player.id}:${t.id}:${this.rng.state}`, playerId: player.id, teamId: t.id, duration, salary, total: duration * salary };
    }).filter(b => b.total <= this.teams.find(t => t.id === b.teamId)!.budget).sort((a, b) => b.salary - a.salary || a.teamId.localeCompare(b.teamId));
    for (const [id, quote] of this.issuedBids) if (quote.playerId === player.id) this.issuedBids.delete(id);
    for (const bid of bids) this.issuedBids.set(bid.id, structuredClone(bid));
    return bids;
  }
  sign(bid: Bid): void {
    const issued = this.issuedBids.get(bid.id);
    if (!issued || JSON.stringify(issued) !== JSON.stringify(bid)) throw new Error('Unissued or changed bid');
    const p = this.players.find(p => p.id === bid.playerId);
    const t = this.teams.find(t => t.id === bid.teamId);
    integer(bid.duration, 1, 'duration'); integer(bid.salary, 1, 'salary');
    if (!p || !t || p.contract || t.playerIds.includes(p.id) || t.playerIds.length >= t.capacity || bid.total !== bid.duration * bid.salary || t.budget < bid.total) throw new Error('Bid no longer affordable/available');
    // Reserve guaranteed compensation at signing: salary payments cannot later bankrupt the club.
    t.budget -= bid.total; t.playerIds.push(p.id);
    p.marketValue = bid.salary;
    for (const [id, quote] of this.issuedBids) if (quote.playerId === p.id) this.issuedBids.delete(id);
    p.contract = { teamId: t.id, remainingMatches: bid.duration, salaryPerMatch: bid.salary, goalBonus: 0, winBonus: 0, endorsementPerMatch: 0 };
  }
  /** Rival clubs actively compete; player character offers are left for the user's decision. */
  runWindow(userId: string): Array<{ playerId: string; teamId: string; salary: number }> {
    const signed = [];
    for (const p of [...this.players].sort((a, b) => a.id.localeCompare(b.id))) {
      if (p.id === userId || p.contract) continue;
      const offer = this.quotes(p)[0];
      if (offer) { this.sign(offer); signed.push({ playerId: p.id, teamId: offer.teamId, salary: offer.salary }); }
    }
    return signed;
  }
  expireFixtureContracts(teamIds: string[]): void {
    for (const p of this.players) {
      const c = p.contract;
      if (!c || !teamIds.includes(c.teamId)) continue;
      c.remainingMatches = Math.max(0, c.remainingMatches - 1);
      if (c.remainingMatches === 0) {
        const t = this.teams.find(t => t.id === c.teamId)!;
        t.playerIds = t.playerIds.filter(id => id !== p.id); p.contract = null;
        const demands = this.teams.map(t => t.demand[p.role] ?? 0);
        p.marketValue = policyValue(this.policies.marketValue(p, demands.reduce((a, b) => a + b, 0) / demands.length));
      }
    }
  }
}
export class LivingLeague {
  readonly matches: MatchRecord[];
  constructor(readonly teams: Team[], readonly players: Player[], private readonly rng: SeededRandom, readonly rivalries: RivalryTracker, saved: MatchRecord[] = []) {
    this.matches = structuredClone(saved);
    if (teams.length !== 6 || new Set(teams.map(t => t.id)).size !== 6) throw new Error('Career league requires six unique clubs');
  }
  /** Circle method: five rounds, then reverse venues for rounds 6..10. */
  fixtures(round: number): Array<{ id: string; homeTeamId: string; awayTeamId: string }> {
    integer(round, 1, 'round');
    const ids = this.teams.map(t => t.id);
    const rotation = (round - 1) % 5;
    for (let i = 0; i < rotation; i++) ids.splice(1, 0, ids.pop()!);
    const reverse = Math.floor((round - 1) / 5) % 2 === 1;
    return [0, 1, 2].map(i => ({ id: `fixture-${round}-${i}`, homeTeamId: ids[reverse ? 5 - i : i]!, awayTeamId: ids[reverse ? i : 5 - i]! }));
  }
  record(match: MatchRecord): void {
    integer(match.homeScore, 0, 'home score'); integer(match.awayScore, 0, 'away score');
    const fixture = this.fixtures(match.round).find(f => f.id === match.id);
    if (!fixture || fixture.homeTeamId !== match.homeTeamId || fixture.awayTeamId !== match.awayTeamId || this.matches.some(m => m.id === match.id)) throw new Error('Unknown/duplicate fixture');
    let attributedGoals = 0;
    for (const [playerId, goals] of Object.entries(match.goalsByPlayer)) {
      integer(goals, 0, 'goals');
      const player = this.players.find(p => p.id === playerId);
      if (!player?.contract || ![match.homeTeamId, match.awayTeamId].includes(player.contract.teamId)) throw new Error('Scorer is not in fixture');
      attributedGoals += goals;
    }
    if (attributedGoals > match.homeScore + match.awayScore) throw new Error('Attributed goals exceed score');
    this.matches.push(structuredClone(match)); this.rivalries.record(match);
  }
  simulate(round: number, excludedTeam: string | null): MatchRecord[] {
    const completed = [];
    for (const f of this.fixtures(round)) {
      if (this.matches.some(m => m.id === f.id) || f.homeTeamId === excludedTeam || f.awayTeamId === excludedTeam) continue;
      const match: MatchRecord = { ...f, round, homeScore: this.rng.whole(0, 5), awayScore: this.rng.whole(0, 5), goalsByPlayer: {} };
      // Demo scorer assignment; a real AI match port must use the same encounter core.
      for (const [teamId, goals] of [[f.homeTeamId, match.homeScore], [f.awayTeamId, match.awayScore]] as const) {
        const candidates = this.players.filter(p => p.contract?.teamId === teamId && InjurySystem.available(p));
        for (let goal = 0; goal < goals && candidates.length; goal++) {
          const scorer = candidates[this.rng.whole(0, candidates.length - 1)]!;
          match.goalsByPlayer[scorer.id] = (match.goalsByPlayer[scorer.id] ?? 0) + 1;
        }
      }
      this.record(match); completed.push(match);
    }
    return completed;
  }
  standings(): Record<string, Standing> {
    const table: Record<string, Standing> = Object.fromEntries(this.teams.map(t => [t.id, { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }]));
    for (const m of this.matches) {
      for (const [id, own, other] of [[m.homeTeamId, m.homeScore, m.awayScore], [m.awayTeamId, m.awayScore, m.homeScore]] as const) {
        const s = table[id]!; s.played++; s.goalsFor += own; s.goalsAgainst += other;
        if (own > other) { s.wins++; s.points += 3; } else if (own < other) s.losses++; else { s.draws++; s.points++; }
      }
    }
    return table;
  }
}
