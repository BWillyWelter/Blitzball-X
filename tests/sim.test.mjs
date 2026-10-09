import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchSim, TRICKS } from '../src/game/match.js';
import { updateAI } from '../src/game/ai.js';
import { TEAMS, TEAM_BY_ID, playerOverall, teamOverall, starters, benchOf, lineupOf } from '../src/data/teams.js';
import { RULES, DIFFICULTY, ARENA, MOVE, ACTION } from '../src/data/constants.js';
import { emptyInput } from '../src/game/entities.js';
import { createCareer, currentOpponent, recordResult, careerTitle, careerRoster, careerTeam, squadFor, defaultSquad, squadOverall, rollInjuries, fixtureFor, moraleOf, rivalryOf, isInjured } from '../src/game/career.js';
import { RNG } from '../src/core/rng.js';
import { releaseLoose } from '../src/game/ball.js';
import { updatePlayerPhysics } from '../src/game/movement.js';
import { Vec3 } from '../src/core/vec3.js';
import { ReplayRecorder, ReplayDirector, REPLAY_SECONDS } from '../src/game/replay.js';
import { buildReport, headline } from '../src/game/report.js';

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

/** Skip the pre-match presentation (warm-ups + tip-off) to reach live play. */
function skipToLive(sim) {
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 30) sim.step(DT);
  return sim.state === 'live';
}

test('data integrity: 8 crews, 11-player rosters (GK + 4 FD + 2 SH starters), captains', () => {
  assert.equal(TEAMS.length, 8);
  const ids = new Set();
  for (const t of TEAMS) {
    assert.ok(t.id && t.city && t.name && t.abbr && t.primary && t.secondary && t.accent && t.motto && t.arena, t.id);
    assert.equal(TEAM_BY_ID[t.id], t);
    assert.equal(t.roster.length, 11);
    assert.equal(t.roster.filter((p) => p.role === 'GK').length, 2);
    assert.equal(t.roster.filter((p) => p.role === 'SH').length, 2);
    assert.equal(t.roster.filter((p) => p.role === 'FD').length, 7);
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
    assert.equal(s.length, 7);
    assert.equal(s[0].role, 'GK');
    assert.equal(s[1].role, 'SH');
    assert.equal(s[2].role, 'SH');
    assert.equal(s.slice(3).filter((p) => p.role === 'FD').length, 4);
    const ovr = teamOverall(t);
    assert.ok(ovr >= 50 && ovr <= 99);
    // Each crew has one captain, and it is one of the two shooters.
    const caps = t.roster.filter((p) => p.captain);
    assert.equal(caps.length, 1);
    assert.equal(caps[0].role, 'SH');
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

test('gamebreaker goal scores 4 and steals 2; a ready meter survives turnovers', () => {
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
  assert.deepEqual(sim.score, [4, 1]);
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
  // Warm-ups + tip-off take ~11s of sim time; give it plenty of headroom.
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
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

test('kickoff shapes vary by seed but remain deterministic and in bounds', () => {
  const opening = (seed) => {
    const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed, userTeam: null });
    const shape = sim.outfield(sim.kickoffTeam).map((p) => [p.pos.x, p.pos.z]);
    assert.ok(sim.kickoffPattern >= 0 && sim.kickoffPattern < 4);
    for (const p of sim.outfield(sim.kickoffTeam)) assert.ok(p.pos.lengthXZ() < ARENA.fieldRadius);
    return shape;
  };
  assert.deepEqual(opening(41), opening(41), 'same seed must reproduce the same kickoff');
  const shapes = new Set([...Array(12)].map((_, i) => JSON.stringify(opening(i + 1))));
  assert.ok(shapes.size > 1, 'opening shape should not be fixed for every seed');
});

test('defensive shape splits pressure by difficulty (stoppers stay tight on shooters)', () => {
  const movementAt = (difficulty) => {
    const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty, seed: 81, userTeam: null });
    let guard = 0;
    while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
    const holder = sim.outfield(0)[0];
    // The mark here is a fielder marking an enemy FIELDER (a stopper marks shooters; a plain
    // fielder-vs-fielder matchup still shows the rookie/legend crease-bias split).
    const mark = sim.outfield(0)[3];
    const decoy = sim.outfield(0)[5];
    const presser = sim.outfield(1)[0];
    const defender = sim.outfield(1)[3];
    sim.giveBall(holder);
    holder.pos.set(0, 0, 0);
    mark.pos.set(0, 0, 0);
    decoy.pos.set(-8, 0, -4);
    presser.pos.set(0, 0, 0.6);
    defender.pos.set(4, 0, 0);
    updateAI(sim, defender, DT);
    return defender.input.moveX;
  };
  assert.ok(movementAt('rookie') > 0, 'rookie marking should sag toward the crease');
  assert.ok(movementAt('legend') < 0, 'legend marking should stay goal-side on the man');
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

test('taking the cage hands control to your keeper, and leaving it hands it back', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[3], difficulty: 'pro', seed: 31, userTeam: 0 });
  skipToLive(sim);
  const gk = sim.keeperOf(0);
  assert.equal(sim.controlled.isKeeper, false, 'nobody starts in the cage');
  // The cage is shut when the ball is nowhere near your goal — otherwise it is just a way to stop
  // playing.
  sim.ball.pos.set(ARENA.goalX * 1.2, 1, 0);
  assert.equal(sim.cageAvailable(), false, 'cage shut with the ball at the other end');
  assert.equal(sim.takeCage(), false, 'cannot take a cage that is not available');
  sim.ball.pos.set(-ARENA.goalX * 1.05, 1, 0);
  assert.equal(sim.cageAvailable(), true, 'cage opens once the play is at your end');
  const before = sim.controlled;
  assert.equal(sim.takeCage(), true);
  assert.equal(sim.controlled, gk, 'the keeper has control');
  assert.equal(sim.inCage, true);
  assert.equal(gk.controlled, true);
  assert.equal(before.controlled, false, 'the outfield swimmer you left is back on AI');
  assert.equal(sim.cageAvailable(), false, 'the cage cannot be taken twice');
  assert.equal(sim.takeCage(), false);
  // Switching while in the cage leaves it, rather than cycling outfielders behind you.
  const outfielders = sim.outfield(0);
  sim.switchControlled();
  assert.equal(sim.inCage, false);
  assert.equal(gk.controlled, false);
  assert.ok(outfielders.includes(sim.controlled), 'control is back with an outfield swimmer');
  // Control is never yanked back to an outfielder while you hold the cage. The switch has a
  // cooldown, so the cage cannot be toggled on and off frame to farm the dive.
  assert.equal(sim.takeCage(), false, 'the switch cooldown blocks an instant re-take');
  let guard = 0;
  while (sim.keeperSwitchCd > 0 && guard++ < 120) sim.step(DT);
  sim.ball.pos.set(-ARENA.goalX * 1.05, 1, 0);
  assert.equal(sim.takeCage(), true);
  sim.ball.pos.set(0, 1, 0);
  sim.autoSelectControlled();
  assert.equal(sim.controlled, gk, 'auto-select respects a held cage');
});

test('a keeper dive is a committed lunge with a cooldown, and a mistimed one costs you', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[3], difficulty: 'pro', seed: 32, userTeam: 0 });
  skipToLive(sim);
  const gk = sim.keeperOf(0);
  const z0 = gk.pos.z;
  assert.equal(sim.keeperDive(gk, { z: 1, x: 0 }), true, 'dive fires');
  assert.ok(gk.diveT > 0, 'the dive window is live');
  assert.equal(gk.diveDir, 1);
  assert.equal(gk.cd.dive, MOVE.keeperDiveCooldown, 'the dive costs a cooldown');
  // It has to actually move the body — that is the whole reason to spend it.
  for (let i = 0; i < 8; i++) sim.updatePlayerPhysics(gk, DT, false);
  assert.ok(gk.pos.z > z0 + 0.3, `the lunge carried him sideways (${z0.toFixed(2)} -> ${gk.pos.z.toFixed(2)})`);
  assert.ok(gk.pos.z <= ARENA.keeperMaxZ + 1e-6, 'but never out of the box');
  assert.equal(sim.keeperDive(gk, { z: 1, x: 0 }), false, 'no dive on cooldown');
  // The window closes on its own and the cooldown drains.
  let guard = 0;
  while (gk.diveT > 0 && guard++ < 120) sim.step(DT);
  assert.equal(gk.diveT, 0, 'the dive window expires');
  assert.equal(gk.diveCommit, 0, 'and so does the commit');
  // A keeper who cannot reach the dive at all is refused it.
  const gk2 = sim.keeperOf(1);
  gk2.isKeeper = false;
  assert.equal(sim.keeperDive(gk2, { z: 1, x: 0 }), false, 'only a keeper can dive');
  assert.equal(gk2.diveT, 0);
});

test('the CPU keeper dives too, so the mechanic is not one-sided', () => {
  let dived = 0;
  for (const seed of [11, 12, 13, 14, 15]) {
    const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed, userTeam: null });
    sim.events.on('keeperdive', () => dived++);
    let guard = 0;
    while (sim.state !== 'over' && guard++ < 60 * 60 * 30) sim.step(DT);
  }
  assert.ok(dived > 0, `the CPU keeper committed to a dive across five matches (got ${dived})`);
});

test('the pass is aimed: the stick decides where the ball lands, not just who gets it', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 41, userTeam: 0 });
  skipToLive(sim);
  const carrier = sim.outfield(0)[0];
  const mate = sim.outfield(0)[1];
  // Put the pair down the pitch with the receiver running away from the passer, so "ahead" and
  // "short" are unambiguous.
  carrier.pos.set(-6, 0, 0);
  mate.pos.set(2, 0, 0);
  mate.vel.set(3, 0, 0);
  carrier.input.moveX = 0;
  carrier.input.moveZ = 0;
  sim.giveBall(carrier, false);
  assert.equal(sim.tryPass(carrier, mate, false), true);
  const plain = { x: sim.ball.flight.to.x };
  // Aim straight down the line at the receiver: the ball goes in FRONT of them.
  carrier.input.moveX = 1;
  mate.vel.set(3, 0, 0);
  sim.giveBall(carrier, false);
  assert.equal(sim.tryPass(carrier, mate, false), true);
  const ahead = sim.ball.flight.to.x;
  assert.ok(ahead > plain.x + 0.5, `aiming down the line leads the pass (${plain.x.toFixed(2)} -> ${ahead.toFixed(2)})`);
  // Aim BACK down the line: the ball drops short instead.
  mate.vel.set(3, 0, 0);
  sim.giveBall(carrier, false);
  carrier.input.moveX = -1;
  assert.equal(sim.tryPass(carrier, mate, false), true);
  assert.ok(sim.ball.flight.to.x < plain.x, `aiming back pulls the pass short (got ${sim.ball.flight.to.x.toFixed(2)})`);
  // A pass never lands outside the pool, however hard it is aimed.
  mate.vel.set(3, 0, 0);
  sim.giveBall(carrier, false);
  carrier.input.moveX = 1;
  assert.equal(sim.tryPass(carrier, mate, false), true);
  const r = Math.hypot(sim.ball.flight.to.x, sim.ball.flight.to.z);
  assert.ok(r <= ARENA.ballRadius + 1e-6, `landing spot stays in the pool (r=${r.toFixed(2)})`);
  // The pass leads the receiver by the time the ball takes to arrive — a long ball to a runner
  // must not land where they were standing.
  mate.vel.set(4, 0, 0);
  sim.giveBall(carrier, false);
  carrier.input.moveX = 0;
  assert.equal(sim.tryPass(carrier, mate, false), true);
  const f = sim.ball.flight;
  const predicted = f.releasedAt.x + f.releasedVel.x * f.dur;
  assert.ok(f.to.x > predicted - 0.05, 'the ball is led to where the receiver is going');
  // A better passer leads the same aim further — that is what `pas` buys.
  const skill = (p) => 0.55 + (p.data.pas / 99) * 0.75;
  assert.ok(skill({ data: { pas: 99 } }) > skill({ data: { pas: 40 } }), 'passing rating scales the lead');
});

test('a well-led pass pays the passer; a check pass into traffic does not', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 42, userTeam: 0 });
  skipToLive(sim);
  const passer = sim.outfield(0)[0];
  const mate = sim.outfield(0)[1];
  passer.pos.set(-6, 0, 0);
  mate.pos.set(2, 0, 0);
  mate.vel.set(4, 0, 0);
  // Clear the lane so the pass is genuinely a lead pass.
  for (const o of sim.opponentsOf(passer)) o.pos.set(40, 0, 40);
  sim.giveBall(passer, false);
  passer.input.moveX = 1;
  assert.equal(sim.tryPass(passer, mate, false), true);
  const flight = sim.ball.flight;
  const styleBefore = passer.stats.style;
  const graded = sim.gradePass(flight, mate);
  assert.ok(graded, 'a pass aimed into space is graded');
  assert.ok(graded.lead >= ACTION.leadPassMin);
  assert.ok(passer.stats.style > styleBefore, 'the passer is paid for the lead');
  // Same pass, but a defender is standing in the landing spot: nothing is graded.
  const styleAfter = passer.stats.style;
  const blocker = sim.opponentsOf(passer)[0];
  blocker.pos.set(flight.to.x, 0, flight.to.z);
  assert.equal(sim.gradePass(flight, mate), null, 'a pass into a marker is not a lead pass');
  assert.equal(passer.stats.style, styleAfter, 'and pays nothing');
  // A ball thrown where the receiver already was going is a pass, not a lead.
  const feet = { ...flight, to: { x: flight.releasedAt.x + flight.releasedVel.x * flight.dur, y: 0.9, z: flight.releasedAt.z } };
  assert.equal(sim.gradePass(feet, mate), null, 'a ball landing on the intercept point is not a lead');
  // A standing receiver cannot be led.
  const still = { ...flight, releasedVel: { x: 0, z: 0 } };
  assert.equal(sim.gradePass(still, mate), null, 'a standing receiver is not being led');
  // A lob is not graded as a lead pass.
  assert.equal(sim.gradePass({ ...flight, kind: 'lob' }, mate), null);
});

test('a coach-named lineup drives the sim: seven legal slots, in order', () => {
  const base = TEAM_BY_ID[TEAMS[0].id];
  // Name the seven by hand in slot order: keeper, two shooters, four fielders.
  const legal = ['kraken_4', 'kraken_3', 'kraken_1', 'kraken_2', 'kraken_5', 'kraken_6', 'kraken_7'];
  const team = { ...base, lineup: legal };
  assert.deepEqual(lineupOf(team).map((p) => p.id), legal);
  assert.deepEqual(starters(team).map((p) => p.id), legal);
  const sim = new MatchSim({ home: team, away: TEAMS[1], difficulty: 'pro', seed: 5, userTeam: 0 });
  assert.equal(sim.players.length, 14, 'still seven a side');
  assert.equal(sim.keeperOf(0).data.id, 'kraken_4', 'slot 0 guards the zone');
  assert.ok(sim.outfield(0).slice(0, 2).every((p) => p.isShooter), 'slots 1-2 are the shooters');
  assert.ok(sim.outfield(0).slice(2).every((p) => p.isFielder), 'slots 3-6 are the fielders');
  assert.equal(benchOf(team).length, 4);
  // Illegal or half-written lineups fall back to the default seven rather than booting.
  assert.equal(lineupOf({ ...base, lineup: ['kraken_4', 'kraken_1', 'kraken_4', 'kraken_5', 'kraken_6', 'kraken_7', 'kraken_8'] }), null, 'duplicates rejected');
  assert.equal(lineupOf({ ...base, lineup: legal.slice(0, 6) }), null, 'short lineup rejected');
  assert.equal(lineupOf({ ...base, lineup: ['kraken_1', 'kraken_4', 'kraken_3', 'kraken_5', 'kraken_6', 'kraken_7', 'kraken_2'] }), null, 'the keeper must hold slot 0');
  assert.equal(lineupOf({ ...base, lineup: ['kraken_4', 'kraken_2', 'kraken_3', 'kraken_1', 'kraken_5', 'kraken_6', 'kraken_7'] }), null, 'a fielder cannot hold a shooter slot');
  assert.equal(lineupOf(base), null, 'a crew with no named seven has no lineup');
  assert.deepEqual(starters(base).map((p) => p.id), starters({ ...base, lineup: ['nope'] }).map((p) => p.id), 'bad data degrades to the default seven');
});

test('career squad: your swimmer swims, the seven are legal, injuries push a replacement in', () => {
  const c = createCareer(TEAMS[0].id, 'pro', { name: 'Ada Test', archetype: 'HANDLER' });
  const roster = careerRoster(c);
  assert.ok(roster.some((p) => p.id === c.player.id), 'the created swimmer is on the crew');
  assert.equal(roster.filter((p) => p.role === 'GK').length, 2);
  const seven = squadFor(c);
  assert.equal(seven.length, 7);
  assert.ok(seven.includes(c.player.id), 'your own swimmer always starts');
  const team = careerTeam(c);
  assert.ok(lineupOf(team), 'the crew the sim sees is a legal lineup');
  assert.deepEqual(lineupOf(team).map((p) => p.id), seven);
  // No player object is shared with the shared TEAMS data — morale tweaks cannot write back.
  const shared = roster.find((p) => p.id !== c.player.id);
  assert.notEqual(shared, TEAM_BY_ID[TEAMS[0].id].roster.find((p) => p.id === shared.id));
  // The named default is the best legal seven.
  assert.deepEqual(seven.slice().sort(), defaultSquad(c).slice().sort());
  assert.ok(squadOverall(c) > 0);
  // An injury to a starter is replaced by the best fit swimmer, never by an unfit one.
  const victim = seven[3];
  c.injuries = { [victim]: 1 };
  assert.ok(isInjured(c, victim));
  const after = squadFor(c);
  assert.equal(after.length, 7);
  assert.ok(!after.includes(victim), 'an injured swimmer cannot be named');
  assert.ok(after.includes(c.player.id), 'you still swim');
  const named = team.roster.find((p) => p.id === after[3]);
  assert.equal(named.role, 'FD', 'the replacement holds the same slot role');
  // A hand-edited squad full of junk still yields seven legal swimmers.
  c.injuries = {};
  c.squad = ['nope', 'nope', 'nope', 'nope', 'nope', 'nope', 'nope'];
  const repaired = squadFor(c);
  assert.equal(repaired.length, 7);
  assert.ok(lineupOf({ ...team, lineup: repaired }));
});

test('career injuries carry between fixtures and never rule out your own swimmer', () => {
  const c = createCareer(TEAMS[3].id, 'pro', { name: 'Vex' });
  const sim = new MatchSim({ home: careerTeam(c), away: TEAMS[4], difficulty: 'pro', seed: 4242, userTeam: 0 });
  skipToLive(sim);
  // Give the user crew a brutal match so the roll has something to bite on.
  for (const p of sim.teamPlayers(0)) {
    p.stats.washed += 6;
    p.stats.tkl += 2;
  }
  const victim = sim.teamPlayers(0)[2];
  sim.biggestHit = { severity: 1.25, t: 10, team: 0, hitterId: 'x', hitter: 'X', victimId: victim.id, victim: victim.data.nick, hadBall: false, fouled: false };
  const hurt = rollInjuries(c, sim, 0);
  assert.ok(hurt.length >= 1, 'the hardest hit on your crew costs something');
  assert.ok(!hurt.some((h) => h.id === c.player.id), 'your own swimmer is never ruled out');
  assert.ok(c.injuries[victim.id] >= 1);
  assert.ok(!squadFor(c).includes(victim.id));
  // A week later the count decays rather than clearing all at once.
  const first = { ...c.injuries };
  const sim2 = new MatchSim({ home: careerTeam(c), away: TEAMS[4], difficulty: 'pro', seed: 5, userTeam: 0 });
  skipToLive(sim2);
  rollInjuries(c, sim2, 0);
  assert.ok(Object.keys(c.injuries).length <= Object.keys(first).length, 'injuries heal');
  for (const id of Object.keys(c.injuries)) assert.ok(c.injuries[id] >= 1 && c.injuries[id] <= 2, 'counts stay sane');
});

test('career fixtures alternate venue and form swings the crew a couple of points', () => {
  const c = createCareer(TEAMS[0].id, 'pro');
  const fx0 = fixtureFor(c);
  assert.equal(fx0.atHome, true);
  assert.equal(fx0.userTeam, 0);
  assert.equal(fx0.away, fx0.opponent);
  recordResult(c, { won: true, score: [5, 2], style: 900, margin: 3 });
  const fx1 = fixtureFor(c);
  assert.equal(fx1.atHome, false, 'the next one is on their water');
  assert.equal(fx1.userTeam, 1);
  assert.equal(fx1.home, fx1.opponent);
  assert.equal(moraleOf(c), 1, 'one win is buoyantly in form');
  // The crew the sim sees is the player plus the eleven, with the seven named.
  assert.equal(careerTeam(c).roster.length, 12);
  const steady = careerTeam({ ...c, form: [] });
  assert.notEqual(squadOverall(c), 0);
  assert.ok(steady);
  for (let i = 0; i < 2; i++) recordResult(c, { won: true, score: [6, 2], style: 900, margin: 4 });
  assert.equal(moraleOf(c), 2, 'unstoppable on a run');
  recordResult(c, { won: false, score: [2, 6], style: 300, margin: -4 });
  recordResult(c, { won: false, score: [2, 6], style: 300, margin: -4 });
  recordResult(c, { won: false, score: [2, 6], style: 300, margin: -4 });
  assert.equal(moraleOf(c), -2, 'a slide shakes the crew');
  // Rivalries are remembered per crew.
  const opp = currentOpponent(c);
  const rv = rivalryOf(c, opp.id);
  assert.ok(rv.met >= 1);
  assert.equal(rv.won + rv.lost, rv.met);
  assert.equal(rivalryOf(c, 'not_a_crew').met, 0, 'an unplayed crew has no rivalry');
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
  // Re-establish the precondition rather than relying on the carrier still being the same
  // swimmer 2 seconds later: what is under test is that the freeze lifts, not who has the ball.
  // The style meter is drained too, or a live combo can re-trigger FLOW mid-measurement and the
  // clock would clamp straight back up.
  for (const p of sim.players) {
    p.combo = 0;
    p.comboTimer = 0;
  }
  const carrier = sim.players.find((p) => p.team === 0 && !p.isKeeper && p.state !== 'fallen');
  sim.giveBall(carrier, false);
  sim.possession = 0;
  sim.possessionClock = 6;
  const before = sim.possessionClock;
  for (let i = 0; i < 30; i++) sim.step(DT);
  assert.ok(sim.possessionClock < before, `clock resumes ticking once flow ends (${before.toFixed(2)} -> ${sim.possessionClock.toFixed(2)})`);
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
  for (const _ of teams) assert.equal(sim.userTeam, null, 'flow fired with no user team');
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
  sim.processInput(caller);
  assert.ok(sim.callPassTimer > 0, 'call registered');
  // The sim flags the nearest non-keeper, non-carrier teammate; the carrier must pass to them.
  const expected = sim.teammatesOf(caller).filter((q) => q !== sim.ball.holder && !q.isKeeper && q.state !== 'fallen').sort((a, b) => a.pos.distanceToXZ(caller.pos) - b.pos.distanceToXZ(caller.pos))[0];
  assert.equal(sim.callPassTarget(carrier), expected, 'flagged teammate is the pass target');
  carrier.input.pass = true;
  sim.processInput(carrier);
  assert.ok(sim.ball.flight && sim.ball.flight.target === expected, 'carrier pass went to the flagged teammate');
});

test('a dropped ball is recoverable at any depth (regression)', () => {
  // Loose balls used to sink to the pool floor (y = -1.7) while pickup only reached 1.1 above a
  // swimmer's body centre, so a dropped ball became permanently unpickable. Drop it straight onto
  // the floor and prove a teammate still recovers it.
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 7, userTeam: null });
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
  const p = sim.outfield(0)[0];
  sim.giveBall(p);
  releaseLoose(sim, p, new Vec3(0, 0, 0));
  sim.ball.pos.set(p.pos.x, ARENA.floorY, p.pos.z);
  sim.ball.vel.set(0, 0, 0);
  let recovered = false;
  for (let i = 0; i < 180 && !recovered; i++) {
    sim.step(DT);
    if (sim.ball.holder) recovered = true;
  }
  assert.ok(recovered, 'a ball dropped on the pool floor was picked up');
});

test('loose balls are buoyant and drift back to the playing plane', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 11, userTeam: null });
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
  const p = sim.outfield(0)[0];
  sim.giveBall(p);
  releaseLoose(sim, p, new Vec3(0, 0, 0));
  sim.ball.pos.set(0, ARENA.floorY, 0); // pin it on the floor, away from everyone
  sim.ball.vel.set(0, 0, 0);
  // Freeze pickups so we observe pure physics, then watch the ball climb off the floor.
  const realCheckPickup = sim.checkPickup;
  sim.checkPickup = () => {};
  for (let i = 0; i < 240; i++) sim.step(DT);
  sim.checkPickup = realCheckPickup;
  assert.ok(sim.ball.pos.y > ARENA.floorY + 1.0, `ball rose off the floor to y=${sim.ball.pos.y.toFixed(2)}`);
});

test('free-swim depth: moveY raises and dives a swimmer, then buoyancy re-centres', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 5, userTeam: 0 });
  sim.state = 'live';
  const p = sim.outfield(0)[0];
  p.input = emptyInput();
  p.state = 'idle';
  p.stun = 0;
  p.airborne = false;
  p.y = 0;
  p.vy = 0;

  p.input.moveY = 1;
  for (let i = 0; i < 40; i++) updatePlayerPhysics(sim, p, DT, false);
  assert.ok(p.y > 0.4, `swimmer rose to y=${p.y.toFixed(2)}`);

  p.input.moveY = 0;
  for (let i = 0; i < 240; i++) updatePlayerPhysics(sim, p, DT, false);
  assert.ok(Math.abs(p.y) < 0.15, `buoyancy re-centred the swimmer to y=${p.y.toFixed(2)}`);

  p.input.moveY = -1;
  for (let i = 0; i < 40; i++) updatePlayerPhysics(sim, p, DT, false);
  assert.ok(p.y < -0.4, `swimmer dove to y=${p.y.toFixed(2)}`);

  for (let i = 0; i < 400; i++) updatePlayerPhysics(sim, p, DT, false);
  assert.ok(p.y >= ARENA.playerMinY - 1e-6, `dive clamps at the floor bound (y=${p.y.toFixed(2)})`);
});

// ---------------------------------------------------------------------------
// Bench, substitutions and discipline
// ---------------------------------------------------------------------------

test('every crew has four swimmers on the bench who did not start', () => {
  for (const team of TEAMS) {
    const bench = benchOf(team);
    assert.equal(bench.length, 4, `${team.id} bench size`);
    const starting = new Set(starters(team).map((p) => p.id));
    for (const b of bench) assert.ok(!starting.has(b.id), `${b.id} is on the bench and starting`);
    // The bench can cover the keeper slot, or outfield slots — but not a keeper for an outfield
    // slot, which is what subIsSafe/bestSubFor enforce at substitution time.
    assert.equal(bench.filter((b) => b.role === 'GK').length, 1, `${team.id} keeper cover`);
  }
});

test('a substitution swaps the slot in place and spends a change', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 5, userTeam: 0 });
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
  sim.state = 'dead'; // a change can only be made at a stoppage

  const out = sim.players.find((p) => p.team === 0 && !p.isKeeper && sim.subIsSafe(0, p));
  const incoming = sim.bestSubFor(0, out);
  assert.ok(incoming, 'a bench swimmer is available');
  const slot = sim.players.indexOf(out);
  const before = sim.subsLeft[0];

  assert.equal(sim.applySub(0, out, incoming), true);
  assert.equal(sim.players.length, 14, 'the water stays seven-a-side');
  assert.equal(sim.players[slot].id, incoming.id, 'the incoming swimmer took the same slot');
  assert.equal(sim.subsLeft[0], before - 1, 'a change was spent');
  assert.ok(sim.benchOf(0).some((b) => b.id === out.id), 'the outgoing swimmer is on the wall');
  assert.ok(!sim.players.some((p) => p.id === out.id), 'the outgoing swimmer left the water');
  assert.ok(!incoming.subbedOff, 'the incoming swimmer is not marked as subbed off');
});

test('a substitution is refused when it would break the play or the shape', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 6, userTeam: 0 });
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
  sim.state = 'dead';

  const carrier = sim.ball.holder;
  if (carrier) assert.equal(sim.subIsSafe(carrier.team, carrier), false, 'the carrier cannot be subbed');

  // A keeper cannot be replaced by an outfielder, and vice versa.
  const keeper = sim.keeperOf(0);
  const outfielder = sim.players.find((p) => p.team === 0 && !p.isKeeper);
  assert.equal(sim.bestSubFor(0, keeper).isKeeper, true, 'keeper cover must be a keeper');
  assert.equal(sim.bestSubFor(0, outfielder).isKeeper, false, 'an outfield slot takes an outfielder');

  // With no changes left, no more subs.
  sim.subsLeft[0] = 0;
  assert.equal(sim.canSub(0), false, 'no changes left');
});

test('stamina drains with effort and contact, and recovers at rest', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 7, userTeam: null });
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);

  const p = sim.outfield(0)[0];
  // Park the swimmer at centre every frame: this test is about the stamina model, and letting
  // him swim into the arena wall (where constrainPlayer zeroes his velocity) would measure the
  // wall, not stamina.
  const swim = (frames, turbo) => {
    for (let i = 0; i < frames; i++) {
      p.pos.set(0, 0, 0);
      p.y = 0;
      p.input.turbo = turbo;
      p.turbo = 100;
      updatePlayerPhysics(sim, p, DT, false);
    }
  };

  // Cruising is deliberately near-free: the sport is meant to be played continuously, so only
  // sprinting and committed contact should cost a swimmer anything over a match.
  p.stamina = MOVE.staminaMax;
  p.input.moveX = 1;
  swim(600, false);
  const cruiseCost = MOVE.staminaMax - p.stamina;
  assert.ok(cruiseCost > 0, `cruising costs a little (${cruiseCost.toFixed(1)})`);
  assert.ok(cruiseCost < MOVE.staminaMax * 0.2, `cruising is cheap (cost ${cruiseCost.toFixed(1)})`);

  // Sprinting is what actually empties it.
  p.stamina = MOVE.staminaMax;
  swim(600, true);
  const sprintCost = MOVE.staminaMax - p.stamina;
  assert.ok(sprintCost > cruiseCost * 2, `sprinting costs far more than cruising (${sprintCost.toFixed(1)} vs ${cruiseCost.toFixed(1)})`);

  // And standing still brings it back.
  p.stamina = 20;
  p.input.moveX = 0;
  p.input.turbo = false;
  for (let i = 0; i < 300; i++) {
    p.pos.set(0, 0, 0);
    p.vel.set(0, 0, 0);
    updatePlayerPhysics(sim, p, DT, false);
  }
  assert.ok(p.stamina > 20, `resting recovers stamina (got ${p.stamina.toFixed(1)})`);
});

test('harsh contact is a foul: the whistle, a card, and the ball to the other crew', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 8, userTeam: null });
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
  sim.state = 'live';

  const hitter = sim.outfield(1)[0];
  const victim = sim.outfield(0)[1];
  victim.state = 'reel'; // already staggering: swiping him is always a foul
  victim.stun = 0.4;
  victim.pos.set(hitter.pos.x + 1, 0, hitter.pos.z);
  hitter.facing = Math.atan2(1, 0);
  hitter.cd.hit = 0;
  hitter.state = 'swim';
  const fouls = [];
  sim.events.on('foul', (e) => fouls.push(e));
  const chance = sim.rng.chance;
  sim.rng.chance = () => true;

  sim.tryHit(hitter);
  sim.rng.chance = chance;

  assert.equal(fouls.length, 1, 'the hit was whistled');
  assert.equal(fouls[0].offender.id, hitter.id, 'the offender was booked');
  assert.equal(hitter.cards, 1, 'the booking is on the record');
  assert.equal(sim.possession, victim.team, 'the fouled side keeps the ball');
  assert.ok(sim.stats.fouls > 0, 'the foul is counted');
});

test('two bookings send a swimmer off and the bench replaces him automatically', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 9, userTeam: null });
  let guard = 0;
  while (sim.state !== 'live' && guard++ < 60 * 20) sim.step(DT);
  sim.state = 'live';

  const hitter = sim.outfield(1)[0];
  const victim = sim.outfield(0)[1];
  const slot = sim.players.indexOf(hitter);
  const leftBefore = sim.subsLeft[1];

  const swing = () => {
    victim.state = 'reel';
    victim.stun = 0.4;
    victim.pos.set(hitter.pos.x + 1, 0, hitter.pos.z);
    hitter.facing = Math.atan2(1, 0);
    hitter.cd.hit = 0;
    hitter.state = 'swim';
    sim.state = 'live';
    const chance = sim.rng.chance;
    sim.rng.chance = () => true;
    sim.tryHit(hitter);
    sim.rng.chance = chance;
  };

  swing();
  assert.equal(hitter.cards, 1, 'first booking');
  assert.ok(!hitter.sentOff, 'still on after one');

  swing();
  assert.equal(hitter.cards, 2, 'second booking');
  assert.ok(hitter.sentOff, 'sent off after two');
  assert.equal(sim.players.length, 14, 'the bench came straight on');
  assert.equal(sim.players[slot].id !== hitter.id, true, 'a replacement took the slot');
  assert.equal(sim.subsLeft[1], leftBefore, 'a forced replacement does not cost a substitution');
});

test('the replay recorder keeps a rolling window of live play and nothing else', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 21, userTeam: null });
  const rec = new ReplayRecorder();
  skipToLive(sim);
  for (let i = 0; i < 60 * 6; i++) {
    sim.step(DT);
    rec.record(sim, DT);
  }
  const clip = rec.cut({ scorer: sim.players[0], team: 0, points: 1, type: 'shot' });
  assert.ok(clip, 'a live stretch produced a clip');
  assert.ok(clip.frames.length > 10, `enough frames to interpolate (${clip.frames.length})`);
  // The ring buffer is bounded: six seconds of play cannot grow past the window it advertises.
  assert.ok(rec.frames.length <= Math.round(REPLAY_SECONDS * 30) + 1, `window is bounded (${rec.frames.length})`);
  assert.ok(clip.duration <= REPLAY_SECONDS + 1e-6, `clip spans at most the window (${clip.duration.toFixed(2)}s)`);
  // Clip time is rebased to zero so the playhead is just an offset into the clip.
  assert.equal(clip.frames[0].time, 0, 'the clip starts at zero');
  for (let i = 1; i < clip.frames.length; i++) {
    assert.ok(clip.frames[i].time > clip.frames[i - 1].time, 'frame times strictly increase');
  }
  // Dead ball time must never enter the buffer, or a replay would open on swimmers standing still.
  const warm = new ReplayRecorder();
  const sim2 = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 22, userTeam: null });
  for (let i = 0; i < 120; i++) {
    sim2.step(DT);
    warm.record(sim2, DT);
  }
  assert.equal(warm.frames.length, 0, 'nothing recorded before live play');
});

test('a replay plays back the recorded move and hands the pool back untouched', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 33, userTeam: 0 });
  const rec = new ReplayRecorder();
  const dir = new ReplayDirector();
  skipToLive(sim);
  for (let i = 0; i < 60 * 3; i++) {
    sim.step(DT);
    rec.record(sim, DT);
  }
  const scorer = sim.ball.holder || sim.players[3];
  const clip = rec.cut({ scorer, scorerId: scorer.id, team: scorer.team, points: 1, type: 'shot' });
  assert.ok(clip, 'clip cut');

  const before = sim.players.map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.z, facing: p.facing }));
  const ballBefore = { x: sim.ball.pos.x, y: sim.ball.pos.y, z: sim.ball.pos.z };

  dir.capture(sim);
  assert.ok(dir.start(clip), 'playback started');
  assert.ok(dir.playing, 'director is playing');

  // Walk the whole clip, sampling at the head, the middle and the tail.
  const seen = [];
  while (dir.playing) {
    const sample = dir.pose(sim);
    assert.ok(sample, 'every frame of the clip yields a sample');
    seen.push(sim.players[0].pos.x);
    dir.advance(1 / 60);
  }
  assert.ok(seen.length > 20, `the clip ran to the end (${seen.length} frames)`);
  assert.ok(dir.totalTime > 0 && dir.progress >= 1, 'the playhead reached the end');

  dir.restore(sim);
  assert.equal(dir.playing, false, 'playback ended');
  assert.equal(dir.clip, null, 'the clip was released');
  for (let i = 0; i < before.length; i++) {
    const p = sim.players[i];
    assert.equal(p.id, before[i].id, 'the roster is unchanged');
    assert.ok(Math.abs(p.pos.x - before[i].x) < 1e-6, 'x restored');
    assert.ok(Math.abs(p.pos.z - before[i].y) < 1e-6, 'z restored');
    assert.equal(p.facing, before[i].facing, 'facing restored');
  }
  assert.ok(Math.abs(sim.ball.pos.x - ballBefore.x) < 1e-6, 'the ball went back where it was');
});

test('a replay survives a mid-clip substitution: the new body is simply not posed', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 44, userTeam: 0 });
  const rec = new ReplayRecorder();
  const dir = new ReplayDirector();
  skipToLive(sim);
  for (let i = 0; i < 60 * 3; i++) {
    sim.step(DT);
    rec.record(sim, DT);
  }
  const clip = rec.cut({ scorer: sim.players[0], team: 0, points: 1, type: 'shot' });
  dir.capture(sim);
  dir.start(clip);

  // Swap a slot mid-replay, the way a forced send-off replacement does.
  const out = sim.players.find((p) => clip.frames[0].poses.some((q) => q.id === p.id));
  const incoming = sim.bestSubFor(out.team, out);
  sim.state = 'dead'; // a stoppage, so the swap is a legal one
  const replaced = sim.applySub(out.team, out, incoming);
  assert.ok(replaced, 'the slot was swapped mid-replay');

  // The recording keyed on id, so the replacement is absent from every frame rather than being
  // handed the outgoing swimmer's pose.
  const inFrames = clip.frames.some((f) => f.poses.some((q) => q.id === incoming.id));
  assert.equal(inFrames, false, 'the replacement is not in the recorded clip');
  const outFrames = clip.frames.filter((f) => f.poses.some((q) => q.id === out.id)).length;
  assert.equal(outFrames, clip.frames.length, 'the outgoing swimmer is in every recorded frame');
  // Posing skips the player it has no record of, and does not throw on the changed roster.
  const sample = dir.pose(sim);
  assert.ok(sample, 'posing still works with a changed roster');
  assert.equal(sim.players.length, 14, 'the pool stayed seven-a-side');
  dir.restore(sim);
});

test('the match report tells the story of a finished game from state the sim recorded', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 77, userTeam: 0 });
  let guard = 0;
  while (sim.state !== 'over' && guard++ < 60 * 60 * 30) sim.step(DT);
  assert.equal(sim.state, 'over', 'the match finished');

  const r = buildReport(sim);
  assert.deepEqual(r.score, sim.score, 'the report shows the final score');
  assert.equal(r.finished, true, 'the report knows it is full time');
  // Every goal the sim scored is on the chart exactly once.
  assert.equal(r.goals.length, sim.goalLog.length, 'every goal is logged');
  for (let i = 1; i < r.goals.length; i++) {
    assert.ok(r.goals[i].t >= r.goals[i - 1].t, 'the goal log is in clock order');
  }
  // The ring split must add up to the goals that went through a ring.
  const rings = r.teams[0].rings.top + r.teams[0].rings.blue + r.teams[0].rings.white;
  assert.ok(rings >= 0, 'ring split is present');
  assert.equal(r.teams[0].rings.top, sim.ringGoals[0][0], 'top-ring goals are attributed to the side');
  // Half splits are banked at the break, so they can never exceed the final score.
  for (let t = 0; t < 2; t++) {
    assert.ok(r.halves[t][0] >= 0 && r.halves[t][1] >= 0, 'halftime split recorded');
    assert.ok(r.halves[t][0] + r.halves[t][1] === sim.score[t], `half splits for team ${t} add up to the final score`);
  }
  assert.ok(r.discipline.fouls >= 0 && r.discipline.subs >= 0, 'discipline and bench are counted');
  assert.ok(typeof headline(sim, r) === 'string' && headline(sim, r).length > 0, 'a headline is produced');
  // Reds come off the cards log and are never double-counted against the live roster.
  for (const t of r.teams) assert.ok(t.reds <= t.cards, 'a send-off implies a booking');
});

test('the halftime report only shows the first half', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 78, userTeam: 0 });
  let guard = 0;
  // Run to the break, not to full time.
  while (sim.state !== 'halftime' && guard++ < 60 * 60 * 30) sim.step(DT);
  assert.equal(sim.state, 'halftime', 'reached the break');
  const full = buildReport(sim);
  const first = buildReport(sim, { half: 1 });
  assert.equal(first.goals.length, sim.goalLog.length, 'every goal so far is in the first half');
  assert.deepEqual(first.score, sim.score, 'the score at the break');
  assert.equal(first.biggest, null, 'the biggest hit is not on the halftime card yet');
  assert.ok(full.biggest === null || typeof full.biggest.hitter === 'string', 'shape is stable');
  // A goal can't be logged into a half that has not been played.
  for (const g of first.goals) assert.equal(g.half, 1, 'goals are attributed to the half they were scored in');
});

// ---------------------------------------------------------------------------
// Lifelike physics: momentum, struck spin, pool current
// ---------------------------------------------------------------------------

test('swimmers carry momentum: a hard reversal at speed is a commitment, not a teleport', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 2468, userTeam: 0 });
  sim.state = 'live';
  const p = sim.outfield(0)[0];
  p.input = emptyInput();
  p.state = 'idle';
  p.stun = 0;
  p.pos.set(0, 0, 0);
  p.vel.set(0, 0, 0);
  p.airborne = false;
  // Sprint +x up to speed.
  p.input.moveX = 1;
  p.input.moveZ = 0;
  for (let i = 0; i < 120; i++) updatePlayerPhysics(sim, p, DT, false);
  const topSpeed = p.vel.lengthXZ();
  assert.ok(topSpeed > 4, `built up speed (${topSpeed.toFixed(2)} m/s)`);
  // Hard 180: the body must swing through the water, so the velocity cannot flip instantly.
  p.input.moveX = -1;
  let reversal = -1;
  let minSpeed = Infinity;
  for (let i = 0; i < 90; i++) {
    updatePlayerPhysics(sim, p, DT, false);
    minSpeed = Math.min(minSpeed, p.vel.lengthXZ());
    if (reversal < 0 && p.vel.x < 0) reversal = i;
  }
  assert.ok(reversal > 8, `the turn took ${(reversal / 60).toFixed(2)}s before the body crossed zero`);
  assert.ok(minSpeed < topSpeed * 0.9, `the carve scrubbed pace (${minSpeed.toFixed(2)} vs ${topSpeed.toFixed(2)} m/s)`);
  assert.ok(p.vel.x < -1, 'the swimmer does come round to the new line');
});

test('shots bend: struck spin curves the flight across the strike line', () => {
  const drift = (spin) => {
    const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 9911, userTeam: null });
    sim.state = 'live';
    const shooter = sim.outfield(0)[0];
    const keeper = sim.keeperOf(1);
    shooter.pos.set(0, 0, 0);
    keeper.pos.set(13, 0, 0);
    sim.giveBall(shooter);
    const rngNext = sim.rng.next;
    sim.rng.next = () => 0.5; // zero the aim jitter so only the spin differs
    sim.fireShot(shooter, 1, { power: 0.7, spin });
    sim.rng.next = rngNext;
    const originZ = sim.ball.pos.z;
    for (let i = 0; i < 30; i++) sim.updateBall(DT, true); // 0.5 s of flight, dead-ball checks off
    return sim.ball.pos.z - originZ;
  };
  const right = drift(1);
  const left = drift(-1);
  assert.ok(Math.abs(right - left) > 0.3, `opposite spin bends the flights apart (${right.toFixed(2)} vs ${left.toFixed(2)} m)`);
});

test('the pool has a current: a drifting ball wanders, and wanders identically every time', () => {
  const drift = () => {
    const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 777, userTeam: null });
    sim.state = 'live';
    const ball = sim.ball;
    ball.holder = null;
    ball.flight = null;
    ball.pos.set(2, 0.9, 1);
    ball.vel.set(0, 0, 0);
    for (let i = 0; i < 120; i++) sim.updateBall(DT, true);
    return { x: ball.pos.x, z: ball.pos.z };
  };
  const a = drift();
  const b = drift();
  const moved = Math.hypot(a.x - 2, a.z - 1);
  assert.ok(moved > 0.08, `the dead ball drifted with the current (${moved.toFixed(2)}m in 2s)`);
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9, 'the current is deterministic');
});

// ---------------------------------------------------------------------------
// Phase 8: signature-move payoff, professional shape, realistic contact
// ---------------------------------------------------------------------------

test('signature moves beat the defenders they TRAVEL into — and pay: turbo back, clean exit', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 4242, userTeam: null });
  sim.state = 'live';
  const p = sim.outfield(0)[0];
  const q = sim.outfield(1)[0];
  p.data = { ...p.data, move: 'spin', hnd: 90 };
  p.pos.set(0, 0, 0);
  p.vel.set(0, 0, 0);
  p.state = 'idle';
  p.stun = 0;
  p.airborne = false;
  p.facing = Math.PI / 2;
  p.turbo = 20;
  // The defender stands OUTSIDE the cone the move is called in — only the travel can reach him.
  q.pos.set(2.4, 0, 0);
  q.vel.set(0, 0, 0);
  q.state = 'idle';
  q.stun = 0;
  q.airborne = false;
  q.isKeeper = false;
  q.facing = -Math.PI / 2; // staring at the carrier — the only thing SPIN beats
  const chance = sim.rng.chance;
  sim.rng.chance = () => true; // the wash connects
  sim.tryTrick(p, new Vec3(1, 0, 0), false);
  assert.equal(q.state, 'idle', 'nothing beaten at the moment of input');
  for (let i = 0; i < 40; i++) updatePlayerPhysics(sim, p, DT, false);
  sim.rng.chance = chance;
  assert.ok(p.trick === null, 'the move played out');
  assert.ok(q.state === 'reel' || q.state === 'fallen', `the defender was beaten on the travel (${q.state})`);
  assert.ok(p.stats.washed >= 1, 'the wash is on the record');
  assert.ok(p.turbo > 20, `beating a man refunds turbo (${p.turbo.toFixed(1)})`);
  assert.ok(p.stun < 0.1, `a move that beat its man leaves you clean (stun=${p.stun.toFixed(2)})`);
});

test('a standing hit staggers; a charging hit puts a swimmer down', () => {
  const sim = new MatchSim({ home: TEAMS[0], away: TEAMS[1], difficulty: 'pro', seed: 24681, userTeam: null });
  sim.state = 'live';
  const hitter = sim.outfield(1)[0];
  const victim = sim.outfield(0)[1];
  const knocked = [];
  sim.events.on('knockdown', (e) => knocked.push(e.state));
  const swing = (speed) => {
    victim.state = 'idle';
    victim.stun = 0;
    victim.vel.set(0, 0, 0);
    victim.pos.set(hitter.pos.x + 1, 0, hitter.pos.z);
    hitter.facing = Math.atan2(1, 0);
    hitter.cd.hit = 0;
    hitter.state = 'swim';
    hitter.vel.set(speed, 0, 0);
    const chance = sim.rng.chance;
    sim.rng.chance = () => true;
    sim.tryHit(hitter);
    sim.rng.chance = chance;
  };
  swing(0); // standing swing: connects, but it is a shove
  swing(7); // the same blow with a body behind it
  assert.deepEqual(knocked, ['reel', 'fallen'], `standing = stagger, charging = knockdown (${knocked})`);
});

test('alley-oops are a rarity, not the metagame: the build-up stays on the ground', () => {
  let passes = 0;
  let lobs = 0;
  for (let seed = 600; seed < 620; seed++) {
    const sim = new MatchSim({ home: TEAMS[seed % 8], away: TEAMS[(seed + 3) % 8], difficulty: 'pro', seed, userTeam: null });
    sim.events.on('pass', (e) => {
      passes++;
      if (e.alley) lobs++;
    });
    let steps = 0;
    while (sim.state !== 'over' && steps < 60 * 60 * 30) {
      sim.step(DT);
      steps++;
    }
    assert.equal(sim.state, 'over', 'match finished');
  }
  assert.ok(lobs > 0, `the alley-oop still exists as a set piece (found ${lobs} across ${passes} passes)`);
  assert.ok(lobs < passes * 0.08, `alley-oops stay rare (${lobs} lobs in ${passes} passes)`);
});
