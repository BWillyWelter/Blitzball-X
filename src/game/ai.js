import { cpuCallPlay } from './ai-plays.js';
import { carrierAI } from './ai-carrier.js';
import { offBallOffenseAI } from './ai-offense.js';
import { defenseAI } from './ai-defense.js';
import { looseBallAI } from './ai-loose.js';
import { keeperAI } from './ai-keeper.js';

/**
 * CPU brains for Blitzball. Called once per sim step for every non-user-controlled player.
 * Writes into p.input (same struct the human uses) so AI and human go through identical rules.
 *
 * This module is only the dispatcher — the input reset, the decision cadence and the routing. The
 * decisions themselves live in one module per role:
 *
 *   ai-plays.js    CPU playcalling (offense/defense playbook)
 *   ai-carrier.js  holding the ball: shoot / pass / signature move / drive
 *   ai-offense.js  attacking off the ball: role shape, cuts, screens
 *   ai-defense.js  pressing and man-marking, plus assignment
 *   ai-loose.js    balls in flight and rest: receivers, lane jumpers, rebound crashes
 *   ai-keeper.js   keeper positioning, shot reading, vertical and lateral dives
 *   ai-core.js     the shared moveToward / nearestOpponentDist / shotLaneOpen helpers
 *
 * Randomised decisions are rolled on a cadence (every 0.25 s) rather than per frame so that
 * probabilities are meaningful and reproducible.
 */
export function updateAI(sim, p, dt) {
  const inp = p.input;
  inp.moveX = 0;
  inp.moveZ = 0;
  inp.moveY = 0;
  inp.turbo = false;
  inp.shootPressed = false;
  inp.shootReleased = false;
  inp.pass = false;
  inp.trick = false;
  inp.hit = false;
  inp.breach = false;
  inp.switchPlayer = false;
  inp.gamebreaker = false;
  const ai = p.ai;
  ai.rollTimer = (ai.rollTimer || 0) - dt;
  const roll = ai.rollTimer <= 0;
  if (roll) ai.rollTimer = 0.25;
  if (p.state === 'fallen' || p.state === 'stumble' || sim.state !== 'live' && sim.state !== 'gamebreaker') return;

  // Team playcalling: any outfielder rolls for it (state is team-level, so it doesn't matter
  // which player's roll fires). Uses the dedicated play-RNG so calling plays never shifts the
  // main deterministic stream that gameplay rolls, tests and balance sims depend on.
  if (roll && !p.isKeeper) cpuCallPlay(sim, p, sim.playRng);

  if (p.isKeeper) return keeperAI(sim, p, dt, roll);
  const holder = sim.ball.holder;
  if (holder === p) return carrierAI(sim, p, dt, roll);
  if (holder && holder.team === p.team) return offBallOffenseAI(sim, p, dt, roll);
  if (holder) return defenseAI(sim, p, dt, roll);
  return looseBallAI(sim, p, dt, roll);
}
