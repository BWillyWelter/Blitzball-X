import * as THREE from 'three';

/**
 * Custom GLSL Shader Generator for Energy Trails & Visual Juice
 */
export class ShaderFactory {
  /**
   * Creates a dynamic trail material for curveballs and breaking pitches
   * @param {number} [baseColor=0x38bdf8]
   * @returns {THREE.ShaderMaterial}
   */
  static createBallTrailMaterial(baseColor = 0x38bdf8) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(baseColor) },
        uSpeed: { value: 1.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vOpacity;
        uniform float uTime;
        
        void main() {
          vUv = uv;
          // Wave distortion along energy trail
          vec3 pos = position;
          pos.x += sin(pos.z * 5.0 + uTime * 10.0) * 0.05;
          
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          vOpacity = uv.x; // Fade out toward the tail
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uTime;
        varying vec2 vUv;
        varying float vOpacity;
        
        void main() {
          // Dynamic pulse effect
          float pulse = 0.8 + 0.2 * sin(uTime * 12.0 + vUv.x * 10.0);
          vec3 finalColor = uColor * pulse * 1.5; // HDR bloom push
          gl_FragColor = vec4(finalColor, vOpacity * 0.85);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
  }

  /**
   * Creates a Strike Zone Target Hologram Material
   * @returns {THREE.ShaderMaterial}
   */
  static createStrikeZoneMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHit: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uHit;
        
        void main() {
          // Grid lines
          vec2 grid = abs(fract(vUv * 6.0 - 0.5) - 0.5) / fwidth(vUv * 6.0);
          float line = min(grid.x, grid.y);
          float c = 1.0 - min(line, 1.0);
          
          // Edge glow
          float edge = step(0.05, vUv.x) * step(0.05, vUv.y) * step(vUv.x, 0.95) * step(vUv.y, 0.95);
          vec3 baseColor = mix(vec3(0.1, 0.7, 1.0), vec3(1.0, 0.2, 0.4), uHit);
          
          gl_FragColor = vec4(baseColor * (c + (1.0 - edge) * 2.0), (c * 0.4 + (1.0 - edge) * 0.6));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
  }
}
