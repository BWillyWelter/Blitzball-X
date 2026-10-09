/**
 * Mobile-Optimized Visual Effects & Particle Manager for Blitzball-X
 */

export class FXManager {
  /**
   * @param {THREE.Scene} scene 
   * @param {Object} [options]
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxParticles = options.maxParticles || 300; // Particle cap for mobile performance
    this.particles = [];
    this.pool = [];
  }

  /**
   * Spawns a particle burst at specified position
   * @param {Object} pos {x, y, z}
   * @param {string} type 'hit' | 'trail' | 'goal' | 'dust'
   * @param {number} [count=15]
   */
  spawnBurst(pos, type = 'hit', count = 15) {
    if (this.particles.length + count > this.maxParticles) {
      count = Math.max(0, this.maxParticles - this.particles.length);
    }

    const colorMap = {
      hit: 0xfacc15,
      trail: 0x38bdf8,
      goal: 0xf43f5e,
      dust: 0x94a3b8
    };

    for (let i = 0; i < count; i++) {
      const particle = this.getParticleFromPool();
      particle.position.set(pos.x, pos.y, pos.z);
      
      const speed = type === 'goal' ? 8.0 : 4.0;
      particle.velocity = {
        x: (Math.random() - 0.5) * speed,
        y: (Math.random() * 0.8 + 0.2) * speed,
        z: (Math.random() - 0.5) * speed
      };

      particle.life = 1.0;
      particle.decay = type === 'trail' ? 0.05 : 0.025;
      particle.material.color.setHex(colorMap[type] || 0xffffff);
      particle.visible = true;

      this.particles.push(particle);
    }
  }

  getParticleFromPool() {
    if (this.pool.length > 0) {
      return this.pool.pop();
    }

    const geometry = new THREE.PlaneGeometry(0.15, 0.15);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 1,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    this.scene.add(mesh);
    return mesh;
  }

  /**
   * Frame step update logic
   * @param {number} delta Seconds elapsed
   * @param {THREE.Camera} [camera] Used for billboard alignment
   */
  update(delta, camera = null) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= p.decay;

      if (p.life <= 0) {
        p.visible = false;
        this.pool.push(p);
        this.particles.splice(i, 1);
        continue;
      }

      p.position.x += p.velocity.x * delta;
      p.position.y += p.velocity.y * delta;
      p.position.z += p.velocity.z * delta;

      // Gravity decay
      p.velocity.y -= 9.8 * 0.2 * delta;

      p.material.opacity = p.life;

      if (camera) {
        p.quaternion.copy(camera.quaternion);
      }
    }
  }

  clear() {
    for (const p of this.particles) {
      p.visible = false;
      this.pool.push(p);
    }
    this.particles = [];
  }
}
