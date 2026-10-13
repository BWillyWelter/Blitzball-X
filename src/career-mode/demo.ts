import { ConsoleCareerLogger, MockFirstPersonRenderer } from './adapters/ports.js';
import { CareerSession } from './session.js';
import { ExamplePolicies } from './policies.js';
import { FirstPersonCamera, WaterSpherePhysics } from './physics.js';
import type { Body } from './models.js';
import { EncounterMath } from './encounters.js';
import { SeededRandom } from './math.js';
import { CareerSaveCodec, MemorySavePort, SerializedSaveWriter } from './persistence.js';
import { Progression } from './progression.js';
import { CareerMatchRuntime } from './runtime.js';

console.log('HEADLESS BLUEPRINT DEMO — EXAMPLE/UNCONFIRMED XP, MARKET AND INJURY POLICIES');
const logger = new ConsoleCareerLogger();
const policies = new ExamplePolicies();
const career = new CareerSession(policies, logger, 42);
while (career.calendar.current().kind !== 'negotiation') career.advanceDay();
career.negotiator.hire(career.user, 1);
career.signUser('harbor', 4);
while (career.calendar.current().kind !== 'match') career.advanceDay();
const fixture = career.league.fixtures(career.calendar.current().round).find(f => f.homeTeamId === 'harbor' || f.awayTeamId === 'harbor')!;
const xp = career.ledger(fixture.id);
xp.AwardXP('pass-1', 'pass', career.user.id);
xp.AwardXP('tackle-1', 'tackle', career.user.id);

career.dialogue('halftime-1', 'credit-teammates', 'halftime');
const body: Body = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, radius: 0.5 };
const physics = new WaterSpherePhysics();
for (let i = 0; i < 60; i++) physics.step(body, { thrust: { x: 0, y: 0, z: -1 }, pitch: 0.1, yaw: 0.2, roll: 0.05 }, 1 / 60);
const camera = new FirstPersonCamera();
const view = new MockFirstPersonRenderer(logger);
view.setPose(body); view.setUnderwaterEffects(camera.effects(Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z), 10), false);
view.drawTargets(camera.targets(body, [{ id: 'opponent', teammate: false, position: { x: 0, y: 0, z: -8 } }], 16 / 9));
logger.log('shot-contest', new EncounterMath(new SeededRandom(42)).contest(30, 0.08, 8, 10));
// A separate short practice fixture uses the real runtime, not UI-supplied score/XP totals.
// This demo fixture has deliberately boosted shooting and a weak opposing keeper.
career.user.attributes.SHT = 99;
const runtime = new CareerMatchRuntime(career, fixture.id, 42, 180);
const keeper = [...runtime.participants.values()].find(p => p.teamId !== 'harbor' && p.player.role === 'keeper')!;
keeper.player.attributes.CAT = 1;
for (const p of runtime.participants.values()) if (p.teamId !== 'harbor') p.body.position.x = 12;
runtime.shoot(keeper.player.id);
let fullTime = false;
for (let step = 0; step < 240 && !fullTime; step++) fullTime = runtime.step({ thrust: { x: 0, y: 0, z: 0 }, pitch: 0, yaw: 0, roll: 0 }).complete;
if (!fullTime) throw new Error('Demo runtime did not finish');
logger.log('runtime-full-time', { XP: runtime.finish(), events: runtime.events });
career.advanceDay(); // background rival matches, compensation, expiry, and recovery calendar day
const storage = new MemorySavePort();
await new SerializedSaveWriter(storage).save(career.snapshot());
const stored = await storage.load();
if (!stored) throw new Error('Demo save missing');
const restored = new CareerSession(policies, logger, 0, CareerSaveCodec.decode(stored));
logger.log('career-summary', { rank: Progression.rank(restored.user), XP: restored.user.totalXP, level: restored.user.level, money: restored.user.money, day: restored.calendar.current(), recordedMatches: restored.league.matches.length });
