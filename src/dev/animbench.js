/**
 * BLITZBALL X — animation test bench (dev only).
 *
 * Activated by opening the app with `?bench=anim`. Replaces the normal App with a minimal
 * scene containing ONE swimmer, driven by a fake player object, so animation poses can be
 * scrubbed deterministically and screenshotted by tools/anim.mjs.
 *
 * Integration (2 lines in main.js):
 *   import { startAnimBench } from './dev/animbench.js';
 *   // in the DOMContentLoaded handler:
 *   window.app = startAnimBench() || new App();
 *
 * window.__bench API (driven by tools/anim.mjs, or manually in devtools):
 *   await window.__bench.pose(state, u, opts)  — hold a pose; u in [0,1] over the state's
 *                                                normalized duration. opts: { speed, trick,
 *                                                turbo, mirror, held }
 *   window.__bench.states                        — list of scrubbable states
 *   window.__bench.tricks                        — [{ id, name, kind }] (signature moves)
 *   window.__bench.setYaw(deg)                   — orbit the camera (default three-quarter)
 */

import * as THREE from 'three';
import { CharacterView } from '../render/character.js';
import { TEAMS } from '../data/teams.js';
import { TRICKS } from '../game/combat.js';

// Durations mirror the sim's current defaults (ACTION/MOVE in data/constants.js, TRICKS in
// game/combat.js). u is normalized against these, so retuning the sim only needs new numbers
// here — screenshots never drift.
const DUR = {
  catch: 0.14,
  pass: 0.22,
  tackle: 0.4,
  hit: 0.42,
  save: 0.55,
  volley: 0.45,
  gbwind: 0.6,
  stumble: 0.85,
  reel: 0.55, // MOVE.reelDuration — soft contact
  commit: 0.8, // COMBAT.diveCommit — a dive or swing that missed
  fallen: 1.15,
  celebrate: 1.2,
  breach: 1.0,
};
const SHOOT_WIND = 0.75;
const SHOOT_TOTAL = SHOOT_WIND + 0.3;
const SWIM_CYCLE_SECONDS = 3.0;

const SCRUB_STATES = [
  'idle', 'swim', 'catch', 'pass', 'shoot', 'volley', 'tackle', 'hit',
  'save', 'stumble', 'reel', 'commit', 'fallen', 'celebrate', 'gbwind', 'breach', 'trick',
];

export function startAnimBench() {
  if (!new URLSearchParams(window.location.search).has('bench')) return null;
  const bench = new AnimBench();
  window.__bench = bench;
  // Minimal stand-in so tool helpers that touch window.app don't crash.
  return { bench: true, go() {}, startMatch() {}, teams: TEAMS };
}

class AnimBench {
  constructor() {
    const team = TEAMS[0];
    const playerData = team.roster.find((p) => p.role !== 'GK') || team.roster[0];

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(this.renderer.domElement);
    // The bench never routes through App.go(), so retire the index.html boot splash itself.
    document.getElementById('boot')?.remove();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1420);

    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
    this.yaw = 35; // degrees, three-quarter front view
    this._placeCamera();

    this.scene.add(new THREE.HemisphereLight(0xbfd8ee, 0x1a2433, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(3, 6, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8ff7ff, 0.8);
    rim.position.set(-4, 3, -5);
    this.scene.add(rim);

    // Floor grid gives the pose scale and a horizon to read pitch/roll against.
    const grid = new THREE.GridHelper(10, 20, 0x2a4a66, 0x16304a);
    grid.position.y = -0.001;
    this.scene.add(grid);

    this.view = new CharacterView(playerData, team);
    this.scene.add(this.view.root);

    // Fake player: every field CharacterView.update() reads. Driven by pose().
    this.p = {
      id: playerData.id,
      team: 0,
      pos: { x: 0, z: 0 },
      y: 0,
      vy: 0,
      facing: 0,
      prevFacing: 0,
      speedNorm: 0,
      state: 'idle',
      stateTime: 0,
      stateDur: 0.01,
      anim: { t: 0 },
      turboActive: false,
      airborne: false,
      controlled: false,
      trick: null,
      shot: null,
      knockDir: { z: 1 },
      dribbleTouch: 0,
      data: playerData,
    };
    this.fakeSim = { userTeam: null, state: 'live', flow: [false, false] };
    this.held = false;
    this._last = performance.now();

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    const loop = (now) => {
      requestAnimationFrame(loop);
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (!(dt > 0) || dt > 0.1) dt = 0.016;
      // stateTime/anim.t stay frozen at the scrubbed value; the blend pass converges live.
      this.view.update(this.p, this.fakeSim, dt, this.held);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);

    this.ready = true;
  }

  get states() {
    return SCRUB_STATES.slice();
  }

  get tricks() {
    return TRICKS.map((t) => ({ id: t.key, name: t.name, kind: t.kind }));
  }

  setYaw(deg) {
    this.yaw = deg;
    this._placeCamera();
  }

  _placeCamera() {
    const a = (this.yaw * Math.PI) / 180;
    const r = 4.2;
    this.camera.position.set(Math.sin(a) * r, 1.7, Math.cos(a) * r);
    this.camera.lookAt(0, 0.95, 0);
  }

  /**
   * Hold a pose. u is normalized [0,1] across the state's duration.
   * opts: { speed, trick (id), turbo, mirror (save side), held (carry the ball) }
   */
  async pose(state, u, opts = {}) {
    u = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0));
    const p = this.p;
    p.trick = null;
    p.shot = null;
    p.vy = 0;
    p.airborne = false;
    p.turboActive = !!opts.turbo;
    p.speedNorm = 0;
    p.knockDir = { z: opts.mirror ? -1 : 1 };
    this.held = !!opts.held;

    switch (state) {
      case 'swim': {
        p.state = 'swim';
        p.speedNorm = opts.speed ?? 0.6;
        p.stateTime = u * SWIM_CYCLE_SECONDS;
        p.anim.t = u * SWIM_CYCLE_SECONDS;
        p.stateDur = SWIM_CYCLE_SECONDS;
        break;
      }
      case 'trick': {
        const def = TRICKS.find((t) => t.key === (opts.trick ?? TRICKS[0].key)) || TRICKS[0];
        p.state = 'trick';
        p.trick = { def, dir: { x: 0, z: 1 }, turbo: !!def.turbo, washed: new Set(), power: 1 };
        p.stateTime = u * def.dur;
        p.stateDur = def.dur;
        p.anim.t = u * def.dur;
        break;
      }
      case 'shoot': {
        p.state = 'shoot';
        p.shot = { wind: SHOOT_WIND, released: u > SHOOT_WIND / SHOOT_TOTAL, kind: 'shot' };
        p.stateTime = u * SHOOT_TOTAL;
        p.stateDur = SHOOT_TOTAL;
        break;
      }
      case 'breach': {
        p.state = 'breach';
        p.airborne = true;
        p.vy = u < 0.5 ? 5 : -5; // rising arc first, falling second
        p.stateTime = u * DUR.breach;
        p.stateDur = DUR.breach;
        break;
      }
      default: {
        p.state = state;
        p.anim.t = u * (DUR[state] || 1);
        p.stateTime = u * (DUR[state] || 1);
        p.stateDur = DUR[state] || 1;
        break;
      }
    }
  }
}
