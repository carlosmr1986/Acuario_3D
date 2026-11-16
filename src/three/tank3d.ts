import * as THREE from 'three';
import type { AquariumPhotoTextures } from './photoTextures';

export const TANK_W = 5.4;
export const TANK_H = 3.2;
export const TANK_D = 3.0;
export const TANK_SAND_BASE_Y = -1.16;
export const TANK_WATER_TOP_Y = 1.32;

export interface Tank3DHandle {
  group: THREE.Group;
  uniforms: {
    uTime: { value: number };
    uMotionAmp: { value: number };
    uCausticIntensity: { value: number };
  };
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

/**
 * Deterministic rolling sand dune height at world (x, z) inside the tank.
 * Every 3D rock, plant, and pebble uses this to sit flush on the substrate.
 */
export function sandHeightAt(x: number, z: number): number {
  const nx = x / (TANK_W * 0.5);
  const nz = z / (TANK_D * 0.5);
  const dune1 = Math.sin(x * 1.15 + z * 0.65) * 0.058;
  const dune2 = Math.cos(x * 2.4 - z * 1.9) * 0.024;
  const micro = Math.sin(x * 6.2 + z * 5.4) * 0.008;
  const slope = Math.max(0, -nz) * 0.08 + Math.pow(nx * 0.55, 2) * 0.045;
  return TANK_SAND_BASE_Y + dune1 + dune2 + micro + slope;
}

/**
 * Builds the photorealistic 3D Aquarium Tank:
 * - Sculpted 3D sandbed with macro quartz sand photo, Sobel normal/roughness, & GPU caustics
 * - Instanced natural rock-textured pebbles seated flush on the sand dunes
 * - Soft out-of-focus underwater backdrop depth behind the rear glass
 * - Animated 3D water surface meniscus & rimless 3D glass walls
 */
export function createAquariumTank3D(
  photoTextures: AquariumPhotoTextures,
  isSoftwareGl: boolean
): Tank3DHandle {
  const group = new THREE.Group();
  const uniforms = {
    uTime: { value: 0 },
    uMotionAmp: { value: 1.0 },
    uCausticIntensity: { value: 1.0 },
  };
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // 1. Photorealistic 3D Sculpted Sandbed Substrate
  const sandThick = 0.44;
  const sandW = TANK_W - 0.04;
  const sandD = TANK_D - 0.04;
  const sandGeom = new THREE.BoxGeometry(sandW, sandThick, sandD, 72, 2, 40);
  const posAttr = sandGeom.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    const vz = posAttr.getZ(i);
    if (vy > 0) {
      posAttr.setY(i, sandHeightAt(vx, vz));
    } else if (vy > -0.05) {
      posAttr.setY(i, (sandHeightAt(vx, vz) + (TANK_SAND_BASE_Y - sandThick)) * 0.5);
    } else {
      posAttr.setY(i, TANK_SAND_BASE_Y - sandThick * 0.65);
    }
  }
  sandGeom.computeVertexNormals();
  geometries.push(sandGeom);

  const sandMat = new THREE.MeshStandardMaterial({
    map: photoTextures.sandAlbedo,
    normalMap: photoTextures.sandNormal,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughnessMap: photoTextures.sandRoughness,
    roughness: 0.9,
    metalness: 0.02,
  });

  // Dynamic underwater caustic light network projected on upward-facing sand
  sandMat.customProgramCacheKey = () => 'aquarium-sand-caustics-v3';
  sandMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uMotionAmp = uniforms.uMotionAmp;
    shader.uniforms.uCausticIntensity = uniforms.uCausticIntensity;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSandWorldPos;
varying vec3 vSandWorldNormal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSandWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSandWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uMotionAmp;
uniform float uCausticIntensity;
varying vec3 vSandWorldPos;
varying vec3 vSandWorldNormal;`
      )
      .replace(
        '#include <dithering_fragment>',
        `float tC = uTime * 0.78 * uMotionAmp;
vec2 uvC = vSandWorldPos.xz * 1.6;
float c1 = sin(uvC.x * 2.1 + tC + cos(uvC.y * 1.9 - tC * 0.8));
float c2 = cos(uvC.y * 2.4 - tC * 1.1 + sin(uvC.x * 2.2 + tC * 0.7));
float caustic = pow(max(0.0, 1.0 - abs(c1 + c2) * 0.65), 3.4);
float topMask = smoothstep(0.35, 0.88, vSandWorldNormal.y);
gl_FragColor.rgb += vec3(0.14, 0.28, 0.34) * caustic * topMask * 0.78 * uCausticIntensity;
#include <dithering_fragment>`
      );
  };
  materials.push(sandMat);

  const sandMesh = new THREE.Mesh(sandGeom, sandMat);
  sandMesh.receiveShadow = !isSoftwareGl;
  group.add(sandMesh);

  // 2. Instanced Natural Tumbled River Pebbles Textured with Macro Rock Photo
  const pebbleGeom = new THREE.IcosahedronGeometry(0.044, 1);
  const pPos = pebbleGeom.attributes.position;
  for (let i = 0; i < pPos.count; i++) {
    const px = pPos.getX(i);
    const py = pPos.getY(i);
    const pz = pPos.getZ(i);
    const k = 1 + Math.sin(px * 45 + pz * 32) * 0.14;
    pPos.setXYZ(i, px * 1.25 * k, py * 0.56 * k, pz * 0.96 * k);
  }
  pebbleGeom.computeVertexNormals();
  geometries.push(pebbleGeom);

  const pebbleMat = new THREE.MeshStandardMaterial({
    map: photoTextures.rockAlbedo,
    normalMap: photoTextures.rockNormal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.65,
    metalness: 0.04,
  });
  materials.push(pebbleMat);

  const pebbleCount = 86;
  const pebbles = new THREE.InstancedMesh(pebbleGeom, pebbleMat, pebbleCount);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const pebbleSwatches = [0xc9bba3, 0xa8a39a, 0xd8cab2, 0x8e9499, 0xbfb39d];

  let pSeed = 4099;
  const pRand = () => {
    pSeed = (pSeed * 48271) % 2147483647;
    return (pSeed - 1) / 2147483646;
  };

  for (let i = 0; i < pebbleCount; i++) {
    const px = (pRand() - 0.5) * (TANK_W - 0.34);
    const pz = (pRand() - 0.5) * (TANK_D - 0.34);
    const py = sandHeightAt(px, pz) + 0.004;
    const sc = 0.5 + pRand() * 1.15;
    dummy.position.set(px, py, pz);
    dummy.rotation.set(pRand() * 0.25, pRand() * Math.PI * 2, pRand() * 0.25);
    dummy.scale.set(sc * (0.85 + pRand() * 0.4), sc, sc * (0.85 + pRand() * 0.4));
    dummy.updateMatrix();
    pebbles.setMatrixAt(i, dummy.matrix);

    color.setHex(pebbleSwatches[i % pebbleSwatches.length]);
    color.offsetHSL(0, 0, (pRand() - 0.5) * 0.12);
    pebbles.setColorAt(i, color);
  }
  pebbles.instanceMatrix.needsUpdate = true;
  if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
  pebbles.computeBoundingSphere();
  pebbles.receiveShadow = !isSoftwareGl;
  group.add(pebbles);

  // 3. Animated 3D Water Surface Meniscus
  const waterGeom = new THREE.PlaneGeometry(TANK_W - 0.04, TANK_D - 0.04, 40, 24);
  waterGeom.rotateX(-Math.PI * 0.5);
  geometries.push(waterGeom);

  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x76dcff,
    roughness: 0.06,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  waterMat.customProgramCacheKey = () => 'aquarium-water-surface-v2';
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uMotionAmp = uniforms.uMotionAmp;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uMotionAmp;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float w1 = sin(position.x * 2.1 + uTime * 1.6) * cos(position.z * 1.7 + uTime * 1.2) * 0.022;
float w2 = sin(position.x * 4.4 - uTime * 2.4 + position.z * 3.1) * 0.009;
transformed.y += (w1 + w2) * uMotionAmp;`
      );
  };
  materials.push(waterMat);

  const waterSurface = new THREE.Mesh(waterGeom, waterMat);
  waterSurface.position.set(0, TANK_WATER_TOP_Y, 0);
  waterSurface.renderOrder = 45;
  group.add(waterSurface);

  // 4. Soft Out-of-Focus Underwater Aquascape Backdrop Behind Rear Glass
  const backGeom = new THREE.PlaneGeometry(TANK_W, TANK_H);
  geometries.push(backGeom);
  const backMat = new THREE.MeshStandardMaterial({
    map: photoTextures.backdropMap ?? undefined,
    color: photoTextures.backdropMap ? 0xcbeeff : 0x0b527e,
    roughness: 0.55,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  materials.push(backMat);
  const backGlass = new THREE.Mesh(backGeom, backMat);
  backGlass.position.set(0, 0.05, -TANK_D * 0.5);
  group.add(backGlass);

  // 5. Left, Right & Front Ultra-Clear Glass Walls (non-blocking transparency)
  const sideGlassGeom = new THREE.PlaneGeometry(TANK_D, TANK_H);
  const frontGlassGeom = new THREE.PlaneGeometry(TANK_W, TANK_H);
  geometries.push(sideGlassGeom, frontGlassGeom);

  const glassWallMat = new THREE.MeshPhysicalMaterial({
    color: 0xc2f0ff,
    roughness: 0.04,
    metalness: 0.04,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  materials.push(glassWallMat);

  const leftGlass = new THREE.Mesh(sideGlassGeom, glassWallMat);
  leftGlass.position.set(-TANK_W * 0.5, 0.05, 0);
  leftGlass.rotation.y = Math.PI * 0.5;
  leftGlass.renderOrder = 55;

  const rightGlass = new THREE.Mesh(sideGlassGeom, glassWallMat);
  rightGlass.position.set(TANK_W * 0.5, 0.05, 0);
  rightGlass.rotation.y = -Math.PI * 0.5;
  rightGlass.renderOrder = 55;

  const frontGlass = new THREE.Mesh(frontGlassGeom, glassWallMat);
  frontGlass.position.set(0, 0.05, TANK_D * 0.5);
  frontGlass.renderOrder = 58;

  group.add(leftGlass, rightGlass, frontGlass);

  // 6. Crisp Glass Seam Edges + Slim Anodized Aquarium Base Plinth
  const tempOutlineBox = new THREE.BoxGeometry(TANK_W, TANK_H, TANK_D);
  const tankOutlineGeom = new THREE.EdgesGeometry(tempOutlineBox);
  tempOutlineBox.dispose();
  geometries.push(tankOutlineGeom);
  const seamMat = new THREE.LineBasicMaterial({
    color: 0x8be2ff,
    transparent: true,
    opacity: 0.30,
  });
  materials.push(seamMat);
  const tankEdges = new THREE.LineSegments(tankOutlineGeom, seamMat);
  tankEdges.position.set(0, 0.05, 0);
  group.add(tankEdges);

  const plinthGeom = new THREE.BoxGeometry(TANK_W + 0.14, 0.18, TANK_D + 0.14);
  geometries.push(plinthGeom);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.38,
    metalness: 0.68,
  });
  materials.push(plinthMat);
  const plinth = new THREE.Mesh(plinthGeom, plinthMat);
  plinth.position.set(0, -TANK_H * 0.5 + 0.05 - 0.09, 0);
  group.add(plinth);

  return {
    group,
    uniforms,
    geometries,
    materials,
  };
}
