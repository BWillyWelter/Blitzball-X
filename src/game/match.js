import { Vec3 } from '../core/vec3.js';
import { RNG } from '../core/rng.js';
import { EventBus } from '../core/events.js';
import { ARENA, RULES, DIFFICULTY } from '../data/constants.js';
import { OFFENSE_PLAYS, DEFENSE_PLAYS } from '../data/plays.js';
import { createPlayer, createBall, emptyInput, copyInput } from './entities.js';
import { starters } from '../data/teams.js';
import * as shooting from './shooting.js';
import * as ballMod from './ball.js';
import * as rulesMod from './rules.js';
import * as combat from './combat.js';
import * as passing from './passing.js';
import * as movement from './movement.js';
import { updateAI } from './ai.js';

// Kickoff shapes keep the opening possession readable while making the first pass impossible to
// memorise. Offsets are relative to each team's attacking direction: x is depth behind the
// carrier's starting line and z is the lateral lane.
const KICKOFF_FORMATIONS = [
  { carrier: [-0.4, 0], support: [[-4.2, 3.2], [-4.2, -3.2]] },
  { carrier: [-0.7, 1.1], support: [[-4.5, -2.4], [-3.4, 3.8]] },
  { carrier: [-0.7, -1.1], support: [[-3.4, -3.8], [-4.5, 2.4]] },
  { carrier: [-0.9, 0.7], support: [[-3.6, -2.8], [-5.1, 2.7]] },
];

/**
 * BLITZBALL X match simulation.
 *
 * Underwater 3-on-3 (+ keepers) inside a sphere pool. Arcade rules in the spirit of street-ball
 * arcade games: turbo, trick dribbles that "wash" defenders, big hits, tackles, volleys off the
 * walls, style meter, Gamebreaker super-shots, ON FIRE momentum. Two timed halves; mercy rule;
 * golden-goal overtime.
 *
 * Headless & deterministic: no DOM, no three.js. Everything the presentation needs comes via
 * `events` or by reading state after `step(dt)`.
 *
 * Coordinates: playing plane is x/z (x = length, team 0 attacks +x). `y` is vertical.
 */

// TRICKS lives in ./combat.js; re-exported for backwards compatibility.
export { TRICKS } from './combat.js';


export class MatchSim {
  constructor({ home, away, difficulty = 'pro', seed = 1, userTeam = 0 }) {
    this.rng = new RNG(seed);
    this.seed = seed;
    this.events = new EventBus();
    this.rules = { ...RULES };
    this.difficulty = DIFFICULTY[difficulty] || DIFFICULTY.pro;
    this.difficultyKey = difficulty;
    this.teams = [home, away];
    this.userTeam = userTeam; // 0 | 1 | null
    this.players = [];
    for (let t = 0; t < 2; t++) {
      starters(this.teams[t]).forEach((data, slot) => this.players.push(createPlayer(data, t, slot)));
    }
    this.ball = createBall();
    this.ballPreviousPosition = new Vec3(0, 0, 0); // previous-frame ball position (goal-crossing checks)
    this.score = [0, 0];
    this.gb = [0, 0];
    this.gbReady = [false, false];
    this.momentum = [0, 0]; // consecutive goals
    this.rubber = [1, 1]; // anti-blowout assist multiplier per team (see ringRattle)
    // Playbook: indices into OFFENSE_PLAYS / DEFENSE_PLAYS. Index 0 of each is the neutral default.
    this.offPlay = [0, 0];
    this.defPlay = [0, 0];
    this.userPlayTimer = 0; // cooldown between user play calls
    this.gbDriveShield = false; // true while a Gamebreaker drive is live (untackleable)
    // Dedicated RNG for CPU play calls: keeps play chatter out of the main gameplay stream
    // (so tests/balance that assume base-game rolls stay stable) while staying per-sim seeded.
    this.playRng = new RNG((seed ^ 0x51ec7) >>> 0);
    this.rungPulse = [0, 0]; // visual: goal-ring pulse when a goal is conceded
    this.possession = 0;
    this.possessionClock = this.rules.possessionClock;
    // --- Rematch-style player control state ---------------------------------
    // The user always pilots one swimmer directly; teammates run support AI. The ball stays
    // glued to the carrier's feet until they shoot/pass/slide-tackle (glue dribbling), the shot
    // aim is steered with movement input, and teammates can be called to ask for the ball.
    this.aimZ = 0; // user shot aim offset in the goal mouth (-1 left … +1 right)
    this.callPassTimer = 0; // >0 right after a support AI flags "I'm open!"
    this.flow = [false, false]; // per-team FLOW state (Blue Lock): ~10s of empowered play
    this.flowTimer = [0, 0];
    this.mustClear = false; // unused in Blitzball; kept for HUD compatibility
    this.shotClock = this.possessionClock; // HUD alias
    this.half = 1;
    this.clock = this.rules.halfLength;
    this.overtime = false;
    this.otTime = 0;
    this.time = 0;
    this.state = 'reset'; // reset | live | dead | halftime | gamebreaker | over
    this.stateTimer = 0;
    this.deadReason = 'kickoff';
    this.pendingPossession = 0;
    this.pendingGameOver = null;
    this.winner = null;
    this.controlled = null;
    this.userInput = emptyInput();
    this.slowmo = 0;
    this.timeScale = 1;
    this.lastScorer = null;
    this.lastGoalTime = -99;
    this.stats = { possessions: 0, shots: 0, saves: 0, tricks: 0, hits: 0, tackles: 0, volleys: 0 };
    this.kickoffTeam = this.rng.chance(0.5) ? 0 : 1;
    // Use the dedicated play RNG so changing kickoff art never shifts gameplay rolls.
    this.kickoffPattern = Math.min(KICKOFF_FORMATIONS.length - 1, Math.floor(this.playRng.next() * KICKOFF_FORMATIONS.length));
    this.resetPossession(this.kickoffTeam, 'kickoff');
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  teamPlayers(team) {
    return this.players.filter((q) => q.team === team);
  }

  outfield(team) {
    return this.players.filter((q) => q.team === team && !q.isKeeper);
  }

  keeperOf(team) {
    return this.players.find((q) =>