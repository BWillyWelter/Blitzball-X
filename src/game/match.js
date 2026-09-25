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
    for (const p of this.players) {
      p.vel.set(0, 0, 0);
      p.y = 0;
      p.vy = 0;
      p.airborne = false;
      p.stun = 0;
      p.shot = null;
      p.trick = null;
      p.hasBall = false;
      p.callingForPass = false;
      p.turbo = Math.max(p.turbo, 45);
      p.turboActive = false;
      this.setState(p, 'idle');
      p.ai = { ...p.ai, cutting: false, cutTimer: 0, target: null, lungedFor: null };
    }
    this.callPassTimer = 0; // stale "I'm open" flags must not survive a possession reset
    this.placeFormation(team, reason);
    this.stats.possessions++;
    this.events.emit('reset', { team, reason });
    if (this.userTeam !== null) this.autoSelectControlled();
  }

  placeFormation(possTeam, reason) {
    for (let t = 0; t < 2; t++) {
      const dir = this.attackDir(t);
      const out = this.outfield(t);
      const gk = this.keeperOf(t);
      const own = -ARENA.goalX * dir;
      // Keeper in front of own goal
      gk.pos.set(own + dir * 0.9, 0, 0);
      gk.facing = Math.atan2(dir, 0);
      if (reason === 'kickoff' || reason === 'goal' || reason === 'halftime') {
        // Centre face-off, with the match's seeded opening shape varying the carrier and support
        // lanes. Non-possession swimmers mirror the same shape so the defensive matchup is fair.
        const mine = t === possTeam;
        const shape = KICKOFF_FORMATIONS[this.kickoffPattern];
        const carrier = mine ? shape.carrier : [-3.6, 0];
        const support = mine ? shape.support : [[-4.2, 3.2], [-4.2, -3.2]];
        out[0].pos.set(dir * carrier[0], 0, carrier[1]);
        out[1].pos.set(dir * support[0][0], 0, support[0][1]);
        out[2].pos.set(dir * support[1][0], 0, support[1][1]);
      } else {
        // Turnover-style restart: give ball to the keeper of the possession team.
        out[0].pos.set(-dir * 2.5, 0, 0);
        out[1].pos.set(-dir * 5.5, 0, 3.0);
        out[2].pos.set(-dir * 5.5, 0, -3.0);
      }
      for (const p of out) p.facing = Math.atan2(dir, 0);
    }
    const carrier = reason === 'kickoff' || reason === 'goal' || reason === 'halftime' ? this.outfield(possTeam)[0] : this.keeperOf(possTeam);
    this.giveBall(carrier, false);
  }

  autoSelectControlled() {
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
    this.keeperOf(this.userTeam).controlled = false;
    this.controlled = pick;
    pick.controlled = true;
  }

  switchControlled() {
    if (this.userTeam === null) return;
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

  /** Movement input as a world-space direction (Rematch-style aiming axis), or null if neutral. */
  aimInputDir() {
    const inp = this.userInput;
    if (!inp || (inp.moveX === 0 && inp.moveZ === 0)) return null;
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
    p.hasBall = true;
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
    let dt = rawDt;
    if (this.slowmo > 0) {
      this.slowmo -= rawDt;
      dt = rawDt * this.timeScale;
    } else this.timeScale = 1;
    this.time += dt;
    if (this.userPlayTimer > 0) this.userPlayTimer -= dt;
    if (this.callPassTimer > 0) this.callPassTimer -= dt;
    // FLOW countdown ticks once per sim step (not once per player — that drained it 7x too fast).
    for (const t of [0, 1]) {
      if (!this.flow[t]) continue;
      this.flowTimer[t] -= dt;
      if (this.flowTimer[t] <= 0) {
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
        if (this.stateTimer <= 0) {
          this.state = 'live';
          this.clearGbShield();
          this.events.emit('live', { possession: this.possession, half: this.half });
        }
        break;
      case 'live':
        this.stepLive(dt);
        break;
      case 'dead':
        this.stateTimer -= dt;
        for (const p of this.players) this.updatePlayerPhysics(p, dt, true);
        this.updateBall(dt, true);
        if (this.stateTimer <= 0) {
          if (this.pendingGameOver !== null) return this.finishGame(this.pendingGameOver);
          if (this.pendingHalftime) {
            this.pendingHalftime = false;
            this.state = 'halftime';
            this.stateTimer = this.rules.halftimeDuration;
            this.events.emit('halftime', { score: [...this.score] });
            return;
          }
          this.resetPossession(this.pendingPossession, this.deadReason);
        }
        break;
      case 'halftime':
        this.stateTimer -= dt;
        for (const p of this.players) p.anim.t += dt;
        if (this.stateTimer <= 0) {
          this.half = 2;
          this.clock = this.rules.halfLength;
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
    for (const p of this.players) this.processInput(p, dt);
    // 3. Physics
    for (const p of this.players) this.updatePlayerPhysics(p, dt, false);
    this.separatePlayers();
    this.updateBall(dt, false);
    this.updateGlueDribble(dt); // Rematch-style: the ball rides at the carrier's feet
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

  processInput(p, dt) {
    const inp = p.input;
    if (inp.switchPlayer && this.isUser(p)) this.switchControlled();
    // Playbook: digits 1-3 call offense plays, 7-9 defense plays (user team only, small cooldown
    // so key mashing can't machine-gun commentary banners).
    if (inp.playcall && this.isUser(p) && this.userPlayTimer <= 0 && (this.state === 'live' || this.state === 'gamebreaker')) {
      const offense = inp.playcall < 5;
      const play = this.callPlay(offense ? 'offense' : 'defense', offense ? inp.playcall - 1 : inp.playcall - 7);
      if (play) this.userPlayTimer = 0.4;
    }
    inp.playcall = 0;
    if (p.state === 'fallen' || p.state === 'stumble' || p.stun > 0) return;

    const isCarrier = this.ball.holder === p;
    if (isCarrier) {
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
        const dir = new Vec3(inp.moveX, 0, inp.moveZ);
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

  // ---------------------------------------------------------------------------
  // Tricks / tackles / hits / breaches (see ./combat.js)
  // ---------------------------------------------------------------------------
  tryTrick(player, dir, turbo) { return combat.tryTrick(this, player, dir, turbo); }
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
