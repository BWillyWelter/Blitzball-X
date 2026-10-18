import type { CareerSave, MatchRecord, Player, Team } from './models.js';
import { CareerCalendar, ChemistrySystem, ContractNegotiator } from './ecosystem.js';
import { InjurySystem } from './injuries.js';
import { createLeagueData, createPlayer, FreeAgencyMarket, LivingLeague, RivalryTracker } from './league.js';
import { SeededRandom, clamp, integer } from './math.js';
import type { CareerPolicies } from './policies.js';
import { policyValue } from './policies.js';
import { MatchXPTracker } from './progression.js';
export interface CareerLogger { log(event: string, data: unknown): void }
/** Application service: validates command timing and coordinates deterministic domain modules. */
export class CareerSession {
  readonly calendar: CareerCalendar;
  readonly league: LivingLeague;
  readonly market: FreeAgencyMarket;
  readonly negotiator = new ContractNegotiator();
  readonly ledgers: MatchXPTracker[];
  readonly rng: SeededRandom;
  readonly user: Player;
  private readonly dialogueIds = new Set<string>();
  private therapyDaysSpent = 0;
  constructor(readonly policies: CareerPolicies, private readonly logger: CareerLogger, seed = 1234, saved?: CareerSave) {
    if (saved && saved.policyVersion !== policies.version) throw new Error('Policy version mismatch; explicit migration required');
    const data = saved ? structuredClone(saved) : createLeagueData();
    if (!saved) data.players.push(createPlayer('user', 'Mature Amateur'));
    this.user = data.players.find(p => p.id === (saved?.userPlayerId ?? 'user'))!;
    if (!this.user) throw new Error('Career player missing');
    this.rng = new SeededRandom(saved?.seedState ?? seed);
    this.therapyDaysSpent = saved?.therapyDaysSpent ?? 0;
    for (const id of saved?.dialogueIds ?? []) this.dialogueIds.add(id);
    this.calendar = new CareerCalendar(saved?.dayIndex ?? 0); // Starts as a mature amateur free agent on a training day.
    this.league = new LivingLeague(data.teams, data.players, this.rng, new RivalryTracker(saved?.rivalries), saved?.matches);
    this.market = new FreeAgencyMarket(data.players, data.teams, this.rng, policies);
    this.ledgers = (saved?.ledgers ?? []).map(l => new MatchXPTracker(l.matchId, l.playerId, l));
  }
  ledger(fixtureId: string): MatchXPTracker {
    const fixture = this.league.fixtures(this.calendar.current().round).find(f => f.id === fixtureId);
    if (this.calendar.current().kind !== 'match' || !this.user.contract || !fixture || ![fixture.homeTeamId, fixture.awayTeamId].includes(this.user.contract.teamId)) throw new Error('No player match active today');
    let tracker = this.ledgers.find(t => t.ledger.matchId === fixtureId);
    if (!tracker) { tracker = new MatchXPTracker(fixtureId, this.user.id); this.ledgers.push(tracker); }
    return tracker;
  }
  signUser(teamId: string, duration: number): void {
    if (this.calendar.current().kind !== 'negotiation') throw new Error('Negotiation window closed');
    const team = this.team(teamId);
    const base = this.policies.marketValue(this.user, team.demand[this.user.role] ?? 0);
    this.negotiator.sign(this.user, team, duration, base);
    this.logger.log('contract-signed', this.user.contract);
  }
  dialogue(eventId: string, choice: Parameters<typeof ChemistrySystem.dialogue>[1], context: 'halftime' | 'press'): void {
    if (!eventId || this.dialogueIds.has(eventId) || !this.user.contract) throw new Error('Duplicate/invalid dialogue');
    // UI must offer one choice per event; this set prevents click/retry farming within a session.
    ChemistrySystem.dialogue(this.team(this.user.contract.teamId), choice, context); this.dialogueIds.add(eventId);
  }
  therapy(injuryId: string, currency: number, days: number): number {
    if (this.calendar.current().kind !== 'recovery' || days !== 1 || this.therapyDaysSpent >= 1) throw new Error('Allocate one available off-day only');
    const remaining = InjurySystem.therapy(this.user, injuryId, currency, days);
    this.therapyDaysSpent++; return remaining;
  }
  completeUserMatch(record: MatchRecord): number {
    if (!this.user.contract) throw new Error('User is a free agent');
    const team = this.team(this.user.contract.teamId);
    const ledger = this.ledger(record.id);
    if (ledger.ledger.settled || this.league.matches.some(m => m.id === record.id)) throw new Error('Fixture already settled');
    const fixture = this.league.fixtures(this.calendar.current().round).find(f => f.id === record.id);
    if (!fixture || record.round !== this.calendar.current().round || fixture.homeTeamId !== record.homeTeamId || fixture.awayTeamId !== record.awayTeamId) throw new Error('Fixture mismatch');
    const home = team.id === record.homeTeamId;
    const own = home ? record.homeScore : record.awayScore;
    const other = home ? record.awayScore : record.homeScore;
    const outcome = own > other ? 'win' : own < other ? 'loss' : 'draw';
    // Validate reward policy before recording the fixture; adapters commit a complete snapshot.
    policyValue(this.policies.levelXPFactor(this.user.level));
    integer(record.goalsByPlayer[this.user.id] ?? 0, 0, 'user goals');
    this.league.record(record);
    const xp = ledger.settle(this.user, outcome, this.policies);
    this.user.reputation = clamp(this.user.reputation + (outcome === 'win' ? 2 : 0) + Math.min(3, ledger.ledger.actionXP / 15), 0, 100);
    ChemistrySystem.performance(team, outcome === 'win', ledger.ledger.actionXP);
    this.finishFixture(record);
    this.logger.log('match-settled', { id: record.id, xp, outcome }); return xp;
  }
  private finishFixture(match: MatchRecord): void {
    const ids = [match.homeTeamId, match.awayTeamId];
    for (const player of this.league.players) {
      if (!player.contract || !ids.includes(player.contract.teamId)) continue;
      const t = this.team(player.contract.teamId);
      const won = t.id === match.homeTeamId ? match.homeScore > match.awayScore : match.awayScore > match.homeScore;
      const goals = match.goalsByPlayer[player.id] ?? 0;
      const lost = t.id === match.homeTeamId ? match.homeScore < match.awayScore : match.awayScore < match.homeScore;
      player.performance = clamp(player.performance * 0.8 + (won ? 0.15 : lost ? -0.1 : 0) + Math.min(0.15, goals * 0.05), -1, 1);
      this.negotiator.payFixture(player, t, goals, won);
      InjurySystem.fixtureElapsed(player, match.id);
    }
    this.market.expireFixtureContracts(ids);
  }
  /** Explicitly skip the user's fixture only when medically unavailable; no participation XP. */
  simulateInjuredAbsence(): void {
    if (this.calendar.current().kind !== 'match' || InjurySystem.available(this.user) || !this.user.contract) throw new Error('No medically required absence');
    const teamId = this.user.contract.teamId;
    const fixture = this.league.fixtures(this.calendar.current().round).find(f => [f.homeTeamId, f.awayTeamId].includes(teamId))!;
    if (this.league.matches.some(m => m.id === fixture.id)) throw new Error('Fixture already settled');
    const before = this.user.injuries;
    // Background scoring excludes unavailable players (see LivingLeague.simulate).
    for (const match of this.league.simulate(this.calendar.current().round, null)) this.finishFixture(match);
    this.logger.log('injured-absence', { fixtureId: fixture.id, injuriesBefore: before, injuriesAfter: this.user.injuries });
  }
  advanceDay(): void {
    const day = this.calendar.current();
    if (day.kind === 'match') {
      const fixture = this.league.fixtures(day.round).find(f => [f.homeTeamId, f.awayTeamId].includes(this.user.contract?.teamId ?? ''));
      if (fixture && !this.league.matches.some(m => m.id === fixture.id)) throw new Error('Finish or explicitly simulate the scheduled user match before advancing');
      for (const match of this.league.simulate(day.round, null)) this.finishFixture(match);
    }
    if (day.kind === 'negotiation') this.logger.log('market-window', this.market.runWindow(this.user.id));
    this.calendar.advance(); this.therapyDaysSpent = 0;
    this.logger.log('calendar-day', this.calendar.current());
  }
  snapshot(): CareerSave {
    return structuredClone({ version: 1, policyVersion: this.policies.version, seedState: this.rng.state, userPlayerId: this.user.id, dayIndex: this.calendar.dayIndex, therapyDaysSpent: this.therapyDaysSpent, dialogueIds: [...this.dialogueIds],
      players: this.league.players, teams: this.league.teams, matches: this.league.matches, rivalries: this.league.rivalries.rivalries, ledgers: this.ledgers.map(t => t.ledger) });
  }
  private team(id: string): Team { const t = this.league.teams.find(t => t.id === id); if (!t) throw new Error('Unknown team'); return t; }
}
