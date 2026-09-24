import { clamp } from '../core/vec3.js';
import { RULES, STYLE } from '../data/constants.js';

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

    if (sim.ball.holder) {
      sim.ball.holder.hasBall = false;
      sim.ball.holder = null;
    }

    sim.ball.flight = null;
    sim.ball.vel.set(0, 0, 0);
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

    const points = gamebreaker
      ? sim.rules.gbPoints
      : sim.rules.goalPoints;

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
      : flight && flight.volley
        ? 'volley'
        : ownGoal
          ? 'own'
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

    sim.events.emit('score', {
      team,
      player,
      points,
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
