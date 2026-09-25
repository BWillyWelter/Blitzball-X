import * as THREE from 'three';
import {
  toon,
  withOutline,
  makeCanvas,
  canvasTexture,
  shade,
} from './materials.js';

const SKIN = [
  '#f1c27d',
  '#c68642',
  '#8d5524',
  '#5c3a21',
];

const HAIR = [
  '#111111',
  '#3b2314',
  '#f2d16b',
  '#d8d8d8',
  '#c0392b',
  '#111111',
];

const MAX_VISUAL_DT = 0.05;

// Small silhouette changes make roster roles readable at broadcast distance without adding
// separate animation systems. Values affect stroke cadence, reach, and turbo lean only.
const MOTION_PROFILES = {
  Finisher: { tempo: 1.18, rate: 1.12, reach: 1.08, pitch: 1.08, turboLean: 0.12 },
  Sniper: { tempo: 1.06, rate: 1.04, reach: 0.92, pitch: 1.12, turboLean: 0.08 },
  Handler: { tempo: 0.92, rate: 0.9, reach: 1.05, pitch: 0.88, turboLean: 0.04 },
  Enforcer: { tempo: 0.78, rate: 0.78, reach: 1.24, pitch: 0.76, turboLean: -0.08 },
  Guardian: { tempo: 0.84, rate: 0.84, reach: 0.9, pitch: 0.82, turboLean: 0.02 },
  'All-Around': { tempo: 1, rate: 1, reach: 1, pitch: 1, turboLean: 0.06 },
};

export class CharacterView {
  constructor(playerData, team) {
    this.data = playerData;
    this.team = team;

    this.root = new THREE.Group();
    this.root.name = `player_${playerData.id}`;

    this.t = 0;
    this.poseReady = false;
    this.motion = MOTION_PROFILES[playerData.archetype] || MOTION_PROFILES['All-Around'];

    this.build();
  }

  build() {
    const d = this.data;
    const team = this.team;

    const skinMat = toon(
      SKIN[safeIndex(d.skin, SKIN.length)]
    );

    const isGK = d.role === 'GK';

    const jerseyMat = toon(
      isGK ? team.accent : team.primary
    );

    const shortsMat = toon(team.secondary);

    const trimMat = toon(
      isGK ? team.primary : team.accent
    );

    const shoeMat = toon(
      shade(team.accent, -0.1)
    );

    const hairMat = toon(
      HAIR[safeIndex(d.hair, HAIR.length)]
    );

    const body = new THREE.Group();
    body.name = 'body';
    this.body = body;
    this.root.add(body);

    this.hips = new THREE.Group();
    this.hips.position.y = 1.0;
    body.add(this.hips);

    this.torso = new THREE.Group();
    this.hips.add(this.torso);

    const torsoMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(
        0.26,
        0.42,
        4,
        10
      ),
      jerseyMat
    );

    torsoMesh.position.y = 0.42;
    torsoMesh.scale.set(1.15, 1, 0.8);
    torsoMesh.castShadow = true;

    this.torso.add(
      withOutline(torsoMesh, 0.04)
    );

    const numberTexture = this.numberTexture();

    const decalMaterial = new THREE.MeshBasicMaterial({
      map: numberTexture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    const frontNumber = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      decalMaterial
    );

    frontNumber.position.set(
      0,
      0.42,
      0.215
    );

    this.torso.add(frontNumber);

    const backNumber = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      decalMaterial
    );

    backNumber.position.set(
      0,
      0.46,
      -0.215
    );

    backNumber.rotation.y = Math.PI;
    this.torso.add(backNumber);

    for (const side of [-1, 1]) {
      const shoulderPad = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.11,
          10,
          8
        ),
        trimMat
      );

      shoulderPad.position.set(
        side * 0.29,
        0.68,
        0
      );

      this.torso.add(shoulderPad);
    }

    this.neck = new THREE.Group();
    this.neck.position.y = 0.82;
    this.torso.add(this.neck);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.19,
        14,
        12
      ),
      skinMat
    );

    head.position.y = 0.16;
    head.scale.set(
      0.95,
      1.08,
      0.95
    );

    head.castShadow = true;

    this.neck.add(
      withOutline(head, 0.035)
    );

    const goggles = new THREE.Mesh(
      new THREE.TorusGeometry(
        0.2,
        0.028,
        8,
        20,
        Math.PI * 1.1
      ),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(team.accent),
      })
    );

    goggles.rotation.x = Math.PI / 2;
    goggles.rotation.z = -Math.PI * 0.05;
    goggles.position.set(0, 0.19, 0);
    this.neck.add(goggles);

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.26,
        0.07,
        0.06
      ),
      new THREE.MeshBasicMaterial({
        color: 0x8ff7ff,
      })
    );

    visor.position.set(
      0,
      0.19,
      0.17
    );

    this.neck.add(visor);

    const hairStyle = safeIndex(
      d.hair,
      6
    );

    if (hairStyle === 0) {
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.2,
          12,
          10,
          0,
          Math.PI * 2,
          0,
          Math.PI * 0.5
        ),
        hairMat
      );

      hair.position.y = 0.19;
      this.neck.add(hair);
    } else if (hairStyle === 1) {
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.24,
          12,
          10,
          0,
          Math.PI * 2,
          0,
          Math.PI * 0.55
        ),
        hairMat
      );

      hair.position.y = 0.2;
      this.neck.add(hair);
    } else if (hairStyle === 2) {
      const headband = new THREE.Mesh(
        new THREE.TorusGeometry(
          0.19,
          0.035,
          8,
          16
        ),
        trimMat
      );

      headband.rotation.x = Math.PI / 2;
      headband.position.y = 0.22;
      this.neck.add(headband);
    } else if (hairStyle === 3) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.205,
          12,
          10,
          0,
          Math.PI * 2,
          0,
          Math.PI * 0.5
        ),
        shortsMat
      );

      cap.position.y = 0.18;
      this.neck.add(cap);

      const brim = new THREE.Mesh(
        new THREE.BoxGeometry(
          0.22,
          0.03,
          0.18
        ),
        shortsMat
      );

      brim.position.set(
        0,
        0.2,
        0.25
      );

      this.neck.add(brim);
    } else if (hairStyle === 4) {
      const hair = new THREE.Mesh(
        new THREE.BoxGeometry(
          0.3,
          0.18,
          0.3
        ),
        hairMat
      );

      hair.position.y = 0.3;
      this.neck.add(hair);
    } else {
      for (let i = 0; i < 6; i++) {
        const braid = new THREE.Mesh(
          new THREE.CapsuleGeometry(
            0.025,
            0.25,
            3,
            6
          ),
          hairMat
        );

        const angle =
          (i / 6) * Math.PI * 2;

        braid.position.set(
          Math.cos(angle) * 0.14,
          0.12,
          Math.sin(angle) * 0.14 - 0.05
        );

        braid.rotation.z =
          Math.cos(angle) * 0.5;

        braid.rotation.x =
          -Math.sin(angle) * 0.5;

        this.neck.add(braid);
      }

      const hairTop = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.2,
          12,
          10,
          0,
          Math.PI * 2,
          0,
          Math.PI * 0.45
        ),
        hairMat
      );

      hairTop.position.y = 0.19;
      this.neck.add(hairTop);
    }

    const eyeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
    });

    const pupilMaterial = new THREE.MeshBasicMaterial({
      color: 0x111111,
    });

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.035,
          8,
          6
        ),
        eyeMaterial
      );

      eye.position.set(
        side * 0.07,
        0.17,
        0.165
      );

      eye.scale.set(
        1,
        1.3,
        0.5
      );

      this.neck.add(eye);

      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.016,
          6,
          6
        ),
        pupilMaterial
      );

      pupil.position.set(
        side * 0.07,
        0.17,
        0.182
      );

      this.neck.add(pupil);
    }

    const brow = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.2,
        0.02,
        0.03
      ),
      hairMat
    );

    brow.position.set(
      0,
      0.215,
      0.17
    );

    this.neck.add(brow);

    this.arms = [];

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();

      shoulder.position.set(
        side * 0.32,
        0.66,
        0
      );

      this.torso.add(shoulder);

      const upperArm = new THREE.Mesh(
        new THREE.CapsuleGeometry(
          0.075,
          0.3,
          4,
          8
        ),
        skinMat
      );

      upperArm.position.y = -0.2;
      upperArm.castShadow = true;

      shoulder.add(
        withOutline(upperArm, 0.03)
      );

      const elbow = new THREE.Group();
      elbow.position.y = -0.38;
      shoulder.add(elbow);

      const forearm = new THREE.Mesh(
        new THREE.CapsuleGeometry(
          0.065,
          0.3,
          4,
          8
        ),
        skinMat
      );

      forearm.position.y = -0.2;
      forearm.castShadow = true;

      elbow.add(
        withOutline(forearm, 0.03)
      );

      const sweatband = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.075,
          0.075,
          0.06,
          10
        ),
        trimMat
      );

      sweatband.position.y = -0.33;
      elbow.add(sweatband);

      const hand = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.095,
          10,
          8
        ),
        skinMat
      );

      hand.position.y = -0.42;
      hand.scale.set(
        1,
        1.15,
        0.7
      );

      elbow.add(
        withOutline(hand, 0.03)
      );

      hand.name = 'hand';

      this.arms.push({
        shoulder,
        elbow,
        hand,
        side,
      });
    }

    this.legs = [];

    for (const side of [-1, 1]) {
      const hip = new THREE.Group();

      hip.position.set(
        side * 0.14,
        0.02,
        0
      );

      this.hips.add(hip);

      const thigh = new THREE.Mesh(
        new THREE.CapsuleGeometry(
          0.11,
          0.34,
          4,
          8
        ),
        shortsMat
      );

      thigh.position.y = -0.22;
      thigh.castShadow = true;

      hip.add(
        withOutline(thigh, 0.035)
      );

      const knee = new THREE.Group();
      knee.position.y = -0.46;
      hip.add(knee);

      const shin = new THREE.Mesh(
        new THREE.CapsuleGeometry(
          0.08,
          0.34,
          4,
          8
        ),
        skinMat
      );

      shin.position.y = -0.2;
      shin.castShadow = true;

      knee.add(
        withOutline(shin, 0.03)
      );

      const sock = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.085,
          0.085,
          0.14,
          10
        ),
        toon('#f5f5f5')
      );

      sock.position.y = -0.34;
      knee.add(sock);

      const shoe = new THREE.Mesh(
        new THREE.BoxGeometry(
          0.19,
          0.13,
          0.34
        ),
        shoeMat
      );

      shoe.position.set(
        0,
        -0.46,
        0.06
      );

      shoe.castShadow = true;

      knee.add(
        withOutline(shoe, 0.03)
      );

      const sole = new THREE.Mesh(
        new THREE.BoxGeometry(
          0.2,
          0.04,
          0.36
        ),
        toon('#f5f5f5')
      );

      sole.position.set(
        0,
        -0.53,
        0.06
      );

      knee.add(sole);

      this.legs.push({
        hip,
        knee,
        side,
      });
    }

    const belt = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.29,
        0.31,
        0.16,
        12
      ),
      shortsMat
    );

    belt.position.y = 0;
    belt.scale.set(
      1.1,
      1,
      0.8
    );

    this.hips.add(
      withOutline(belt, 0.03)
    );

    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.30,
        0.315,
        0.05,
        12
      ),
      trimMat
    );

    stripe.position.y = 0.06;
    stripe.scale.set(
      1.1,
      1,
      0.8
    );

    this.hips.add(stripe);

    const shadowTexture =
      blobShadowTexture();

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(
        1.2,
        1.2
      ),
      new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      })
    );

    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(
        0.5,
        0.62,
        32
      ),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    this.root.add(this.ring);

    this.turboGlow = new THREE.Mesh(
      new THREE.RingGeometry(
        0.3,
        0.75,
        24
      ),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(team.accent),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );

    this.turboGlow.rotation.x = -Math.PI / 2;
    this.turboGlow.position.y = 0.03;
    this.turboGlow.renderOrder = 2;
    this.root.add(this.turboGlow);

    this.tag = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.tagTexture(),
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })
    );

    this.tag.scale.set(
      1.7,
      0.42,
      1
    );

    this.tag.position.y = 2.4;
    this.tag.renderOrder = 20;
    this.root.add(this.tag);

    // Cache the rig once. The old implementation rebuilt this array
    // and allocated pose objects on every rendered frame.
    this.cachePoseRig();
  }

  cachePoseRig() {
    this.joints = [
      this.body,
      this.torso,
      this.hips,
      this.neck,

      this.arms[0].shoulder,
      this.arms[0].elbow,
      this.arms[1].shoulder,
      this.arms[1].elbow,

      this.legs[0].hip,
      this.legs[0].knee,
      this.legs[1].hip,
      this.legs[1].knee,
    ];

    this.poseFromX = new Float32Array(
      this.joints.length
    );

    this.poseFromY = new Float32Array(
      this.joints.length
    );

    this.poseFromZ = new Float32Array(
      this.joints.length
    );
  }

  numberTexture() {
    const canvas = makeCanvas(
      128,
      128
    );

    const ctx = canvas.getContext('2d');

    ctx.clearRect(
      0,
      0,
      128,
      128
    );

    ctx.font =
      '900 92px "Barlow Condensed", Impact, sans-serif';

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = this.team.secondary;

    ctx.strokeText(
      String(this.data.number ?? ''),
      64,
      70
    );

    ctx.fillStyle = this.team.accent;

    ctx.fillText(
      String(this.data.number ?? ''),
      64,
      70
    );

    return canvasTexture(canvas);
  }

  tagTexture() {
    const canvas = makeCanvas(
      256,
      64
    );

    const ctx = canvas.getContext('2d');

    const label = String(
      this.data.nick ||
      this.data.name ||
      this.data.id ||
      ''
    ).toUpperCase();

    ctx.font =
      '700 34px "Barlow Condensed", Impact, sans-serif';

    const width = Math.min(
      246,
      ctx.measureText(label).width + 44
    );

    const left = 128 - width / 2;

    ctx.fillStyle =
      'rgba(8,12,20,0.72)';

    ctx.beginPath();

    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(
        left,
        8,
        width,
        44,
        8
      );
    } else {
      ctx.rect(
        left,
        8,
        width,
        44
      );
    }

    ctx.fill();

    ctx.fillStyle = this.team.primary;

    ctx.fillRect(
      left + 8,
      16,
      4,
      28
    );

    ctx.fillStyle = '#f2f6fa';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(
      label,
      132,
      31
    );

    return canvasTexture(canvas);
  }
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
    const motion = this.motion;
    const swimTime = time * motion.tempo;

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
            swimTime,
            (0.5 + speed * 0.9) * motion.rate,
            (6 + speed * 8) * motion.reach,
            pitch * motion.pitch
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

    // Turbo adds a subtle archetype-specific lean so the fastest swimmers read differently even
    // when the camera is far away. The lean is visual only; simulation speed is untouched.
    if (p.turboActive && (state === 'swim' || state === 'idle')) {
      this.body.rotation.z += motion.turboLean * Math.sin(swimTime * 5) * Math.min(1, speed * 1.8);
    }

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

  const canvas = makeCanvas(
    128,
    128
  );

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
  ctx.fillRect(
    0,
    0,
    128,
    128
  );

  sharedBlobShadowTexture = canvasTexture(canvas);
  return sharedBlobShadowTexture;
}
