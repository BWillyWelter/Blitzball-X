/**
 * 3D Underwater Sphere Pool Court Environment & Custom GLSL Caustics Shaders
 * Renders the spherical water volume, animated caustics network, depth fog absorption,
 * and boundary stadium framework for Blitzball-X.
 */

import * as THREE from 'three';

/**
 * Custom GLSL Shader for Animated Underwater Caustics & Depth Absorption Fog
 */
const WaterCausticsShader = {
  uniforms: {
    uTime: { value: 0 },
    uShallowColor: { value: new THREE.Color(0x38bdf8) }, // Bright Cyan
    uDeepColor: { value: new THREE.Color(0x0369a1) },    // Deep Oceanic Blue
    uAbyssalColor: { value: new THREE.Color(0x02132b) }, // Deep Trench Cobalt
    uCausticScale: { value: 0.15 },
    uCausticSpeed: { value: 1.2 },
    uSunDirection: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() }
  },

  vertexShader: `
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying vec2 vUv;
    uniform float uTime;

    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;

      // Subtle surface vertex wave displacement
      vec3 displacedPos = position;
      float wave = sin(uTime * 2.0 + position.x * 0.5 + position.z * 0.5) * 0.12;
      displacedPos += normal * wave;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPos, 1.0);
    }
  `,

  fragmentShader: `
    uniform float uTime;
    uniform vec3 uShallowColor;
    uniform vec3 uDeepColor;
    uniform vec3 uAbyssalColor;
    uniform float uCausticScale;
    uniform float uCausticSpeed;
    uniform vec3 uSunDirection;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying vec2 vUv;

    // Procedural Sine-Wave Interference Pattern for Water Caustics
    float calculateCaustics(vec2 pos, float time) {
      vec2 p = pos * uCausticScale;
      vec2 i = vec2(p);
      float c = 1.0;
      float intent = 0.005;

      for (int n = 0; n < 4; n++) {
        float t = time * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + t) / intent), p.y / (cos(i.y + t) / intent)));
      }

      c /= 4.0;
      c = 1.17 - sqrt(c);
      return clamp(pow(abs(c), 3.0), 0.0, 1.0);
    }

    void main() {
      // 1. Calculate Depth Color Gradient (Y axis absorption)
      float depthFactor = smoothstep(20.0, -20.0, vWorldPosition.y);
      vec3 baseWaterColor = mix(uShallowColor, uDeepColor, depthFactor);
      baseWaterColor = mix(baseWaterColor, uAbyssalColor, pow(depthFactor, 2.0));

      // 2. Procedural Caustics Generation on XZ Plane
      vec2 causticUV = vWorldPosition.xz + vec2(vWorldPosition.y * 0.2);
      float causticPattern = calculateCaustics(causticUV, uTime * uCausticSpeed);
      
      // Fresnel effect for edge translucency
      vec3 viewVector = normalize(cameraPosition - vWorldPosition);
      float fresnel = pow(1.0 - max(0.0, dot(viewVector, vNormal)), 3.0);

      // 3. Directional Sun Lighting Alignment
      float sunLight = max(0.2, dot(vNormal, uSunDirection));
      vec3 finalCausticColor = vec3(1.0, 0.98, 0.85) * causticPattern * sunLight * 1.8;

      // 4. Combine Water Absorption, Caustics, and Fresnel Glow
      vec3 finalColor = baseWaterColor + finalCausticColor + (vec3(0.2, 0.7, 1.0) * fresnel * 0.6);

      // Distance Fog Falloff Calculation
      float distToCamera = length(cameraPosition - vWorldPosition);
      float fogFactor = clamp((distToCamera - 10.0) / 45.0, 0.0, 0.85);

      finalColor = mix(finalColor, uAbyssalColor, fogFactor);

      gl_FragColor = vec4(finalColor, 0.88);
    }
  `
};

export class SpherePoolEnvironment {
  /**
   * @param {THREE.Scene} scene Parent Three.js Scene
   */
  constructor(scene) {
    this.scene = scene;
    this.poolMesh = null;
    this.boundaryRing = null;
    this.causticsMaterial = null;

    this.initLighting();
    this.initFog();
    this.buildSpherePool();
    this.buildStadiumBoundary();
  }

  initLighting() {
    // Ambient Underwater Skylight
    this.ambientLight = new THREE.AmbientLight(0x38bdf8, 0.7);
    this.scene.add(this.ambientLight);

    // Overhead Stadium Sun Spotlight
    this.sunLight = new THREE.DirectionalLight(0xfffbeb, 1.4);
    this.sunLight.position.set(10, 35, 15);
    this.sunLight.castShadow = true;
    this.scene.add(this.sunLight);
  }

  initFog() {
    // Underwater Exponential Depth Fog
    this.scene.fog = new THREE.FogExp2(0x02132b, 0.018);
  }

  buildSpherePool() {
    // 3D Sphere Pool Volume (Radius: 20m)
    const geometry = new THREE.SphereGeometry(20, 64, 64);

    this.causticsMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(WaterCausticsShader.uniforms),
      vertexShader: WaterCausticsShader.vertexShader,
      fragmentShader: WaterCausticsShader.fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.poolMesh = new THREE.Mesh(geometry, this.causticsMaterial);
    this.scene.add(this.poolMesh);
  }

  buildStadiumBoundary() {
    // Metallic Equatorial Boundary Ring
    const ringGeo = new THREE.TorusGeometry(20.2, 0.6, 16, 100);
    const ringMat = new THREE.MeshStandardMaterial({
      color: #0284c7,
      metalness: 0.8,
      roughness: 0.2,
      emissive: #0369a1,
      emissiveIntensity: 0.3
    });

    this.boundaryRing = new THREE.Mesh(ringGeo, ringMat);
    this.boundaryRing.rotation.x = Math.PI / 2;
    this.scene.add(this.boundaryRing);
  }

  /**
   * Animation update step driving caustics motion and light animation
   * @param {number} delta Frame delta time in seconds
   */
  update(delta) {
    if (this.causticsMaterial) {
      this.causticsMaterial.uniforms.uTime.value += delta;
    }

    if (this.boundaryRing) {
      this.boundaryRing.rotation.z += delta * 0.05; // Slow ambient spin
    }
  }
}
