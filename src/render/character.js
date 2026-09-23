  update(p, sim, dt, ballHeldByMe) {
    const visualDt = Number.isFinite(dt)
      ? Math.max(0, Math.min(MAX_VISUAL_DT, dt))
      : 0;

    this.t += visualDt;

    const root = this.root;
    root.position.set(
      p.pos.x,
      p.y,
      p.pos.z
    );
    root.rotation.y = p.facing;

    const speed = Math.max(
      0,
      Math.min(
        1,
        Number.isFinite(p.speedNorm)
          ? p.speedNorm
          : 0
      )
    );

    const state = p.state || 'idle';
    const time = Number.isFinite(p.anim?.t)
      ? p.anim.t
      : this.t;

    const stateTime = Math.max(
      0,
      Number.isFinite(p.stateTime)
        ? p.stateTime
        : 0
    );

    const stateDuration = Math.max(
      0.01,
      Number.isFinite(p.stateDur)
        ? p.stateDur
        : 0.01
    );

    const arms = this.arms;
    const legs = this.legs;
    const joints = this.joints;

    const previousBodyY = this.body.position.y;
    const previousBodyZ = this.body.position.z;
    const previousHipsY = this.hips.position.y;

    const fromX = this.poseFromX;
    const fromY = this.poseFromY;
    const fromZ = this.poseFromZ;

    // Capture the previous pose, then reuse the same rig objects
    // for the new target pose. No arrays or pose objects are created here.
    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i];

      fromX[i] = joint.rotation.x;
      fromY[i] = joint.rotation.y;
      fromZ[i] = joint.rotation.z;

      joint.rotation.set(0, 0, 0);
    }

    this.body.position.set(0, 0, 0);

    let hipY = 1.0;

    switch (state) {
      case 'idle':
      case 'swim':
      case 'catch':
      case 'gbdrive': {
        const pitch = Math.min(
          1.25,
          speed * 1.6 +
            (state === 'gbdrive' ? 1.2 : 0)
        );

        if (
          speed > 0.06 ||
          state === 'gbdrive'
        ) {
          this.applySwimCycle(
            time,
            0.5 + speed * 0.9,
            6 + speed * 8,
            pitch
          );
        } else {
          hipY = this.applyTreadWater(time);
        }

        if (
          ballHeldByMe ||
          state === 'catch'
        ) {
          this.applyTuckBall();
        }

        if (state === 'catch') {
          arms[0].shoulder.rotation.x = -1.6;
          arms[0].elbow.rotation.x = -1.4;
        }

        break;
      }

      case 'gbwind': {
        const u = Math.min(
          1,
          stateTime / 0.6
        );

        hipY = this.applyTreadWater(time);

        this.body.rotation.x = -0.25 * u;
        hipY = 1.0 + u * 0.2;

        arms[0].shoulder.rotation.x = -2.9 * u;
        arms[1].shoulder.rotation.x = -2.9 * u;

        arms[0].shoulder.rotation.z = -0.4;
        arms[1].shoulder.rotation.z = 0.4;

        arms[0].elbow.rotation.x = -0.4;
        arms[1].elbow.rotation.x = -0.4;

        this.neck.rotation.x = -0.4 * u;

        break;
      }

      case 'trick': {
        const u = Math.min(
          1,
          stateTime / stateDuration
        );

        const trickId = p.trick?.def?.id ?? 0;

        this.applySwimCycle(
          time,
          0.6,
          12,
          0.9
        );

        this.applyTuckBall();

        switch (trickId) {
          case 0:
            // Spin.
            this.body.rotation.y =
              u * Math.PI * 2;
            break;

          case 1:
            // Barrel roll.
            this.body.rotation.z =
              u * Math.PI * 2;
            break;

          case 2:
            // Dolphin kick.
            this.body.rotation.x =
              0.9 +
              Math.sin(u * Math.PI * 2) * 0.7;

            legs[0].hip.rotation.x =
              legs[1].hip.rotation.x =
                Math.sin(u * Math.PI * 4) * 0.9;

            legs[0].knee.rotation.x =
              legs[1].knee.rotation.x =
                Math.max(
                  0,
                  Math.cos(u * Math.PI * 4)
                );

            arms[0].shoulder.rotation.x =
              arms[1].shoulder.rotation.x =
                -Math.PI;

            arms[0].elbow.rotation.x =
              arms[1].elbow.rotation.x =
                -0.1;

            this.applyTuckBall();
            break;

          case 3:
            // Corkscrew.
            this.body.rotation.z =
              u * Math.PI * 2;

            this.body.rotation.y =
              Math.sin(u * Math.PI) * 0.8;
            break;

          case 4:
            // Back-flip feint.
            this.body.rotation.x =
              0.9 - u * Math.PI * 2;
            break;

          default:
            // Jet stream.
            this.body.rotation.x = 1.3;

            legs[0].hip.rotation.x =
              legs[1].hip.rotation.x =
                Math.sin(time * 26) * 0.35;

            arms[0].shoulder.rotation.x =
              -Math.PI;

            arms[0].elbow.rotation.x =
              -0.05;

            this.body.rotation.z =
              Math.sin(u * Math.PI * 3) * 0.4;

            break;
        }

        break;
      }

      case 'shoot': {
        const wind =
          p.shot &&
          Number.isFinite(p.shot.wind)
            ? Math.max(0.01, p.shot.wind)
            : 0.75;

        const u = Math.min(
          1.2,
          stateTime / wind
        );

        const released =
          !!p.shot?.released;

        hipY = this.applyTreadWater(time);

        if (!released) {
          const w = Math.min(1, u);

          this.torso.rotation.y =
            -0.6 * w;

          this.body.rotation.x =
            -0.15 * w;

          arms[1].shoulder.rotation.x =
            -2.4 - w * 0.6;

          arms[1].shoulder.rotation.z =
            0.5;

          arms[1].elbow.rotation.x =
            -1.8;

          arms[0].shoulder.rotation.x =
            -1.5;

          arms[0].shoulder.rotation.z =
            -0.2;

          arms[0].elbow.rotation.x =
            -0.2;

          legs[1].hip.rotation.x =
            -0.5 * w;

          legs[0].hip.rotation.x =
            0.4 * w;

          hipY = 1.0 + w * 0.12;
        } else {
          const r = Math.min(
            1,
            stateTime / 0.3
          );

          this.torso.rotation.y =
            0.5 * r;

          this.body.rotation.x =
            0.55 * r;

          arms[1].shoulder.rotation.x =
            -2.9 + r * 2.4;

          arms[1].shoulder.rotation.z =
            0.2;

          arms[1].elbow.rotation.x =
            -0.1;

          arms[0].shoulder.rotation.x =
            0.3;

          arms[0].shoulder.rotation.z =
            -0.9;

          legs[0].hip.rotation.x =
            -0.6 * r;

          legs[1].hip.rotation.x =
            0.7 * r;

          legs[1].knee.rotation.x =
            0.8 * r;

          this.neck.rotation.x =
            0.2 * r;
        }

        break;
      }

      case 'volley': {
        const u = Math.min(
          1,
          stateTime / 0.45
        );

        const kick =
          Math.sin(u * Math.PI);

        this.body.rotation.x =
          -0.4 + kick * 0.9;

        legs[1].hip.rotation.x =
          -1.8 * kick;

        legs[1].knee.rotation.x =
          0.2;

        legs[0].hip.rotation.x =
          0.9 * kick;

        legs[0].knee.rotation.x =
          1.2 * kick;

        arms[0].shoulder.rotation.x =
          -2.4;

        arms[1].shoulder.rotation.x =
          0.8;

        arms[0].shoulder.rotation.z =
          -0.5;

        arms[1].shoulder.rotation.z =
          0.7;

        this.torso.rotation.y =
          -0.4 * kick;

        break;
      }

      case 'breach': {
        const rising = p.vy > 0;
        const stretch = rising ? 1 : 0.6;

        this.body.rotation.x = -0.15;

        arms[0].shoulder.rotation.x =
          -Math.PI * stretch;

        arms[1].shoulder.rotation.x =
          -Math.PI * stretch;

        arms[0].shoulder.rotation.z =
          -0.15;

        arms[1].shoulder.rotation.z =
          0.15;

        arms[0].elbow.rotation.x =
          -0.1;

        arms[1].elbow.rotation.x =
          -0.1;

        legs[0].hip.rotation.x = 0.1;
        legs[1].hip.rotation.x = 0.1;

        legs[0].knee.rotation.x =
          rising ? 0.15 : 0.9;

        legs[1].knee.rotation.x =
          rising ? 0.15 : 0.9;

        this.neck.rotation.x = -0.4;

        if (ballHeldByMe) {
          this.applyTuckBall();
        }

        break;
      }

      case 'pass': {
        const u = Math.min(
          1,
          stateTime / 0.22
        );

        hipY = this.applyTreadWater(time);

        this.body.rotation.x =
          0.3 + u * 0.2;

        arms[0].shoulder.rotation.x =
          -1.5 - u * 0.3;

        arms[1].shoulder.rotation.x =
          -1.5 - u * 0.3;

        arms[0].shoulder.rotation.z =
          -0.2;

        arms[1].shoulder.rotation.z =
          0.2;

        arms[0].elbow.rotation.x =
          -1.3 + u * 1.3;

        arms[1].elbow.rotation.x =
          -1.3 + u * 1.3;

        break;
      }

      case 'tackle': {
        const u = Math.min(
          1,
          stateTime / 0.4
        );

        const lunge =
          Math.sin(u * Math.PI);

        this.body.rotation.x =
          0.6 + lunge * 0.9;

        this.body.position.y =
          -lunge * 0.35;

        this.body.position.z =
          lunge * 0.3;

        arms[1].shoulder.rotation.x =
          -Math.PI + 0.2;

        arms[1].elbow.rotation.x =
          -0.1;

        arms[0].shoulder.rotation.x =
          -2.3;

        arms[0].elbow.rotation.x =
          -0.6;

        legs[0].hip.rotation.x =
          -0.5 * lunge;

        legs[1].hip.rotation.x =
          0.6 * lunge;

        legs[1].knee.rotation.x =
          0.6 * lunge;

        this.neck.rotation.x =
          -0.5;

        break;
      }

      case 'hit': {
        const u = Math.min(
          1,
          stateTime / 0.42
        );

        const push =
          Math.sin(u * Math.PI);

        this.body.rotation.x =
          0.35 * push;

        this.torso.rotation.y =
          0.7 * push;

        arms[1].shoulder.rotation.x =
          -1.2 * push;

        arms[1].shoulder.rotation.z =
          0.9 * push;

        arms[1].elbow.rotation.x =
          -1.6;

        arms[0].shoulder.rotation.x =
          0.6 * push;

        arms[0].shoulder.rotation.z =
          -0.5;

        legs[0].hip.rotation.x =
          0.5 * push;

        legs[1].hip.rotation.x =
          -0.4 * push;

        legs[0].knee.rotation.x =
          0.8 * push;

        break;
      }

      case 'save': {
        const u = Math.min(
          1,
          stateTime / 0.55
        );

        const dive = Math.sin(
          Math.min(1, u * 1.4) *
            Math.PI *
            0.5
        );

        const side =
          (p.knockDir?.z ?? 0) >= 0
            ? 1
            : -1;

        this.body.rotation.z =
          side * dive * 1.3;

        this.body.position.y =
          dive * 0.2;

        arms[0].shoulder.rotation.x =
          -Math.PI + 0.1;

        arms[1].shoulder.rotation.x =
          -Math.PI + 0.1;

        arms[0].shoulder.rotation.z =
          -0.1;

        arms[1].shoulder.rotation.z =
          0.1;

        arms[0].elbow.rotation.x =
          -0.05;

        arms[1].elbow.rotation.x =
          -0.05;

        legs[0].hip.rotation.x =
          -0.2;

        legs[1].hip.rotation.x =
          0.4 * dive;

        legs[1].knee.rotation.x =
          0.7 * dive;

        this.neck.rotation.x =
          -0.3;

        break;
      }

      case 'stumble': {
        const u = Math.min(
          1,
          stateTime / stateDuration
        );

        hipY = this.applyTreadWater(time);

        this.body.rotation.x =
          0.8 * Math.sin(u * Math.PI);

        this.body.rotation.z =
          0.6 * Math.sin(u * Math.PI * 2);

        this.body.rotation.y =
          Math.sin(u * Math.PI) * 1.2;

        arms[0].shoulder.rotation.z =
          -1.6;

        arms[1].shoulder.rotation.z =
          1.6;

        break;
      }

      case 'fallen': {
        const u = Math.min(
          1,
          stateTime / stateDuration
        );

        const tumble = Math.min(
          1,
          u * 1.8
        );

        const recover =
          u > 0.7
            ? (u - 0.7) / 0.3
            : 0;

        this.body.rotation.x =
          tumble * Math.PI * 2 *
          (1 - recover);

        this.body.rotation.z =
          Math.sin(u * Math.PI) *
          0.8 *
          (1 - recover);

        this.body.position.y =
          -Math.sin(u * Math.PI) * 0.5;

        arms[0].shoulder.rotation.z =
          -1.4 * (1 - recover);

        arms[1].shoulder.rotation.z =
          1.4 * (1 - recover);

        arms[0].shoulder.rotation.x =
          -0.5;

        arms[1].shoulder.rotation.x =
          -0.5;

        legs[0].hip.rotation.x =
          -0.3;

        legs[1].hip.rotation.x =
          0.5;

        legs[1].knee.rotation.x =
          0.9;

        legs[0].knee.rotation.x =
          0.4;

        if (recover > 0) {
          hipY = this.applyTreadWater(time);
        }

        break;
      }

      case 'celebrate': {
        const u = stateTime;
        const bounce =
          Math.abs(Math.sin(u * 7));

        hipY = this.applyTreadWater(time);
        hipY = 1.0 + bounce * 0.15;

        arms[0].shoulder.rotation.x =
          -2.8 + Math.sin(u * 9) * 0.3;

        arms[1].shoulder.rotation.x =
          -2.8 - Math.sin(u * 9) * 0.3;

        arms[0].shoulder.rotation.z =
          -0.5;

        arms[1].shoulder.rotation.z =
          0.5;

        arms[0].elbow.rotation.x =
          -0.6;

        arms[1].elbow.rotation.x =
          -0.6;

        this.neck.rotation.x =
          -0.35;

        this.body.rotation.x =
          -0.1;

        break;
      }

      default:
        hipY = this.applyTreadWater(time);
        break;
    }

    this.hips.position.y = hipY;

    if (
      (state === 'swim' ||
        state === 'idle') &&
      speed > 0.2
    ) {
      let facingDelta =
        p.facing -
        (p.prevFacing ?? p.facing);

      while (facingDelta > Math.PI) {
        facingDelta -= Math.PI * 2;
      }

      while (facingDelta < -Math.PI) {
        facingDelta += Math.PI * 2;
      }

      this.torso.rotation.z +=
        -Math.sin(facingDelta) * 0.5;
    }

    // Keep the previous facing value for smooth turn banking.
    p.prevFacing = p.facing;

    const height = Number.isFinite(p.y)
      ? p.y
      : 0;

    const shadowScale = Math.max(
      0.35,
      1 - height * 0.18
    );

    this.shadow.scale.setScalar(
      shadowScale
    );

    this.shadow.position.y =
      0.012 - height;

    this.shadow.material.opacity =
      0.4 * shadowScale;

    this.ring.position.y =
      0.02 - height;

    this.turboGlow.position.y =
      0.03 - height;

    this.ring.visible =
      !!p.controlled &&
      sim.userTeam !== null &&
      sim.userTeam === p.team;

    if (this.ring.visible) {
      const pulse =
        0.85 +
        Math.sin(this.t * 6) * 0.15;

      this.ring.scale.setScalar(pulse);
      this.ring.material.opacity = 0.75;
    }

    const turboMaterial =
      this.turboGlow.material;

    const turboTarget =
      p.turboActive ||
      state === 'gbdrive'
        ? 0.85
        : 0;

    turboMaterial.opacity +=
      (
        turboTarget -
        turboMaterial.opacity
      ) *
      smoothFactor(
        visualDt,
        10
      );

    this.turboGlow.rotation.z +=
      visualDt * 4;

    this.turboGlow.scale.setScalar(
      1 +
      Math.sin(this.t * 14) *
        0.08
    );

    const firstPose = !this.poseReady;

    const poseBlend = firstPose
      ? 1
      : smoothFactor(
          visualDt,
          18
        );

    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i];

      joint.rotation.x = dampAngle(
        fromX[i],
        joint.rotation.x,
        poseBlend
      );

      joint.rotation.y = dampAngle(
        fromY[i],
        joint.rotation.y,
        poseBlend
      );

      joint.rotation.z = dampAngle(
        fromZ[i],
        joint.rotation.z,
        poseBlend
      );
    }

    const positionBlend = firstPose
      ? 1
      : smoothFactor(
          visualDt,
          14
        );

    this.body.position.y =
      blendNumber(
        previousBodyY,
        this.body.position.y,
        positionBlend
      );

    this.body.position.z =
      blendNumber(
        previousBodyZ,
        this.body.position.z,
        positionBlend
      );

    this.hips.position.y =
      blendNumber(
        previousHipsY,
        hipY,
        positionBlend
      );

    this.poseReady = true;
  }

  applySwimCycle(
    time,
    amplitude,
    frequency,
    pitch
  ) {
    const arms = this.arms;
    const legs = this.legs;

    const phase = time * frequency;
    const sine = Math.sin(phase);
    const cosine = Math.cos(phase);

    this.body.rotation.x = pitch;
    this.body.position.y =
      -pitch * 0.35;

    this.body.position.z =
      pitch * 0.25;

    legs[0].hip.rotation.x =
      sine * amplitude * 0.5;

    legs[1].hip.rotation.x =
      -sine * amplitude * 0.5;

    legs[0].knee.rotation.x =
      Math.max(0, -cosine) *
        amplitude *
        0.6 +
      0.1;

    legs[1].knee.rotation.x =
      Math.max(0, cosine) *
        amplitude *
        0.6 +
      0.1;

    const leftStroke =
      phase * 0.5;

    const rightStroke =
      leftStroke + Math.PI;

    const leftCosine =
      Math.cos(leftStroke);

    const rightCosine =
      Math.cos(rightStroke);

    arms[0].shoulder.rotation.x =
      -Math.PI +
      Math.sin(leftStroke) * 1.4;

    arms[1].shoulder.rotation.x =
      -Math.PI +
      Math.sin(rightStroke) * 1.4;

    arms[0].shoulder.rotation.z =
      -0.35 -
      Math.max(0, leftCosine) * 0.5;

    arms[1].shoulder.rotation.z =
      0.35 +
      Math.max(0, rightCosine) * 0.5;

    arms[0].elbow.rotation.x =
      -0.3 -
      Math.max(0, leftCosine) * 0.9;

    arms[1].elbow.rotation.x =
      -0.3 -
      Math.max(0, rightCosine) * 0.9;

    this.hips.rotation.y =
      sine * 0.15 * amplitude;

    this.torso.rotation.z =
      Math.sin(leftStroke) * 0.15;

    this.neck.rotation.x =
      -pitch * 0.8;
  }

  applyTreadWater(time) {
    const arms = this.arms;
    const legs = this.legs;

    const bob =
      Math.sin(time * 2.2);

    const kick =
      Math.sin(time * 4);

    const stroke =
      Math.sin(time * 2.6);

    this.body.rotation.x = 0.12;

    legs[0].hip.rotation.x =
      0.25 + kick * 0.2;

    legs[1].hip.rotation.x =
      0.25 - kick * 0.2;

    legs[0].knee.rotation.x = 0.55;
    legs[1].knee.rotation.x = 0.55;

    legs[0].hip.rotation.z = 0.12;
    legs[1].hip.rotation.z = -0.12;

    arms[0].shoulder.rotation.z =
      -1.1 + stroke * 0.15;

    arms[1].shoulder.rotation.z =
      1.1 - stroke * 0.15;

    arms[0].shoulder.rotation.x = -0.4;
    arms[1].shoulder.rotation.x = -0.4;

    arms[0].elbow.rotation.x = -0.9;
    arms[1].elbow.rotation.x = -0.9;

    return 1.0 + bob * 0.03;
  }

  applyTuckBall() {
    const rightArm = this.arms[1];

    rightArm.shoulder.rotation.x =
      -0.9;

    rightArm.shoulder.rotation.z =
      0.25;

    rightArm.elbow.rotation.x =
      -1.9;
  }

  // Chunk 3 starts here.
import * as THREE from 'three';
import { toon, withOutline, makeCanvas, canvasTexture, shade } from './materials.js';

const SKIN = ['#f1c27d', '#c68642', '#8d5524', '#5c3a21'];
const HAIR = ['#111111', '#3b2314', '#f2d16b', '#d8d8d8', '#c0392b', '#111111'];

/**
 * Procedural stylized baller: exaggerated proportions (big hands/shoes, long limbs),
 * cel-shaded with an inverted-hull outline, jersey number decal, team colors.
 * Animated procedurally from sim state (run cycle, dribble, jump, shoot, dunk, tricks, fall).
 */
export class CharacterView {
  constructor(playerData, team) {
    this.data = playerData;
    this.team = team;
    this.root = new THREE.Group();
    this.root.name = `player_${playerData.id}`;
    this.build();
    this.t = 0;
    this.poseReady = false;
  }

  build() {
    const d = this.data;
    const skinMat = toon(SKIN[d.skin % SKIN.length]);
    // Keepers wear the accent colour so they read instantly.
    const isGK = d.role === 'GK';
    const jerseyMat = toon(isGK ? this.team.accent : this.team.primary);
    const shortsMat = toon(this.team.secondary);
    const trimMat = toon(isGK ? this.team.primary : this.team.accent);
    const shoeMat = toon(shade(this.team.accent, -0.1));
    const hairMat = toon(HAIR[d.hair % HAIR.length]);

    const body = new THREE.Group();
    body.name = 'body';
    this.body = body;
    this.root.add(body);

    // Hips / pelvis
    this.hips = new THREE.Group();
    this.hips.position.y = 1.0;
    body.add(this.hips);

    // Torso
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    const torsoMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.42, 4, 10), jerseyMat);
    torsoMesh.position.y = 0.42;
    torsoMesh.scale.set(1.15, 1, 0.8);
    torsoMesh.castShadow = true;
    this.torso.add(withOutline(torsoMesh, 0.04));

    // Jersey number decals (front/back)
    const numTex = this.numberTexture();
    const decalMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), decalMat);
    front.position.set(0, 0.42, 0.215);
    this.torso.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), decalMat);
    back.position.set(0, 0.46, -0.215);
    back.rotation.y = Math.PI;
    this.torso.add(back);

    // Shoulders trim
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), trimMat);
      pad.position.set(s * 0.29, 0.68, 0);
      this.torso.add(pad);
    }

    // Head
    this.neck = new THREE.Group();
    this.neck.position.y = 0.82;
    this.torso.add(this.neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), skinMat);
    head.position.y = 0.16;
    head.scale.set(0.95, 1.08, 0.95);
    head.castShadow = true;
    this.neck.add(withOutline(head, 0.035));
    // Swim goggles (every swimmer)
    const goggles = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 8, 20, Math.PI * 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.team.accent) }));
    goggles.rotation.x = Math.PI / 2;
    goggles.rotation.z = -Math.PI * 0.05;
    goggles.position.set(0, 0.19, 0.0);
    this.neck.add(goggles);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.06), new THREE.MeshBasicMaterial({ color: 0x8ff7ff }));
    visor.position.set(0, 0.19, 0.17);
    this.neck.add(visor);
    // Hair / headband
    const hairStyle = d.hair % 6;
    if (hairStyle === 0) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat);
      h.position.y = 0.19;
      this.neck.add(h);
    } else if (hairStyle === 1) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
      h.position.y = 0.2;
      this.neck.add(h);
    } else if (hairStyle === 2) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 8, 16), trimMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.22;
      this.neck.add(band);
    } else if (hairStyle === 3) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.205, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), shortsMat);
      cap.position.y = 0.18;
      this.neck.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.18), shortsMat);
      brim.position.set(0, 0.2, 0.25);
      this.neck.add(brim);
    } else if (hairStyle === 4) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.3), hairMat);
      h.position.y = 0.3;
      this.neck.add(h);
    } else {
      // braids
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.25, 3, 6), hairMat);
        const a = (i / 6) * Math.PI * 2;
        b.position.set(Math.cos(a) * 0.14, 0.12, Math.sin(a) * 0.14 - 0.05);
        b.rotation.z = Math.cos(a) * 0.5;
        b.rotation.x = -Math.sin(a) * 0.5;
        this.neck.add(b);
      }
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), hairMat);
      top.position.y = 0.19;
      this.neck.add(top);
    }
    // Eyes (cartoon)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat);
      e.position.set(s * 0.07, 0.17, 0.165);
      e.scale.set(1, 1.3, 0.5);
      this.neck.add(e);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), pupilMat);
      p.position.set(s * 0.07, 0.17, 0.182);
      this.neck.add(p);
    }
    // Brow (angry)
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.03), hairMat);
    brow.position.set(0, 0.215, 0.17);
    this.neck.add(brow);

    // Arms
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.32, 0.66, 0);
      this.torso.add(shoulder);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 8), skinMat);
      upper.position.y = -0.2;
      upper.castShadow = true;
      shoulder.add(withOutline(upper, 0.03));
      const elbow = new THREE.Group();
      elbow.position.y = -0.38;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.3, 4, 8), skinMat);
      fore.position.y = -0.2;
      fore.castShadow = true;
      elbow.add(withOutline(fore, 0.03));
      // Sweatband
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 10), trimMat);
      band.position.y = -0.33;
      elbow.add(band);
      // Big cartoon hand
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), skinMat);
      hand.position.y = -0.42;
      hand.scale.set(1, 1.15, 0.7);
      elbow.add(withOutline(hand, 0.03));
      hand.name = 'hand';
      this.arms.push({ shoulder, elbow, hand, side: s });
    }

    // Legs
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.14, 0.02, 0);
      this.hips.add(hip);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 4, 8), shortsMat);
      thigh.position.y = -0.22;
      thigh.castShadow = true;
      hip.add(withOutline(thigh, 0.035));
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      hip.add(knee);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.34, 4, 8), skinMat);
      shin.position.y = -0.2;
      shin.castShadow = true;
      knee.add(withOutline(shin, 0.03));
      // Sock
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.14, 10), toon('#f5f5f5'));
      sock.position.y = -0.34;
      knee.add(sock);
      // Big shoe
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.13, 0.34), shoeMat);
      shoe.position.set(0, -0.46, 0.06);
      shoe.castShadow = true;
      knee.add(withOutline(shoe, 0.03));
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.36), toon('#f5f5f5'));
      sole.position.set(0, -0.53, 0.06);
      knee.add(sole);
      this.legs.push({ hip, knee, side: s });
    }

    // Shorts (belt) trim
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.31, 0.16, 12), shortsMat);
    belt.position.y = 0.0;
    belt.scale.set(1.1, 1, 0.8);
    this.hips.add(withOutline(belt, 0.03));
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.315, 0.05, 12), trimMat);
    stripe.position.y = 0.06;
    stripe.scale.set(1.1, 1, 0.8);
    this.hips.add(stripe);

    // Blob shadow
    const shadowTex = blobShadowTexture();
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);

    // Selection ring (user-controlled indicator)
    const ringGeo = new THREE.RingGeometry(0.5, 0.62, 32);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    this.root.add(this.ring);

    // Turbo glow (under feet)
    this.turboGlow = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.75, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.team.accent), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.turboGlow.rotation.x = -Math.PI / 2;
    this.turboGlow.position.y = 0.03;
    this.turboGlow.renderOrder = 2;
    this.root.add(this.turboGlow);

    // Floating nametag (Rematch-style identifier over every swimmer). Depth-test off so it
    // never sinks into bodies or nets; sprites face the camera for free.
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTexture(), transparent: true, depthWrite: false, depthTest: false }));
    this.tag.scale.set(1.7, 0.42, 1);
    this.tag.position.y = 2.4;
    this.tag.renderOrder = 20;
    this.root.add(this.tag);
  }

  numberTexture() {
    const c = makeCanvas(128, 128);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = '900 92px "Barlow Condensed", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = this.team.secondary;
    ctx.strokeText(String(this.data.number), 64, 70);
    ctx.fillStyle = this.team.accent;
    ctx.fillText(String(this.data.number), 64, 70);
    return canvasTexture(c);
  }

  /** Small dark chip with the swimmer's nickname and a team-colour accent bar. */
  tagTexture() {
    const c = makeCanvas(256, 64);
    const ctx = c.getContext('2d');
    const label = String(this.data.nick || this.data.name).toUpperCase();
    ctx.font = '700 34px "Barlow Condensed", Impact, sans-serif';
    const w = Math.min(246, ctx.measureText(label).width + 44);
    const x0 = 128 - w / 2;
    ctx.fillStyle = 'rgba(8,12,20,0.72)';
    ctx.beginPath();
    ctx.roundRect(128 - w / 2, 8, w, 44, 8);
    ctx.fill();
    ctx.fillStyle = this.team.primary;
    ctx.fillRect(x0 + 8, 16, 4, 28);
    ctx.fillStyle = '#f2f6fa';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 132, 31);
    return canvasTexture(c);
  }

  /**
   * Drive the rig from sim state. All poses are computed analytically.
   */
  update(p, sim, dt, ballHeldByMe) {
    this.t += dt;
    const root = this.root;
    root.position.set(p.pos.x, p.y, p.pos.z);
    root.rotation.y = p.facing;

    const speed = p.speedNorm; // 0..1
    const st = p.state;
    const time = p.anim.t;
    const A = this.arms;
    const L = this.legs;
    const joints = [this.body, this.torso, this.hips, this.neck, ...A.flatMap((a) => [a.shoulder, a.elbow]), ...L.flatMap((l) => [l.hip, l.knee])];
    const previousPose = joints.map((joint) => ({ x: joint.rotation.x, y: joint.rotation.y, z: joint.rotation.z }));
    const resetJoint = (g) => g.rotation.set(0, 0, 0);
    for (const a of A) {
      resetJoint(a.shoulder);
      resetJoint(a.elbow);
    }
    for (const l of L) {
      resetJoint(l.hip);
      resetJoint(l.knee);
    }
    this.torso.rotation.set(0, 0, 0);
    this.hips.rotation.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    let hipY = 1.0;

    // Swimming: the whole body pitches forward toward horizontal with speed; legs flutter-kick,
    // arms alternate a freestyle stroke (or one arm tucks the ball).
    const swimCycle = (amp, freq, pitch) => {
      const ph = time * freq;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      this.body.rotation.x = pitch; // pitch forward (nose down toward travel direction)
      this.body.position.y = -pitch * 0.35;
      this.body.position.z = pitch * 0.25;
      L[0].hip.rotation.x = s * amp * 0.5;
      L[1].hip.rotation.x = -s * amp * 0.5;
      L[0].knee.rotation.x = Math.max(0, -c) * amp * 0.6 + 0.1;
      L[1].knee.rotation.x = Math.max(0, c) * amp * 0.6 + 0.1;
      // freestyle stroke: shoulders rotate through a full circle
      const strokeL = ph * 0.5;
      const strokeR = ph * 0.5 + Math.PI;
      A[0].shoulder.rotation.x = -Math.PI + Math.sin(strokeL) * 1.4;
      A[1].shoulder.rotation.x = -Math.PI + Math.sin(strokeR) * 1.4;
      A[0].shoulder.rotation.z = -0.35 - Math.max(0, Math.cos(strokeL)) * 0.5;
      A[1].shoulder.rotation.z = 0.35 + Math.max(0, Math.cos(strokeR)) * 0.5;
      A[0].elbow.rotation.x = -0.3 - Math.max(0, Math.cos(strokeL)) * 0.9;
      A[1].elbow.rotation.x = -0.3 - Math.max(0, Math.cos(strokeR)) * 0.9;
      this.hips.rotation.y = s * 0.15 * amp;
      this.torso.rotation.z = Math.sin(strokeL) * 0.15;
      this.neck.rotation.x = -pitch * 0.8; // look ahead
    };

    const treadWater = () => {
      const b = Math.sin(time * 2.2);
      hipY = 1.0 + b * 0.03;
      this.body.rotation.x = 0.12;
      L[0].hip.rotation.x = 0.25 + Math.sin(time * 4) * 0.2;
      L[1].hip.rotation.x = 0.25 - Math.sin(time * 4) * 0.2;
      L[0].knee.rotation.x = 0.55;
      L[1].knee.rotation.x = 0.55;
      L[0].hip.rotation.z = 0.12;
      L[1].hip.rotation.z = -0.12;
      A[0].shoulder.rotation.z = -1.1 + Math.sin(time * 2.6) * 0.15;
      A[1].shoulder.rotation.z = 1.1 - Math.sin(time * 2.6) * 0.15;
      A[0].shoulder.rotation.x = -0.4;
      A[1].shoulder.rotation.x = -0.4;
      A[0].elbow.rotation.x = -0.9;
      A[1].elbow.rotation.x = -0.9;
    };

    const tuckBall = () => {
      // Right arm cradles the ball against the chest; left arm strokes.
      const right = A[1];
      right.shoulder.rotation.x = -0.9;
      right.shoulder.rotation.z = 0.25;
      right.elbow.rotation.x = -1.9;
    };

    switch (st) {
      case 'idle':
      case 'swim':
      case 'catch':
      case 'gbdrive': {
        const pitch = Math.min(1.25, speed * 1.6 + (st === 'gbdrive' ? 1.2 : 0));
        if (speed > 0.06 || st === 'gbdrive') swimCycle(0.5 + speed * 0.9, 6 + speed * 8, pitch);
        else treadWater();
        if (ballHeldByMe || st === 'catch') tuckBall();
        if (st === 'catch') {
          A[0].shoulder.rotation.x = -1.6;
          A[0].elbow.rotation.x = -1.4;
        }
        break;
      }
      case 'gbwind': {
        const u = Math.min(1, p.stateTime / 0.6);
        treadWater();
        this.body.rotation.x = -0.25 * u;
        hipY = 1.0 + u * 0.2;
        A[0].shoulder.rotation.x = -2.9 * u;
        A[1].shoulder.rotation.x = -2.9 * u;
        A[0].shoulder.rotation.z = -0.4;
        A[1].shoulder.rotation.z = 0.4;
        A[0].elbow.rotation.x = -0.4;
        A[1].elbow.rotation.x = -0.4;
        this.neck.rotation.x = -0.4 * u;
        break;
      }
      case 'trick': {
        const u = Math.min(1, p.stateTime / Math.max(0.01, p.stateDur));
        const id = p.trick ? p.trick.def.id : 0;
        swimCycle(0.6, 12, 0.9);
        tuckBall();
        switch (id) {
          case 0: // spin
            this.body.rotation.y = u * Math.PI * 2;
            break;
          case 1: // barrel roll (around travel axis)
            this.body.rotation.z = u * Math.PI * 2;
            break;
          case 2: // dolphin kick: whole-body wave, dips then rises
            this.body.rotation.x = 0.9 + Math.sin(u * Math.PI * 2) * 0.7;
            L[0].hip.rotation.x = L[1].hip.rotation.x = Math.sin(u * Math.PI * 4) * 0.9;
            L[0].knee.rotation.x = L[1].knee.rotation.x = Math.max(0, Math.cos(u * Math.PI * 4)) * 1.0;
            A[0].shoulder.rotation.x = A[1].shoulder.rotation.x = -Math.PI;
            A[0].elbow.rotation.x = A[1].elbow.rotation.x = -0.1;
            tuckBall();
            break;
          case 3: // corkscrew: roll + yaw
            this.body.rotation.z = u * Math.PI * 2;
            this.body.rotation.y = Math.sin(u * Math.PI) * 0.8;
            break;
          case 4: // back-flip feint
            this.body.rotation.x = 0.9 - u * Math.PI * 2;
            break;
          default: // jet stream: stretched torpedo
            this.body.rotation.x = 1.3;
            L[0].hip.rotation.x = L[1].hip.rotation.x = Math.sin(time * 26) * 0.35;
            A[0].shoulder.rotation.x = -Math.PI;
            A[0].elbow.rotation.x = -0.05;
            this.body.rotation.z = Math.sin(u * Math.PI * 3) * 0.4;
            break;
        }
        break;
      }
      case 'shoot': {
        const wind = p.shot && p.shot.wind ? p.shot.wind : 0.75;
        const u = Math.min(1.2, p.stateTime / wind);
        const released = p.shot && p.shot.released;
        treadWater();
        if (!released) {
          // Wind-up: torso twists back, right arm cocked behind the head, left arm points at the target.
          const w = Math.min(1, u);
          this.torso.rotation.y = -0.6 * w;
          this.body.rotation.x = -0.15 * w;
          A[1].shoulder.rotation.x = -2.4 - w * 0.6;
          A[1].shoulder.rotation.z = 0.5;
          A[1].elbow.rotation.x = -1.8;
          A[0].shoulder.rotation.x = -1.5;
          A[0].shoulder.rotation.z = -0.2;
          A[0].elbow.rotation.x = -0.2;
          L[1].hip.rotation.x = -0.5 * w;
          L[0].hip.rotation.x = 0.4 * w;
          hipY = 1.0 + w * 0.12;
        } else {
          // Release: violent overhead throw and follow-through.
          const r = Math.min(1, p.stateTime / 0.3);
          this.torso.rotation.y = 0.5 * r;
          this.body.rotation.x = 0.55 * r;
          A[1].shoulder.rotation.x = -2.9 + r * 2.4;
          A[1].shoulder.rotation.z = 0.2;
          A[1].elbow.rotation.x = -0.1;
          A[0].shoulder.rotation.x = 0.3;
          A[0].shoulder.rotation.z = -0.9;
          L[0].hip.rotation.x = -0.6 * r;
          L[1].hip.rotation.x = 0.7 * r;
          L[1].knee.rotation.x = 0.8 * r;
          this.neck.rotation.x = 0.2 * r;
        }
        break;
      }
      case 'volley': {
        // Airborne first-time strike: scissor kick.
        const u = Math.min(1, p.stateTime / 0.45);
        const k = Math.sin(u * Math.PI);
        this.body.rotation.x = -0.4 + k * 0.9;
        L[1].hip.rotation.x = -1.8 * k;
        L[1].knee.rotation.x = 0.2;
        L[0].hip.rotation.x = 0.9 * k;
        L[0].knee.rotation.x = 1.2 * k;
        A[0].shoulder.rotation.x = -2.4;
        A[1].shoulder.rotation.x = 0.8;
        A[0].shoulder.rotation.z = -0.5;
        A[1].shoulder.rotation.z = 0.7;
        this.torso.rotation.y = -0.4 * k;
        break;
      }
      case 'breach': {
        // Vertical burst: body stretched, arms overhead like a rocket.
        const rising = p.vy > 0;
        const stretch = rising ? 1 : 0.6;
        this.body.rotation.x = -0.15;
        A[0].shoulder.rotation.x = -Math.PI * stretch;
        A[1].shoulder.rotation.x = -Math.PI * stretch;
        A[0].shoulder.rotation.z = -0.15;
        A[1].shoulder.rotation.z = 0.15;
        A[0].elbow.rotation.x = -0.1;
        A[1].elbow.rotation.x = -0.1;
        L[0].hip.rotation.x = 0.1;
        L[1].hip.rotation.x = 0.1;
        L[0].knee.rotation.x = rising ? 0.15 : 0.9;
        L[1].knee.rotation.x = rising ? 0.15 : 0.9;
        this.neck.rotation.x = -0.4;
        if (ballHeldByMe) tuckBall();
        break;
      }
      case 'pass': {
        const u = Math.min(1, p.stateTime / 0.22);
        treadWater();
        this.body.rotation.x = 0.3 + u * 0.2;
        A[0].shoulder.rotation.x = -1.5 - u * 0.3;
        A[1].shoulder.rotation.x = -1.5 - u * 0.3;
        A[0].shoulder.rotation.z = -0.2;
        A[1].shoulder.rotation.z = 0.2;
        A[0].elbow.rotation.x = -1.3 + u * 1.3;
        A[1].elbow.rotation.x = -1.3 + u * 1.3;
        break;
      }
      case 'tackle': {
        // Horizontal lunge, arms reaching for the ball.
        const u = Math.min(1, p.stateTime / 0.4);
        const lunge = Math.sin(u * Math.PI);
        this.body.rotation.x = 0.6 + lunge * 0.9;
        this.body.position.y = -lunge * 0.35;
        this.body.position.z = lunge * 0.3;
        A[1].shoulder.rotation.x = -Math.PI + 0.2;
        A[1].elbow.rotation.x = -0.1;
        A[0].shoulder.rotation.x = -2.3;
        A[0].elbow.rotation.x = -0.6;
        L[0].hip.rotation.x = -0.5 * lunge;
        L[1].hip.rotation.x = 0.6 * lunge;
        L[1].knee.rotation.x = 0.6 * lunge;
        this.neck.rotation.x = -0.5;
        break;
      }
      case 'hit': {
        // Shoulder charge.
        const u = Math.min(1, p.stateTime / 0.42);
        const push = Math.sin(u * Math.PI);
        this.body.rotation.x = 0.35 * push;
        this.torso.rotation.y = 0.7 * push;
        A[1].shoulder.rotation.x = -1.2 * push;
        A[1].shoulder.rotation.z = 0.9 * push;
        A[1].elbow.rotation.x = -1.6;
        A[0].shoulder.rotation.x = 0.6 * push;
        A[0].shoulder.rotation.z = -0.5;
        L[0].hip.rotation.x = 0.5 * push;
        L[1].hip.rotation.x = -0.4 * push;
        L[0].knee.rotation.x = 0.8 * push;
        break;
      }
      case 'save': {
        // Keeper dive toward knockDir.z side, arms extended.
        const u = Math.min(1, p.stateTime / 0.55);
        const dive = Math.sin(Math.min(1, u * 1.4) * Math.PI * 0.5);
        const side = p.knockDir.z >= 0 ? 1 : -1;
        // facing is toward the field; z side in world → roll body sideways
        this.body.rotation.z = side * dive * 1.3;
        this.body.position.y = dive * 0.2;
        A[0].shoulder.rotation.x = -Math.PI + 0.1;
        A[1].shoulder.rotation.x = -Math.PI + 0.1;
        A[0].shoulder.rotation.z = -0.1;
        A[1].shoulder.rotation.z = 0.1;
        A[0].elbow.rotation.x = -0.05;
        A[1].elbow.rotation.x = -0.05;
        L[0].hip.rotation.x = -0.2;
        L[1].hip.rotation.x = 0.4 * dive;
        L[1].knee.rotation.x = 0.7 * dive;
        this.neck.rotation.x = -0.3;
        break;
      }
      case 'stumble': {
        const u = Math.min(1, p.stateTime / Math.max(0.01, p.stateDur));
        treadWater();
        this.body.rotation.x = 0.8 * Math.sin(u * Math.PI);
        this.body.rotation.z = 0.6 * Math.sin(u * Math.PI * 2);
        this.body.rotation.y = Math.sin(u * Math.PI) * 1.2;
        A[0].shoulder.rotation.z = -1.6;
        A[1].shoulder.rotation.z = 1.6;
        break;
      }
      case 'fallen': {
        // Tumbling through the water, then righting.
        const dur = Math.max(0.01, p.stateDur);
        const u = Math.min(1, p.stateTime / dur);
        const tumble = Math.min(1, u * 1.8);
        const recover = u > 0.7 ? (u - 0.7) / 0.3 : 0;
        const spin = tumble * Math.PI * 2 * (1 - recover * 0.0);
        this.body.rotation.x = spin * (1 - recover) + recover * 0.0;
        this.body.rotation.z = Math.sin(u * Math.PI) * 0.8 * (1 - recover);
        this.body.position.y = -Math.sin(u * Math.PI) * 0.5;
        A[0].shoulder.rotation.z = -1.4 * (1 - recover);
        A[1].shoulder.rotation.z = 1.4 * (1 - recover);
        A[0].shoulder.rotation.x = -0.5;
        A[1].shoulder.rotation.x = -0.5;
        L[0].hip.rotation.x = -0.3;
        L[1].hip.rotation.x = 0.5;
        L[1].knee.rotation.x = 0.9;
        L[0].knee.rotation.x = 0.4;
        if (recover > 0) treadWater();
        break;
      }
      case 'celebrate': {
        const u = p.stateTime;
        const bounce = Math.abs(Math.sin(u * 7));
        treadWater();
        hipY = 1.0 + bounce * 0.15;
        A[0].shoulder.rotation.x = -2.8 + Math.sin(u * 9) * 0.3;
        A[1].shoulder.rotation.x = -2.8 - Math.sin(u * 9) * 0.3;
        A[0].shoulder.rotation.z = -0.5;
        A[1].shoulder.rotation.z = 0.5;
        A[0].elbow.rotation.x = -0.6;
        A[1].elbow.rotation.x = -0.6;
        this.neck.rotation.x = -0.35;
        this.body.rotation.x = -0.1;
        break;
      }
      default:
        treadWater();
        break;
    }

    this.hips.position.y = hipY;
    // Bank into turns while swimming
    if ((st === 'swim' || st === 'idle') && speed > 0.2) {
      let d = p.facing - (p.prevFacing ?? p.facing);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.torso.rotation.z += -Math.sin(d) * 0.5;
    }
    p.prevFacing = p.facing;

    // Caustic contact shadow on the disc, scaled by height
    const h = p.y;
    const sc = Math.max(0.35, 1 - h * 0.18);
    this.shadow.scale.setScalar(sc);
    this.shadow.position.y = 0.012 - h;
    this.shadow.material.opacity = 0.4 * sc;
    this.ring.position.y = 0.02 - h;
    this.turboGlow.position.y = 0.03 - h;

    // Control ring
    this.ring.visible = !!p.controlled && !!(sim.userTeam !== null && sim.userTeam === p.team);
    if (this.ring.visible) {
      const pulse = 0.85 + Math.sin(this.t * 6) * 0.15;
      this.ring.scale.setScalar(pulse);
      this.ring.material.opacity = 0.75;
    }
    // Turbo glow
    const tg = this.turboGlow.material;
    tg.opacity += ((p.turboActive || st === 'gbdrive' ? 0.85 : 0) - tg.opacity) * Math.min(1, dt * 10);
    this.turboGlow.rotation.z += dt * 4;
    this.turboGlow.scale.setScalar(1 + Math.sin(this.t * 14) * 0.08);

    // Ease the procedural target pose so action-state changes read as animation rather than
    // a one-frame rig reset. The simulation remains authoritative; this only smooths rendering.
    if (!this.poseReady) this.poseReady = true;
    else {
      const blend = 1 - Math.exp(-dt * 18);
      for (let i = 0; i < joints.length; i++) {
        const joint = joints[i];
        const previous = previousPose[i];
        joint.rotation.x = dampAngle(previous.x, joint.rotation.x, blend);
        joint.rotation.y = dampAngle(previous.y, joint.rotation.y, blend);
        joint.rotation.z = dampAngle(previous.z, joint.rotation.z, blend);
      }
    }
  }

  /** World position of the right hand (for ball attachment while holding). */
  handWorld(target) {
    this.arms[1].hand.getWorldPosition(target);
    return target;
  }

  leftHandWorld(target) {
    this.arms[0].hand.getWorldPosition(target);
    return target;
  }
}

function dampAngle(current, target, blend) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * blend;
}

let _blob = null;
function blobShadowTexture() {
  if (_blob) return _blob;
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _blob = canvasTexture(c);
  return _blob;
}
  handWorld(target) {
    this.arms[1].hand.getWorldPosition(target);
    return target;
  }

  leftHandWorld(target) {
    this.arms[0].hand.getWorldPosition(target);
    return target;
  }
}

function dampAngle(from, to, blend) {
  let delta = to - from;

  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }

  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }

  return from + delta * blend;
}

function blendNumber(from, to, blend) {
  return from + (to - from) * blend;
}

function smoothFactor(dt, rate) {
  if (
    !Number.isFinite(dt) ||
    !Number.isFinite(rate) ||
    dt <= 0 ||
    rate <= 0
  ) {
    return 0;
  }

  return 1 - Math.exp(
    -Math.min(dt, MAX_VISUAL_DT) * rate
  );
}

function safeIndex(value, length) {
  if (!Number.isFinite(value) || length <= 0) {
    return 0;
  }

  const index = Math.trunc(value) % length;
  return index < 0 ? index + length : index;
}

let sharedBlobShadowTexture = null;

function blobShadowTexture() {
  if (sharedBlobShadowTexture) {
    return sharedBlobShadowTexture;
  }

  const canvas = makeCanvas(128, 128);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(
    64,
    64,
    10,
    64,
    64,
    60
  );

  gradient.addColorStop(
    0,
    'rgba(0,0,0,0.9)'
  );

  gradient.addColorStop(
    1,
    'rgba(0,0,0,0)'
  );

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  sharedBlobShadowTexture = canvasTexture(canvas);
  return sharedBlobShadowTexture;
}
