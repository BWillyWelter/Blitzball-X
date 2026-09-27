/**
 * BLITZBALL X — keyframe pose-track system.
 *
 * Turns animation from per-frame trig in CharacterView.update() into authored data:
 * each track is a list of normalized keyframes (u in [0,1] over the sim state's duration)
 * that target named rig joints. Sampling is allocation-free — tracks are compiled once into
 * flat Float32Arrays and sampleTrack/applyTrack reuse module-level scratch buffers.
 *
 * The existing pose pipeline is unchanged underneath: applyTrack() writes joint targets
 * exactly like the old inline pose code did, and the dampAngle/blend pass at the end of
 * CharacterView.update() still smooths every transition.
 *
 * Conventions:
 *   - Rotation values are radians, matching the old procedural poses 1:1.
 *   - Joints missing from a keyframe hold their previous value (carry-forward), so a track
 *     only needs to author the joints that move.
 *   - Angle channels wrap to [-PI, PI] between keys at compile time, UNLESS the joint is
 *     listed in opts.raw — full-body spins (trick rolls, the fallen tumble) need raw lerp.
 *   - Positional channels: { by, bz, hy } = body.position.y/z and the hips height target.
 */

export const J = {
  body: 0, hips: 1, spine: 2, torso: 3, neck: 4,
  clavL: 5, shL: 6, elL: 7, wrL: 8,
  clavR: 9, shR: 10, elR: 11, wrR: 12,
  hipL: 13, kneeL: 14, hipR: 15, kneeR: 16,
};
export const N_JOINTS = 17;
const ROT_FLOATS = N_JOINTS * 3;

// Module-level scratch — sampling never allocates. Single render thread, like poseFromX/Y/Z.
const scratchRot = new Float32Array(ROT_FLOATS);
const scratchPos = new Float32Array(3);

const EASE = {
  linear: (u) => u,
  in: (u) => u * u * u,
  out: (u) => 1 - Math.pow(1 - u, 3),
  inout: (u) => u * u * u * (u * (u * 6 - 15) + 10),
};

/**
 * Keyframe helper. Accepts both of these shapes (ease is optional in both):
 *   k(u, { [J.x]: [rx,ry,rz] }, { by, bz, hy })
 *   k(u, { e: 'in' }, { [J.x]: [rx,ry,rz] }, { by, bz, hy })
 * 'e' never collides with pose data because pose keys are J.* integers.
 */
export function k(u, a, b, c) {
  let ease;
  let joints;
  let pos;
  if (a && typeof a === 'object' && 'e' in a) {
    ease = a.e;
    joints = b || null;
    pos = c || null;
  } else {
    joints = a || null;
    pos = b || null;
  }
  return { u, j: joints, p: pos, e: ease };
}

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Compile a track for allocation-free sampling.
 * opts.raw: array of joint indices whose rotation axes lerp raw (no wrapping) — use for
 *           joints that rotate more than PI across the track (trick rolls, tumbles).
 * opts.loop: treat u as periodic (celebrations, idle variation).
 */
export function buildTrack(name, keys, opts = {}) {
  if (!keys || keys.length < 2) {
    throw new Error(`track ${name} needs at least 2 keys`);
  }
  const sorted = keys.slice().sort((a, b) => a.u - b.u);
  const n = sorted.length;
  const raw = new Set(opts.raw || []);
  const loop = !!opts.loop;

  const times = new Float32Array(n);
  const denseRot = new Float32Array(n * ROT_FLOATS);
  const densePos = new Float32Array(n * 3); // by, bz, hy
  const eases = new Array(n);

  // Carry-forward state per channel.
  const prevRot = new Float32Array(ROT_FLOATS);
  const hasPrev = new Uint8Array(ROT_FLOATS);
  let prevBy = 0, prevBz = 0, prevHy = 1.0; // hips default to standing height

  for (let kk = 0; kk < n; kk++) {
    const key = sorted[kk];
    times[kk] = key.u;
    eases[kk] = EASE[key.e] || EASE.inout;

    for (let j = 0; j < N_JOINTS; j++) {
      const isRaw = raw.has(j);
      for (let a = 0; a < 3; a++) {
        const c = j * 3 + a;
        let v = hasPrev[c] ? prevRot[c] : 0;
        const authored = key.j && key.j[j];
        if (authored && Number.isFinite(authored[a])) {
          if (!isRaw && hasPrev[c]) {
            // Shortest-path interpolation between keys.
            v = prevRot[c] + wrapPi(authored[a] - prevRot[c]);
          } else {
            v = authored[a];
          }
        }
        denseRot[kk * ROT_FLOATS + c] = v;
        prevRot[c] = v;
        hasPrev[c] = 1;
      }
    }

    const by = key.p && Number.isFinite(key.p.by) ? key.p.by : prevBy;
    const bz = key.p && Number.isFinite(key.p.bz) ? key.p.bz : prevBz;
    const hy = key.p && Number.isFinite(key.p.hy) ? key.p.hy : prevHy;
    densePos[kk * 3] = by;
    densePos[kk * 3 + 1] = bz;
    densePos[kk * 3 + 2] = hy;
    prevBy = by; prevBz = bz; prevHy = hy;
  }

  if (sorted[0].u !== 0 || sorted[n - 1].u !== 1) {
    throw new Error(`track ${name} keys must span u=0 to u=1`);
  }

  return {
    name, count: n, times, denseRot, densePos, eases, loop,
    lastSeg: 0, // sampling hint
  };
}

/**
 * Sample a track at normalized time u. Writes 51 rotation floats + 3 position floats
 * into the module scratch buffers (or the provided ones).
 */
export function sampleTrack(trk, u, rotOut = scratchRot, posOut = scratchPos) {
  if (trk.loop) {
    u = u - Math.floor(u);
  } else if (u < 0) {
    u = 0;
  } else if (u > 1) {
    u = 1;
  }

  const n = trk.count;
  let i = trk.lastSeg;
  while (i < n - 2 && u > trk.times[i + 1]) i++;
  while (i > 0 && u < trk.times[i]) i--;
  trk.lastSeg = i;

  const t0 = trk.times[i];
  const t1 = trk.times[i + 1];
  const span = t1 - t0;
  let f = span > 1e-6 ? (u - t0) / span : 1;
  f = trk.eases[i](f);

  const a = i * ROT_FLOATS;
  const b = a + ROT_FLOATS;
  const r = trk.denseRot;
  for (let c = 0; c < ROT_FLOATS; c++) {
    rotOut[c] = r[a + c] + (r[b + c] - r[a + c]) * f;
  }
  const pa = i * 3, pb = pa + 3;
  const p = trk.densePos;
  posOut[0] = p[pa] + (p[pb] - p[pa]) * f;
  posOut[1] = p[pa + 1] + (p[pb + 1] - p[pa + 1]) * f;
  posOut[2] = p[pa + 2] + (p[pb + 2] - p[pa + 2]) * f;

  return posOut;
}

/**
 * Apply a track to a CharacterView: writes joint rotation targets, body position targets,
 * and returns the hips-height target (the `hipY` the update loop assigns after the switch).
 * Call inside update()'s state switch exactly where the old inline pose code ran.
 */
export function applyTrack(view, trk, u) {
  sampleTrack(trk, u);
  const joints = view.joints;
  for (let i = 0; i < N_JOINTS; i++) {
    const c = i * 3;
    joints[i].rotation.set(scratchRot[c], scratchRot[c + 1], scratchRot[c + 2]);
  }
  view.body.position.y = scratchPos[0];
  view.body.position.z = scratchPos[1];
  return scratchPos[2];
}

// Per-joint turbulence amplitude: extremities sway most, core stays stable.
const TURB_SCALE = new Float32Array([
  0.35, 0.45, 0.55, 0.55, 0.8,      // body, hips, spine, torso, neck
  0.6, 0.65, 0.9, 1.7,              // clavL, shL, elL, wrL
  0.6, 0.65, 0.9, 1.7,              // clavR, shR, elR, wrR
  0.6, 0.75, 0.6, 0.75,             // hipL, kneeL, hipR, kneeR
]);
const TURB_AMP = 0.017;

/**
 * Water turbulence: a cheap two-sine value noise added to the posed joints, scaled by
 * swim speed. This is the "in water" cue that sells lifelike motion at broadcast distance.
 * Call AFTER the state switch has written the pose targets, BEFORE the blend pass.
 */
export function applyTurbulence(view, time, speed) {
  const a = TURB_AMP * (0.3 + speed * 0.9);
  const joints = view.joints;
  for (let i = 0; i < N_JOINTS; i++) {
    const s = TURB_SCALE[i] * a;
    const r = joints[i].rotation;
    r.x += (Math.sin(time * 11.3 + i * 1.7) + Math.sin(time * 5.9 + i * 3.1) * 0.6) * s;
    r.y += (Math.sin(time * 9.7 + i * 2.3) + Math.sin(time * 4.3 + i * 4.9) * 0.6) * s * 0.6;
    r.z += (Math.sin(time * 12.1 + i * 2.9) + Math.sin(time * 6.1 + i * 1.3) * 0.6) * s;
  }
}
