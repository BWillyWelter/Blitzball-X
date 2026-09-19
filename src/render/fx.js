import * as THREE from 'three';
import { makeCanvas, canvasTexture } from './materials.js';

/**
 * Lightweight particle / decal effects: dust puffs, impact bursts, ball trail,
 * shockwave rings, confetti for gamebreakers. (FX layer.)
 */
export class FXSystem {
  constructor(scene, camera = null) {
    this.scene = scene;
    this.camera = camera;
    this.particles = [];
    this.max = 600;
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.max * 3);
    this.colors = new Float32Array(this.max * 3);
    this.sizes = new Float32Array(this.max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softDotTexture() } },
      vertexShader: `
        attribute float size; attribute vec3 color; varying vec3 vColor;
        void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a < 0.05) discard; gl_FragColor = vec4(vColor, t.a); }`,
      transparent: true,
      depthWrite: false,
      // Additive makes bubbles/sparks/confetti glow against the dark water instead of sitting on it.
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.8, 1.0, 40);
    this.trail = null;
    this.setupTrail();
  }

  setupTrail() {
    const n = 26;
    this.trailN = n;
    this.trailHistory = [];
    this.trailColor = new THREE.Color(0xffd23f);
    // Camera-facing ribbon instead of a 1px line (browsers ignore `linewidth`, so the old trail
    // rendered hairline-thin and effectively invisible). Vertex colours fade to black along the
    // tail; additive blending makes black contribute nothing, which reads as a smooth fade-out.
    const g = new THREE.BufferGeometry();
    this.trailPts = new Float32Array(n * 2 * 3);
    this.trailCol = new Float32Array(n * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPts, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.trail = new THREE.Mesh(g, m);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 2;
    this.scene.add(this.trail);
  }

  spawn(pos, vel, color, size, life, opts = {}) {
    if (this.particles.length >= this.max) this.particles.shift();
    this.particles.push({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      vx: vel.x,
      vy: vel.y,
      vz: vel.z,
      r: color.r,
      g: color.g,
      b: color.b,
      size,
      life,
      maxLife: life,
      gravity: opts.gravity ?? 0,
      drag: opts.drag ?? 0.98,
      floor: opts.floor ?? true,
    });
  }

  dust(pos, count = 8, strength = 1) {
    const c = new THREE.Color(0xb9b3a6);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 1.4) * strength;
      this.spawn(
        { x: pos.x + Math.cos(a) * 0.15, y: pos.y + 0.05, z: pos.z + Math.sin(a) * 0.15 },
        { x: Math.cos(a) * s, y: 0.6 + Math.random() * 0.8 * strength, z: Math.sin(a) * s },
        c,
        0.25 + Math.random() * 0.3,
        0.45 + Math.random() * 0.3,
        { gravity: -1.5, drag: 0.94 },
      );
    }
  }

  /** Underwater equivalent of dust: a cloud of small bubbles that rise. */
  bubbles(pos, count = 8, strength = 1, y = 0.6) {
    const c = new THREE.Color(0xdff6ff);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.4 + Math.random() * 1.2) * strength;
      this.spawn(
        { x: pos.x + Math.cos(a) * 0.2, y: (pos.y ?? y) + Math.random() * 0.4, z: pos.z + Math.sin(a) * 0.2 },
        { x: Math.cos(a) * s, y: 0.8 + Math.random() * 1.2 * strength, z: Math.sin(a) * s },
        c,
        0.08 + Math.random() * 0.14,
        0.6 + Math.random() * 0.5,
        { gravity: 1.2, drag: 0.94, floor: false },
      );
    }
  }

  /** Continuous emitter: glowing embers rising off ON FIRE / gamebreaker players. */
  embers(pos, color, dt, rate = 26) {
    this._emberAcc = (this._emberAcc || 0) + rate * dt;
    const c = new THREE.Color(color);
    const baseY = pos.y ?? 0;
    while (this._emberAcc >= 1) {
      this._emberAcc -= 1;
      this.spawn(
        { x: pos.x + (Math.random() - 0.5) * 0.55, y: baseY + 0.15 + Math.random() * 0.95, z: pos.z + (Math.random() - 0.5) * 0.55 },
        { x: (Math.random() - 0.5) * 0.5, y: 1.3 + Math.random() * 1.7, z: (Math.random() - 0.5) * 0.5 },
        c, 0.09 + Math.random() * 0.13, 0.4 + Math.random() * 0.55,
        { gravity: 2.0, drag: 0.96, floor: false },
      );
    }
  }

  /** Continuous emitter: spray wake kicked up behind a turbo swimmer. */
  wake(pos, facing, dt, rate = 34) {
    this._wakeAcc = (this._wakeAcc || 0) + rate * dt;
    const c = new THREE.Color(0xdff3ff);
    const sin = Math.sin(facing);
    const cos = Math.cos(facing);
    while (this._wakeAcc >= 1) {
      this._wakeAcc -= 1;
      const s = 0.7 + Math.random() * 1.3;
      this.spawn(
        { x: pos.x - sin * 0.35 + (Math.random() - 0.5) * 0.3, y: (pos.y ?? 0) + 0.04, z: pos.z - cos * 0.35 + (Math.random() - 0.5) * 0.3 },
        { x: -sin * s + (Math.random() - 0.5) * 0.6, y: 0.7 + Math.random() * 1.1, z: -cos * s + (Math.random() - 0.5) * 0.6 },
        c, 0.09 + Math.random() * 0.15, 0.3 + Math.random() * 0.35,
        { gravity: -2.4, drag: 0.95 },
      );
    }
  }

  burst(pos, color, count = 24, speed = 4, size = 0.22) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.3) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(pos, { x: Math.cos(a) * Math.cos(b) * s, y: Math.sin(b) * s + 1, z: Math.sin(a) * Math.cos(b) * s }, c, size * (0.6 + Math.random() * 0.8), 0.5 + Math.random() * 0.5, { gravity: -2.5, drag: 0.96, floor: false });
    }
  }

  confetti(pos, colors, count = 120) {
    for (let i = 0; i < count; i++) {
      const c = new THREE.Color(colors[i % colors.length]);
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 6;
      this.spawn(pos, { x: Math.cos(a) * s * 0.5, y: 3 + Math.random() * 5, z: Math.sin(a) * s * 0.5 }, c, 0.16 + Math.random() * 0.14, 2 + Math.random() * 1.5, { gravity: -1.6, drag: 0.98, floor: false });
    }
  }

  sparks(pos, color, count = 14) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 3;
      this.spawn(pos, { x: Math.cos(a) * s, y: Math.random() * 3, z: Math.sin(a) * s }, c, 0.1 + Math.random() * 0.1, 0.3 + Math.random() * 0.3, { gravity: -4, drag: 0.96, floor: false });
    }
  }

  shockwave(pos, color = 0xffffff, maxScale = 4, life = 0.5, opts = {}) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    if (opts.vertical) m.rotation.y = Math.PI / 2;
    else m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, opts.vertical ? pos.y : (pos.y ?? 0) + 0.04, pos.z);
    m.scale.setScalar(0.2);
    this.scene.add(m);
    this.rings.push({ mesh: m, life, maxLife: life, maxScale });
  }

  updateTrail(ballPos, active, color) {
    const m = this.trail.material;
    if (color) this.trailColor.set(color);
    if (active) {
      this.trailHistory.push([ballPos.x, ballPos.y, ballPos.z]);
      if (this.trailHistory.length > this.trailN) this.trailHistory.shift();
      m.opacity += (0.95 - m.opacity) * 0.3;
    } else {
      if (this.trailHistory.length) this.trailHistory.shift();
      m.opacity *= 0.85;
    }
    // Rebuild the ribbon: vertex pairs straddle the trail path, pushed onto the plane facing the
    // camera; width and brightness taper to nothing toward the tail.
    const cam = this.camera;
    const hist = this.trailHistory;
    const nPts = hist.length;
    const cx = cam ? cam.position.x : 0;
    const cy = cam ? cam.position.y : 30;
    const cz = cam ? cam.position.z : 0;
    const c = this.trailColor;
    const maxI = this.trailN - 1;
    for (let i = 0; i < this.trailN; i++) {
      const j = nPts - 1 - i;
      const ji = Math.max(0, j);
      const p = j >= 0 ? hist[j] : [ballPos.x, ballPos.y, ballPos.z];
      const fade = Math.max(0, 1 - i / maxI);
      const pn = hist[Math.max(0, ji - 1)] || p;
      const pp = hist[Math.min(nPts - 1, ji + 1)] || p;
      let tx = pp[0] - pn[0];
      let ty = pp[1] - pn[1];
      let tz = pp[2] - pn[2];
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-5) {
        tx /= tl;
        ty /= tl;
        tz /= tl;
      }
      // side = tangent x (camera - point), normalised; degenerate when the trail is a single point.
      let sx = ty * (cz - p[2]) - tz * (cy - p[1]);
      let sy = tz * (cx - p[0]) - tx * (cz - p[2]);
      let sz = tx * (cy - p[1]) - ty * (cx - p[0]);
      const sl = Math.hypot(sx, sy, sz);
      let halfW = 0.085 * (0.12 + 0.88 * fade);
      if (sl > 1e-5) {
        sx /= sl;
        sy /= sl;
        sz /= sl;
      } else halfW = 0;
      const o = i * 6;
      this.trailPts[o] = p[0] + sx * halfW;
      this.trailPts[o + 1] = p[1] + sy * halfW;
      this.trailPts[o + 2] = p[2] + sz * halfW;
      this.trailPts[o + 3] = p[0] - sx * halfW;
      this.trailPts[o + 4] = p[1] - sy * halfW;
      this.trailPts[o + 5] = p[2] - sz * halfW;
      const b = fade * fade * 0.9;
      const cr = c.r * b;
      const cg = c.g * b;
      const cb = c.b * b;
      this.trailCol[o] = cr;
      this.trailCol[o + 1] = cg;
      this.trailCol[o + 2] = cb;
      this.trailCol[o + 3] = cr;
      this.trailCol[o + 4] = cg;
      this.trailCol[o + 5] = cb;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;
  }

  update(dt) {
    const ps = this.particles;
    let n = 0;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.vx *= p.drag;
      p.vz *= p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.floor && p.y < 0.02) {
        p.y = 0.02;
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.8;
        p.vz *= 0.8;
      }
    }
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const u = p.life / p.maxLife;
      const f = u * u * (3 - 2 * u); // smoothstep fade so additive particles dissolve, not pop
      this.positions[n * 3] = p.x;
      this.positions[n * 3 + 1] = p.y;
      this.positions[n * 3 + 2] = p.z;
      this.colors[n * 3] = p.r * f;
      this.colors[n * 3 + 1] = p.g * f;
      this.colors[n * 3 + 2] = p.b * f;
      this.sizes[n] = p.size * (0.3 + u * 0.7);
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const u = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(0.2 + u * r.maxScale);
      r.mesh.material.opacity = (1 - u) * 0.9;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}

let _dot = null;
function softDotTexture() {
  if (_dot) return _dot;
  const c = makeCanvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _dot = canvasTexture(c);
  return _dot;
}
