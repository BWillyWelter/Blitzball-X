/**
 * THE LADDER — the competitive rating model behind Ranked Duel.
 *
 * Pure logic, no DOM and no network: the profile is a plain object that serialises into the
 * player's save file, so a ranked run survives a reload and can be replayed by the server.
 *
 * Rating is a plain Elo number around 1000. Divisions are 100 rating points wide and stack
 * three tiers each, so there are eighteen rungs from BRONZE III up to DIAMOND I. Every ranked
 * match is a rated one — including a draw, which counts as half a win.
 */

import { TEAMS, teamOverall } from '../data/teams.js';

/** Starting rating of a brand-new ladder profile — the bottom rung of BRONZE III. */
export const BASE_RATING = 1000;
/** Rating points per ladder rung. */
export const RATING_STEP = 100;
/** Rungs per division (III, II, I). */
export const TIERS = 3;
/** Nobody climbs past the top of APEX I; nobody sinks below the flood plane. */
export const MAX_RATING = BASE_RATING + (6 * TIERS - 1) * RATING_STEP;
export const MIN_RATING = 700;

/** Elo K-factor. Higher while a profile is new so the first few matches move fast. */
export function kFactor(profile) {
  const games = (profile.seasonWins || 0) + (profile.seasonLosses || 0);
  if (games < 8) return 48;
  if (games < 24) return 36;
  return 26;
}

/** Expected score (0..1) for `rating` against `opponentRating`. */
export function expectedScore(rating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/**
 * A fresh ladder profile.
 * @param {Object} [overrides] optional seed values (a server can restore a stored profile)
 */
export function createRankedProfile(overrides = {}) {
  return {
    rating: BASE_RATING,
    peak: BASE_RATING,
    season: 1,
    seasonWins: 0,
    seasonLosses: 0,
    seasonDraws: 0,
    // Placement points: 3 for a win, 1 for a draw. Reaching 12 points promotes a division.
    seasonPoints: 0,
    // How many divisions the profile climbed this season (positive) or fell (negative).
    divisionSwing: 0,
    streak: 0, // + = win streak, - = losing streak
    bestStreak: 0,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    history: [], // most recent first: { won, opponentId, rating, delta, at }
    updatedAt: 0,
    ...overrides,
  };
}

/** Division descriptors, lowest first. */
export const DIVISIONS = [
  { id: 'bronze', label: 'BRONZE', css: '#c9793f' },
  { id: 'silver', label: 'SILVER', css: '#b9c3cc' },
  { id: 'gold', label: 'GOLD', css: '#f2c14e' },
  { id: 'platinum', label: 'PLATINUM', css: '#6fe3c4' },
  { id: 'diamond', label: 'DIAMOND', css: '#8fd0ff' },
  { id: 'apex', label: 'APEX', css: '#ff6fd8' },
];

/**
 * Where a rating sits on the ladder.
 * @returns {{ level:number, division:number, tier:number, label:string, css:string,
 *             name:string, rung:number, rungs:number, progress:number }}
 */
export function divisionFor(rating) {
  const safe = Number.isFinite(rating) ? rating : BASE_RATING;
  const level = Math.max(0, Math.floor((safe - BASE_RATING) / RATING_STEP));
  const maxLevel = DIVISIONS.length * TIERS - 1;
  const clamped = Math.min(maxLevel, level);
  const division = Math.floor(clamped / TIERS);
  const tier = clamped % TIERS; // 0 = III, 1 = II, 2 = I
  const def = DIVISIONS[division];
  const roman = ['III', 'II', 'I'][tier];
  const within = safe - (BASE_RATING + clamped * RATING_STEP);
  return {
    level: clamped,
    division,
    tier,
    label: `${def.label} ${roman}`,
    name: def.label,
    css: def.css,
    rung: clamped + 1,
    rungs: maxLevel + 1,
    progress: Math.max(0, Math.min(1, within / RATING_STEP)),
  };
}

/** Rating at which the next rung begins. */
export function nextRungRating(rating) {
  const maxLevel = DIVISIONS.length * TIERS - 1;
  const level = Math.max(0, Math.min(maxLevel, Math.floor((rating - BASE_RATING) / RATING_STEP)));
  return BASE_RATING + (level + 1) * RATING_STEP;
}

/**
 * Apply a ranked result to a profile. Mutates and returns the profile.
 * @param {Object} profile
 * @param {{ won:boolean, draw?:boolean, opponentId:string, opponentRating:number,
 *           score?:number[], margin?:number }} result
 */
export function applyRankedResult(profile, result) {
  const before = profile.rating;
  const beforeLevel = divisionFor(before).level;
  const draw = !!result.draw || (result.won === undefined && result.score && result.score[0] === result.score[1]);
  const won = draw ? false : !!result.won;
  const opponentRating = Number.isFinite(result.opponentRating) ? result.opponentRating : before;
  const expected = expectedScore(before, opponentRating);
  const actual = draw ? 0.5 : won ? 1 : 0;
  const delta = Math.round(kFactor(profile) * (actual - expected));
  profile.rating = Math.max(MIN_RATING, Math.min(MAX_RATING, before + delta));
  profile.peak = Math.max(profile.peak || 0, profile.rating);
  profile.matches = (profile.matches || 0) + 1;
  profile.seasonWins = (profile.seasonWins || 0) + (won ? 1 : 0);
  profile.seasonLosses = (profile.seasonLosses || 0) + (!won && !draw ? 1 : 0);
  profile.seasonDraws = (profile.seasonDraws || 0) + (draw ? 1 : 0);
  profile.seasonPoints = (profile.seasonPoints || 0) + (won ? 3 : draw ? 1 : 0);
  if (won) profile.wins = (profile.wins || 0) + 1;
  else if (draw) profile.draws = (profile.draws || 0) + 1;
  else profile.losses = (profile.losses || 0) + 1;
  if (Array.isArray(result.score)) {
    profile.goalsFor = (profile.goalsFor || 0) + result.score[0];
    profile.goalsAgainst = (profile.goalsAgainst || 0) + result.score[1];
  }
  profile.streak = won ? (profile.streak || 0) + 1 : draw ? (profile.streak || 0) : Math.min(0, (profile.streak || 0)) - 1;
  profile.bestStreak = Math.max(profile.bestStreak || 0, profile.streak || 0);
  const afterLevel = divisionFor(profile.rating).level;
  profile.divisionSwing = (profile.divisionSwing || 0) + (afterLevel - beforeLevel);
  profile.history = [
    {
      won,
      draw,
      opponentId: result.opponentId,
      rating: Math.round(before),
      delta,
      at: Date.now(),
    },
    ...(Array.isArray(profile.history) ? profile.history : []),
  ].slice(0, 30);
  profile.updatedAt = Date.now();
  return profile;
}

/**
 * Season rollover. Called when a profile banks enough placement points: the ladder soft-resets
 * toward the middle so the climb has to be earned again, but the peak is remembered.
 */
export function rollSeason(profile) {
  const carried = Math.round((profile.rating - BASE_RATING) * 0.5);
  profile.rating = Math.max(MIN_RATING, BASE_RATING + carried);
  profile.season += 1;
  profile.seasonWins = 0;
  profile.seasonLosses = 0;
  profile.seasonDraws = 0;
  profile.seasonPoints = 0;
  profile.divisionSwing = 0;
  profile.updatedAt = Date.now();
  return profile;
}

/** Placement points needed for a division promotion. */
export const PROMOTION_POINTS = 12;

/** Is the profile in range for a season rollover? */
export function seasonComplete(profile) {
  return (profile.seasonPoints || 0) >= PROMOTION_POINTS;
}

/**
 * Pick the crew to face on the ladder: the one whose strength sits closest to the player's
 * rating, so the challenge is real without being a wall.
 * @param {Object} profile
 * @param {Array} teams optional override of the team list
 * @param {Function} rng a 0..1 random source (seeded, so a match can be replayed)
 */
export function rankedOpponent(profile, teams = TEAMS, rng = Math.random) {
  const rating = profile.rating || BASE_RATING;
  // Map the ladder rating onto the crew rating range: BRONZE faces the weakest crews, APEX the
  // strongest. The range is deliberately wide so the ladder keeps moving as the player climbs.
  const ovrs = teams.map((t) => teamOverall(t));
  const min = Math.min(...ovrs);
  const max = Math.max(...ovrs);
  const t = Math.max(0, Math.min(1, (rating - BASE_RATING) / 1500));
  const target = min + (max - min) * t;
  const scored = teams
    .map((team, i) => ({ team, dist: Math.abs(ovrs[i] - target) }))
    .sort((a, b) => a.dist - b.dist);
  const shortlist = scored.slice(0, Math.min(3, scored.length));
  const pick = shortlist[Math.floor(rng() * shortlist.length)] || scored[0];
  return pick.team;
}

/** The rating an opponent of that crew would be expected to hold. */
export function ratingForTeam(team) {
  const ovr = teamOverall(team);
  // Inverse of the mapping in `rankedOpponent`.
  const ovrs = TEAMS.map((t) => teamOverall(t));
  const min = Math.min(...ovrs);
  const max = Math.max(...ovrs);
  const t = max > min ? (ovr - min) / (max - min) : 0.5;
  return Math.round(BASE_RATING + t * 1500);
}

/** A short human summary of where a profile stands. */
export function profileSummary(profile) {
  const div = divisionFor(profile.rating);
  const next = nextRungRating(profile.rating);
  return {
    division: div,
    rating: Math.round(profile.rating),
    nextRung: next,
    toNext: Math.max(0, next - Math.round(profile.rating)),
    record: `${profile.wins || 0}W ${profile.losses || 0}L${profile.draws ? ` ${profile.draws}D` : ''}`,
    streak: profile.streak || 0,
    season: profile.season || 1,
    seasonPoints: profile.seasonPoints || 0,
    promotionPoints: PROMOTION_POINTS,
    seasonComplete: seasonComplete(profile),
  };
}
