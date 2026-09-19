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
import { ARENA, MOVE } from '../data/constants.js';
import { buildLandingRing } from './depth.js';

/** Vignette + animated chromatic aberration. offset.x animates in for impacts/gamebreakers. */
const VignetteChromaShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 0 },
    strength: { value: 0.55 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float offset; uniform float strength; varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 fromCenter = uv - 0.5;
      vec2 dir = fromCenter * offset;
      vec4 c;
      c.r = texture2D(tDiffuse, uv + dir).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - dir).b;
      c.a = 1.0;
      float vig = smoothstep(0.95, 0.25, length(fromCenter) * (1.0 + strength));
      gl_FragColor = vec4(c.rgb * mix(1.0, vig, strength), c.a);
    }`,
};

/**
 * Three.js presentation layer. Reads from MatchSim every frame; never mutates it.
 */
export class MatchRenderer {
  constructor(canvas, sim, settings) {
    this.canvas = canvas;
    this.sim = sim;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.quality === 'high' ? 2 : 1.25));
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    const theme = themeFor(sim.teams[0]);
    this.theme = theme;
    this.scene.background = skyTexture(theme.sky);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(theme.fog), 0.007);

    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 400);
    this.gameCam = new GameCamera(this.camera, { firstPerson: settings.firstPerson, angle: settings.cameraAngle });

    this.setupLights(theme);
    this.court = buildCourt(this.scene, theme);
    this.crowd = this.court.getObjectByName('crowd');
    this.water = this.court.getObjectByName('water');
    this.bubbles = this.court.getObjectByName('bubbles');
    this.arcaneAccents = this.court.getObjectByName('arcaneAccents');
    this.goals = [this.court.getObjectByName('goalPos'), this.court.getObjectByName('goalNeg')];
    this.goalPulse = [0, 0];

    this.views = new Map();
    for (const p of sim.players) {
      const v = new CharacterView(p.data, sim.teams[p.team]);
      this.scene.add(v.root);
      this.views.set(p.id, v);
    }
    this.ball = this.buildBall();
    this.scene.add(this.ball);
    this.fx = new FXSystem(this.scene, this.camera);
    this.downT = new Map(); // player id → seconds until they're back up (drives ember flare)
    this.tmp = new THREE.Vector3();
    this.crowdEnergy = 0.2;
    this.gbFlash = 0;
    this.highlightTimer = 0;
    this.simTimeScale = 1;
    this.elapsed = 0;

    this.setupPost();
    this.bindEvents();
    this.resize();
  }

  setupLights(theme) {
    const hemi = new THREE.HemisphereLight(new THREE.Color(theme.water).lerp(new THREE.Color(0xffffff), 0.55), new THREE.Color(theme.deep), 1.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xeaf8ff, 2.2);
    key.position.set(6, 18, 8);
    key.castShadow = this.settings.quality !== 'low';
    key.shadow.mapSize.set(this.settings.quality === 'high' ? 2048 : 1024, this.settings.quality === 'high' ? 2048 : 1024);
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
    const rim = new THREE.DirectionalLight(new THREE.Color(theme.accent), 0.9);
    rim.position.set(-10, 4, -14);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x9ec5ff, 0.5);
    fill.position.set(-6, 6, 16);
    this.scene.add(fill);
  }

  setupPost() {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.settings.quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.65, 0.82);
      composer.addPass(this.bloom);
    }
    this.fxaa = new ShaderPass(FXAAShader);
    composer.addPass(this.fxaa);
    if (this.settings.quality !== 'low') {
      this.vignette = new ShaderPass(VignetteChromaShader);
      composer.addPass(this.vignette);
    }
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  buildBall() {
    const g = new THREE.Group();
    // Blitzball: white panelled ball with a bold coloured seam band.
    const c = makeCanvas(256, 128);
    const ctx = c.getContext('2d');
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
    const tex = canvasTexture(c);
    const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: toon('#ffffff').gradientMap });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), mat);
    mesh.castShadow = true;
    withOutline(mesh, 0.025);
    g.add(mesh);
    this.ballMesh = mesh;
    const aura = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff7a1f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(aura);
    this.ballAura = aura;
    const shadowTex = (() => {
      const cc = makeCanvas(64, 64);
      const cx = cc.getContext('2d');
      const gr = cx.createRadialGradient(32, 32, 4, 32, 32, 30);
      gr.addColorStop(0, 'rgba(0,0,0,0.7)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = gr;
      cx.fillRect(0, 0, 64, 64);
      return canvasTexture(cc);
    })();
    this.ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.renderOrder = 1;
    this.scene.add(this.ballShadow);
    // Predictive landing marker: shows where a pass/lob arc will come down, which makes the
    // vertical dimension playable instead of guesswork.
    this.landingRing = buildLandingRing();
    this.scene.add(this.landingRing);
    return g;
  }

  goalIndexFor(team) {
    // goal the team attacks: team 0 → +x (goalPos)
    return this.sim.attackDir(team) > 0 ? 0 : 1;
  }

  bindEvents() {
    this._unsubs = [];
    const ev = this.sim.events;
    const team = (t) => this.sim.teams[t];
    const bp = () => ({ x: this.sim.ball.pos.x, y: this.sim.ball.pos.y, z: this.sim.ball.pos.z });
    // Recorded so dispose() can detach cleanly (a disposed renderer has no FX to drive).
    const on = (type, fn) => this._unsubs.push(ev.on(type, fn));
    on('wall', ({ pos, speed }) => {
      this.fx.bubbles(pos, Math.min(14, 3 + speed), Math.min(1.4, speed * 0.2), pos.y);
    });
    on('post', ({ pos, hard }) => {
      this.fx.sparks(pos, '#ffd23f', hard ? 16 : 8);
      if (this.settings.screenShake === false) return;
      this.gameCam.punch(hard ? 0.35 : 0.15);
    });
    on('score', ({ player, gb, team: t }) => {
      this.gameCam.setMode('score', gb ? 2.0 : 1.3, player);
      const gi = this.goalIndexFor(t);
      this.goalPulse[gi] = 1;
      const gx = ARENA.goalX * this.sim.attackDir(t);
      this.fx.shockwave({ x: gx, y: ARENA.goalY, z: 0 }, team(t).accent, 6, 0.7, { vertical: true });
      this.fx.burst({ x: gx, y: ARENA.goalY, z: 0 }, team(t).accent, 30, 4, 0.22);
      this.crowdEnergy = 1;
      this.flash(0.0016);
      if (gb) {
        this.flash(0.005);
        this.fx.confetti({ x: gx * 0.6, y: 3.0, z: 0 }, [team(t).primary, team(t).accent, '#ffffff'], 160);
        this.gameCam.punch(1.2);
      } else this.gameCam.punch(0.5);
    });
    on('save', ({ keeper, big }) => {
      this.fx.burst(bp(), '#ffffff', big ? 26 : 14, 3.5, 0.2);
      this.fx.bubbles(keeper.pos, 12, 1.2, 0.8);
      this.gameCam.punch(big ? 0.5 : 0.25);
      this.crowdEnergy = Math.max(this.crowdEnergy, big ? 0.9 : 0.6);
    });
    on('knockdown', ({ victim, reason }) => {
      this.fx.bubbles(victim.pos, 14, 1.4, 0.5);
      this.gameCam.punch(reason === 'hit' ? 0.5 : 0.3);
      // Remember how long the victim is down so their ember trail can flare while grounded.
      this.downT.set(victim.id, reason === 'fallen' ? MOVE.fallenDuration : MOVE.stumbleDuration);
    });
    on('washed', ({ player, victim }) => {
      this.fx.burst({ x: victim.pos.x, y: 0.8, z: victim.pos.z }, team(player.team).accent, 26, 3.5, 0.18);
      this.fx.shockwave(victim.pos, team(player.team).accent, 3, 0.45);
      this.crowdEnergy = 1;
    });
    on('block', () => {
      this.gameCam.punch(0.6);
      this.fx.burst(bp(), '#ffffff', 20, 4, 0.2);
      this.crowdEnergy = 1;
    });
    on('tackle', ({ player }) => {
      this.fx.burst({ x: player.pos.x, y: 1.0, z: player.pos.z }, team(player.team).accent, 14, 2.5, 0.15);
      this.crowdEnergy = Math.max(this.crowdEnergy, 0.7);
    });
    on('bighit', ({ player, victim }) => {
      this.gameCam.punch(0.7);
      this.flash(0.003);
      this.fx.burst({ x: victim.pos.x, y: 1.0, z: victim.pos.z }, '#ffffff', 16, 3, 0.16);
      this.fx.shockwave(victim.pos, team(player.team).accent, 2.5, 0.35);
      this.crowdEnergy = Math.max(this.crowdEnergy, 0.8);
    });
    on('shot', ({ player, gb, volley, quality }) => {
      this.fx.bubbles(player.pos, gb ? 24 : 8, gb ? 2 : 1, 0.9);
      if (volley || gb) this.gameCam.setMode('goalcam', gb ? 1.8 : 1.2, player);
      if (this.sim.userTeam === null || player.team === this.sim.userTeam) {
        const highlight = gb || volley || quality >= 0.8;
        if (highlight) {
          this.highlightTimer = gb ? 1.2 : 0.72;
          this.simTimeScale = gb ? 0.2 : quality >= 1 ? 0.32 : 0.55;
          this.gameCam.punch(gb ? 0.8 : quality >= 1 ? 0.35 : 0.18);
        }
      }
    });
    on('breach', ({ player }) => this.fx.bubbles(player.pos, 10, 1.1, 0.2));
    on('splash', ({ pos, size }) => this.fx.bubbles(pos, 6, size, 0.1));
    on('alleyoop', ({ finisher }) => this.gameCam.setMode('goalcam', 1.4, finisher));
    on('gamebreaker', ({ player }) => {
      this.gameCam.setMode('gamebreaker', 3.0, player);
      this.gbFlash = 1;
      this.flash(0.004);
      this.fx.shockwave(player.pos, team(player.team).accent, 7, 0.8);
      this.crowdEnergy = 1;
    });
    on('gbshot', ({ player }) => this.gameCam.setMode('goalcam', 1.8, player));
    on('trick', ({ player, turbo }) => {
      this.fx.bubbles(player.pos, turbo ? 12 : 6, turbo ? 1.4 : 0.8, 0.4);
    });
    on('reset', () => this.gameCam.setMode('play', 0));
  }

  /** Detach every sim listener registered by bindEvents(). */
  unbindEvents() {
    if (!this._unsubs) return;
    for (const off of this._unsubs) off();
    this._unsubs = [];
  }

  /** Kick a chromatic-aberration flash (screen-space UV shift at the frame edges). */
  flash(strength) {
    if (!this.vignette) return;
    this.vignette.uniforms.offset.value = Math.max(this.vignette.uniforms.offset.value, strength);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }

  update(dt) {
    const sim = this.sim;
    this.elapsed += dt;
    if (this.highlightTimer > 0) {
      this.highlightTimer = Math.max(0, this.highlightTimer - dt);
      if (this.highlightTimer === 0) this.simTimeScale = 1;
    }
    for (const p of sim.players) {
      const v = this.views.get(p.id);
      v.update(p, sim, dt, sim.ball.holder === p);
    }
    // Ball
    const b = sim.ball;
    const holder = b.holder;
    if (holder && (holder.state === 'shoot' || holder.state === 'gbwind' || holder.state === 'gbdrive' || holder.state === 'pass' || holder.state === 'catch' || holder.state === 'trick' || holder.state === 'volley')) {
      const v = this.views.get(holder.id);
      v.handWorld(this.tmp);
      if (holder.state === 'gbwind' || holder.state === 'pass' || holder.state === 'catch' || holder.state === 'trick') {
        const l = new THREE.Vector3();
        v.leftHandWorld(l);
        this.tmp.lerp(l, 0.5);
      }
      this.ball.position.lerp(this.tmp, 0.7);
    } else if (holder) {
      // Tucked under the arm while swimming.
      const v = this.views.get(holder.id);
      v.handWorld(this.tmp);
      this.ball.position.lerp(this.tmp, 0.6);
    } else {
      this.ball.position.set(b.pos.x, b.pos.y, b.pos.z);
    }
    const spin = b.vel.length() * dt * 5 + (holder ? dt * 2 : 0);
    this.ballMesh.rotation.x += spin;
    this.ballMesh.rotation.z += spin * 0.3;
    this.ballShadow.position.set(this.ball.position.x, 0.015, this.ball.position.z);
    const bh = Math.max(0, this.ball.position.y);
    const bs = Math.max(0.4, 1 - bh * 0.15);
    this.ballShadow.scale.setScalar(bs);
    this.ballShadow.material.opacity = 0.5 * bs;

    // Landing ring under the ball's arc (pass / lob / keeper throw)
    const f = b.flight;
    if (f && f.kind !== 'shot' && f.to) {
      const u = Math.max(0, f.t / f.dur);
      this.landingRing.position.set(f.to.x, 0.02, f.to.z);
      const s = 0.5 + u * 1.3;
      this.landingRing.scale.setScalar(s);
      this.landingRing.material.opacity = 0.55 * Math.sin(Math.min(1, u * 1.15) * Math.PI);
    } else {
      this.landingRing.material.opacity = 0;
    }

    // Ball aura: on-fire team or gamebreaker
    const hotTeam = holder ? holder.team : b.lastTeam;
    const hot = sim.momentum[hotTeam] >= sim.rules.onFireGoals || sim.state === 'gamebreaker';
    const aura = this.ballAura.material;
    aura.opacity += ((hot ? 0.55 : 0) - aura.opacity) * Math.min(1, dt * 6);
    aura.color.set(sim.state === 'gamebreaker' ? this.sim.teams[hotTeam].accent : '#ff7a1f');
    this.ballAura.scale.setScalar(1 + Math.sin(this.elapsed * 20) * 0.15);
    const flightShot = b.flight && b.flight.kind === 'shot';
    const flightPass = b.flight && (b.flight.kind === 'pass' || b.flight.kind === 'lob');
    this.fx.updateTrail(this.ball.position, flightShot || flightPass || hot || sim.state === 'gamebreaker', flightShot ? (b.flight.gb ? this.sim.teams[b.flight.shooter.team].accent : hot ? '#ff7a1f' : '#ffd23f') : flightPass ? '#8ff7ff' : '#ff7a1f');

    // Goal ring pulses
    for (let i = 0; i < 2; i++) {
      const g = this.goals[i];
      if (!g) continue;
      this.goalPulse[i] = Math.max(0, this.goalPulse[i] - dt * 0.8);
      const glow = g.userData.glow;
      if (glow) {
        const s = 1 + this.goalPulse[i] * 0.35 * (0.5 + 0.5 * Math.sin(this.elapsed * 30));
        glow.scale.setScalar(s);
      }
    }

    // Water + bubbles
    if (this.water && this.water.userData.update) this.water.userData.update(this.elapsed);
    if (this.bubbles && this.bubbles.userData.update) this.bubbles.userData.update(dt);
    if (this.arcaneAccents && this.arcaneAccents.userData.update) this.arcaneAccents.userData.update(this.elapsed);

    // Crowd bounce (one instanced-buffer write for the whole stadium)
    this.crowdEnergy += (0.2 - this.crowdEnergy) * Math.min(1, dt * 0.6);
    if (this.crowd?.userData.update) this.crowd.userData.update(this.elapsed, this.crowdEnergy);

    // Per-player status FX: ON FIRE embers, turbo wakes, GB glow.
    for (const p of sim.players) {
      const v = this.views.get(p.id);
      const onFire = sim.momentum[p.team] >= sim.rules.onFireGoals;
      const gb = sim.state === 'gamebreaker' && sim.gamebreaker && sim.gamebreaker.player === p;
      if (onFire || gb) this.fx.embers(p.pos, gb ? this.sim.teams[p.team].accent : '#ff8c1f', dt, gb ? 34 : 20);
      const downT = this.downT.get(p.id) || 0;
      if (downT > 0) this.downT.set(p.id, downT - dt);
      if (onFire && downT > 0) this.fx.embers(p.pos, '#ffd23f', dt, 26);
      if (p.turboActive && (p.state === 'swim' || p.airborne) && p.speedNorm > 0.4) {
        this.fx.wake(p.pos, p.facing, dt, 26 + p.speedNorm * 20);
      }
    }

    this.fx.update(dt);
    this.gameCam.update(sim, dt);
    if (this.bloom) {
      this.gbFlash = Math.max(0, this.gbFlash - dt * 0.8);
      this.bloom.strength = 0.4 + this.gbFlash * 0.9 + (sim.state === 'gamebreaker' ? 0.3 : 0);
    }
    if (this.vignette) {
      this.vignette.uniforms.offset.value = Math.max(0, this.vignette.uniforms.offset.value - dt * 0.02);
    }
  }

  render() {
    this.composer.render();
  }

  /**
   * Release everything this match allocated. A match builds a whole scene (geometries, toon
   * materials, canvas textures, shadow maps, bloom render targets) plus its own WebGL context,
   * and the app creates a fresh one for every game — without this the GPU keeps paying for
   * matches that are long over, and browsers eventually start evicting live contexts.
   *
   * Note: texture maps are deliberately NOT disposed one by one. Several of them (toon gradient,
   * particle sprite, shadow blob) are module-level caches shared by every match, while the rest
   * live on the GPU and are reclaimed wholesale by forceContextLoss() below.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unbindEvents();
    this.composer?.dispose();
    this.scene?.traverse((obj) => {
      obj.geometry?.dispose?.();
      for (const mat of Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []) {
        for (const key in mat) {
          const v = mat[key];
          if (v && v.isRenderTarget) v.dispose?.();
        }
        mat.dispose?.();
      }
    });
    this.scene?.clear();
    this.views?.clear();
    this.fx = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // frees the GL context + all GPU resources it owns
  }
}

function skyTexture(colors) {
  const c = makeCanvas(16, 512);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.55, colors[1]);
  g.addColorStop(1, colors[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  const t = canvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
                                            }
