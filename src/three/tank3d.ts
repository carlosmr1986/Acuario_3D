import * as THREE from 'three';
import type { AquariumBackgroundId } from '../types/aquarium';
import type { AquariumPhotoTextures } from './photoTextures';
import { applyWaterDepthFog, type WaterFogUniforms } from './waterFogShader';

export const TANK_W = 5.4;
export const TANK_H = 3.2;
export const TANK_D = 3.0;
export const TANK_SAND_BASE_Y = -1.16;
export const TANK_WATER_TOP_Y = 1.32;

export interface TankSizeInput {
  width: number;
  height: number;
  depth: number;
}

export function computeTankVerticalBounds(height: number): {
  sandBaseY: number;
  waterTopY: number;
} {
  return {
    sandBaseY: 0.05 - height * 0.5 + 0.39,
    waterTopY: 0.05 + height * 0.5 - 0.33,
  };
}

export interface Tank3DHandle {
  group: THREE.Group;
  dims: TankSizeInput;
  sandBaseY: number;
  waterTopY: number;
  uniforms: {
    uTime: { value: number };
    uMotionAmp: { value: number };
    uCausticIntensity: { value: number };
    uRipples: { value: THREE.Vector4[] };
  };
  airstoneTop: THREE.Vector3;
  triggerSurfaceWave: (x: number, z: number, strength?: number) => void;
  setBackground: (id: AquariumBackgroundId, photoTextures: AquariumPhotoTextures) => void;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

function hash2D(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function sandNoise2D(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return (ab + (cd - ab) * uz) * 2 - 1;
}

/**
 * Deterministic organic sandbed height at world (x, z) inside the tank.
 * Combines multi-octave 2D value noise with gentle aquascape slope and micro-ripples
 * so the substrate contour—including against all glass walls—looks irregular and natural.
 * Every 3D rock, plant, and pebble uses this to sit flush on the substrate.
 */
export function sandHeightAt(
  x: number,
  z: number,
  dims?: { width: number; depth: number; sandBaseY?: number }
): number {
  const tankW = dims?.width ?? TANK_W;
  const tankD = dims?.depth ?? TANK_D;
  const baseY = dims?.sandBaseY ?? TANK_SAND_BASE_Y;
  const nx = x / (tankW * 0.5);
  const nz = z / (tankD * 0.5);
  const warpX = x + sandNoise2D(x * 0.55 + 3.1, z * 0.55 - 1.7) * 0.42;
  const warpZ = z + sandNoise2D(x * 0.55 - 2.4, z * 0.55 + 4.8) * 0.36;

  const macro = sandNoise2D(warpX * 0.85 + 1.4, warpZ * 0.95 - 0.8) * 0.088;
  const medium = sandNoise2D(warpX * 2.1 - 5.2, warpZ * 2.3 + 2.9) * 0.038;
  const fine = sandNoise2D(x * 5.2 + 7.1, z * 5.4 - 3.3) * 0.014;
  const ripple = Math.sin(warpX * 2.6 + warpZ * 1.4) * 0.016;
  const slope = Math.max(0, -nz) * 0.078 + Math.pow(nx * 0.52, 2) * 0.04;
  return baseY + macro + medium + fine + ripple + slope;
}

function getBackdropVisualStyle(id: AquariumBackgroundId): {
  tintHex: number;
  emissiveHex: number;
  emissiveIntensity: number;
} {
  switch (id) {
    case 'frosted':
      return { tintHex: 0xaad4e8, emissiveHex: 0xc8eeff, emissiveIntensity: 0.44 };
    case 'slate':
      return { tintHex: 0x454f5b, emissiveHex: 0x0b121b, emissiveIntensity: 0.08 };
    case 'reef':
      return { tintHex: 0x627c8c, emissiveHex: 0x094c6e, emissiveIntensity: 0.14 };
    case 'amazon':
      return { tintHex: 0x607a68, emissiveHex: 0x0b2d20, emissiveIntensity: 0.12 };
    case 'abyss':
      return { tintHex: 0x4e6c8e, emissiveHex: 0x062244, emissiveIntensity: 0.12 };
    case 'natural':
    default:
      return { tintHex: 0x708596, emissiveHex: 0x083452, emissiveIntensity: 0.08 };
  }
}

/**
 * Builds the photorealistic 3D Aquarium Tank with customizable dimensions and backdrop theme.
 */
export function createAquariumTank3D(
  dims: TankSizeInput,
  photoTextures: AquariumPhotoTextures,
  backgroundId: AquariumBackgroundId,
  isSoftwareGl: boolean,
  waterFog?: WaterFogUniforms
): Tank3DHandle {
  const tankW = dims.width;
  const tankH = dims.height;
  const tankD = dims.depth;
  const { sandBaseY, waterTopY } = computeTankVerticalBounds(tankH);

  const group = new THREE.Group();
  const rippleSlots: THREE.Vector4[] = Array.from(
    { length: 8 },
    () => new THREE.Vector4(0, 0, -100, 0)
  );
  let nextRippleSlot = 0;

  const uniforms = {
    uTime: { value: 0 },
    uMotionAmp: { value: 1.0 },
    uCausticIntensity: { value: 1.0 },
    uRipples: { value: rippleSlots },
  };

  const triggerSurfaceWave = (x: number, z: number, strength = 0.75) => {
    const clampedX = THREE.MathUtils.clamp(x, -tankW * 0.48, tankW * 0.48);
    const clampedZ = THREE.MathUtils.clamp(z, -tankD * 0.48, tankD * 0.48);
    const clampedStrength = THREE.MathUtils.clamp(strength, 0.15, 1.5);
    rippleSlots[nextRippleSlot].set(
      clampedX,
      clampedZ,
      uniforms.uTime.value,
      clampedStrength
    );
    nextRippleSlot = (nextRippleSlot + 1) % rippleSlots.length;
  };

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // 1. Photorealistic 3D Sculpted Sandbed Substrate with Irregular Glass-Edge Cross-Section
  const sandThick = 0.46;
  const sandW = tankW - 0.04;
  const sandD = tankD - 0.04;
  const segX = Math.max(64, Math.round(96 * (tankW / TANK_W)));
  const segZ = Math.max(38, Math.round(54 * (tankD / TANK_D)));
  const sandGeom = new THREE.BoxGeometry(sandW, sandThick, sandD, segX, 6, segZ);
  const posAttr = sandGeom.attributes.position;
  const normAttr = sandGeom.attributes.normal;
  const uvAttr = sandGeom.attributes.uv;
  const uvScaleX = tankW / TANK_W;
  const uvScaleZ = tankD / TANK_D;
  const sandColors = new Float32Array(posAttr.count * 3);
  const sandBaseBottomY = sandBaseY - sandThick * 0.65;

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    const vz = posAttr.getZ(i);
    const ny = normAttr.getY(i);
    const topY = sandHeightAt(vx, vz, { width: tankW, depth: tankD, sandBaseY });
    const depthFrac = THREE.MathUtils.clamp((sandThick * 0.5 - vy) / sandThick, 0, 1);

    // Keep physical sand grain scale consistent when resizing tank
    if (Math.abs(ny) > 0.5) {
      uvAttr.setXY(i, uvAttr.getX(i) * uvScaleX, uvAttr.getY(i) * uvScaleZ);
    } else if (Math.abs(normAttr.getZ(i)) > 0.5) {
      uvAttr.setXY(i, uvAttr.getX(i) * uvScaleX, uvAttr.getY(i));
    } else {
      uvAttr.setXY(i, uvAttr.getX(i) * uvScaleZ, uvAttr.getY(i));
    }

    // Subtle wavy stratification along the glass-facing cross-section walls
    const strataWave =
      sandNoise2D(vx * 3.2 + 9.4, vz * 3.4 - 4.1) * 0.018 * Math.sin(depthFrac * Math.PI);
    const finalY =
      depthFrac < 0.02
        ? topY
        : depthFrac > 0.98
          ? sandBaseBottomY
          : THREE.MathUtils.lerp(topY, sandBaseBottomY, depthFrac) + strataWave;
    posAttr.setY(i, finalY);

    // Heterogeneous organic mineral patches on top & natural compacted sediment layers against glass
    const patch = sandNoise2D(vx * 1.45 - 3.7, vz * 1.65 + 2.1);
    const speckle = sandNoise2D(vx * 8.4 + depthFrac * 5.2, vz * 8.1 - depthFrac * 4.7);
    const mineralBias = sandNoise2D(vx * 3.6 + 11.3, vz * 3.9 - 6.2);
    const isSideWall = Math.abs(ny) < 0.5;

    let r = 0.96 + patch * 0.075 + speckle * 0.055;
    let g = 0.95 + patch * 0.068 + speckle * 0.052;
    let b = 0.92 + patch * 0.055 + speckle * 0.045 - mineralBias * 0.025;

    if (isSideWall) {
      // Visible cross-section pressed against glass: irregular grain streaks & darker compacted lower strata
      const strataBand = Math.sin(depthFrac * 15.0 + sandNoise2D(vx * 2.8, vz * 2.8) * 3.2);
      const depthShade = THREE.MathUtils.lerp(1.0, 0.56, Math.pow(depthFrac, 0.85));
      const bandTone = strataBand * 0.055 + speckle * 0.085;
      r = (r + bandTone) * depthShade;
      g = (g + bandTone * 0.95) * depthShade;
      b = (b + bandTone * 0.82) * depthShade * 0.96;
    } else {
      // Slight darker wet edge shading right where sand meets the glass walls
      const edgeDist = Math.min(
        sandW * 0.5 - Math.abs(vx),
        sandD * 0.5 - Math.abs(vz)
      );
      const glassEdgeShade = THREE.MathUtils.smoothstep(edgeDist, 0.0, 0.28);
      const edgeMul = THREE.MathUtils.lerp(0.84, 1.0, glassEdgeShade);
      r *= edgeMul;
      g *= edgeMul;
      b *= edgeMul;
    }

    sandColors[i * 3] = THREE.MathUtils.clamp(r, 0.38, 1.12);
    sandColors[i * 3 + 1] = THREE.MathUtils.clamp(g, 0.38, 1.12);
    sandColors[i * 3 + 2] = THREE.MathUtils.clamp(b, 0.36, 1.10);
  }
  sandGeom.setAttribute('color', new THREE.BufferAttribute(sandColors, 3));
  sandGeom.computeVertexNormals();
  geometries.push(sandGeom);

  const sandMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: photoTextures.sandAlbedo,
    normalMap: photoTextures.sandNormal,
    normalScale: new THREE.Vector2(1.05, 1.05),
    roughnessMap: photoTextures.sandRoughness,
    roughness: 0.91,
    metalness: 0.02,
  });

  // Anti-tiling multi-scale grain variation + glass-wall mineral fleck detail + underwater caustics
  sandMat.customProgramCacheKey = () => 'aquarium-sand-caustics-v4';
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
varying vec3 vSandWorldNormal;
float sandHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float sandNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(sandHash(i), sandHash(i + vec3(1, 0, 0)), u.x),
        mix(sandHash(i + vec3(0, 1, 0)), sandHash(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(sandHash(i + vec3(0, 0, 1)), sandHash(i + vec3(1, 0, 1)), u.x),
        mix(sandHash(i + vec3(0, 1, 1)), sandHash(i + vec3(1, 1, 1)), u.x), u.y),
    u.z
  );
}`
      )
      .replace(
        '#include <dithering_fragment>',
        `float macroVar = sandNoise3(vSandWorldPos * 2.35 + vec3(1.7, 0.0, 4.3));
float grainVar = sandNoise3(vSandWorldPos * 19.5);
float fineFleck = sandNoise3(vSandWorldPos * 52.0);
float wallMask = 1.0 - smoothstep(0.15, 0.65, abs(vSandWorldNormal.y));
float topMask = smoothstep(0.35, 0.88, vSandWorldNormal.y);

// Break up UV tiling & enrich coarse/fine mineral grain randomness (especially along glass walls)
float toneMul = mix(0.84, 1.14, macroVar) * mix(0.90, 1.11, grainVar);
toneMul *= mix(1.0, mix(0.76, 1.24, fineFleck), wallMask * 0.82 + 0.25);
gl_FragColor.rgb *= toneMul;

// Subtle dark/quartz mineral speckles visible in sand pressed against glass
float pebbleFleck = smoothstep(0.74, 0.92, fineFleck) * wallMask;
float darkPocket = smoothstep(0.78, 0.95, 1.0 - grainVar) * wallMask;
gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 1.26, pebbleFleck * 0.55);
gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.58, darkPocket * 0.45);

float tC = uTime * 0.78 * uMotionAmp;
vec2 uvC = vSandWorldPos.xz * 1.6;
float c1 = sin(uvC.x * 2.1 + tC + cos(uvC.y * 1.9 - tC * 0.8));
float c2 = cos(uvC.y * 2.4 - tC * 1.1 + sin(uvC.x * 2.2 + tC * 0.7));
float caustic = pow(max(0.0001, 1.0 - abs(c1 + c2) * 0.65), 3.4);
gl_FragColor.rgb += vec3(0.14, 0.28, 0.34) * caustic * topMask * 0.78 * uCausticIntensity;
#include <dithering_fragment>`
      );
  };
  if (waterFog) applyWaterDepthFog(sandMat, waterFog, 0.88);
  materials.push(sandMat);

  const sandMesh = new THREE.Mesh(sandGeom, sandMat);
  sandMesh.receiveShadow = !isSoftwareGl;
  group.add(sandMesh);

  // 2. Instanced Natural Tumbled River Pebbles & Coarse Gravel Seated Flush on Sand Dunes & Glass Edges
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
  if (waterFog) applyWaterDepthFog(pebbleMat, waterFog, 0.88, 0.55);
  materials.push(pebbleMat);

  const pebbleCount = Math.max(
    84,
    Math.round(132 * ((tankW * tankD) / (TANK_W * TANK_D)))
  );
  const pebbles = new THREE.InstancedMesh(pebbleGeom, pebbleMat, pebbleCount);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const pebbleSwatches = [0xc9bba3, 0xa8a39a, 0xd8cab2, 0x8e9499, 0xbfb39d, 0x7d807a];

  let pSeed = 4099;
  const pRand = () => {
    pSeed = (pSeed * 48271) % 2147483647;
    return (pSeed - 1) / 2147483646;
  };

  const edgeThreshold = Math.round(pebbleCount * 0.7);
  for (let i = 0; i < pebbleCount; i++) {
    // Cluster ~30% of smaller gravel pebbles near glass perimeter to break up edge regularity
    let px: number;
    let pz: number;
    const isEdgeGravel = i >= edgeThreshold;
    if (isEdgeGravel) {
      if (pRand() < 0.6) {
        px = (pRand() - 0.5) * (tankW - 0.24);
        pz = (pRand() < 0.7 ? 1 : -1) * (tankD * 0.5 - 0.08 - pRand() * 0.24);
      } else {
        px = (pRand() < 0.5 ? 1 : -1) * (tankW * 0.5 - 0.08 - pRand() * 0.24);
        pz = (pRand() - 0.5) * (tankD - 0.24);
      }
    } else {
      px = (pRand() - 0.5) * (tankW - 0.28);
      pz = (pRand() - 0.5) * (tankD - 0.28);
    }
    const py =
      sandHeightAt(px, pz, { width: tankW, depth: tankD, sandBaseY }) +
      (isEdgeGravel ? 0.001 : 0.003);
    const sc = isEdgeGravel ? 0.26 + pRand() * 0.55 : 0.42 + pRand() * 1.18;
    dummy.position.set(px, py, pz);
    dummy.rotation.set(pRand() * 0.28, pRand() * Math.PI * 2, pRand() * 0.28);
    dummy.scale.set(sc * (0.82 + pRand() * 0.44), sc, sc * (0.82 + pRand() * 0.44));
    dummy.updateMatrix();
    pebbles.setMatrixAt(i, dummy.matrix);

    color.setHex(pebbleSwatches[i % pebbleSwatches.length]);
    color.offsetHSL(0, 0, (pRand() - 0.5) * 0.14);
    pebbles.setColorAt(i, color);
  }
  pebbles.instanceMatrix.needsUpdate = true;
  if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
  pebbles.computeBoundingSphere();
  pebbles.receiveShadow = !isSoftwareGl;
  group.add(pebbles);

  // 3. Animated 3D Water Surface Meniscus with Interactive Concentric Wave Normals
  const waterGeom = new THREE.PlaneGeometry(tankW - 0.04, tankD - 0.04, 72, 42);
  waterGeom.rotateX(-Math.PI * 0.5);
  geometries.push(waterGeom);

  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x9ce7ff,
    roughness: 0.045,
    metalness: 0.02,
    ior: 1.333,
    reflectivity: 0.92,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.25,
    transparent: true,
    opacity: 0.30,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fallbackWaterColor = new THREE.Color(0x11587a);
  const fallbackSunColor = new THREE.Color(0xfff1d6);

  waterMat.customProgramCacheKey = () => 'aquarium-water-surface-v4-snell';
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uMotionAmp = uniforms.uMotionAmp;
    shader.uniforms.uCausticIntensity = uniforms.uCausticIntensity;
    shader.uniforms.uRipples = uniforms.uRipples;
    shader.uniforms.uWaterColor = waterFog?.uWaterColor ?? { value: fallbackWaterColor };
    shader.uniforms.uSunColor = waterFog?.uSunColor ?? { value: fallbackSunColor };

    const rippleEvalGLSL = `
float evalWaterRipples(vec2 p, float t, float motionAmp, out float dhdx, out float dhdz) {
  float h = 0.0;
  dhdx = 0.0;
  dhdz = 0.0;

  // Multi-octave organic ambient capillary swell
  float a1 = p.x * 1.85 + t * 1.35 + cos(p.y * 1.35 - t * 0.85) * 0.7;
  float a2 = p.x * 3.4 - p.y * 2.7 + t * 2.05;
  float a3 = p.x * 6.8 + p.y * 6.1 - t * 2.9;
  h += (sin(a1) * 0.014 + cos(a2) * 0.0065 + sin(a3) * 0.0022) * motionAmp;
  dhdx += (cos(a1) * 1.85 * 0.014 - sin(a2) * 3.4 * 0.0065 + cos(a3) * 6.8 * 0.0022) * motionAmp;
  dhdz += (-cos(a1) * sin(p.y * 1.35 - t * 0.85) * 0.945 * 0.014 + sin(a2) * 2.7 * 0.0065 + cos(a3) * 6.1 * 0.0022) * motionAmp;

  // Interactive expanding surface ripples (food splash, bubble pop, taps)
  for (int i = 0; i < 8; i++) {
    vec4 rp = uRipples[i];
    float age = t - rp.z;
    if (rp.w > 0.0 && age >= 0.0 && age < 3.4) {
      vec2 delta = p - rp.xy;
      float dist = length(delta);
      float frontR = age * 1.12;
      float ringWidth = 0.14 + age * 0.13;
      float ringCoord = (dist - frontR) / ringWidth;
      float env = exp(-(ringCoord * ringCoord));
      float fade = exp(-age * 1.55) * smoothstep(0.0, 0.045, age);
      float freq = 26.0;
      float phase = (dist - frontR) * freq;
      float amp = rp.w * 0.015 * env * fade;
      h += sin(phase) * amp;
      float slope = cos(phase) * freq * amp;
      vec2 dir = dist > 0.0008 ? delta / dist : vec2(0.0);
      dhdx += dir.x * slope;
      dhdz += dir.y * slope;
    }
  }
  return h;
}`;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uMotionAmp;
uniform vec4 uRipples[8];
varying vec2 vWaterLocalXZ;
varying vec3 vWaterViewX;
varying vec3 vWaterViewY;
varying vec3 vWaterViewZ;
${rippleEvalGLSL}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vWaterLocalXZ = position.xz;
vWaterViewX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
vWaterViewY = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
vWaterViewZ = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
float wDhDxV = 0.0;
float wDhDzV = 0.0;
float wHeightV = evalWaterRipples(position.xz, uTime, uMotionAmp, wDhDxV, wDhDzV);
transformed.y += wHeightV;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uMotionAmp;
uniform float uCausticIntensity;
uniform vec3 uWaterColor;
uniform vec3 uSunColor;
uniform vec4 uRipples[8];
varying vec2 vWaterLocalXZ;
varying vec3 vWaterViewX;
varying vec3 vWaterViewY;
varying vec3 vWaterViewZ;
${rippleEvalGLSL}`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
float wDhDxF = 0.0;
float wDhDzF = 0.0;
evalWaterRipples(vWaterLocalXZ, uTime, uMotionAmp, wDhDxF, wDhDzF);
normal = normalize(vWaterViewY - vWaterViewX * wDhDxF - vWaterViewZ * wDhDzF) * faceDirection;`
      )
      .replace(
        '#include <dithering_fragment>',
        `float wSlopeMag = length(vec2(wDhDxF, wDhDzF));
vec3 wViewDir = normalize(vViewPosition);
float wNdotV = clamp(abs(dot(wViewDir, normal)), 0.0, 1.0);
float wViewFresnel = pow(max(0.0001, 1.0 - wNdotV), 2.4);
if (!gl_FrontFacing) {
  // Snell's window (~48.6 deg air-water critical angle) & underwater total internal reflection
  float snellWin = smoothstep(0.55, 0.74, wNdotV);
  float snellCoord = (wNdotV - 0.65) / 0.075;
  float snellRing = exp(-(snellCoord * snellCoord));
  vec3 tirColor = mix(uWaterColor * 0.92, vec3(0.68, 0.92, 1.0) * uSunColor, 0.30 + wSlopeMag * 0.32);
  gl_FragColor.rgb = mix(tirColor, gl_FragColor.rgb + uSunColor * 0.14 * uCausticIntensity, snellWin);
  gl_FragColor.rgb += vec3(0.45, 0.86, 1.0) * snellRing * 0.16 * uCausticIntensity;
  gl_FragColor.a = clamp(mix(0.62, 0.22, snellWin) + snellRing * 0.14 + wSlopeMag * 0.14, 0.18, 0.84);
} else {
  gl_FragColor.a = clamp(gl_FragColor.a + wViewFresnel * 0.34 + wSlopeMag * 0.16, 0.16, 0.78);
}
#include <dithering_fragment>`
      );
  };
  materials.push(waterMat);

  const waterSurface = new THREE.Mesh(waterGeom, waterMat);
  waterSurface.position.set(0, waterTopY, 0);
  waterSurface.renderOrder = 45;
  group.add(waterSurface);

  // 3b. Animated Capillary Meniscus Line Clinging to the Front, Left, & Right Glass Walls
  const meniscusHeight = 0.036;
  const meniscusMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uMotionAmp: uniforms.uMotionAmp,
      uWaterColor: waterFog?.uWaterColor ?? { value: fallbackWaterColor },
      uSunColor: waterFog?.uSunColor ?? { value: fallbackSunColor },
    },
    vertexShader: `
uniform float uTime;
uniform float uMotionAmp;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec3 pos = position;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  float w = (sin(wp.x * 1.85 + uTime * 1.35 + cos(wp.z * 1.35 - uTime * 0.85) * 0.7) * 0.014
           + cos(wp.x * 3.4 - wp.z * 2.7 + uTime * 2.05) * 0.0065) * uMotionAmp;
  wp.y += w;
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: `
uniform vec3 uWaterColor;
uniform vec3 uSunColor;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  float bandCoord = (vUv.y - 0.56) / 0.24;
  float crestCoord = (vUv.y - 0.64) / 0.08;
  float band = exp(-(bandCoord * bandCoord));
  float crest = exp(-(crestCoord * crestCoord));
  vec3 col = mix(uWaterColor * 1.35 + vec3(0.18, 0.42, 0.52), vec3(0.84, 0.97, 1.0) * uSunColor, crest * 0.72);
  float alpha = band * 0.34 + crest * 0.38;
  gl_FragColor = vec4(col, alpha);
}`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  materials.push(meniscusMat);

  const frontMeniscusGeom = new THREE.PlaneGeometry(tankW - 0.04, meniscusHeight, 48, 1);
  const sideMeniscusGeom = new THREE.PlaneGeometry(tankD - 0.04, meniscusHeight, 28, 1);
  geometries.push(frontMeniscusGeom, sideMeniscusGeom);

  const frontMeniscus = new THREE.Mesh(frontMeniscusGeom, meniscusMat);
  frontMeniscus.position.set(0, waterTopY - 0.005, tankD * 0.5 - 0.012);
  frontMeniscus.renderOrder = 57;

  const leftMeniscus = new THREE.Mesh(sideMeniscusGeom, meniscusMat);
  leftMeniscus.position.set(-tankW * 0.5 + 0.012, waterTopY - 0.005, 0);
  leftMeniscus.rotation.y = Math.PI * 0.5;
  leftMeniscus.renderOrder = 56;

  const rightMeniscus = new THREE.Mesh(sideMeniscusGeom, meniscusMat);
  rightMeniscus.position.set(tankW * 0.5 - 0.012, waterTopY - 0.005, 0);
  rightMeniscus.rotation.y = -Math.PI * 0.5;
  rightMeniscus.renderOrder = 56;

  group.add(frontMeniscus, leftMeniscus, rightMeniscus);

  // 3c. Discreet Corner Porous Basalt Air-Stone & Slim Airline in Back-Right Corner
  const airX = tankW * 0.5 - Math.min(0.42, tankW * 0.1);
  const airZ = -tankD * 0.5 + Math.min(0.36, tankD * 0.14);
  const airFloorY = sandHeightAt(airX, airZ, { width: tankW, depth: tankD, sandBaseY });
  const airstoneTop = new THREE.Vector3(airX, airFloorY + 0.088, airZ);

  const stoneBodyGeom = new THREE.CylinderGeometry(0.052, 0.064, 0.078, 18);
  const collarGeom = new THREE.CylinderGeometry(0.018, 0.022, 0.016, 12);
  const midTubeY = (airFloorY + waterTopY) * 0.5 - 0.25;
  const tubeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(airX, airFloorY + 0.075, airZ),
    new THREE.Vector3(airX + 0.14, airFloorY + 0.12, airZ - 0.14),
    new THREE.Vector3(tankW * 0.5 - 0.06, midTubeY, -tankD * 0.5 + 0.06),
    new THREE.Vector3(tankW * 0.5 - 0.05, waterTopY + 0.18, -tankD * 0.5 + 0.05),
  ]);
  const tubeGeom = new THREE.TubeGeometry(tubeCurve, 24, 0.0085, 8, false);
  geometries.push(stoneBodyGeom, collarGeom, tubeGeom);

  const stoneBodyMat = new THREE.MeshStandardMaterial({
    map: photoTextures.rockAlbedo,
    normalMap: photoTextures.rockNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    color: 0x6b7b88,
    roughness: 0.88,
    metalness: 0.04,
  });
  if (waterFog) applyWaterDepthFog(stoneBodyMat, waterFog, 0.92, 0.35);

  const collarMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.42,
    metalness: 0.45,
  });
  if (waterFog) applyWaterDepthFog(collarMat, waterFog, 0.92);

  const tubeMat = new THREE.MeshPhysicalMaterial({
    color: 0x94a3b8,
    roughness: 0.25,
    metalness: 0.05,
    transparent: true,
    opacity: 0.58,
  });
  if (waterFog) applyWaterDepthFog(tubeMat, waterFog, 0.85);
  materials.push(stoneBodyMat, collarMat, tubeMat);

  const stoneMesh = new THREE.Mesh(stoneBodyGeom, stoneBodyMat);
  stoneMesh.position.set(airX, airFloorY + 0.036, airZ);
  stoneMesh.castShadow = !isSoftwareGl;
  stoneMesh.receiveShadow = !isSoftwareGl;

  const collarMesh = new THREE.Mesh(collarGeom, collarMat);
  collarMesh.position.set(airX, airFloorY + 0.078, airZ);

  const tubeMesh = new THREE.Mesh(tubeGeom, tubeMat);
  group.add(stoneMesh, collarMesh, tubeMesh);

  // 4. Soft Out-of-Focus Underwater Aquascape Backdrop Behind Rear Glass
  const backGeom = new THREE.PlaneGeometry(tankW, tankH);
  geometries.push(backGeom);
  const initBackdropTex =
    photoTextures.backdrops[backgroundId] ?? photoTextures.backdropMap ?? null;
  const initStyle = getBackdropVisualStyle(backgroundId);
  const backMat = new THREE.MeshStandardMaterial({
    map: initBackdropTex ?? undefined,
    emissiveMap: initBackdropTex ?? undefined,
    color: initStyle.tintHex,
    emissive: new THREE.Color(initStyle.emissiveHex),
    emissiveIntensity: initStyle.emissiveIntensity,
    roughness: 0.94,
    metalness: 0.0,
    envMapIntensity: 0.08,
    side: THREE.DoubleSide,
  });
  if (waterFog) applyWaterDepthFog(backMat, waterFog, 0.48);
  materials.push(backMat);
  const backGlass = new THREE.Mesh(backGeom, backMat);
  backGlass.position.set(0, 0.05, -tankD * 0.5);
  group.add(backGlass);

  const setBackground = (id: AquariumBackgroundId, nextPhotos: AquariumPhotoTextures) => {
    const tex = nextPhotos.backdrops[id] ?? nextPhotos.backdropMap ?? null;
    const style = getBackdropVisualStyle(id);
    backMat.map = tex;
    backMat.emissiveMap = tex;
    backMat.color.setHex(style.tintHex);
    backMat.emissive.setHex(style.emissiveHex);
    backMat.emissiveIntensity = style.emissiveIntensity;
    backMat.needsUpdate = true;
  };

  // 5. Left, Right & Front Ultra-Clear Glass Walls (subtle Fresnel reflection & clear view)
  const sideGlassGeom = new THREE.PlaneGeometry(tankD, tankH);
  const frontGlassGeom = new THREE.PlaneGeometry(tankW, tankH);
  geometries.push(sideGlassGeom, frontGlassGeom);

  const glassWallMat = new THREE.MeshPhysicalMaterial({
    color: 0xaee8ff,
    roughness: 0.035,
    metalness: 0.04,
    ior: 1.52,
    reflectivity: 0.9,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    transparent: true,
    opacity: 0.088,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  materials.push(glassWallMat);

  const leftGlass = new THREE.Mesh(sideGlassGeom, glassWallMat);
  leftGlass.position.set(-tankW * 0.5, 0.05, 0);
  leftGlass.rotation.y = Math.PI * 0.5;
  leftGlass.renderOrder = 55;

  const rightGlass = new THREE.Mesh(sideGlassGeom, glassWallMat);
  rightGlass.position.set(tankW * 0.5, 0.05, 0);
  rightGlass.rotation.y = -Math.PI * 0.5;
  rightGlass.renderOrder = 55;

  const frontGlass = new THREE.Mesh(frontGlassGeom, glassWallMat);
  frontGlass.position.set(0, 0.05, tankD * 0.5);
  frontGlass.renderOrder = 58;

  group.add(leftGlass, rightGlass, frontGlass);

  // 6. Tempered Optical Glass Edge Bevels (green-aqua glass thickness) + Seam Outlines + Plinth
  const bevelMat = new THREE.MeshPhysicalMaterial({
    color: 0x6ce5d6,
    roughness: 0.08,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  materials.push(bevelMat);

  const cornerBevelGeom = new THREE.BoxGeometry(0.022, tankH, 0.022);
  const frontRimGeom = new THREE.BoxGeometry(tankW + 0.02, 0.02, 0.022);
  const sideRimGeom = new THREE.BoxGeometry(0.022, 0.02, tankD);
  geometries.push(cornerBevelGeom, frontRimGeom, sideRimGeom);

  const corners = [
    [-tankW * 0.5, -tankD * 0.5],
    [tankW * 0.5, -tankD * 0.5],
    [-tankW * 0.5, tankD * 0.5],
    [tankW * 0.5, tankD * 0.5],
  ];
  for (const [cx, cz] of corners) {
    const post = new THREE.Mesh(cornerBevelGeom, bevelMat);
    post.position.set(cx, 0.05, cz);
    post.renderOrder = 59;
    group.add(post);
  }

  const topY = 0.05 + tankH * 0.5;
  const frontTopRim = new THREE.Mesh(frontRimGeom, bevelMat);
  frontTopRim.position.set(0, topY, tankD * 0.5);
  frontTopRim.renderOrder = 59;

  const backTopRim = new THREE.Mesh(frontRimGeom, bevelMat);
  backTopRim.position.set(0, topY, -tankD * 0.5);
  backTopRim.renderOrder = 59;

  const leftTopRim = new THREE.Mesh(sideRimGeom, bevelMat);
  leftTopRim.position.set(-tankW * 0.5, topY, 0);
  leftTopRim.renderOrder = 59;

  const rightTopRim = new THREE.Mesh(sideRimGeom, bevelMat);
  rightTopRim.position.set(tankW * 0.5, topY, 0);
  rightTopRim.renderOrder = 59;

  group.add(frontTopRim, backTopRim, leftTopRim, rightTopRim);

  const tempOutlineBox = new THREE.BoxGeometry(tankW, tankH, tankD);
  const tankOutlineGeom = new THREE.EdgesGeometry(tempOutlineBox);
  tempOutlineBox.dispose();
  geometries.push(tankOutlineGeom);
  const seamMat = new THREE.LineBasicMaterial({
    color: 0x8be2ff,
    transparent: true,
    opacity: 0.28,
  });
  materials.push(seamMat);
  const tankEdges = new THREE.LineSegments(tankOutlineGeom, seamMat);
  tankEdges.position.set(0, 0.05, 0);
  group.add(tankEdges);

  const plinthGeom = new THREE.BoxGeometry(tankW + 0.14, 0.18, tankD + 0.14);
  geometries.push(plinthGeom);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.38,
    metalness: 0.68,
  });
  materials.push(plinthMat);
  const plinth = new THREE.Mesh(plinthGeom, plinthMat);
  plinth.position.set(0, -tankH * 0.5 + 0.05 - 0.09, 0);
  group.add(plinth);

  return {
    group,
    dims: { width: tankW, height: tankH, depth: tankD },
    sandBaseY,
    waterTopY,
    uniforms,
    airstoneTop,
    triggerSurfaceWave,
    setBackground,
    geometries,
    materials,
  };
}
