import * as THREE from 'three';
import type { PlantStyle } from '../types/aquarium';
import type { AquariumPhotoTextures } from './photoTextures';
import { applyWaterDepthFog, type WaterFogUniforms } from './waterFogShader';

export interface Rock3DHandle {
  group: THREE.Group;
  height: number;
  radiusXZ: number;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

export interface Plant3DHandle {
  group: THREE.Group;
  height: number;
  radiusXZ: number;
  uniforms: {
    uTime: { value: number };
    uPhase: { value: number };
    uSpeed: { value: number };
    uMotionAmp: { value: number };
    uFishPushers: { value: THREE.Vector4[] };
  };
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

function makeSeededRand(seedInit: number): () => number {
  let s = seedInit % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Deterministic 3D value-noise & ridged multifractal function for sculpting
 * angular fractured Seiryu / slate aquascaping stones instead of smooth sine blobs.
 */
function hash3(ix: number, iy: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iy * 311.7 + iz * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function noise3D(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const n000 = hash3(ix, iy, iz);
  const n100 = hash3(ix + 1, iy, iz);
  const n010 = hash3(ix, iy + 1, iz);
  const n110 = hash3(ix + 1, iy + 1, iz);
  const n001 = hash3(ix, iy, iz + 1);
  const n101 = hash3(ix + 1, iy, iz + 1);
  const n011 = hash3(ix, iy + 1, iz + 1);
  const n111 = hash3(ix + 1, iy + 1, iz + 1);

  const nx00 = n000 + (n100 - n000) * ux;
  const nx10 = n010 + (n110 - n010) * ux;
  const nx01 = n001 + (n101 - n001) * ux;
  const nx11 = n011 + (n111 - n011) * ux;

  const nxy0 = nx00 + (nx10 - nx00) * uy;
  const nxy1 = nx01 + (nx11 - nx01) * uy;

  return (nxy0 + (nxy1 - nxy0) * uz) * 2 - 1;
}

function ridgedRockField(x: number, y: number, z: number, seedOffset: number): number {
  const sx = x + seedOffset * 1.37;
  const sy = y + seedOffset * 0.83;
  const sz = z - seedOffset * 1.19;

  // Sharp cleavage strata ridges
  const r1 = 1 - Math.abs(noise3D(sx * 1.45, sy * 1.85, sz * 1.45));
  const r2 = 1 - Math.abs(noise3D(sx * 3.1 + 4.2, sy * 2.9, sz * 3.1 - 2.1));
  const r3 = noise3D(sx * 5.8, sy * 5.8, sz * 5.8);

  // Quantized subtle geological step shelves
  const strata = Math.sin(sy * 5.5 + r1 * 2.2) * 0.06;
  return r1 * 0.28 + r2 * 0.14 + r3 * 0.045 + strata;
}

/**
 * Sculpts high-detail fractured Seiryu / slate 3D rock geometry with baked vertex
 * ambient occlusion in crevices and flat-bottom resting stability (bottom at y = 0).
 */
function buildSculptedRockGeometry(
  rx: number,
  ry: number,
  rz: number,
  seed: number,
  detail = 4
): { geometry: THREE.BufferGeometry; height: number } {
  const geom = new THREE.IcosahedronGeometry(1, detail);
  const pos = geom.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  // Subtle natural cleavage tilt per stone
  const tiltX = ((seed % 7) - 3) * 0.08;
  const tiltZ = ((seed % 5) - 2) * 0.08;

  let minY = Infinity;
  let maxY = -Infinity;
  const dispVals = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const field = ridgedRockField(x, y, z, seed * 0.19);
    dispVals[i] = field;
    const disp = 0.78 + field * 0.85;

    // Flatten bottom so rocks rest & stack organically on sand and other rocks
    const flatY = y < -0.28 ? -0.28 + (y + 0.28) * 0.34 : y;
    // Slight tapered top ridge (authentic Seiryu stone silhouette)
    const taperTop = y > 0.25 ? 1 - (y - 0.25) * 0.22 : 1.0;

    const wx = (x * taperTop + y * tiltX) * rx * disp;
    const wy = flatY * ry * disp;
    const wz = (z * taperTop + y * tiltZ) * rz * disp;

    pos.setXYZ(i, wx, wy, wz);
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }

  const totalH = Math.max(0.05, maxY - minY);
  geom.translate(0, -minY, 0);

  // Bake crevice ambient occlusion + subtle bottom sand-contact shade into vertex colors
  for (let i = 0; i < pos.count; i++) {
    const wy = pos.getY(i);
    const heightNorm = wy / totalH;
    const ridgeAO = THREE.MathUtils.clamp(0.56 + dispVals[i] * 1.15, 0.44, 1.08);
    const baseAO = 0.72 + 0.28 * Math.min(1, heightNorm / 0.28);
    const ao = ridgeAO * baseAO;
    // Subtle natural olive-mineral patina bias on upward sunlit ridges
    colors[i * 3] = Math.min(1.05, ao * (0.97 - heightNorm * 0.03));
    colors[i * 3 + 1] = Math.min(1.05, ao * (0.99 + heightNorm * 0.02));
    colors[i * 3 + 2] = Math.min(1.05, ao * 1.0);
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return { geometry: geom, height: totalH };
}

/**
 * Injects seamless Triplanar Macro Photo projection + animated underwater caustics
 * onto 3D rock materials (eliminates spherical pole stretching & UV seams).
 */
function applyTriplanarRockShader(
  material: THREE.MeshPhysicalMaterial,
  rockUniforms: {
    uTime: { value: number };
    uMotionAmp: { value: number };
    uCausticIntensity: { value: number };
  }
): void {
  material.customProgramCacheKey = () => 'aquarium-rock-triplanar-v2';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = rockUniforms.uTime;
    shader.uniforms.uMotionAmp = rockUniforms.uMotionAmp;
    shader.uniforms.uCausticIntensity = rockUniforms.uCausticIntensity;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRockLocalPos;
varying vec3 vRockLocalNorm;
varying vec3 vRockWorldPos;
varying vec3 vRockWorldNorm;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vRockLocalPos = transformed;
vRockLocalNorm = normalize(objectNormal);
vRockWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRockWorldNorm = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uMotionAmp;
uniform float uCausticIntensity;
varying vec3 vRockLocalPos;
varying vec3 vRockLocalNorm;
varying vec3 vRockWorldPos;
varying vec3 vRockWorldNorm;`
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec3 blendW = max(abs(normalize(vRockLocalNorm)), vec3(0.0001));
  blendW = pow(blendW, vec3(4.0));
  blendW /= max(0.0001, blendW.x + blendW.y + blendW.z);
  vec3 tp = vRockLocalPos * 1.65;
  vec4 tx = texture2D( map, tp.zy );
  vec4 ty = texture2D( map, tp.xz );
  vec4 tz = texture2D( map, tp.xy );
  vec4 triSample = tx * blendW.x + ty * blendW.y + tz * blendW.z;
  diffuseColor *= triSample;
#endif`
      )
      .replace(
        '#include <dithering_fragment>',
        `float tR = uTime * 0.78 * uMotionAmp;
vec2 uvR = vRockWorldPos.xz * 1.6;
float c1 = sin(uvR.x * 2.1 + tR + cos(uvR.y * 1.9 - tR * 0.8));
float c2 = cos(uvR.y * 2.4 - tR * 1.1 + sin(uvR.x * 2.2 + tR * 0.7));
float causticR = pow(max(0.0001, 1.0 - abs(c1 + c2) * 0.65), 3.2);
float upMask = smoothstep(0.2, 0.85, vRockWorldNorm.y);
gl_FragColor.rgb += vec3(0.11, 0.24, 0.29) * causticR * upMask * 0.65 * uCausticIntensity;
#include <dithering_fragment>`
      );
  };
}

/**
 * Builds a photorealistic composite 3D Seiryu / Slate Rock Formation using
 * ridged multifractal geometry, vertex crevice AO, and triplanar macro rock photography.
 */
export function createRock3D(
  stoneId: string,
  seed: number,
  photoTextures: AquariumPhotoTextures,
  rockUniforms: {
    uTime: { value: number };
    uMotionAmp: { value: number };
    uCausticIntensity: { value: number };
  },
  isSoftwareGl: boolean,
  waterFog?: WaterFogUniforms
): Rock3DHandle {
  const rand = makeSeededRand(seed);
  const group = new THREE.Group();
  group.userData.decorId = stoneId;
  group.userData.decorKind = 'stone';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const mainRx = 0.36 + rand() * 0.11;
  const mainRy = 0.26 + rand() * 0.10;
  const mainRz = 0.29 + rand() * 0.09;

  const mainSculpt = buildSculptedRockGeometry(mainRx, mainRy, mainRz, seed, 4);
  geometries.push(mainSculpt.geometry);

  const mainMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: photoTextures.rockAlbedo,
    normalMap: photoTextures.rockNormal,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: photoTextures.rockRoughness,
    roughness: 0.56,
    metalness: 0.04,
    clearcoat: 0.48,
    clearcoatRoughness: 0.24,
  });
  applyTriplanarRockShader(mainMat, rockUniforms);
  if (waterFog) applyWaterDepthFog(mainMat, waterFog, 1.0);
  materials.push(mainMat);

  const mainMesh = new THREE.Mesh(mainSculpt.geometry, mainMat);
  mainMesh.castShadow = !isSoftwareGl;
  mainMesh.receiveShadow = !isSoftwareGl;
  mainMesh.userData.decorId = stoneId;
  mainMesh.userData.decorKind = 'stone';
  group.add(mainMesh);

  // 2 angular companion slate/Seiryu outcrops nested against flanks
  const secMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbe2e8,
    vertexColors: true,
    map: photoTextures.rockAlbedo,
    normalMap: photoTextures.rockNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: photoTextures.rockRoughness,
    roughness: 0.68,
    metalness: 0.03,
    clearcoat: 0.36,
    clearcoatRoughness: 0.3,
  });
  applyTriplanarRockShader(secMat, rockUniforms);
  if (waterFog) applyWaterDepthFog(secMat, waterFog, 1.0);
  materials.push(secMat);

  for (let i = 0; i < 2; i++) {
    const sSculpt = buildSculptedRockGeometry(
      mainRx * (0.46 + rand() * 0.16),
      mainRy * (0.48 + rand() * 0.20),
      mainRz * (0.48 + rand() * 0.16),
      seed + (i + 1) * 41,
      3
    );
    geometries.push(sSculpt.geometry);
    const sMesh = new THREE.Mesh(sSculpt.geometry, secMat);
    const angle = (i === 0 ? 0.45 : 3.05) + (rand() - 0.5) * 0.45;
    sMesh.position.set(
      Math.cos(angle) * mainRx * 0.56,
      0,
      Math.sin(angle) * mainRz * 0.50
    );
    sMesh.rotation.y = rand() * Math.PI * 2;
    sMesh.castShadow = !isSoftwareGl;
    sMesh.receiveShadow = !isSoftwareGl;
    sMesh.userData.decorId = stoneId;
    sMesh.userData.decorKind = 'stone';
    group.add(sMesh);
  }

  return {
    group,
    height: mainSculpt.height,
    radiusXZ: Math.max(mainRx, mainRz) * 1.1,
    geometries,
    materials,
  };
}

/**
 * Sculpts a 3D cupped leaf/blade geometry rooted slightly below y = 0 so it
 * emerges seamlessly out of the quartz sandbed while preserving clean [0..1] UVs
 * for macro botanical leaf photography.
 */
function build3DBotanicalLeafGeometry(
  style: PlantStyle,
  height: number,
  maxWidth: number,
  archOut: number,
  twistRad: number,
  edgeRippleSeed: number
): THREE.BufferGeometry {
  const segW = style === 'sword' ? 6 : 4;
  const segH = 22;
  const geom = new THREE.PlaneGeometry(1, 1, segW, segH);
  const pos = geom.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const rawX = pos.getX(i); // -0.5 .. +0.5
    const rawY = pos.getY(i); // -0.5 .. +0.5
    const u = THREE.MathUtils.clamp(rawX + 0.5, 0, 1); // 0 .. 1
    const v = THREE.MathUtils.clamp(rawY + 0.5, 0, 1); // 0 (root) .. 1 (tip)

    const xRel = (u - 0.5) * 2.0; // -1 .. +1
    const lx = xRel * (maxWidth * 0.5);

    // 3D cupped leaf cross-section with central midrib spine & slight edge undulation
    const cupDepth = style === 'sword' ? 0.14 : 0.08;
    const cupZ = (1 - Math.abs(xRel)) * maxWidth * cupDepth;
    const edgeWave =
      style === 'sword'
        ? Math.sin(v * 20.0 + edgeRippleSeed) * 0.012 * Math.abs(xRel) * Math.sin(v * Math.PI)
        : Math.sin(v * 12.0 + edgeRippleSeed) * 0.006 * Math.abs(xRel);

    const archZ = Math.pow(v, 1.5) * archOut;
    const twist = v * twistRad;

    const rotX = lx * Math.cos(twist) - (cupZ + edgeWave) * Math.sin(twist);
    const rotZ = lx * Math.sin(twist) + (cupZ + edgeWave) * Math.cos(twist) + archZ;
    // Root buried -0.025 below y=0 so base emerges straight from sand
    const ly = -0.025 + v * height - Math.pow(v, 2.2) * Math.abs(archOut) * 0.20;

    pos.setXYZ(i, rotX, ly, rotZ);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a photorealistic 3D Aquatic Plant Rosette using macro botanical leaf photos,
 * derived vein normal maps, organic alpha-cutout silhouettes, backlit leaf glow, and
 * continuous 3D GPU current-sway animation.
 */
export function createPlant3D(
  plantId: string,
  style: PlantStyle,
  seed: number,
  photoTextures: AquariumPhotoTextures,
  isSoftwareGl: boolean,
  waterFog?: WaterFogUniforms
): Plant3DHandle {
  const rand = makeSeededRand(seed);
  const group = new THREE.Group();
  group.userData.decorId = plantId;
  group.userData.decorKind = 'plant';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const uniforms = {
    uTime: { value: 0 },
    uPhase: { value: rand() * Math.PI * 2 },
    uSpeed: { value: 1.05 + rand() * 0.55 },
    uMotionAmp: { value: 1.0 },
    uFishPushers: {
      value: Array.from({ length: 4 }, () => new THREE.Vector4(0, -99, 0, 0)),
    },
  };

  const leafAlbedo =
    style === 'vallisneria'
      ? photoTextures.vallisneriaAlbedo
      : photoTextures.swordAlbedo;
  const leafNormal =
    style === 'vallisneria'
      ? photoTextures.vallisneriaNormal
      : photoTextures.swordNormal;

  // Create 2 subtle natural tonal variants (young sunlit shoots vs deeper mature outer leaves)
  const leafTints = [0xffffff, 0xe8f5e1];
  const tintMaterials: THREE.MeshPhysicalMaterial[] = [];

  for (let tIdx = 0; tIdx < leafTints.length; tIdx++) {
    const leafMat = new THREE.MeshPhysicalMaterial({
      color: leafTints[tIdx],
      map: leafAlbedo,
      normalMap: leafNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.36,
      metalness: 0.02,
      clearcoat: 0.42,
      clearcoatRoughness: 0.24,
      sheen: 0.3,
      sheenColor: new THREE.Color(0x9ae688),
      emissive: new THREE.Color(0x163c12),
      emissiveIntensity: tIdx === 0 ? 0.2 : 0.12,
      alphaTest: 0.14,
      transparent: true,
      side: THREE.DoubleSide,
    });

    leafMat.customProgramCacheKey = () => `aquarium-plant-photo-sway-v2-${tIdx}`;
    leafMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uPhase = uniforms.uPhase;
      shader.uniforms.uSpeed = uniforms.uSpeed;
      shader.uniforms.uMotionAmp = uniforms.uMotionAmp;
      shader.uniforms.uFishPushers = uniforms.uFishPushers;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
uniform float uPhase;
uniform float uSpeed;
uniform float uMotionAmp;
uniform vec4 uFishPushers[4];`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float hNorm = clamp(position.y / 1.35, 0.0, 1.25);
float flex = pow(max(0.0001, hNorm), 1.55) * uMotionAmp;
float waveX = sin(uTime * uSpeed + uPhase - hNorm * 2.5) * 0.095
            + sin(uTime * uSpeed * 1.85 + uPhase * 1.4 - hNorm * 4.2) * 0.032;
float waveZ = cos(uTime * uSpeed * 0.85 + uPhase * 0.7 - hNorm * 2.1) * 0.055;
transformed.x += waveX * flex;
transformed.z += waveZ * flex;

// Part soft leaves around swimming fish while keeping roots locked into the sandbed
float rootAnchor = smoothstep(0.03, 0.34, position.y);
if (rootAnchor > 0.001) {
  vec3 bladeWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec3 leafPushWorld = vec3(0.0);
  for (int fp = 0; fp < 4; fp++) {
    vec4 pusher = uFishPushers[fp];
    if (pusher.w > 0.001) {
      vec3 toLeaf = bladeWorldPos - pusher.xyz;
      float horizDist = length(toLeaf.xz);
      float vertDist = abs(toLeaf.y);
      float reachXZ = pusher.w + 0.30;
      float reachY = pusher.w * 0.95 + 0.32;
      float wXZ = clamp(1.0 - horizDist / reachXZ, 0.0, 1.0);
      float wY = clamp(1.0 - vertDist / reachY, 0.0, 1.0);
      float pushW = (wXZ * wXZ) * (wY * wY);
      if (pushW > 0.0005) {
        vec2 pushDir = horizDist > 0.003
          ? toLeaf.xz / horizDist
          : normalize(vec2(sin(uPhase + float(fp) * 1.7), cos(uPhase + float(fp) * 1.7)));
        float dispMag = pushW * (0.28 + pusher.w * 0.48) * rootAnchor;
        leafPushWorld.xz += pushDir * dispMag;
        leafPushWorld.y -= dispMag * 0.24;
      }
    }
  }
  float pushLen = length(leafPushWorld);
  if (pushLen > 0.42) {
    leafPushWorld *= 0.42 / pushLen;
  }
  float mScaleSq = max(0.0001, dot(modelMatrix[0].xyz, modelMatrix[0].xyz));
  vec3 localPush = vec3(
    dot(modelMatrix[0].xyz, leafPushWorld),
    dot(modelMatrix[1].xyz, leafPushWorld),
    dot(modelMatrix[2].xyz, leafPushWorld)
  ) / mScaleSq;
  transformed += localPush;
}`
        );
    };
    if (waterFog) applyWaterDepthFog(leafMat, waterFog, 1.0, 0.44);
    materials.push(leafMat);
    tintMaterials.push(leafMat);
  }

  const bladeCount = style === 'vallisneria' ? 12 : 9;
  let maxH = 0;

  for (let i = 0; i < bladeCount; i++) {
    const ringAngle = (i / bladeCount) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const isInner = i % 3 === 0;
    const bladeH =
      style === 'vallisneria'
        ? (isInner ? 1.22 : 0.84) + rand() * 0.42
        : (isInner ? 0.92 : 0.66) + rand() * 0.24;
    if (bladeH > maxH) maxH = bladeH;

    const bladeW =
      style === 'vallisneria'
        ? 0.088 + rand() * 0.025
        : 0.34 + rand() * 0.07;
    const archOut =
      style === 'vallisneria'
        ? (isInner ? 0.10 : 0.22) + rand() * 0.16
        : (isInner ? 0.12 : 0.28) + rand() * 0.18;
    const twistRad = (rand() - 0.5) * (style === 'vallisneria' ? 1.15 : 0.45);

    const bladeGeom = build3DBotanicalLeafGeometry(
      style,
      bladeH,
      bladeW,
      archOut,
      twistRad,
      rand() * 6.28
    );
    geometries.push(bladeGeom);

    const bladeMesh = new THREE.Mesh(
      bladeGeom,
      tintMaterials[isInner ? 0 : 1]
    );
    bladeMesh.rotation.y = ringAngle;
    bladeMesh.position.set(
      Math.sin(ringAngle) * (isInner ? 0.015 : 0.038),
      0,
      Math.cos(ringAngle) * (isInner ? 0.015 : 0.038)
    );
    bladeMesh.castShadow = !isSoftwareGl;
    bladeMesh.receiveShadow = !isSoftwareGl;
    bladeMesh.userData.decorId = plantId;
    bladeMesh.userData.decorKind = 'plant';
    group.add(bladeMesh);
  }

  return {
    group,
    height: maxH,
    radiusXZ: style === 'vallisneria' ? 0.34 : 0.40,
    uniforms,
    geometries,
    materials,
  };
}
