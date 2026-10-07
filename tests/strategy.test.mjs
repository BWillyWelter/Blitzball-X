import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchSim } from '../src/game/match.js';
import { TEAMS } from '../src/data/teams.js';
import { emptyInput } from '../src/game/entities.js';
import { defensiveAssignments, defenseAI } from '../src/game/ai-defense.js';
import { looseBallAI } from '../src/game/ai-loose.js';
import { offBallOffenseAI } from '../src/game/ai-offense.js';
import { cpuCallPlay } from '../src/game/ai-plays.js';
const make = () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], seed: 81, userTeam: 0 });
  sim.state = 'live';
  for (const p of sim.players) { p.input = emptyInput(); p.stun = 0; p.state = 'idle'; }
  return sim;
};

test('defenders share one assignment map with unique marks and stable pressure', () => {
  const sim = make();
  const holder = sim.outfield(0)[0];
  sim.giveBall(holder);
  const first = defensiveAssignments(sim, 1, holder);
  assert.equal(first.marks.size, 5);
  assert.equal(new Set(first.marks.values()).size, 5);
  assert.equal(first.marks.has(first.presser), false);
  for (const p of sim.outfield(1)) assert.equal(defensiveAssignments(sim, p.team, holder), first);
  sim.time += 0.6;
  const refreshed = defensiveAssignments(sim, 1, holder);
  assert.equal(refreshed.presser, first.presser);
  assert.deepEqual([...refreshed.marks], [...first.marks]);
});

test('nearby opponents do not cause the entire team to chase a loose ball', () => {
  const sim = make();
  sim.ball.pos.set(0, 0.9, 0);
  sim.ball.holder = null;
  sim.ball.flight = null;
  sim.possession = 0;
  sim.outfield(1)[0].pos.set(0, 0, 0);
  const mates = sim.outfield(0);
  for (let i = 0; i < mates.length; i++) mates[i].pos.set(-4 - i, 0, 0);
  for (const p of mates) looseBallAI(sim, p, 1 / 60, false);
  const straightChasers = mates.filter((p) => p.input.moveX > 0.9 && Math.abs(p.input.moveZ) < 0.001);
  assert.equal(straightChasers.length, 1);
});

test('drop zone sends non-pressers to distinct lanes instead of one recovery point', () => {
  const sim = make();
  const holder = sim.outfield(0)[0];
  holder.pos.set(0, 0, 0);
  sim.giveBall(holder);
  sim.callPlay('defense', 1, 1);
  const mates = sim.outfield(1);
  for (const p of mates) p.pos.set(8, 0, 0);
  const { presser } = defensiveAssignments(sim, 1, holder);
  for (const p of mates) defenseAI(sim, p, 1 / 60, false);
  const headings = mates.filter((p) => p !== presser).map((p) => Math.atan2(p.input.moveX, p.input.moveZ).toFixed(3));
  assert.equal(new Set(headings).size, 5);
});

test('isolation clears the central lane and prevents simultaneous random cuts', () => {
  const sim = make();
  const holder = sim.outfield(0)[0];
  holder.pos.set(6, 0, 0);
  sim.giveBall(holder);
  sim.callPlay('offense', 2, 0);
  sim.rng.chance = () => true;
  const mates = sim.outfield(0).filter((p) => p !== holder);
  for (const p of mates) { p.pos.set(6, 0, 0); offBallOffenseAI(sim, p, 1 / 60, true); }
  assert.ok(mates.every((p) => Math.abs(p.input.moveZ) > 0.6));
  assert.ok(mates.every((p) => !p.ai.cutting));
});

test('substitutes inherit their formation slot and remain finite through role positioning', () => {
  const sim = make();
  sim.state = 'dead';
  const out = sim.outfield(0)[0];
  const incoming = sim.bestSubFor(0, out);
  assert.ok(incoming);
  const slot = out.slot;
  sim.applySub(0, out, incoming);
  assert.equal(incoming.slot, slot);
  sim.state = 'live';
  const holder = sim.outfield(0).find((p) => p !== incoming);
  sim.giveBall(holder);
  offBallOffenseAI(sim, incoming, 1 / 60, false);
  assert.ok(Number.isFinite(incoming.input.moveX) && Number.isFinite(incoming.input.moveZ));
});

test('CPU teammates never overwrite the human tactical selection', () => {
  const sim = make();
  sim.callPlay('offense', 2, 0);
  sim.callPlay('defense', 1, 0);
  for (const p of sim.outfield(0)) cpuCallPlay(sim, p, { chance: () => true });
  assert.equal(sim.offPlay[0], 2);
  assert.equal(sim.defPlay[0], 1);
});
