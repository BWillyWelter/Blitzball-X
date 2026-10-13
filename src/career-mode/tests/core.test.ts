import test from 'node:test';
import assert from 'node:assert/strict';
import type { Body, MatchRecord, Player } from '../models.js';
import { SeededRandom, length } from '../math.js';
import { ExamplePolicies, sigmoid, type CareerPolicies } from '../policies.js';
import { EncounterMath, ProximityEncounter } from '../encounters.js';
import { FirstPersonCamera, WaterSpherePhysics } from '../physics.js';
import { ACTION_XP, MatchXPTracker, Progression } from '../progression.js';
import { StatusSystem } from '../statuses.js';
import { TechcopySystem } from '../skills.js';
import { InjurySystem } from '../injuries.js';
import { CareerSession } from '../session.js';
import { ChemistrySystem } from '../ecosystem.js';
import { createLeagueData, createPlayer, FreeAgencyMarket, LivingLeague, RivalryTracker } from '../league.js';
import { CareerSaveCodec, MemorySavePort, SerializedSaveWriter } from '../persistence.js';
import { CareerMatchRuntime } from '../runtime.js';
const policies = new ExamplePolicies();
const logger = { log(_event: string, _data: unknown): void {} };
const noInjury: CareerPolicies = { version: 'test-no-injury', levelXPFactor: () => 1, marketValue: p => p.baseMarketValue, injuryProbability: () => 0 };
function body(): Body { return { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, radius: 0.5 }; }
const idle = { thrust: { x: 0, y: 0, z: 0 }, pitch: 0, yaw: 0, roll: 0 };
function session(): CareerSession {
  const c = new CareerSession(noInjury, logger, 42);
  while (c.calendar.current().kind !== 'negotiation') c.advanceDay();
  c.signUser('harbor', 6);
  while (c.calendar.current().kind !== 'match') c.advanceDay();
  return c;
}
function result(c: CareerSession): MatchRecord {
  const f = c.league.fixtures(c.calendar.current().round).find(f => f.homeTeamId === 'harbor' || f.awayTeamId === 'harbor')!;
  return { ...f, round: c.calendar.current().round, homeScore: 1, awayScore: 0, goalsByPlayer: {} };
}

test('PRNG reproduces state and resumes the exact stream', () => {
  const a = new SeededRandom(42), b = new SeededRandom(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const restored = new SeededRandom(a.state); assert.equal(restored.next(), a.next());
  assert.throws(() => new SeededRandom(NaN));
});
test('breakthrough uses exact END - ATK*variance; equality is a turnover', () => {
  const expectedRng = new SeededRandom(42); const variance = expectedRng.range(0.5, 1.5);
  const result = new EncounterMath(new SeededRandom(42)).breakthrough(30, [{ id: 'd', ATK: 10 }]);
  assert.equal(result.remainingEND, 30 - 10 * variance); assert.equal(result.turnoverBy, null);
  const tie = new EncounterMath(new SeededRandom(42)).breakthrough(10 * variance, [{ id: 'd', ATK: 10 }]);
  assert.equal(tie.turnoverBy, 'd'); assert.equal(tie.remainingEND, 0);
  assert.throws(() => new EncounterMath(new SeededRandom(42)).breakthrough(1, [{ id: 'd', ATK: -1 }]));
});
test('passing/shooting decay is exponential, supports incremental path distance, ties defended', () => {
  assert.equal(EncounterMath.decay(20, 0.08, 10), 20 * Math.exp(-0.8));
  assert.equal(EncounterMath.decay(20, 0, 100), 20);
  assert.ok(Math.abs(EncounterMath.decay(EncounterMath.decay(20, 0.1, 4), 0.1, 6) - EncounterMath.decay(20, 0.1, 10)) < 1e-12);
  const seed = new SeededRandom(1); const v = seed.range(0.5, 1.5);
  assert.equal(new EncounterMath(new SeededRandom(1)).contest(10 * v, 0, 0, 10).success, false);
  assert.throws(() => EncounterMath.decay(10, -0.1, 1));
});
test('proximity pauses once, resolution resumes; hysteresis prevents encounter thrashing', () => {
  const gate = new ProximityEncounter(); const origin = { x: 0, y: 0, z: 0 };
  const nearby = [{ id: 'd', position: { x: 3, y: 0, z: 0 } }];
  assert.deepEqual(gate.update(origin, nearby), { entered: true, timeScale: 0, defenderIds: ['d'] });
  assert.equal(gate.update(origin, nearby).entered, false);
  gate.resolve(); assert.equal(gate.update(origin, nearby).timeScale, 1);
  assert.equal(gate.update(origin, [{ id: 'd', position: { x: 4, y: 0, z: 0 } }]).entered, false);
  gate.update(origin, []); assert.equal(gate.update(origin, nearby).entered, true);
});
test('water sphere bounds body, speed and quaternion under 3-axis motion', () => {
  const p = new WaterSpherePhysics(); const b = body();
  for (let i = 0; i < 6000; i++) p.step(b, { thrust: { x: 1, y: 1, z: 1 }, pitch: 0.7, yaw: 0.5, roll: 0.2 }, 1 / 60);
  assert.ok(length(b.position) <= 14.5 + 1e-10); assert.ok(length(b.velocity) <= 6 + 1e-10);
  assert.ok(Math.abs(Math.hypot(b.orientation.x, b.orientation.y, b.orientation.z, b.orientation.w) - 1) < 1e-12);
  const position = { ...b.position }; p.step(b, idle, 1 / 60, false); assert.deepEqual(b.position, position); assert.equal(length(b.velocity), 0);
  assert.throws(() => p.step(b, idle, 5));
});
test('first-person FOV excludes behind, side, too far; uses roll and safe depth', () => {
  const camera = new FirstPersonCamera(); const b = body();
  const targets = camera.targets(b, [{ id: 'front', teammate: true, position: { x: 0, y: 0, z: -10 } }, { id: 'behind', teammate: false, position: { x: 0, y: 0, z: 10 } }, { id: 'side', teammate: false, position: { x: 20, y: 0, z: -1 } }, { id: 'far', teammate: false, position: { x: 0, y: 0, z: -50 } }], 16 / 9);
  assert.deepEqual(targets.map(t => t.visible), [true, false, false, false]);
  assert.equal(camera.effects(0, 31).visibility, 0); assert.equal(camera.effects(100, 10).peripheralBlur, 1);
  assert.equal(camera.effects(2, 10).visibility, Math.exp(-0.6));
  assert.throws(() => camera.targets(b, [], 0));
});
test('XP action matrix, per-player attribution, duplicate protection and one settlement', () => {
  assert.deepEqual(ACTION_XP, { pass: 2, tackle: 4, block: 4, goal: 10, techcopy: 15 });
  const p = createPlayer('user', 'Player'); const xp = new MatchXPTracker('m', p.id);
  xp.AwardXP('1', 'pass', p.id); xp.AwardXP('1', 'pass', p.id); xp.AwardXP('2', 'tackle', p.id); xp.AwardXP('3', 'goal', p.id); xp.AwardXP('4', 'techcopy', p.id);
  assert.equal(xp.AwardXP('enemy', 'goal', 'not-user'), 0); assert.equal(xp.ledger.actionXP, 31);
  assert.equal(xp.settle(p, 'win', policies), 46); assert.equal(xp.settle(p, 'win', policies), 0);
  assert.throws(() => xp.AwardXP('late', 'pass', p.id));
});
test('cumulative XP thresholds handle multiple levels and three points each', () => {
  const p = createPlayer('user', 'Player');
  assert.equal(Progression.required(2), 100 * Math.pow(2, 1.5));
  assert.equal(Progression.grant(p, 99), 0); assert.equal(Progression.grant(p, 1), 1); assert.equal(p.attributePoints, 3);
  Progression.grant(p, 900); assert.equal(p.level, 5); assert.equal(p.attributePoints, 12);
  Progression.distribute(p, 'SHT', 3); assert.equal(p.attributePoints, 9); assert.equal(p.attributes.SHT, 19);
  assert.throws(() => Progression.distribute(p, 'SHT', 50));
});
test('outcome and level factors use configured policy, not guessed hidden math', () => {
  for (const [outcome, multiplier] of [['win', 1.5], ['draw', 1], ['loss', 0.7]] as const) {
    const p = createPlayer('user', 'P'); p.level = 10;
    const xp = new MatchXPTracker('m', p.id); xp.AwardXP('g', 'goal', p.id);
    assert.equal(xp.settle(p, outcome, policies), Math.floor(10 * multiplier / 1.45));
  }
});
test('poison reduces max HP periodically with partition-independent ticks and expiry', () => {
  const a = new StatusSystem(), b = new StatusSystem();
  a.apply({ kind: 'poison', remainingSeconds: 5, tickSeconds: 1, accumulator: 0, maxHPFraction: 0.02 });
  b.apply({ kind: 'poison', remainingSeconds: 5, tickSeconds: 1, accumulator: 0, maxHPFraction: 0.02 });
  const va = { baseMaxHP: 100, maxHP: 100, HP: 100 }, vb = { ...va };
  a.tick(10, va); for (let i = 0; i < 100; i++) b.tick(0.1, vb);
  assert.deepEqual(va, vb); assert.equal(va.maxHP, 90); assert.equal(a.has('poison'), false);
  a.endMatch(va); assert.equal(va.maxHP, 100);
});
test('wither halves selected stats once and Sleep wakes only on pass or opposing hit', () => {
  const s = new StatusSystem(); const base = createPlayer('u', 'P').attributes;
  s.apply({ kind: 'wither', remainingSeconds: 10, stats: ['PHY', 'PAS', 'PAS'] });
  s.apply({ kind: 'wither', remainingSeconds: 10, stats: ['PHY', 'PAS'] });
  assert.equal(s.effective(base).PAS, base.PAS / 2); assert.equal(s.effective(base).SHT, base.SHT); assert.equal(s.injuryModifier, 0.5);
  s.apply({ kind: 'sleep', remainingSeconds: 10 }); assert.equal(s.mobile, false);
  s.wake('pass-received'); assert.equal(s.mobile, true);
  s.apply({ kind: 'sleep', remainingSeconds: 10 }); s.wake('opponent-hit'); assert.equal(s.mobile, true);
});
test('Techcopy requires opposing target, FOV, window, level and grants one skill/15 XP', () => {
  const p = createPlayer('user', 'P'); const xp = new MatchXPTracker('m', p.id); const copy = new TechcopySystem();
  const move = { id: 'execution-1', opponentId: 'enemy', skillId: 'spiral-shot', openedAtTick: 100, closedAtTick: 140 };
  assert.equal(copy.observe(move, 'enemy', false, true, p), false);
  assert.equal(copy.observe(move, 'enemy', true, false, p), false);
  assert.equal(copy.observe(move, 'enemy', true, true, p), true);
  assert.equal(copy.attempt(99, 'enemy', true, p, xp), false); assert.equal(copy.attempt(110, 'wrong', true, p, xp), false);
  assert.equal(copy.attempt(120, 'enemy', true, p, xp), true); assert.equal(copy.attempt(120, 'enemy', true, p, xp), false);
  assert.deepEqual(p.skills, ['spiral-shot']); assert.equal(xp.ledger.actionXP, 15);
});
test('injury sigmoid stays finite at extreme inputs; actual probability is injected', () => {
  assert.equal(sigmoid(1000), 1); assert.equal(sigmoid(-1000), 0); assert.equal(sigmoid(0), 0.5);
  const p = createPlayer('u', 'P'); const s = new InjurySystem(new SeededRandom(1), { ...noInjury, injuryProbability: () => 1 });
  const minor = s.collide(p, { impact: 0.2, fatigue: 0, PHY: 15, statusModifier: 0 }, 'hit');
  assert.equal(minor?.severity, 'minor'); assert.ok(minor!.remainingMatches >= 1 && minor!.remainingMatches <= 2);
  assert.throws(() => s.collide(p, { impact: 0.2, fatigue: 0, PHY: 15, statusModifier: 0 }, 'hit'));
  let severeFound = false;
  for (let seed = 0; seed < 100; seed++) {
    const severe = new InjurySystem(new SeededRandom(seed), { ...noInjury, injuryProbability: () => 1 }).collide(createPlayer('x', 'X'), { impact: 1, fatigue: 1, PHY: 1, statusModifier: 0.5 }, 'hit');
    if (severe?.severity === 'severe') { assert.ok(severe.remainingMatches >= 4 && severe.remainingMatches <= 8); severeFound = true; break; }
  }
  assert.equal(severeFound, true);
});
test('recovery uses natural log with clamps, no zero-day charge and fixture decrement', () => {
  const p = createPlayer('u', 'P'); p.injuries = [{ id: 'i', kind: 'fracture', severity: 'severe', remainingMatches: 8, affectedStats: ['PHY'], statMultiplier: 0 }];
  const originalMoney = p.money;
  assert.equal(InjurySystem.therapy(p, 'i', 10, 0), 8); assert.equal(p.money, originalMoney);
  assert.equal(InjurySystem.therapy(p, 'i', 9, 1), 8 - Math.log(10)); assert.equal(p.money, originalMoney - 9);
  assert.equal(InjurySystem.available(p), false);
  InjurySystem.fixtureElapsed(p); assert.equal(p.injuries[0]!.remainingMatches, 7 - Math.log(10));
  InjurySystem.therapy(p, 'i', 100, 2); assert.equal(p.injuries.length, 0); assert.equal(InjurySystem.available(p), true);
  assert.throws(() => InjurySystem.therapy(p, 'none', 1, 1));
});
test('five rival clubs actively bid/sign within budget; forged and duplicate bids rejected', () => {
  const { teams, players } = createLeagueData(); assert.equal(teams.filter(t => t.id !== 'harbor').length, 5);
  const free = createPlayer('free', 'Free'); players.push(free);
  const market = new FreeAgencyMarket(players, teams, new SeededRandom(42), policies);
  const bids = market.quotes(free); assert.equal(bids.length, 6);
  assert.throws(() => market.sign({ ...bids[0]!, salary: 1 }));
  const budget = teams.find(t => t.id === bids[0]!.teamId)!.budget;
  market.sign(bids[0]!); assert.equal(teams.find(t => t.id === bids[0]!.teamId)!.budget, budget - bids[0]!.total);
  assert.throws(() => market.sign(bids[0]!));
  free.contract!.remainingMatches = 1; market.expireFixtureContracts([free.contract!.teamId]);
  assert.equal(free.contract, null); assert.ok(free.marketValue > 0);
  const moves = market.runWindow('user'); assert.ok(moves.some(m => m.playerId === free.id));
});
test('contract duration decrements only for the club fixture, not other league matches', () => {
  const { teams, players } = createLeagueData(); const p = players[0]!; const before = p.contract!.remainingMatches;
  const market = new FreeAgencyMarket(players, teams, new SeededRandom(1), policies);
  market.expireFixtureContracts(['alloy']); assert.equal(p.contract!.remainingMatches, before);
  market.expireFixtureContracts(['harbor']); assert.equal(p.contract!.remainingMatches, before - 1);
});
test('round-robin schedules every unique pairing twice with reversed venues', () => {
  const { teams, players } = createLeagueData(); const league = new LivingLeague(teams, players, new SeededRandom(42), new RivalryTracker());
  const pairs = new Map<string, number>();
  for (let round = 1; round <= 10; round++) {
    const fixtures = league.fixtures(round); assert.equal(new Set(fixtures.flatMap(f => [f.homeTeamId, f.awayTeamId])).size, 6);
    for (const f of fixtures) { const key = [f.homeTeamId, f.awayTeamId].sort().join(':'); pairs.set(key, (pairs.get(key) ?? 0) + 1); }
  }
  assert.equal(pairs.size, 15); assert.deepEqual([...pairs.values()], Array(15).fill(2));
});
test('rivalry accumulates close results, increases derby aggression and media pressure with caps', () => {
  const tracker = new RivalryTracker();
  for (let i = 0; i < 3; i++) tracker.record({ id: `m${i}`, round: i + 1, homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 0, goalsByPlayer: {} });
  const derby = tracker.derby('b', 'a', 0.98); assert.equal(derby.derby, true); assert.equal(derby.aggression, 1); assert.equal(derby.mediaPressure, 24);
  tracker.record({ id: 'm2', round: 3, homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 0, goalsByPlayer: {} });
  assert.equal(tracker.rivalries[0]!.matches, 3);
});
test('agent tiers unlock salary/endorsements; chemistry dialogue is bounded and changes AI response', () => {
  const c = new CareerSession(policies, logger, 42);
  const team = c.league.teams[0]!; c.user.money = 10000; c.user.reputation = 50;
  const basic = c.negotiator.quote(c.user, team, 2, 100); c.negotiator.hire(c.user, 3);
  const elite = c.negotiator.quote(c.user, team, 2, 100);
  assert.ok(elite.salary > basic.salary); assert.ok(elite.endorsement > 0); assert.ok(elite.goalBonus > 0);
  team.chemistry = 99; ChemistrySystem.dialogue(team, 'credit-teammates', 'halftime'); assert.equal(team.chemistry, 100);
  const high = ChemistrySystem.modifiers(team); team.chemistry = 0; const low = ChemistrySystem.modifiers(team);
  assert.ok(high.passAccuracy > low.passAccuracy); assert.ok(high.responseSeconds < low.responseSeconds);
});
test('calendar enforces match settlement, isolated XP, duplicate prevention and background league loop', () => {
  const c = session(); const m = result(c); c.ledger(m.id).AwardXP('goal', 'goal', c.user.id);
  assert.throws(() => c.advanceDay()); const xp = c.completeUserMatch(m); assert.ok(xp >= 7);
  assert.throws(() => c.completeUserMatch(m)); c.advanceDay();
  assert.equal(c.calendar.current().kind, 'recovery');
  const allRound = c.league.matches.filter(m => m.round === 2); assert.equal(allRound.length, 3);
  const table = c.league.standings(); assert.equal(Object.values(table).reduce((n, s) => n + s.played, 0), c.league.matches.length * 2);
});
test('medically absent user fixture is simulated without XP, recovery still progresses', () => {
  const c = session(); c.user.injuries = [{ id: 'inj', kind: 'tear', severity: 'severe', remainingMatches: 6, affectedStats: ['PHY'], statMultiplier: 0 }];
  c.simulateInjuredAbsence(); c.advanceDay(); assert.equal(c.user.totalXP, 0); assert.equal(c.user.injuries[0]!.remainingMatches, 5);
  assert.ok(c.league.matches.every(m => !(c.user.id in m.goalsByPlayer)));
});
test('save codec rejects malformed/duplicate references and resumes deterministic state', async () => {
  const c = session(); const m = result(c); c.ledger(m.id).AwardXP('p', 'pass', c.user.id); c.completeUserMatch(m); c.advanceDay();
  const save = c.snapshot(); const port = new MemorySavePort(); await new SerializedSaveWriter(port).save(save);
  const encoded = (await port.load())!; const restored = new CareerSession(noInjury, logger, 0, CareerSaveCodec.decode(encoded));
  assert.deepEqual(restored.snapshot(), c.snapshot()); assert.equal(restored.rng.next(), c.rng.next());
  const bad = structuredClone(save); bad.players[0]!.attributes.PAS = NaN; assert.throws(() => CareerSaveCodec.decode(JSON.stringify(bad)));
  const dup = structuredClone(save); dup.teams[0]!.playerIds.push(dup.teams[0]!.playerIds[0]!); assert.throws(() => CareerSaveCodec.decode(JSON.stringify(dup)));
  assert.throws(() => CareerSaveCodec.decode('{}'));
  assert.throws(() => new CareerSession(policies, logger, 0, save));
});
test('recovery day budget and dialogue dedupe survive save/reload', () => {
  const c = session(); const m = result(c); c.ledger(m.id); c.dialogue('talk', 'credit-teammates', 'halftime'); c.completeUserMatch(m); c.advanceDay();
  c.user.injuries = [{ id: 'i', kind: 'fracture', severity: 'severe', remainingMatches: 8, affectedStats: ['PHY'], statMultiplier: 0 }];
  c.therapy('i', 1, 1);
  const restored = new CareerSession(noInjury, logger, 0, CareerSaveCodec.decode(CareerSaveCodec.encode(c.snapshot())));
  assert.throws(() => restored.therapy('i', 1, 1)); assert.throws(() => restored.dialogue('talk', 'credit-teammates', 'press'));
});
test('fixed-step runtime integrates status immobilization, shooting, XP and full-time career settlement', () => {
  const c = session(); const m = result(c); c.user.attributes.SHT = 99;
  const runtime = new CareerMatchRuntime(c, m.id, 42, 180);
  const keeper = [...runtime.participants.values()].find(p => p.teamId !== 'harbor' && p.player.role === 'keeper')!;
  keeper.player.attributes.CAT = 1;
  for (const p of runtime.participants.values()) if (p.teamId !== 'harbor') p.body.position.x = 12; // clear swept shot path
  runtime.applyStatus(c.user.id, { kind: 'sleep', remainingSeconds: 2 }); assert.throws(() => runtime.shoot(keeper.player.id));
  const actor = runtime.participants.get(c.user.id)!; const initial = { ...actor.body.position };
  runtime.step({ ...idle, thrust: { x: 1, y: 0, z: 0 } }); assert.deepEqual(actor.body.position, initial);
  actor.status.wake('pass-received'); runtime.shoot(keeper.player.id);
  let done = false; for (let i = 0; i < 240 && !done; i++) done = runtime.step(idle).complete;
  assert.equal(done, true); assert.equal(runtime.events.filter(e => e.kind === 'goal').length, 1);
  assert.equal(runtime.finish(), 15); assert.equal(c.user.totalXP, 15); assert.throws(() => runtime.finish());
  assert.equal(c.league.matches.find(r => r.id === m.id)!.goalsByPlayer[c.user.id], 1);
});
test('large deterministic career input remains bounded and saves reject oversized payloads', () => {
  const p: Player = createPlayer('u', 'P'); p.totalXP = 0;
  Progression.grant(p, 1_000_000); assert.equal(p.level, 100); assert.equal(p.attributePoints, 297);
  assert.throws(() => CareerSaveCodec.decode(' '.repeat(2_000_001)));
});

test('special move validates range/skill/cooldown and integrates stamina, status, and Techcopy event', () => {
  const c = session(); const m = result(c); const runtime = new CareerMatchRuntime(c, m.id, 42);
  const user = runtime.participants.get(c.user.id)!;
  const enemy = [...runtime.participants.values()].find(p => p.teamId !== user.teamId)!;
  enemy.player.skills = ['venom-pass']; enemy.player.level = 3;
  enemy.body.position = { ...user.body.position };
  const before = enemy.stamina.HP;
  const event = runtime.resolveSkillHit(enemy.player.id, user.player.id, 'venom-pass');
  assert.equal(enemy.stamina.HP, before - 8); assert.equal(user.status.has('poison'), true);
  assert.equal(user.status.injuryModifier, 0.5); assert.equal(event.openedAtTick, 12);
  assert.throws(() => runtime.resolveSkillHit(enemy.player.id, user.player.id, 'venom-pass'));
  assert.throws(() => runtime.resolveSkillHit(user.player.id, enemy.player.id, 'not-learned'));
});
test('runtime exposes chemistry latency and derby aggression to the tactical AI port', () => {
  const c = session(); const m = result(c); const runtime = new CareerMatchRuntime(c, m.id, 42);
  const home = c.league.teams.find(t => t.id === m.homeTeamId)!; home.chemistry = 100;
  for (let i = 0; i < 3; i++) c.league.rivalries.record({ ...m, id: `prior-${i}` });
  const hints = runtime.tactics(home.id); assert.ok(Math.abs(hints.responseSeconds - 0.4) < 1e-12);
  assert.ok(hints.aggression > home.baseAggression); assert.equal(hints.mediaPressure, 24);
  assert.throws(() => runtime.tactics('unknown'));
});

test('fresh collision injury does not consume a recovery fixture at its own final whistle', () => {
  const p = createPlayer('u', 'P');
  const injuries = new InjurySystem(new SeededRandom(42), { ...noInjury, injuryProbability: () => 1 });
  const injury = injuries.collide(p, { impact: 0.2, fatigue: 0, PHY: 10, statusModifier: 0 }, 'collision', 'fixture-1')!;
  const duration = injury.remainingMatches;
  InjurySystem.fixtureElapsed(p, 'fixture-1'); assert.equal(injury.remainingMatches, duration);
  InjurySystem.fixtureElapsed(p, 'fixture-2'); assert.equal(injury.remainingMatches, duration - 1);
});
test('runtime passing decays over water distance, wakes Sleep and credits only its passer', () => {
  const c = session(); const m = result(c); const runtime = new CareerMatchRuntime(c, m.id, 42, 300);
  const user = runtime.participants.get(c.user.id)!;
  const receiver = [...runtime.participants.values()].find(p => p.teamId === user.teamId && p.player.id !== user.player.id)!;
  const club = c.league.teams.find(t => t.id === user.teamId)!; club.chemistry = 100;
  user.body.position = { x: 0, y: 0, z: 0 }; receiver.body.position = { x: 0, y: 0, z: -3 };
  for (const p of runtime.participants.values()) if (p.teamId !== user.teamId) p.body.position = { x: 12, y: 0, z: 8 };
  runtime.applyStatus(receiver.player.id, { kind: 'sleep', remainingSeconds: 5 });
  runtime.pass(receiver.player.id);
  for (let i = 0; i < 20; i++) runtime.step(idle);
  assert.equal(runtime.holder, receiver.player.id); assert.equal(receiver.status.mobile, true);
  const event = runtime.events.find(e => e.kind === 'pass-complete')!;
  assert.ok(event); const data = event.data as { remainingPAS: number };
  assert.ok(Math.abs(data.remainingPAS - c.user.attributes.PAS * Math.exp(-0.08 * 3)) < 1e-10);
  assert.equal(c.ledger(m.id).ledger.actionXP, 2);
});
test('runtime swept interception records a block only once and does not award user pass XP', () => {
  const c = session(); const m = result(c); const runtime = new CareerMatchRuntime(c, m.id, 42, 300);
  const user = runtime.participants.get(c.user.id)!;
  const receiver = [...runtime.participants.values()].find(p => p.teamId === user.teamId && p.player.id !== user.player.id)!;
  const enemies = [...runtime.participants.values()].filter(p => p.teamId !== user.teamId);
  for (const enemy of enemies) enemy.body.position = { x: 12, y: 0, z: 8 };
  const blocker = enemies[0]!; blocker.body.position = { x: 0, y: 0, z: -2 }; blocker.player.attributes.BLK = 99;
  user.body.position = { x: 0, y: 0, z: 0 }; receiver.body.position = { x: 0, y: 0, z: -5 }; c.user.attributes.PAS = 1;
  c.league.teams.find(t => t.id === user.teamId)!.chemistry = 100;
  runtime.pass(receiver.player.id);
  for (let i = 0; i < 40; i++) runtime.step(idle);
  assert.equal(runtime.holder, blocker.player.id);
  assert.equal(runtime.events.filter(e => e.kind === 'interception').length, 1);
  assert.equal(c.ledger(m.id).ledger.actionXP, 0);
});
test('settled career commands can resume across a whole round with identical save/RNG outcomes', () => {
  const a = session(); const match = result(a); a.ledger(match.id); a.completeUserMatch(match); a.advanceDay();
  const b = new CareerSession(noInjury, logger, 0, CareerSaveCodec.decode(CareerSaveCodec.encode(a.snapshot())));
  // Both sessions walk through recovery, negotiation and the same next fixture.
  for (const c of [a, b]) {
    while (c.calendar.current().kind !== 'match') c.advanceDay();
    const m = result(c); c.ledger(m.id).AwardXP('next-pass', 'pass', c.user.id); c.completeUserMatch(m); c.advanceDay();
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('save codec validates nested rivalry history, not just the fixture ID', () => {
  const c = session(); const m = result(c); c.ledger(m.id); c.completeUserMatch(m);
  const corrupted = c.snapshot(); corrupted.rivalries.find(r => r.history.some(h => h.id === m.id))!.history.find(h => h.id === m.id)!.homeScore = 99;
  assert.throws(() => CareerSaveCodec.decode(JSON.stringify(corrupted)), /inconsistent/);
});
test('non-finite gate settings and injury inputs fail before consuming RNG', () => {
  assert.throws(() => new ProximityEncounter(1, NaN, 0));
  const rng = new SeededRandom(42); const before = rng.state;
  assert.throws(() => new InjurySystem(rng, policies).collide(createPlayer('u', 'P'), { impact: NaN, fatigue: 0, PHY: 10, statusModifier: 0 }, 'hit'));
  assert.equal(rng.state, before);
});

test('sleeping carrier inside a defensive boundary does not deadlock status expiry behind a paused menu', () => {
  const c = session(); const m = result(c); const runtime = new CareerMatchRuntime(c, m.id, 42, 180);
  const user = runtime.participants.get(c.user.id)!;
  const opponent = [...runtime.participants.values()].find(p => p.teamId !== user.teamId)!;
  opponent.body.position = { ...user.body.position };
  runtime.applyStatus(user.player.id, { kind: 'sleep', remainingSeconds: 0.1 });
  for (let i = 0; i < 8; i++) {
    const step = runtime.step(idle);
    if (user.status.mobile) break;
    assert.equal(step.timeScale, 1);
  }
  assert.equal(user.status.mobile, true);
  assert.equal(runtime.step(idle).encounterEntered, true);
});
