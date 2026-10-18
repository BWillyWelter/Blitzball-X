import test from 'node:test';
import assert from 'node:assert/strict';
import { FFXMatch, MATCH_STATES } from '../src/game/ffx-match.js';
import { TEAMS } from '../src/data/ffx-teams.js';

function kickoff(match) {
  for (let i = 0; i < 200 && match.sim.state !== 'live'; i += 1) match.step(0.1);
  assert.equal(match.sim.state, 'live');
}

function forceHomeCarrier(match) {
  const actor = match.sim.players.find((player) => player.team === 0 && !player.isKeeper);
  const opponent = match.sim.players.find((player) => player.team === 1 && !player.isKeeper);
  actor.pos.set(2, 0, 0);
  opponent.pos.set(-4, 0, 5);
  match.sim.ball.holder = actor;
  match.sim.ball.flight = null;
  match.sim.possession = 0;
  actor.hasBall = true;
  match.homeTeam.players.find((player) => player.id === actor.id).position = { x: 2, y: 0, z: 0 };
  match.state = MATCH_STATES.ENCOUNTER_MENU;
  match.syncFromSim();
  match.state = MATCH_STATES.ENCOUNTER_MENU;
  return actor;
}

test('FFX rosters drive the match while preserving presentation fields', () => {
  const match = new FFXMatch(TEAMS.besaid_aurochs, TEAMS.luca_goers, 123);
  assert.equal(match.homeTeam.id, 'besaid_aurochs');
  assert.equal(match.homeTeam.players.length, 6);
  assert.equal(match.homeTeam.players.find((player) => player.id === 'p_tidus').name, 'Tidus');
  assert.equal(match.homeTeam.players.find((player) => player.id === 'p_keepa').pos, 'KP');
  assert.equal(match.sim.players.length, 12);
  assert.deepEqual(match.sim.teamPlayers(0).map((player) => player.id).sort(), TEAMS.besaid_aurochs.players.map((player) => player.id).sort());
  assert.equal(match.sim.userTeam, 0);
  kickoff(match);
  match.step(0.1);
  assert.ok(Number.isFinite(match.ball.position.x));
  assert.equal(typeof match.homeScore, 'number');
  assert.ok(Object.values(MATCH_STATES).includes(match.state));
});

test('SHOOT dispatches a shot and leaves it in flight', () => {
  const match = new FFXMatch(TEAMS.besaid_aurochs, TEAMS.luca_goers, 22);
  kickoff(match);
  const carrier = forceHomeCarrier(match);
  match.nearbyDefenders = [];
  const initialShots = match.sim.stats.shots;
  assert.equal(match.executeEncounterAction('SHOOT').success, true);
  assert.equal(match.sim.stats.shots, initialShots + 1);
  assert.equal(match.sim.ball.flight?.kind, 'shot');
  assert.notEqual(match.sim.ball.holder, carrier);
});

test('BREAKTHROUGH routes through carrier trick input', () => {
  const match = new FFXMatch(TEAMS.besaid_aurochs, TEAMS.luca_goers, 23);
  kickoff(match);
  const carrier = forceHomeCarrier(match);
  match.nearbyDefenders = [];
  const tricks = match.sim.stats.tricks;
  assert.equal(match.executeEncounterAction('BREAKTHROUGH').success, true);
  assert.equal(match.sim.stats.tricks, tricks + 1);
  assert.equal(carrier.state, 'trick');
});

test('PASS releases the carrier ball into a pass flight', () => {
  const match = new FFXMatch(TEAMS.besaid_aurochs, TEAMS.luca_goers, 24);
  kickoff(match);
  forceHomeCarrier(match);
  match.nearbyDefenders = [];
  assert.equal(match.executeEncounterAction('PASS').success, true);
  assert.equal(match.sim.ball.flight?.kind, 'pass');
  assert.equal(match.sim.ball.holder, null);
});

test('player swim position edits are propagated into the match simulation', () => {
  const match = new FFXMatch(TEAMS.besaid_aurochs, TEAMS.luca_goers, 44);
  kickoff(match);
  const player = match.homeTeam.players.find((entry) => entry.id === 'p_tidus');
  match.setPosition(player, { x: 2, y: 0, z: 1 });
  match.step(0.02);
  const simulated = match.sim.players.find((entry) => entry.id === player.id && entry.team === 0);
  assert.ok(Math.abs(simulated.pos.x - 2) < 1);
  assert.ok(Math.abs(simulated.pos.z - 1) < 1);
});
