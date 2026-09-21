import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchSim, TRICKS } from '../src/game/match.js';
import { TEAMS, TEAM_BY_ID, playerOverall, teamOverall, starters } from '../src/data/teams.js';
import { RULES, DIFFICULTY, ARENA } from '../src/data/constants.js';
import { emptyInput } from '../src/game/entities.js';
import { createCareer, currentOpponent, recordResult, careerTitle } from '../src/game/career.js';
import { RNG } from '../src/core/rng.js';

const DT = 1 / 60;

function runGame(seed, opts = {}) {
  const sim = new MatchSim({ home: TEAMS[opts.home ?? 0], away: TEAMS[opts.away ?? 1], difficulty: opts.difficulty || 'pro', seed, userTeam: opts.userTeam ?? null });
  const events = {};
  sim.events.on('*', (name) => (events[name] = (events[name] || 0) + 1));
  let steps = 0;
  while (sim.state !== 'over' && steps < 60 * 60 * 30) {
    if (opts.onStep) opts.onStep(sim, steps);
    sim.step(DT);
    steps++;
  }
  return { sim, events, steps };
}

test('data integrity: 8 crews, 6-player rosters with one keeper, required fields', () => {
  assert.equal(TEAMS.length, 8);
  const ids = new Set();
  for (const t of TEAMS) {
    assert.ok(t.id && t.city && t.name && t.abbr && t.primary && t.secondary && t.accent && t.motto && t.arena, t.id);
    assert.equal(TEAM_BY_ID[t.id], t);
    assert.equal(t.roster.length, 6);
    assert.equal(t.roster.filter((p) => p.role === 'GK').length, 1);
    for (const p of t.roster) {
      assert.ok(!ids.has(p.id), `duplicate player id ${p.id}`);
      ids.add(p.id);
      assert.ok(p.id && p.name && p.nick && p.archetype && p.signature && p.role, `${t.id} ${p.id}`);
      assert.ok(Number.isInteger(p.number));
      for (const k of ['spd', 'sht', 'hnd', 'pas', 'tkl', 'pow', 'end', 'gb', 'cat', 'blk']) assert.ok(p[k] >= 40 && p[k] <= 99, `${p.id}.${k}`);
      const ovr = playerOverall(p);
      assert.ok(ovr >= 40 && ovr <= 99, `${p.id} ovr ${ovr}`);
    }
    const s = starters(t);
    assert.equal(s.length, 4);
    assert.equal(s[3].role, 'GK');
    const ovr = teamOverall(t);
    assert.ok(ovr >= 50 && ovr <= 99);
  }
  for (const k of ['rookie', 'pro', 'legend']) assert.ok(DIFFICULTY[k] && DIFFICULTY[k].label);
  assert.ok(TRICKS.length >= 4);
});

test('RNG is deterministic', () => {
  const a = new RNG(1234);
  const b = new RNG(1234);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('CPU vs CPU matches finish with a valid winner (multiple seeds/difficulties)', () => {
  const seeds = [1, 2, 3, 7, 42, 99];
  for (const d of ['rookie', 'pro', 'legend']) {
    for (const seed of seeds) {
      const { sim, events } = runGame(seed, { difficulty: d, home: seed % 8, away: (seed + 3) % 8 });
      assert.equal(sim.state, 'over', `seed ${seed} ${d} did not finish`);
      const [h, a] = sim.score;
      const w = sim.winner;
      assert.ok(w === 0 || w === 1);
      assert.notEqual(h, a, 'no draws');
      assert.equal(w, h > a ? 0 : 1);
      assert.ok(h >= 0 && a >= 0);
      assert.ok(events.gameover === 1);
      assert.ok(events.shot > 5, 'shots happened');
      assert.ok(events.halftime === 1 || Math.abs(h - a) >= RULES.mercyLead || sim.overtime || sim.half === 2, 'halftime happened');
      // Either the clock ran out (both halves played) or the mercy rule ended it in the 2nd half.
      assert.ok(sim.half === 2 || sim.overtime, `ended in half ${sim.half}`);
      if (!sim.overtime && Math.abs(h - a) < RULES.mercyLead) assert.ok(sim.clock <= 0.02, 'clock expired at full time');
    }
  }
});

test('matches are deterministic for a given seed', () => {
  const a = runGame(555, { home: 2, away: 5 });
  const b = runGame(555, { home: 2, away: 5 });
  assert.deepEqual(a.sim.score, b.sim.score);
  assert.equal(a.steps, b.steps);
  assert.deepEqual(a.sim.snapshot(), b.sim.snapshot());
});

test('scores land in an arcade-friendly range across many seeds', () => {
  let total = 0;
  let n = 0;
  let maxGoals = 0;
  for (let seed = 100; seed < 112; seed++) {
    const { sim } = runGame(seed, { home: seed % 8, away: (seed * 5 + 1) % 8 });
    total += sim.score[0] + sim.score[1];
    maxGoals = Math.max(maxGoals, sim.score[0], sim.score[1]);
    n++;
  }
  const avg = total / n;
  assert.ok(avg >= 6 && avg <= 30, `avg total goals ${avg}`);
  assert.ok(maxGoals <= 40);
});

test('all Blitzball mechanics fire over a set of matches', () => {
  const agg = {};
  for (let seed = 200; seed < 208; seed++) {
    const { events } = runGame(seed, { home: seed % 8, away: (seed + 1) % 8 });
    for (const k in events) agg[k] = (agg[k] || 0) + events[k];
  }
  for (const k of ['shot', 'score', 'save', 'pass', 'trick', 'tackle', 'bighit', 'washed', 'block', 'breach', 'style', 'gbready', 'gamebreaker', 'gbshot', 'alleyoop', 'volleyshot', 'knockdown', 'heating', 'miss', 'halftime']) {
    assert.ok(agg[k] > 0, `event ${k} never fired`);
  }
});

test('players and ball stay inside the arena; no NaNs', () => {
  const { sim } = runGame(31, {
    home: 3,
    away: 6,
    onStep: (s) => {
      for (const p of s.players) {
        assert.ok(p.pos.isFinite() && Number.isFinite(p.y), 'player finite');
        assert.ok(p.pos.lengthXZ() <= ARENA.fieldRadius + 0.05, `player outside field ${p.pos.lengthXZ()}`);
        if (p.isKeeper) assert.ok(Math.abs(p.pos.x) >= ARENA.keeperMinX - 0.05 && Math.abs(p.pos.x) <= ARENA.keeperMaxX + 0.05, 'keeper in box');
      }
      assert.ok(s.ball.pos.isFinite(), 'ball finite');
      assert.ok(s.ball.pos.lengthXZ() <= ARENA.ballRadius + 0.5, 'ball inside sphere');
      assert.ok(s.ball.pos.y <= ARENA.ceilingY + 0.5 && s.ball.pos.y >= ARENA.floorY - 0.5, 'ball vertical bounds');
    },
  });
  assert.equal(sim.state, 'over');
});

test('gamebreaker goal scores 2 and steals 1; a ready meter survives turnovers', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 5, userTeam: null });
  // fast-forward to live
  while (sim.state !== 'live') sim.step(DT);
  sim.score[1] = 3;
  sim.gb[0] = sim.rules.gamebreakerMeterMax;
  sim.gbReady[0] = true;
  sim.loseStyle(0, 500);
  assert.equal(sim.gb[0], sim.rules.gamebreakerMeterMax, 'ready meter is safe');
  const p = sim.outfield(0)[0];
  sim.giveBall(p);
  p.pos.set(4, 0, 0);
  const ok = sim.tryGamebreaker(p);
  assert.ok(ok);
  assert.equal(sim.state, 'gamebreaker');
  let scored = null;
  sim.events.on('score', (e) => (scored = e));
  let n = 0;
  while (!scored && n++ < 60 * 12) sim.step(DT);
  assert.ok(scored, 'gamebreaker resulted in a goal');
  assert.equal(scored.gb, true);
  assert.equal(scored.points, RULES.gbPoints);
  assert.equal(scored.stolen, RULES.gbSteal);
  assert.deepEqual(sim.score, [2, 2]);
});

test('possession clock turns the ball over when the carrier stalls', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 9, userTeam: 0 });
  while (sim.state !== 'live') sim.step(DT);
  // Make sure the user team has the ball, then feed no input with the clock nearly expired.
  const p = sim.outfield(0)[0];
  sim.giveBall(p);
  sim.setUserInput(emptyInput());
  sim.possessionClock = 0.5;
  let turnover = null;
  sim.events.on('shotclock', (e) => (turnover = e));
  let n = 0;
  while (!turnover && n++ < 60 * 2) sim.step(DT);
  assert.ok(turnover, 'possession clock fired');
  assert.equal(turnover.team, 0);
  assert.equal(sim.state, 'dead');
  assert.equal(sim.pendingPossession, 1);
  // ...and play resumes with the other team.
  while (sim.state !== 'live' && n++ < 60 * 6) sim.step(DT);
  assert.equal(sim.state, 'live');
  assert.equal(sim.possession, 1);
});

test('user-controlled team with random input finishes without errors', () => {
  const sim = new MatchSim({ home: TEAMS[4], away: TEAMS[7], difficulty: 'legend', seed: 77, userTeam: 1 });
  const rng = new RNG(3);
  let steps = 0;
  while (sim.state !== 'over' && steps < 60 * 60 * 30) {
    if (steps % 5 === 0) {
      sim.setUserInput({
        moveX: rng.range(-1, 1),
        moveZ: rng.range(-1, 1),
        turbo: rng.chance(0.4),
        shoot: false,
        shootPressed: rng.chance(0.05),
        shootReleased: rng.chance(0.05),
        pass: rng.chance(0.03),
        trick: rng.chance(0.05),
        hit: rng.chance(0.03),
        breach: rng.chance(0.03),
        switchPlayer: rng.chance(0.01),
        gamebreaker: rng.chance(0.02),
      });
    }
    sim.step(DT);
    steps++;
  }
  assert.equal(sim.state, 'over');
  assert.ok(sim.controlled && sim.controlled.team === 1);
});

test('user one-shot input survives a controlled-player switch (input structs are copied, not aliased)', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 11, userTeam: 0 });
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 600) sim.step(DT);
  // One reusable struct, like the app's input manager hands the sim every frame.
  const inp = emptyInput();
  const clear = (p) => { for (const k in p.cd) p.cd[k] = 0; sim.setState(p, 'idle'); p.stun = 0; p.airborne = false; return p; };

  const a = clear(sim.outfield(0)[0]);
  sim.giveBall(a);
  inp.trick = true;
  sim.setUserInput(inp);
  sim.step(DT);
  assert.equal(a.state, 'trick', 'trick fires for the first controlled carrier');

  // Hand control to a team-mate: the previous carrier becomes an AI swimmer. Its AI tick must
  // not be able to clear the live user input (that used to eat every later one-shot action).
  const b = clear(sim.outfield(0)[1]);
  sim.giveBall(b);
  inp.trick = true;
  sim.setUserInput(inp);
  sim.step(DT);
  assert.equal(b.state, 'trick', 'trick still fires after the controlled player changes');

  const c = clear(sim.outfield(0)[2]);
  sim.giveBall(c);
  inp.trick = false;
  inp.shootPressed = true;
  sim.setUserInput(inp);
  sim.step(DT);
  assert.equal(c.state, 'shoot', 'shoot wind-up still fires after further switches');
});

test('halftime swaps kickoff and the second half plays out', () => {
  const sim = new MatchSim({ home: TEAMS[1], away: TEAMS[2], difficulty: 'rookie', seed: 12, userTeam: null });
  const kickoff = sim.kickoffTeam;
  let secondKick = null;
  sim.events.on('reset', ({ team, reason }) => {
    if (reason === 'halftime') secondKick = team;
  });
  let n = 0;
  while (sim.half === 1 && n++ < 60 * 400) sim.step(DT);
  assert.equal(sim.half, 2);
  assert.equal(secondKick, 1 - kickoff);
});

test('career ladder progresses on wins and tracks rep', () => {
  const c = createCareer(TEAMS[0].id, 'pro');
  assert.equal(c.ladder.length, 7);
  assert.ok(!c.ladder.includes(TEAMS[0].id));
  const first = currentOpponent(c);
  recordResult(c, { won: false, score: [3, 7], style: 900, margin: -4 });
  assert.equal(currentOpponent(c), first, 'loss does not advance');
  assert.equal(c.losses, 1);
  for (let i = 0; i < 7; i++) recordResult(c, { won: true, score: [9, 4], style: 2000, margin: 5 });
  assert.ok(c.complete);
  assert.equal(careerTitle(c), 'BLITZ LEGEND');
  assert.ok(c.rep > 0);
});

test('keeper must release the ball within the hold limit', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 21, userTeam: null });
  while (sim.state !== 'live') sim.step(DT);
  const gk = sim.keeperOf(0);
  sim.giveBall(gk);
  let released = false;
  sim.events.on('pass', ({ from }) => {
    if (from === gk) released = true;
  });
  let n = 0;
  while (!released && n++ < 60 * (RULES.keeperHold + 2)) sim.step(DT);
  assert.ok(released, 'keeper distributed the ball');
});

test('keepers dive vertically inside their box and never leave the pool', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 4242, userTeam: null });
  while (sim.state !== 'live') sim.step(DT);
  const shooter = sim.outfield(0)[0];
  const gk = sim.keeperOf(1);
  // Wound up a shot by hand so the flight is known: hard, high, straight at the ring.
  sim.giveBall(shooter);
  shooter.pos.set(6, 0, 0.4);
  sim.ball.holder = null;
  shooter.hasBall = false;
  sim.ball.pos.set(6, 0.9, 0.4);
  sim.ball.vel.set(20, 3.4, 0);
  sim.ball.flight = { kind: 'shot', shooter, gb: false, volley: false, quality: 1, dist: 5.6, t: 0, checked: new Set(), name: 'TEST' };
  let minY = Infinity;
  let maxY = -Infinity;
  let maxZ = 0;
  for (let i = 0; i < 90 && sim.ball.flight?.kind === 'shot'; i++) {
    sim.step(DT);
    minY = Math.min(minY, gk.y);
    maxY = Math.max(maxY, gk.y);
    maxZ = Math.max(maxZ, Math.abs(gk.pos.z));
    assert.ok(gk.y >= ARENA.keeperMinY - 1e-6 && gk.y <= ARENA.keeperMaxY + 1e-6, `keeper y ${gk.y} in box`);
    assert.ok(Math.abs(gk.pos.x) >= ARENA.keeperMinX - 0.05 && Math.abs(gk.pos.x) <= ARENA.keeperMaxX + 0.05, 'keeper x in box');
    assert.ok(maxZ <= ARENA.keeperMaxZ + 1e-6, `keeper z ${gk.pos.z} in box`);
    assert.ok(gk.pos.isFinite() && Number.isFinite(gk.y), 'keeper finite');
  }
  assert.ok(maxY - minY > 0.05, `keeper dived vertically (range ${(maxY - minY).toFixed(3)})`);
});

test('FLOW lasts its full configured duration and ends exactly once', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 777, userTeam: null });
  let ends = 0;
  sim.events.on('flowend', () => ends++);
  while (sim.state !== 'live') sim.step(DT);
  sim.possession = 0;
  sim.startFlow(0, sim.players[0]);
  let steps = 0;
  while (sim.flow[0] && steps < 60 * (RULES.flowDuration + 2)) {
    sim.step(DT);
    steps++;
  }
  const elapsed = steps * DT;
  assert.ok(Math.abs(elapsed - RULES.flowDuration) < 0.5, `flow lasted ${elapsed.toFixed(2)}s, expected ~${RULES.flowDuration}s`);
  assert.equal(ends, 1, `flowend emitted ${ends} times, expected exactly 1`);
  assert.ok(Math.abs(sim.flowTimer[0]) < 1e-9, `timer rests at zero after expiry (got ${sim.flowTimer[0]})`);
});

test('FLOW freezes the possession clock, which resumes after the zone ends', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 888, userTeam: null });
  while (sim.state !== 'live') sim.step(DT);
  sim.possession = 0;
  sim.startFlow(0, sim.players[0]);
  sim.possessionClock = 1; // would normally tick to zero and force a turnover
  for (let i = 0; i < 120; i++) sim.step(DT);
  assert.ok(sim.possessionClock >= 8 - 1e-6, `clock clamped up under flow (got ${sim.possessionClock.toFixed(2)})`);
  assert.equal(sim.state, 'live', 'no spurious turnover during the freeze');
  sim.flow[0] = false; // zone ends; clock must resume ticking down
  const before = sim.possessionClock;
  for (let i = 0; i < 30; i++) sim.step(DT);
  assert.ok(sim.possessionClock < before, 'clock resumes ticking once flow ends');
});

test('CPU can trigger FLOW on its own (trigger is not user-gated)', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 999, userTeam: null });
  const teams = new Set();
  sim.events.on('flowstart', ({ team }) => teams.add(team));
  let steps = 0;
  while (sim.state !== 'over' && steps < 60 * 60 * 15) {
    sim.step(DT);
    steps++;
  }
  assert.ok(teams.size > 0, 'no FLOW ever started in a full CPU match');
  for (const t of teams) assert.equal(sim.userTeam, null, 'flow fired with no user team');
});

test('steered shots: aim input flips the shot side symmetrically', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 31337, userTeam: 0 });
  while (sim.state !== 'live') sim.step(DT);
  const shooter = sim.controlled || sim.outfield(0)[0];
  sim.giveBall(shooter);
  shooter.pos.set(6, 0, -3); // off-axis so steering has a lateral component
  const rngNext = sim.rng.next;
  sim.rng.next = () => 0.5; // zero out the accuracy jitter for determinism
  sim.userInput.moveX = 0;
  sim.userInput.moveZ = 1;
  sim.fireShot(shooter, 1, { aimDir: sim.aimInputDir() });
  const z = sim.ball.flight.aimZ;
  sim.userInput.moveZ = -1;
  sim.fireShot(shooter, 1, { aimDir: sim.aimInputDir() });
  const z2 = sim.ball.flight.aimZ;
  sim.rng.next = rngNext;
  assert.ok(Number.isFinite(z) && Number.isFinite(z2), 'aimZ recorded on both flights');
  assert.ok(Math.sign(z) !== Math.sign(z2), `opposite inputs flip aim side (${z.toFixed(2)} vs ${z2.toFixed(2)})`);
  assert.ok(Math.abs(z - z2) > 1, 'steering meaningfully moves the target');
});

test('glue dribbling: ball rides at the feet, releases on pass, style on beaten tackler', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 5150, userTeam: null });
  while (sim.state !== 'live') sim.step(DT);
  const carrier = sim.outfield(0)[0];
  sim.giveBall(carrier);
  for (let i = 0; i < 10; i++) sim.step(DT);
  if (sim.ball.holder === carrier) {
    assert.ok(sim.ball.pos.distanceToXZ(carrier.pos) < 1.6, 'ball glued near the carrier');
    const mate = sim.teammatesOf(carrier).find((q) => !q.isKeeper && q.state !== 'fallen');
    if (mate) {
      sim.tryPass(carrier, mate, false);
      assert.ok(sim.ball.flight && sim.ball.flight.target === mate, 'pass releases the glue to the mate');
    }
  } else {
    assert.ok(sim.ball.flight, 'possession moved on through a real flight');
  }
  // Beaten-tackler dribble style.
  sim.giveBall(carrier);
  if (sim.ball.holder === carrier) {
    carrier.dribbleTouch = 1.2;
    const tackler = sim.opponentsOf(carrier).find((q) => !q.isKeeper && q.state !== 'fallen');
    tackler.pos.set(carrier.pos.x + 1, 0, carrier.pos.z);
    tackler.facing = Math.atan2(carrier.pos.x - tackler.pos.x, carrier.pos.z - tackler.pos.z);
    const rngChance = sim.rng.chance;
    sim.rng.chance = () => false; // tackle whiffs deterministically
    const labels = [];
    sim.events.on('style', (e) => labels.push(e.label));
    sim.tryTackle(tackler);
    sim.rng.chance = rngChance;
    assert.ok(labels.includes('DRIBBLE'), 'beaten tackler awards DRIBBLE style');
  }
});

test('call-for-pass routes the carrier pass to the flagged teammate', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 2024, userTeam: 0 });
  while (sim.state !== 'live') sim.step(DT);
  const carrier = sim.outfield(0)[1];
  const caller = sim.outfield(0)[0];
  sim.giveBall(carrier);
  if (sim.ball.holder !== carrier) return; // possession churned; not this seed's day
  caller.input.pass = true; // user, off the ball, calls for the pass
  sim.processInput(caller, DT);
  assert.ok(sim.callPassTimer > 0, 'call registered');
  // The sim flags the nearest non-keeper, non-carrier teammate; the carrier must pass to them.
  const expected = sim.teammatesOf(caller).filter((q) => q !== sim.ball.holder && !q.isKeeper && q.state !== 'fallen').sort((a, b) => a.pos.distanceToXZ(caller.pos) - b.pos.distanceToXZ(caller.pos))[0];
  assert.equal(sim.callPassTarget(carrier), expected, 'flagged teammate is the pass target');
  carrier.input.pass = true;
  sim.processInput(carrier, DT);
  assert.ok(sim.ball.flight && sim.ball.flight.target === expected, 'carrier pass went to the flagged teammate');
});
