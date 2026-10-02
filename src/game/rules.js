import { clamp } from '../core/vec3.js';
import { ARENA, RULES, STYLE } from '../data/constants.js';

/**
 * Flow, style meter, scoring and game-over rules, extracted from MatchSim. Functions take
 * the sim as their first argument and mutate it exactly as the original class methods did;
 * MatchSim keeps thin delegating methods. No DOM/three.js dependency.
 */

export function startFlow(sim, team, player) {
    if (sim.flow[team]) {
      return;
    }

    sim.flow[team] = true;
    sim.flowTimer[team] =
      RULES.flowDuration;

    sim.events.emit('flowstart', {
      team,
      player: player || sim.controlled,
    });
  }

export function updateRules(sim, dt) {
    const holder = sim.ball.holder;

    if (sim.flow[sim.possession]) {
      sim.possessionClock =
        Math.max(
          sim.possessionClock,
          8
        );
    } else {
      sim.possessionClock -= dt;
    }

    sim.shotClock =
      sim.possessionClock;

    if (sim.possessionClock <= 0) {
      const team = sim.possession;

      sim.events.emit('shotclock', {
        team,
      });

      return sim.turnover(
        team,
        'POSSESSION CLOCK'
      );
    }

    if (
      holder &&
      holder.isKeeper &&
      holder.keeperHold >
        sim.rules.keeperHold
    ) {
      sim.events.emit('violation', {
        reason: 'KEEPER HOLD',
        team: holder.team,
      });

      if (
        !sim.keeperThrow(holder)
      ) {
        return sim.turnover(
          holder.team,
          'KEEPER HOLD'
        );
      }
    }
  }

export function turnover(sim, team, reason) {
  sim.loseStyle(
      team,
      STYLE.lossOnTurnover
    );

    sim.events.emit('turnover', {
      team,
      reason,
    });

  sim.deadReason = 'turnover';
  sim.pendingPossession = 1 - team;
  sim.state = 'dead';
  sim.stateTimer = 1;
  sim.openSubWindow(sim.userTeam);

    if (sim.ball.holder) {
      sim.ball.holder.hasBall = false;
      sim.ball.holder = null;
    }

    sim.ball.flight = null;
    sim.ball.vel.set(0, 0, 0);
  }

// ---------------------------------------------------------------------------
// Discipline
// ---------------------------------------------------------------------------

/**
 * Was this contact over the line? Two things are a foul in this pool, and both are things a player
 * can choose to do or avoid:
 *
 *   1. Swiping a swimmer who is already on the floor. The classic. Always a whistle.
 *   2. A near dead-on square big hit. Impact tops out at 1.0 (combat.js impactOf), so only the
 *      cleanest connections reach the threshold, and even then the ref waves it up most of the
 *      time — swinging hard is a gamble, not a certainty.
 *
 * Tackles are deliberately NOT in here: a dive tackle is the sport's legal answer to a carrier,
 * and making it whistlable would make defending unplayable. The violence has to be the big-hit
 * button, where the risk is visible and chosen.
 */
export function isFoul(sim, offender, victim, impact, victimWasDown = false) {
  if (sim.state !== 'live' || !victim || victim.team === offender.team) return false;
  if (victim.isKeeper) return false; // keepers are in their own box; contact there is the save
  if (offender.sentOff) return false;
  if (victimWasDown) return true;
  if (impact < RULES.foulThreshold) return false;
  // Only a fraction of the very cleanest hits get called, so contact stays an aggressive option.
  return sim.rng.chance(RULES.foulCallChance);
}

/**
 * Blow the whistle. The fouled crew keeps the ball and the play restarts from the spot, the
 * offender is booked, and a second booking (or an outright ugly one) is a red: the swimmer is off
 * for the rest of the match and the bench goes on immediately.
 */
export function callFoul(sim, offender, victim, impact, kind = 'bigHit', victimWasDown = false) {
  if (!isFoul(sim, offender, victim, impact, victimWasDown)) return false;
  if (sim.state !== 'live') return false;

  offender.cards++;
  sim.cards[offender.team].push({ player: offender, t: sim.time, severity: impact, kind });

  const instantRed = impact >= RULES.redMinSeverity;
  const sendOff = instantRed || offender.cards >= RULES.cardThreshold;

  sim.events.emit('foul', {
    team: offender.team,
    offender,
    victim,
    impact,
    kind,
    card: offender.cards,
    red: sendOff,
  });

  // Dead ball: the fouled side gets it. The ball goes to the victim's feet where they were hit —
  // they keep the momentum of the collision (the hit still reads), the restart just hands them
  // the ball instead of the other team.
  if (sim.ball.holder) {
    sim.ball.holder.hasBall = false;
    sim.ball.holder = null;
  }
  sim.ball.flight = null;
  sim.ball.vel.set(0, 0, 0);
  sim.ball.pos.copy(victim.pos);
  sim.ball.pos.y = 0.9 + victim.y;
  sim.possession = victim.team;
  sim.possessionClock = sim.rules.possessionClock;
  sim.deadReason = 'foul';
  sim.pendingPossession = victim.team;
  sim.state = 'dead';
  sim.stateTimer = RULES.resetDuration;
  // A whistle is the best substitution window in the match — both crews get the chance to react.
  sim.openSubWindow(null);
  sim.stats.fouls = (sim.stats.fouls || 0) + 1;

  if (RULES.foulFreeSwim && victim) {
    sim.giveBall(victim, false);
    sim.possession = victim.team;
  }

  if (sendOff) sendOffPlayer(sim, offender);
  return true;
}

/** Red card: the swimmer is out for the match, replaced from the bench. */
export function sendOffPlayer(sim, p) {
  if (p.sentOff) return false;
  p.sentOff = true;
  p.sentOffAt = sim.time;
  p.state = 'sentoff';
  p.stateTime = 0;
  if (sim.ball.holder === p) {
    p.hasBall = false;
    sim.ball.holder = null;
  }
  sim.events.emit('card', { team: p.team, player: p, red: true, cards: p.cards });

  // Straight off and straight on: the bench brings up the replacement.
  const idx = sim.players.indexOf(p);
  const replacement = sim.bestSubFor(p.team, p);
  if (idx >= 0 && replacement) {
    replacement.subbedIn = true;
    replacement.sentOff = false;
    replacement.cards = 0;
    replacement.pos.copy(p.pos);
    replacement.y = p.y;
    replacement.facing = p.facing;
    replacement.state = 'idle';
    replacement.stateTime = 0;
    replacement.turbo = Math.max(replacement.turbo, 60);
    replacement.ai = {};
    for (const k in replacement.cd) replacement.cd[k] = 0;
    replacement.subbedIn = true;
    sim.players[idx] = replacement;
    sim.benches[p.team] = sim.benches[p.team].filter((b) => b !== replacement);
    // A forced replacement doesn't burn a substitution: the coach had no choice.
    p.subbedOff = true;
    p.state = 'sentoff';
    if (sim.controlled === p) {
      sim.controlled = null;
      if (sim.userTeam !== null) sim.autoSelectControlled();
    }
    sim.events.emit('sub', { team: p.team, out: p, in: replacement, remaining: sim.subsLeft[p.team], forced: true });
  }
  return true;
}

export function addStyle(sim, player, base, label, options = {}) {
    const team = player.team;

    if (
      !sim.flow[team] &&
      sim.possession === team &&
      player.combo + 1 >= RULES.flowCombo
    ) {
      sim.startFlow(team, player);
    }

    player.combo = Math.min(
      player.combo + 1,
      12
    );

    player.comboTimer =
      STYLE.comboWindow;

    const multiplier = Math.min(
      STYLE.comboMax,
      1 +
        (
          player.combo - 1
        ) *
          STYLE.comboStep
    );

    const gamebreakerRate =
      0.7 +
      (player.data.gb / 99) *
        0.7;

    const points = Math.round(
      base * multiplier
    );

    player.stats.style += points;

    const wasReady =
      sim.gbReady[team];

    let meterGain =
      points * gamebreakerRate;

    if (
      sim.userTeam !== null &&
      team !== sim.userTeam
    ) {
      meterGain *=
        sim.difficulty.aiGbRate;
    }

    sim.gb[team] = Math.min(
      sim.rules.gamebreakerMeterMax,
      sim.gb[team] + meterGain
    );

    if (
      sim.gb[team] >=
        sim.rules.gamebreakerMeterMax &&
      !wasReady
    ) {
      sim.gbReady[team] = true;

      sim.events.emit('gbready', {
        team,
      });
    }

    sim.events.emit('style', {
      player,
      points,
      label,
      combo: player.combo,
      big: !!options.big,
      team,
    });
  }

export function loseStyle(sim, team, amount) {
    if (sim.gbReady[team]) {
      return;
    }

    sim.gb[team] = Math.max(
      0,
      sim.gb[team] - amount
    );
  }

export function scoreGoal(sim, player, flight, ownGoal = false) {
    if (sim.state === 'over') {
      return;
    }

    const team = player.team;
    const gamebreaker =
      !!(
        flight &&
        flight.gb
      );

    // A clean strike through a ring scores that ring's value; the Gamebreaker drive rips
    // through the top ring for its flat bonus payout.
    const hitRing = sim.zoneHit;
    sim.zoneHit = null;
    const ringPoints = hitRing && hitRing.points ? hitRing.points : sim.rules.goalPoints;
    const points = gamebreaker
      ? sim.rules.gbPoints
      : ringPoints;

    sim.score[team] += points;
    player.stats.goals += points;

    if (
      !(flight && flight.onGoal)
    ) {
      player.stats.sog++;
    }

    let stolen = 0;

    if (gamebreaker) {
      stolen = Math.min(
        sim.score[1 - team],
        sim.rules.gbSteal
      );

      sim.score[1 - team] -= stolen;
    }

    sim.momentum[team]++;
    sim.momentum[1 - team] = 0;

    const type = gamebreaker
      ? 'gamebreaker'
      : ownGoal
        ? 'own'
        : ringPoints >= sim.rules.topRingPoints
          ? 'topring'
          : flight && flight.volley
            ? 'volley'
            : flight && flight.dist > 9
              ? 'long'
              : 'shot';

    for (
      const teammate of
      sim.teammatesOf(player)
    ) {
      if (
        sim.time -
          teammate.lastPassTime <
          2.5 &&
        teammate.lastPassTime > 0
      ) {
        teammate.stats.ast++;
        break;
      }
    }

    if (!ownGoal) {
      const base =
        gamebreaker
          ? 0
          : type === 'volley'
            ? STYLE.goalVolley
            : type === 'long'
              ? STYLE.goalLong
              : STYLE.goal;

      if (base) {
        sim.addStyle(
          player,
          base +
            (
              flight &&
              flight.quality >= 1
                ? STYLE.goalPerfect
                : 0
            ),
          type === 'volley'
            ? 'VOLLEY GOAL'
            : type === 'long'
              ? 'FROM DOWNTOWN'
              : 'GOAL'
        );
      }
    }

    sim.lastScorer = player;
    sim.lastGoalTime = sim.time;
    sim.ball.flight = null;
    sim.ball.vel.set(0, 0, 0);
    // Match story: log the goal and the window it came through. The half split is banked on the
    // score as it stands now, so the montage reads the same numbers the results screen will.
    sim.halfScore[team][sim.half - 1] += points;
    if (sim.ringGoals[team]) sim.ringGoals[team][hitRing ? hitRing.ring : 0]++;
    if (sim.goalLog) {
      sim.goalLog.push({
        t: sim.time,
        team,
        id: player.id,
        nick: player.data.nick,
        points,
        ring: hitRing ? hitRing.ring : 0,
        type,
        ownGoal,
        half: sim.half,
      });
    }

    sim.events.emit('score', {
      team,
      player,
      points,
      ring: hitRing ? hitRing.ring : 0,
      type,
      gb: gamebreaker,
      stolen,
      score: [...sim.score],
      momentum: sim.momentum[team],
      ownGoal,
    });

    if (
      sim.momentum[team] ===
      sim.rules.onFireGoals
    ) {
      sim.events.emit('heating', {
        team,
        player,
      });
    }

    sim.deadReason = 'goal';
    sim.pendingPossession = 1 - team;
    sim.state = 'dead';

    sim.stateTimer = gamebreaker
      ? 3
      : sim.rules.goalDeadTime;

    // A goal is the longest dead ball in the match — the natural place to spend a change.
    sim.openSubWindow(sim.userTeam);

    sim.setState(
      player,
      'celebrate',
      1.6
    );

    sim.checkGameOver(true);
  }

export function checkGameOver(sim, deferReset = false) {
    const [homeScore, awayScore] =
      sim.score;

    let winner = null;

    if (sim.overtime) {
      winner =
        homeScore > awayScore
          ? 0
          : awayScore > homeScore
            ? 1
            : null;
    } else if (
      sim.half === 2 &&
      Math.abs(
        homeScore - awayScore
      ) >= sim.rules.mercyLead
    ) {
      winner =
        homeScore > awayScore
          ? 0
          : 1;
    }

    if (winner === null) {
      return false;
    }

    if (
      deferReset &&
      sim.state === 'dead'
    ) {
      sim.pendingGameOver = winner;
      sim.stateTimer = Math.max(
        sim.stateTimer,
        1.8
      );

      return false;
    }

    sim.finishGame(winner);
    return true;
  }

export function finishGame(sim, winner) {
    if (sim.state === 'over') {
      return;
    }

    sim.state = 'over';
    sim.winner = winner;

    sim.events.emit('gameover', {
      winner,
      score: [...sim.score],
      players: sim.players,
      overtime: sim.overtime,
    });
  }
