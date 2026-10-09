import * as THREE from 'three';
import { ARENA } from '../data/constants.js';

/**
 * REMATCH-STYLE SHOULDER CAMERA — the one camera.
 * A low, tight third-person boom that rides just behind the controlled swimmer's shoulder and
 * looks where they swim (drifting back toward the attack direction when idle), the way Sloclap's
 * Rematch frames its player. The ball is never hard-locked: it drifts into frame naturally as you
 * close on it, with a gentle look-target bias when it sits ahead of the view. Goals and
 * gamebreakers cut to a brief cinematic replay behind the scorer, then hand the view straight
 * back. The boom trims against the arena sphere so the camera can never clip the wall.
 */
export class GameCamera {
  constructor(camera, opts = {}) {
    this.cam = camera;
    this.pos = new THREE.Vector3(0, 9, 22);
    this.look = new THREE.Vector3(0, 0.8, 0);
    this.shake = 0;
    this.shakeVec = new THREE.Vector3();
    this.fov = 64;
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
    this.cam.fov = this.fov;
    this.cam.updateProjectionMatrix();
    this.focus = null;
    this.shakeEnabled = opts.screenShake !== false;
    this.reducedMotion = !!opts.reducedMotion;
    // Manual orbit (touch: drag the right half of the screen). In manual mode the boom holds the
    // player's chosen yaw instead of swinging behind their travel heading — that swing is what
    // makes a camera-relative stick spiral, so the two cannot coexist.
    this.manual = false;
    this.orbitYaw = 0; // radians added to the attack-direction base yaw
    this.orbitPitch = 0; // metres of boom lift (negative = lower, behind the shoulder)
    // Smoothed follow anchor + view yaw for the controlled swimmer.
    this.pPos = new THREE.Vector3();
    this.pYaw = 0;
    this.pInit = false;
    // Cinematic replay punch-in state (goal / gamebreaker cuts).
    this.replay = null;
    this.replayTimer = 0;
    // Scratch.
    this.rPos = new THREE.Vector3();
    this.rLook = new THREE.Vector3();
  }

  /**
   * Kept for the renderer's event bindings. Only goals and gamebreakers cut away — open play
   * (including shots and volleys) stays in the shoulder cam, which is the Rematch feel.
   * The hold length is chosen per mode inside punchIn(), never by the caller.
   */
  setMode(mode, focus = null) {
    if (mode === 'score' || mode === 'gamebreaker') {
      this.punchIn(focus, mode === 'score' ? 1.7 : 2.6);
    } else {
      this.replay = null;
      this.replayTimer = 0;
      this.focus = null;
    }
  }

  /**
   * Orbit the boom by a drag in screen pixels. Horizontal drag turns the view that way (like a
   * mouse), vertical drag raises/lowers the vantage: up for the wide look, down to sit on the
   * shoulder.
   */
  orbit(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.orbitYaw += dx * 0.006;
    // Keep the whole circle representable so a long spin can never lose precision.
    const TAU = Math.PI * 2;
    this.orbitYaw = ((this.orbitYaw % TAU) + TAU) % TAU;
    if (this.orbitYaw > Math.PI) this.orbitYaw -= TAU;
    this.orbitPitch = Math.max(-1.1, Math.min(4.6, this.orbitPitch - dy * 0.012));
  }

  /** Put the boom back behind the player's attacking direction. */
  recentre() {
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  punch(amount = 0.4) {
    if (!this.shakeEnabled || this.reducedMotion) return;
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** Brief cinematic cut toward the focus swimmer (goal / gamebreaker replay). */
  punchIn(focus, duration = 1.6) {
    this.replay = focus || null;
    this.replayTimer = this.reducedMotion ? 0 : duration;
    this.focus = focus;
  }

  update(sim, dt) {
    // Shake decay runs once per frame; both the replay and follow paths share it via apply().
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.4);
      const s = this.shake * this.shake * 0.35 * (this.reducedMotion ? 0 : 1);
      this.shakeVec.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5);
    } else this.shakeVec.set(0, 0, 0);

    const cage = sim.inCage && sim.controlled?.isKeeper;
    if (cage && sim.state === 'live') {
      this.replayTimer = 0;
      this.replay = null;
    }
    if (this.replayTimer > 0) {
      this.replayTimer -= dt;
      const f = this.replay && sim.players.includes(this.replay) ? this.replay : sim.controlled;
      if (f && this.replayTimer > 0) {
        // Low chase dolly sweeping in behind the scorer as they wheel toward their own goal.
        const dir = sim.attackDir(f.team);
        this.rPos.set(f.pos.x - dir * 3.4, 1.9 + f.y * 0.6, f.pos.z + 2.6);
        this.rLook.set(f.pos.x + dir * 6, 0.9 + f.y * 0.8, f.pos.z);
        const k = 1 - Math.exp(-dt * 5);
        this.pos.lerp(this.rPos, k);
        this.look.lerp(this.rLook, k * 1.2);
        this.fov += (55 - this.fov) * k;
        this.apply();
        return;
      }
      this.replay = null;
      this.replayTimer = 0;
    }

    const p = sim.controlled;
    if (!p) {
      // No pilot (spectator matches): a simple wide follow of the ball and the pack.
      const ball = sim.ball.pos;
      let cx = 0;
      let cz = 0;
      for (const pl of sim.players) {
        cx += pl.pos.x;
        cz += pl.pos.z;
      }
      const n = sim.players.length || 1;
      const fx = ball.x * 0.6 + (cx / n) * 0.4;
      const fz = ball.z * 0.5 + (cz / n) * 0.5;
      const desiredPos = new THREE.Vector3(THREE.MathUtils.clamp(fx * 0.7, -11, 11), 8.4, 15.8 + fz * 0.3);
      const desiredLook = new THREE.Vector3(fx * 0.9, 0.6 + ball.y * 0.2, fz * 0.55 - 1.5);
      const k = 1 - Math.exp(-dt * 3);
      this.pos.lerp(desiredPos, k);
      this.look.lerp(desiredLook, k * 1.3);
      this.fov += (44 - this.fov) * k;
      this.apply();
      return;
    }

    if (cage) {
      // Fixed behind-the-cage basis: lateral shuffling cannot spin the view or its controls.
      // Show the whole ring triangle and the attacker, not a predicted landing marker.
      const dir = sim.attackDir(p.team);
      this.pYaw = Math.atan2(dir, 0);
      this.pInit = false; // re-latch the shoulder rig when control returns to the field
      this.rPos.set(p.pos.x - dir * 3.8, 3.6, p.pos.z * 0.2 - dir * 0.65);
      this.rLook.set(p.pos.x + dir * 9, 1.2, 0);
      if ((sim.ball.pos.x - p.pos.x) * dir > 0) {
        this.rLook.y += Math.max(-0.4, Math.min(0.6, (sim.ball.pos.y - 1.2) * 0.2));
        this.rLook.z = Math.max(-1.8, Math.min(1.8, sim.ball.pos.z * 0.22));
      }
      const k = 1 - Math.exp(-dt * 12);
      this.pos.lerp(this.rPos, k);
      if (this.pos.length() > ARENA.sphereRadius - 1) this.pos.setLength(ARENA.sphereRadius - 1);
      this.look.lerp(this.rLook, k);
      this.fov += (70 - this.fov) * k;
      this.apply();
      return;
    }

    // Follow anchor eases toward the swimmer; yaw follows their travel heading when moving and
    // drifts back toward the attack direction when idle — never spins.
    if (!this.pInit) {
      this.pPos.set(p.pos.x, p.y, p.pos.z);
      this.pYaw = Math.atan2(sim.attackDir(p.team), 0) + (this.manual ? this.orbitYaw : 0);
      this.pInit = true;
    }
    this.pPos.lerp(new THREE.Vector3(p.pos.x, p.y, p.pos.z), 1 - Math.exp(-dt * 10));
    const dir = sim.attackDir(p.team);
    const spd = Math.hypot(p.vel.x, p.vel.z);
    const targetYaw = this.manual
      ? Math.atan2(dir, 0) + this.orbitYaw
      : spd > 0.8 ? Math.atan2(p.vel.x, p.vel.z) : Math.atan2(dir, 0);
    let d = (targetYaw - this.pYaw) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    // A hand-driven camera has to answer the thumb immediately; the auto-follow stays weighty.
    this.pYaw += d * (1 - Math.exp(-dt * (this.manual ? 16 : 4.5)));

    const back = new THREE.Vector3(-Math.sin(this.pYaw), 0, -Math.cos(this.pYaw));
    const right = new THREE.Vector3(Math.cos(this.pYaw), 0, -Math.sin(this.pYaw));
    // Arena wall trim: gameplay happens entirely inside the water sphere, so the boom must never
    // push the camera through the wall. Shortening the boom reads as the camera hugging the
    // swimmer when they drift toward the rim — exactly what we want.
    const boom = 3.5;
    const headY = p.y + 1.7;
    const rXZ = Math.hypot(this.pPos.x, this.pPos.z);
    const rr = Math.hypot(this.pPos.x + back.x * boom, this.pPos.z + back.z * boom);
    let trimmedBoom = boom;
    if (rr > ARENA.sphereRadius - 1.2) {
      const maxStep = Math.max(0.6, ARENA.sphereRadius - 1.2 - rXZ);
      trimmedBoom = Math.min(boom, maxStep);
    }
    const camY = Math.max(headY, -ARENA.floorY) + (this.manual ? this.orbitPitch : 0);
    // Rematch framing: low behind the shoulder, swimmer offset off-centre so you see past them.
    const desiredPos = this.pPos.clone().addScaledVector(back, trimmedBoom).addScaledVector(right, 0.55).add(new THREE.Vector3(0, camY - p.y, 0));

    const heading = new THREE.Vector3(Math.sin(this.pYaw), 0, Math.cos(this.pYaw));
    const desiredLook = this.pPos.clone().addScaledVector(heading, 6).addScaledVector(right, 0.3).add(new THREE.Vector3(0, 1.3, 0));
    // The ball drifts into frame: when it sits ahead of the view direction, lean the look target
    // part-way toward it. Never a hard lock — that was ball cam, and ball cam is gone.
    const bdx = sim.ball.pos.x - p.pos.x;
    const bdz = sim.ball.pos.z - p.pos.z;
    const bd = Math.hypot(bdx, bdz);
    if (bd > 0.5 && bd < 18) {
      const dot = (bdx / bd) * heading.x + (bdz / bd) * heading.z;
      if (dot > 0.2) {
        const ballLook = new THREE.Vector3(sim.ball.pos.x, sim.ball.pos.y * 0.8 + 0.2, sim.ball.pos.z);
        desiredLook.lerp(ballLook, 0.35 * Math.min(1, dot));
      }
    }
    // FLOW widens the view slightly — speed you can feel.
    const desiredFov = sim.flow && sim.flow[p.team] ? 72 : 64;

    const k = 1 - Math.exp(-dt * 12);
    this.pos.lerp(desiredPos, k);
    // Sphere-wall clamp on the blended position too: fast swings can lerp outside the arena even
    // when the desired position was trimmed, so the live position is clamped every frame.
    if (this.pos.length() > ARENA.sphereRadius - 1.0) this.pos.setLength(ARENA.sphereRadius - 1.0);
    this.look.lerp(desiredLook, Math.min(1, k * 1.25));
    this.fov += (desiredFov - this.fov) * k;

    this.apply();
  }

  apply() {
    this.cam.position.copy(this.pos).add(this.shakeVec);
    this.cam.lookAt(this.look);
    if (Math.abs(this.cam.fov - this.fov) > 0.05) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }

  /**
   * Drop any replay state. Called when a replay ends or is skipped: the next `update()` takes the
   * shoulder cam back, and the boom re-latches onto the controlled swimmer from wherever the
   * cinematic left the lens.
   */
  clearReplay() {
    this.replay = null;
    this.replayTimer = 0;
    this.focus = null;
    this.pInit = false;
  }

  /**
   * REPLAY CAMERA — the cinematic cut.
   *
   * Two shots with a hard cut between them, which is how every football replay works and is far
   * more legible than one continuous move:
   *
   *   A (0 → 0.52)  low tracking dolly down the line of the attack, swinging around the scorer's
   *                 outside shoulder as they release the shot. The goal mouth stays in frame so
   *                 the viewer knows where they are going.
   *   B (0.48 → 1)  behind the cage, looking back out at the shooter, the ball arcing toward the
   *                 lens. A long lens (narrow FOV) flattens the flight and reads as slow motion.
   *
   * `ball` is the interpolated ball position at the playhead, so the camera tracks the actual
   * flight rather than a guessed path. Progress 0..1 drives the cut, and every anchor is
   * sphere-trimmed like the boom so a replay near the wall can never put the camera outside the
   * pool. `dt` is the real frame time: the smoothing is exponential in dt, so a hardcoded step
   * would run the camera at half speed on a 30 Hz phone.
   */
  replayShot(sim, ball, progress, focus, team, dt = 1 / 60) {
    if (!ball) return false;
    const p = focus;
    const dir = team === 1 ? -1 : 1;
    const goalX = ARENA.goalX * dir;
    const px = p ? p.pos.x : ball.x;
    const pz = p ? p.pos.z : ball.z;
    const k = 1 - Math.exp(-dt * 9);

    if (progress < 0.52) {
      // Shot A: ride the attack, low and wide, arcing in toward the shooter's line.
      const t = progress / 0.52;
      const side = t < 0.5 ? 1 : -1; // swing across the lane as the shot is released
      this.rPos.set(
        px - dir * (4.6 - t * 1.2) + side * 2.2,
        1.5 + Math.sin(t * Math.PI) * 0.5,
        pz + 5.2 - t * 2.4
      );
      // Look at the ball early (where the pass came from), then the shooter as they wind up.
      this.rLook.set(
        ball.x * 0.6 + px * 0.4,
        0.7 + ball.y * 0.25,
        ball.z * 0.6 + pz * 0.4
      );
      this.fov += (50 - this.fov) * k;
    } else {
      // Shot B: inside the cage looking back down the shot, long lens.
      const t = (progress - 0.52) / 0.48;
      this.rPos.set(
        goalX - dir * 1.1,
        ARENA.goalY + 0.5,
        -1.6 + t * 0.6
      );
      this.rLook.set(ball.x, 0.7 + ball.y * 0.3, ball.z);
      this.fov += (30 - this.fov) * k;
    }

    // Both shots live inside the water sphere: trim rather than clip.
    const limit = ARENA.sphereRadius - 1.0;
    if (this.rPos.length() > limit) this.rPos.setLength(limit);
    this.pos.lerp(this.rPos, k);
    this.look.lerp(this.rLook, Math.min(1, k * 1.3));
    this.apply();
    return true;
  }
}
