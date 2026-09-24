import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import { buildCourt, themeFor } from './court.js';
import { CharacterView } from './character.js';
import { FXSystem } from './fx.js';
import { GameCamera } from './camera.js';
import { toon, withOutline, makeCanvas, canvasTexture } from './materials.js';
import { ARENA } from '../data/constants.js';

/**
 * Three.js presentation layer.
 * Reads from MatchSim every frame and never mutates it.
 */
export class MatchRenderer {
  constructor(canvas, sim, settings) {
    this.canvas = canvas;
    this.sim = sim;
    this.settings = settings;
    this.disposed = false;

    this.maxDpr =
      settings.quality === 'high'
        ? 1.5
        : settings.quality === 'medium'
          ? 1.0
          : 0.75;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.maxDpr)
    );

    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    const theme = themeFor(sim.teams[0]);
    this.theme = theme;

    this.scene.background = skyTexture(theme.sky);
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(theme.fog),
      0.007
    );

    this.camera = new THREE.PerspectiveCamera(
      42,
      16 / 9,
      0.1,
      400
    );

    this.gameCam = new GameCamera(this.camera, { firstPerson: settings.firstPerson, angle: settings.cameraAngle, playerCam: settings.playerCam, ballCam: settings.ballCam });

    this.setupLights(theme);

    this.court = buildCourt(this.scene, theme);
    this.crowd = this.court.getObjectByName('crowd');
    this.water = this.court.getObjectByName('water');
    this.bubbles = this.court.getObjectByName('bubbles');

    this.goals = [
      this.court.getObjectByName('goalPos'),
      this.court.getObjectByName('goalNeg'),
    ];

    this.goalPulse = [0, 0];

    this.views = new Map();

    for (const p of sim.players) {
      const view = new CharacterView(
        p.data,
        sim.teams[p.team]
      );

      this.scene.add(view.root);
      this.views.set(p.id, view);
    }

    this.ball = this.buildBall();
    this.scene.add(this.ball);

    this.fx = new FXSystem(this.scene);

    // Reusable vectors. Do not allocate these inside update().
    this.tmp = new THREE.Vector3();
    this.leftHandTmp = new THREE.Vector3();
    this.drawSize = new THREE.Vector2();

    this.crowdEnergy = 0.2;
    this.gbFlash = 0;
    this.elapsed = 0;

    this.setupPost();
    this.bindEvents();

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);

    this.resize();
  }

  setupLights(theme) {
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(theme.water).lerp(
        new THREE.Color(0xffffff),
        0.55
      ),
      new THREE.Color(theme.deep),
      1.1
    );

    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xeaf8ff, 2.2);
    key.position.set(6, 18, 8);
    key.castShadow = this.settings.quality !== 'low';

    const shadowSize =
      this.settings.quality === 'high'
        ? 1024
        : this.settings.quality === 'medium'
          ? 512
          : 0;

    if (shadowSize > 0) {
      key.shadow.mapSize.set(shadowSize, shadowSize);
    }

    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -16;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;

    this.scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(
      new THREE.Color(theme.accent),
      0.9
    );

    rim.position.set(-10, 4, -14);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0x9ec5ff, 0.5);
    fill.position.set(-6, 6, 16);
    this.scene.add(fill);
  }

  setupPost() {
    const composer = new EffectComposer(this.renderer);

    composer.addPass(
      new RenderPass(this.scene, this.camera)
    );

    if (this.settings.quality !== 'low') {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(640, 360),
        0.4,
        0.65,
        0.82
      );

      composer.addPass(this.bloom);
    } else {
      this.bloom = null;
    }

    this.fxaa = new ShaderPass(FXAAShader);
    composer.addPass(this.fxaa);

    composer.addPass(new OutputPass());

    this.composer = composer;
  }

  buildBall() {
    const group = new THREE.Group();

    // Blitzball texture.
    const canvas = makeCanvas(256, 128);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f4f6f8';
    ctx.fillRect(0, 0, 256, 128);

    ctx.fillStyle = '#12b5b0';
    ctx.fillRect(0, 52, 256, 24);

    ctx.fillStyle = '#0b0b12';
    ctx.fillRect(0, 50, 256, 3);
    ctx.fillRect(0, 75, 256, 3);

    ctx.strokeStyle = '#0b0b12';
    ctx.lineWidth = 4;

    for (const x of [32, 96, 160, 224]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 128);
      ctx.stroke();
    }

    ctx.fillStyle = '#ff2ea6';

    for (const x of [64, 192]) {
      ctx.beginPath();
      ctx.arc(x, 24, 9, 0, Math.PI * 2);
      ctx.arc(x, 104, 9, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = canvasTexture(canvas);

    const material = new THREE.MeshToonMaterial({
      map: texture,
      gradientMap: toon('#ffffff').gradientMap,
    });

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      material
    );

    mesh.castShadow = true;
    withOutline(mesh, 0.025);

    group.add(mesh);
    this.ballMesh = mesh;

    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff7a1f,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );

    group.add(aura);
    this.ballAura = aura;

    const shadowCanvas = makeCanvas(64, 64);
    const shadowCtx = shadowCanvas.getContext('2d');

    const gradient = shadowCtx.createRadialGradient(
      32,
      32,
      4,
      32,
      32,
      30
    );

    gradient.addColorStop(0, 'rgba(0,0,0,0.7)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    shadowCtx.fillStyle = gradient;
    shadowCtx.fillRect(0, 0, 64, 64);

    const shadowTexture = canvasTexture(shadowCanvas);

    this.ballShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55),
      new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
      })
    );

    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.renderOrder = 1;

    this.scene.add(this.ballShadow);

    return group;
  }

  goalIndexFor(team) {
    // Team 0 attacks +x, team 1 attacks -x.
    return this.sim.attackDir(team) > 0 ? 0 : 1;
  }

  bindEvents() {
    this._unsubs = [];

    const events = this.sim.events;
    const team = (index) => this.sim.teams[index];

    const ballPosition = () => ({
      x: this.sim.ball.pos.x,
      y: this.sim.ball.pos.y,
      z: this.sim.ball.pos.z,
    });

    const on = (type, callback) => {
      this._unsubs.push(events.on(type, callback));
    };

    on('wall', ({ pos, speed }) => {
      this.fx.bubbles(
        pos,
        Math.min(14, 3 + speed),
        Math.min(1.4, speed * 0.2),
        pos.y
      );
    });

    on('post', ({ pos, hard }) => {
      this.fx.sparks(
        pos,
        '#ffd23f',
        hard ? 16 : 8
      );

      this.gameCam.punch(hard ? 0.35 : 0.15);
    });

    on('score', ({ player, gb, team: teamIndex }) => {
      this.gameCam.setMode(
        'score',
        gb ? 2.0 : 1.3,
        player
      );

      const goalIndex = this.goalIndexFor(teamIndex);
      this.goalPulse[goalIndex] = 1;

      const goalX =
        ARENA.goalX * this.sim.attackDir(teamIndex);

      this.fx.shockwave(
        {
          x: goalX,
          y: ARENA.goalY,
          z: 0,
        },
        team(teamIndex).accent,
        6,
        0.7,
        { vertical: true }
      );

      this.fx.burst(
        {
          x: goalX,
          y: ARENA.goalY,
          z: 0,
        },
        team(teamIndex).accent,
        30,
        4,
        0.22
      );

      this.crowdEnergy = 1;

      if (gb) {
        this.fx.confetti(
          {
            x: goalX * 0.6,
            y: 3.0,
            z: 0,
          },
          [
            team(teamIndex).primary,
            team(teamIndex).accent,
            '#ffffff',
          ],
          160
        );

        this.gameCam.punch(1.2);
      } else {
        this.gameCam.punch(0.5);
      }
    });

    on('save', ({ keeper, big }) => {
      this.fx.burst(
        ballPosition(),
        '#ffffff',
        big ? 26 : 14,
        3.5,
        0.2
      );

      this.fx.bubbles(
        keeper.pos,
        12,
        1.2,
        0.8
      );

      this.gameCam.punch(big ? 0.5 : 0.25);

      this.crowdEnergy = Math.max(
        this.crowdEnergy,
        big ? 0.9 : 0.6
      );
    });

    on('knockdown', ({ victim, reason }) => {
      this.fx.bubbles(
        victim.pos,
        14,
        1.4,
        0.5
      );

      this.gameCam.punch(
        reason === 'hit' ? 0.5 : 0.3
      );
    });

    on('washed', ({ player, victim }) => {
      this.fx.burst(
        {
          x: victim.pos.x,
          y: 0.8,
          z: victim.pos.z,
        },
        team(player.team).accent,
        26,
        3.5,
        0.18
      );

      this.fx.shockwave(
        victim.pos,
        team(player.team).accent,
        3,
        0.45
      );

      this.crowdEnergy = 1;
    });

    on('block', () => {
      this.gameCam.punch(0.6);

      this.fx.burst(
        ballPosition(),
        '#ffffff',
        20,
        4,
        0.2
      );

      this.crowdEnergy = 1;
    });

    on('tackle', ({ player }) => {
      this.fx.burst(
        {
          x: player.pos.x,
          y: 1.0,
          z: player.pos.z,
        },
        team(player.team).accent,
        14,
        2.5,
        0.15
      );

      this.crowdEnergy = Math.max(
        this.crowdEnergy,
        0.7
      );
    });

    on('bighit', ({ player, victim }) => {
      this.gameCam.punch(0.7);

      this.fx.burst(
        {
          x: victim.pos.x,
          y: 1.0,
          z: victim.pos.z,
        },
        '#ffffff',
        16,
        3,
        0.16
      );

      this.fx.shockwave(
        victim.pos,
        team(player.team).accent,
        2.5,
        0.35
      );

      this.crowdEnergy = Math.max(
        this.crowdEnergy,
        0.8
      );
    });

    on('shot', ({ player, gb, volley }) => {
      this.fx.bubbles(
        player.pos,
        gb ? 24 : 8,
        gb ? 2 : 1,
        0.9
      );

      if (volley || gb) {
        this.gameCam.setMode(
          'goalcam',
          gb ? 1.8 : 1.2,
          player
        );
      }
    });

    on('breach', ({ player }) => {
      this.fx.bubbles(
        player.pos,
        10,
        1.1,
        0.2
      );
    });

    on('splash', ({ pos, size }) => {
      this.fx.bubbles(
        pos,
        6,
        size,
        0.1
      );
    });

    on('alleyoop', ({ finisher }) => {
      this.gameCam.setMode(
        'goalcam',
        1.4,
        finisher
      );
    });

    on('gamebreaker', ({ player }) => {
      this.gameCam.setMode(
        'gamebreaker',
        3.0,
        player
      );

      this.gbFlash = 1;

      this.fx.shockwave(
        player.pos,
        team(player.team).accent,
        7,
        0.8
      );

      this.crowdEnergy = 1;
    });

    on('gbshot', ({ player }) => {
      this.gameCam.setMode(
        'goalcam',
        1.8,
        player
      );
    });

    on('trick', ({ player, turbo }) => {
      this.fx.bubbles(
        player.pos,
        turbo ? 12 : 6,
        turbo ? 1.4 : 0.8,
        0.4
      );
    });

    on('reset', () => {
      this.gameCam.setMode('play', 0);
    });
  }

  unbindEvents() {
    if (!this._unsubs) return;

    for (const unsubscribe of this._unsubs) {
      unsubscribe();
    }

    this._unsubs = [];
  }

  resize() {
    const width = Math.max(
      1,
      this.canvas.clientWidth || window.innerWidth
    );

    const height = Math.max(
      1,
      this.canvas.clientHeight || window.innerHeight
    );

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      this.maxDpr
    );

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);

    this.composer.setSize(width, height);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.getDrawingBufferSize(this.drawSize);

    this.fxaa.material.uniforms.resolution.value.set(
      1 / this.drawSize.x,
      1 / this.drawSize.y
    );

    if (this.bloom) {
      this.bloom.resolution.set(
        Math.min(640, this.drawSize.x),
        Math.min(360, this.drawSize.y)
      );
    }
  }

  update(dt) {
    const sim = this.sim;

    this.elapsed += dt;

    for (const player of sim.players) {
      const view = this.views.get(player.id);

      view.update(
        player,
        sim,
        dt,
        sim.ball.holder === player
      );
    }

    const ballState = sim.ball;
    const holder = ballState.holder;

    if (
      holder &&
      (
        holder.state === 'shoot' ||
        holder.state === 'gbwind' ||
        holder.state === 'gbdrive' ||
        holder.state === 'pass' ||
        holder.state === 'catch' ||
        holder.state === 'trick' ||
        holder.state === 'volley'
      )
    ) {
      const view = this.views.get(holder.id);

      view.handWorld(this.tmp);

      if (
        holder.state === 'gbwind' ||
        holder.state === 'pass' ||
        holder.state === 'catch' ||
        holder.state === 'trick'
      ) {
        view.leftHandWorld(this.leftHandTmp);
        this.tmp.lerp(this.leftHandTmp, 0.5);
      }

      this.ball.position.lerp(this.tmp, 0.7);
    } else if (holder) {
      // Tucked under the player's arm while swimming.
      const view = this.views.get(holder.id);

      view.handWorld(this.tmp);
      this.ball.position.lerp(this.tmp, 0.6);
    } else {
      this.ball.position.set(
        ballState.pos.x,
        ballState.pos.y,
        ballState.pos.z
      );
    }

    const spin =
      ballState.vel.length() * dt * 5 +
      (holder ? dt * 2 : 0);

    this.ballMesh.rotation.x += spin;
    this.ballMesh.rotation.z += spin * 0.3;

    this.ballShadow.position.set(
      this.ball.position.x,
      0.015,
      this.ball.position.z
    );

    const ballHeight = Math.max(
      0,
      this.ball.position.y
    );

    const ballShadowScale = Math.max(
      0.4,
      1 - ballHeight * 0.15
    );

    this.ballShadow.scale.setScalar(
      ballShadowScale
    );

    this.ballShadow.material.opacity =
      0.5 * ballShadowScale;

    const hotTeam = holder
      ? holder.team
      : ballState.lastTeam;

    const hot =
      sim.momentum[hotTeam] >= sim.rules.onFireGoals ||
      sim.state === 'gamebreaker';

    const auraMaterial = this.ballAura.material;
    const targetAuraOpacity = hot ? 0.55 : 0;

    auraMaterial.opacity +=
      (
        targetAuraOpacity -
        auraMaterial.opacity
      ) * Math.min(1, dt * 6);

    auraMaterial.color.set(
      sim.state === 'gamebreaker'
        ? this.sim.teams[hotTeam].accent
        : '#ff7a1f'
    );

    this.ballAura.scale.setScalar(
      1 + Math.sin(this.elapsed * 20) * 0.15
    );

    const flightShot =
      ballState.flight &&
      ballState.flight.kind === 'shot';

    const flightPass =
      ballState.flight &&
      (
        ballState.flight.kind === 'pass' ||
        ballState.flight.kind === 'lob'
      );

    let trailColor = '#ff7a1f';

    if (flightShot) {
      trailColor =
        ballState.flight.gb
          ? this.sim.teams[
              ballState.flight.shooter.team
            ].accent
          : hot
            ? '#ff7a1f'
            : '#ffd23f';
    } else if (flightPass) {
      trailColor = '#8ff7ff';
    }

    this.fx.updateTrail(
      this.ball.position,
      flightShot ||
        flightPass ||
        hot ||
        sim.state === 'gamebreaker',
      trailColor
    );

    for (let i = 0; i < 2; i++) {
      const goal = this.goals[i];

      if (!goal) continue;

      this.goalPulse[i] = Math.max(
        0,
        this.goalPulse[i] - dt * 0.8
      );

      const glow = goal.userData.glow;

      if (glow) {
        const scale =
          1 +
          this.goalPulse[i] *
            0.35 *
            (
              0.5 +
              0.5 *
                Math.sin(this.elapsed * 30)
            );

        glow.scale.setScalar(scale);
      }
    }

    if (
      this.water &&
      this.water.userData.update
    ) {
      this.water.userData.update(this.elapsed);
    }

    if (
      this.bubbles &&
      this.bubbles.userData.update
    ) {
      this.bubbles.userData.update(dt);
    }

    this.crowdEnergy +=
      (0.2 - this.crowdEnergy) *
      Math.min(1, dt * 0.6);

    if (this.crowd) {
      const time = this.elapsed;
      const energy = this.crowdEnergy;
      const children = this.crowd.children;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const phase = child.userData.phase;

        child.position.y =
          child.userData.baseY +
          Math.max(
            0,
            Math.sin(
              time * (4 + energy * 6) + phase
            )
          ) *
            (0.05 + energy * 0.35);
      }
    }

    this.fx.update(dt);
    this.gameCam.update(sim, dt);

    if (this.bloom) {
      this.gbFlash = Math.max(
        0,
        this.gbFlash - dt * 0.8
      );

      const targetBloom =
        0.4 +
        this.gbFlash * 0.9 +
        (sim.state === 'gamebreaker' ? 0.3 : 0);

      this.bloom.strength +=
        (targetBloom - this.bloom.strength) *
        Math.min(1, dt * 12);
    }
  }

  render() {
    if (this.disposed) return;

    this.composer.render();
  }

  dispose() {
    if (this.disposed) return;

    this.disposed = true;

    window.removeEventListener(
      'resize',
      this.onResize
    );

    this.unbindEvents();

    this.composer?.dispose();

    this.scene?.traverse((object) => {
      object.geometry?.dispose?.();

      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];

      for (const material of materials) {
        for (const key in material) {
          const value = material[key];

          if (value && value.isRenderTarget) {
            value.dispose?.();
          }
        }

        material.dispose?.();
      }
    });

    this.scene?.clear();
    this.views?.clear();

    this.fx = null;

    this.renderer.renderLists?.dispose();
    this.renderer.dispose();

    // Do not call forceContextLoss() here.
    // It can interfere with WebGL context recreation.
  }
}

function skyTexture(colors) {
  const canvas = makeCanvas(512, 256);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(
    0,
    0,
    0,
    256
  );

  gradient.addColorStop(
    0,
    colors[0]
  );

  gradient.addColorStop(
    0.55,
    colors[1]
  );

  gradient.addColorStop(
    1,
    colors[2]
  );

  ctx.fillStyle = gradient;
  ctx.fillRect(
    0,
    0,
    512,
    256
  );

  const texture = canvasTexture(canvas);

  texture.mapping =
    THREE.EquirectangularReflectionMapping;

  texture.needsUpdate = true;

  return texture;
}

