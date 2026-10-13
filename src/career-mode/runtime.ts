import type { Body, MatchRecord, Player, Vec3 } from './models.js';
import { EncounterMath, ProximityEncounter } from './encounters.js';
import { WaterSpherePhysics, type SwimInput } from './physics.js';
import { ChemistrySystem } from './ecosystem.js';
import { InjurySystem } from './injuries.js';
import { SeededRandom, add, distance, integer, length, scale, sub, unit } from './math.js';
import { StatusSystem, type StatusEffect, type VitalState } from './statuses.js';
import { TechcopySystem, SKILLS, type SkillExecution } from './skills.js';
import { CareerSession } from './session.js';

export interface MatchParticipant { player: Player; body: Body; status: StatusSystem; stamina: VitalState; teamId: string }
interface Flight { action: 'pass' | 'shot'; sourceId: string; targetId: string; start: Vec3; destination: Vec3; position: Vec3; initialStat: number; distance: number; testedBlockers: string[] }
export interface RuntimeEvent { tick: number; kind: string; actorId: string; data: unknown }
/** Engine-neutral single-player match slice. Teammate movement is a replaceable AI port.
 * Action commands, proximity, water movement, sleep, injuries, chemistry, decay and XP are real.
 * Camera rendering, complete tactical AI and on-screen selection are adapter responsibilities.
 */
export class CareerMatchRuntime {
  static readonly DT = 1 / 60;
  readonly participants = new Map<string, MatchParticipant>();
  readonly events: RuntimeEvent[] = [];
  readonly techcopy = new TechcopySystem();
  private readonly encounters: EncounterMath;
  private readonly gate = new ProximityEncounter();
  private readonly physics = new WaterSpherePhysics();
  private readonly rng: SeededRandom;
  private flight: Flight | null = null;
  private holderId: string;
  private tickIndex = 0;
  private actionSequence = 0;
  private readonly skillCooldownUntil = new Map<string, number>();
  private readonly record: MatchRecord;
  private finished = false;
  private readonly ledger;
  private readonly injurySystem: InjurySystem;
  constructor(private readonly career: CareerSession, fixtureId: string, matchSeed: number, private readonly durationTicks = 60 * 300) {
    integer(durationTicks, 1, 'duration ticks');
    this.ledger = career.ledger(fixtureId);
    const fixture = career.league.fixtures(career.calendar.current().round).find(f => f.id === fixtureId)!;
    this.record = { ...fixture, round: career.calendar.current().round, homeScore: 0, awayScore: 0, goalsByPlayer: {} };
    this.rng = new SeededRandom(matchSeed); this.encounters = new EncounterMath(this.rng);
    // Injury randomness is separate, so optional collision checks never shift shot RNG draws.
    this.injurySystem = new InjurySystem(new SeededRandom((matchSeed ^ 0x13579bdf) >>> 0), career.policies);
    for (const [teamId, z] of [[fixture.homeTeamId, -8], [fixture.awayTeamId, 8]] as const) {
      const roster = career.league.players.filter(p => p.contract?.teamId === teamId && InjurySystem.available(p));
      roster.forEach((player, i) => this.participants.set(player.id, {
        player, teamId, body: { position: { x: (i - 2.5) * 2, y: 0, z }, velocity: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, radius: 0.5 },
        status: new StatusSystem(), stamina: { baseMaxHP: player.baseMaxHP, maxHP: player.baseMaxHP, HP: player.baseMaxHP },
      }));
    }
    if (!this.participants.has(career.user.id)) throw new Error('User medically unavailable');
    this.holderId = career.user.id;
  }
  get tick(): number { return this.tickIndex; }
  get holder(): string { return this.holderId; }
  /** Consume these in a tactical AI adapter; caps prevent a derby from exceeding normal bounds. */
  tactics(teamId: string): { aggression: number; mediaPressure: number; responseSeconds: number } {
    const team = this.career.league.teams.find(t => t.id === teamId);
    if (!team || ![this.record.homeTeamId, this.record.awayTeamId].includes(teamId)) throw new Error('Not a match team');
    const otherId = teamId === this.record.homeTeamId ? this.record.awayTeamId : this.record.homeTeamId;
    const derby = this.career.league.rivalries.derby(team.id, otherId, team.baseAggression);
    return { aggression: derby.aggression, mediaPressure: derby.mediaPressure, responseSeconds: ChemistrySystem.modifiers(team).responseSeconds };
  }
  /** Call only after a match-authoritative special-move hit resolves; UI cannot invent a hit. */
  resolveSkillHit(executorId: string, targetId: string, skillId: string): SkillExecution {
    const source = this.actor(executorId); const target = this.actor(targetId);
    const skill = SKILLS.find(s => s.id === skillId);
    if (this.finished || !skill || !source.player.skills.includes(skillId) || source.player.level < skill.minLevel || source.teamId === target.teamId || !source.status.mobile
      || !InjurySystem.available(source.player) || source.stamina.HP < skill.staminaCost || (this.skillCooldownUntil.get(executorId) ?? 0) > this.tickIndex
      || distance(source.body.position, target.body.position) > 3.5) throw new Error('Special move unavailable');
    source.stamina.HP -= skill.staminaCost;
    this.skillCooldownUntil.set(executorId, this.tickIndex + 60);
    if (skill.effect) target.status.apply(skill.effect);
    const execution: SkillExecution = { id: `${this.record.id}:skill:${this.actionSequence++}`, opponentId: executorId, skillId, openedAtTick: this.tickIndex + 12, closedAtTick: this.tickIndex + 48 };
    this.emit('skill-executed', executorId, execution); return execution;
  }
  private actor(id: string): MatchParticipant {
    const actor = this.participants.get(id); if (!actor) throw new Error('Unknown/absent match actor'); return actor;
  }
  private stats(id: string) { const actor = this.actor(id); return actor.status.effective(InjurySystem.attributes(actor.player)); }
  private emit(kind: string, actorId: string, data: unknown): void {
    if (this.events.length >= 10_000) throw new Error('Match event budget exceeded');
    this.events.push({ tick: this.tickIndex, kind, actorId, data });
  }
  private award(actorId: string, action: Parameters<typeof this.ledger.AwardXP>[1]): void {
    this.ledger.AwardXP(`${this.record.id}:action:${this.actionSequence++}`, action, actorId);
  }
  /** One authoritative fixed step; UI pause/slow-motion must call this fewer times, not change dt. */
  step(input: SwimInput): { encounterEntered: boolean; timeScale: number; complete: boolean } {
    if (this.finished) throw new Error('Match already complete');
    const user = this.actor(this.career.user.id);
    const opponents = [...this.participants.values()].filter(p => p.teamId !== user.teamId).map(p => ({ id: p.player.id, position: p.body.position }));
    const proximity = this.holderId === user.player.id && !this.flight && user.status.mobile && InjurySystem.available(user.player) ? this.gate.update(user.body.position, opponents) : { entered: false, timeScale: 1, defenderIds: [] };
    if (proximity.entered) this.emit('encounter', user.player.id, proximity.defenderIds);
    if (proximity.timeScale === 0) return { encounterEntered: proximity.entered, timeScale: 0, complete: false };
    for (const p of this.participants.values()) p.status.tick(CareerMatchRuntime.DT, p.stamina);
    this.physics.step(user.body, input, CareerMatchRuntime.DT, user.status.mobile && InjurySystem.available(user.player));
    if (user.status.mobile && length(input.thrust) > 0) user.stamina.HP = Math.max(0, user.stamina.HP - CareerMatchRuntime.DT * 0.5);
    if (this.flight) this.advanceBall(CareerMatchRuntime.DT);
    this.tickIndex++;
    const complete = this.tickIndex >= this.durationTicks;
    // Do not finish while a final shot is in flight; bounded flight resolves on subsequent ticks.
    return { encounterEntered: proximity.entered, timeScale: 1, complete: complete && !this.flight };
  }
  breakthrough(): boolean {
    const user = this.actor(this.career.user.id); this.canAct(user.player.id);
    const defenders = [...this.participants.values()].filter(p => p.teamId !== user.teamId && distance(p.body.position, user.body.position) <= 3.5).sort((a, b) => a.player.id.localeCompare(b.player.id));
    const result = this.encounters.breakthrough(this.stats(user.player.id).END, defenders.map(p => ({ id: p.player.id, ATK: this.stats(p.player.id).ATK })));
    if (result.turnoverBy) { this.holderId = result.turnoverBy; this.actor(result.turnoverBy).status.wake('opponent-hit'); }
    this.gate.resolve(); this.emit('breakthrough', user.player.id, result);
    return result.turnoverBy === null;
  }
  private canAct(id: string): void {
    if (this.finished || this.flight || this.holderId !== id || !this.actor(id).status.mobile || !InjurySystem.available(this.actor(id).player) || this.actor(id).stamina.HP <= 0) throw new Error('Action unavailable');
  }
  pass(receiverId: string): void {
    const user = this.actor(this.career.user.id); this.canAct(user.player.id);
    const receiver = this.actor(receiverId);
    if (receiverId === user.player.id || receiver.teamId !== user.teamId) throw new Error('Pass requires a teammate');
    const team = this.career.league.teams.find(t => t.id === user.teamId)!;
    // Chemistry affects accuracy, not the supplied exponential decay calculation.
    if (this.rng.next() > ChemistrySystem.modifiers(team).passAccuracy) {
      const interceptors = [...this.participants.values()].filter(p => p.teamId !== user.teamId && p.status.mobile).sort((a, b) => distance(a.body.position, receiver.body.position) - distance(b.body.position, receiver.body.position) || a.player.id.localeCompare(b.player.id));
      this.holderId = interceptors[0]?.player.id ?? user.player.id;
      this.gate.resolve(); this.emit('missed-pass', user.player.id, { receiverId, turnoverTo: this.holderId }); return;
    }
    this.launch('pass', user, receiver, this.stats(user.player.id).PAS); this.gate.resolve();
  }
  shoot(keeperId: string): void {
    const user = this.actor(this.career.user.id); this.canAct(user.player.id);
    const keeper = this.actor(keeperId);
    if (keeper.teamId === user.teamId || keeper.player.role !== 'keeper') throw new Error('Shot requires opposing keeper');
    this.launch('shot', user, keeper, this.stats(user.player.id).SHT); this.gate.resolve();
  }
  private launch(action: Flight['action'], user: MatchParticipant, target: MatchParticipant, initialStat: number): void {
    this.flight = { action, sourceId: user.player.id, targetId: target.player.id, start: { ...user.body.position }, destination: { ...target.body.position }, position: { ...user.body.position }, initialStat, distance: 0, testedBlockers: [] };
    this.emit('ball-launch', user.player.id, { action, target: target.player.id });
  }
  private advanceBall(dt: number): void {
    const flight = this.flight!;
    const remaining = distance(flight.position, flight.destination);
    const traveled = Math.min(remaining, 20 * dt);
    const previous = flight.position;
    flight.position = add(previous, scale(unit(sub(flight.destination, previous)), traveled));
    flight.distance += traveled;
    const source = this.actor(flight.sourceId);
    // Swept segment proximity prevents fast balls tunneling through blockers.
    const stepVector = sub(flight.position, previous);
    const stepLength2 = stepVector.x ** 2 + stepVector.y ** 2 + stepVector.z ** 2;
    for (const blocker of [...this.participants.values()].sort((a, b) => a.player.id.localeCompare(b.player.id))) {
      if (blocker.teamId === source.teamId || blocker.player.id === flight.targetId || !blocker.status.mobile || flight.testedBlockers.includes(blocker.player.id)) continue;
      const offset = sub(blocker.body.position, previous);
      const fraction = stepLength2 > 0 ? Math.max(0, Math.min(1, (offset.x * stepVector.x + offset.y * stepVector.y + offset.z * stepVector.z) / stepLength2)) : 0;
      const closest = add(previous, scale(stepVector, fraction));
      if (distance(closest, blocker.body.position) <= blocker.body.radius + 0.2) {
        flight.testedBlockers.push(blocker.player.id);
        const contest = this.encounters.contest(flight.initialStat, 0.08, flight.distance - traveled + traveled * fraction, this.stats(blocker.player.id).BLK);
        if (!contest.success) { this.holderId = blocker.player.id; this.flight = null; this.award(blocker.player.id, 'block'); this.emit('interception', blocker.player.id, contest); return; }
      }
    }
    if (traveled < remaining) return;
    const target = this.actor(flight.targetId);
    if (flight.action === 'pass') {
      this.holderId = target.player.id; target.status.wake('pass-received'); this.award(source.player.id, 'pass');
      this.emit('pass-complete', source.player.id, { remainingPAS: EncounterMath.decay(flight.initialStat, 0.08, flight.distance), receiver: target.player.id });
    } else {
      const result = this.encounters.contest(flight.initialStat, 0.08, flight.distance, this.stats(target.player.id).CAT);
      if (result.success) {
        if (source.teamId === this.record.homeTeamId) this.record.homeScore++; else this.record.awayScore++;
        this.record.goalsByPlayer[source.player.id] = (this.record.goalsByPlayer[source.player.id] ?? 0) + 1;
        this.award(source.player.id, 'goal'); this.emit('goal', source.player.id, result);
        this.holderId = source.player.id;
      } else { this.holderId = target.player.id; this.emit('save', target.player.id, result); }
    }
    this.flight = null;
  }
  tackle(opponentId: string, impact: number): boolean {
    const user = this.actor(this.career.user.id); const opponent = this.actor(opponentId);
    if (this.finished || this.flight || this.holderId !== opponentId || opponent.teamId === user.teamId || !user.status.mobile || distance(user.body.position, opponent.body.position) > 3.5) throw new Error('Tackle unavailable');
    const result = this.encounters.breakthrough(this.stats(opponentId).END, [{ id: user.player.id, ATK: this.stats(user.player.id).ATK }]);
    this.injurySystem.collide(user.player, { impact, fatigue: 1 - user.stamina.HP / user.stamina.baseMaxHP, PHY: this.stats(user.player.id).PHY, statusModifier: user.status.injuryModifier }, `${this.record.id}:collision:${this.actionSequence++}`, this.record.id);
    const successful = result.turnoverBy === user.player.id;
    if (successful) { this.holderId = user.player.id; this.award(user.player.id, 'tackle'); }
    opponent.status.wake('opponent-hit'); this.emit('tackle', user.player.id, result); return successful;
  }
  applyStatus(playerId: string, effect: StatusEffect): void { this.actor(playerId).status.apply(effect); }
  /** At full time, settlement goes through the calendar/ledger service, never a UI-provided XP total. */
  finish(): number {
    if (this.finished || this.tickIndex < this.durationTicks || this.flight) throw new Error('Final whistle unavailable');
    const xp = this.career.completeUserMatch(this.record);
    this.finished = true;
    for (const p of this.participants.values()) p.status.endMatch(p.stamina);
    return xp;
  }
}
