import { emptyInput } from './entities.js';

/**
 * A seat is one human player at the keyboard.
 *
 * The sim used to assume a single pilot (`userTeam` + `controlled` + one input struct). A seat
 * generalises that: it owns a team, an input struct, the swimmer it pilots and whether that
 * swimmer is currently in the cage. One seat is a normal match; two seats is a local duel.
 *
 * Everything the old single-player code touched through `sim.userTeam` / `sim.controlled` /
 * `sim.inCage` / `sim.userInput` still works — those are accessors onto seat 0 — so the sim
 * reads the same either way.
 */
export class Seat {
  /**
   * @param {number} index seat number (0 = the primary player)
   * @param {number|null} team the team this seat pilots (0 | 1 | null = no seat)
   */
  constructor(index, team) {
    this.index = index;
    this.team = team ?? null;
    this.input = emptyInput();
    this.controlled = null;
    this.inCage = false;
    this.keeperSwitchCd = 0;
    // >0 right after a support AI flagged "I'm open!"
    this.callPassTimer = 0;
    // Cooldown between playbook calls.
    this.userPlayTimer = 0;
    // Free-form label used by the HUD and the lobby ("P1", "HOST", …).
    this.label = '';
    this.device = 'keyboard';
  }

  /** Is this seat in play? */
  get active() {
    return this.team !== null;
  }

  /** Is this seat piloting the keeper? */
  get inCageNow() {
    return this.inCage && !!this.controlled && this.controlled.isKeeper;
  }
}
