import { Vec3, clamp, lerp } from '../core/vec3.js';
import { emptyInput } from './entities.js';
import { updateAI } from './ai.js';
import { ARENA, ACTION, MOVE, RULES, STYLE } from '../data/constants.js';

/**
 * Shooting, volleys and Gamebreaker drives, extracted from MatchSim.
 *
 * Every function takes the sim as its first argument and mutates it exactly as the
 * original class methods did; MatchSim keeps thin delegating methods so call sites,
 * tests and the AI are untouched. This module has no DOM/three.js dependency.
 */

export const SHOT_NAMES = ['LASER', 'KNUCKLER', 'SCREAMER', 'CANNON'];

export function tryShoot(sim, player) {
    const distance =
      sim.distToGoal(player);

    if (
      distance > ACTION.shotMaxRange &&
      player.isKeeper
    ) {
      return sim.keeperThrow(player);
    }

    if (player.isKeeper) {
      return sim.keeperThrow(player);
    }

    const goal =
      sim.goalPos(player.team);

    player.facing = Math.atan2(
      goal.x - player.pos.x,
      goal.z - player.pos.z
    );

    const wind =
      ACTION.shotChargeTime;

    player.shot = {
      kind: 'shot',
      charge: 0,
      released: false,
      wind,
      dist: distance,
      name:
        SHOT_NAMES[
          Math.min(
            3,
            Math.floor(distance / 4)
          )
        ],
    };

    sim.setState(
      player,
      'shoot',
      wind + 0.35
    );

    sim.events.emit('shotstart', {
      player,
      type: 'shot',
    });

    return true;
  }

export function keeperThrow(sim, player) {
    const target =
      sim.choosePassTarget(
        player,
        false
      );

    if (target) {
      return sim.tryPass(
        player,
        target,
        false
      );
    }

    return false;
  }

export function releaseShot(sim, player) {
    const shot = player.shot;

    if (!shot || shot.released) {
      return;
    }

    shot.released = true;

    const amount = clamp(
      player.stateTime / shot.wind,
      0,
      1.3
    );

    let label = 'EARLY';
    let quality = 0.55;

    if (
      amount >= ACTION.perfectLo &&
      amount <= ACTION.perfectHi
    ) {
      label = 'PERFECT';
      quality = 1;
    } else if (
      amount >= ACTION.goodLo &&
      amount <= ACTION.goodHi
    ) {
      label = 'GOOD';
      quality = 0.8;
    } else if (
      amount > ACTION.goodHi
    ) {
      label = 'LATE';
      quality = 0.6;
    }

    shot.quality = quality;

    if (sim.isUser(player)) {
      sim.events.emit('timing', {
        label,
        good: quality >= 0.8,
      });
    }

    const aim =
      sim.isUser(player)
        ? sim.aimInputDir()
        : null;

    sim.fireShot(player, quality, {
      gb: false,
      volley: shot.kind === 'volley',
      power: lerp(
        0.6,
        1,
        amount
      ),
      aimDir: aim,
    });

    sim.setState(
      player,
      'shoot',
      0.3
    );

    player.shot = {
      ...shot,
      released: true,
    };
  }

export function fireShot(
    sim,
    player,
    quality,
    {
      gb = false,
      volley = false,
      power = 0.85,
      aimDir = null,
    } = {}
  
  ) {
    const goal =
      sim.goalPos(player.team);

    const distance =
      player.pos.distanceToXZ(goal);

    const keeper =
      sim.keeperOf(1 - player.team);

    const aim =
      sim.isUser(player) &&
      aimDir
        ? Vec3.dirXZ(
            player.pos,
            goal
          ).x *
            aimDir.x +
          Vec3.dirXZ(
            player.pos,
            goal
          ).z *
            aimDir.z
        : 0;

    const side = keeper
      ? -Math.sign(
          keeper.pos.z ||
            (sim.rng.next() - 0.5)
        )
      : sim.rng.chance(0.5)
        ? 1
        : -1;

    const steer = clamp(
      aim * 1.25,
      -0.85,
      0.85
    );

    const spread =
      ARENA.goalRadius * 0.8;

    let aimZ =
      side *
      spread *
      (
        0.45 +
        sim.rng.next() * 0.55
      );

    if (steer !== 0) {
      aimZ = steer * spread;
    }

    let aimY =
      ARENA.goalY +
      (
        sim.rng.next() - 0.5
      ) *
        ARENA.goalRadius *
        1.1;

    const accuracy =
      (player.data.sht / 99) *
      (gb ? 1.4 : 1) *
      (
        sim.isUser(player)
          ? sim.difficulty.userBonus
          : sim.difficulty.shotAccuracy
      );

    const baseError = volley
      ? sim.isUser(player)
        ? 1.35
        : 1
      : 1.35;

    const shotBoost =
      (
        sim.offensePlayOf(
          player.team
        ).shotBoost || 1
      ) *
      (
        sim.flow[player.team]
          ? 1.35
          : 1
      );

    const error =
      (
        (1 - quality) * 1.6 +
        distance * 0.17 -
        accuracy * 0.9 +
        baseError * 0.42 +
        (volley ? 0.2 : 0)
      ) /
      shotBoost;

    const spreadAmount =
      Math.max(0.45, error);

    aimZ +=
      (
        sim.rng.next() - 0.5
      ) *
      2 *
      spreadAmount *
      ARENA.goalRadius;

    aimY +=
      (
        sim.rng.next() - 0.5
      ) *
      2 *
      spreadAmount *
      ARENA.goalRadius *
      0.8;

    if (gb) {
      aimZ =
        side *
        spread *
        0.9;

      aimY =
        ARENA.goalY + 0.3;
    }

    if (
      sim.momentum[player.team] >=
        sim.rules.onFireGoals &&
      !gb
    ) {
      aimZ *= 0.85;
      aimY = lerp(
        aimY,
        ARENA.goalY,
        0.3
      );
    }

    const speed =
      lerp(
        ACTION.shotMinSpeed,
        ACTION.shotMaxSpeed,
        power *
          (
            0.75 +
            (player.data.sht / 99) *
              0.35
          )
      ) *
      (gb ? 1.35 : 1) *
      (volley ? 1.15 : 1);

    const from = new Vec3(
      player.pos.x,
      0.9 + player.y,
      player.pos.z
    );

    const to = new Vec3(
      goal.x,
      aimY,
      aimZ
    );

    const direction = Vec3.sub(
      to,
      from
    ).normalize();

    player.hasBall = false;
    sim.ball.holder = null;
    sim.ball.pos.copy(from);

    sim.ball.vel.set(
      direction.x * speed,
      direction.y * speed,
      direction.z * speed
    );

    sim.ball.flight = {
      kind: 'shot',
      shooter: player,
      gb,
      volley,
      quality,
      dist: distance,
      aimZ,
      t: 0,
      checked: new Set(),
      name: player.shot
        ? player.shot.name
        : gb
          ? 'GAMEBREAKER'
          : 'VOLLEY',
    };

    sim.ball.releaseCooldown = {
      player,
      t: 0.35,
    };

    sim.ball.lastTeam = player.team;

    player.stats.shots++;
    sim.stats.shots++;
    sim.possessionClock =
      sim.rules.possessionClock;

    sim.events.emit('shot', {
      player,
      gb,
      volley,
      quality,
      dist: distance,
      speed,
    });

    if (distance > 9 && !gb) {
      sim.addStyle(
        player,
        20,
        'FROM DEEP'
      );
    }
  }

export function tryVolley(sim, player) {
    const ball = sim.ball;

    if (
      ball.holder ||
      !ball.flight
    ) {
      return false;
    }

    const horizontalDistance =
      player.pos.distanceToXZ(
        ball.pos
      );

    const flight = ball.flight;

    const wasLob =
      flight.kind === 'lob' &&
      flight.passer &&
      flight.passer.team === player.team;

    const reach =
      wasLob ? 2 : 1.5;

    if (
      horizontalDistance > reach ||
      ball.pos.y > 2.8 ||
      ball.pos.y < 0.3
    ) {
      return false;
    }

    if (
      sim.distToGoal(player) >
      ACTION.volleyRange + 3
    ) {
      return false;
    }

    player.airborne = true;
    player.vy = 3.5;
    player.y = Math.max(
      player.y,
      0.1
    );

    sim.setState(
      player,
      'volley',
      0.45
    );

    ball.flight = null;
    player.hasBall = true;
    ball.holder = player;

    const quality =
      wasLob ? 0.95 : 0.7;

    sim.fireShot(
      player,
      quality,
      {
        volley: true,
        power: 0.95,
      }
    );

    player.shot = {
      kind: 'volley',
      released: true,
    };

    player.stats.volleys++;
    sim.stats.volleys++;

    if (wasLob) {
      flight.passer.stats.ast++;

      sim.addStyle(
        flight.passer,
        STYLE.assist,
        'SET UP'
      );

      sim.events.emit('alleyoop', {
        passer: flight.passer,
        finisher: player,
      });
    }

    sim.events.emit('volleyshot', {
      player,
      lob: wasLob,
    });

    return true;
  }

  // ---------------------------------------------------------------------------
  // Gamebreaker
  // ---------------------------------------------------------------------------

export function tryGamebreaker(sim, player) {
    if (
      !sim.gbReady[player.team] ||
      sim.state !== 'live'
    ) {
      return false;
    }

    sim.gbReady[player.team] = false;
    sim.gb[player.team] = 0;
    sim.state = 'gamebreaker';
    sim.gbPlayer = player;
    sim.gbDriveShield = true;

    sim.slowmo = 0.9;
    sim.timeScale = ACTION.gbSlowmo;

    sim.setState(
      player,
      'gbwind',
      0.7
    );

    player.vel.set(0, 0, 0);
    player.stats.gb++;

    for (
      const opponent of
      sim.opponentsOf(player)
    ) {
      if (
        opponent.isKeeper
      ) {
        continue;
      }

      if (
        opponent.pos.distanceToXZ(
          player.pos
        ) < 3.2
      ) {
        sim.knockDown(
          opponent,
          player,
          'gamebreaker',
          'fallen'
        );
      }
    }

    sim.events.emit('gamebreaker', {
      team: player.team,
      player,
    });

    return true;
  }

export function clearGbShield(sim, ) {
    sim.gbDriveShield = false;
  }

export function startGbDrive(sim, player) {
    const goal =
      sim.goalPos(player.team);

    const direction = Vec3.dirXZ(
      goal,
      player.pos
    );

    const distance = Math.min(
      sim.distToGoal(player) - 0.5,
      ACTION.gbShotRange
    );

    player.gbTarget = new Vec3(
      goal.x +
        direction.x *
          Math.max(3.5, distance),
      0,
      goal.z +
        direction.z *
          Math.max(3.5, distance)
    );

    sim.setState(
      player,
      'gbdrive',
      ACTION.gbDriveTime
    );

    sim.events.emit('gbdrive', {
      player,
    });
  }

export function stepGamebreaker(sim, dt) {
    const player = sim.gbPlayer;

    for (const other of sim.players) {
      if (
        other !== player &&
        other.team !== player.team &&
        !other.isKeeper
      ) {
        other.input = emptyInput();
      } else if (other !== player) {
        updateAI(sim, other, dt);
      }
    }

    for (const other of sim.players) {
      sim.updatePlayerPhysics(
        other,
        dt,
        false
      );
    }

    sim.separatePlayers();
    sim.updateBall(dt, false);
    sim.updateGlueDribble(dt);

    if (
      player.state === 'gbdrive' &&
      player.pos.distanceToXZ(
        player.gbTarget
      ) < 0.6
    ) {
      sim.gbShoot(player);
    }
  }

export function gbShoot(sim, player) {
    if (
      sim.ball.holder !== player
    ) {
      sim.state = 'live';
      return;
    }

    const goal =
      sim.goalPos(player.team);

    player.facing = Math.atan2(
      goal.x - player.pos.x,
      goal.z - player.pos.z
    );

    sim.slowmo = 0.5;
    sim.timeScale = 0.6;

    sim.setState(
      player,
      'shoot',
      0.5
    );

    sim.fireShot(
      player,
      1,
      {
        gb: true,
        power: 1,
      }
    );

    player.shot = {
      kind: 'gb',
      released: true,
    };

    sim.events.emit('gbshot', {
      player,
      name: player.data.signature,
    });

    sim.state = 'live';
  }
