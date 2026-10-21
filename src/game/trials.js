/**
 * TRIALS — the skill check.
 *
 * One short period, no ladder, no record. You are graded on what the pool actually rewards: how
 * many rings you filled, whether you found the top ring, and how much style you banked doing it.
 * The grade is a five-star scale with fixed thresholds, so the same performance always reads the
 * same — which is the only way a drill score is worth anything.
 */

import { trialThresholds } from './modes.js';

/**
 * @typedef {Object} TrialGrade
 * @property {number} stars 0–5
 * @property {number} score
 * @property {number} nextAt score needed for the next star, 0 at maximum
 * @property {{ goals:number, topRings:number, style:number, saves:number, steals:number }} parts
 * @property {string} verdict
 * @property {string[]} notes
 */

/**
 * Grade one crew's trial run.
 * @param {import('./match.js').MatchSim} sim
 * @param {number} team
 * @returns {TrialGrade}
 */
export function gradeTrials(sim, team = 0) {
  const players = sim.teamPlayers(team);
  const goals = players.reduce((n, p) => n + (p.stats.goals || 0), 0);
  const style = players.reduce((n, p) => n + (p.stats.style || 0), 0);
  const saves = players.reduce((n, p) => n + (p.stats.saves || 0), 0);
  const steals = players.reduce((n, p) => n + (p.stats.tkl || 0), 0);
  // Top-ring goals are the drill's headline: three points each, and only one window scores them.
  const topRings = sim.ringGoals?.[team]?.[0] || 0;

  const score = goals * 100 + topRings * 60 + style + saves * 12 + steals * 8;
  const thresholds = trialThresholds();
  let stars = 0;
  for (const step of thresholds) if (score >= step) stars += 1;
  const nextAt = thresholds[stars] ?? 0;

  const notes = [];
  notes.push(`${goals} ring${goals === 1 ? '' : 's'} filled`);
  notes.push(topRings ? `${topRings} through the TOP RING` : 'never found the top ring');
  notes.push(`${style} style banked`);
  if (saves) notes.push(`${saves} save${saves === 1 ? '' : 's'} at the cage`);
  if (steals) notes.push(`${steals} turnover${steals === 1 ? '' : 's'} won`);

  return {
    stars: Math.min(5, stars),
    score,
    nextAt,
    parts: { goals, topRings, style, saves, steals },
    verdict: VERDICT[Math.min(4, stars)],
    notes,
  };
}

const VERDICT = [
  'NOT YET · the pool is still waiting',
  'ROOKIE · you can swim, at least',
  'STEADY · the basics are there',
  'SHARP · that is a starting seven swimmer',
  'CLEAN SWEEP · they should be paying you',
];

/** A five-star text rendering, for labels, tooltips and tests. */
export function starText(stars, max = 5) {
  const filled = '★'.repeat(Math.max(0, Math.min(max, stars)));
  return `${filled}${'☆'.repeat(Math.max(0, max - stars))}`;
}

/**
 * The same grade as inline SVG.
 *
 * The screens used to render the star glyphs directly, and a condensed display face does not
 * always carry ★/☆ — a host without a covering fallback draws tofu boxes instead of a grade. A
 * five-point path always draws, so the grade can never be unreadable.
 */
export function starMarkup(stars, max = 5) {
  const count = Math.max(0, Math.min(max, stars));
  const path = 'M12 2.6l2.9 6.1 6.7.9-4.9 4.7 1.2 6.7L12 17.8 6.1 21l1.2-6.7L2.4 9.6l6.7-.9z';
  let out = `<span class="rt-star-row" role="img" aria-label="${count} of ${max} stars">`;
  for (let i = 0; i < max; i++) {
    out += `<svg viewBox="0 0 24 24" class="rt-star ${i < count ? 'on' : ''}" aria-hidden="true"><path d="${path}"/></svg>`;
  }
  return `${out}</span>`;
}
