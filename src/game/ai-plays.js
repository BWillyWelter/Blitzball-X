import { RULES } from '../data/constants.js';

/**
 * CPU playcalling.
 *
 * CPU teams run their own playbook: presses/zones situationally on defense, iso/spread on
 * offense. Calls are infrequent (plays "stick" once set) so the sim's baseline balance —
 * which assumes the neutral default plays — barely moves.
 *
 * Rolled on the dedicated play RNG (not the main gameplay stream) so calling a play never shifts
 * the deterministic sequence that tests and balance sims depend on.
 */
export function cpuCallPlay(sim, p, rng) {
  const team = p.team;
  const attacking = sim.possession === team;
  const deficit = sim.score[1 - team] - sim.score[team]; // positive = we trail
  const cur = attacking ? sim.offPlay[team] : sim.defPlay[team];
  // Plays stick: entering a look is uncommon, and abandoning a called one is rarer still,
  // so a play typically holds for ~20-40s before the team re-evaluates.
  if (!rng.chance(cur === 0 ? 0.02 : 0.006)) return;
  if (attacking) {
    // Trailing late? Isolation and let the star go to work. Otherwise mix in Spread.
    const i = deficit >= 2 && sim.time > RULES.halfLength ? 2 : rng.chance(0.2) ? 1 : 0;
    if (i !== cur) sim.callPlay('offense', i, team);
  } else {
    // Trailing? Full Press to hunt turnovers. Otherwise occasional Drop Zone.
    const i = deficit >= 1 ? 2 : rng.chance(0.2) ? 1 : 0;
    if (i !== cur) sim.callPlay('defense', i, team);
  }
}
