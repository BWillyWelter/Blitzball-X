import { Vec3, clamp, lerp } from '../core/vec3.js';
import { RNG } from '../core/rng.js';
import { EventBus } from '../core/events.js';
import { ARENA, RULES, PHYS, MOVE, ACTION, STYLE, DIFFICULTY } from '../data/constants.js';
import { OFFENSE_PLAYS, DEFENSE_PLAYS } from '../data/plays.js';
import { createPlayer, createBall, emptyInput, copyInput } from './entities.js';
import { starters } from '../data/teams.js';
import * as shooting from './shooting.js';
import * as ballMod from './ball.js';
import * as rulesMod from './rules.js';
import { updateAI } from './ai.js';

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

export const TRICKS = [
  { id: 0, name: 'SPIN', dur: 0.42, dist: 1.6, washRange: 1.5, turbo: false },
  { id: 1, name: 'BARREL ROLL', dur: 0.48, dist: 2.0, washRange: 1.7, turbo: false },
  { id: 2, name: 'DOLPHIN KICK', dur: 0.5, dist: 2.4, washRange: 1.6, turbo: true, vertical: true },
  { id: 3, name: 'CORKSCREW', dur: 0.55, dist: 2.6, washRange: 1.9, turbo: true },
  { id: 4, name: 'BACK-FLIP FEINT', dur: 0.46, dist: 1.4, washRange: 2.0, turbo: false },
  { id: 5, name: 'JET STREAM', dur: 0.6, dist: 3.2, washRange: 2.1, turbo: true },
];


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
      p.turbo = Math.max(p.turbo, 45);
      p.turboActive = false;
      this.setState(p, 'idle');
      p.ai = { ...p.ai, cutting: false, cutTimer: 0, target: null, lungedFor: null };
    }
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
        // Centre "face-off": possession team's striker at centre with the ball, others spread.
        const mine = t === possTeam;
        out[0].pos.set(mine ? -dir * 0.4 : -dir * 3.6, 0, 0);
        out[1].pos.set(-dir * 4.2, 0, 3.2);
        out[2].pos.set(-dir * 4.2, 0, -3.2);
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
        // Call for the pass: flag the nearest supporting teammate so the carrier's next K
        // releases to them.
        const best = [...this.teammatesOf(p)].filter((q) => q !== this.ball.holder && !q.isKeeper && q.state !== 'fallen').sort((a, b) => a.pos.distanceToXZ(p.pos) - b.pos.distanceToXZ(p.pos))[0];
        if (best) {
          for (const q of this.outfield(p.team)) q.callingForPass = q === best;
          this.callPassTimer = 1.2;
          this.events.emit('callpass', { player: p, target: best });
        }
      }
      if (inp.shootPressed && this.canAct(p) && !p.isKeeper) {
        // Volley attempt on a loose ball in the air / or a breach to block
        if (!this.tryVolley(p)) this.tryBreach(p);
      }
      if (inp.pass && this.canAct(p) && p.team === this.possession && this.ball.holder && this.ball.holder.team === p.team) {
        p.ai.cutting = true;
        p.ai.cutTimer = 1.4;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Movement / physics
  // ---------------------------------------------------------------------------

  updatePlayerPhysics(p, dt, deadBall) {
    p.stateTime += dt;
    if (p.stun > 0) p.stun -= dt;
    const inp = p.input;
    const isCarrier = this.ball.holder === p;

    // Turbo (defensive fatigue: press costs more stamina, zone recovers some)
    const wantsTurbo = !deadBall && inp.turbo && (inp.moveX !== 0 || inp.moveZ !== 0) && p.turbo > MOVE.turboMin && (p.state === 'swim' || p.state === 'idle');
    p.turboActive = wantsTurbo;
    const endur = 0.7 + (p.data.end / 99) * 0.6;
    const onDefense = this.possession !== p.team;
    const fatigue = onDefense ? this.defenseMods(p.team).fatigue || 1 : 1;
    // FLOW: sprinting costs nothing while the zone is live.
    if (p.turboActive && !this.flow[p.team]) p.turbo = Math.max(0, p.turbo - ((MOVE.turboDrain / endur) * fatigue) * dt);
    else p.turbo = Math.min(100, p.turbo + (MOVE.turboRegen * endur / fatigue) * dt);
    // FLOW: tight window, empowered movement, no turbo cost while it lasts (timer lives in step()).

    // Locomotion
    let maxSpeed = (p.isKeeper ? MOVE.keeperSpeed : MOVE.maxSpeed) * (0.82 + (p.data.spd / 99) * 0.36);
    if (p.turboActive) maxSpeed *= MOVE.turboMult;
    if (isCarrier) maxSpeed *= MOVE.carrierMult * (this.offensePlayOf(p.team).speed || 1);
    const canMove = !deadBall && p.stun <= 0 && (p.state === 'idle' || p.state === 'swim' || p.state === 'catch' || p.state === 'shoot' && p.shot && !p.shot.released && p.shot.kind !== 'volley');
    if (p.state === 'trick' && p.trick) {
      // scripted trick motion
      const tr = p.trick;
      const u = clamp(p.stateTime / tr.def.dur, 0, 1);
      const speed = (tr.def.dist / tr.def.dur) * (1 - u * 0.6) * (tr.turbo ? 1.25 : 1);
      p.vel.set(tr.dir.x * speed, 0, tr.dir.z * speed);
      if (tr.def.vertical) p.y = Math.sin(u * Math.PI) * 0.9;
    } else if (p.state === 'gbdrive' && p.gbTarget) {
      const dir = Vec3.dirXZ(p.pos, p.gbTarget);
      p.vel.set(dir.x * ACTION.gbDriveSpeed, 0, dir.z * ACTION.gbDriveSpeed);
      p.facing = Math.atan2(dir.x, dir.z);
    } else if (canMove && (inp.moveX !== 0 || inp.moveZ !== 0)) {
      const accel = MOVE.accel * (0.8 + (p.data.spd / 99) * 0.4);
      const flowBoost = this.flow[p.team] ? 1.12 : 1;
      const tx = inp.moveX * maxSpeed * flowBoost;
      const tz = inp.moveZ * maxSpeed * flowBoost;
      p.vel.x += (tx - p.vel.x) * Math.min(1, accel * dt / maxSpeed * 1.4);
      p.vel.z += (tz - p.vel.z) * Math.min(1, accel * dt / maxSpeed * 1.4);
      const target = Math.atan2(inp.moveX, inp.moveZ);
      p.facing = turnToward(p.facing, target, dt * 11);
      if (p.state === 'idle') this.setState(p, 'swim');
    } else {
      const dec = p.state === 'fallen' ? 2.5 : MOVE.decel;
      const k = Math.max(0, 1 - dec * dt);
      p.vel.x *= k;
      p.vel.z *= k;
      if (p.state === 'swim' && p.vel.lengthXZ() < 0.3) this.setState(p, 'idle');
    }

    // Vertical (breach)
    if (p.airborne) {
      p.vy += PHYS.gravityPlayer * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        p.airborne = false;
        if (p.state === 'breach' || p.state === 'volley') this.setState(p, 'idle');
        this.events.emit('splash', { player: p, pos: p.pos.clone(), size: 0.6 });
      }
    } else if (p.state !== 'trick') {
      p.y *= Math.max(0, 1 - dt * 6);
    }

    // Integrate
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    this.constrainPlayer(p);
    p.speedNorm = clamp(p.vel.lengthXZ() / (MOVE.maxSpeed * MOVE.turboMult), 0, 1);

    // State timeouts
    if (p.stateDur > 0 && p.stateTime >= p.stateDur) {
      switch (p.state) {
        case 'trick':
          this.finishTrick(p);
          break;
        case 'shoot':
          if (p.shot && !p.shot.released) this.releaseShot(p);
          else this.setState(p, 'idle');
          break;
        case 'gbwind':
          this.startGbDrive(p);
          break;
        case 'gbdrive':
          this.gbShoot(p);
          break;
        case 'fallen':
        case 'stumble':
        case 'tackle':
        case 'hit':
        case 'catch':
        case 'pass':
        case 'celebrate':
        case 'save':
        case 'volley':
          this.setState(p, 'idle');
          break;
        default:
          break;
      }
    }
  }

  constrainPlayer(p) {
    const dir = this.attackDir(p.team);
    if (p.isKeeper) {
      // Keeper stays in its box in front of its own goal.
      const own = -ARENA.goalX * dir;
      const inner = own + dir * (ARENA.goalX - ARENA.keeperMinX); // toward centre
      const outer = own + dir * (ARENA.goalX - ARENA.keeperMaxX);
      const lo = Math.min(inner, outer);
      const hi = Math.max(inner, outer);
      p.pos.x = clamp(p.pos.x, lo, hi);
      p.pos.z = clamp(p.pos.z, -ARENA.keeperMaxZ, ARENA.keeperMaxZ);
      return;
    }
    const r = p.pos.lengthXZ();
    if (r > ARENA.fieldRadius) {
      const s = ARENA.fieldRadius / r;
      p.pos.x *= s;
      p.pos.z *= s;
      // slide along the wall
      const nx = p.pos.x / ARENA.fieldRadius;
      const nz = p.pos.z / ARENA.fieldRadius;
      const vn = p.vel.x * nx + p.vel.z * nz;
      if (vn > 0) {
        p.vel.x -= vn * nx;
        p.vel.z -= vn * nz;
      }
    }
    // Cannot swim through either goal mouth
    for (const gx of [ARENA.goalX, -ARENA.goalX]) {
      if (Math.abs(p.pos.x) > ARENA.playerMaxX && Math.abs(p.pos.z) < ARENA.goalRadius + 0.4 && Math.sign(p.pos.x) === Math.sign(gx)) {
        p.pos.x = Math.sign(gx) * ARENA.playerMaxX;
        if (Math.sign(p.vel.x) === Math.sign(gx)) p.vel.x = 0;
      }
    }
  }

  /**
   * Rematch-style glue dribbling: the ball rides just ahead of the carrier's feet and is only
   * released by shooting, passing, or being poke/slide-tackled. A touch counter drives style;
   * a FLOW carrier can't be poked at all.
   */
  updateGlueDribble(dt) {
    const holder = this.ball.holder;
    if (!holder) return;
    const f = this.forwardOf(holder);
    const ahead = 0.55 + Math.min(0.5, holder.vel.lengthXZ() * 0.09);
    this.ball.pos.x = holder.pos.x + f.x * ahead;
    this.ball.pos.z = holder.pos.z + f.z * ahead;
    this.ball.pos.y = 0.5 + Math.sin(this.time * 9) * 0.06;
    this.ball.vel.set(holder.vel.x, 0, holder.vel.z);
    holder.dribbleTouch += dt;
  }

  separatePlayers() {
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.players[i];
        const b = this.players[j];
        if (a.airborne !== b.airborne && Math.abs(a.y - b.y) > 0.9) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const min = MOVE.separation;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          const nx = dx / d;
          const nz = dz / d;
          const wa = a.state === 'fallen' || a.isKeeper ? 0 : 1;
          const wb = b.state === 'fallen' || b.isKeeper ? 0 : 1;
          const tot = wa + wb || 1;
          a.pos.x -= nx * push * 2 * (wa / tot);
          a.pos.z -= nz * push * 2 * (wa / tot);
          b.pos.x += nx * push * 2 * (wb / tot);
          b.pos.z += nz * push * 2 * (wb / tot);
        }
      }
    }
    for (const p of this.players) this.constrainPlayer(p);
  }

  // ---------------------------------------------------------------------------
  // Tricks (washing defenders)
  // ---------------------------------------------------------------------------

  tryTrick(p, dir, turbo) {
    const useTurbo = turbo && p.turbo > 15;
    const pool = TRICKS.filter((t) => !!t.turbo === !!useTurbo);
    // Avoid repeating the same trick.
    let def = this.rng.pick(pool);
    if (pool.length > 1 && def.id === p.lastTrickId) def = pool[(pool.indexOf(def) + 1) % pool.length];
    p.lastTrickId = def.id;
    const d = dir || this.forwardOf(p);
    p.trick = { def, dir: d, turbo: useTurbo, washed: new Set() };
    if (useTurbo) p.turbo = Math.max(0, p.turbo - 18);
    p.cd.trick = ACTION.trickCooldown + def.dur;
    p.facing = Math.atan2(d.x, d.z);
    this.setState(p, 'trick', def.dur);
    this.stats.tricks++;
    this.events.emit('trick', { player: p, name: def.name, turbo: useTurbo });
    // Wash check: defenders in range that are facing us get spun / knocked off.
    for (const q of this.opponentsOf(p)) {
      if (q.isKeeper || q.state === 'fallen') continue;
      const dist = q.pos.distanceToXZ(p.pos);
      if (dist > def.washRange) continue;
      const toMe = Vec3.dirXZ(q.pos, p.pos);
      const facingMe = this.forwardOf(q).dot(toMe) > 0.2;
      const closing = q.state === 'tackle' || q.state === 'swim';
      let prob = 0.12 + ((p.data.hnd - q.data.tkl) / 99) * 0.35 + (useTurbo ? 0.18 : 0) + (q.state === 'tackle' ? 0.35 : 0);
      if (!facingMe) prob *= 0.5;
      if (!closing) prob *= 0.7;
      if (this.isUser(p)) prob *= this.difficulty.userBonus;
      prob = clamp(prob, 0.03, 0.75);
      if (this.rng.chance(prob)) {
        p.trick.washed.add(q.id);
        this.knockDown(q, p, 'washed', q.state === 'tackle' ? 'fallen' : 'stumble');
        p.stats.washed++;
        this.addStyle(p, STYLE.washed, 'WASHED!', { big: true });
        this.events.emit('washed', { player: p, victim: q, name: def.name });
      }
    }
    this.addStyle(p, STYLE.trick + (useTurbo ? STYLE.trickTurbo : 0), def.name);
    return true;
  }

  finishTrick(p) {
    p.trick = null;
    this.setState(p, 'swim');
  }

  // ---------------------------------------------------------------------------
  // Tackles / hits / breaches
  // ---------------------------------------------------------------------------

  tryTackle(p) {
    const carrier = this.ball.holder;
    p.cd.tackle = ACTION.tackleCooldown;
    this.setState(p, 'tackle', 0.4);
    // lunge forward
    const f = this.forwardOf(p);
    p.vel.x += f.x * 3.2;
    p.vel.z += f.z * 3.2;
    this.events.emit('tackleattempt', { player: p });
    if (!carrier || carrier.team === p.team) {
      p.ai.diving = 0.3;
      return false;
    }
    if (carrier.isKeeper) return false;
    const d = p.pos.distanceToXZ(carrier.pos);
    if (d > ACTION.tackleRange) return false;
    if (carrier.airborne || carrier.state === 'shoot' && carrier.shot && carrier.shot.released) return false;
    // A live Gamebreaker drive is untackleable — the payoff moment shouldn't end in a fumble.
    if (carrier === this.gbPlayer && this.gbDriveShield) return false;
    const facing = f.dot(Vec3.dirXZ(p.pos, carrier.pos)) > 0.1;
    if (!facing) return false;
    let prob = 0.22 + ((p.data.tkl - carrier.data.hnd) / 99) * 0.35;
    // Glue dribbling means the ball is shielded at the carrier's feet — tackles are the whole
    // contest now, so the base window is friendlier (FIFA/Rematch-style poke-and-slide).
    prob *= 1.25;
    // FLOW carriers can't be poked — beat them with position, not buttons.
    if (this.flow[carrier.team]) return false;
    if (carrier.state === 'trick') prob *= carrier.trick && carrier.trick.turbo ? 0.3 : 0.55;
    if (carrier.state === 'idle' && carrier.stateTime > 1.0) prob += 0.14;
    if (carrier.state === 'pass' || carrier.state === 'shoot') prob += 0.12;
    if (!this.isUser(p)) prob *= this.difficulty.tackleRate * 1.5;
    else prob *= 1.15 * this.difficulty.userBonus;
    if (this.momentum[carrier.team] >= this.rules.onFireGoals) prob *= 0.8;
    prob *= this.rubber[p.team];
    prob *= this.defenseMods(p.team).tackle || 1;
    prob = clamp(prob, 0.05, 0.78);
    if (this.rng.chance(prob)) {
      carrier.stats.to++;
      p.stats.tkl++;
      this.stats.tackles++;
      this.loseStyle(carrier.team, STYLE.lossOnTurnover);
      carrier.trick = null;
      carrier.shot = null;
      this.setState(carrier, 'stumble', MOVE.stumbleDuration * 0.7);
      this.giveBall(p);
      this.setState(p, 'catch', 0.14);
      this.addStyle(p, STYLE.tackle, 'PICKED', { big: true });
      this.events.emit('tackle', { player: p, victim: carrier });
      return true;
    }
    p.stun = ACTION.tackleWhiffRecovery;
    // Beaten by the dribbler: style reward for carrying past pressure (Blue Lock flair).
    // dribbleTouch both throttles and scales this — one award per sustained carry.
    if (carrier.dribbleTouch >= 1.0) {
      carrier.dribbleTouch = 0;
      this.addStyle(carrier, STYLE.dribble, 'DRIBBLE', {});
      this.events.emit('dribble', { player: carrier, beaten: p });
    }
    return false;
  }

  tryHit(p) {
    p.cd.hit = ACTION.hitCooldown;
    this.setState(p, 'hit', 0.42);
    const f = this.forwardOf(p);
    p.vel.x += f.x * 2.6;
    p.vel.z += f.z * 2.6;
    this.events.emit('hitattempt', { player: p });
    let best = null;
    let bd = Infinity;
    for (const q of this.opponentsOf(p)) {
      if (q.isKeeper || q.state === 'fallen' || q.airborne) continue;
      // Shrug off big hits while the Gamebreaker drive is live.
      if (q === this.gbPlayer && this.gbDriveShield) continue;
      const d = q.pos.distanceToXZ(p.pos);
      if (d < ACTION.hitRange && f.dot(Vec3.dirXZ(p.pos, q.pos)) > 0 && d < bd) {
        bd = d;
        best = q;
      }
    }
    if (!best) {
      p.stun = ACTION.hitRecovery;
      return false;
    }
    let prob = 0.45 + ((p.data.pow - best.data.pow) / 99) * 0.5;
    if (best.state === 'trick') prob -= 0.15;
    if (best.state === 'shoot' || best.state === 'pass') prob += 0.15;
    if (!this.isUser(p)) prob *= this.difficulty.hitRate * 1.25;
    prob *= this.rubber[p.team];
    prob = clamp(prob, 0.15, 0.9);
    if (this.rng.chance(prob)) {
      const hadBall = this.ball.holder === best;
      this.knockDown(best, p, 'hit', 'fallen');
      p.stats.hits++;
      this.stats.hits++;
      if (hadBall) {
        // ball pops loose
        best.stats.to++;
        this.loseStyle(best.team, STYLE.lossOnTurnover);
        const dir = Vec3.dirXZ(p.pos, best.pos);
        this.releaseLoose(best, new Vec3(dir.x * 4 + (this.rng.next() - 0.5) * 2, 2.2, dir.z * 4 + (this.rng.next() - 0.5) * 2));
      }
      this.addStyle(p, STYLE.hit, 'BIG HIT', { big: true });
      this.events.emit('bighit', { player: p, victim: best, hadBall });
      return true;
    }
    // bounced off
    p.stun = ACTION.hitRecovery;
    return false;
  }

  knockDown(victim, by, reason, state = 'fallen') {
    victim.shot = null;
    victim.trick = null;
    victim.airborne = false;
    this.setState(victim, state, state === 'fallen' ? MOVE.fallenDuration : MOVE.stumbleDuration);
    const dir = Vec3.dirXZ(by.pos, victim.pos);
    victim.knockDir.copy(dir);
    victim.vel.set(dir.x * (state === 'fallen' ? 3.5 : 1.5), 0, dir.z * (state === 'fallen' ? 3.5 : 1.5));
    this.events.emit('knockdown', { victim, by, reason, state });
  }

  tryBreach(p) {
    p.cd.breach = MOVE.breachCooldown;
    p.airborne = true;
    p.vy = MOVE.breachVel * (0.9 + (p.data.spd / 99) * 0.25);
    this.setState(p, 'breach', 0);
    this.events.emit('breach', { player: p });
    // Block check on shots in flight
    const f = this.ball.flight;
    if (f && (f.kind === 'shot' || f.kind === 'lob') && f.shooter && f.shooter.team !== p.team) {
      p.ai.blockingFlight = f;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Passing
  // ---------------------------------------------------------------------------

  choosePassTarget(p, lob) {
    const mates = this.teammatesOf(p).filter((q) => q.state !== 'fallen' && !q.isKeeper);
    if (!mates.length) return null;
    const inp = p.input;
    const dir = new Vec3(inp.moveX, 0, inp.moveZ);
    const hasDir = dir.length() > 0.3;
    if (hasDir) dir.normalize();
    let best = null;
    let bs = -Infinity;
    for (const q of mates) {
      const d = p.pos.distanceToXZ(q.pos);
      let s = 10 - d * 0.5;
      if (hasDir) s += Vec3.dirXZ(p.pos, q.pos).dot(dir) * 8;
      if (q.ai.cutting) s += 4;
      if (lob && this.distToGoal(q) < 6) s += 3;
      // open?
      for (const o of this.opponentsOf(p)) if (o.pos.distanceToXZ(q.pos) < 1.6) s -= 3;
      if (s > bs) {
        bs = s;
        best = q;
      }
    }
    return best;
  }

  tryPass(p, targetOverride, lob) {
    const target = targetOverride || this.choosePassTarget(p, lob);
    if (!target) return false;
    p.shot = null;
    p.hasBall = false;
    this.ball.holder = null;
    p.lastPassTime = this.time;
    p.facing = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
    this.setState(p, 'pass', 0.25);
    const from = new Vec3(p.pos.x, 0.9 + p.y, p.pos.z);
    const useLob = !!lob && this.distToGoal(target) < ACTION.volleyRange + 2;
    if (useLob) {
      // Lob toward a spot in front of the goal for a breach-volley finish.
      const g = this.goalPos(p.team);
      const dir = Vec3.dirXZ(target.pos, g);
      const to = new Vec3(target.pos.x + dir.x * 1.2, ACTION.lobHeight + 0.6, target.pos.z + dir.z * 1.2);
      const dist = from.distanceTo(to);
      const dur = clamp(dist / ACTION.lobSpeed, 0.5, 1.2);
      this.ball.flight = { kind: 'lob', from, to, t: 0, dur, arc: 1.6, passer: p, target, checked: new Set() };
      target.ai.oop = { t: 0, dur };
      this.ball.releaseCooldown = { player: p, t: 0.3 };
      this.events.emit('pass', { from: p, to: target, alley: true });
    } else {
      const lead = target.vel.clone().scale(0.28);
      const to = new Vec3(target.pos.x + lead.x, 0.9, target.pos.z + lead.z);
      const dist = from.distanceTo(to);
      const dur = clamp(dist / ACTION.passSpeed, 0.14, 0.95);
      this.ball.flight = { kind: 'pass', from, to, t: 0, dur, arc: 0.25, passer: p, target, checked: new Set() };
      this.ball.releaseCooldown = { player: p, t: 0.25 };
      this.events.emit('pass', { from: p, to: target, alley: false });
    }
    this.ball.lastTeam = p.team;
    return true;
  }
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

function turnToward(
  current,
  target,
  maxDelta
) {
  let delta = target - current;

  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }

  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }

  if (Math.abs(delta) <= maxDelta) {
    return target;
  }

  return (
    current +
    Math.sign(delta) *
      maxDelta
  );
}
 
