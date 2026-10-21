import * as THREE from 'three';
import { ARENA } from '../data/constants.js';
import { CharacterView } from './character.js';
import { GameCamera } from './camera.js';
import { FXSystem } from './fx.js';

/**
 * Match-specific 3D dressing layered into the shared sphere-pool scene. Keeps render-only concerns
 * out of MatchSim: every swimmer is a CharacterView, the ball is a readable prop, and gameplay
 * events feed the existing bubble / trail / replay systems.
 */
export class MatchScene {
  constructor(scene, camera, environment, settings = {}) {
    this.scene = scene;
    this.camera = camera;
    this.environment = environment;
    this.camOptions = {
      screenShake: settings.screenShake,
      reducedMotion: settings.reducedMotion,
    };
    this.gameCam = new GameCamera(camera, this.camOptions);
    // Split-screen duel: the second seat gets its own boom on its own camera.
    this.gameCams = [this.gameCam];
    this.fx = new FXSystem(scene, camera);
    this.sim = null;
    this.boundSim = null;
    // True while a goal replay is driving the camera itself; the follow rig must stand down or it
    // would overwrite the cinematic cut every frame.
    this.replayActive = false;
    this.unsubscribers = [];
    this.playerViews = new Map();
    this.ballRoot = this.buildBall();
    this.ballSpin = 0;
    this.scene.add(this.ballRoot);
  }

  /** Give seat two its own camera. Called only for a two-seat local duel. */
  enableSecondCamera(camera2) {
    if (!camera2) return null;
    if (this.gameCam2) return this.gameCam2;
    this.gameCam2 = new GameCamera(camera2, { ...this.camOptions, seatIndex: 1 });
    this.gameCams = [this.gameCam, this.gameCam2];
    return this.gameCam2;
  }

  /** Every live camera, so effects and shake reach both halves of a duel. */
  punch(amount) {
    for (const cam of this.gameCams) cam.punch(amount);
  }

  setMode(mode, focus) {
    for (const cam of this.gameCams) cam.setMode(mode, focus);
  }

  buildBall() {
    const root = new THREE.Group();
    root.name = 'blitzball';

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.33, 24, 18),
      new THREE.MeshStandardMaterial({
        color: 0xffc846,
        metalness: 0.18,
        roughness: 0.32,
        emissive: 0x542600,
        emissiveIntensity: 0.55,
      }),
    );
    shell.castShadow = true;
    shell.receiveShadow = true;
    root.add(shell);

    const seamMaterial = new THREE.MeshBasicMaterial({ color: 0x553019, transparent: true, opacity: 0.92 });
    const seams = [
      new THREE.TorusGeometry(0.245, 0.018, 6, 28),
      new THREE.TorusGeometry(0.245, 0.018, 6, 28),
    ];
    const seamA = new THREE.Mesh(seams[0], seamMaterial);
    seamA.rotation.x = Math.PI / 2;
    const seamB = new THREE.Mesh(seams[1], seamMaterial);
    seamB.rotation.y = Math.PI / 2;
    root.add(seamA, seamB);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.39, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffb52f, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    root.add(glow);
    root.userData.disposable = [shell.geometry, shell.material, seams[0], seams[1], seamMaterial, glow.geometry, glow.material];
    return root;
  }

  attach(sim) {
    if (this.boundSim === sim) {
      this.sim = sim;
      return;
    }
    this.detachEvents();
    this.sim = sim;
    this.boundSim = sim;
    if (!sim?.events) return;

    const listen = (type, handler) => this.unsubscribers.push(sim.events.on(type, handler));
    listen('score', ({ team, player, gb, points }) => {
      const x = ARENA.goalX * sim.attackDir(team);
      const pos = { x, y: ARENA.goalY, z: 0 };
      const color = sim.teams[team]?.primary || '#5cf2ff';
      this.environment?.pulseGoal(team);
      this.fx.burst(pos, color, gb ? 54 : 32, gb ? 8 : 5.5, gb ? 0.3 : 0.22);
      this.fx.bubbles(pos, gb ? 40 : 22, gb ? 1.6 : 1.1);
      this.fx.shockwave(pos, color, gb ? 9 : 6, gb ? 0.9 : 0.65, { vertical: true });
      this.setMode(gb ? 'gamebreaker' : 'score', player);
      this.punch(gb ? 0.75 : 0.42);
      if (gb) this.fx.confetti(pos, [color, sim.teams[1 - team]?.primary || '#ff2ea6', '#ffd23f', '#5cf2ff'], 90);
      if (points >= 3) this.punch(0.16);
    });
    listen('bighit', ({ player, victim, impact }) => {
      const p = victim?.pos || player?.pos;
      if (!p) return;
      this.fx.burst(p, '#ff8a3d', Math.round(12 + (impact || 1) * 9), 3.8, 0.16);
      this.fx.bubbles(p, 14, 0.8);
      this.punch(0.5);
    });
    listen('tackle', ({ player, victim }) => {
      const p = victim?.pos || player?.pos;
      if (p) this.fx.bubbles(p, 8, 0.55);
    });
    listen('save', ({ keeper }) => {
      const p = keeper?.pos;
      if (p) this.fx.burst(p, sim.teams[keeper.team]?.accent || '#5cf2ff', 16, 3.2, 0.14);
    });
    listen('gamebreaker', ({ player }) => {
      if (player) this.setMode('gamebreaker', player);
      this.punch(0.65);
    });
    listen('shot', ({ player }) => {
      if (player) this.fx.bubbles(player.pos, 7, 0.55);
    });
  }

  detachEvents() {
    for (const off of this.unsubscribers) off?.();
    this.unsubscribers.length = 0;
    this.boundSim = null;
  }

  /**
   * Accepts `update(sim, dt)` in the app and `update(dt)` for the existing QA helpers, which keep
   * the currently attached sim on the presenter.
   */
  update(simOrDelta, maybeDelta) {
    let dt = maybeDelta;
    if (typeof simOrDelta === 'number') dt = simOrDelta;
    else if (simOrDelta) this.attach(simOrDelta);
    const sim = this.sim;
    if (!sim) return;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.05, dt)) : 0;

    if (!this.replayActive) {
      this.gameCam.update(sim, dt);
      if (this.gameCam2 && sim.seats && sim.seats.length > 1) this.gameCam2.update(sim, dt);
    }
    const active = new Set();
    for (const player of sim.players) {
      active.add(player.id);
      let view = this.playerViews.get(player.id);
      if (!view) {
        view = new CharacterView(player.data, sim.teams[player.team]);
        this.playerViews.set(player.id, view);
        this.scene.add(view.root);
      }
      view.update(player, sim, dt, sim.ball.holder === player);
      view.ring.visible = !!(player.controlled || sim.ball.holder === player);
      view.ring.material.color.set(sim.ball.holder === player ? '#ffd23f' : sim.teams[player.team].accent);
      view.tag.visible = !!(player.controlled || sim.ball.holder === player);
      if (player.turboActive && dt > 0) this.fx.wake(player.pos, player.facing, dt, 18);
    }

    for (const [id, view] of this.playerViews) {
      if (active.has(id)) continue;
      view.dispose();
      this.playerViews.delete(id);
    }

    const ball = sim.ball;
    this.ballRoot.position.set(ball.pos.x, ball.pos.y, ball.pos.z);
    const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
    if (speed > 0.12) {
      this.ballSpin += speed * dt * 2.5;
      this.ballRoot.rotation.set(this.ballSpin * 0.62, this.ballSpin * 0.45, this.ballSpin);
    }
    const lastTeam = Number.isInteger(ball.lastTeam) ? ball.lastTeam : sim.possession;
    const trailColor = sim.teams[lastTeam]?.primary || '#ffd23f';
    this.fx.updateTrail(ball.pos, !!ball.flight && speed > 2.5, trailColor, dt);
    this.fx.update(dt);
  }

  setSettings(settings = {}) {
    for (const cam of this.gameCams) {
      cam.shakeEnabled = settings.screenShake !== false;
      cam.reducedMotion = !!settings.reducedMotion;
    }
  }

  dispose() {
    this.detachEvents();
    for (const view of this.playerViews.values()) view.dispose();
    this.playerViews.clear();
    this.scene.remove(this.ballRoot);
    for (const resource of this.ballRoot.userData.disposable || []) resource.dispose?.();
    this.fx.dispose?.();
    this.sim = null;
  }
}
