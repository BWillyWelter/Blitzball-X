import * as THREE from 'three';

/**
 * Translucent target ring projected on the water where an airborne ball will come down.
 * Pure presentation: the renderer positions/scales/fades it each frame from the ball's flight
 * data (src/render/renderer.js). Additive + cyan so it reads as a hologram against the pool.
 */
export function buildLandingRing() {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 40),
    new THREE.MeshBasicMaterial({ color: 0x8ff7ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}
