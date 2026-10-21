/**
 * MODES + LADDER + TRIALS — the competitive layer's tests.
 *
 * The mode registry is the contract every screen and every rule snapshot reads, so it is tested as
 * data: ids, seats, online flags, and that a mode's rule overrides actually reach the simulation.
 * The gameplay assertions below are the ones a mode is *for* — a "first to N" mode that does not
 * stop at N, or a Top Ring mode where the low rings still score, would be a mode in name only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchSim } from '../src/game/match.js';
import { TEAMS } from '../src/data/teams.js';
import { RULES, ARENA } from '../src/data/constants.js';
import {
  MODES,
  MODE_ORDER,
  MODE_LIST,
  getMode,
  rulesFor,
  seatsFor,
  modeFacts,
  trialThresholds,
  TRIAL_THRESHOLDS,
} from '../src/game/modes.js';
import {
  createRankedProfile,
  applyRankedResult,
  divisionFor,
  nextRungRating,
  expectedScore,
  rollSeason,
  seasonComplete,
  rankedOpponent,
  ratingForTeam,
  profileSummary,
  BASE_RATING,
  MAX_RATING,
  MIN_RATING,
  PROMOTION_POINTS,
  DIVISIONS,
  TIERS,
} from '../src/game/ranked.js';
import { gradeTrials, starText } from '../src/game/trials.js';
import { Seat } from '../src/game/seat.js';

const DT = 1 / 60;
const sim = (opts = {}) => new MatchSim({ home: TEAMS[0], away: TEAMS[3], difficulty: 'pro', seed: 11, ...opts });

/** Run the sim until it reaches live play (warm-up and tip-off are presentations). */
function toLive(s) {
  let guard = 0;
  while (s.state !== 'live' && guard++ < 60 * 30) s.step(DT);
  return s;
}

test('every mode in the order list exists, and the list matches the table', () => {
  assert.deepEqual(new Set(MODE_ORDER), new Set(Object.keys(MODES)));
  assert.deepEqual(MODE_LIST.map((m) => m.id), MODE_ORDER);
  for (const id of MODE_ORDER) {
    const mode = MODES[id];
    assert.equal(mode.id, id, `${id}: id matches its key`);
    assert.ok(mode.label && mode.tagline && mode.blurb, `${id}: has copy for the menu`);
    assert.ok(mode.seats >= 0 && mode.seats <= 2, `${id}: seats are 0, 1 or 2`);
    assert.equal(typeof mode.online, 'boolean', `${id}: online flag`);
    assert.equal(typeof mode.ranked, 'boolean', `${id}: ranked flag`);
    assert.equal(typeof mode.rules, 'object', `${id}: rule overrides`);
  }
});

test('a mode only states the rules it changes; everything else comes from the base set', () => {
  const blitz = rulesFor('blitz', RULES);
  assert.equal(blitz.halfLength, 60);
  assert.equal(blitz.possessionClock, 10);
  assert.equal(blitz.gbPoints, 3);
  // Untouched keys stay at the base value.
  assert.equal(blitz.foulThreshold, RULES.foulThreshold);
  assert.equal(blitz.goalPoints, RULES.goalPoints);
  assert.equal(blitz.goalWindows, RULES.goalWindows);

  const base = rulesFor('quick', RULES);
  assert.deepEqual(base, { ...RULES }, 'quick match is the base rules, unchanged');
});

test('player-supplied custom rules win over the mode, and null/undefined entries are ignored', () => {
  const out = rulesFor('custom', RULES, { halfLength: 90, halves: 1, mercyLead: null, nonsense: undefined });
  assert.equal(out.halfLength, 90);
  assert.equal(out.halves, 1);
  assert.equal(out.mercyLead, RULES.mercyLead, 'a null entry does not erase the base rule');
  assert.equal('nonsense' in out, false, 'undefined entries are skipped');
});

test('seatsFor returns the teams a mode puts under human control', () => {
  assert.deepEqual(seatsFor('quick'), [0]);
  assert.deepEqual(seatsFor('duel'), [0, 1]);
  assert.deepEqual(seatsFor('series'), [0, 1]);
  assert.deepEqual(seatsFor('watch'), []);
  assert.deepEqual(seatsFor('not-a-real-mode'), seatsFor('quick'), 'unknown ids fall back to quick match');
});

test('modeFacts names the rules a mode actually changes', () => {
  assert.ok(modeFacts('blitz').includes('first to 3'));
  assert.ok(modeFacts('blitz').includes('10s shot clock'));
  assert.ok(modeFacts('apex').includes('top ring only'));
  assert.ok(modeFacts('ironlung').includes('no gamebreakers'));
  assert.deepEqual(modeFacts('quick'), []);
});

test('getMode never hands back undefined', () => {
  assert.equal(getMode('quick').id, 'quick');
  assert.equal(getMode('nope').id, 'quick');
  assert.equal(getMode(undefined).id, 'quick');
});

test('"first to N goals" ends the match the moment a crew gets there', () => {
  const s = sim({ rules: rulesFor('blitz', RULES) });
  toLive(s);
  // Score the target number of goals for the home side, straight down the middle of the rules.
  for (let i = 0; i < s.rules.targetGoals; i++) {
    const scorer = s.outfield(0)[0];
    if (s.state !== 'dead' && s.state !== 'live') {
      let guard = 0;
      while (s.state !== 'live' && guard++ < 60 * 10) s.step(DT);
    }
    s.ball.holder = scorer;
    s.scoreGoal(scorer, null, false);
    let guard = 0;
    while (s.state !== 'over' && guard++ < 60 * 8) s.step(DT);
  }
  assert.equal(s.goals[0] >= s.rules.targetGoals, true);
  assert.equal(s.state, 'over', 'the match stopped on the goal target, not the clock');
  assert.equal(s.winner, 0);
  assert.ok(s.clock > 0, 'and it stopped with time still on the clock');
});

test('the clock mode does not stop early: targetGoals 0 plays the halves out', () => {
  const s = sim({ rules: rulesFor('quick', RULES) });
  toLive(s);
  assert.equal(s.rules.targetGoals, 0);
  assert.notEqual(s.state, 'over');
});

test('Top Ring only scores the orange window; a low-ring ball is dead and stays live', () => {
  const s = sim({ rules: rulesFor('apex', RULES) });
  toLive(s);
  const flights = [];
  s.events.on('score', () => flights.push('score'));
  // Aim a ball straight through the white low ring on the home side's goal.
  const goalX = -ARENA.goalX * s.attackDir(0);
  // A ball entering that goal travels toward it: x falls toward the (negative) goal plane.
  const previous = { x: goalX + 0.4, y: ARENA.zone.lowY, z: ARENA.zone.lowSpread };
  const current = { x: goalX - 0.4, y: ARENA.zone.lowY, z: ARENA.zone.lowSpread };
  const hit = s.checkGoalCrossing(previous, current);
  assert.equal(hit, null, 'the low ring is dead in this mode');
  assert.equal(flights.length, 0);
  // The top ring still scores.
  const topPrevious = { x: goalX + 0.4, y: ARENA.zone.topY, z: 0 };
  const topCurrent = { x: goalX - 0.4, y: ARENA.zone.topY, z: 0 };
  assert.equal(s.checkGoalCrossing(topPrevious, topCurrent), 0, 'the top ring still counts');
});

test('a one-period mode ends at the first horn instead of going to a break', () => {
  const s = sim({ rules: rulesFor('proving', RULES) });
  toLive(s);
  assert.equal(s.rules.halves, 1);
  s.clock = 0.02;
  let guard = 0;
  while (s.state !== 'over' && guard++ < 60 * 20) s.step(DT);
  assert.equal(s.state, 'over');
  assert.equal(s.half, 1, 'never reached a second half');
  assert.equal(s.overtime, false, 'a drill does not go to a golden goal');
  assert.equal(s.winner, null, 'level after one period is a draw');
});

test('a seat owns a team, an input struct and the swimmer it pilots', () => {
  const seat = new Seat(1, 1);
  assert.equal(seat.index, 1);
  assert.equal(seat.team, 1);
  assert.equal(seat.active, true);
  assert.equal(seat.inCageNow, false);
  assert.equal(new Seat(0, null).active, false);
});

test('a two-seat match puts both humans in the water on opposite crews', () => {
  const s = sim({ seats: [0, 1] });
  assert.equal(s.seats.length, 2);
  assert.equal(s.seats[0].team, 0);
  assert.equal(s.seats[1].team, 1);
  assert.equal(s.userTeam, 0, 'seat 0 is still the legacy userTeam');
  assert.ok(s.seats[0].controlled, 'seat 0 pilots a swimmer');
  assert.ok(s.seats[1].controlled, 'seat 1 pilots a swimmer');
  assert.equal(s.seats[0].controlled.team, 0);
  assert.equal(s.seats[1].controlled.team, 1);
  assert.notEqual(s.seats[0].controlled, s.seats[1].controlled);
});

test('each seat input only reaches its own swimmer', () => {
  const s = toLive(sim({ seats: [0, 1] }));
  const p1 = s.seats[0].controlled;
  const p2 = s.seats[1].controlled;
  s.seats[0].input.moveX = 1;
  s.seats[1].input.moveX = -1;
  s.step(DT);
  assert.equal(p1.input.moveX, 1);
  assert.equal(p2.input.moveX, -1);
});

test('a spectator match has no seats at all, and still plays itself', () => {
  const s = sim({ seats: [] });
  assert.equal(s.seats.length, 0);
  assert.equal(s.userTeam, null);
  assert.equal(s.controlled, null);
  assert.equal(s.isUser(s.players[0]), false);
  let guard = 0;
  while (s.state !== 'live' && guard++ < 60 * 30) s.step(DT);
  assert.equal(s.state, 'live', 'the AI plays the match with nobody seated');
});

test('the seat input accessors survive a seat being torn down', () => {
  const s = sim({ seats: [0, 1] });
  s.seats[1].team = null;
  assert.equal(s.isSeatTeam(1), false);
  assert.equal(s.seatForTeam(1), null);
  assert.equal(s.seatsForTeam(0).length, 1);
});

// ---------------------------------------------------------------------------
// Ranked ladder
// ---------------------------------------------------------------------------

test('a fresh profile sits at the base rating in the bottom division', () => {
  const p = createRankedProfile();
  assert.equal(p.rating, BASE_RATING);
  assert.equal(divisionFor(p.rating).label, 'BRONZE III');
  assert.equal(p.season, 1);
});

test('divisions climb by rating and never fall outside the table', () => {
  assert.equal(divisionFor(0).label, 'BRONZE III', 'below the floor still reads as the floor');
  assert.equal(divisionFor(5000).label, 'APEX I', 'above the ceiling still reads as the ceiling');
  assert.equal(divisionFor(BASE_RATING).label, 'BRONZE III', 'a new profile starts at the bottom rung');
  let last = -1;
  for (let rating = 700; rating <= 2600; rating += 25) {
    const level = divisionFor(rating).level;
    assert.ok(level >= last, 'the ladder never goes backwards as rating rises');
    last = level;
  }
  assert.equal(DIVISIONS.length * TIERS, 18, 'eighteen rungs from BRONZE III to APEX I');
});

test('nextRungRating always sits above the current rating', () => {
  for (const rating of [700, 950, 1000, 1049, 1100, 1599, 2400]) {
    assert.ok(nextRungRating(rating) > rating, `${rating} has a rung above it`);
  }
});

test('expectedScore is 0.5 between equals and favours the higher rating', () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
  assert.ok(expectedScore(1200, 1000) > 0.5);
  assert.ok(expectedScore(800, 1000) < 0.5);
});

test('a win gains rating, a loss loses it, and a draw splits it', () => {
  const win = applyRankedResult(createRankedProfile(), { won: true, opponentId: 'TST', opponentRating: 1000 });
  assert.ok(win.rating > BASE_RATING);
  assert.equal(win.wins, 1);
  assert.equal(win.streak, 1);

  const loss = applyRankedResult(createRankedProfile(), { won: false, opponentId: 'TST', opponentRating: 1000 });
  assert.ok(loss.rating < BASE_RATING);
  assert.equal(loss.losses, 1);
  assert.equal(loss.streak, -1);

  const draw = applyRankedResult(createRankedProfile(), { draw: true, won: false, opponentId: 'TST', opponentRating: 1000 });
  assert.equal(draw.rating, BASE_RATING, 'an even draw against an even opponent moves nothing');
  assert.equal(draw.draws, 1);
  assert.equal(draw.seasonPoints, 1);
});

test('beating a stronger opponent is worth more than beating a weaker one', () => {
  const strong = applyRankedResult(createRankedProfile(), { won: true, opponentId: 'A', opponentRating: 1300 });
  const weak = applyRankedResult(createRankedProfile(), { won: true, opponentId: 'B', opponentRating: 800 });
  assert.ok(strong.rating > weak.rating);
});

test('rating is clamped to a sane band', () => {
  let p = createRankedProfile({ rating: 705 });
  for (let i = 0; i < 40; i++) applyRankedResult(p, { won: false, opponentId: 'A', opponentRating: 900 });
  assert.equal(p.rating, MIN_RATING, 'cannot sink below the floor');
  p = createRankedProfile({ rating: MAX_RATING - 5 });
  for (let i = 0; i < 40; i++) applyRankedResult(p, { won: true, opponentId: 'A', opponentRating: MAX_RATING - 100 });
  assert.equal(p.rating, MAX_RATING, 'cannot climb past the ceiling');
});

test('history is newest-first and bounded', () => {
  const p = createRankedProfile();
  for (let i = 0; i < 40; i++) applyRankedResult(p, { won: i % 2 === 0, opponentId: `T${i}`, opponentRating: 1000 });
  assert.equal(p.history.length, 30);
  assert.equal(p.history[0].opponentId, 'T39', 'the newest result is first');
});

test('the K-factor is larger while a profile is new', () => {
  const fresh = createRankedProfile();
  const veteran = createRankedProfile({ seasonWins: 40, seasonLosses: 30 });
  const a = applyRankedResult(fresh, { won: true, opponentId: 'A', opponentRating: 1000 }).rating - BASE_RATING;
  const b = applyRankedResult(veteran, { won: true, opponentId: 'A', opponentRating: 1000 }).rating - BASE_RATING;
  assert.ok(a > b, 'placement matches move faster than settled ones');
});

test('a season rolls over once the placement points are banked, keeping half the climb', () => {
  const p = createRankedProfile({ rating: 1400, seasonPoints: PROMOTION_POINTS });
  assert.equal(seasonComplete(p), true);
  rollSeason(p);
  assert.equal(p.season, 2);
  assert.equal(p.seasonPoints, 0);
  assert.equal(p.rating, BASE_RATING + 200, 'half of the 400-point climb is carried');
  assert.equal(seasonComplete(p), false);
});

test('the ladder picks a crew near your rating, and the inverse mapping agrees', () => {
  for (const rating of [900, 1200, 1600, 2200]) {
    const team = rankedOpponent({ rating }, TEAMS, () => 0);
    assert.ok(TEAMS.includes(team));
    assert.ok(ratingForTeam(team) >= 900);
  }
  const strong = rankedOpponent({ rating: 2300 }, TEAMS, () => 0);
  const weak = rankedOpponent({ rating: 900 }, TEAMS, () => 0);
  assert.ok(ratingForTeam(strong) >= ratingForTeam(weak), 'a higher rating faces a stronger crew');
});

test('profileSummary reports where the profile stands', () => {
  const p = applyRankedResult(createRankedProfile(), { won: true, opponentId: 'A', opponentRating: 1000 });
  const sum = profileSummary(p);
  assert.equal(sum.rating, Math.round(p.rating));
  assert.ok(sum.toNext >= 0);
  assert.match(sum.record, /1W 0L/);
  assert.equal(sum.promotionPoints, PROMOTION_POINTS);
});

// ---------------------------------------------------------------------------
// Trials
// ---------------------------------------------------------------------------

test('trial thresholds climb and there is exactly one per star', () => {
  const t = trialThresholds();
  assert.equal(t.length, 5);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], 'thresholds are strictly increasing');
  assert.deepEqual(t, [...TRIAL_THRESHOLDS], 'the exported scale is not mutated by reading it');
});

test('a quiet trial run earns no stars, and a big one sweeps the board', () => {
  const s = sim({ rules: rulesFor('proving', RULES) });
  toLive(s);
  const quiet = gradeTrials(s, 0);
  assert.equal(quiet.stars, 0);
  assert.ok(quiet.nextAt > 0);

  // Fake a monster run: four ring goals, two through the top window, plus style.
  s.ringGoals[0][0] = 2;
  s.ringGoals[0][1] = 2;
  const crew = s.teamPlayers(0);
  crew[0].stats.goals = 2;
  crew[1].stats.goals = 2;
  for (const p of crew) p.stats.style += 60;
  const big = gradeTrials(s, 0);
  assert.equal(big.stars, 5);
  assert.equal(big.nextAt, 0, 'nothing left to climb');
  assert.equal(big.parts.topRings, 2);
  assert.match(big.verdict, /CLEAN SWEEP/);
});

test('starText renders a fixed five-star row', () => {
  assert.equal(starText(0), '☆☆☆☆☆');
  assert.equal(starText(3), '★★★☆☆');
  assert.equal(starText(9), '★★★★★', 'never renders past the maximum');
});
