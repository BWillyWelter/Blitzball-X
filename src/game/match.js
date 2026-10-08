import { Vec3 } from '../core/vec3.js';
import { RNG } from '../core/rng.js';
import { EventBus } from '../core/events.js';
import { ARENA, RULES, MOVE, DIFFICULTY, PHYS } from '../data/constants.js';
import { OFFENSE_PLAYS, DEFENSE_PLAYS } from '../data/plays.js';
import { createPlayer, createBall, emptyInput, copyInput } from './entities.js';
import { starters, benchOf, playerOverall } from '../data/teams.js';
import * as shooting from './shooting.js';
import * as ballMod from './ball.js';
import * as rulesMod from './rules.js';
import * as combat from './combat.js';
import * as passing from './passing.js';
import * as movement from './movement.js';
import { updateAI } from './ai.js';

/** Overall rating of a swimmer's data record — the single number the coaches rank on. */
function overallOf(data) {
  return playerOverall(data);
}

// Kickoff shapes keep the opening possession readable while making the first pass impossible to
// memorise. Offsets are relative to each team's attacking direction: x is depth behind the
// carrier's starting line and z is the lateral lane.
const KICKOFF_FORMATIONS = [
  { carrier: [-0.5, 0], support: [[-4.6, 2.6], [-4.6, -2.6], [-6.2, 4.6], [-6.2, -4.6], [-7.8, 0.9]] },
  { carrier: [-0.8, 1.0], support: [[-4.2, -2.2], [-5.4, 3.8], [-6.4, -4.4], [-7.8, 1.4], [-7.0, -1.2]] },
  { carrier: [-0.8, -1.0], support: [[-4.2, 2.2], [-5.4, -3.8], [-6.4, 4.4], [-7.8, -1.4], [-7.0, 1.2]] },
];
// Where the defending team lines up for the tip-off / kickoff (one presser high, marks behind).
const DEFENSE_KICKOFF = [[-2.3, 0.7], [-3.6, 3.0], [-3.6, -3.0], [-5.4, 4.8], [-5.4, -4.8], [-7.0, 0]];

/**
 * BLITZBALL X match simulation.
 *
 * Underwater rugby, 7-a-side (+4 subs) inside a sphere pool: 1 keeper, 4 fielders and 2 shooters
 * (the captains) per side, defended by keepers, fielders and stoppers. Arcade rules: burst
 * sprints, juke dribbles that "wash" defenders, big hits, tackles, a three-ring touchdown zone
 * (top ring 3, low rings 1), style meter, Gamebreaker super-shots, ON FIRE momentum. Two timed
 * halves; mercy rule; golden-goal overtime.
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
    // Benches: the four non-starters on each touch wall, created as full entities so a substitution
    // is a straight pointer swap in `players` rather than a data mutation that would have to unwind
    // every cached stat. They are NOT in `players`, so no AI, physics or ball code ever sees them
    // until they swim.
    this.benches = [[], []];
    for (let t = 0; t < 2; t++) {
      benchOf(this.teams[t]).forEach((data) => this.benches[t].push(createPlayer(data, t, -1)));
    }
    this.subsLeft = [RULES.subsPerTeam, RULES.subsPerTeam];
    this.subPending = []; // { team, out, incoming } waiting out their entry animation
    this.subWindow = 0; // seconds the bench panel stays open at the current stoppage
    this.cards = [[], []]; // per-team disciplinary record, for the recap
    this.injuries = [[], []]; // per-team carry-over injuries (career mode)
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
    // Taking the cage: true while the player is piloting their own keeper.
    this.inCage = false;
    this.keeperSwitchCd = 0;
    this.userInput = emptyInput();
    this.slowmo = 0;
    this.timeScale = 1;
    this.freeze = 0; // impact hitstop: real seconds the whole sim is held still
    this.lastScorer = null;
    this.lastGoalTime = -99;
    this.stats = { possessions: 0, shots: 0, saves: 0, tricks: 0, hits: 0, tackles: 0, volleys: 0, fouls: 0, subs: 0 };
    // Match story: everything the halftime montage and the full-time recap need, recorded as it
    // happens rather than reconstructed afterwards. A goal log drives the shot chart and the
    // scorer list; ring goals are the split by which window the points came through; the biggest
    // hit is the one moment a highlight reel is made of.
    this.goalLog = [];
    this.ringGoals = [[0, 0, 0], [0, 0, 0]];
    this.halfScore = [[0, 0], [0, 0]]; // [team][0 = first half, 1 = second]
    this.biggestHit = null;
    this.kickoffTeam = this.rng.chance(0.5) ? 0 : 1;
    // Use the dedicated play RNG so changing kickoff art never shifts gameplay rolls.
    this.kickoffPattern = Math.min(KICKOFF_FORMATIONS.length - 1, Math.floor(this.playRng.next() * KICKOFF_FORMATIONS.length));
    this.tipoffPhase = null; // 'hold' | 'race' while the captains contest the dropped ball
    this.zoneHit = null; // ring crossed by the last scoring ball ({ ring, points })
    // Pre-match presentation: intro warm-ups, then the captains' tip-off. Positions everyone
    // without handing out the ball (the ref holds it at centre until the whistle).
    this.state = 'warmup';
    this.stateTimer = this.rules.warmupDuration;
    this.placeFormation(this.kickoffTeam, 'kickoff', { noBall: true });
    // You always pilot one swimmer — including through the warm-up and tip-off presentation.
    if (this.userTeam !== null) this.autoSelectControlled();
    this.events.emit('warmup', { home: this.teams[0], away: this.teams[1] });
  }

  /**
   * Re-read the module-level RULES into this sim's own snapshot.
   *
   * The sim works from a copy of RULES taken at construction, so a live edit to the constants (the
   * `?tune` dev panel) would otherwise only land in the next match. The other tuning groups —
   * MOVE, ACTION, COMBAT, STYLE, PHYS, DIFFICULTY — are read straight from their modules every
   * time, so they need no hook. Rule timers already running (the possession clock, a state timer)
   * keep their current value and pick the new one up at the next reset, which is what a coach
   * changing the shot clock mid-match would expect.
   */
  syncTuning() {
    this.rules = { ...RULES };
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
    return this.players.find((q) => q.team === team && q.isKeeper);
  }

  attackDir(team) {
    return team === 0 ? 1 : -1;
  }

  goalPos(team) {
    // the goal `team` attacks
    return new Vec3(ARENA.goalX * this.attackDir(team), ARENA.goalY, 0);
  }

  ownGoalPos(team) {
    return new Vec3(-ARENA.goalX * this.attackDir(team), ARENA.goalY, 0);
  }

  distToGoal(p) {
    return p.pos.distanceToXZ(this.goalPos(p.team));
  }

  teammatesOf(p) {
    return this.players.filter((q) => q.team === p.team && q !== p);
  }

  opponentsOf(p) {
    return this.players.filter((q) => q.team !== p.team);
  }

  isUser(p) {
    return this.userTeam !== null && p.team === this.userTeam && p === this.controlled;
  }

  forwardOf(p) {
    return new Vec3(Math.sin(p.facing), 0, Math.cos(p.facing));
  }

  canAct(p) {
    return !p.airborne && p.stun <= 0 && (p.state === 'idle' || p.state === 'swim' || p.state === 'catch') && this.state === 'live';
  }

  setState(p, state, dur = 0) {
    p.state = state;
    p.stateTime = 0;
    p.stateDur = dur;
  }

  // ---------------------------------------------------------------------------
  // Flow control
  // ---------------------------------------------------------------------------

  resetPossession(team, reason) {
    this.state = 'reset';
    this.stateTimer = this.rules.resetDuration;
    this.possession = team;
    this.possessionClock = this.rules.possessionClock;
    this.shotClock = this.possessionClock;
    this.ball.flight = null;
    this.ball.vel.set(0, 0, 0);
    this.ball.holder = null;
    this.slowmo = 0;
    this.timeScale = 1;
    this.freeze = 0;
    for (const p of this.players) {
      p.vel.set(0, 0, 0);
      p.y = 0;
      p.vy = 0;
      p.airborne = false;
      p.stun = 0;
      p.shot = null;
      p.trick = null;
      p.moveArmor = 0;
      p.hasBall = false;
      p.callingForPass = false;
      p.turbo = Math.max(p.turbo, 45);
      p.turboActive = false;
      this.setState(p, 'idle');
      p.ai = { ...p.ai, cutting: false, cutTimer: 0, target: null, lungedFor: null };
    }
    this.callPassTimer = 0; // stale "I'm open" flags must not survive a possession reset
    // Stoppage = the coaches' moment: run any changes the player queued during live play, then let
    // the CPU rotate its tired swimmers before the ball is put back in.
    this.flushSubs();
    this.cpuCoach();
    // A foul restart keeps the ball where it was whistled; every other restart re-forms up.
    if (reason !== 'foul') this.placeFormation(team, reason);
    this.stats.possessions++;
    this.events.emit('reset', { team, reason });
    if (this.userTeam !== null) this.autoSelectControlled();
  }

  // ---------------------------------------------------------------------------
  // Pre-match presentation: warm-up laps and the captains' tip-off
  // ---------------------------------------------------------------------------

  /** Intro warm-ups: each team swims wide laps in its own half while the clock stays frozen.
   * The user's swimmer is free to cruise around with them — it's the pre-game warm-up too. */
  stepWarmup(dt) {
    this.stateTimer -= dt;
    for (const p of this.players) {
      if (this.userTeam !== null && p === this.controlled) {
        copyInput(p.input, this.userInput);
        p.input.turbo = false;
        p.input.shootPressed = false;
        p.input.pass = false;
        p.input.trick = false;
        p.input.hit = false;
        p.input.breach = false;
      } else {
        const dir = this.attackDir(p.team);
        const lapR = 2.6 + (p.slot % 4) * 0.7;
        const a = this.time * (0.55 + (p.slot % 3) * 0.07) + p.slot * 1.15;
        const target = new Vec3(-dir * 6.5 + Math.cos(a) * lapR, 0, Math.sin(a) * lapR * 1.5);
        const d = Vec3.dirXZ(p.pos, target);
        p.input.moveX = d.x;
        p.input.moveZ = d.z;
        p.input.moveY = 0;
        p.input.turbo = false;
      }
      this.updatePlayerPhysics(p, dt, true);
    }
    this.separatePlayers();
    if (this.stateTimer <= 0) this.beginTipoff();
  }

  /** The ref brings both captains to centre; the ball drops after a beat and they race. */
  beginTipoff() {
    this.state = 'tipoff';
    this.tipoffPhase = 'hold';
    this.stateTimer = this.rules.tipoffHold + this.rules.tipoffRace;
    this.possession = this.kickoffTeam; // fallback if the race stalls
    this.possessionClock = this.rules.possessionClock;
    this.shotClock = this.possessionClock;
    this.ball.holder = null;
    this.ball.flight = null;
    this.ball.vel.set(0, 0, 0);
    this.ball.pos.set(0, 1.0, 0);
    this.placeTipoff();
    this.events.emit('tipoff', { home: this.teams[0], away: this.teams[1] });
  }

  placeTipoff() {
    for (let t = 0; t < 2; t++) {
      const dir = this.attackDir(t);
      const gk = this.keeperOf(t);
      const out = this.outfield(t);
      const own = -ARENA.goalX * dir;
      gk.pos.set(own + dir * 0.9, 0, 0);
      gk.facing = Math.atan2(dir, 0);
      // The captains square off across the centre circle; everyone else holds shape.
      out[0].pos.set(-dir * 1.5, 0, 0);
      const spots = [[-3.5, 3.0], [-3.5, -3.0], [-5.5, 4.8], [-5.5, -4.8], [-7.0, 0]];
      spots.forEach(([x, z], i) => {
        if (out[i + 1]) out[i + 1].pos.set(dir * x, 0, z);
      });
      for (const p of out) p.facing = Math.atan2(dir, 0);
    }
  }

  stepTipoff(dt) {
    this.stateTimer -= dt;
    if (this.tipoffPhase === 'hold') {
      // Ref holds the ball high at centre; everyone holds their mark.
      for (const p of this.players) {
        p.input.moveX = 0;
        p.input.moveZ = 0;
        p.input.moveY = 0;
        p.anim.t += dt;
        this.updatePlayerPhysics(p, dt, true);
      }
      if (this.stateTimer <= this.rules.tipoffRace) {
        this.tipoffPhase = 'race';
        this.ball.vel.set(0, -0.5, 0);
        this.events.emit('whistle', {});
      }
      return;
    }
    // Race: the captains swim for the dropped ball. If you control one of them, YOU take the
    // tip-off; everyone else stays out of it.
    const cap0 = this.outfield(0)[0];
    const cap1 = this.outfield(1)[0];
    for (const p of this.players) {
      if (p === cap0 || p === cap1) {
        if (this.userTeam !== null && p === this.controlled) {
          copyInput(p.input, this.userInput);
          p.input.turbo = p.turbo > 30 && this.userInput.turbo;
        } else {
          const d = Vec3.dirXZ(p.pos, this.ball.pos);
          p.input.moveX = d.x;
          p.input.moveZ = d.z;
          p.input.turbo = p.turbo > 30;
        }
      } else {
        p.input.moveX = 0;
        p.input.moveZ = 0;
        p.input.moveY = 0;
      }
      this.updatePlayerPhysics(p, dt, false);
    }
    this.separatePlayers();
    this.updateBall(dt, false);
    if (this.ball.holder) {
      // First to the ball takes the opening possession.
      this.possession = this.ball.holder.team;
      this.possessionClock = this.rules.possessionClock;
      this.shotClock = this.possessionClock;
      this.state = 'live';
      this.tipoffPhase = null;
      if (this.userTeam !== null) this.autoSelectControlled();
      this.events.emit('live', { possession: this.possession, half: this.half, tipoff: true });
    } else if (this.stateTimer <= 0) {
      // Stalled race: the ref awards the ball to the designated kickoff team's captain.
      const cap = this.outfield(this.kickoffTeam)[0];
      cap.pos.set(0, 0, 0);
      this.giveBall(cap);
      this.state = 'live';
      this.tipoffPhase = null;
      if (this.userTeam !== null) this.autoSelectControlled();
      this.events.emit('live', { possession: this.possession, half: this.half, tipoff: true });
    }
  }

  placeFormation(possTeam, reason, opts = {}) {
    for (let t = 0; t < 2; t++) {
      const dir = this.attackDir(t);
      const gk = this.keeperOf(t);
      const out = this.outfield(t); // [captain SH, SH2, FD, FD, FD, FD]
      const own = -ARENA.goalX * dir;
      // Keeper in front of own goal
      gk.pos.set(own + dir * 0.9, 0, 0);
      gk.facing = Math.atan2(dir, 0);
      if (reason === 'kickoff' || reason === 'goal' || reason === 'halftime') {
        // Centre face-off, with the match's seeded opening shape varying the carrier and support
        // lanes. Non-possession swimmers mirror a defensive shape so the matchup is fair.
        const mine = t === possTeam;
        const shape = KICKOFF_FORMATIONS[this.kickoffPattern % KICKOFF_FORMATIONS.length];
        const carrier = mine ? shape.carrier : DEFENSE_KICKOFF[0];
        const support = mine ? shape.support : DEFENSE_KICKOFF.slice(1);
        out[0].pos.set(dir * carrier[0], 0, carrier[1]);
        support.forEach(([x, z], i) => {
          if (out[i + 1]) out[i + 1].pos.set(dir * x, 0, z);
        });
      } else {
        // Turnover-style restart: give ball to the keeper of the possession team.
        const spots = [[-2.5, 0], [-4.5, 3.0], [-4.5, -3.0], [-6.5, 4.6], [-6.5, -4.6], [-8.0, 0]];
        out.forEach((p, i) => {
          const s = spots[i] || [-6, 0];
          p.pos.set(dir * s[0], 0, s[1]);
        });
      }
      for (const p of out) p.facing = Math.atan2(dir, 0);
    }
    if (!opts.noBall) {
      const carrier = reason === 'kickoff' || reason === 'goal' || reason === 'halftime' ? this.outfield(possTeam)[0] : this.keeperOf(possTeam);
      this.giveBall(carrier, false);
    }
  }

  autoSelectControlled() {
    // Inside the cage the player owns the keeper: never yank control back to an outfielder
    // mid-duel, or taking the cage would be a coin flip every time the ball moved.
    const gk = this.keeperOf(this.userTeam);
    if (gk && this.inCage && gk.controlled && gk.state !== 'fallen') return;
    const mine = this.outfield(this.userTeam);
    let pick;
    if (this.ball.holder && this.ball.holder.team === this.userTeam && !this.ball.holder.isKeeper) pick = this.ball.holder;
    else {
      // nearest outfield to the ball
      let bd = Infinity;
      for (const p of mine) {
        const d = p.pos.distanceToXZ(this.ball.pos);
        if (d < bd) {
          bd = d;
          pick = p;
        }
      }
    }
    mine.forEach((p) => (p.controlled = false));
    if (gk) gk.controlled = false;
    this.inCage = false;
    this.controlled = pick;
    pick.controlled = true;
  }

  switchControlled() {
    if (this.userTeam === null) return;
    // In the cage, the switch button hands you back to the nearest outfield swimmer — that is
    // how you leave the keeper (and how the touch pad's SWAP gets you out of the box).
    if (this.inCage) return this.leaveCage();
    // Rematch-style: you can switch off the ball-carrier too — you always pilot exactly one
    // swimmer, and off-ball carriers get reliable support AI.
    const mine = this.outfield(this.userTeam).filter((p) => p !== this.controlled);
    mine.sort((a, b) => a.pos.distanceToXZ(this.ball.pos) - b.pos.distanceToXZ(this.ball.pos));
    if (mine.length) {
      if (this.controlled) this.controlled.controlled = false;
      this.controlled = mine[0];
      mine[0].controlled = true;
      this.events.emit('switch', { player: this.controlled });
    }
  }

  // ---------------------------------------------------------------------------
  // The cage
  // ---------------------------------------------------------------------------

  /**
 * Is the cage open right now? Only once the play is actually at your end — standing in your own
 * half with the ball at the other goal would just be a way to stop playing.
 */
cageAvailable() {
    if (this.userTeam === null || this.inCage || this.keeperSwitchCd > 0) return false;
    if (this.state !== 'live') return false;
    const gk = this.keeperOf(this.userTeam);
    if (!gk || gk.state === 'fallen' || gk.sentOff) return false;
    // Roughly your own half: open once the ball is at your end, shut while it is still theirs.
    // (The halfway line is ~15 m from your own goal on this pitch, so anything much above that
    // would leave the cage open for most of the match and make it a way to stop playing.)
    return this.ball.pos.distanceToXZ(this.ownGoalPos(this.userTeam)) <= 19;
  }

  /**
   * Take the cage: hand control to your own keeper from any outfield swimmer. The trade is real —
   * the outfield swimmer you leave goes back on AI (so nobody is marking the ball for you), the
   * keeper is slower to turn, and if you are caught out of position the goal is on you. In
   * exchange you own the shot: a dive is yours to time.
   */
  takeCage() {
    if (!this.cageAvailable()) return false;
    const gk = this.keeperOf(this.userTeam);
    if (this.controlled) this.controlled.controlled = false;
    for (const p of this.outfield(this.userTeam)) p.controlled = false;
    gk.controlled = true;
    this.controlled = gk;
    this.inCage = true;
    this.keeperSwitchCd = this.rules.keeperSwitchCooldown;
    this.events.emit('cage', { keeper: gk, on: true });
    return true;
  }

  /** Hand control back to the nearest outfield swimmer. */
  leaveCage() {
    if (!this.inCage) return false;
    const gk = this.keeperOf(this.userTeam);
    if (gk) gk.controlled = false;
    this.inCage = false;
    const mine = this.outfield(this.userTeam);
    let pick = null;
    let bd = Infinity;
    for (const p of mine) {
      const d = p.pos.distanceToXZ(this.ball.pos);
      if (d < bd) {
        bd = d;
        pick = p;
      }
    }
    if (!pick) return false;
    this.controlled = pick;
    pick.controlled = true;
    this.keeperSwitchCd = this.rules.keeperSwitchCooldown;
    this.events.emit('cage', { keeper: gk, on: false, player: pick });
    return true;
  }

  /**
   * Committed keeper dive: a lateral lunge inside the box, aimed with the stick. It buys real
   * reach and save probability while it is live (see `checkKeeperSave`), costs body, and has a
   * cooldown — and diving the wrong way is worse than not diving at all, so the read is the point.
   */
  keeperDive(p, aim) {
    if (!p || !p.isKeeper || p.cd.dive > 0 || p.state === 'fallen') return false;
    let dz = aim && aim.z !== undefined ? aim.z : 0;
    if (Math.abs(dz) < 0.2) dz = 0;
    p.cd.dive = MOVE.keeperDiveCooldown;
    p.diveT = MOVE.keeperDiveWindow;
    p.diveDir = dz;
    // The lunge: lateral only, and only for the committed part of the window — after that you are
    // recovering and a shot can slip past a keeper who has already committed.
    p.diveCommit = MOVE.keeperDiveCommit;
    combat.spendStamina(p, 'fall');
    this.events.emit('keeperdive', { keeper: p, dir: dz });
    return true;
  }

  /** Movement input as a world-space direction (Rematch-style aiming axis), or null if neutral. */
  /**
   * World-space direction the player is aiming a shot with. A touch swipe in the strike zone
   * publishes an explicit aim (aimX/aimZ) that wins over the movement stick, so a swipe aims the
   * shot without also steering the swimmer.
   */
  aimInputDir() {
    const inp = this.userInput;
    if (!inp) return null;
    if (inp.aimX || inp.aimZ) return new Vec3(inp.aimX, 0, inp.aimZ).normalize();
    if (inp.moveX === 0 && inp.moveZ === 0) return null;
    return new Vec3(inp.moveX, 0, inp.moveZ).normalize();
  }

  /** If a teammate is flagged "I'm open", hand them the next pass. */
  callPassTarget(p) {
    if (this.callPassTimer <= 0 || this.userTeam === null || p.team !== this.userTeam) return null;
    return this.teammatesOf(p).find((q) => !q.isKeeper && q.callingForPass) || null;
  }

  setUserInput(input) {
    this.userInput = input;
  }

  // ---------------------------------------------------------------------------
  // Bench & substitutions
  // ---------------------------------------------------------------------------

  /** Swimmers on the touch wall for a team, best rating first. */
  benchOf(team) {
    return this.benches[team];
  }

  /**
   * Can this team change a swimmer right now? Changes need the ball to be out of the play that
   * is leaving: at a dead ball, a goal reset or the break. During live play you can still call
   * one — it goes through at the next whistle, which is how a coach actually uses a sub.
   */
  canSub(team) {
    if (this.subsLeft[team] <= 0) return false;
    return this.benches[team].length > 0;
  }

  /**
   * A sub can pull a swimmer only when the play isn't running through him: no ball in hand, no
   * shot winding up, not mid-knockdown, not on the bench already, and the incoming swimmer has to
   * be able to fill the same role (a keeper can't cover a field).
   */
  subIsSafe(team, out) {
    if (!out || out.team !== team || out.subbedOff) return false;
    if (this.ball.holder === out || out.hasBall) return false;
    if (out.state === 'shoot' || out.state === 'trick' || out.state === 'gbdrive') return false;
    if (out.state === 'fallen' || out.state === 'stumble' || out.state === 'reel') return false;
    if (out.airborne) return false;
    if (out === this.controlled) return false;
    return true;
  }

  /**
   * Best bench swimmer for this slot: a role match first, then the highest overall rating. Keeping
   * this a sim decision (not a UI one) means the CPU coach and the player's coach call subs with
   * exactly the same rules.
   */
  bestSubFor(team, out) {
    const bench = this.benches[team].filter((b) => !b.subbedIn && !b.sentOff);
    if (!bench.length) return null;
    const needKeeper = out && out.isKeeper;
    const pool = bench.filter((b) => (needKeeper ? b.isKeeper : !b.isKeeper));
    if (!pool.length) return null;
    pool.sort((a, b) => overallOf(b.data) - overallOf(a.data));
    return pool[0];
  }

  /**
   * Swap `out` for `incoming` in the water. The slot in `players` is reused so every held
   * reference (controlled, marks, flight targets) stays valid; the outgoing swimmer goes to the
   * bench carrying the stamina he has left, which is what makes the fourth change a real decision.
   */
  applySub(team, out, incoming) {
    const idx = this.players.indexOf(out);
    if (idx < 0) return false;
    // The incoming swimmer takes the water at the outgoing swimmer's spot.
    incoming.slot = out.slot;
    incoming.subbedOff = false;
    incoming.vel.set(0, 0, 0);
    incoming.pos.copy(out.pos);
    incoming.y = out.y;
    incoming.facing = out.facing;
    incoming.state = 'idle';
    incoming.stateTime = 0;
    incoming.stateDur = 0;
    incoming.stun = 0;
    incoming.airborne = false;
    incoming.vy = 0;
    incoming.turbo = Math.max(incoming.turbo, 55); // fresh legs, but not a full tank
    incoming.subbedIn = true;
    incoming.minutesPlayed = 0;
    incoming.ai = {};
    incoming.shot = null;
    incoming.trick = null;
    incoming.keeperHold = 0;
    for (const k in incoming.cd) incoming.cd[k] = 0;
    incoming.facing = out.facing;

    // The outgoing swimmer keeps whatever he had left in the tank.
    out.subbedOff = true;
    out.state = 'bench';
    out.stateTime = 0;
    out.shot = null;
    out.trick = null;
    out.hasBall = false;
    out.controlled = false;
    out.ai = {};
    out.pos.copy(incoming.pos);

    // Replace in place, then park the outgoing swimmer on the bench.
    this.players[idx] = incoming;
    this.benches[team] = this.benches[team].filter((b) => b !== incoming);
    this.benches[team].push(out);
    this.benches[team].sort((a, b) => overallOf(b.data) - overallOf(a.data));
    this.subsLeft[team]--;

    // If the swap touched whoever the player was piloting (e.g. the AI took the slot over), hand
    // control back to something sensible immediately rather than leaving a dangling reference.
    if (this.controlled === out || !this.players.includes(this.controlled)) {
      this.controlled = null;
      if (this.userTeam !== null) this.autoSelectControlled();
    }
    this.events.emit('sub', { team, out, in: incoming, remaining: this.subsLeft[team] });
    this.stats.subs++;
    return true;
  }

  /** Queue a change: it swims on at the next stoppage, or immediately if the ball is dead. */
  queueSub(team, out, incoming) {
    if (!this.subIsSafe(team, out) || !incoming || incoming.team !== team) return false;
    const atStoppage = this.state !== 'live';
    if (atStoppage) return this.applySub(team, out, incoming);
    this.subPending.push({ team, out, incoming });
    this.events.emit('subqueued', { team, out, in: incoming });
    return true;
  }

  /** Run queued changes at the next whistle. */
  flushSubs() {
    if (!this.subPending.length) return;
    const queue = this.subPending.slice();
    this.subPending.length = 0;
    for (const s of queue) {
      // The swimmer may have picked the ball up while the change was on its way.
      if (this.subIsSafe(s.team, s.out)) this.applySub(s.team, s.out, s.incoming);
    }
  }

  /**
   * CPU coach: rotate tired swimmers at a stoppage. A gassed player left in the water is how a
   * crew gets flattened late, so the CPU makes the same change a good human coach would.
   */
  cpuCoach() {
    if (this.state === 'live') return;
    for (let t = 0; t < 2; t++) {
      if (!this.canSub(t)) continue;
      const tired = this.players
        .filter((p) => p.team === t && this.subIsSafe(t, p))
        .sort((a, b) => a.stamina - b.stamina);
      const out = tired[0];
      if (!out || out.stamina > MOVE.staminaMax * 0.3) continue;
      const incoming = this.bestSubFor(t, out);
      if (!incoming) continue;
      this.applySub(t, out, incoming);
    }
  }

  /** Open the bench window at a stoppage so the player (or the CPU) can make changes. */
  openSubWindow(team = null) {
    if (this.state === 'live') return;
    this.subWindow = RULES.subWindow;
    if (team !== null && this.canSub(team)) {
      this.events.emit('subwindow', { team });
    }
  }

  // ---------------------------------------------------------------------------
  // Playbook
  // ---------------------------------------------------------------------------

  /** Active offensive play for a team (index 0 is the neutral default). */
  offensePlayOf(team) {
    return OFFENSE_PLAYS[this.offPlay[team]] || OFFENSE_PLAYS[0];
  }

  /** Active defensive play for a team (index 0 is the neutral default). */
  defensePlayOf(team) {
    return DEFENSE_PLAYS[this.defPlay[team]] || DEFENSE_PLAYS[0];
  }

  /** Defensive modifiers in effect for a team (its chosen defensive play). */
  defenseMods(team) {
    return this.defensePlayOf(team);
  }

  /**
   * Call a play. Offense plays apply while the team has the ball; defense plays while it
   * doesn't. Returns the play object (for HUD feedback) or null on a rejected call.
   */
  callPlay(side, index, team = this.userTeam ?? 0) {
    if (team !== 0 && team !== 1) return null;
    const list = side === 'offense' ? OFFENSE_PLAYS : DEFENSE_PLAYS;
    if (!list[index]) return null;
    if (side === 'offense') this.offPlay[team] = index;
    else this.defPlay[team] = index;
    this.events.emit('playcall', { team, side, play: list[index] });
    return list[index];
  }

  // ---------------------------------------------------------------------------
  // Ball possession helpers
  // ---------------------------------------------------------------------------

  giveBall(p, announce = true) {
    const prevTeam = this.ball.holder ? this.ball.holder.team : this.ball.lastTeam;
    if (this.ball.holder) this.ball.holder.hasBall = false;
    this.ball.holder = p;
    this.ball.flight = null;
    this.ball.vel.set(0, 0, 0);
    this.ball.releaseCooldown = null;
    p.hasBall = true;
    this.updateGlueDribble(0);
    this.ball.lastTeam = p.team;
    this.ball.lastTouch = p;
    p.dribbleTouch = 0; // glue dribbling: reset the touch streak on a new possession
    if (p.isKeeper) p.keeperHold = 0;
    if (p.team !== this.possession || prevTeam !== p.team) {
      const changed = p.team !== this.possession;
      this.possession = p.team;
      if (changed) {
        this.possessionClock = this.rules.possessionClock;
        this.stats.possessions++;
        for (const q of this.players) q.ai.lungedFor = null;
        this.events.emit('possession', { team: p.team, player: p });
      }
    }
    if (announce && this.userTeam !== null) {
      if (p.team === this.userTeam && !p.isKeeper) {
        if (this.controlled) this.controlled.controlled = false;
        this.controlled = p;
        p.controlled = true;
      } else if (p.team !== this.userTeam) {
        this.autoSelectControlled();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Main step
  // ---------------------------------------------------------------------------

  step(rawDt) {
    if (this.state === 'over') return;
    // Impact hitstop. A landed tackle or big hit freezes the pool for a beat of REAL time: the
    // match clock, the ball and every swimmer all stop, which is what gives contact its weight.
    if (this.freeze > 0) {
      this.freeze -= rawDt;
      if (this.freeze <= 0) this.freeze = 0;
      return;
    }
    let dt = rawDt;
    if (this.slowmo > 0) {
      this.slowmo -= rawDt;
      dt = rawDt * this.timeScale;
    } else this.timeScale = 1;
    this.time += dt;
    if (this.userPlayTimer > 0) this.userPlayTimer -= dt;
    if (this.keeperSwitchCd > 0) this.keeperSwitchCd -= dt;
    if (this.callPassTimer > 0) this.callPassTimer -= dt;
    // FLOW countdown ticks once per sim step (not once per player — that drained it 7x too fast).
    for (const t of [0, 1]) {
      if (!this.flow[t]) continue;
      this.flowTimer[t] -= dt;
      if (this.flowTimer[t] <= 0) {
        // Rest at exactly zero. Repeatedly subtracting dt can leave the countdown a hair
        // negative, and the FLOW chip renders that value — a timer counting up from -0.01.
        this.flowTimer[t] = 0;
        this.flow[t] = false;
        this.events.emit('flowend', { team: t });
      }
    }
    for (const p of this.players) this.tickCooldowns(p, dt);
    if (this.ball.releaseCooldown) {
      this.ball.releaseCooldown.t -= dt;
      if (this.ball.releaseCooldown.t <= 0) this.ball.releaseCooldown = null;
    }
    if (this.ball.wallCooldown > 0) this.ball.wallCooldown -= dt;

    switch (this.state) {
      case 'reset':
        this.stateTimer -= dt;
        for (const p of this.players) p.anim.t += dt;
        if (this.subWindow > 0) this.subWindow -= dt;
        if (this.stateTimer <= 0) {
          this.state = 'live';
          this.clearGbShield();
          this.events.emit('live', { possession: this.possession, half: this.half });
        }
        break;
      case 'warmup':
        this.stepWarmup(dt);
        break;
      case 'tipoff':
        this.stepTipoff(dt);
        break;
      case 'live':
        this.stepLive(dt);
        break;
      case 'dead':
        this.stateTimer -= dt;
        if (this.subWindow > 0) this.subWindow -= dt;
        for (const p of this.players) this.updatePlayerPhysics(p, dt, true);
        this.updateBall(dt, true);
        if (this.stateTimer <= 0) {
          if (this.pendingGameOver !== null) return this.finishGame(this.pendingGameOver);
          if (this.pendingHalftime) {
            this.pendingHalftime = false;
            this.state = 'halftime';
            this.stateTimer = this.rules.halftimeDuration;
            // Bank the opening half so the montage can show the split, not just the running total.
            this.halfScore[0][0] = this.score[0];
            this.halfScore[1][0] = this.score[1];
            this.events.emit('halftime', { score: [...this.score] });
            return;
          }
          this.resetPossession(this.pendingPossession, this.deadReason);
        }
        break;
      case 'halftime':
        this.stateTimer -= dt;
        for (const p of this.players) p.anim.t += dt;
        // The break is the best substitution window in the match: everyone is tired and the clock
        // is stopped, so both coaches get to make their changes here.
        if (this.subWindow > 0) this.subWindow -= dt;
        if (this.stateTimer <= 0) {
          this.half = 2;
          this.clock = this.rules.halfLength;
          this.openSubWindow(this.userTeam);
          this.resetPossession(1 - this.kickoffTeam, 'halftime');
        }
        break;
      case 'gamebreaker':
        this.stepGamebreaker(dt);
        break;
      default:
        break;
    }
  }

  tickCooldowns(p, dt) {
    for (const k in p.cd) if (p.cd[k] > 0) p.cd[k] -= dt;
    if (p.diveT > 0) p.diveT = Math.max(0, p.diveT - dt);
    if (p.diveCommit > 0) p.diveCommit = Math.max(0, p.diveCommit - dt);
    if (p.ai.diving > 0) p.ai.diving = Math.max(0, p.ai.diving - dt); // lunge window (pickup bonus)
    if (p.comboTimer > 0) {
      p.comboTimer -= dt;
      if (p.comboTimer <= 0) p.combo = 0;
    }
    p.anim.t += dt;
  }

  stepLive(dt) {
    // Clock
    if (!this.overtime) {
      this.clock -= dt;
      if (this.clock <= 0) {
        this.clock = 0;
        return this.endOfHalf();
      }
    } else this.otTime += dt;

    // 1. Inputs
    for (const p of this.players) {
      if (this.userTeam !== null && p === this.controlled) copyInput(p.input, this.userInput);
      else updateAI(this, p, dt);
    }
    // 2. Actions
    for (const p of this.players) this.processInput(p);
    // 3. Physics
    for (const p of this.players) this.updatePlayerPhysics(p, dt, false);
    this.separatePlayers();
    this.updateBall(dt, false);
    // 4. Rules
    this.updateRules(dt);
    // Consume one-shot flags
    const u = this.userInput;
    u.shootPressed = false;
    u.shootReleased = false;
    u.pass = false;
    u.trick = false;
    u.hit = false;
    u.breach = false;
    u.switchPlayer = false;
    u.gamebreaker = false;
    u.cage = false;
  }

  endOfHalf() {
    if (this.half === 1) {
      this.state = 'dead';
      this.stateTimer = 1.2;
      this.pendingHalftime = true;
      this.deadReason = 'halftime';
      this.events.emit('horn', { half: 1 });
      return;
    }
    // Full time
    if (this.score[0] !== this.score[1]) {
      this.events.emit('horn', { half: 2 });
      return this.finishGame(this.score[0] > this.score[1] ? 0 : 1);
    }
    // Overtime: golden goal
    this.overtime = true;
    this.otTime = 0;
    this.state = 'dead';
    this.stateTimer = 1.4;
    this.deadReason = 'kickoff';
    this.pendingPossession = this.rng.chance(0.5) ? 0 : 1;
    this.events.emit('overtime', {});
  }

  // ---------------------------------------------------------------------------
  // Input → actions
  // ---------------------------------------------------------------------------

  processInput(p) {
    const inp = p.input;
    if (inp.switchPlayer && this.isUser(p)) this.switchControlled();
    // Taking the cage is its own button, not a mode: one press in, one press out (the SWAP
    // button leaves it), so it can be a mid-play read rather than a commitment.
    if (inp.cage && this.isUser(p)) {
      if (this.inCage) this.leaveCage();
      else this.takeCage();
      inp.cage = false;
    }
    // In the box the dive replaces everything else: it is the only verb a keeper has.
    if (this.inCage && this.isUser(p) && p.isKeeper) {
      if (inp.breach || inp.shootPressed || inp.trick) {
        this.keeperDive(p, { z: inp.moveZ, x: inp.moveX });
        inp.breach = false;
        inp.shootPressed = false;
        inp.trick = false;
      }
      // A keeper under the user's control releases on PASS like any carrier; the hold clock and
      // the 4-second rule still apply, because the rules do not care who is holding the ball.
      if (this.ball.holder === p && inp.pass && this.canAct(p)) this.tryPass(p, null, inp.turbo);
      inp.pass = false;
      inp.hit = false;
      return;
    }
    // Playbook: digits 1-3 call offense plays, 7-9 defense plays (user team only, small cooldown
    // so key mashing can't machine-gun commentary banners).
    if (inp.playcall && this.isUser(p) && this.userPlayTimer <= 0 && (this.state === 'live' || this.state === 'gamebreaker')) {
      const offense = inp.playcall < 5;
      const play = this.callPlay(offense ? 'offense' : 'defense', offense ? inp.playcall - 1 : inp.playcall - 7);
      if (play) this.userPlayTimer = 0.4;
    }
    inp.playcall = 0;
    if (p.state === 'fallen' || p.state === 'stumble' || p.state === 'reel' || p.state === 'commit' || p.stun > 0) return;

    const isCarrier = this.ball.holder === p;
    if (isCarrier) {
      // The SHOOT input doubles as the Gamebreaker trigger while a meter is ready — the touch pad
      // lights the button up for exactly this, and the keyboard E still works as a dedicated key.
      if (inp.shootPressed && this.canAct(p) && this.gbReady[p.team] && this.state === 'live') {
        if (this.tryGamebreaker(p)) return;
      }
      if (inp.gamebreaker && this.gbReady[p.team] && !p.isKeeper) {
        if (this.tryGamebreaker(p)) return;
      }
      if (inp.shootPressed && this.canAct(p)) this.tryShoot(p);
      if (inp.shootReleased && p.state === 'shoot' && p.shot && !p.shot.released) this.releaseShot(p);
      if (inp.pass && this.canAct(p)) {
        const called = this.callPassTarget(p);
        this.tryPass(p, called, inp.turbo);
      }
      if (inp.trick && this.canAct(p) && p.cd.trick <= 0 && !p.isKeeper) {
        const dir = inp.jukeDir
          ? new Vec3(inp.jukeDir.x, 0, inp.jukeDir.y)
          : new Vec3(inp.moveX, 0, inp.moveZ);
        this.tryTrick(p, dir.length() > 0.2 ? dir.normalize() : null, inp.turbo);
      }
      if (inp.hit && this.canAct(p) && p.cd.hit <= 0 && !p.isKeeper) this.tryHit(p);
    } else {
      if (inp.breach && this.canAct(p) && p.cd.breach <= 0) this.tryBreach(p);
      if (inp.trick && this.canAct(p) && p.cd.tackle <= 0) this.tryTackle(p); // poke/slide tackle (Rematch-style)
      if (inp.hit && this.canAct(p) && p.cd.hit <= 0 && !p.isKeeper) this.tryHit(p);
      if (inp.pass && this.canAct(p) && this.ball.holder !== p && !p.isKeeper) {
        // Call for the pass: flag the nearest supporting teammate so the carrier's next pass
        // releases to them. On offense this doubles as the give-and-go trigger — the flagged
        // mate cuts on the call, sprinting into open water so the feed leads them past the
        // last defender — and the caller keeps a pass-and-move cut of their own so the return
        // feed (or a later switch) finds them running at the ring.
        const onOffense = this.ball.holder && this.ball.holder.team === p.team && p.team === this.possession;
        const best = [...this.teammatesOf(p)].filter((q) => q !== this.ball.holder && !q.isKeeper && q.state !== 'fallen').sort((a, b) => a.pos.distanceToXZ(p.pos) - b.pos.distanceToXZ(p.pos))[0];
        if (best) {
          for (const q of this.outfield(p.team)) q.callingForPass = q === best;
          this.callPassTimer = 1.2;
          if (onOffense && !best.ai.cutting) {
            best.ai.cutting = true;
            best.ai.cutTimer = 1.6;
            this.events.emit('givego', { player: best });
          }
          this.events.emit('callpass', { player: p, target: best });
        }
        if (onOffense && !p.ai.cutting) {
          p.ai.cutting = true;
          p.ai.cutTimer = 1.4;
        }
      }
      if (inp.shootPressed && this.canAct(p) && !p.isKeeper) {
        // Volley attempt on a loose ball in the air / or a breach to block
        if (!this.tryVolley(p)) this.tryBreach(p);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Movement / physics
  // ---------------------------------------------------------------------------

  updatePlayerPhysics(p, dt, deadBall) { return movement.updatePlayerPhysics(this, p, dt, deadBall); }

  constrainPlayer(p) { return movement.constrainPlayer(this, p); }

  /** Rematch-style glue dribbling (see ./movement.js). */
  updateGlueDribble(dt) { return movement.updateGlueDribble(this, dt); }

  separatePlayers() { return movement.separatePlayers(this); }

  /**
   * The pool is never dead water: a slow gyre around the bowl plus a lazy cross-pool surge
   * nudges anything drifting (mostly a loose ball). A pure function of sim time and position, so
   * the current is identical on every run of a seed — the match stays deterministic.
   */
  currentAt(x, z) {
    const t = this.time * PHYS.driftRate;
    return {
      x:
        PHYS.drift *
        ((-z / ARENA.ballRadius) * Math.sin(t * 0.31) +
          Math.sin(t * 0.17 + z * 0.2)),
      z:
        PHYS.drift *
        ((x / ARENA.ballRadius) * Math.sin(t * 0.31) +
          Math.cos(t * 0.13 + x * 0.2)),
    };
  }

  // ---------------------------------------------------------------------------
  // Tricks / tackles / hits / breaches (see ./combat.js)
  // ---------------------------------------------------------------------------
  tryTrick(player, dir, turbo) { return combat.tryTrick(this, player, dir, turbo); }
  stepMove(player) { return combat.stepMove(this, player); }
  finishTrick(player) { return combat.finishTrick(this, player); }
  tryTackle(player) { return combat.tryTackle(this, player); }
  tryHit(player) { return combat.tryHit(this, player); }
  knockDown(victim, by, reason, state) { return combat.knockDown(this, victim, by, reason, state); }
  tryBreach(player) { return combat.tryBreach(this, player); }

  // ---------------------------------------------------------------------------
  // Passing (see ./passing.js)
  // ---------------------------------------------------------------------------
  choosePassTarget(player, lob) { return passing.choosePassTarget(this, player, lob); }
  tryPass(player, targetOverride, lob) { return passing.tryPass(this, player, targetOverride, lob); }
  gradePass(flight, receiver) { return passing.gradePass(this, flight, receiver); }
  // ---------------------------------------------------------------------------
  // Shooting / volleys / Gamebreaker (see ./shooting.js)
  // ---------------------------------------------------------------------------
  tryShoot(player) { return shooting.tryShoot(this, player); }
  keeperThrow(player) { return shooting.keeperThrow(this, player); }
  releaseShot(player) { return shooting.releaseShot(this, player); }
  fireShot(player, quality, opts = {}) { return shooting.fireShot(this, player, quality, opts); }
  tryVolley(player) { return shooting.tryVolley(this, player); }
  tryGamebreaker(player) { return shooting.tryGamebreaker(this, player); }
  clearGbShield() { return shooting.clearGbShield(this); }
  startGbDrive(player) { return shooting.startGbDrive(this, player); }
  stepGamebreaker(dt) { return shooting.stepGamebreaker(this, dt); }
  gbShoot(player) { return shooting.gbShoot(this, player); }
  // ---------------------------------------------------------------------------
  // Ball
  // ---------------------------------------------------------------------------

  releaseLoose(from, velocity) { return ballMod.releaseLoose(this, from, velocity); }
  updateBall(dt, deadBall) { return ballMod.updateBall(this, dt, deadBall); }
  bounceBall(ball, flight) { return ballMod.bounceBall(this, ball, flight); }
  integrateLoose(ball, dt) { return ballMod.integrateLoose(this, ball, dt); }
  checkGoalCrossing(previous, current) { return ballMod.checkGoalCrossing(this, previous, current); }
  ringRattle(team) { return ballMod.ringRattle(this, team); }
  checkKeeperSave() { return ballMod.checkKeeperSave(this); }
  checkBlocks() { return ballMod.checkBlocks(this); }
  checkInterceptions() { return ballMod.checkInterceptions(this); }
  checkPickup() { return ballMod.checkPickup(this); }

  startFlow(team, player) { return rulesMod.startFlow(this, team, player); }
  updateRules(dt) { return rulesMod.updateRules(this, dt); }
  turnover(team, reason) { return rulesMod.turnover(this, team, reason); }
  callFoul(offender, victim, impact, kind, victimWasDown = false) { return rulesMod.callFoul(this, offender, victim, impact, kind, victimWasDown); }
  isFoul(offender, victim, impact, victimWasDown = false) { return rulesMod.isFoul(this, offender, victim, impact, victimWasDown); }
  sendOffPlayer(player) { return rulesMod.sendOffPlayer(this, player); }
  addStyle(player, base, label, options = {}) { return rulesMod.addStyle(this, player, base, label, options); }
  loseStyle(team, amount) { return rulesMod.loseStyle(this, team, amount); }
  scoreGoal(player, flight, ownGoal = false) { return rulesMod.scoreGoal(this, player, flight, ownGoal); }
  checkGameOver(deferReset = false) { return rulesMod.checkGameOver(this, deferReset); }
  finishGame(winner) { return rulesMod.finishGame(this, winner); }

  snapshot() {
    return {
      t: +this.time.toFixed(2),
      state: this.state,
      half: this.half,
      clock: +this.clock.toFixed(1),
      score: [...this.score],
      gb: this.gb.map((value) =>
        Math.round(value)
      ),
      poss: this.possession,
      pclock: +this.possessionClock.toFixed(1),
      holder: this.ball.holder
        ? this.ball.holder.id
        : null,
      flight: this.ball.flight
        ? this.ball.flight.kind
        : null,
      ball: [
        +this.ball.pos.x.toFixed(2),
        +this.ball.pos.y.toFixed(2),
        +this.ball.pos.z.toFixed(2),
      ],
      ot: this.overtime,
    };
  }
}
