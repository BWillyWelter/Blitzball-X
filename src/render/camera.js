import * as THREE from 'three';
import { ARENA } from '../data/constants.js';

/**
 * Broadcast-style camera for the sphere pool. Sits on the +z side of the arena looking across
 * the playing disc, dollies along x with the play, tilts toward whichever goal is under attack,
 * punches in for Gamebreakers / goals and shakes on big hits.
 */
export class GameCamera {
  constructor(camera, opts = {}) {
    this.cam = camera;
    this.pos = new THREE.Vector3(0, 9, 22);
    this.look = new THREE.Vector3(0, 0.8, 0);
    this.shake = 0;
    this.shakeVec = new THREE.Vector3();
    this.mode = 'play';
    this.modeTimer = 0;
    this.fov = 42;
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
    this.cam.fov = this.fov;
    this.cam.updateProjectionMatrix();
    this.focus = null;
    this.focusGoal = 1;
    this.firstPerson = !!opts.firstPerson;
    // 'corner' = elevated three-quarter view (reads the arena in 3D); 'side' = classic side-on.
    this.angle = opts.angle === 'side' ? 'side' : 'corner';
    // Rematch-style player lock: camera rides behind the controlled swimmer.
    this.preferPlayer = !!opts.playerCam;
    if (this.preferPlayer) this.mode = 'player';
    this.pPos = new THREE.Vector3();
    this.pYaw = 0;
  }

  punch(amount = 0.4) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  setMode(mode, duration = 1.5, focus = null) {
    this.mode = mode;
    this.modeTimer = duration;
    this.focus = focus;
  }

  update(sim, dt) {
    const ball = sim.ball.pos;
    const players = sim.players;
    let cx = 0;
    let cz = 0;
    for (const p of players) {
      cx += p.pos.x;
      cz += p.pos.z;
    }
    cx /= players.length;
    cz /= players.length;
    const focusX = ball.x * 0.6 + cx * 0.4;
    const focusZ = ball.z * 0.5 + cz * 0.5;
    const attackDir = sim.attackDir(sim.possession);
    const goalX = ARENA.goalX * attackDir;

    let desiredPos;
    let desiredLook;
    let desiredFov = 40;

    if (this.modeTimer > 0) this.modeTimer -= dt;
    else if (this.mode !== 'play' && this.mode !== 'player') this.mode = this.preferPlayer ? 'player' : 'play';
    else if (this.mode === 'play' && this.preferPlayer) this.mode = 'player';

    if (this.mode === 'player' && sim.controlled) {
      // Third-person player lock: float behind the controlled swimmer, yaw easing toward the
      // attack direction so "up on the stick" generally means "toward their goal".
      const p = sim.controlled;
      const dir = sim.attackDir(p.team);
      this.pPos.lerp(new THREE.Vector3(p.pos.x, p.y, p.pos.z), 1 - Math.exp(-dt * 10));
      const targetYaw = Math.atan2(dir, 0);
      let d = (targetYaw - this.pYaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.pYaw += d * (1 - Math.exp(-dt * 4.5));
      const back = new THREE.Vector3(-Math.sin(this.pYaw), 0, -Math.cos(this.pYaw));
      desiredPos = this.pPos.clone().addScaledVector(back, 5.4).add(new THREE.Vector3(0, 3.1, 0));
      desiredLook = this.pPos.clone().addScaledVector(new THREE.Vector3(Math.sin(this.pYaw), 0, Math.cos(this.pYaw)), 4.5).add(new THREE.Vector3(0, 0.9, 0));
      // FLOW widens the view slightly — speed you can feel.
      desiredFov = sim.flow && sim.flow[p.team] ? 70 : 62;
    } else if (this.firstPerson && sim.controlled) {
      const p = sim.controlled;
      const forward = new THREE.Vector3(Math.sin(p.facing), 0, Math.cos(p.facing));
      desiredPos = new THREE.Vector3(p.pos.x, p.y + 1.72, p.pos.z).addScaledVector(forward, 0.08);
      desiredLook = desiredPos.clone().addScaledVector(forward, 5).add(new THREE.Vector3(0, 0.15, 0));
      desiredFov = 76;
    } else switch (this.mode) {
      case 'goalcam': {
        // Low angle beside the goal under attack, looking back at the play.
        const f = this.focus;
        const gx = f ? ARENA.goalX * sim.attackDir(f.team) : goalX;
        desiredPos = new THREE.Vector3(gx * 0.72, 2.6, 9.5);
        desiredLook = new THREE.Vector3(gx * 0.9, ARENA.goalY + 0.2, 0);
        desiredFov = 36;
        break;
      }
      case 'gamebreaker': {
        const f = this.focus;
        const px = f ? f.pos.x : 0;
        const pz = f ? f.pos.z : 0;
        const dir = f ? sim.attackDir(f.team) : 1;
        desiredPos = new THREE.Vector3(px - dir * 4.5, 1.9 + (f ? f.y : 0) * 0.5, pz + 4.5);
        desiredLook = new THREE.Vector3(px + dir * 2, 1.0 + (f ? f.y : 0), pz);
        desiredFov = 34;
        break;
      }
      case 'score': {
        const f = this.focus;
        const gx = f ? ARENA.goalX * sim.attackDir(f.team) : goalX;
        desiredPos = new THREE.Vector3(gx * 0.55, 4.2, 12);
        desiredLook = new THREE.Vector3(gx * 0.85, ARENA.goalY + 0.6, 0);
        desiredFov = 38;
        break;
      }
      default: {
        // Broadcast views. 'corner': elevated three-quarter angle — pulling the camera higher and
        // shifting the look target toward the far wall turns the side-on profile into an angled
        // corner view, so the arena's depth (both goal rings, the far stands) reads as 3D space.
        // 'side': the original flatter profile.
        const lateral = THREE.MathUtils.clamp(focusX * 0.7 + goalX * 0.12, -11, 11);
        const depth = THREE.MathUtils.clamp(focusZ, -5, 5);
        const corner = this.angle === 'corner';
        desiredPos = new THREE.Vector3(lateral, corner ? 8.4 + Math.abs(depth) * 0.12 : 6.6 + Math.abs(depth) * 0.1, corner ? 15.8 + depth * 0.3 : 14.5 + depth * 0.45);
        desiredLook = new THREE.Vector3(focusX * 0.88 + goalX * 0.1, 0.6 + ball.y * 0.22, focusZ * (corner ? 0.55 : 0.6) - (corner ? 1.7 : 0.8));
        let spread = 0;
        for (const p of players) if (!p.isKeeper) spread = Math.max(spread, Math.abs(p.pos.x - focusX));
        desiredFov = 40 + THREE.MathUtils.clamp((spread - 5) * 1.4, 0, 10);
      }
    }

    const k = 1 - Math.exp(-dt * (this.mode === 'play' ? 3.0 : 5.5));
    this.pos.lerp(desiredPos, k);
    this.look.lerp(desiredLook, k * 1.3);
    this.fov += (desiredFov - this.fov) * k;

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.4);
      const s = this.shake * this.shake * 0.35;
      this.shakeVec.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5);
    } else this.shakeVec.set(0, 0, 0);

    this.cam.position.copy(this.pos).add(this.shakeVec);
    this.cam.lookAt(this.look);
    if (Math.abs(this.cam.fov - this.fov) > 0.05) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
  }
