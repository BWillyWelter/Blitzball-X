/**
 * FFX Status Ailments Engine & 3D Underwater Particle Shaders
 * Handles Poison (HP drain), Sleep (movement/action freeze), and Wither (stat halving).
 */

import * as THREE from 'three';

export const STATUS_TYPES = {
  NONE: 'NONE',
  POISON: 'POISON',
  SLEEP: 'SLEEP',
  WITHER_PAS: 'WITHER_PAS',
  WITHER_SH: 'WITHER_SH',
  WITHER_TCK: 'WITHER_TCK',
  WITHER_BLK: 'WITHER_BLK',
  WITHER_CUT: 'WITHER_CUT'
};

/**
 * Custom GLSL Shader for Underwater Status Particles
 */
const StatusParticleShader = {
  vertexShader: `
    attribute float aSize;
    attribute vec3 aColor;
    varying vec3 vColor;
    uniform float uTime;

    void main() {
      vColor = aColor;
      vec3 pos = position;
      
      // Gentle underwater drift motion
      pos.x += sin(uTime * 2.0 + position.y) * 0.15;
      pos.y += cos(uTime * 1.5 + position.x) * 0.2;

      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = aSize * (150.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;

    void main() {
      // Soft circular point texture
      float dist = length(gl_PointCoord - vec2(0.5));
      if (dist > 0.5) discard;
      
      float alpha = smoothstep(0.5, 0.0, dist);
      gl_FragColor = vec4(vColor, alpha * 0.85);
    }
  `
};

export class StatusEffectManager {
  /**
   * @param {THREE.Scene} scene 3D underwater scene
   */
  constructor(scene) {
    this.scene = scene;
    this.activeStatuses = new Map(); // Map<PlayerId, Array<StatusObject>>
    this.particleSystems = new Map(); // Map<PlayerId, THREE.Points>
    
    this.initParticlePool();
  }

  initParticlePool() {
    this.particleGeometry = new THREE.BufferGeometry();
    const particleCount = 60;

    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 2.0;
      positions[i * 3 + 1] = Math.random() * 2.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 2.0;

      sizes[i] = Math.random() * 0.4 + 0.2;
    }

    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particleGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.particleMaterial = new THREE.ShaderMaterial({
      vertexShader: StatusParticleShader.vertexShader,
      fragmentShader: StatusParticleShader.fragmentShader,
      uniforms: {
        uTime: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
  }

  /**
   * Applies a status ailment to a player character
   * @param {Object} player Character object { id, hp, stats, ... }
   * @param {string} statusType From STATUS_TYPES enum
   * @param {number} [durationSec=30] Status duration in seconds
   */
  applyStatus(player, statusType, durationSec = 30) {
    if (!this.activeStatuses.has(player.id)) {
      this.activeStatuses.set(player.id, []);
    }

    const statuses = this.activeStatuses.get(player.id);
    
    // Refresh or add status
    const existing = statuses.find(s => s.type === statusType);
    if (existing) {
      existing.duration = durationSec;
    } else {
      statuses.push({
        type: statusType,
        duration: durationSec,
        appliedTime: performance.now()
      });
      this.createParticleVisual(player, statusType);
    }
  }

  /**
   * Calculates effective stat values modified by active Wither ailments
   * @param {Object} player 
   * @param {string} statKey ('pas', 'sh', 'tck', 'blk', 'cut')
   * @returns {number} Effective stat value
   */
  getEffectiveStat(player, statKey) {
    const rawStat = player.stats[statKey] || player[statKey] || 0;
    const statuses = this.activeStatuses.get(player.id) || [];

    const witherKey = `WITHER_${statKey.toUpperCase()}`;
    const hasWither = statuses.some(s => s.type === witherKey);

    // FFX Math: Wither halves the target attribute (rounded down)
    return hasWither ? Math.floor(rawStat * 0.5) : rawStat;
  }

  /**
   * Checks if player is paralyzed by Sleep status
   * @param {string} playerId 
   * @returns {boolean}
   */
  isAsleep(playerId) {
    const statuses = this.activeStatuses.get(playerId) || [];
    return statuses.some(s => s.type === STATUS_TYPES.SLEEP);
  }

  /**
   * Continuous frame update step for continuous HP drain and particle rendering
   * @param {number} delta Frame delta time in seconds
   * @param {Array<Object>} allPlayers Roster of all active match players
   */
  update(delta, allPlayers = []) {
    this.particleMaterial.uniforms.uTime.value += delta;

    allPlayers.forEach(player => {
      const statuses = this.activeStatuses.get(player.id);
      if (!statuses || statuses.length === 0) return;

      for (let i = statuses.length - 1; i >= 0; i--) {
        const s = statuses[i];
        s.duration -= delta;

        // 1. Poison continuous HP drain (2 HP per second while swimming)
        if (s.type === STATUS_TYPES.POISON) {
          player.hp = Math.max(1, player.hp - 2.0 * delta);
        }

        // 2. Remove expired status ailments
        if (s.duration <= 0) {
          statuses.splice(i, 1);
        }
      }

      // Update position of 3D particle anchor above player mesh
      const particleMesh = this.particleSystems.get(player.id);
      if (particleMesh && player.position) {
        particleMesh.position.copy(player.position);
      }

      // Clean up particles if no active statuses remain
      if (statuses.length === 0) {
        this.removeParticleVisual(player.id);
      }
    });
  }

  /**
   * Spawns 3D GLSL particle system colored by ailment type
   */
  createParticleVisual(player, statusType) {
    if (this.particleSystems.has(player.id)) return;

    const points = new THREE.Points(this.particleGeometry.clone(), this.particleMaterial);
    const colorAttr = points.geometry.attributes.aColor;
    const colors = colorAttr.array;

    let r = 1.0, g = 1.0, b = 1.0;

    if (statusType === STATUS_TYPES.POISON) {
      r = 0.6; g = 0.1; b = 0.9; // Deep Purple
    } else if (statusType === STATUS_TYPES.SLEEP) {
      r = 0.2; g = 0.7; b = 1.0; // Cyan Blue
    } else if (statusType.startsWith('WITHER')) {
      r = 0.9; g = 0.3; b = 0.1; // Dark Amber / Orange
    }

    for (let i = 0; i < colors.length / 3; i++) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    colorAttr.needsUpdate = true;
    this.scene.add(points);
    this.particleSystems.set(player.id, points);
  }

  removeParticleVisual(playerId) {
    const points = this.particleSystems.get(playerId);
    if (points) {
      this.scene.remove(points);
      points.geometry.dispose();
      this.particleSystems.delete(playerId);
    }
  }
                               }
