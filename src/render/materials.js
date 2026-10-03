import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let gradientMap = null;

/** 4-step toon ramp shared by every cel-shaded material. */
export function toonGradient() {
  if (gradientMap) return gradientMap;
  const colors = new Uint8Array([70, 140, 210, 255]);
  gradientMap = new THREE.DataTexture(colors, colors.length, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const toonCache = new Map();
export function toon(color, opts = {}) {
  const key = typeof color === 'string' ? color + JSON.stringify(opts) : null;
  if (key && toonCache.has(key)) return toonCache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
  if (key) toonCache.set(key, m);
  return m;
}

export const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x0b0b12, side: THREE.BackSide });

/** Adds an inverted-hull outline to a mesh. */
export function withOutline(mesh, thickness = 0.035) {
  const o = new THREE.Mesh(mesh.geometry, outlineMaterial);
  const r = mesh.geometry.boundingSphere || (mesh.geometry.computeBoundingSphere(), mesh.geometry.boundingSphere);
  const rad = Math.max(0.05, r ? r.radius : 0.3);
  const s = 1 + thickness / rad;
  o.scale.setScalar(s);
  o.renderOrder = -1;
  mesh.add(o);
  mesh.userData.outline = o;
  return mesh;
}

/**
 * Bake a group of static meshes that share one material into a single mesh.
 *
 * The arena is built from hundreds of small props (a 40-building skyline, stand rings, floodlight
 * masts) that never move and never animate individually. Each one used to be its own draw call,
 * which on mobile is the expensive part of the frame — not the triangles. Merging collapses them
 * to one call with an identical result.
 *
 * Each mesh's local matrix (position/rotation/scale, including any parent chain up to `root`) is
 * baked into its vertices, so call this on props that are already parented under `root`. Source
 * geometries are disposed; the source meshes are detached by the caller via the returned list.
 *
 * Returns null for an empty input so callers can skip adding a mesh.
 */
export function mergeStatic(meshes, material, root = null) {
  const geos = [];
  for (const m of meshes) {
    if (!m.geometry) continue;
    m.updateWorldMatrix(true, false);
    const g = m.geometry.clone();
    // Bake relative to `root` so the merged mesh can be added back under the same parent.
    const local = root
      ? new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(m.matrixWorld)
      : m.matrixWorld;
    g.applyMatrix4(local);
    // Merging requires a uniform attribute set; drop anything the others won't have.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    geos.push(g);
    m.geometry.dispose();
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) {
    console.warn('mergeStatic: geometries were not mergeable; keeping them separate');
    return null;
  }
  const mesh = new THREE.Mesh(merged, material);
  // Tagged so tools/mergecheck.mjs can assert the merged output is finite and correctly placed.
  mesh.userData.merged = meshes.length;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Merge same-material meshes already parented under `parent` into one, removing the originals.
 * Only safe for parts that never move relative to each other (a rigid joint), since baking the
 * transforms destroys the individual transforms.
 */
export function mergeInPlace(parent, meshes, material) {
  if (meshes.length < 2) return null;
  const merged = mergeStatic(meshes, material, parent);
  if (!merged) return null;
  for (const m of meshes) m.removeFromParent();
  parent.add(merged);
  return merged;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTexture(canvas, opts = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.anisotropy || 4;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Simple value-noise for procedural textures (deterministic). */
export function noise2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
