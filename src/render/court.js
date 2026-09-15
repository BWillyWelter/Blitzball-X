import * as THREE from 'three';
import { ARENA } from '../data/constants.js';
import { toon, toonGradient, makeCanvas, canvasTexture, withOutline, noise2 } from './materials.js';

/**
 * Builds the Blitzball arena: a giant sphere of water suspended over a street stadium.
 * Inside: a holographic playing disc with crease arcs, two goal rings with nets, floating
 * light rigs; outside: stands with a crowd, graffiti banners, floodlights and a skyline.
 */
export function buildCourt(scene, theme) {
  const group = new THREE.Group();
  group.name = 'arena';
  group.add(buildWaterSphere(theme));
  group.add(buildPlayingDisc(theme));
  group.add(buildArcaneAccents(theme));
  group.add(buildGoal(1, theme));
  group.add(buildGoal(-1, theme));
  group.add(buildBubbles(theme));
  group.add(buildSurroundings(theme));
  scene.add(group);
  return group;
}

function buildArcaneAccents(theme) {
  const g = new THREE.Group();
  g.name = 'arcaneAccents';
  const lineMat = new THREE.MeshBasicMaterial({ color: theme.line, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending });
  const accentMat = new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });

  // A suspended sigil gives the court a high-fantasy broadcast identity without obscuring play.
  const sigil = new THREE.Group();
  sigil.position.y = 0.18;
  for (const radius of [1.0, 1.28, 1.55]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.018, 6, 64), lineMat);
    ring.rotation.x = -Math.PI / 2;
    sigil.add(ring);
  }
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 1), accentMat);
  crystal.position.y = 0.35;
  sigil.add(crystal);
  g.add(sigil);

  // Energy lanes point toward both goals and make the playable space legible at a glance.
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const lane = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.018, 5.5 - i * 0.5), lineMat);
      lane.position.set(sign * (2.2 + i * 1.0), 0.01, 0);
      lane.rotation.y = sign * (0.05 + i * 0.025);
      g.add(lane);
    }
  }

  // Crystal pylons mark the boundary and pulse with the same rhythm as the water shader.
  const pylons = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const pylon = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 1), accentMat.clone());
    pylon.position.set(Math.cos(a) * (ARENA.fieldRadius - 0.15), 0.2, Math.sin(a) * (ARENA.fieldRadius - 0.15));
    pylon.scale.y = 1.8;
    pylons.push(pylon);
    g.add(pylon);
  }
  g.userData.update = (time) => {
    sigil.rotation.y = time * 0.18;
    crystal.rotation.x = time * 1.6;
    crystal.rotation.z = time * 1.1;
    const pulse = 0.62 + Math.sin(time * 3.5) * 0.2;
    for (let i = 0; i < pylons.length; i++) {
      pylons[i].material.opacity = pulse + Math.sin(time * 4 + i) * 0.1;
      pylons[i].scale.x = 0.85 + Math.sin(time * 3 + i) * 0.12;
      pylons[i].scale.z = 0.85 + Math.sin(time * 3 + i) * 0.12;
    }
  };
  return g;
}

const THEMES = {
  harbor: { water: '#0f6f8f', deep: '#062a44', line: '#8ff7ff', sky: ['#0a1d33', '#0d5f78', '#f5a86b'], wall: '#1b2a3a', accent: '#12b5b0', fog: '#0a2436' },
  chapel: { water: '#5b4b1f', deep: '#1c1608', line: '#ffe27a', sky: ['#120d2a', '#5c2a6b', '#ff7e5f'], wall: '#2a2426', accent: '#f2c230', fog: '#231a2a' },
  foundry: { water: '#7a3b1b', deep: '#2a120a', line: '#ffd9c2', sky: ['#1a0f0a', '#5a2a12', '#ff8c42'], wall: '#2b2320', accent: '#ff6a1f', fog: '#2a1a12' },
  neon: { water: '#3a1a7a', deep: '#0e0630', line: '#5cf2ff', sky: ['#05030f', '#2a0a55', '#ff2ea6'], wall: '#150d2a', accent: '#c026ff', fog: '#150a2a' },
  yard: { water: '#6b2230', deep: '#240a10', line: '#ffd23f', sky: ['#0d1526', '#3e4f7a', '#f7b267'], wall: '#2c2c30', accent: '#e11d2e', fog: '#1a2030' },
  hollow: { water: '#2c3a30', deep: '#0c1410', line: '#7bff6b', sky: ['#07080c', '#1c1f2b', '#4a5568'], wall: '#1a1b20', accent: '#7bff6b', fog: '#101218' },
  pier: { water: '#1f5f8a', deep: '#0c2740', line: '#ffd56b', sky: ['#1b2a5a', '#ff7b54', '#ffd56b'], wall: '#2f3a4a', accent: '#ff7a59', fog: '#2a2a3a' },
  uptown: { water: '#1e3a8a', deep: '#0a1440', line: '#f5f0e6', sky: ['#0c1330', '#3149a0', '#ffc38b'], wall: '#2b2f3c', accent: '#2f5bff', fog: '#1a2040' },
};

export function themeFor(team) {
  return THEMES[team?.arena] || THEMES.harbor;
}

// ---------------------------------------------------------------------------
// Water sphere
// ---------------------------------------------------------------------------

function buildWaterSphere(theme) {
  const g = new THREE.Group();
  g.name = 'water';
  const R = ARENA.sphereRadius;
  // Inner surface: caustic shader, seen from inside.
  const inner = new THREE.Mesh(
    new THREE.SphereGeometry(R, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uWater: { value: new THREE.Color(theme.water) },
        uDeep: { value: new THREE.Color(theme.deep) },
        uLine: { value: new THREE.Color(theme.line) },
      },
      vertexShader: `
        varying vec3 vPos;
        varying vec3 vNormal;
        void main() {
          vPos = position;
          vNormal = normal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uWater;
        uniform vec3 uDeep;
        uniform vec3 uLine;
        varying vec3 vPos;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          vec3 n = normalize(vPos);
          float up = n.y * 0.5 + 0.5;
          vec3 base = mix(uDeep, uWater, smoothstep(0.1, 0.9, up));
          // caustics
          vec2 uv = vec2(atan(n.z, n.x) * 4.0, n.y * 6.0);
          float c1 = vnoise(uv * 1.7 + uTime * 0.3);
          float c2 = vnoise(uv * 3.1 - uTime * 0.22 + 5.0);
          float caustic = pow(max(0.0, 1.0 - abs(c1 - c2) * 4.0), 4.0);
          base += uLine * caustic * 0.2 * (0.3 + up * 0.7);
          // god rays from above
          float ray = pow(max(0.0, n.y), 6.0) * (0.6 + 0.4 * sin(atan(n.z, n.x) * 14.0 + uTime * 0.6));
          base += vec3(0.9, 0.95, 1.0) * ray * 0.35;
          // cel banding
          float lum = dot(base, vec3(0.299, 0.587, 0.114));
          float band = floor(lum * 5.0) / 5.0;
          base *= 0.7 + band * 0.5;
          gl_FragColor = vec4(base, 0.92);
        }
      `,
    })
  );
  inner.name = 'waterInner';
  inner.renderOrder = -10;
  g.add(inner);

  // Outer surface: glossy shell so the sphere reads from outside camera angles.
  const outer = new THREE.Mesh(
    new THREE.SphereGeometry(R + 0.4, 48, 32),
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(theme.water),
      transparent: true,
      opacity: 0.22,
      roughness: 0.15,
      metalness: 0,
      transmission: 0,
      side: THREE.FrontSide,
      depthWrite: false,
    })
  );
  outer.renderOrder = 50;
  g.add(outer);

  // Rim ring "surface" at the equator to sell the sphere silhouette.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.4, 0.12, 8, 96), new THREE.MeshBasicMaterial({ color: theme.line, transparent: true, opacity: 0.35 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.2;
  g.add(rim);

  g.userData.update = (t) => {
    inner.material.uniforms.uTime.value = t;
  };
  return g;
}

// ---------------------------------------------------------------------------
// Playing disc (holographic markings)
// ---------------------------------------------------------------------------

function buildPlayingDisc(theme) {
  const g = new THREE.Group();
  g.name = 'disc';
  const R = ARENA.fieldRadius + 0.6;
  const px = 40;
  const c = makeCanvas(Math.round(R * 2 * px), Math.round(R * 2 * px));
  const ctx = c.getContext('2d');
  const cx = c.width / 2;
  const cz = c.height / 2;
  const toPx = (x, z) => [cx + x * px, cz + z * px];
  ctx.clearRect(0, 0, c.width, c.height);
  // translucent disc
  const grad = ctx.createRadialGradient(cx, cz, 0, cx, cz, R * px);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(0.85, 'rgba(255,255,255,0.03)');
  grad.addColorStop(1, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cz, R * px, 0, Math.PI * 2);
  ctx.fill();
  // hex grid
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 2;
  const hs = 38;
  for (let y = -R * px; y < R * px; y += hs * 1.5) {
    for (let x = -R * px; x < R * px; x += hs * Math.sqrt(3)) {
      const ox = ((y / (hs * 1.5)) | 0) % 2 ? (hs * Math.sqrt(3)) / 2 : 0;
      const hx = cx + x + ox;
      const hy = cz + y;
      if (Math.hypot(hx - cx, hy - cz) > R * px - 20) continue;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const X = hx + Math.cos(a) * hs * 0.9;
        const Y = hy + Math.sin(a) * hs * 0.9;
        if (k === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  // outer boundary
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cz, ARENA.fieldRadius * px, 0, Math.PI * 2);
  ctx.stroke();
  // centre circle + line
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cz, ARENA.centerCircle * px, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cz - ARENA.fieldRadius * px);
  ctx.lineTo(cx, cz + ARENA.fieldRadius * px);
  ctx.stroke();
  // crease arcs
  for (const s of [1, -1]) {
    const [gx, gz] = toPx(ARENA.goalX * s, 0);
    ctx.beginPath();
    ctx.arc(gx, gz, ARENA.creaseRadius * px, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = hexToRgba(theme.accent, 0.12);
    ctx.fill();
    // keeper box
    const [bx0, bz0] = toPx(ARENA.keeperMinX * s, -ARENA.keeperMaxZ);
    const [bx1, bz1] = toPx(ARENA.keeperMaxX * s, ARENA.keeperMaxZ);
    ctx.strokeRect(Math.min(bx0, bx1), Math.min(bz0, bz1), Math.abs(bx1 - bx0), Math.abs(bz1 - bz0));
  }
  // centre logo
  ctx.save();
  ctx.translate(cx, cz);
  ctx.font = `900 ${Math.round(px * 1.6)}px "Bangers", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText('BLITZBALL X', 0, 0);
  ctx.fillStyle = hexToRgba(theme.line, 0.8);
  ctx.fillText('BLITZBALL X', 0, 0);
  ctx.restore();
  const tex = canvasTexture(c);
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.02;
  disc.renderOrder = -5;
  disc.receiveShadow = false;
  g.add(disc);
  // Shadow catcher (invisible but receives blob-less contact shadows from the directional light)
  const catcher = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.ShadowMaterial({ opacity: 0.25 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = -0.03;
  catcher.receiveShadow = true;
  g.add(catcher);
  // Floating marker pylons around the boundary
  const pylonMat = new THREE.MeshBasicMaterial({ color: theme.line, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), pylonMat);
    p.position.set(Math.cos(a) * (ARENA.fieldRadius + 0.3), 0.6, Math.sin(a) * (ARENA.fieldRadius + 0.3));
    g.add(p);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function buildGoal(sign, theme) {
  const g = new THREE.Group();
  g.name = sign > 0 ? 'goalPos' : 'goalNeg';
  const x = ARENA.goalX * sign;
  const ringMat = toon('#ffd23f');
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ARENA.goalRadius, ARENA.postRadius, 12, 48), ringMat);
  ring.rotation.y = Math.PI / 2;
  ring.position.set(x, ARENA.goalY, 0);
  ring.castShadow = true;
  g.add(withOutline(ring, 0.03));
  // inner glow ring
  const glow = new THREE.Mesh(new THREE.TorusGeometry(ARENA.goalRadius - 0.1, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: theme.accent }));
  glow.rotation.y = Math.PI / 2;
  glow.position.set(x, ARENA.goalY, 0);
  g.add(glow);
  g.userData.glow = glow;
  // Net: a cone of lines behind the ring
  const netMat = new THREE.LineBasicMaterial({ color: 0xf5f0e6, transparent: true, opacity: 0.55 });
  const netPts = [];
  const depth = 1.7;
  const segs = 20;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const r = ARENA.goalRadius;
    netPts.push(new THREE.Vector3(x, ARENA.goalY + Math.cos(a) * r, Math.sin(a) * r));
    netPts.push(new THREE.Vector3(x + sign * depth, ARENA.goalY + Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25));
  }
  for (let ringI = 1; ringI <= 3; ringI++) {
    const t = ringI / 4;
    const r = ARENA.goalRadius * (1 - t * 0.75);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      netPts.push(new THREE.Vector3(x + sign * depth * t, ARENA.goalY + Math.cos(a0) * r, Math.sin(a0) * r));
      netPts.push(new THREE.Vector3(x + sign * depth * t, ARENA.goalY + Math.cos(a1) * r, Math.sin(a1) * r));
    }
  }
  const net = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(netPts), netMat);
  g.add(net);
  // Mounting arms to the sphere wall
  const armMat = toon('#3a3a42');
  for (const dz of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8), armMat);
    arm.position.set(x + sign * 1.4, ARENA.goalY + 0.2, dz * 1.2);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = dz * 0.35;
    g.add(arm);
  }
  // Goal-line light bar
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, ARENA.goalRadius * 2 + 1.2), new THREE.MeshBasicMaterial({ color: theme.accent }));
  bar.position.set(x, ARENA.goalY - ARENA.goalRadius - 0.35, 0);
  g.add(bar);
  // Team-ish banner behind goal (on the sphere wall)
  const c = makeCanvas(512, 192);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = '900 120px "Bangers", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#0b0b12';
  ctx.lineJoin = 'round';
  ctx.strokeText('GOAL', 256, 96);
  ctx.fillStyle = theme.line;
  ctx.fillText('GOAL', 256, 96);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.9), new THREE.MeshBasicMaterial({ map: canvasTexture(c), transparent: true, depthWrite: false }));
  banner.position.set(x + sign * 6, ARENA.goalY + 4.2, 0);
  banner.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
  g.add(banner);
  return g;
}

// ---------------------------------------------------------------------------
// Ambient bubbles / particles inside the sphere
// ---------------------------------------------------------------------------

function buildBubbles(theme) {
  const count = 320;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const R = ARENA.sphereRadius - 1;
  for (let i = 0; i < count; i++) {
    const r = Math.cbrt(noise2(i, 1)) * R;
    const th = noise2(i, 2) * Math.PI * 2;
    const ph = Math.acos(2 * noise2(i, 3) - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    speeds[i] = 0.3 + noise2(i, 4) * 0.9;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'bubbles';
  pts.userData.update = (dt) => {
    const a = geo.attributes.position;
    for (let i = 0; i < count; i++) {
      let y = a.getY(i) + speeds[i] * dt;
      const x = a.getX(i);
      const z = a.getZ(i);
      const maxY = Math.sqrt(Math.max(0, R * R - x * x - z * z));
      if (y > maxY) y = -maxY * 0.9;
      a.setY(i, y);
      a.setX(i, x + Math.sin(y * 1.3 + i) * dt * 0.15);
    }
    a.needsUpdate = true;
  };
  return pts;
}

// ---------------------------------------------------------------------------
// Stadium around the sphere
// ---------------------------------------------------------------------------

function buildSurroundings(theme) {
  const g = new THREE.Group();
  g.name = 'stadium';
  const R = ARENA.sphereRadius;
  const groundY = -R - 3;

  // Ground: wide dark plaza
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(140, 64), toon('#1d2028'));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = groundY;
  g.add(plaza);

  // Support cradle (tripod arms holding the sphere)
  const armMat = toon('#2f333d');
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, R + 6, 10), armMat);
    arm.position.set(Math.cos(a) * (R * 0.55), groundY + (R + 6) / 2 - 1, Math.sin(a) * (R * 0.55));
    arm.lookAt(0, -R * 0.55, 0);
    arm.rotateX(Math.PI / 2);
    g.add(arm);
  }

  // Stands: ring of tiered seats around the equator, outside the sphere
  const crowd = new THREE.Group();
  crowd.name = 'crowd';
  const crowdColors = ['#ff2ea6', '#5cf2ff', '#ffd23f', '#f5f0e6', '#7bff6b', '#ff6a1f', theme.accent, '#c026ff', '#2c2c30', '#8a8f99'];
  const skin = ['#f1c27d', '#c68642', '#8d5524', '#5c3a21'];
  const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.6, 3, 6);
  const headGeo = new THREE.SphereGeometry(0.2, 7, 6);
  const tiers = 5;
  for (let t = 0; t < tiers; t++) {
    const rr = R + 4 + t * 1.6;
    const y = -3.5 + t * 1.1;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.75, 6, 96), toon(t % 2 ? '#3d4553' : '#4b5563'));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
    const n = Math.floor(rr * 2.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (noise2(i * 1.7, t) < 0.22) continue;
      const person = new THREE.Group();
      const bm = toon(crowdColors[Math.floor(noise2(i, t * 7) * crowdColors.length)]);
      const body = new THREE.Mesh(bodyGeo, bm);
      body.position.y = 0.55;
      const head = new THREE.Mesh(headGeo, toon(skin[Math.floor(noise2(i * 2, t) * skin.length)]));
      head.position.y = 1.2;
      person.add(body, head);
      person.position.set(Math.cos(a) * rr, y + 0.6, Math.sin(a) * rr);
      person.lookAt(0, y, 0);
      person.userData.baseY = person.position.y;
      person.userData.phase = noise2(i, t * 3) * Math.PI * 2;
      crowd.add(person);
    }
  }
  g.add(crowd);
  g.userData.crowd = crowd;

  // Graffiti banners hung on the top tier (facing inward)
  const tags = ['BLITZBALL X', 'NO LOVE IN THE POOL', 'RUN IT BACK', 'GAMEBREAKER', 'GET WASHED', 'DEEP END', 'X'];
  const palette = [theme.accent, '#ff2ea6', '#5cf2ff', '#ffd23f', '#7bff6b', '#ff6a1f', '#ffffff'];
  for (let i = 0; i < 7; i++) {
    const c = makeCanvas(768, 192);
    const ctx = c.getContext('2d');
    ctx.fillStyle = theme.wall;
    ctx.fillRect(0, 0, c.width, c.height);
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = hexToRgba(palette[(i + k) % palette.length], 0.18);
      ctx.fillRect(noise2(i, k) * 700, 0, 40 + noise2(k, i) * 80, 192);
    }
    ctx.font = '900 118px "Bangers", "Permanent Marker", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 16;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b0b12';
    ctx.strokeText(tags[i], 384, 100);
    ctx.fillStyle = palette[i % palette.length];
    ctx.fillText(tags[i], 384, 100);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.3), new THREE.MeshToonMaterial({ map: canvasTexture(c), gradientMap: toonGradient() }));
    const a = (i / 7) * Math.PI * 2 + 0.2;
    const rr = R + 4 + tiers * 1.6 + 0.6;
    banner.position.set(Math.cos(a) * rr, 3.5, Math.sin(a) * rr);
    banner.lookAt(0, 3.5, 0);
    g.add(banner);
  }

  // Floodlight masts
  const lightMat = toon('#3a3a42');
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rr = R + 16;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const h = R + 22;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h, 8), lightMat);
    pole.position.set(x, groundY + h / 2, z);
    g.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 0.8), lightMat);
    head.position.set(x, groundY + h + 0.6, z);
    head.lookAt(0, 6, 0);
    g.add(head);
    const bulb = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), bulbMat);
    bulb.position.copy(head.position);
    bulb.lookAt(0, 6, 0);
    bulb.translateZ(0.42);
    g.add(bulb);
  }

  // Skyline ring
  const skyline = new THREE.Group();
  const bMat = toon('#0f1118');
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const dist = 95 + noise2(i, 43) * 30;
    const w = 6 + noise2(i, 41) * 10;
    const h = 14 + noise2(i, 42) * 46;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), bMat);
    b.position.set(Math.cos(a) * dist, groundY + h / 2, Math.sin(a) * dist);
    b.rotation.y = -a;
    skyline.add(b);
    for (let k = 0; k < 8; k++) {
      if (noise2(i, k * 5) < 0.4) continue;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), winMat);
      win.position.set(Math.cos(a) * (dist - w / 2 - 0.05), groundY + 3 + noise2(k, i) * (h - 4), Math.sin(a) * (dist - w / 2 - 0.05));
      win.position.x += Math.sin(a) * (noise2(i, k) - 0.5) * (w - 1.5);
      win.position.z -= Math.cos(a) * (noise2(i, k) - 0.5) * (w - 1.5);
      win.lookAt(0, win.position.y, 0);
      skyline.add(win);
    }
  }
  g.add(skyline);
  return g;
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
