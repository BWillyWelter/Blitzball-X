import * as THREE from 'three';
import { FFX_CONSTANTS } from '../data/constants.js';

export class SpherePoolEnvironment {
  /**
   * @param {THREE.Scene} scene 
   */
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.initPoolGeometry();
  }

  initPoolGeometry() {
    const radius = FFX_CONSTANTS.POOL.RADIUS;

    // Outer Water Sphere Membrane
    const sphereGeo = new THREE.SphereGeometry(radius, 32, 32);
    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorDeep: { value: new THREE.Color(0x0284c7) },
        uColorShallow: { value: new THREE.Color(0x38bdf8) }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColorDeep;
        uniform vec3 uColorShallow;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;

        void main() {
          float caustic = sin(vWorldPosition.x * 0.8 + uTime * 2.0) * 
                          cos(vWorldPosition.y * 0.8 + uTime * 1.8) * 
                          sin(vWorldPosition.z * 0.8 + uTime * 2.2);
          
          caustic = smoothstep(0.1, 0.9, caustic);

          float depth = clamp((vWorldPosition.y + 15.0) / 30.0, 0.0, 1.0);
          vec3 waterColor = mix(uColorDeep, uColorShallow, depth);

          float fresnel = pow(1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);

          vec3 finalColor = waterColor + vec3(caustic * 0.3) + vec3(fresnel * 0.5);
          gl_FragColor = vec4(finalColor, 0.55);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide
    });

    const poolMesh = new THREE.Mesh(sphereGeo, this.waterMaterial);
    this.scene.add(poolMesh);

    // Goal Nets
    this.createGoal(FFX_CONSTANTS.POOL.GOAL_POS_HOME, 0x0284c7);
    this.createGoal(FFX_CONSTANTS.POOL.GOAL_POS_AWAY, 0xe11d48);
  }

  createGoal(position, colorHex) {
    const goalGeo = new THREE.TorusGeometry(FFX_CONSTANTS.POOL.GOAL_RADIUS, 0.2, 16, 32);
    const goalMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.6,
      roughness: 0.3
    });

    const goalMesh = new THREE.Mesh(goalGeo, goalMat);
    goalMesh.position.set(position.x, position.y, position.z);
    this.scene.add(goalMesh);
  }

  update(delta) {
    this.time += delta;
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value = this.time;
    }
  }
}
