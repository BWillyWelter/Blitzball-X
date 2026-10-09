import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchSim } from '../src/game/match.js';
import { TEAMS } from '../src/data/teams.js';
import { ARENA } from '../src/data/constants.js';
import { emptyInput } from '../src/game/entities.js';
import { updatePlayerPhysics, separatePlayers } from '../src/game/movement.js';
import { contactPoint } from '../src/game/ball.js';
import { InputManager } from '../src/ui/input.js';

const dt = 1 / 60;
const match = () => new MatchSim({ home: TEAMS[0], away: TEAMS[1], seed: 2468, userTeam: 0 });

test('touch GK and shooting edges survive render polls until consumed; blur clears every hold', () => {
  const oldWindow = globalThis.window;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [] } });
  const input = new InputManager();
  try {
    input.touch.edges.add('cage');
    input.touch.edges.add('shoot');
    input.touch.shootHeld = true;
    assert.equal(input.poll().cage, true);
    assert.equal(input.poll().shootPressed, true);
    input.flushOneShots();
    assert.equal(input.poll().cage, false);
    input.touch.active = true;
    input.touch.moveX = 0.3;
    input.touch.moveZ = -0.4;
    input.touch.jukeDir = { x: 1, y: 0 };
    input.touch.edges.add('trick');
    const state = input.poll();
    assert.equal(state.trick, true);
    assert.equal(state.moveX, 0.3, 'skill aim never hijacks steering');
    assert.deepEqual(state.jukeDir, { x: 1, y: 0 });
    assert.deepEqual(input.poll().jukeDir, { x: 1, y: 0 }, 'aim survives a frame without a sim step');
    input.flushOneShots();
    assert.equal(input.poll().jukeDir, null);
    input.touch.turbo = true;
    input.touch.moveY = 1;
    input.onBlur();
    assert.deepEqual(input.poll(), emptyInput());
  } finally {
    input.destroy();
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  }
});

test('analog swimming preserves pace and reverses without unwanted lateral drift', () => {
  const sim = match();
  sim.state = 'live';
  const p = sim.outfield(0)[0];
  p.pos.set(0, 0, 0);
  p.input = emptyInput();
  p.input.moveX = 0.35;
  for (let i = 0; i < 40; i++) updatePlayerPhysics(sim, p, dt, false);
  const slow = p.vel.x;
  p.input.moveX = 1;
  for (let i = 0; i < 40; i++) updatePlayerPhysics(sim, p, dt, false);
  assert.ok(p.vel.x > slow * 2.5);
  p.input.moveX = -1;
  updatePlayerPhysics(sim, p, dt, false);
  assert.ok(p.vel.x > 0, 'momentum is not an instant flip');
  for (let i = 0; i < 45; i++) updatePlayerPhysics(sim, p, dt, false);
  assert.ok(p.vel.x < -2);
  assert.equal(p.vel.z, 0, 'reversals do not orbit sideways');
});

test('carried ball uses one socket at all depths and inherits swimmer velocity', () => {
  const sim = match();
  sim.state = 'live';
  const p = sim.outfield(0)[0];
  p.pos.set(2, 0, 3);
  p.facing = Math.PI / 2;
  p.y = -1;
  p.vel.set(3, 0, 1);
  p.vy = 0.5;
  sim.giveBall(p);
  sim.updateBall(dt, false);
  assert.ok(Math.abs(sim.ball.pos.y + 0.1) < 1e-8, 'hand height follows depth');
  assert.ok(sim.ball.pos.x > p.pos.x);
  assert.deepEqual(sim.ball.vel, p.vel.clone().set(3, 0.5, 1));
  assert.equal(p.dribbleTouch, dt, 'carry updates only once per step');
});

test('swept pass interception catches a ball that crosses a defender between endpoints', () => {
  const sim = match();
  const passer = sim.outfield(0)[0];
  const defender = sim.outfield(1)[0];
  defender.pos.set(0, 0, 0);
  defender.state = 'tackle';
  defender.stun = 0;
  sim.players = [passer, defender];
  sim.ballPreviousPosition.set(-2, 0.9, 0);
  sim.ball.pos.set(2, 0.9, 0);
  sim.ball.flight = { kind: 'pass', passer, checked: new Set(), t: 0.3 };
  assert.equal(contactPoint(sim, defender).x, 0);
  sim.rng.chance = () => true;
  sim.checkInterceptions();
  assert.equal(sim.ball.holder, defender);
});

test('pickup ignores stunned players and catches loose balls swept through reach', () => {
  const sim = match();
  const p = sim.outfield(0)[0];
  sim.players = [p];
  p.pos.set(0, 0, 0);
  sim.ballPreviousPosition.set(-2, 0.9, 0);
  sim.ball.pos.set(2, 0.9, 0);
  p.stun = 1;
  sim.checkPickup();
  assert.equal(sim.ball.holder, null);
  p.stun = 0;
  sim.checkPickup();
  assert.equal(sim.ball.holder, p);
});

test('exact player overlaps separate; different swim depths do not collide', () => {
  const sim = match();
  const [a, b] = sim.outfield(0);
  sim.players = [a, b];
  a.pos.set(0, 0, 0);
  b.pos.set(0, 0, 0);
  separatePlayers(sim);
  assert.ok(a.pos.distanceToXZ(b.pos) > 0.7);
  a.pos.set(0, 0, 0);
  b.pos.set(0, 0, 0);
  b.y = 1.2;
  separatePlayers(sim);
  assert.equal(a.pos.distanceToXZ(b.pos), 0);
});

test('ball wall bounds remain enforced during wall cooldown', () => {
  const sim = match();
  sim.ball.pos.set(0, 0.9, ARENA.ballRadius + 2);
  sim.ball.vel.set(0, 0, 10);
  sim.ball.wallCooldown = 0.05;
  sim.bounceBall(sim.ball, null);
  assert.ok(sim.ball.pos.lengthXZ() <= ARENA.ballRadius);
  assert.ok(sim.ball.vel.z < 0);
});

test('manual keeper pre-positions at bounded pace and holds chosen height', () => {
  const sim = match();
  sim.state = 'live';
  sim.ball.pos.copy(sim.ownGoalPos(0));
  assert.equal(sim.takeCage(), true);
  const p = sim.controlled;
  p.pos.z = 0;
  p.y = 0;
  p.input = { ...emptyInput(), moveZ: 0.5, moveY: 1, turbo: true };
  for (let i = 0; i < 30; i++) updatePlayerPhysics(sim, p, dt, false);
  assert.ok(p.pos.z > 0.3 && p.pos.z < 1.2, 'analog shuffle is slower than a dive');
  assert.ok(p.y > 0.8);
  assert.equal(p.turboActive, false, 'burst is not a free extra keeper lunge');
  p.input = emptyInput();
  for (let i = 0; i < 60; i++) updatePlayerPhysics(sim, p, dt, false);
  const setHeight = p.y;
  for (let i = 0; i < 60; i++) updatePlayerPhysics(sim, p, dt, false);
  assert.ok(Math.abs(p.y - setHeight) < 0.01, 'neutral holds the prepared height');
  p.input.moveZ = 1;
  p.input.moveY = -1;
  for (let i = 0; i < 300; i++) updatePlayerPhysics(sim, p, dt, false);
  assert.equal(p.pos.z, ARENA.keeperMaxZ);
  assert.equal(p.y, ARENA.keeperMinY);
  sim.resetPossession(1, 'goal');
  assert.equal(p.diveT, 0);
  assert.equal(p.diveHeight, 0);
});

test('cage keyboard/gamepad/touch share screen-side mapping and latch touch dive aim', () => {
  const oldWindow = globalThis.window;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let pads = [];
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
  const input = new InputManager();
  try {
    input.setKeeperContext(true, 1);
    input.keys.add('KeyD');
    input.keys.add('KeyR');
    assert.equal(input.poll().moveZ, -1);
    assert.equal(input.poll().moveY, 1);
    input.onBlur();
    input.setKeeperContext(true, -1);
    pads = [{ connected: true, axes: [1, 0, 0, -1], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }];
    assert.equal(input.poll().moveZ, 1);
    assert.equal(input.poll().moveY, 1);
    pads = [];
    input.touch.active = true;
    input.touch.camYaw = -Math.PI / 2;
    input.touch.moveX = 1;
    assert.ok(input.poll().moveZ > 0.99, 'touch rotates only once');
    input.touch.keeperAim = { z: -0.8, height: 1 };
    input.touch.edges.add('breach');
    assert.deepEqual(input.poll().keeperAim, { z: -0.8, height: 1 });
    assert.deepEqual(input.poll().keeperAim, { z: -0.8, height: 1 }, 'aim survives zero-step frames');
    input.flushOneShots();
    assert.equal(input.poll().keeperAim, null);
    input.onBlur();
    assert.deepEqual(input.poll(), emptyInput());
  } finally {
    input.destroy();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete globalThis.navigator;
  }
});

test('cage camera faces the attack on both ends and ignores movement/orbit yaw', async () => {
  const THREE = await import('three');
  const { GameCamera } = await import('../src/render/camera.js');
  for (const team of [0, 1]) {
    const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], seed: 11, userTeam: team });
    sim.state = 'live';
    sim.ball.pos.copy(sim.ownGoalPos(team));
    assert.equal(sim.takeCage(), true);
    const p = sim.controlled;
    const cam = new GameCamera(new THREE.PerspectiveCamera(), { reducedMotion: true });
    cam.manual = true;
    cam.orbit(1000, 200);
    p.vel.set(0, 0, 6);
    for (let i = 0; i < 120; i++) cam.update(sim, dt);
    assert.equal(cam.pYaw, Math.atan2(sim.attackDir(team), 0));
    assert.ok((cam.look.x - cam.pos.x) * sim.attackDir(team) > 0);
    assert.ok((p.pos.x - cam.pos.x) * sim.attackDir(team) > 0, 'camera stays behind the keeper');
    assert.ok(cam.pos.length() < ARENA.sphereRadius);
    assert.ok(cam.fov > 69);
    sim.leaveCage();
    cam.update(sim, dt);
    assert.equal(cam.pInit, true, 'shoulder camera re-latches on exit');
  }
});
