import { Vec3, clamp, lerp } from '../core/vec3.js';
import { ARENA, ACTION, PHYS, RULES, STYLE } from '../data/constants.js';

/**
 * Ball flight physics, goal-crossing, keeper saves, blocks, interceptions and pickups,
 * extracted from MatchSim. Functions take the sim as their first argument and mutate it
 * exactly as the original class methods did; MatchSim keeps thin delegating methods.
 * No DOM/three.js dependency.
 */

export function releaseLoose(sim, from, velocity) {
    const ball = sim.ball;

    if (ball.holder === from) {
      from.hasBall = false;
      ball.holder = null;
    }

    ball.pos.set(
      from.pos.x,
      0.9 + from.y,
      from.pos.z
    );

    ball.vel.copy(velocity);

    ball.flight = {
      kind: 'loose',
      t: 0,
      checked: new Set(),
    };

    ball.releaseCooldown = {
      player: from,
      t: 0.4,
    };
  }

export function updateBall(sim, dt, deadBall) {
    const ball = sim.ball;

    if (ball.holder) {
      const holder = ball.holder;
      const forward =
        sim.forwardOf(holder);

      ball.pos.set(
        holder.pos.x +
          forward.x * 0.42,
        0.85 + holder.y,
        holder.pos.z +
          forward.z * 0.42
      );

      ball.vel.set(0, 0, 0);

      if (
        holder.isKeeper &&
        !deadBall &&
        sim.state === 'live'
      ) {
        holder.keeperHold =
          (holder.keeperHold || 0) +
          dt;
      }

      return;
    }

    const flight = ball.flight;

    if (!flight) {
      sim.integrateLoose(
        ball,
        dt
      );

      if (!deadBall) {
        sim.checkPickup();
      }

      return;
    }

    flight.t += dt;

    if (
      flight.kind === 'pass' ||
      flight.kind === 'lob'
    ) {
      const amount = clamp(
        flight.t / flight.dur,
        0,
        1
      );

      const previous =
        sim.ballPreviousPosition;

      previous.copy(ball.pos);

      ball.pos.x = lerp(
        flight.from.x,
        flight.to.x,
        amount
      );

      ball.pos.z = lerp(
        flight.from.z,
        flight.to.z,
        amount
      );

      ball.pos.y =
        lerp(
          flight.from.y,
          flight.to.y,
          amount
        ) +
        Math.sin(amount * Math.PI) *
          flight.arc;

      const inverseDt =
        1 / Math.max(dt, 0.0001);

      ball.vel.set(
        (
          ball.pos.x - previous.x
        ) * inverseDt,
        (
          ball.pos.y - previous.y
        ) * inverseDt,
        (
          ball.pos.z - previous.z
        ) * inverseDt
      );

      if (!deadBall) {
        sim.checkInterceptions();
      }

      if (ball.flight !== flight) {
        return;
      }

      if (amount >= 1) {
        const target = flight.target;
        const distance =
          target.pos.distanceToXZ(
            ball.pos
          );

        const reach =
          flight.kind === 'lob'
            ? 2
            : 1.5;

        if (
          target.state !== 'fallen' &&
          distance < reach &&
          !deadBall
        ) {
          if (flight.kind === 'lob') {
            if (!target.airborne) {
              sim.tryBreach(target);
            }

            if (!sim.tryVolley(target)) {
              ball.flight = null;
              sim.giveBall(target);

              sim.setState(
                target,
                'catch',
                0.15
              );
            }
          } else {
            ball.flight = null;
            sim.giveBall(target);

            sim.setState(
              target,
              'catch',
              0.15
            );

            sim.events.emit('catch', {
              player: target,
            });
          }
        } else {
          ball.flight = {
            kind: 'loose',
            t: 0,
            checked: new Set(),
          };

          ball.vel.scale(0.35);
        }
      }

      return;
    }

    if (flight.kind === 'shot') {
      ball.vel.y +=
        PHYS.gravityLoose *
        0.4 *
        dt;

      ball.vel.scale(
        Math.max(
          0,
          1 - 0.18 * dt
        )
      );
    } else {
      ball.vel.y +=
        PHYS.gravityLoose * dt;

      ball.vel.scale(
        Math.max(
          0,
          1 -
            PHYS.looseDrag * dt
        )
      );
    }

    const previous =
      sim.ballPreviousPosition;

    previous.copy(ball.pos);

    ball.pos.addScaled(
      ball.vel,
      dt
    );

    if (
      flight.kind === 'shot' ||
      flight.kind === 'loose'
    ) {
      const goal =
        sim.checkGoalCrossing(
          previous,
          ball.pos
        );

      if (goal !== null) {
        const scorer =
          flight.kind === 'shot'
            ? flight.shooter
            : ball.lastTouch ||
              flight.shooter;

        const scoringTeam = 1 - goal;

        if (
          scorer &&
          scorer.team === scoringTeam
        ) {
          return sim.scoreGoal(
            scorer,
            flight
          );
        }

        const opponent =
          sim.outfield(scoringTeam)[0];

        return sim.scoreGoal(
          opponent,
          flight,
          true
        );
      }

      if (
        !deadBall &&
        flight.kind === 'shot'
      ) {
        sim.checkKeeperSave();

        if (ball.flight !== flight) {
          return;
        }

        sim.checkBlocks();

        if (ball.flight !== flight) {
          return;
        }
      }
    }

    sim.bounceBall(
      ball,
      flight
    );

    if (
      flight.kind === 'shot' &&
      (
        flight.t > 2.4 ||
        ball.vel.length() < 4
      )
    ) {
      flight.kind = 'loose';

      sim.events.emit('miss', {
        player: flight.shooter,
        type: flight.volley
          ? 'volley'
          : 'shot',
      });

      ball.flight = {
        kind: 'loose',
        t: 0,
        checked: new Set(),
        shooter: flight.shooter,
      };
    }

    if (
      flight.kind === 'loose' &&
      !deadBall
    ) {
      sim.checkPickup();
    }
  }
export function integrateLoose(sim, ball, dt) {
    ball.vel.y += PHYS.gravityLoose * dt;
    ball.vel.scale(
      Math.max(0, 1 - PHYS.looseDrag * dt)
    );
    ball.pos.addScaled(ball.vel, dt);
    sim.bounceBall(ball, null);
  }

export function bounceBall(sim, ball, flight) {
    if (ball.pos.y > ARENA.ceilingY) {
      ball.pos.y = ARENA.ceilingY;

      if (ball.vel.y > 0) {
        ball.vel.y *= -PHYS.wallRestitution;
      }
    }

    if (ball.pos.y < ARENA.floorY) {
      ball.pos.y = ARENA.floorY;

      if (ball.vel.y < 0) {
        ball.vel.y *= -PHYS.wallRestitution;
      }
    }

    const behindGoal =
      Math.abs(ball.pos.x) >
      ARENA.goalX + 0.3;

    if (behindGoal) {
      const inMouth =
        Math.hypot(
          ball.pos.y - ARENA.goalY,
          ball.pos.z
        ) < ARENA.goalRadius;

      if (
        !inMouth ||
        Math.abs(ball.pos.x) >
          ARENA.goalX + 1.8
      ) {
        ball.pos.x =
          Math.sign(ball.pos.x) *
          (ARENA.goalX + 0.3);

        ball.vel.x =
          -Math.sign(ball.pos.x) *
          Math.max(
            Math.abs(ball.vel.x) *
              PHYS.wallRestitution,
            3.5
          );

        if (
          flight &&
          flight.kind === 'shot'
        ) {
          const nearRing =
            Math.hypot(
              ball.pos.y - ARENA.goalY,
              ball.pos.z
            ) <
            ARENA.goalRadius + 0.6;

          if (nearRing) {
            sim.events.emit('post', {
              pos: ball.pos.clone(),
              hard: Math.abs(ball.vel.x) > 10,
            });
          } else {
            sim.events.emit('wall', {
              pos: ball.pos.clone(),
              speed: Math.abs(ball.vel.x),
            });
          }

          flight.kind = 'loose';

          sim.events.emit('miss', {
            player: flight.shooter,
            type: nearRing
              ? 'post'
              : 'wide',
          });

          sim.ball.flight = {
            kind: 'loose',
            t: 0,
            checked: new Set(),
            shooter: flight.shooter,
          };
        }
      }
    }

    const radius = ball.pos.lengthXZ();

    if (
      radius > ARENA.ballRadius &&
      ball.wallCooldown <= 0
    ) {
      const nx = ball.pos.x / radius;
      const nz = ball.pos.z / radius;

      ball.pos.x =
        nx * ARENA.ballRadius;

      ball.pos.z =
        nz * ARENA.ballRadius;

      const normalVelocity =
        ball.vel.x * nx +
        ball.vel.z * nz;

      if (normalVelocity > 0) {
        ball.vel.x -=
          (1 + PHYS.wallRestitution) *
          normalVelocity *
          nx;

        ball.vel.z -=
          (1 + PHYS.wallRestitution) *
          normalVelocity *
          nz;

        ball.wallCooldown = 0.08;

        sim.events.emit('wall', {
          pos: ball.pos.clone(),
          speed: Math.abs(normalVelocity),
        });

        if (
          flight &&
          flight.kind === 'shot'
        ) {
          flight.kind = 'loose';

          sim.events.emit('miss', {
            player: flight.shooter,
            type: 'wide',
          });

          sim.ball.flight = {
            kind: 'loose',
            t: 0,
            checked: new Set(),
            shooter: flight.shooter,
          };
        }
      }
    }
  }

export function checkGoalCrossing(sim, previous, current) {
    for (const team of [0, 1]) {
      const goalX =
        -ARENA.goalX *
        sim.attackDir(team);

      const crossed =
        (
          previous.x - goalX
        ) *
        (
          current.x - goalX
        ) <= 0 &&
        Math.sign(
          current.x - previous.x
        ) === Math.sign(goalX) &&
        Math.abs(
          current.x - previous.x
        ) > 0.000001;

      if (!crossed) {
        continue;
      }

      const amount =
        (goalX - previous.x) /
        (current.x - previous.x);

      const y = lerp(
        previous.y,
        current.y,
        amount
      );

      const z = lerp(
        previous.z,
        current.z,
        amount
      );

      const distance =
        Math.hypot(
          y - ARENA.goalY,
          z
        );

      if (
        distance <
        ARENA.goalRadius - 0.08
      ) {
        sim.ringRattle(team);
        return team;
      }

      if (
        distance <
        ARENA.goalRadius +
          ARENA.postRadius +
          0.1
      ) {
        sim.ball.vel.x *=
          -PHYS.wallRestitution;

        sim.ball.pos.x =
          goalX -
          Math.sign(goalX) * 0.2;

        sim.ringRattle(team);

        sim.events.emit('post', {
          pos: sim.ball.pos.clone(),
          hard: true,
        });

        const flight =
          sim.ball.flight;

        if (
          flight &&
          flight.kind === 'shot'
        ) {
          sim.events.emit('miss', {
            player: flight.shooter,
            type: 'post',
          });

          sim.ball.flight = {
            kind: 'loose',
            t: 0,
            checked: new Set(),
            shooter: flight.shooter,
          };
        }

        return null;
      }
    }

    return null;
  }

export function ringRattle(sim, team) {
    const difference =
      sim.score[0] -
      sim.score[1];

    if (
      Math.abs(difference) >=
      sim.rules.rubberLead
    ) {
      const trailing =
        difference < 0 ? 0 : 1;

      sim.rubber[trailing] =
        Math.min(
          sim.rules.rubberCap,
          1 +
            (
              Math.abs(difference) -
              sim.rules.rubberLead +
              1
            ) *
              sim.rules.rubberPerGoal
        );

      sim.rubber[1 - trailing] = 1;
    } else {
      sim.rubber[0] = 1;
      sim.rubber[1] = 1;
    }

    sim.rungPulse[team] = 1;

    sim.events.emit('goalring', {
      team,
    });
  }

export function checkKeeperSave(sim, ) {
    const ball = sim.ball;
    const flight = ball.flight;

    if (
      !flight ||
      !flight.shooter
    ) {
      return;
    }

    const keeper =
      sim.keeperOf(
        1 - flight.shooter.team
      );

    if (
      !keeper ||
      flight.checked.has(keeper.id)
    ) {
      return;
    }

    const dx = Math.abs(
      ball.pos.x - keeper.pos.x
    );

    if (dx > 0.9) {
      return;
    }

    const dz = Math.abs(
      ball.pos.z - keeper.pos.z
    );

    const dy = Math.abs(
      ball.pos.y -
      (
        ARENA.goalY +
        keeper.y
      )
    );

    const reach =
      ACTION.keeperReach *
      (
        0.8 +
        (keeper.data.cat / 99) *
          0.5
      ) +
      (
        keeper.state === 'save'
          ? 0.55
          : 0
      );

    if (
      dz > reach + 0.6 ||
      dy > reach + 0.5
    ) {
      return;
    }

    flight.checked.add(keeper.id);

    const distance =
      Math.hypot(dz, dy);

    let probability =
      1 -
      (
        distance /
        (reach + 0.6)
      ) *
        0.5;

    probability -=
      (flight.quality - 0.6) *
      0.4;

    probability -=
      (ball.vel.length() - 16) *
      0.022;

    probability *=
      sim.difficulty.keeperSkill *
      (
        sim.userTeam !== null &&
        keeper.team === sim.userTeam
          ? 1.18
          : 1
      );

    probability +=
      (keeper.data.blk / 99) *
      0.15;

    probability *=
      sim.rubber[keeper.team];

    if (flight.gb) {
      probability = 0.04;
    }

    if (
      sim.momentum[
        flight.shooter.team
      ] >= sim.rules.onFireGoals
    ) {
      probability *= 0.75;
    }

    if (
      sim.overtime &&
      sim.otTime >
        sim.rules.overtimeFatigueAfter
    ) {
      probability *= 0.4;
    }

    if (
      sim.isUser(flight.shooter)
    ) {
      probability *=
        2 - sim.difficulty.userBonus;
    }

    probability = clamp(
      probability,
      0.03,
      0.92
    );

    flight.shooter.stats.sog++;
    flight.onGoal = true;

    if (sim.rng.chance(probability)) {
      const catches =
        sim.rng.chance(
          0.55 +
            (keeper.data.cat / 99) *
              0.3 -
            (ball.vel.length() - 16) *
              0.02
        );

      keeper.stats.saves++;
      sim.stats.saves++;

      sim.setState(
        keeper,
        'save',
        0.55
      );

      keeper.knockDir.set(
        0,
        0,
        Math.sign(
          ball.pos.z - keeper.pos.z
        ) || 1
      );

      const big =
        distance > reach * 0.6 ||
        ball.vel.length() > 20;

      sim.addStyle(
        keeper,
        big
          ? STYLE.saveBig
          : STYLE.save,
        big
          ? 'HUGE SAVE'
          : 'SAVE',
        { big }
      );

      sim.events.emit('save', {
        keeper,
        shooter: flight.shooter,
        big,
        caught: catches,
      });

      sim.loseStyle(
        flight.shooter.team,
        20
      );

      if (catches) {
        ball.flight = null;
        sim.giveBall(keeper);
        sim.momentum[
          flight.shooter.team
        ] = 0;
      } else {
        const side =
          Math.sign(
            ball.pos.z - keeper.pos.z
          ) ||
          (
            sim.rng.chance(0.5)
              ? 1
              : -1
          );

        ball.vel.set(
          -Math.sign(ball.vel.x) * 6,
          2.5,
          side * 7
        );

        ball.flight = {
          kind: 'loose',
          t: 0,
          checked: new Set(),
          shooter: flight.shooter,
          parried: true,
        };

        ball.lastTouch = keeper;
      }
    } else {
      keeper.knockDir.set(
        0,
        0,
        Math.sign(
          ball.pos.z - keeper.pos.z
        ) || 1
      );

      sim.setState(
        keeper,
        'save',
        0.5
      );
    }
  }

export function checkBlocks(sim, ) {
    const ball = sim.ball;
    const flight = ball.flight;

    if (!flight) {
      return;
    }

    for (const player of sim.players) {
      if (
        player.team === flight.shooter.team ||
        player.isKeeper ||
        flight.checked.has(player.id)
      ) {
        continue;
      }

      const horizontal =
        player.pos.distanceToXZ(
          ball.pos
        );

      const top =
        0.9 +
        player.y +
        (
          player.airborne
            ? 1.1
            : 0.7
        );

      if (
        horizontal <
          ACTION.blockRadius &&
        ball.pos.y < top &&
        ball.pos.y > -0.2
      ) {
        flight.checked.add(
          player.id
        );

        let probability =
          (
            player.airborne
              ? 0.42
              : 0.06
          ) +
          (
            (player.data.tkl - 60) /
            99
          ) *
            0.25;

        if (flight.gb) {
          probability = 0;
        }

        if (!sim.isUser(player)) {
          probability *=
            sim.difficulty.tackleRate;
        }

        probability *=
          sim.rubber[player.team];

        probability *=
          sim.defenseMods(player.team)
            .block || 1;

        if (
          sim.rng.chance(
            clamp(
              probability,
              0,
              0.7
            )
          )
        ) {
          player.stats.blk++;

          const direction =
            Vec3.dirXZ(
              flight.shooter.pos,
              player.pos
            );

          ball.vel.set(
            direction.x * 6 +
              (
                sim.rng.next() - 0.5
              ) *
                3,
            2.5,
            direction.z * 6 +
              (
                sim.rng.next() - 0.5
              ) *
                3
          );

          ball.flight = {
            kind: 'loose',
            t: 0,
            checked: new Set(),
            shooter: flight.shooter,
          };

          ball.lastTouch = player;

          sim.addStyle(
            player,
            STYLE.block,
            'DENIED',
            { big: true }
          );

          sim.events.emit('block', {
            blocker: player,
            shooter: flight.shooter,
          });

          sim.events.emit('miss', {
            player: flight.shooter,
            type: 'blocked',
          });

          return;
        }
      }
    }
  }

export function checkInterceptions(sim, ) {
    const ball = sim.ball;
    const flight = ball.flight;

    if (
      !flight ||
      !flight.passer
    ) {
      return;
    }

    const passerTeam =
      flight.passer.team;

    for (const player of sim.players) {
      if (
        player.team === passerTeam ||
        flight.checked.has(player.id) ||
        player.state === 'fallen'
      ) {
        continue;
      }

      const horizontal =
        player.pos.distanceToXZ(
          ball.pos
        );

      const reach =
        player.isKeeper
          ? 1.4
          : 0.8;

      const vertical =
        Math.abs(
          ball.pos.y -
          (
            0.9 +
            player.y
          )
        ) <
        (
          player.airborne
            ? 1.4
            : 1
        );

      if (
        horizontal >= reach ||
        !vertical
      ) {
        continue;
      }

      flight.checked.add(
        player.id
      );

      const active =
        player.state === 'tackle' ||
        player.airborne;

      let probability =
        active
          ? 0.5 +
            (
              (player.data.tkl - 50) /
              99
            ) *
              0.35
          : 0.09 +
            (
              (player.data.tkl - 50) /
              99
            ) *
              0.08;

      if (player.isKeeper) {
        probability =
          0.7 +
          (player.data.cat / 99) *
            0.25;
      }

      if (flight.kind === 'lob') {
        probability *= 0.6;
      }

      if (flight.t < 0.1) {
        probability *= 0.3;
      }

      if (
        !sim.isUser(player) &&
        !player.isKeeper
      ) {
        probability *=
          sim.difficulty.tackleRate *
          0.9;
      }

      probability *=
        sim.rubber[player.team];

      probability /=
        sim.offensePlayOf(
          flight.passer.team
        ).passAcc || 1;

      probability *=
        sim.defenseMods(player.team)
          .lane || 1;

      if (
        sim.rng.chance(
          clamp(
            probability,
            0.02,
            0.9
          )
        )
      ) {
        ball.flight = null;
        flight.passer.stats.to++;
        player.stats.tkl++;

        sim.loseStyle(
          passerTeam,
          STYLE.lossOnTurnover
        );

        sim.giveBall(player);

        sim.setState(
          player,
          'catch',
          0.15
        );

        sim.addStyle(
          player,
          STYLE.tackle,
          'PICKED OFF',
          { big: true }
        );

        sim.events.emit('tackle', {
          player,
          victim: flight.passer,
          pass: true,
        });

        return;
      }
    }
  }

export function checkPickup(sim, ) {
    const ball = sim.ball;
    let best = null;
    let bestScore = Infinity;

    for (const player of sim.players) {
      if (
        player.state === 'fallen' ||
        player.state === 'stumble'
      ) {
        continue;
      }

      if (
        ball.releaseCooldown &&
        ball.releaseCooldown.player === player
      ) {
        continue;
      }

      if (player.cd.catch > 0) {
        continue;
      }

      const horizontal =
        player.pos.distanceToXZ(
          ball.pos
        );

      const vertical =
        Math.abs(
          ball.pos.y -
          (
            0.9 +
            player.y
          )
        );

      let radius =
        player.isKeeper
          ? ACTION.keeperPickupRadius
          : ACTION.pickupRadius;

      if (
        player.ai.diving > 0 ||
        player.state === 'tackle'
      ) {
        radius += 0.35;
      }

      if (player.airborne) {
        radius += 0.3;
      }

      if (
        horizontal < radius &&
        vertical <
          (
            player.airborne
              ? 1.5
              : 1.1
          )
      ) {
        const score =
          horizontal -
          (player.data.hnd / 99) *
            0.2 -
          (
            player.airborne
              ? 0.2
              : 0
          );

        if (score < bestScore) {
          bestScore = score;
          best = player;
        }
      }
    }

    if (!best) {
      return;
    }

    const previousTeam =
      ball.lastTeam;

    const wasShot =
      ball.flight &&
      (
        ball.flight.shooter ||
        ball.flight.parried
      );

    ball.flight = null;
    sim.giveBall(best);

    if (best.state !== 'breach') {
      sim.setState(
        best,
        'catch',
        0.12
      );
    }

    if (wasShot) {
      sim.events.emit('recover', {
        player: best,
        defensive:
          previousTeam !== best.team,
      });
    }

    if (best.airborne) {
      sim.addStyle(
        best,
        STYLE.breachCatch,
        'SNAG'
      );
    }
  }
