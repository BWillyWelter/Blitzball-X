/**
 * Sphere-pool arena dressing: a readable underwater bowl, field markings, and bright three-ring
 * goals. Gameplay stays inside the transparent water shell so swimmers and the ball remain clear.
 */

import * as THREE from 'three';
import { ARENA } from '../data/constants.js';

const WaterCausticsShader = {
  uniforms: {
    uTime: { value: 0 },
    uShallowColor: { value: new THREE.Color(0x137c9a) },
    uDeepColor: { value: new THREE.Color(0x07334d) },
    uAbyssalColor: { value: new THREE.Color(0x020b19) },
    uCausticScale: { value: 0.11 },
    uCausticSpeed: { value: 0.65 },
  },
  vertexShader: `
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    uniform float uTime;
    void main() {
      vec3 displaced = position;
      displaced += normal * sin(uTime * 0.65 + position.x * 0.16 + position.z * 0.12) * 0.035;
      vec4 world = modelMatrix * vec4(displaced, 1.0);
      vWorldPosition = world.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform vec3 uShallowColor;
    uniform vec3 uDeepColor;
    uniform vec3 uAbyssalColor;
    uniform float uCausticScale;
    uniform float uCausticSpeed;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    void main() {
      // A reversed smoothstep is undefined in GLSL. Invert the normal ramp instead.
      float depth = 1.0 - smoothstep(-18.0, 9.0, vWorldPosition.y);
      vec3 water = mix(uShallowColor, uDeepColor, depth);
      water = mix(water, uAbyssalColor, depth * depth * 0.72);

      vec2 p = vWorldPosition.xz * uCausticScale;
      float t = uTime * uCausticSpeed;
      float lattice = sin(p.x * 2.7 + sin(p.y * 1.6 + t) + t * 0.7)
                    * cos(p.y * 2.4 + sin(p.x * 1.8 - t * 0.8));
      float caustic = pow(max(0.0, lattice), 8.0) * 0.16;
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      float edgeGlow = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 2.5);
      vec3 color = water + vec3(0.15, 0.72, 0.85) * edgeGlow * 0.46 + vec3(0.55, 0.93, 1.0) * caustic;
      gl_FragColor = vec4(color, 0.32 + edgeGlow * 0.26 + caustic * 0.4);
    }
  `,
};

function addCircle(parent, radius, y, material, segments = 112, cx = 0, cz = 0, start = 0, end = Math.PI * 2) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = start + ((end - start) * i) / segments;
    points.push(new THREE.Vector3(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geometry, material);
  parent.add(line);
  return line;
}

function addBar(parent, a, b, radius, material) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 10), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export class SpherePoolEnvironment {
  constructor(scene) {
    this.scene = scene;
    this.poolMesh = null;
    this.boundaryRing = null;
    this.causticsMaterial = null;
    this.goals = [];
    this.goalPulses = [0, 0];

    this.initLighting();
    this.initFog();
    this.buildSpherePool();
    this.buildStadiumBoundary();
    this.buildFieldMarkings();
    this.buildGoals();
  }

  initLighting() {
    this.ambientLight = new THREE.HemisphereLight(0x86efff, 0x031322, 1.05);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff4cf, 1.25);
    this.sunLight.position.set(-8, 19, 13);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.left = -22;
    this.sunLight.shadow.camera.right = 22;
    this.sunLight.shadow.camera.top = 22;
    this.sunLight.shadow.camera.bottom = -22;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);

    const cyan = new THREE.PointLight(0x37d9ff, 18, 42, 2);
    cyan.position.set(-10, 7, -8);
    this.scene.add(cyan);
    const coral = new THREE.PointLight(0xff7b45, 12, 38, 2);
    coral.position.set(11, 4, 9);
    this.scene.add(coral);
    this.accentLights = [cyan, coral];
  }

  initFog() {
    this.scene.fog = new THREE.FogExp2(0x041321, 0.009);
  }

  buildSpherePool() {
    const geometry = new THREE.SphereGeometry(ARENA.sphereRadius, 80, 56);
    this.causticsMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(WaterCausticsShader.uniforms),
      vertexShader: WaterCausticsShader.vertexShader,
      fragmentShader: WaterCausticsShader.fragmentShader,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.poolMesh = new THREE.Mesh(geometry, this.causticsMaterial);
    this.poolMesh.name = 'translucent-sphere-pool';
    this.poolMesh.renderOrder = 2;
    this.scene.add(this.poolMesh);
  }

  buildStadiumBoundary() {
    const radius = ARENA.sphereRadius - 1.1;
    const ringGeo = new THREE.TorusGeometry(radius, 0.34, 12, 160);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x17657e,
      metalness: 0.68,
      roughness: 0.28,
      emissive: 0x063c54,
      emissiveIntensity: 0.8,
    });
    this.boundaryRing = new THREE.Mesh(ringGeo, ringMat);
    this.boundaryRing.name = 'pool-equator';
    this.boundaryRing.rotation.x = Math.PI / 2;
    this.scene.add(this.boundaryRing);

    const innerGeo = new THREE.TorusGeometry(radius - 0.62, 0.035, 8, 160);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0x63dff2, transparent: true, opacity: 0.48 });
    this.innerBoundaryRing = new THREE.Mesh(innerGeo, innerMat);
    this.innerBoundaryRing.rotation.x = Math.PI / 2;
    this.scene.add(this.innerBoundaryRing);

    // Sparse luminous waypoints give the wall a sense of scale without making a busy cage.
    const markerGeo = new THREE.SphereGeometry(0.18, 10, 8);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x7aeaff, toneMapped: false });
    this.boundaryMarkers = new THREE.InstancedMesh(markerGeo, markerMat, 20);
    this.boundaryMarkers.name = 'pool-wall-markers';
    const marker = new THREE.Object3D();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      marker.position.set(Math.cos(a) * (radius - 0.22), 0, Math.sin(a) * (radius - 0.22));
      marker.scale.setScalar(i % 5 === 0 ? 1.55 : 0.7);
      marker.updateMatrix();
      this.boundaryMarkers.setMatrixAt(i, marker.matrix);
    }
    this.boundaryMarkers.instanceMatrix.needsUpdate = true;
    this.scene.add(this.boundaryMarkers);
  }

  buildFieldMarkings() {
    const markings = new THREE.Group();
    markings.name = 'sphere-pool-field-markings';
    const main = new THREE.LineBasicMaterial({ color: 0x56d8e8, transparent: true, opacity: 0.58 });
    const soft = new THREE.LineBasicMaterial({ color: 0xd9fbff, transparent: true, opacity: 0.34 });
    const floor = ARENA.floorY + 0.08;

    addCircle(markings, ARENA.fieldRadius, floor, main, 160);
    addCircle(markings, ARENA.centerCircle, floor + 0.015, soft, 80);
    addCircle(markings, ARENA.creaseRadius, floor + 0.012, soft, 80, ARENA.goalX, 0, Math.PI / 2, Math.PI * 1.5);
    addCircle(markings, ARENA.creaseRadius, floor + 0.012, soft, 80, -ARENA.goalX, 0, -Math.PI / 2, Math.PI / 2);

    const centerLineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, floor + 0.01, -ARENA.fieldRadius),
      new THREE.Vector3(0, floor + 0.01, ARENA.fieldRadius),
    ]);
    markings.add(new THREE.Line(centerLineGeometry, main));

    const floorDisc = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA.fieldRadius - 0.05, 96),
      new THREE.MeshBasicMaterial({ color: 0x087d90, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false }),
    );
    floorDisc.rotation.x = -Math.PI / 2;
    floorDisc.position.y = floor - 0.015;
    markings.add(floorDisc);
    this.fieldMarkings = markings;
    this.scene.add(markings);
  }

  buildGoals() {
    const targets = ARENA.zone.rings;
    for (const sign of [-1, 1]) {
      const group = new THREE.Group();
      group.name = sign > 0 ? 'east-ring-goal' : 'west-ring-goal';
      group.position.x = sign * ARENA.goalX;
      const teamColor = sign > 0 ? 0x39dcea : 0xff8a3d;
      const frameMat = new THREE.MeshStandardMaterial({
        color: teamColor,
        metalness: 0.56,
        roughness: 0.24,
        emissive: teamColor,
        emissiveIntensity: 0.46,
      });
      const outerMat = new THREE.MeshBasicMaterial({ color: teamColor, toneMapped: false });
      const depth = sign * 1.7;
      const leftZ = -2.45;
      const rightZ = 2.45;
      const lowY = -1.0;
      const highY = 3.55;
      addBar(group, [depth, lowY, leftZ], [depth, highY, leftZ], 0.13, frameMat);
      addBar(group, [depth, lowY, rightZ], [depth, highY, rightZ], 0.13, frameMat);
      addBar(group, [depth, highY, leftZ], [depth, highY, rightZ], 0.13, frameMat);
      addBar(group, [depth, lowY, leftZ], [depth, lowY, rightZ], 0.13, frameMat);
      addBar(group, [depth, 0.75, leftZ], [depth, 0.75, rightZ], 0.045, outerMat);

      const outer = new THREE.Mesh(
        new THREE.TorusGeometry(2.15, 0.075, 10, 48),
        new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.52, toneMapped: false }),
      );
      outer.rotation.y = Math.PI / 2;
      outer.position.set(-sign * 0.04, 1.1, 0);
      group.add(outer);

      const rings = [];
      for (let i = 0; i < targets.length; i++) {
        const ring = targets[i];
        const z = i === 1 ? -ARENA.zone.lowSpread : i === 2 ? ARENA.zone.lowSpread : 0;
        const y = i === 0 ? ARENA.zone.topY : ARENA.zone.lowY;
        const material = new THREE.MeshStandardMaterial({
          color: ring.css,
          metalness: 0.25,
          roughness: 0.2,
          emissive: ring.css,
          emissiveIntensity: 1.45,
          toneMapped: false,
        });
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(ARENA.zone.ringRadius, 0.11, 12, 48), material);
        hoop.rotation.y = Math.PI / 2;
        hoop.position.set(-sign * 0.12, y, z);
        hoop.name = `goal-ring-${i + 1}-${ring.pts}pt`;
        hoop.castShadow = true;
        group.add(hoop);
        rings.push(hoop);
      }

      const lamp = new THREE.PointLight(teamColor, 13, 12, 2);
      lamp.position.set(-sign * 0.4, 1.1, 0);
      group.add(lamp);
      this.goals.push({ group, rings, lamp, sign });
      this.scene.add(group);
    }
  }

  pulseGoal(team) {
    // Team 0 attacks +X; team 1 attacks -X.
    const index = team === 0 ? 1 : 0;
    this.goalPulses[index] = 1;
  }

  update(delta) {
    if (this.causticsMaterial) this.causticsMaterial.uniforms.uTime.value += delta;
    if (this.boundaryRing) this.boundaryRing.rotation.z += delta * 0.012;
    if (this.innerBoundaryRing) this.innerBoundaryRing.rotation.z -= delta * 0.009;
    if (this.boundaryMarkers) this.boundaryMarkers.rotation.y += delta * 0.006;

    for (let i = 0; i < this.goals.length; i++) {
      const goal = this.goals[i];
      const pulse = this.goalPulses[i];
      const scale = 1 + pulse * 0.12;
      goal.group.scale.setScalar(scale);
      goal.lamp.intensity = 10 + pulse * 30;
      if (pulse > 0) this.goalPulses[i] = Math.max(0, pulse - delta * 1.5);
    }
  }
}
