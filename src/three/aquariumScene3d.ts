import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {
  AquariumCounts,
  AquariumLighting,
  FishSpecies,
  LightingPreset,
  PlantStyle,
  SelectedDecor,
} from '../types/aquarium';
import { loadAquariumSprites, type AquariumSprites } from '../utils/spriteLoader';
import {
  createPlant3D,
  createRock3D,
  type Plant3DHandle,
  type Rock3DHandle,
} from './decor3d';
import {
  createHyperrealisticFish3D,
  createSpeciesTextureSet,
  disposeSpeciesTextureSet,
  updateFishSkeleton,
  type FishRig3D,
  type SpeciesTextureSet,
} from './fish3d';
import {
  disposeAquariumPhotoTextures,
  loadAquariumPhotoTextures,
  type AquariumPhotoTextures,
} from './photoTextures';
import {
  createAquariumTank3D,
  sandHeightAt,
  TANK_D,
  TANK_W,
  TANK_WATER_TOP_Y,
  type Tank3DHandle,
} from './tank3d';
import {
  applyWaterDepthFog,
  createWaterFogUniforms,
  type WaterFogUniforms,
} from './waterFogShader';

const STORAGE_KEY = 'acuario3d.state.v1';
const NORMAL_SATIETY = 0.68;
const MIN_SATIETY = 0.0;
const MAX_SATIETY = 1.45;
const HUNGER_DECAY_PER_SEC = 0.085 / 3600; // ~8h normal -> thin, ~9h overfed -> normal
const FOOD_SATIETY_GAIN = 0.14;

interface SavedFishV1 {
  species: FishSpecies;
  baseScale: number;
  satiety: number;
}

interface SavedPlantV1 {
  x: number;
  z: number;
  style: PlantStyle;
  scale: number;
  seed: number;
}

interface SavedStoneV1 {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  seed: number;
}

interface SavedAquariumV1 {
  version: 1;
  savedAt: number;
  nextSeed: number;
  nextExtraSpeciesIdx: number;
  lighting: AquariumLighting;
  fish: SavedFishV1[];
  plants: SavedPlantV1[];
  stones: SavedStoneV1[];
}

interface FishEntity3D {
  id: string;
  species: FishSpecies;
  rig: FishRig3D;
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  baseSpeed: number;
  targetPos: THREE.Vector3;
  wanderTimer: number;
  fleeTimer: number;
  bobPhase: number;
  bobFreq: number;
  bobAmp: number;
  swimPhase: number;
  scullPhase: number;
  breathPhase: number;
  burstPhase: number;
  swimEffort: number;
  turnBendSmooth: number;
  spawnScale: number;
  baseScale: number;
  satiety: number;
  visualSatiety: number;
  chompTimer: number;
  targetFoodId: string | null;
  dustCooldown: number;
}

interface PlantEntity3D {
  id: string;
  style: PlantStyle;
  handle: Plant3DHandle;
  x: number;
  y: number;
  z: number;
  scale: number;
  seed: number;
  growProgress: number;
}

interface StoneEntity3D {
  id: string;
  handle: Rock3DHandle;
  shadowMesh: THREE.Mesh;
  shadowMat: THREE.MeshBasicMaterial;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  seed: number;
  dropProgress: number;
}

interface BubbleEntity3D {
  active: boolean;
  pos: THREE.Vector3;
  vx: number;
  vy: number;
  vz: number;
  wobblePhase: number;
  wobbleSpeed: number;
  wobbleAmp: number;
  driftPhase: number;
  driftSpeed: number;
  squashPhase: number;
  squashSpeed: number;
  squashAmp: number;
  flatness: number;
  xzRatio: number;
  yaw: number;
  radius: number;
  mesh: THREE.Mesh;
}

interface FoodEntity3D {
  id: string;
  active: boolean;
  inWater: boolean;
  settled: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rotSpeed: THREE.Vector3;
  baseScale: THREE.Vector3;
  ageOnSand: number;
  swayPhase: number;
  mesh: THREE.Mesh;
}

interface SandDustSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
  baseSize: number;
  floorY: number;
}

interface SandGrainSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
  size: number;
  floorY: number;
}

export interface AquariumScene3DCallbacks {
  onCountsChange: (counts: AquariumCounts) => void;
  onSelectionChange: (selected: SelectedDecor | null) => void;
  onLightingLoaded?: (lighting: AquariumLighting) => void;
}

// Pre-allocated scratch helpers (zero GC in render loop)
const _vec2 = new THREE.Vector2();
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _avoidVec = new THREE.Vector3();
const _obsSteer = new THREE.Vector3();
const _probePos = new THREE.Vector3();
const _segA0 = new THREE.Vector3();
const _segA1 = new THREE.Vector3();
const _segB0 = new THREE.Vector3();
const _segB1 = new THREE.Vector3();
const _pA = new THREE.Vector3();
const _pB = new THREE.Vector3();
const _sepDiff = new THREE.Vector3();
const _fwdA = new THREE.Vector3();
const _fwdB = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _dragPlane = new THREE.Plane();
const _hitPoint = new THREE.Vector3();

function computeFishConditionScales(satiety: number): { sx: number; sy: number; sz: number } {
  const s = THREE.MathUtils.clamp(satiety, MIN_SATIETY, MAX_SATIETY);
  if (s <= NORMAL_SATIETY) {
    const t = s / NORMAL_SATIETY;
    return {
      sx: THREE.MathUtils.lerp(0.84, 1.0, t),
      sy: THREE.MathUtils.lerp(0.79, 1.0, t),
      sz: THREE.MathUtils.lerp(0.70, 1.0, t),
    };
  }
  const t = (s - NORMAL_SATIETY) / (MAX_SATIETY - NORMAL_SATIETY);
  return {
    sx: THREE.MathUtils.lerp(1.0, 1.09, t),
    sy: THREE.MathUtils.lerp(1.0, 1.18, t),
    sz: THREE.MathUtils.lerp(1.0, 1.38, t),
  };
}

function closestPointsBetweenSegments(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  out1: THREE.Vector3,
  out2: THREE.Vector3
): void {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const d2z = q2.z - p2.z;
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const rz = p1.z - p2.z;

  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s = 0;
  let t = 0;

  if (a <= 1e-6 && e <= 1e-6) {
    out1.copy(p1);
    out2.copy(p2);
    return;
  }
  if (a <= 1e-6) {
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-6) {
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }

  out1.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s);
  out2.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t);
}

interface LightingPresetConfig {
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  rimColor: THREE.Color;
  rimIntensity: number;
  bounceColor: THREE.Color;
  bounceIntensity: number;
  bgColor: THREE.Color;
  beamColor: THREE.Color;
  beamOpacity: number;
  waterColor: THREE.Color;
  waterDensity: number;
  envIntensity: number;
  causticScale: number;
  exposureScale: number;
}

const LIGHTING_PRESETS: Record<LightingPreset, LightingPresetConfig> = {
  day: {
    sunColor: new THREE.Color(0xfff5e1),
    sunIntensity: 2.35,
    hemiSky: new THREE.Color(0xa5f3fc),
    hemiGround: new THREE.Color(0x16425b),
    hemiIntensity: 1.28,
    rimColor: new THREE.Color(0x38bdf8),
    rimIntensity: 1.05,
    bounceColor: new THREE.Color(0xd9c29c),
    bounceIntensity: 0.52,
    bgColor: new THREE.Color(0x061b2c),
    beamColor: new THREE.Color(0xbbeeff),
    beamOpacity: 0.044,
    waterColor: new THREE.Color(0x11587a),
    waterDensity: 0.25,
    envIntensity: 1.0,
    causticScale: 1.0,
    exposureScale: 1.0,
  },
  reef: {
    sunColor: new THREE.Color(0xbfe6ff),
    sunIntensity: 1.95,
    hemiSky: new THREE.Color(0x38bdf8),
    hemiGround: new THREE.Color(0x0c2d48),
    hemiIntensity: 1.35,
    rimColor: new THREE.Color(0x0ea5e9),
    rimIntensity: 1.45,
    bounceColor: new THREE.Color(0x67a7c8),
    bounceIntensity: 0.48,
    bgColor: new THREE.Color(0x03172b),
    beamColor: new THREE.Color(0x7dd3fc),
    beamOpacity: 0.052,
    waterColor: new THREE.Color(0x0c4f82),
    waterDensity: 0.27,
    envIntensity: 0.95,
    causticScale: 1.08,
    exposureScale: 0.98,
  },
  sunset: {
    sunColor: new THREE.Color(0xffb067),
    sunIntensity: 2.2,
    hemiSky: new THREE.Color(0xfed7aa),
    hemiGround: new THREE.Color(0x16384d),
    hemiIntensity: 1.1,
    rimColor: new THREE.Color(0xfb923c),
    rimIntensity: 1.15,
    bounceColor: new THREE.Color(0xe3b086),
    bounceIntensity: 0.46,
    bgColor: new THREE.Color(0x101b2e),
    beamColor: new THREE.Color(0xfed7aa),
    beamOpacity: 0.048,
    waterColor: new THREE.Color(0x164a66),
    waterDensity: 0.24,
    envIntensity: 0.92,
    causticScale: 0.96,
    exposureScale: 0.98,
  },
  night: {
    sunColor: new THREE.Color(0x7cb9e8),
    sunIntensity: 0.65,
    hemiSky: new THREE.Color(0x1e4e79),
    hemiGround: new THREE.Color(0x081b2a),
    hemiIntensity: 0.72,
    rimColor: new THREE.Color(0x38bdf8),
    rimIntensity: 0.85,
    bounceColor: new THREE.Color(0x3a5f78),
    bounceIntensity: 0.24,
    bgColor: new THREE.Color(0x020c18),
    beamColor: new THREE.Color(0x60a5fa),
    beamOpacity: 0.025,
    waterColor: new THREE.Color(0x061c34),
    waterDensity: 0.30,
    envIntensity: 0.52,
    causticScale: 0.55,
    exposureScale: 0.82,
  },
};

function detectSoftwareGl(): boolean {
  try {
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    if (!gl) return true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
      : '';
    const isSoft = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return isSoft;
  } catch {
    return false;
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

let nextIdSeq = 1;
function genId(prefix: string): string {
  nextIdSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextIdSeq}`;
}

function createRockShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size * 0.5;
    const grad = ctx.createRadialGradient(half, half, 4, half, half, half - 2);
    grad.addColorStop(0.0, 'rgba(3, 14, 24, 1.0)');
    grad.addColorStop(0.48, 'rgba(3, 14, 24, 0.65)');
    grad.addColorStop(0.78, 'rgba(3, 14, 24, 0.22)');
    grad.addColorStop(1.0, 'rgba(3, 14, 24, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class AquariumScene3DController {
  private container: HTMLElement;
  private callbacks: AquariumScene3DCallbacks;
  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pmremTarget: THREE.WebGLRenderTarget;

  private viewportW = 390;
  private viewportH = 760;

  private sprites: AquariumSprites | null = null;
  private photoTextures: AquariumPhotoTextures | null = null;
  private tank: Tank3DHandle | null = null;
  private speciesTextures: Partial<Record<FishSpecies, SpeciesTextureSet>> = {};
  private sunbeams: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; phase: number }[] = [];

  private hemiLight!: THREE.HemisphereLight;
  private sunKeyLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private sandBounceLight!: THREE.DirectionalLight;
  private targetLighting: AquariumLighting = { preset: 'day', intensity: 1.0 };
  private currentIntensity = 1.0;
  private currentBeamOpacity = 0.044;
  private waterFogUniforms: WaterFogUniforms = createWaterFogUniforms();

  private fishList: FishEntity3D[] = [];
  private plantList: PlantEntity3D[] = [];
  private stoneList: StoneEntity3D[] = [];
  private bubbles: BubbleEntity3D[] = [];
  private foods: FoodEntity3D[] = [];

  private bubbleGeom: THREE.SphereGeometry;
  private bubbleMat: THREE.MeshPhysicalMaterial;
  private foodGeom: THREE.IcosahedronGeometry;
  private foodMats: THREE.MeshStandardMaterial[];
  private rockShadowGeom: THREE.PlaneGeometry;
  private rockShadowTex: THREE.CanvasTexture;
  private motesPoints: THREE.Points | null = null;
  private motesMat: THREE.ShaderMaterial | null = null;
  private motesCount = 88;
  private motesPhases: Float32Array | null = null;
  private detritusPoints: THREE.Points | null = null;
  private detritusMat: THREE.ShaderMaterial | null = null;
  private detritusCount = 74;
  private detritusPhases: Float32Array | null = null;
  private detritusSinkRates: Float32Array | null = null;
  private detritusCrumbCursor = 0;
  private sandDustPoints: THREE.Points | null = null;
  private sandDustMat: THREE.ShaderMaterial | null = null;
  private sandDustPool: SandDustSlot[] = [];
  private maxSandDust = 200;
  private sandGrainsPoints: THREE.Points | null = null;
  private sandGrainsMat: THREE.ShaderMaterial | null = null;
  private sandGrainPool: SandGrainSlot[] = [];
  private maxSandGrains = 120;
  private selectionRing: THREE.Mesh;
  private selectionRingMat: THREE.MeshBasicMaterial;

  private editMode = false;
  private selectedDecor: SelectedDecor | null = null;
  private dragState: {
    pointerId: number;
    decor: SelectedDecor;
    hasMoved: boolean;
    startClientX: number;
    startClientY: number;
    offsetX: number;
    offsetY: number;
    offsetZ: number;
  } | null = null;

  private orbitTapTracker: {
    pointerId: number;
    startX: number;
    startY: number;
  } | null = null;

  private cameraGoalPos: THREE.Vector3 | null = null;
  private cameraGoalTarget: THREE.Vector3 | null = null;

  private nextSeed = 101;
  private nextExtraSpeciesIdx = 0;
  private elapsedTime = 0;
  private lastFrameMs = 0;
  private lastWallTimeMs = Date.now();
  private saveAccumulator = 0;
  private ambientBubbleTimer = 0.25;
  private airstoneTimer = 0.08;
  private hasLoadedState = false;
  private reducedMotion = false;
  private disposed = false;
  private rafId = 0;
  private softTimerId: number | null = null;
  private resizeObserver: ResizeObserver;
  private motionQuery: MediaQueryList;
  private maxAnisotropy = 4;

  constructor(container: HTMLElement, callbacks: AquariumScene3DCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareGl();

    const rect = container.getBoundingClientRect();
    this.viewportW = Math.max(1, rect.width || window.innerWidth);
    this.viewportH = Math.max(1, rect.height || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.setSize(this.viewportW, this.viewportH);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.backgroundColor = '#000000';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.container.appendChild(this.renderer.domElement);

    this.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x061b2c, 0.015);

    this.camera = new THREE.PerspectiveCamera(
      38,
      this.viewportW / this.viewportH,
      0.1,
      45
    );
    this.setDefaultCameraPose(true);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 4.4;
    this.controls.maxDistance = 13.5;
    this.controls.minPolarAngle = 0.36;
    this.controls.maxPolarAngle = Math.PI * 0.56;
    this.controls.minAzimuthAngle = -Math.PI * 0.44;
    this.controls.maxAzimuthAngle = Math.PI * 0.44;
    this.controls.target.set(0, -0.05, 0);
    this.controls.addEventListener('start', () => {
      this.cameraGoalPos = null;
      this.cameraGoalTarget = null;
    });
    this.controls.update();

    // Studio environment reflection for glass tank, wet rocks, fish scales, and bubbles
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.pmremTarget = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this.pmremTarget.texture;
    roomEnv.dispose();
    pmrem.dispose();

    this.setupLighting();

    // Shared bubble & food pools — bubbles sculpted with subtle hydrodynamic underside flattening
    this.bubbleGeom = new THREE.SphereGeometry(1, 18, 14);
    const bPos = this.bubbleGeom.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      const vx = bPos.getX(i);
      const vy = bPos.getY(i);
      const vz = bPos.getZ(i);
      const underFlat = vy < 0 ? 0.78 + 0.14 * (1 + vy) : 1.0 - vy * 0.06;
      const shoulder = 1.0 + Math.max(0, 1 - Math.abs(vy)) * 0.05;
      bPos.setXYZ(i, vx * shoulder, vy * underFlat, vz * shoulder);
    }
    this.bubbleGeom.computeVertexNormals();

    this.bubbleMat = new THREE.MeshPhysicalMaterial({
      color: 0xe6f7ff,
      roughness: 0.03,
      metalness: 0.02,
      ior: 1.333,
      reflectivity: 0.92,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.15,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.bubbleMat.customProgramCacheKey = () => 'aquarium-bubble-fresnel-v2';
    this.bubbleMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `vec3 bViewDir = normalize(vViewPosition);
vec3 bNorm = normalize(vNormal);
float bNdotV = clamp(abs(dot(bViewDir, bNorm)), 0.0, 1.0);
float bFresnel = pow(max(0.0001, 1.0 - bNdotV), 2.35);
float bTopSpec = pow(max(0.0001, clamp(dot(bNorm, normalize(vec3(0.20, 0.92, 0.34))), 0.0, 1.0)), 24.0);
float bUnderRim = pow(max(0.0001, clamp(dot(bNorm, normalize(vec3(-0.12, -0.88, 0.45))), 0.0, 1.0)), 5.0) * 0.16;
float bAlpha = clamp(0.02 + bFresnel * 0.56 + bTopSpec * 0.72 + bUnderRim, 0.02, 0.76);
gl_FragColor.rgb = mix(gl_FragColor.rgb * 0.78, vec3(0.86, 0.96, 1.0), bFresnel * 0.42 + bTopSpec * 0.65);
gl_FragColor.a *= bAlpha;
#include <dithering_fragment>`
      );
    };
    applyWaterDepthFog(this.bubbleMat, this.waterFogUniforms, 0.72);
    this.foodGeom = new THREE.IcosahedronGeometry(0.026, 1);
    this.foodMats = [
      new THREE.MeshStandardMaterial({
        color: 0xe8a33a,
        roughness: 0.62,
        metalness: 0.04,
      }),
      new THREE.MeshStandardMaterial({
        color: 0xc96b22,
        roughness: 0.68,
        metalness: 0.04,
      }),
      new THREE.MeshStandardMaterial({
        color: 0xb6812c,
        roughness: 0.66,
        metalness: 0.03,
      }),
    ];
    this.rockShadowGeom = new THREE.PlaneGeometry(1, 1);
    this.rockShadowGeom.rotateX(-Math.PI * 0.5);
    this.rockShadowTex = createRockShadowTexture();

    // Ground selection ring indicator (horizontal on sand/stone surface)
    const selGeom = new THREE.RingGeometry(0.92, 1.02, 48);
    selGeom.rotateX(-Math.PI * 0.5);
    this.selectionRingMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.selectionRing = new THREE.Mesh(selGeom, this.selectionRingMat);
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.buildAmbientAtmosphere();

    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener('change', this.handleMotionChange);

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.container);

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.handlePointerDown);
    dom.addEventListener('pointermove', this.handlePointerMove);
    dom.addEventListener('pointerup', this.handlePointerUp);
    dom.addEventListener('pointercancel', this.handlePointerUp);
    dom.addEventListener('webglcontextlost', this.handleContextLost);
    document.addEventListener('visibilitychange', this.handleVisibilityOrHide);
    window.addEventListener('pagehide', this.handleVisibilityOrHide);

    void this.initAssetsAndPopulate();

    this.lastFrameMs = performance.now();
    this.lastWallTimeMs = Date.now();
    this.startLoop();
  }

  private getIdealCameraDistance(): number {
    const aspect = this.viewportW / Math.max(1, this.viewportH);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const neededForWidth = (TANK_W * 1.16) / (2 * Math.tan(vFov * 0.5) * aspect);
    return THREE.MathUtils.clamp(Math.max(6.4, neededForWidth), 6.2, 11.8);
  }

  private setDefaultCameraPose(immediate: boolean): void {
    const dist = this.getIdealCameraDistance();
    const goalPos = new THREE.Vector3(0.65, 0.55, dist);
    const goalTarget = new THREE.Vector3(0, -0.05, 0);
    if (immediate) {
      this.camera.position.copy(goalPos);
      this.camera.lookAt(goalTarget);
    } else {
      this.cameraGoalPos = goalPos;
      this.cameraGoalTarget = goalTarget;
    }
  }

  public resetCamera(): void {
    this.setDefaultCameraPose(false);
  }

  public setLighting(next: AquariumLighting): void {
    const preset: LightingPreset = Object.prototype.hasOwnProperty.call(
      LIGHTING_PRESETS,
      next.preset
    )
      ? next.preset
      : 'day';
    const rawInt =
      typeof next.intensity === 'number' && Number.isFinite(next.intensity)
        ? next.intensity
        : 1.0;
    this.targetLighting = {
      preset,
      intensity: THREE.MathUtils.clamp(rawInt, 0.15, 1.6),
    };
    this.saveState();
  }

  public setEditMode(enabled: boolean): void {
    this.editMode = enabled;
    if (!enabled) {
      this.setSelection(null);
      if (this.dragState) {
        this.dragState = null;
        this.controls.enabled = true;
      }
    }
  }

  private handleMotionChange = (e: MediaQueryListEvent) => {
    this.reducedMotion = e.matches;
  };

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
  };

  private setupLighting(): void {
    this.hemiLight = new THREE.HemisphereLight(0xa5f3fc, 0x16425b, 1.28);
    this.scene.add(this.hemiLight);

    this.sunKeyLight = new THREE.DirectionalLight(0xfff5e1, 2.35);
    this.sunKeyLight.position.set(2.4, 5.8, 3.6);
    if (!this.isSoftwareGl) {
      this.sunKeyLight.castShadow = true;
      this.sunKeyLight.shadow.mapSize.set(1024, 1024);
      this.sunKeyLight.shadow.camera.near = 1;
      this.sunKeyLight.shadow.camera.far = 14;
      this.sunKeyLight.shadow.camera.left = -3.6;
      this.sunKeyLight.shadow.camera.right = 3.6;
      this.sunKeyLight.shadow.camera.top = 3.0;
      this.sunKeyLight.shadow.camera.bottom = -3.0;
      this.sunKeyLight.shadow.radius = 3;
      this.sunKeyLight.shadow.bias = -0.0005;
      this.sunKeyLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.sunKeyLight);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 1.05);
    this.rimLight.position.set(-4.2, 2.2, -3.2);
    this.scene.add(this.rimLight);

    this.sandBounceLight = new THREE.DirectionalLight(0xd9c29c, 0.52);
    this.sandBounceLight.position.set(0, -4.5, 2.2);
    this.scene.add(this.sandBounceLight);
  }

  private handleResize = (): void => {
    if (this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    if (w === this.viewportW && h === this.viewportH) return;

    this.viewportW = w;
    this.viewportH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private buildAmbientAtmosphere(): void {
    // Dynamic wave-synced volumetric god-rays descending from water surface (soft Gaussian edges)
    const beamGeom = new THREE.PlaneGeometry(1.18, 2.55, 1, 1);
    const beamConfigs = [
      { x: -1.35, z: -0.45, rotZ: -0.22, rotY: 0.15, phase: 0.2 },
      { x: 0.15, z: -0.65, rotZ: -0.18, rotY: -0.1, phase: 2.1 },
      { x: 1.45, z: -0.25, rotZ: -0.24, rotY: 0.2, phase: 4.0 },
    ];
    for (const cfg of beamConfigs) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMotionAmp: { value: 1.0 },
          uPhase: { value: cfg.phase },
          uColor: { value: new THREE.Color(0xbbeeff) },
          uOpacity: { value: 0.065 },
        },
        vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: `
uniform float uTime;
uniform float uMotionAmp;
uniform float uPhase;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float horiz = pow(max(0.0001, sin(vUv.x * 3.14159265)), 2.35);
  float vert = smoothstep(0.0, 0.34, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
  float t = uTime * uMotionAmp;
  float wave1 = 0.56 + 0.44 * sin(vUv.x * 9.5 + t * 1.45 + uPhase + cos(vUv.y * 2.8 - t * 0.85));
  float wave2 = 0.65 + 0.35 * cos(vUv.x * 16.0 - t * 2.05 + uPhase * 1.7);
  float shaft = horiz * vert * wave1 * wave2;
  gl_FragColor = vec4(uColor, shaft * uOpacity * 1.45);
}`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(beamGeom, mat);
      mesh.position.set(cfg.x, 0.18, cfg.z);
      mesh.rotation.set(0, cfg.rotY, cfg.rotZ);
      mesh.renderOrder = 35;
      this.scene.add(mesh);
      this.sunbeams.push({ mesh, mat, phase: cfg.phase });
    }

    // Light-lit circular-current suspended micro-motes inside tank volume
    const moteCount = this.motesCount;
    const positions = new Float32Array(moteCount * 3);
    const sizes = new Float32Array(moteCount);
    const alphas = new Float32Array(moteCount);
    const phases = new Float32Array(moteCount);
    for (let i = 0; i < moteCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * (TANK_W - 0.45);
      positions[i * 3 + 1] = -0.96 + Math.random() * 2.18;
      positions[i * 3 + 2] = (Math.random() - 0.5) * (TANK_D - 0.45);
      sizes[i] = 0.08 + Math.pow(Math.random(), 2.4) * 0.24;
      alphas[i] = 0.18 + Math.random() * 0.82;
      phases[i] = Math.random() * Math.PI * 2;
    }
    this.motesPhases = phases;

    const moteGeom = new THREE.BufferGeometry();
    moteGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    moteGeom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    moteGeom.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    moteGeom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const moteMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xcce8f5) },
        uLightIntensity: { value: 1.0 },
      },
      vertexShader: `
attribute float aSize;
attribute float aAlpha;
attribute float aPhase;
varying float vLightFactor;
varying float vAlpha;
varying float vPhase;
void main() {
  vAlpha = aAlpha;
  vPhase = aPhase;
  // Brighten particles crossing the 3 overhead volumetric sun shafts
  float slantX = position.x - (position.y - 0.18) * 0.22;
  float mx1 = (slantX + 1.35) / 0.52;
  float mx2 = (slantX - 0.15) / 0.52;
  float mx3 = (slantX - 1.45) / 0.52;
  float b1 = exp(-(mx1 * mx1));
  float b2 = exp(-(mx2 * mx2));
  float b3 = exp(-(mx3 * mx3));
  float depthAtten = mix(0.28, 1.0, clamp((position.y + 1.1) / 2.35, 0.0, 1.0));
  vLightFactor = (0.14 + 0.90 * max(b1, max(b2, b3))) * depthAtten;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * (72.0 / max(1.0, -mvPos.z)), 1.0, 3.2);
  gl_Position = projectionMatrix * mvPos;
}`,
      fragmentShader: `
uniform float uTime;
uniform vec3 uColor;
uniform float uLightIntensity;
varying float vLightFactor;
varying float vAlpha;
varying float vPhase;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float softCircle = smoothstep(0.5, 0.08, d);
  float shimmer = 0.72 + 0.28 * sin(uTime * 1.4 + vPhase);
  float alpha = softCircle * vLightFactor * vAlpha * shimmer * clamp(0.14 + uLightIntensity * 0.16, 0.06, 0.32);
  gl_FragColor = vec4(uColor, alpha);
}`,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    this.motesMat = moteMat;
    this.motesPoints = new THREE.Points(moteGeom, moteMat);
    this.motesPoints.frustumCulled = false;
    this.scene.add(this.motesPoints);

    // Floating micro food crumbs & organic detritus drifting slowly with the water current
    const detCount = this.detritusCount;
    const detPos = new Float32Array(detCount * 3);
    const detColors = new Float32Array(detCount * 3);
    const detSizes = new Float32Array(detCount);
    const detAlphas = new Float32Array(detCount);
    const detPhases = new Float32Array(detCount);
    const detShapes = new Float32Array(detCount);
    const detSinks = new Float32Array(detCount);

    const detPalette = [
      new THREE.Color(0xd9a252), // golden fish-food crumb
      new THREE.Color(0xb97738), // toasted pellet fleck
      new THREE.Color(0x9da77d), // botanical leaf fragment
      new THREE.Color(0xb7ad99), // pale organic detritus
      new THREE.Color(0x8e836e), // fine natural mulm
    ];

    for (let i = 0; i < detCount; i++) {
      detPos[i * 3] = (Math.random() - 0.5) * (TANK_W - 0.5);
      detPos[i * 3 + 1] = -0.94 + Math.random() * 2.12;
      detPos[i * 3 + 2] = (Math.random() - 0.5) * (TANK_D - 0.5);

      const c = detPalette[i % detPalette.length].clone();
      c.offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.1);
      detColors[i * 3] = c.r;
      detColors[i * 3 + 1] = c.g;
      detColors[i * 3 + 2] = c.b;

      detSizes[i] = 0.14 + Math.pow(Math.random(), 1.9) * 0.30;
      detAlphas[i] = 0.32 + Math.random() * 0.56;
      detPhases[i] = Math.random() * Math.PI * 2;
      detShapes[i] = Math.random() * 6.283;
      detSinks[i] = -0.002 - Math.random() * 0.008;
    }
    this.detritusPhases = detPhases;
    this.detritusSinkRates = detSinks;

    const detGeom = new THREE.BufferGeometry();
    detGeom.setAttribute('position', new THREE.BufferAttribute(detPos, 3));
    detGeom.setAttribute('aColor', new THREE.BufferAttribute(detColors, 3));
    detGeom.setAttribute('aSize', new THREE.BufferAttribute(detSizes, 1));
    detGeom.setAttribute('aAlpha', new THREE.BufferAttribute(detAlphas, 1));
    detGeom.setAttribute('aPhase', new THREE.BufferAttribute(detPhases, 1));
    detGeom.setAttribute('aShape', new THREE.BufferAttribute(detShapes, 1));

    const detMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWaterColor: this.waterFogUniforms.uWaterColor,
        uSunColor: this.waterFogUniforms.uSunColor,
        uLightIntensity: { value: 1.0 },
      },
      vertexShader: `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aPhase;
attribute float aShape;
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
varying float vAngle;
varying float vShape;
varying float vDepthFade;
varying float vLightBoost;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vShape = aShape;
  vAngle = aShape + uTime * (0.35 + mod(aPhase, 0.4));
  float slantX = position.x - (position.y - 0.18) * 0.22;
  float dx1 = (slantX + 1.35) / 0.54;
  float dx2 = (slantX - 0.15) / 0.54;
  float dx3 = (slantX - 1.45) / 0.54;
  float b1 = exp(-(dx1 * dx1));
  float b2 = exp(-(dx2 * dx2));
  float b3 = exp(-(dx3 * dx3));
  vLightBoost = 0.55 + 0.65 * max(b1, max(b2, b3));
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  float dist = max(1.0, -mvPos.z);
  vDepthFade = clamp((dist - 5.4) / 4.8, 0.0, 0.78);
  gl_PointSize = clamp(aSize * (84.0 / dist), 1.4, 5.2);
  gl_Position = projectionMatrix * mvPos;
}`,
      fragmentShader: `
uniform vec3 uWaterColor;
uniform vec3 uSunColor;
uniform float uLightIntensity;
varying vec3 vColor;
varying float vAlpha;
varying float vAngle;
varying float vShape;
varying float vDepthFade;
varying float vLightBoost;
void main() {
  vec2 p = gl_PointCoord - vec2(0.5);
  float ca = cos(vAngle);
  float sa = sin(vAngle);
  vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
  // Slightly irregular elongated crumb/detritus fragment silhouette
  rp.x *= 0.85;
  rp.y *= 1.25;
  float r = length(rp);
  float ang = r > 0.001 ? atan(rp.y, rp.x) : 0.0;
  float edgePerturb = 0.36 + 0.07 * sin(ang * 3.0 + vShape) + 0.05 * cos(ang * 2.0 - vShape * 1.6);
  if (r > edgePerturb) discard;
  float mask = smoothstep(edgePerturb, edgePerturb * 0.35, r);
  vec3 litCol = vColor * mix(vec3(0.75, 0.82, 0.88), uSunColor, 0.65) * vLightBoost;
  vec3 depthCol = mix(litCol, uWaterColor * 1.25, vDepthFade * 0.72);
  float lightMul = clamp(0.28 + uLightIntensity * 0.52, 0.12, 0.88);
  float alpha = mask * vAlpha * (1.0 - vDepthFade * 0.42) * lightMul * 0.56;
  gl_FragColor = vec4(depthCol, alpha);
}`,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    this.detritusMat = detMat;
    this.detritusPoints = new THREE.Points(detGeom, detMat);
    this.detritusPoints.frustumCulled = false;
    this.detritusPoints.renderOrder = 32;
    this.scene.add(this.detritusPoints);

    // Fine sand/silt dust clouds kicked up gently when fish swim near or touch the sandbed
    const dustCount = this.maxSandDust;
    const dustPos = new Float32Array(dustCount * 3);
    const dustSizes = new Float32Array(dustCount);
    const dustAlphas = new Float32Array(dustCount);
    const dustSeeds = new Float32Array(dustCount);
    this.sandDustPool = [];
    for (let i = 0; i < dustCount; i++) {
      dustAlphas[i] = 0;
      dustSizes[i] = 0.25;
      dustSeeds[i] = Math.random() * 6.283;
      this.sandDustPool.push({
        active: false,
        x: 0,
        y: -5,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        maxAge: 2.2,
        baseSize: 0.3,
        floorY: -1.16,
      });
    }

    const dustGeom = new THREE.BufferGeometry();
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeom.setAttribute('aSize', new THREE.BufferAttribute(dustSizes, 1));
    dustGeom.setAttribute('aAlpha', new THREE.BufferAttribute(dustAlphas, 1));
    dustGeom.setAttribute('aSeed', new THREE.BufferAttribute(dustSeeds, 1));

    const dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uWaterColor: this.waterFogUniforms.uWaterColor,
        uSunColor: this.waterFogUniforms.uSunColor,
        uLightIntensity: { value: 1.0 },
      },
      vertexShader: `
attribute float aSize;
attribute float aAlpha;
attribute float aSeed;
varying float vAlpha;
varying float vSeed;
varying float vDepthFade;
void main() {
  vAlpha = aAlpha;
  vSeed = aSeed;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  float dist = max(1.0, -mvPos.z);
  vDepthFade = clamp((dist - 5.2) / 5.2, 0.0, 0.7);
  gl_PointSize = clamp(aSize * (225.0 / dist), 4.0, 34.0);
  gl_Position = projectionMatrix * mvPos;
}`,
      fragmentShader: `
uniform vec3 uWaterColor;
uniform vec3 uSunColor;
uniform float uLightIntensity;
varying float vAlpha;
varying float vSeed;
varying float vDepthFade;
void main() {
  if (vAlpha <= 0.002) discard;
  vec2 p = gl_PointCoord - vec2(0.5);
  float r = length(p);
  float ang = r > 0.001 ? atan(p.y, p.x) : 0.0;
  float wisp = 0.48 + 0.05 * sin(ang * 3.0 + vSeed);
  if (r > wisp) discard;
  float softCloud = pow(max(0.0001, smoothstep(wisp, 0.04, r)), 1.32);
  vec3 sandTint = mix(vec3(0.84, 0.76, 0.61), vec3(0.70, 0.63, 0.50), fract(vSeed * 1.37));
  vec3 litSand = sandTint * mix(vec3(0.76, 0.84, 0.90), uSunColor, 0.62);
  vec3 col = mix(litSand, uWaterColor * 1.15, vDepthFade * 0.48);
  float lightMul = clamp(0.32 + uLightIntensity * 0.62, 0.14, 0.96);
  gl_FragColor = vec4(col, softCloud * vAlpha * lightMul);
}`,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    this.sandDustMat = dustMat;
    this.sandDustPoints = new THREE.Points(dustGeom, dustMat);
    this.sandDustPoints.frustumCulled = false;
    this.sandDustPoints.renderOrder = 33;
    this.scene.add(this.sandDustPoints);

    // Coarse individual kicked-up sand grains that arc up a few centimeters and fall back onto the substrate
    const grainCount = this.maxSandGrains;
    const grainPos = new Float32Array(grainCount * 3);
    const grainSizes = new Float32Array(grainCount);
    const grainAlphas = new Float32Array(grainCount);
    const grainColors = new Float32Array(grainCount * 3);
    const grainPalette = [
      new THREE.Color(0xe0cfa9),
      new THREE.Color(0xcab690),
      new THREE.Color(0xeadcc0),
      new THREE.Color(0x9e9078),
    ];
    this.sandGrainPool = [];
    for (let i = 0; i < grainCount; i++) {
      grainAlphas[i] = 0;
      grainSizes[i] = 0.22;
      const gc = grainPalette[i % grainPalette.length];
      grainColors[i * 3] = gc.r;
      grainColors[i * 3 + 1] = gc.g;
      grainColors[i * 3 + 2] = gc.b;
      this.sandGrainPool.push({
        active: false,
        x: 0,
        y: -5,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        maxAge: 1.2,
        size: 0.25,
        floorY: -1.16,
      });
    }

    const grainGeom = new THREE.BufferGeometry();
    grainGeom.setAttribute('position', new THREE.BufferAttribute(grainPos, 3));
    grainGeom.setAttribute('aSize', new THREE.BufferAttribute(grainSizes, 1));
    grainGeom.setAttribute('aAlpha', new THREE.BufferAttribute(grainAlphas, 1));
    grainGeom.setAttribute('aColor', new THREE.BufferAttribute(grainColors, 3));

    const grainMat = new THREE.ShaderMaterial({
      uniforms: {
        uWaterColor: this.waterFogUniforms.uWaterColor,
        uSunColor: this.waterFogUniforms.uSunColor,
        uLightIntensity: { value: 1.0 },
      },
      vertexShader: `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
varying float vDepthFade;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  float dist = max(1.0, -mvPos.z);
  vDepthFade = clamp((dist - 5.2) / 5.2, 0.0, 0.65);
  gl_PointSize = clamp(aSize * (78.0 / dist), 1.8, 5.2);
  gl_Position = projectionMatrix * mvPos;
}`,
      fragmentShader: `
uniform vec3 uWaterColor;
uniform vec3 uSunColor;
uniform float uLightIntensity;
varying float vAlpha;
varying vec3 vColor;
varying float vDepthFade;
void main() {
  if (vAlpha <= 0.005) discard;
  vec2 p = gl_PointCoord - vec2(0.5);
  float r = length(p);
  if (r > 0.46) discard;
  float disc = smoothstep(0.46, 0.16, r);
  vec3 litCol = vColor * mix(vec3(0.76, 0.83, 0.88), uSunColor, 0.62);
  vec3 col = mix(litCol, uWaterColor * 1.18, vDepthFade * 0.5);
  float lightMul = clamp(0.32 + uLightIntensity * 0.65, 0.16, 1.0);
  gl_FragColor = vec4(col, disc * vAlpha * lightMul);
}`,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    this.sandGrainsMat = grainMat;
    this.sandGrainsPoints = new THREE.Points(grainGeom, grainMat);
    this.sandGrainsPoints.frustumCulled = false;
    this.sandGrainsPoints.renderOrder = 34;
    this.scene.add(this.sandGrainsPoints);
  }

  private handleVisibilityOrHide = (): void => {
    if (document.visibilityState === 'hidden') {
      this.applyWallClockHunger();
      this.saveState();
    } else {
      this.applyWallClockHunger();
    }
  };

  private applyWallClockHunger(): void {
    const now = Date.now();
    const wallDt = Math.max(0, (now - this.lastWallTimeMs) / 1000);
    this.lastWallTimeMs = now;
    if (wallDt <= 0) return;
    const decay = wallDt * HUNGER_DECAY_PER_SEC;
    for (const f of this.fishList) {
      f.satiety = Math.max(MIN_SATIETY, f.satiety - decay);
    }
  }

  private saveState(): void {
    if (!this.hasLoadedState) return;
    try {
      const payload: SavedAquariumV1 = {
        version: 1,
        savedAt: Date.now(),
        nextSeed: this.nextSeed,
        nextExtraSpeciesIdx: this.nextExtraSpeciesIdx,
        lighting: this.targetLighting,
        fish: this.fishList.map((f) => ({
          species: f.species,
          baseScale: f.baseScale,
          satiety: Number(f.satiety.toFixed(4)),
        })),
        plants: this.plantList.map((p) => ({
          x: Number(p.x.toFixed(3)),
          z: Number(p.z.toFixed(3)),
          style: p.style,
          scale: Number(p.scale.toFixed(3)),
          seed: p.seed,
        })),
        stones: this.stoneList.map((s) => ({
          x: Number(s.x.toFixed(3)),
          y: Number(s.y.toFixed(3)),
          z: Number(s.z.toFixed(3)),
          scale: Number(s.scale.toFixed(3)),
          rotY: Number(s.rotY.toFixed(3)),
          seed: s.seed,
        })),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota or private-mode errors
    }
  }

  private loadSavedState(): SavedAquariumV1 | null {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SavedAquariumV1>;
      if (
        !parsed ||
        parsed.version !== 1 ||
        !Array.isArray(parsed.fish) ||
        !Array.isArray(parsed.plants) ||
        !Array.isArray(parsed.stones)
      ) {
        return null;
      }
      return parsed as SavedAquariumV1;
    } catch {
      return null;
    }
  }

  private async initAssetsAndPopulate(): Promise<void> {
    try {
      const [sprites, photoTextures] = await Promise.all([
        loadAquariumSprites(),
        loadAquariumPhotoTextures(this.maxAnisotropy),
      ]);
      if (this.disposed) {
        disposeAquariumPhotoTextures(photoTextures);
        return;
      }
      this.sprites = sprites;
      this.photoTextures = photoTextures;

      this.tank = createAquariumTank3D(photoTextures, this.isSoftwareGl, this.waterFogUniforms);
      this.scene.add(this.tank.group);

      const saved = this.loadSavedState();
      if (saved && saved.fish.length > 0) {
        this.restoreFromSavedState(saved);
      } else {
        this.populateInitialScene();
      }
      this.spawnAmbientBottomBubbles(true);
      this.spawnAirstoneBubbles(true);
      this.hasLoadedState = true;
      this.saveState();

      if (!this.isSoftwareGl) {
        try {
          this.renderer.compile(this.scene, this.camera);
        } catch (compileErr) {
          console.warn('Precompilación de shaders omitida:', compileErr);
        }
      }
    } catch (err) {
      console.error('Error inicializando la escena 3D:', err);
    }
  }

  private restoreFromSavedState(saved: SavedAquariumV1): void {
    this.nextSeed =
      typeof saved.nextSeed === 'number' && Number.isFinite(saved.nextSeed)
        ? saved.nextSeed
        : 101;
    this.nextExtraSpeciesIdx =
      typeof saved.nextExtraSpeciesIdx === 'number' && Number.isFinite(saved.nextExtraSpeciesIdx)
        ? saved.nextExtraSpeciesIdx
        : 0;

    if (
      saved.lighting &&
      typeof saved.lighting.preset === 'string' &&
      Object.prototype.hasOwnProperty.call(LIGHTING_PRESETS, saved.lighting.preset)
    ) {
      const rawInt =
        typeof saved.lighting.intensity === 'number' && Number.isFinite(saved.lighting.intensity)
          ? saved.lighting.intensity
          : 1.0;
      this.targetLighting = {
        preset: saved.lighting.preset,
        intensity: THREE.MathUtils.clamp(rawInt, 0.15, 1.6),
      };
      this.callbacks.onLightingLoaded?.(this.targetLighting);
    }

    for (const p of saved.plants) {
      if (!p || typeof p !== 'object') continue;
      this.spawnPlantInternal({
        x: typeof p.x === 'number' && Number.isFinite(p.x) ? p.x : undefined,
        z: typeof p.z === 'number' && Number.isFinite(p.z) ? p.z : undefined,
        style: p.style === 'vallisneria' || p.style === 'sword' ? p.style : undefined,
        scale:
          typeof p.scale === 'number' && Number.isFinite(p.scale)
            ? THREE.MathUtils.clamp(p.scale, 0.5, 2.0)
            : undefined,
        seed: typeof p.seed === 'number' && Number.isFinite(p.seed) ? p.seed : undefined,
      });
    }
    for (const s of saved.stones) {
      if (!s || typeof s !== 'object') continue;
      this.spawnStoneInternal({
        x: typeof s.x === 'number' && Number.isFinite(s.x) ? s.x : undefined,
        y: typeof s.y === 'number' && Number.isFinite(s.y) ? s.y : undefined,
        z: typeof s.z === 'number' && Number.isFinite(s.z) ? s.z : undefined,
        scale:
          typeof s.scale === 'number' && Number.isFinite(s.scale)
            ? THREE.MathUtils.clamp(s.scale, 0.5, 2.2)
            : undefined,
        rotY: typeof s.rotY === 'number' && Number.isFinite(s.rotY) ? s.rotY : undefined,
        seed: typeof s.seed === 'number' && Number.isFinite(s.seed) ? s.seed : undefined,
      });
    }

    const savedAt =
      typeof saved.savedAt === 'number' && Number.isFinite(saved.savedAt)
        ? saved.savedAt
        : Date.now();
    const elapsedSec = Math.max(0, (Date.now() - savedAt) / 1000);
    const offlineDecay = elapsedSec * HUNGER_DECAY_PER_SEC;

    for (const f of saved.fish) {
      if (!f || typeof f !== 'object') continue;
      const species: FishSpecies =
        f.species === 'tang' || f.species === 'goldfish' || f.species === 'clown'
          ? f.species
          : 'clown';
      const restoredSatiety = THREE.MathUtils.clamp(
        (typeof f.satiety === 'number' && Number.isFinite(f.satiety) ? f.satiety : NORMAL_SATIETY) -
          offlineDecay,
        MIN_SATIETY,
        MAX_SATIETY
      );
      const safeBaseScale =
        typeof f.baseScale === 'number' && Number.isFinite(f.baseScale)
          ? THREE.MathUtils.clamp(f.baseScale, 0.45, 1.8)
          : undefined;
      const pos = this.pickNonOverlappingFishSpawn();
      this.spawnFishInternal(species, pos.x, pos.y, pos.z, {
        baseScale: safeBaseScale,
        satiety: restoredSatiety,
      });
    }

    this.emitCounts();
  }

  private getSpeciesTextures(species: FishSpecies): SpeciesTextureSet {
    const existing = this.speciesTextures[species];
    if (existing) return existing;
    const img = this.sprites?.fishPhotos[species] ?? null;
    const created = createSpeciesTextureSet(img, species, this.maxAnisotropy);
    this.speciesTextures[species] = created;
    return created;
  }

  private populateInitialScene(): void {
    // 3 composite 3D aquatic plants seated flush on rolling 3D sand dunes
    this.spawnPlantInternal({ x: -1.72, z: -0.68, style: 'vallisneria', scale: 1.12 });
    this.spawnPlantInternal({ x: 0.35, z: -0.82, style: 'sword', scale: 1.05 });
    this.spawnPlantInternal({ x: 1.85, z: 0.25, style: 'vallisneria', scale: 1.08 });

    // 2 composite 3D river/slate rock formations on sandbed
    this.spawnStoneInternal({ x: -1.05, z: 0.35, scale: 1.05 });
    this.spawnStoneInternal({ x: 1.18, z: -0.32, scale: 1.15 });

    // 1 single hero hyperrealistic 3D Clownfish
    this.spawnFishInternal('clown', 0, 0.25, 0.22);

    this.emitCounts();
  }

  private spawnPlantInternal(opts?: {
    x?: number;
    z?: number;
    style?: PlantStyle;
    scale?: number;
    seed?: number;
  }): PlantEntity3D {
    const style: PlantStyle =
      opts?.style ?? (Math.random() > 0.45 ? 'vallisneria' : 'sword');
    const x = THREE.MathUtils.clamp(
      opts?.x ?? (Math.random() - 0.5) * (TANK_W - 1.1),
      -TANK_W * 0.5 + 0.45,
      TANK_W * 0.5 - 0.45
    );
    const z = THREE.MathUtils.clamp(
      opts?.z ?? (Math.random() - 0.5) * (TANK_D - 0.9),
      -TANK_D * 0.5 + 0.42,
      TANK_D * 0.5 - 0.42
    );
    const scale = opts?.scale ?? 0.92 + Math.random() * 0.28;
    const y = sandHeightAt(x, z) - 0.015;
    const seed = opts?.seed ?? this.nextSeed++;

    const id = genId('plant');
    const handle = createPlant3D(
      id,
      style,
      seed,
      this.photoTextures!,
      this.isSoftwareGl,
      this.waterFogUniforms
    );
    handle.group.position.set(x, y, z);
    handle.group.scale.setScalar(scale * 0.15);
    this.scene.add(handle.group);

    const entity: PlantEntity3D = {
      id,
      style,
      handle,
      x,
      y,
      z,
      scale,
      seed,
      growProgress: 0.15,
    };
    this.plantList.push(entity);
    return entity;
  }

  private spawnStoneInternal(opts?: {
    x?: number;
    y?: number;
    z?: number;
    scale?: number;
    rotY?: number;
    seed?: number;
  }): StoneEntity3D {
    const x = THREE.MathUtils.clamp(
      opts?.x ?? (Math.random() - 0.5) * (TANK_W - 1.2),
      -TANK_W * 0.5 + 0.48,
      TANK_W * 0.5 - 0.48
    );
    const z = THREE.MathUtils.clamp(
      opts?.z ?? (Math.random() - 0.5) * (TANK_D - 1.0),
      -TANK_D * 0.5 + 0.45,
      TANK_D * 0.5 - 0.45
    );
    const scale = opts?.scale ?? 0.9 + Math.random() * 0.34;
    const y = opts?.y ?? sandHeightAt(x, z) - 0.01;
    const rotY = opts?.rotY ?? Math.random() * Math.PI * 2;
    const seed = opts?.seed ?? this.nextSeed++;

    const id = genId('stone');
    const handle = createRock3D(
      id,
      seed,
      this.photoTextures!,
      this.tank!.uniforms,
      this.isSoftwareGl,
      this.waterFogUniforms
    );
    handle.group.position.set(x, y + 0.35, z);
    handle.group.rotation.y = rotY;
    handle.group.scale.setScalar(scale);
    this.scene.add(handle.group);

    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.rockShadowTex,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const shadowMesh = new THREE.Mesh(this.rockShadowGeom, shadowMat);
    shadowMesh.renderOrder = 12;
    shadowMesh.position.set(x, sandHeightAt(x, z) + 0.012, z);
    const baseDia = handle.radiusXZ * scale * 2.35;
    shadowMesh.scale.set(baseDia, 1, baseDia * 0.88);
    this.scene.add(shadowMesh);

    const entity: StoneEntity3D = {
      id,
      handle,
      shadowMesh,
      shadowMat,
      x,
      y,
      z,
      scale,
      rotY,
      seed,
      dropProgress: 0.08,
    };
    this.stoneList.push(entity);
    return entity;
  }

  private isPointInsideObstacle(x: number, y: number, z: number, margin: number): boolean {
    // Only solid stones block waypoints/spawns; fish can swim freely through soft swaying plants
    for (const s of this.stoneList) {
      const baseY = s.handle.group.position.y;
      const rockH = s.handle.height * s.scale;
      if (y < baseY - 0.08 || y > baseY + rockH + margin) continue;
      const yNorm = THREE.MathUtils.clamp((y - baseY) / Math.max(0.05, rockH), 0, 1);
      const effR =
        s.handle.radiusXZ *
        s.scale *
        0.95 *
        (yNorm > 0.35 ? 1.0 - (yNorm - 0.35) * 0.24 : 1.0);
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz < (effR + margin) * (effR + margin)) {
        return true;
      }
    }

    return false;
  }

  private pickNonOverlappingFishSpawn(): { x: number; y: number; z: number } {
    let best = {
      x: (Math.random() - 0.5) * (TANK_W * 0.55),
      y: 0.05 + Math.random() * 0.72,
      z: (Math.random() - 0.5) * (TANK_D * 0.5),
    };
    let bestScore = -1;
    for (let i = 0; i < 24; i++) {
      const cx = (Math.random() - 0.5) * (TANK_W * 0.65);
      const cy = Math.max(sandHeightAt(cx, 0) + 0.24, -0.35 + Math.random() * 1.1);
      const cz = (Math.random() - 0.5) * (TANK_D * 0.58);
      if (this.isPointInsideObstacle(cx, cy, cz, 0.34)) continue;
      let minDist = 99;
      for (const f of this.fishList) {
        const d = Math.hypot(cx - f.pos.x, cy - f.pos.y, cz - f.pos.z);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestScore) {
        bestScore = minDist;
        best = { x: cx, y: cy, z: cz };
      }
    }
    return best;
  }

  private spawnFishInternal(
    species: FishSpecies,
    x?: number,
    y?: number,
    z?: number,
    opts?: { baseScale?: number; satiety?: number }
  ): FishEntity3D {
    const id = genId('fish');
    const textures = this.getSpeciesTextures(species);
    const baseScale = opts?.baseScale ?? (species === 'clown' ? 0.88 : 0.94);
    const satiety = THREE.MathUtils.clamp(
      opts?.satiety ?? NORMAL_SATIETY,
      MIN_SATIETY,
      MAX_SATIETY
    );
    const rig = createHyperrealisticFish3D(
      id,
      species,
      textures,
      baseScale,
      this.waterFogUniforms
    );

    const startX = x ?? (Math.random() - 0.5) * (TANK_W * 0.55);
    const startY = y ?? -0.1 + Math.random() * 0.85;
    const startZ = z ?? (Math.random() - 0.5) * (TANK_D * 0.5);

    rig.root.position.set(startX, startY, startZ);
    this.scene.add(rig.root);

    const facingRight = Math.random() > 0.35;
    const yaw = facingRight ? 0.14 : Math.PI - 0.14;
    const baseSpeed = 0.54 + Math.random() * 0.18;

    const entity: FishEntity3D = {
      id,
      species,
      rig,
      pos: new THREE.Vector3(startX, startY, startZ),
      yaw,
      pitch: 0,
      roll: 0,
      speed: baseSpeed,
      baseSpeed,
      targetPos: this.pickNextFishWaypoint(startX),
      wanderTimer: 2.4 + Math.random() * 2.5,
      fleeTimer: 0,
      bobPhase: Math.random() * Math.PI * 2,
      bobFreq: 1.45 + Math.random() * 0.45,
      bobAmp: 0.032,
      swimPhase: Math.random() * Math.PI * 2,
      scullPhase: Math.random() * Math.PI * 2,
      breathPhase: Math.random() * Math.PI * 2,
      burstPhase: Math.random() * Math.PI * 2,
      swimEffort: 0.85,
      turnBendSmooth: 0,
      spawnScale: 0.08,
      baseScale,
      satiety,
      visualSatiety: satiety,
      chompTimer: 0,
      targetFoodId: null,
      dustCooldown: 0,
    };

    this.fishList.push(entity);
    return entity;
  }

  private pickNextFishWaypoint(currentX: number): THREE.Vector3 {
    const maxW = TANK_W * 0.5 - 0.65;
    const maxY = 0.96;
    const maxZ = TANK_D * 0.5 - 0.52;
    const targetSide = currentX > 0 ? -1 : 1;
    for (let attempt = 0; attempt < 16; attempt++) {
      const tx = targetSide * (0.22 + Math.random() * 0.72) * maxW;
      const tz = (Math.random() * 2 - 1) * maxZ;
      const minY = Math.max(-0.98, sandHeightAt(tx, tz) + 0.16);
      const ty = minY + Math.random() * Math.max(0.25, maxY - minY);
      if (!this.isPointInsideObstacle(tx, ty, tz, 0.34)) {
        return new THREE.Vector3(tx, ty, tz);
      }
    }
    const fallbackX = targetSide * 0.65;
    return new THREE.Vector3(fallbackX, 0.42, (Math.random() - 0.5) * 0.8);
  }

  private emitCounts(): void {
    this.callbacks.onCountsChange({
      fish: this.fishList.length,
      plants: this.plantList.length,
      stones: this.stoneList.length,
    });
  }

  private setSelection(next: SelectedDecor | null): void {
    this.selectedDecor = next;
    this.callbacks.onSelectionChange(next);
    this.updateSelectionRing();
  }

  private updateSelectionRing(): void {
    if (!this.selectedDecor) {
      this.selectionRing.visible = false;
      return;
    }
    if (this.selectedDecor.kind === 'plant') {
      const p = this.plantList.find((item) => item.id === this.selectedDecor!.id);
      if (!p) {
        this.selectionRing.visible = false;
        return;
      }
      this.selectionRing.visible = true;
      this.selectionRing.position.set(p.x, p.y + 0.03, p.z);
      this.selectionRing.scale.setScalar(p.handle.radiusXZ * p.scale * 1.12);
    } else {
      const s = this.stoneList.find((item) => item.id === this.selectedDecor!.id);
      if (!s) {
        this.selectionRing.visible = false;
        return;
      }
      this.selectionRing.visible = true;
      this.selectionRing.position.set(s.x, s.y + 0.025, s.z);
      this.selectionRing.scale.setScalar(s.handle.radiusXZ * s.scale * 1.15);
    }
  }

  public addPlant(): void {
    if (!this.editMode || !this.photoTextures) return;
    const existingX = this.plantList.map((p) => p.x);
    let bestX = (Math.random() - 0.5) * (TANK_W - 1.2);
    let bestDist = -1;
    for (let i = 0; i < 8; i++) {
      const cx = (Math.random() - 0.5) * (TANK_W - 1.1);
      let minD = 99;
      for (const ex of existingX) minD = Math.min(minD, Math.abs(cx - ex));
      if (minD > bestDist) {
        bestDist = minD;
        bestX = cx;
      }
    }
    const z = (Math.random() - 0.5) * (TANK_D - 1.0);
    const plant = this.spawnPlantInternal({ x: bestX, z });
    this.spawnBubbleBurst(plant.x, plant.y + 0.12, plant.z, 5);
    this.emitCounts();
    this.saveState();
  }

  public addStone(): void {
    if (!this.editMode || !this.photoTextures || !this.tank) return;
    const existingX = this.stoneList.map((s) => s.x);
    let bestX = (Math.random() - 0.5) * (TANK_W - 1.2);
    let bestDist = -1;
    for (let i = 0; i < 8; i++) {
      const cx = (Math.random() - 0.5) * (TANK_W - 1.2);
      let minD = 99;
      for (const ex of existingX) minD = Math.min(minD, Math.abs(cx - ex));
      if (minD > bestDist) {
        bestDist = minD;
        bestX = cx;
      }
    }
    const z = (Math.random() - 0.5) * (TANK_D - 1.0);
    const stone = this.spawnStoneInternal({ x: bestX, z });
    this.spawnBubbleBurst(stone.x, stone.y + 0.08, stone.z, 4);
    this.emitCounts();
    this.saveState();
  }

  public addFish(): void {
    if (!this.editMode) return;
    const order: FishSpecies[] = ['goldfish', 'tang', 'clown'];
    const species = order[this.nextExtraSpeciesIdx % order.length];
    this.nextExtraSpeciesIdx += 1;
    const pos = this.pickNonOverlappingFishSpawn();
    const fish = this.spawnFishInternal(species, pos.x, pos.y, pos.z);
    this.spawnBubbleBurst(fish.pos.x, fish.pos.y, fish.pos.z, 6);
    this.emitCounts();
    this.saveState();
  }

  public bringSelectedForward(): void {
    if (!this.editMode || !this.selectedDecor) return;
    const zMin = -TANK_D * 0.5 + 0.44;
    const zMax = TANK_D * 0.5 - 0.44;
    if (this.selectedDecor.kind === 'plant') {
      const p = this.plantList.find((item) => item.id === this.selectedDecor!.id);
      if (p) {
        p.z = THREE.MathUtils.clamp(p.z + 0.34, zMin, zMax);
        p.y = sandHeightAt(p.x, p.z) - 0.015;
        p.handle.group.position.set(p.x, p.y, p.z);
        this.updateSelectionRing();
        this.saveState();
      }
    } else {
      const s = this.stoneList.find((item) => item.id === this.selectedDecor!.id);
      if (s) {
        const floorOld = sandHeightAt(s.x, s.z) - 0.01;
        const heightAboveFloor = Math.max(0, s.y - floorOld);
        s.z = THREE.MathUtils.clamp(s.z + 0.34, zMin, zMax);
        s.y = sandHeightAt(s.x, s.z) - 0.01 + heightAboveFloor;
        s.handle.group.position.set(s.x, s.y, s.z);
        this.updateSelectionRing();
        this.saveState();
      }
    }
  }

  public sendSelectedBackward(): void {
    if (!this.editMode || !this.selectedDecor) return;
    const zMin = -TANK_D * 0.5 + 0.44;
    const zMax = TANK_D * 0.5 - 0.44;
    if (this.selectedDecor.kind === 'plant') {
      const p = this.plantList.find((item) => item.id === this.selectedDecor!.id);
      if (p) {
        p.z = THREE.MathUtils.clamp(p.z - 0.34, zMin, zMax);
        p.y = sandHeightAt(p.x, p.z) - 0.015;
        p.handle.group.position.set(p.x, p.y, p.z);
        this.updateSelectionRing();
        this.saveState();
      }
    } else {
      const s = this.stoneList.find((item) => item.id === this.selectedDecor!.id);
      if (s) {
        const floorOld = sandHeightAt(s.x, s.z) - 0.01;
        const heightAboveFloor = Math.max(0, s.y - floorOld);
        s.z = THREE.MathUtils.clamp(s.z - 0.34, zMin, zMax);
        s.y = sandHeightAt(s.x, s.z) - 0.01 + heightAboveFloor;
        s.handle.group.position.set(s.x, s.y, s.z);
        this.updateSelectionRing();
        this.saveState();
      }
    }
  }

  public clearSelection(): void {
    this.setSelection(null);
  }

  public reset(): void {
    if (!this.photoTextures || !this.tank) return;
    this.setSelection(null);
    this.nextSeed = 101;
    this.nextExtraSpeciesIdx = 0;

    for (const f of this.fishList) {
      this.scene.remove(f.rig.root);
      f.rig.skeleton.dispose();
      for (const g of f.rig.geometries) g.dispose();
      for (const m of f.rig.materials) m.dispose();
    }
    this.fishList = [];

    for (const p of this.plantList) {
      this.scene.remove(p.handle.group);
      for (const g of p.handle.geometries) g.dispose();
      for (const m of p.handle.materials) m.dispose();
    }
    this.plantList = [];

    for (const s of this.stoneList) {
      this.scene.remove(s.handle.group);
      this.scene.remove(s.shadowMesh);
      s.shadowMat.dispose();
      for (const g of s.handle.geometries) g.dispose();
      for (const m of s.handle.materials) m.dispose();
    }
    this.stoneList = [];

    this.targetLighting = { preset: 'day', intensity: 1.0 };
    for (const food of this.foods) {
      food.active = false;
      food.mesh.visible = false;
    }
    for (const bubble of this.bubbles) {
      bubble.active = false;
      bubble.mesh.visible = false;
    }
    for (const d of this.sandDustPool) {
      d.active = false;
      d.age = 0;
    }
    for (const g of this.sandGrainPool) {
      g.active = false;
      g.age = 0;
    }
    this.ambientBubbleTimer = 0.25;
    this.airstoneTimer = 0.08;
    this.populateInitialScene();
    this.spawnAmbientBottomBubbles(true);
    this.spawnAirstoneBubbles(true);
    this.resetCamera();
    this.saveState();
  }

  private spawnDetritusBurst(x: number, y: number, z: number, count: number): void {
    if (!this.detritusPoints) return;
    const posAttr = this.detritusPoints.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const mMaxX = TANK_W * 0.5 - 0.25;
    const mMaxZ = TANK_D * 0.5 - 0.25;

    for (let i = 0; i < count; i++) {
      const idx = this.detritusCrumbCursor % this.detritusCount;
      this.detritusCrumbCursor = (this.detritusCrumbCursor + 1) % this.detritusCount;
      const ix = idx * 3;
      arr[ix] = THREE.MathUtils.clamp(x + (Math.random() - 0.5) * 0.14, -mMaxX, mMaxX);
      arr[ix + 1] = THREE.MathUtils.clamp(
        y + (Math.random() - 0.5) * 0.10,
        sandHeightAt(x, z) + 0.03,
        TANK_WATER_TOP_Y - 0.08
      );
      arr[ix + 2] = THREE.MathUtils.clamp(z + (Math.random() - 0.5) * 0.14, -mMaxZ, mMaxZ);
    }
    posAttr.needsUpdate = true;
  }

  private spawnSandDust(
    x: number,
    z: number,
    intensity: number,
    kickX = 0,
    kickZ = 0
  ): void {
    const dustCount = intensity > 0.72 ? 6 : intensity > 0.38 ? 4 : 3;
    const grainCount = intensity > 0.72 ? 7 : intensity > 0.38 ? 5 : 3;
    const mMaxX = TANK_W * 0.5 - 0.12;
    const mMaxZ = TANK_D * 0.5 - 0.12;

    for (let n = 0; n < dustCount; n++) {
      let slot = this.sandDustPool.find((d) => !d.active);
      if (!slot) {
        let oldest = this.sandDustPool[0];
        for (let k = 1; k < this.sandDustPool.length; k++) {
          if (this.sandDustPool[k].age > oldest.age) oldest = this.sandDustPool[k];
        }
        slot = oldest;
      }

      const px = THREE.MathUtils.clamp(x + (Math.random() - 0.5) * 0.18, -mMaxX, mMaxX);
      const pz = THREE.MathUtils.clamp(z + (Math.random() - 0.5) * 0.18, -mMaxZ, mMaxZ);
      const floorY = sandHeightAt(px, pz);
      const angle = Math.random() * Math.PI * 2;
      const radialSpeed = (0.06 + Math.random() * 0.14) * (0.7 + intensity * 0.6);

      slot.active = true;
      slot.x = px;
      slot.y = floorY + 0.018 + Math.random() * 0.028;
      slot.z = pz;
      slot.vx = Math.cos(angle) * radialSpeed + kickX * 0.18;
      slot.vy = (0.14 + Math.random() * 0.18) * (0.75 + intensity * 0.55);
      slot.vz = Math.sin(angle) * radialSpeed + kickZ * 0.18;
      slot.age = 0;
      slot.maxAge = 2.2 + Math.random() * 1.35;
      slot.baseSize = (0.36 + Math.random() * 0.38) * (0.9 + intensity * 0.35);
      slot.floorY = floorY + 0.01;
    }

    for (let n = 0; n < grainCount; n++) {
      let gSlot = this.sandGrainPool.find((g) => !g.active);
      if (!gSlot) {
        let oldest = this.sandGrainPool[0];
        for (let k = 1; k < this.sandGrainPool.length; k++) {
          if (this.sandGrainPool[k].age > oldest.age) oldest = this.sandGrainPool[k];
        }
        gSlot = oldest;
      }

      const px = THREE.MathUtils.clamp(x + (Math.random() - 0.5) * 0.15, -mMaxX, mMaxX);
      const pz = THREE.MathUtils.clamp(z + (Math.random() - 0.5) * 0.15, -mMaxZ, mMaxZ);
      const floorY = sandHeightAt(px, pz);
      const angle = Math.random() * Math.PI * 2;
      const radialSpeed = (0.08 + Math.random() * 0.18) * (0.7 + intensity * 0.6);

      gSlot.active = true;
      gSlot.x = px;
      gSlot.y = floorY + 0.012;
      gSlot.z = pz;
      gSlot.vx = Math.cos(angle) * radialSpeed + kickX * 0.22;
      gSlot.vy = (0.24 + Math.random() * 0.26) * (0.75 + intensity * 0.55);
      gSlot.vz = Math.sin(angle) * radialSpeed + kickZ * 0.22;
      gSlot.age = 0;
      gSlot.maxAge = 1.05 + Math.random() * 0.65;
      gSlot.size = 0.18 + Math.random() * 0.22;
      gSlot.floorY = floorY + 0.008;
    }
  }

  private enforceFishAboveSand(
    f: FishEntity3D,
    bobY: number,
    sc: number,
    cond: { sx: number; sy: number; sz: number },
    maxY: number
  ): { minClearance: number; contactX: number; contactZ: number } {
    const cosP = Math.cos(f.pitch);
    const fx = Math.cos(f.yaw) * cosP;
    const fy = Math.sin(f.pitch);
    const fz = -Math.sin(f.yaw) * cosP;

    // Check snout, ventral belly/pelvic fins, and caudal tail tip against local sand dune height
    const checks: [number, number][] = [
      [0.44 * sc * cond.sx, 0.13 * sc * cond.sy],
      [-0.05 * sc * cond.sx, 0.24 * sc * cond.sy],
      [-0.74 * sc * cond.sx, 0.18 * sc * cond.sy],
    ];

    let maxDeficit = 0;
    let minClearance = 99;
    let contactX = f.pos.x;
    let contactZ = f.pos.z;

    for (let i = 0; i < checks.length; i++) {
      const off = checks[i][0];
      const vClear = checks[i][1];
      const ptX = f.pos.x + fx * off;
      const ptZ = f.pos.z + fz * off;
      const ptBottomY = f.pos.y + bobY + fy * off - vClear;
      const sandY = sandHeightAt(ptX, ptZ);
      const clearance = ptBottomY - sandY;
      if (clearance < minClearance) {
        minClearance = clearance;
        contactX = ptX;
        contactZ = ptZ;
      }
      const deficit = 0.015 - clearance;
      if (deficit > maxDeficit) {
        maxDeficit = deficit;
      }
    }

    if (maxDeficit > 0) {
      f.pos.y = Math.min(maxY, f.pos.y + maxDeficit);
      if (f.pitch < -0.02) {
        f.pitch *= 0.72;
      }
      minClearance = Math.max(0.015, minClearance + maxDeficit);
    }

    return { minClearance, contactX, contactZ };
  }

  private accumulateObstacleAvoidance(
    pos: THREE.Vector3,
    fwd: THREE.Vector3,
    fishRad: number,
    outSteer: THREE.Vector3
  ): boolean {
    let nearObstacle = false;
    const lookDist = 0.48 + fishRad * 1.2;
    _probePos.copy(pos).addScaledVector(fwd, lookDist);

    // Avoid rigid stones; soft swaying plants are intentionally swim-through
    for (const s of this.stoneList) {
      const baseY = s.handle.group.position.y;
      const obsH = s.handle.height * s.scale;
      const obsR = s.handle.radiusXZ * s.scale * 0.95;

      for (let pass = 0; pass < 2; pass++) {
        const pt = pass === 0 ? pos : _probePos;
        const margin = fishRad + (pass === 0 ? 0.34 : 0.42);
        if (pt.y < baseY - 0.08 || pt.y > baseY + obsH + margin) continue;
        const yNorm = THREE.MathUtils.clamp((pt.y - baseY) / Math.max(0.05, obsH), 0, 1);
        const taper = yNorm > 0.35 ? 1.0 - (yNorm - 0.35) * 0.24 : 1.0;
        const effR = obsR * taper;
        const safeR = effR + margin;
        const dx = pt.x - s.x;
        const dz = pt.z - s.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < safeR * safeR) {
          nearObstacle = true;
          const dist = Math.sqrt(distSq);
          const w = Math.pow((safeR - dist) / safeR, 1.15) * (pass === 0 ? 1.35 : 0.95);
          if (dist > 1e-4) {
            const nx = dx / dist;
            const nz = dz / dist;
            const swirlSign = fwd.x * nz - fwd.z * nx >= 0 ? 1 : -1;
            outSteer.x += (nx - nz * swirlSign * 0.65) * w;
            outSteer.z += (nz + nx * swirlSign * 0.65) * w;
          } else {
            outSteer.x += 0.9 * w;
            outSteer.z += 0.6 * w;
          }
          if (yNorm > 0.65) {
            outSteer.y += w * 0.72;
          }
        }
      }
    }

    return nearObstacle;
  }

  private resolveFishObstacleCollisions(
    f: FishEntity3D,
    fishRad: number,
    halfLen: number,
    maxW: number,
    minY: number,
    maxY: number,
    maxZ: number
  ): void {
    const cosP = Math.cos(f.pitch);
    const fx = Math.cos(f.yaw) * cosP;
    const fy = Math.sin(f.pitch);
    const fz = -Math.sin(f.yaw) * cosP;
    const spineOffsets = [-halfLen * 1.05, 0, halfLen * 0.95];

    // Strict collision against rigid stones only (fish weave freely between soft plant leaves)
    for (const s of this.stoneList) {
      const baseY = s.handle.group.position.y;
      const obsH = s.handle.height * s.scale;
      const obsR = s.handle.radiusXZ * s.scale * 0.95;

      for (let k = 0; k < spineOffsets.length; k++) {
        const off = spineOffsets[k];
        const ptX = f.pos.x + fx * off;
        const ptY = f.pos.y + fy * off;
        const ptZ = f.pos.z + fz * off;

        const topCapY = baseY + obsH + fishRad * 0.85;
        if (ptY < baseY - 0.05 || ptY >= topCapY) continue;

        const yNorm = THREE.MathUtils.clamp((ptY - baseY) / Math.max(0.05, obsH), 0, 1);
        const taper = yNorm > 0.35 ? 1.0 - (yNorm - 0.35) * 0.24 : 1.0;
        const effR = obsR * taper;
        const minR = effR + fishRad;

        const dx = ptX - s.x;
        const dz = ptZ - s.z;
        const dXZ = Math.hypot(dx, dz);
        if (dXZ >= minR) continue;

        const radialPen = minR - dXZ;
        const topPen = topCapY - ptY;

        if (yNorm > 0.72 && topPen < radialPen * 1.15) {
          f.pos.y += topPen + 0.005;
        } else {
          let nx = 1;
          let nz = 0;
          if (dXZ > 1e-4) {
            nx = dx / dXZ;
            nz = dz / dXZ;
          } else {
            nx = Math.cos(f.yaw + Math.PI * 0.5);
            nz = -Math.sin(f.yaw + Math.PI * 0.5);
          }
          f.pos.x += nx * (radialPen + 0.004);
          f.pos.z += nz * (radialPen + 0.004);

          const inward = fx * nx + fz * nz;
          if (inward < 0) {
            const tx = fx - nx * inward;
            const tz = fz - nz * inward;
            if (tx * tx + tz * tz > 1e-4) {
              const tangentYaw = Math.atan2(-tz, tx);
              const diff = wrapAngle(tangentYaw - f.yaw);
              f.yaw = wrapAngle(f.yaw + diff * 0.28);
            }
          }
        }

        f.pos.x = THREE.MathUtils.clamp(f.pos.x, -maxW, maxW);
        f.pos.y = THREE.MathUtils.clamp(
          f.pos.y,
          Math.max(minY, sandHeightAt(f.pos.x, f.pos.z) + 0.22),
          maxY
        );
        f.pos.z = THREE.MathUtils.clamp(f.pos.z, -maxZ, maxZ);
      }
    }
  }

  public dropFood(): void {
    const centerX = (Math.random() - 0.5) * (TANK_W - 2.1);
    const centerZ = (Math.random() - 0.5) * (TANK_D - 1.3);
    const count = 7;

    for (let i = 0; i < count; i++) {
      let slot = this.foods.find((fd) => !fd.active);
      if (!slot) {
        if (this.foods.length >= 48) {
          slot = this.foods.shift()!;
          this.foods.push(slot);
        } else {
          const mat = this.foodMats[this.foods.length % this.foodMats.length];
          const mesh = new THREE.Mesh(this.foodGeom, mat);
          mesh.castShadow = !this.isSoftwareGl;
          this.scene.add(mesh);
          slot = {
            id: genId('food'),
            active: false,
            inWater: false,
            settled: false,
            pos: new THREE.Vector3(),
            vel: new THREE.Vector3(),
            rotSpeed: new THREE.Vector3(),
            baseScale: new THREE.Vector3(1, 1, 1),
            ageOnSand: 0,
            swayPhase: 0,
            mesh,
          };
          this.foods.push(slot);
        }
      }

      const px = THREE.MathUtils.clamp(
        centerX + (Math.random() - 0.5) * 0.9,
        -TANK_W * 0.5 + 0.45,
        TANK_W * 0.5 - 0.45
      );
      const pz = THREE.MathUtils.clamp(
        centerZ + (Math.random() - 0.5) * 0.7,
        -TANK_D * 0.5 + 0.42,
        TANK_D * 0.5 - 0.42
      );
      const py = TANK_WATER_TOP_Y + 0.14 + Math.random() * 0.22;

      slot.active = true;
      slot.inWater = false;
      slot.settled = false;
      slot.ageOnSand = 0;
      slot.swayPhase = Math.random() * Math.PI * 2;
      slot.pos.set(px, py, pz);
      slot.vel.set(
        (Math.random() - 0.5) * 0.28,
        -(0.72 + Math.random() * 0.36),
        (Math.random() - 0.5) * 0.24
      );
      slot.rotSpeed.set(
        (Math.random() - 0.5) * 3.2,
        (Math.random() - 0.5) * 3.2,
        (Math.random() - 0.5) * 3.2
      );
      slot.baseScale.set(
        0.85 + Math.random() * 0.55,
        0.48 + Math.random() * 0.38,
        0.85 + Math.random() * 0.55
      );

      slot.mesh.visible = true;
      slot.mesh.position.copy(slot.pos);
      slot.mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      slot.mesh.scale.copy(slot.baseScale);
    }

    // Alert fish immediately to notice the new food drop
    for (const f of this.fishList) {
      if (f.fleeTimer <= 0) {
        f.wanderTimer = 0;
      }
    }
  }

  private acquireBubbleSlot(): BubbleEntity3D {
    let slot = this.bubbles.find((b) => !b.active);
    if (!slot) {
      if (this.bubbles.length >= 128) {
        slot = this.bubbles.shift()!;
        this.bubbles.push(slot);
      } else {
        const mesh = new THREE.Mesh(this.bubbleGeom, this.bubbleMat);
        this.scene.add(mesh);
        slot = {
          active: false,
          pos: new THREE.Vector3(),
          vx: 0,
          vy: 0.5,
          vz: 0,
          wobblePhase: 0,
          wobbleSpeed: 3.2,
          wobbleAmp: 0.04,
          driftPhase: 0,
          driftSpeed: 1.8,
          squashPhase: 0,
          squashSpeed: 6.5,
          squashAmp: 0.12,
          flatness: 0.8,
          xzRatio: 1.0,
          yaw: 0,
          radius: 0.018,
          mesh,
        };
        this.bubbles.push(slot);
      }
    }
    return slot;
  }

  private sampleBubbleRadius(mode: 'mixed' | 'micro' | 'burst'): number {
    if (mode === 'micro') {
      return 0.0028 + Math.random() * 0.0042;
    }
    if (mode === 'burst') {
      return 0.004 + Math.pow(Math.random(), 1.8) * 0.017;
    }
    const r = Math.random();
    if (r < 0.52) return 0.003 + Math.random() * 0.0045; // micro-fizz
    if (r < 0.88) return 0.008 + Math.random() * 0.009; // medium oblate
    return 0.017 + Math.random() * 0.011; // larger wobbling cap
  }

  private configureBubble(
    slot: BubbleEntity3D,
    x: number,
    y: number,
    z: number,
    radius: number
  ): void {
    const sizeNorm = THREE.MathUtils.clamp((radius - 0.005) / 0.038, 0, 1);
    slot.active = true;
    slot.pos.set(x, y, z);
    slot.vx = (Math.random() - 0.5) * 0.14;
    slot.vy = 0.21 + Math.sqrt(radius) * 3.15 + Math.random() * 0.14;
    slot.vz = (Math.random() - 0.5) * 0.14;
    slot.wobblePhase = Math.random() * Math.PI * 2;
    slot.wobbleSpeed = 2.4 + Math.random() * 3.1;
    slot.wobbleAmp = (0.045 + sizeNorm * 0.095) * (0.7 + Math.random() * 0.6);
    slot.driftPhase = Math.random() * Math.PI * 2;
    slot.driftSpeed = 1.1 + Math.random() * 2.1;
    slot.squashPhase = Math.random() * Math.PI * 2;
    slot.squashSpeed = 5.2 + Math.random() * 5.0;
    slot.squashAmp = 0.07 + sizeNorm * 0.16;
    slot.flatness = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(0.93, 0.54, Math.pow(sizeNorm, 0.75)) +
        (Math.random() - 0.5) * 0.08,
      0.48,
      0.98
    );
    slot.xzRatio = 0.85 + Math.random() * 0.30;
    slot.yaw = Math.random() * Math.PI * 2;
    slot.radius = radius;

    slot.mesh.visible = true;
    slot.mesh.position.copy(slot.pos);
    slot.mesh.rotation.set(0, slot.yaw, 0);
    slot.mesh.scale.set(
      radius * slot.xzRatio,
      radius * slot.flatness,
      radius / slot.xzRatio
    );
  }

  private spawnBubbleBurst(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const slot = this.acquireBubbleSlot();
      const radius = this.sampleBubbleRadius('burst');
      this.configureBubble(
        slot,
        x + (Math.random() - 0.5) * 0.20,
        y + (Math.random() - 0.5) * 0.14,
        z + (Math.random() - 0.5) * 0.20,
        radius
      );
    }
  }

  private spawnAmbientBottomBubbles(initialSeed = false): void {
    const maxX = TANK_W * 0.5 - 0.36;
    const maxZ = TANK_D * 0.5 - 0.34;

    if (initialSeed) {
      const seedCount = 18;
      for (let i = 0; i < seedCount; i++) {
        const bx = (Math.random() - 0.5) * 2 * maxX;
        const bz = (Math.random() - 0.5) * 2 * maxZ;
        const floorY = sandHeightAt(bx, bz) + 0.06;
        const by = THREE.MathUtils.lerp(floorY, TANK_WATER_TOP_Y - 0.14, Math.random());
        const radius = this.sampleBubbleRadius('mixed');
        const slot = this.acquireBubbleSlot();
        this.configureBubble(slot, bx, by, bz, radius);
      }
      return;
    }

    let originX = (Math.random() - 0.5) * 2 * maxX;
    let originZ = (Math.random() - 0.5) * 2 * maxZ;

    // Frequently release bubbles from gravel pockets near rocks or plants
    const decorCount = this.stoneList.length + this.plantList.length;
    if (decorCount > 0 && Math.random() < 0.42) {
      const idx = Math.floor(Math.random() * decorCount);
      if (idx < this.stoneList.length) {
        const st = this.stoneList[idx];
        const ang = Math.random() * Math.PI * 2;
        const rad = st.handle.radiusXZ * st.scale * (0.45 + Math.random() * 0.45);
        originX = THREE.MathUtils.clamp(st.x + Math.cos(ang) * rad, -maxX, maxX);
        originZ = THREE.MathUtils.clamp(st.z + Math.sin(ang) * rad, -maxZ, maxZ);
      } else {
        const pl = this.plantList[idx - this.stoneList.length];
        const ang = Math.random() * Math.PI * 2;
        const rad = 0.08 + Math.random() * 0.16;
        originX = THREE.MathUtils.clamp(pl.x + Math.cos(ang) * rad, -maxX, maxX);
        originZ = THREE.MathUtils.clamp(pl.z + Math.sin(ang) * rad, -maxZ, maxZ);
      }
    }

    const roll = Math.random();
    if (roll < 0.24) {
      // Micro-fizz plume: 3 to 5 tiny erratic bubbles
      const fizzCount = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < fizzCount; i++) {
        const bx = THREE.MathUtils.clamp(originX + (Math.random() - 0.5) * 0.16, -maxX, maxX);
        const bz = THREE.MathUtils.clamp(originZ + (Math.random() - 0.5) * 0.16, -maxZ, maxZ);
        const by = sandHeightAt(bx, bz) + 0.015 + Math.random() * 0.05;
        this.configureBubble(
          this.acquireBubbleSlot(),
          bx,
          by,
          bz,
          this.sampleBubbleRadius('micro')
        );
      }
    } else {
      const clusterCount = roll < 0.56 ? 1 : roll < 0.86 ? 2 : 3;
      for (let i = 0; i < clusterCount; i++) {
        const bx = THREE.MathUtils.clamp(originX + (Math.random() - 0.5) * 0.18, -maxX, maxX);
        const bz = THREE.MathUtils.clamp(originZ + (Math.random() - 0.5) * 0.18, -maxZ, maxZ);
        const by = sandHeightAt(bx, bz) + 0.02 + Math.random() * 0.04;
        const radius = i === 0 ? this.sampleBubbleRadius('mixed') : this.sampleBubbleRadius('micro');
        this.configureBubble(this.acquireBubbleSlot(), bx, by, bz, radius);
      }
    }
  }

  private triggerWaterSurfaceInteraction(
    x: number,
    y: number,
    z: number,
    strength = 0.75
  ): void {
    // Only disturb the actual water surface mesh (never floating mid-water rings)
    if (y >= TANK_WATER_TOP_Y - 0.65) {
      this.tank?.triggerSurfaceWave(x, z, strength);
    }
  }

  private spawnAirstoneBubbles(initialSeed = false): void {
    if (!this.tank) return;
    const src = this.tank.airstoneTop;

    if (initialSeed) {
      for (let i = 0; i < 14; i++) {
        const frac = Math.random();
        const by = THREE.MathUtils.lerp(src.y, TANK_WATER_TOP_Y - 0.1, frac);
        const spread = 0.035 + frac * 0.12;
        const bx = src.x + (Math.random() - 0.5) * spread - frac * 0.06;
        const bz = src.z + (Math.random() - 0.5) * spread + frac * 0.06;
        const radius =
          Math.random() < 0.72
            ? this.sampleBubbleRadius('micro')
            : 0.011 + Math.random() * 0.012;
        this.configureBubble(this.acquireBubbleSlot(), bx, by, bz, radius);
      }
      return;
    }

    const count = Math.random() < 0.55 ? 2 : 3;
    for (let i = 0; i < count; i++) {
      const bx = src.x + (Math.random() - 0.5) * 0.07;
      const by = src.y + Math.random() * 0.025;
      const bz = src.z + (Math.random() - 0.5) * 0.07;
      const radius =
        Math.random() < 0.76
          ? this.sampleBubbleRadius('micro')
          : 0.011 + Math.random() * 0.013;
      this.configureBubble(this.acquireBubbleSlot(), bx, by, bz, radius);
    }
  }

  private updatePointerNDC(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    _vec2.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    _vec2.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.updatePointerNDC(e.clientX, e.clientY);
    _raycaster.setFromCamera(_vec2, this.camera);

    const candidateObjects: THREE.Object3D[] = this.editMode
      ? [
          ...this.fishList.map((f) => f.rig.root),
          ...this.stoneList.map((s) => s.handle.group),
          ...this.plantList.map((p) => p.handle.group),
        ]
      : this.fishList.map((f) => f.rig.root);

    const hits = _raycaster.intersectObjects(candidateObjects, true);
    if (hits.length > 0) {
      const topHit = hits[0];
      const fishId = topHit.object.userData.fishId as string | undefined;
      if (fishId) {
        const fish = this.fishList.find((f) => f.id === fishId);
        if (fish) {
          this.setSelection(null);
          this.triggerFishFlee(fish, topHit.point);
          return;
        }
      }

      if (this.editMode) {
        const decorId = topHit.object.userData.decorId as string | undefined;
        const decorKind = topHit.object.userData.decorKind as 'plant' | 'stone' | undefined;
        if (decorId && decorKind) {
          const sel: SelectedDecor = { id: decorId, kind: decorKind };
          this.setSelection(sel);

          const decorPos =
            decorKind === 'plant'
              ? this.plantList.find((p) => p.id === decorId)?.handle.group.position
              : this.stoneList.find((s) => s.id === decorId)?.handle.group.position;

          if (decorPos) {
            // Pause OrbitControls while dragging the 3D rock or 3D plant
            this.controls.enabled = false;
            this.camera.getWorldDirection(_camForward);
            _dragPlane.setFromNormalAndCoplanarPoint(_camForward, decorPos);
            _raycaster.ray.intersectPlane(_dragPlane, _hitPoint);

            this.dragState = {
              pointerId: e.pointerId,
              decor: sel,
              hasMoved: false,
              startClientX: e.clientX,
              startClientY: e.clientY,
              offsetX: decorPos.x - _hitPoint.x,
              offsetY: decorPos.y - _hitPoint.y,
              offsetZ: decorPos.z - _hitPoint.z,
            };
            try {
              this.renderer.domElement.setPointerCapture(e.pointerId);
            } catch {
              // Ignore pointer capture errors
            }
            return;
          }
        }
      }
    }

    // Track potential tap on water (vs camera orbit drag)
    this.orbitTapTracker = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const drag = this.dragState;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (
      !drag.hasMoved &&
      Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) > 4
    ) {
      drag.hasMoved = true;
    }
    if (!drag.hasMoved) return;

    this.updatePointerNDC(e.clientX, e.clientY);
    _raycaster.setFromCamera(_vec2, this.camera);

    if (!_raycaster.ray.intersectPlane(_dragPlane, _hitPoint)) return;

    const xMin = -TANK_W * 0.5 + 0.44;
    const xMax = TANK_W * 0.5 - 0.44;
    const zMin = -TANK_D * 0.5 + 0.42;
    const zMax = TANK_D * 0.5 - 0.42;

    const rawX = THREE.MathUtils.clamp(_hitPoint.x + drag.offsetX, xMin, xMax);
    const rawY = _hitPoint.y + drag.offsetY;
    const rawZ = THREE.MathUtils.clamp(_hitPoint.z + drag.offsetZ, zMin, zMax);

    if (drag.decor.kind === 'plant') {
      const plant = this.plantList.find((p) => p.id === drag.decor.id);
      if (plant) {
        plant.x = rawX;
        plant.z = rawZ;
        plant.y = sandHeightAt(rawX, rawZ) - 0.015;
        plant.handle.group.position.set(plant.x, plant.y, plant.z);
        this.updateSelectionRing();
      }
    } else {
      const stone = this.stoneList.find((s) => s.id === drag.decor.id);
      if (stone) {
        stone.x = rawX;
        stone.z = rawZ;
        const floorY = sandHeightAt(rawX, rawZ) - 0.01;
        let nextY = THREE.MathUtils.clamp(rawY, floorY, TANK_WATER_TOP_Y - 0.35);

        // Soft magnetic resting support when stacked directly above another 3D rock!
        const myRadius = stone.handle.radiusXZ * stone.scale;
        for (const other of this.stoneList) {
          if (other.id === stone.id) continue;
          const otherRadius = other.handle.radiusXZ * other.scale;
          const distXZ = Math.hypot(rawX - other.x, rawZ - other.z);
          if (distXZ < (myRadius + otherRadius) * 0.72) {
            const stackTop = other.y + other.handle.height * other.scale * 0.88;
            if (Math.abs(nextY - stackTop) < 0.14) {
              nextY = stackTop;
            }
          }
        }

        stone.y = nextY;
        stone.dropProgress = 1;
        stone.handle.group.position.set(stone.x, stone.y, stone.z);
        this.updateSelectionRing();
      }
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    const drag = this.dragState;
    if (drag && drag.pointerId === e.pointerId) {
      this.controls.enabled = true;
      if (drag.hasMoved) {
        if (drag.decor.kind === 'plant') {
          const p = this.plantList.find((item) => item.id === drag.decor.id);
          if (p) this.spawnBubbleBurst(p.x, p.y + 0.14, p.z, 3);
        } else {
          const s = this.stoneList.find((item) => item.id === drag.decor.id);
          if (s) this.spawnBubbleBurst(s.x, s.y + 0.08, s.z, 3);
        }
        this.saveState();
      }
      this.dragState = null;
      try {
        if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
          this.renderer.domElement.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore capture release errors
      }
      return;
    }

    const tap = this.orbitTapTracker;
    if (tap && tap.pointerId === e.pointerId) {
      this.orbitTapTracker = null;
      if (Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY) < 7) {
        // Quick tap on water -> clear selection & disturb water surface / release micro-bubbles
        this.setSelection(null);
        this.updatePointerNDC(e.clientX, e.clientY);
        _raycaster.setFromCamera(_vec2, this.camera);
        _vec3A.set(0, 1, 0);
        _dragPlane.set(_vec3A, -TANK_WATER_TOP_Y);
        const hitTopSurface =
          _raycaster.ray.intersectPlane(_dragPlane, _hitPoint) !== null &&
          Math.abs(_hitPoint.x) <= TANK_W * 0.48 &&
          Math.abs(_hitPoint.z) <= TANK_D * 0.48;

        if (hitTopSurface) {
          this.tank?.triggerSurfaceWave(_hitPoint.x, _hitPoint.z, 1.05);
          this.spawnBubbleBurst(
            THREE.MathUtils.clamp(_hitPoint.x, -TANK_W * 0.44, TANK_W * 0.44),
            TANK_WATER_TOP_Y - 0.08,
            THREE.MathUtils.clamp(_hitPoint.z, -TANK_D * 0.42, TANK_D * 0.42),
            2
          );
        } else {
          this.camera.getWorldDirection(_camForward);
          _dragPlane.setFromNormalAndCoplanarPoint(_camForward, this.controls.target);
          if (_raycaster.ray.intersectPlane(_dragPlane, _hitPoint)) {
            const rx = THREE.MathUtils.clamp(_hitPoint.x, -TANK_W * 0.44, TANK_W * 0.44);
            const ry = THREE.MathUtils.clamp(_hitPoint.y, -0.8, TANK_WATER_TOP_Y - 0.12);
            const rz = THREE.MathUtils.clamp(_hitPoint.z, -TANK_D * 0.42, TANK_D * 0.42);
            this.triggerWaterSurfaceInteraction(rx, _hitPoint.y, rz, 0.78);
            this.spawnBubbleBurst(rx, ry, rz, 3);
          }
        }
      }
    }
  };

  private triggerFishFlee(fish: FishEntity3D, tapPoint: THREE.Vector3): void {
    fish.fleeTimer = 1.25;
    fish.speed = fish.baseSpeed * 3.1;

    _vec3A.copy(fish.pos).sub(tapPoint);
    if (_vec3A.lengthSq() < 0.001) {
      _vec3A.set(fish.pos.x >= 0 ? -1 : 1, 0.35, 0.2);
    }
    _vec3A.normalize();

    const maxW = TANK_W * 0.5 - 0.65;
    const maxZ = TANK_D * 0.5 - 0.52;

    fish.targetPos.set(
      THREE.MathUtils.clamp(fish.pos.x + _vec3A.x * 2.1, -maxW, maxW),
      THREE.MathUtils.clamp(fish.pos.y + _vec3A.y * 1.15, -0.68, 0.96),
      THREE.MathUtils.clamp(fish.pos.z + _vec3A.z * 1.0, -maxZ, maxZ)
    );
    fish.wanderTimer = 1.5;

    this.triggerWaterSurfaceInteraction(fish.pos.x, fish.pos.y, fish.pos.z, 0.8);
    this.spawnBubbleBurst(fish.pos.x, fish.pos.y, fish.pos.z, 5);
  }

  private updateScene(rawDt: number): void {
    const dt = Number.isFinite(rawDt) && rawDt > 0 ? Math.min(0.05, rawDt) : 0.016;
    if (!Number.isFinite(this.currentIntensity)) {
      this.currentIntensity = 1.0;
    }
    if (!Number.isFinite(this.currentBeamOpacity)) {
      this.currentBeamOpacity = 0.044;
    }
    const motionScale = this.reducedMotion ? 0.25 : 1.0;
    this.elapsedTime += dt;

    // Smooth camera reset animation if triggered
    if (this.cameraGoalPos && this.cameraGoalTarget) {
      const k = 1 - Math.exp(-5.5 * dt);
      this.camera.position.lerp(this.cameraGoalPos, k);
      this.controls.target.lerp(this.cameraGoalTarget, k);
      if (this.camera.position.distanceTo(this.cameraGoalPos) < 0.02) {
        this.camera.position.copy(this.cameraGoalPos);
        this.controls.target.copy(this.cameraGoalTarget);
        this.cameraGoalPos = null;
        this.cameraGoalTarget = null;
      }
    }
    if (this.controls.enabled) {
      this.controls.update();
    }

    // 0. Smooth lighting preset & intensity interpolation
    const presetCfg =
      LIGHTING_PRESETS[this.targetLighting.preset] ?? LIGHTING_PRESETS.day;
    const targetInt = Number.isFinite(this.targetLighting.intensity)
      ? this.targetLighting.intensity
      : 1.0;
    const lk = 1 - Math.exp(-6.0 * dt);
    this.currentIntensity += (targetInt - this.currentIntensity) * lk;
    const eff = this.currentIntensity;

    this.hemiLight.color.lerp(presetCfg.hemiSky, lk);
    this.hemiLight.groundColor.lerp(presetCfg.hemiGround, lk);
    this.hemiLight.intensity += (presetCfg.hemiIntensity * eff - this.hemiLight.intensity) * lk;

    this.sunKeyLight.color.lerp(presetCfg.sunColor, lk);
    this.sunKeyLight.intensity += (presetCfg.sunIntensity * eff - this.sunKeyLight.intensity) * lk;

    this.rimLight.color.lerp(presetCfg.rimColor, lk);
    this.rimLight.intensity += (presetCfg.rimIntensity * eff - this.rimLight.intensity) * lk;

    this.sandBounceLight.color.lerp(presetCfg.bounceColor, lk);
    this.sandBounceLight.intensity +=
      (presetCfg.bounceIntensity * eff - this.sandBounceLight.intensity) * lk;

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(presetCfg.bgColor, lk);
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.lerp(presetCfg.bgColor, lk);
    }

    const targetEnv =
      presetCfg.envIntensity * THREE.MathUtils.clamp(0.42 + eff * 0.58, 0.24, 1.35);
    this.scene.environmentIntensity += (targetEnv - this.scene.environmentIntensity) * lk;

    const targetExposure = THREE.MathUtils.clamp(
      0.66 + eff * presetCfg.exposureScale * 0.42,
      0.56,
      1.38
    );
    this.renderer.toneMappingExposure += (targetExposure - this.renderer.toneMappingExposure) * lk;

    this.currentBeamOpacity += (presetCfg.beamOpacity * eff - this.currentBeamOpacity) * lk;

    const causticTarget = THREE.MathUtils.clamp(presetCfg.causticScale * eff, 0.1, 1.75);
    this.waterFogUniforms.uWaterColor.value.lerp(presetCfg.waterColor, lk);
    this.waterFogUniforms.uWaterDensity.value +=
      (presetCfg.waterDensity - this.waterFogUniforms.uWaterDensity.value) * lk;
    this.waterFogUniforms.uTime.value = this.elapsedTime;
    this.waterFogUniforms.uMotionAmp.value = motionScale;
    this.waterFogUniforms.uCausticIntensity.value = causticTarget;
    this.waterFogUniforms.uSunColor.value.copy(this.sunKeyLight.color);

    // 1. Tank water waves & sand caustics
    if (this.tank) {
      this.tank.uniforms.uTime.value = this.elapsedTime;
      this.tank.uniforms.uMotionAmp.value = motionScale;
      this.tank.uniforms.uCausticIntensity.value = causticTarget;
    }

    // 2. Dynamic wave-synced volumetric sunbeams shimmer
    for (const b of this.sunbeams) {
      b.mat.uniforms.uTime.value = this.elapsedTime;
      b.mat.uniforms.uMotionAmp.value = motionScale;
      b.mat.uniforms.uColor.value.lerp(presetCfg.beamColor, lk);
      b.mat.uniforms.uOpacity.value = Math.max(
        0.005,
        this.currentBeamOpacity + Math.sin(this.elapsedTime * 0.65 + b.phase) * 0.014 * eff
      );
    }

    // 3. 3D Plants wave sway & entrance growth
    for (const p of this.plantList) {
      p.handle.uniforms.uTime.value = this.elapsedTime;
      p.handle.uniforms.uMotionAmp.value = motionScale;
      if (p.growProgress < 1) {
        p.growProgress = Math.min(1, p.growProgress + dt * 2.5);
        p.handle.group.scale.setScalar(p.scale * (0.15 + 0.85 * p.growProgress));
      }
    }

    // 4. 3D Rocks drop settle & downward-projected floor/rock shadows
    const sunSlopeX = -2.4 / 5.8;
    const sunSlopeZ = -3.6 / 5.8;
    const lightFade = THREE.MathUtils.clamp(0.45 + eff * 0.55, 0.28, 1.0);

    for (const s of this.stoneList) {
      if (s.dropProgress < 1) {
        const prevDrop = s.dropProgress;
        s.dropProgress = Math.min(1, s.dropProgress + dt * 3.4);
        const dropOffset = (1 - s.dropProgress) * (1 - s.dropProgress) * 0.42;
        s.handle.group.position.set(s.x, s.y + dropOffset, s.z);
        if (prevDrop < 1 && s.dropProgress >= 1) {
          this.spawnSandDust(s.x, s.z, 0.95);
        }
      }

      const curRockY = s.handle.group.position.y;
      const baseFloor = sandHeightAt(s.x, s.z);
      const approxElev = Math.max(0, curRockY - baseFloor);
      const halfRockH = s.handle.height * s.scale * 0.42;
      const projDist = approxElev + (approxElev > 0.04 ? halfRockH * 0.25 : 0);

      const projX = THREE.MathUtils.clamp(
        s.x + sunSlopeX * projDist,
        -TANK_W * 0.5 + 0.22,
        TANK_W * 0.5 - 0.22
      );
      const projZ = THREE.MathUtils.clamp(
        s.z + sunSlopeZ * projDist,
        -TANK_D * 0.5 + 0.22,
        TANK_D * 0.5 - 0.22
      );

      let surfaceBelowY = sandHeightAt(projX, projZ);
      for (const other of this.stoneList) {
        if (other.id === s.id) continue;
        const otherTopY =
          other.handle.group.position.y + other.handle.height * other.scale * 0.86;
        if (otherTopY <= curRockY + 0.04) {
          const otherRadius = other.handle.radiusXZ * other.scale;
          if (Math.hypot(projX - other.x, projZ - other.z) < otherRadius * 0.92) {
            surfaceBelowY = Math.max(surfaceBelowY, otherTopY);
          }
        }
      }

      const dh = Math.max(0, curRockY - surfaceBelowY);
      const baseDia = s.handle.radiusXZ * s.scale * 2.35;
      const spread = 1 + dh * 0.45;
      s.shadowMesh.position.set(projX, surfaceBelowY + 0.012, projZ);
      s.shadowMesh.scale.set(baseDia * spread, 1, baseDia * spread * 0.88);
      s.shadowMat.opacity = (0.36 / (1 + dh * 1.35)) * lightFade;
    }

    // 4b. 3D Fish Food Flakes & Pellets dropping, sinking, and settling on sand
    for (const food of this.foods) {
      if (!food.active) continue;

      if (!food.inWater) {
        food.vel.y -= 3.2 * dt;
        food.pos.addScaledVector(food.vel, dt);
        if (food.pos.y <= TANK_WATER_TOP_Y) {
          food.inWater = true;
          food.pos.y = TANK_WATER_TOP_Y - 0.01;
          food.vel.x *= 0.28;
          food.vel.z *= 0.28;
          food.vel.y = -(0.13 + Math.random() * 0.09);
          if (Math.random() < 0.72) {
            this.tank?.triggerSurfaceWave(food.pos.x, food.pos.z, 0.68);
          }
          if (Math.random() < 0.42) {
            this.spawnBubbleBurst(food.pos.x, TANK_WATER_TOP_Y - 0.04, food.pos.z, 1);
          }
        }
        food.mesh.position.copy(food.pos);
      } else if (!food.settled) {
        const flutterX = Math.sin(this.elapsedTime * 2.4 + food.swayPhase) * 0.055;
        const flutterZ = Math.cos(this.elapsedTime * 1.9 + food.swayPhase) * 0.045;
        food.pos.x = THREE.MathUtils.clamp(
          food.pos.x + (food.vel.x + flutterX) * dt * motionScale,
          -TANK_W * 0.5 + 0.34,
          TANK_W * 0.5 - 0.34
        );
        food.pos.z = THREE.MathUtils.clamp(
          food.pos.z + (food.vel.z + flutterZ) * dt * motionScale,
          -TANK_D * 0.5 + 0.34,
          TANK_D * 0.5 - 0.34
        );
        food.vel.x *= Math.max(0, 1 - dt * 1.8);
        food.vel.z *= Math.max(0, 1 - dt * 1.8);
        food.pos.y += food.vel.y * dt * motionScale;

        food.mesh.rotation.x += food.rotSpeed.x * dt * motionScale;
        food.mesh.rotation.y += food.rotSpeed.y * dt * motionScale;
        food.mesh.rotation.z += food.rotSpeed.z * dt * motionScale;

        let floorY = sandHeightAt(food.pos.x, food.pos.z) + 0.022;
        let hitStone = false;
        for (const s of this.stoneList) {
          const rockR = s.handle.radiusXZ * s.scale * 0.78;
          if (Math.hypot(food.pos.x - s.x, food.pos.z - s.z) < rockR) {
            const rockTop = s.handle.group.position.y + s.handle.height * s.scale * 0.88 + 0.018;
            if (rockTop > floorY) {
              floorY = rockTop;
              hitStone = true;
            }
          }
        }
        if (food.pos.y <= floorY) {
          food.pos.y = floorY;
          food.settled = true;
          food.ageOnSand = 0;
          if (!hitStone) {
            this.spawnSandDust(food.pos.x, food.pos.z, 0.26);
          }
        }
        food.mesh.position.copy(food.pos);
      } else {
        food.ageOnSand += dt;
        if (food.ageOnSand > 12) {
          const fade = Math.max(0, 1 - (food.ageOnSand - 12) / 1.5);
          if (fade <= 0.01) {
            food.active = false;
            food.mesh.visible = false;
            this.spawnDetritusBurst(food.pos.x, food.pos.y + 0.03, food.pos.z, 2);
          } else {
            food.mesh.scale.copy(food.baseScale).multiplyScalar(fade);
          }
        }
      }
    }

    // 5. 3D Hyperrealistic Fish swimming, real-time hunger/size, fish & obstacle avoidance, sand dust
    this.applyWallClockHunger();
    this.saveAccumulator += dt;
    if (this.saveAccumulator >= 15) {
      this.saveAccumulator = 0;
      this.saveState();
    }

    const maxW = TANK_W * 0.5 - 0.58;
    const minY = -1.10;
    const maxY = 1.08;
    const maxZ = TANK_D * 0.5 - 0.48;
    let ateAnyFood = false;

    for (const f of this.fishList) {
      if (f.spawnScale < 1) {
        f.spawnScale = Math.min(1, f.spawnScale + dt * 2.4);
      }
      if (f.fleeTimer > 0) {
        f.fleeTimer = Math.max(0, f.fleeTimer - dt);
      }
      if (f.chompTimer > 0) {
        f.chompTimer = Math.max(0, f.chompTimer - dt);
      }
      if (f.dustCooldown > 0) {
        f.dustCooldown = Math.max(0, f.dustCooldown - dt);
      }
      f.visualSatiety += (f.satiety - f.visualSatiety) * Math.min(1, dt * 2.8);

      // Look for nearest active food when not fleeing
      let chasedFood: FoodEntity3D | null = null;
      if (f.fleeTimer <= 0) {
        let bestScore = Infinity;
        for (const food of this.foods) {
          if (!food.active) continue;
          const dx = food.pos.x - f.pos.x;
          const dy = food.pos.y - f.pos.y;
          const dz = food.pos.z - f.pos.z;
          let score = dx * dx + dy * dy + dz * dz;
          if (!food.inWater) score += 0.35;
          for (const other of this.fishList) {
            if (other.id !== f.id && other.targetFoodId === food.id) {
              score += 0.55;
            }
          }
          if (score < bestScore) {
            bestScore = score;
            chasedFood = food;
          }
        }
      }

      if (chasedFood) {
        f.targetFoodId = chasedFood.id;
        const sandMinY = sandHeightAt(chasedFood.pos.x, chasedFood.pos.z) + 0.14;
        f.targetPos.set(
          THREE.MathUtils.clamp(chasedFood.pos.x, -maxW, maxW),
          THREE.MathUtils.clamp(chasedFood.pos.y, sandMinY, TANK_WATER_TOP_Y - 0.12),
          THREE.MathUtils.clamp(chasedFood.pos.z, -maxZ, maxZ)
        );
      } else {
        f.targetFoodId = null;
      }

      f.wanderTimer -= dt;
      _vec3A.copy(f.targetPos).sub(f.pos);
      const distToTarget = _vec3A.length();

      if (!chasedFood && (f.wanderTimer <= 0 || distToTarget < 0.35)) {
        f.targetPos.copy(this.pickNextFishWaypoint(f.pos.x));
        f.wanderTimer = 2.6 + Math.random() * 2.8;
        _vec3A.copy(f.targetPos).sub(f.pos);
      }

      // Smooth predictive steering away from nearby fish AND stones/plants so they weave cleanly around obstacles
      _avoidVec.set(0, 0, 0);
      for (const other of this.fishList) {
        if (other.id === f.id) continue;
        const dx = f.pos.x - other.pos.x;
        const dy = f.pos.y - other.pos.y;
        const dz = f.pos.z - other.pos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const avoidRange = 1.05 * ((f.baseScale + other.baseScale) * 0.5) + 0.28;
        if (distSq < avoidRange * avoidRange) {
          const dist = Math.sqrt(distSq);
          const w = Math.pow((avoidRange - dist) / avoidRange, 1.35);
          if (dist > 1e-4) {
            const invD = 1 / dist;
            const nx = dx * invD;
            const ny = dy * invD;
            const nz = dz * invD;
            // Radial push + gentle lateral swirl around Y so head-on fish never deadlock
            _avoidVec.x += (nx - nz * 0.42) * w;
            _avoidVec.y += ny * w * 1.15;
            _avoidVec.z += (nz + nx * 0.42) * w;
          } else {
            _avoidVec.x += 0.8 * w;
            _avoidVec.z += 0.6 * w;
          }
        }
      }

      const condSteer = computeFishConditionScales(f.visualSatiety);
      const scSteer = f.baseScale * Math.max(0.45, f.spawnScale);
      const fishSteerRad = (0.18 * Math.max(condSteer.sy, condSteer.sz * 0.88) + 0.05) * scSteer;
      const cosPFwd = Math.cos(f.pitch);
      _vec3B.set(Math.cos(f.yaw) * cosPFwd, Math.sin(f.pitch), -Math.sin(f.yaw) * cosPFwd);
      _obsSteer.set(0, 0, 0);
      const nearObstacle = this.accumulateObstacleAvoidance(f.pos, _vec3B, fishSteerRad, _obsSteer);

      if (_avoidVec.lengthSq() > 0.0001 || _obsSteer.lengthSq() > 0.0001) {
        const fishSteerWeight = chasedFood ? 1.55 : 2.15;
        const obsSteerWeight = chasedFood ? 2.4 : 2.85;
        _vec3A
          .normalize()
          .addScaledVector(_avoidVec, fishSteerWeight)
          .addScaledVector(_obsSteer, obsSteerWeight);
      }

      const hungerDrive = f.satiety < 0.45 ? 1.14 : f.satiety > 1.15 ? 0.88 : 1.0;

      // Natural burst-and-coast (tail kick + hydrodynamic glide) cycle when cruising calmly
      f.burstPhase += dt * (0.72 + (f.baseSpeed - 0.54) * 0.5) * motionScale;
      const glideWave = 0.5 + 0.5 * Math.sin(f.burstPhase + Math.sin(f.burstPhase * 0.43) * 0.7);
      const cruiseEffort = 0.36 + 0.84 * Math.pow(glideWave, 1.35);
      const targetEffort =
        f.fleeTimer > 0
          ? 1.55 + (f.fleeTimer / 1.25) * 0.9
          : chasedFood
            ? 1.38 * hungerDrive
            : cruiseEffort * hungerDrive;
      f.swimEffort += (targetEffort - f.swimEffort) * Math.min(1, dt * (f.fleeTimer > 0 || chasedFood ? 6.5 : 3.2));

      const desiredSpeed =
        f.fleeTimer > 0
          ? f.baseSpeed * (1.25 + (f.fleeTimer / 1.25) * 1.9)
          : chasedFood
            ? f.baseSpeed * 1.88 * hungerDrive
            : f.baseSpeed * hungerDrive * (0.64 + 0.58 * f.swimEffort);
      f.speed += (desiredSpeed - f.speed) * Math.min(1, dt * (f.fleeTimer > 0 || chasedFood ? 4.4 : 2.6));

      const horizLen = Math.max(0.001, Math.hypot(_vec3A.x, _vec3A.z));
      const desiredYaw = Math.atan2(-_vec3A.z, _vec3A.x);
      const pitchCap = chasedFood ? 0.62 : 0.46;
      const desiredPitch = THREE.MathUtils.clamp(
        Math.atan2(_vec3A.y, horizLen),
        -pitchCap,
        pitchCap
      );

      // Slow, natural curved U-turn rate (livelier when dodging obstacles or snapping at food)
      const yawDiff = wrapAngle(desiredYaw - f.yaw);
      const maxYawRate = f.fleeTimer > 0 ? 3.8 : nearObstacle ? 3.4 : chasedFood ? 2.65 : 1.15;
      const yawStep = THREE.MathUtils.clamp(
        yawDiff * (nearObstacle ? 3.5 : chasedFood ? 3.0 : 2.2),
        -maxYawRate,
        maxYawRate
      );
      f.yaw = wrapAngle(f.yaw + yawStep * dt * motionScale);

      const pitchDiff = desiredPitch - f.pitch;
      f.pitch += pitchDiff * Math.min(1, dt * (nearObstacle || chasedFood ? 3.4 : 2.2)) * motionScale;

      const targetRoll = THREE.MathUtils.clamp(-yawStep * 0.28, -0.34, 0.34);
      f.roll += (targetRoll - f.roll) * Math.min(1, dt * 4.0);

      f.bobPhase += f.bobFreq * dt * motionScale;
      const bobY = Math.sin(f.bobPhase) * f.bobAmp * motionScale;

      const cosP = Math.cos(f.pitch);
      _vec3B.set(
        Math.cos(f.yaw) * cosP,
        Math.sin(f.pitch),
        -Math.sin(f.yaw) * cosP
      );
      f.pos.addScaledVector(_vec3B, f.speed * dt * motionScale);

      f.pos.x = THREE.MathUtils.clamp(f.pos.x, -maxW, maxW);
      f.pos.y = THREE.MathUtils.clamp(f.pos.y, minY, maxY);
      f.pos.z = THREE.MathUtils.clamp(f.pos.z, -maxZ, maxZ);

      // Strictly keep snout, belly/pelvic fins, and tail above the sandbed & emit visible sand + dust
      const sandCheck = this.enforceFishAboveSand(f, bobY, scSteer, condSteer, maxY);
      if (sandCheck.minClearance < 0.085 && f.speed > 0.08 && f.dustCooldown <= 0) {
        const proximity = THREE.MathUtils.clamp(1.0 - sandCheck.minClearance / 0.085, 0.25, 1.0);
        this.spawnSandDust(
          sandCheck.contactX,
          sandCheck.contactZ,
          proximity * Math.min(1.25, f.speed / Math.max(0.1, f.baseSpeed)),
          -_vec3B.x,
          -_vec3B.z
        );
        f.dustCooldown = 0.18 + (1 - proximity) * 0.22;
      }

      // Check if fish mouth reaches chased food and eats it
      if (chasedFood) {
        const cond = computeFishConditionScales(f.visualSatiety);
        const mouthReach = 0.44 * f.baseScale * cond.sx;
        const headReach = 0.25 * f.baseScale * cond.sx;
        const mouthX = f.pos.x + _vec3B.x * mouthReach;
        const mouthY = f.pos.y + _vec3B.y * mouthReach;
        const mouthZ = f.pos.z + _vec3B.z * mouthReach;
        const headX = f.pos.x + _vec3B.x * headReach;
        const headY = f.pos.y + _vec3B.y * headReach;
        const headZ = f.pos.z + _vec3B.z * headReach;

        const dMouth = Math.hypot(
          chasedFood.pos.x - mouthX,
          chasedFood.pos.y - mouthY,
          chasedFood.pos.z - mouthZ
        );
        const dHead = Math.hypot(
          chasedFood.pos.x - headX,
          chasedFood.pos.y - headY,
          chasedFood.pos.z - headZ
        );

        if (dMouth < 0.22 || dHead < 0.21) {
          chasedFood.active = false;
          chasedFood.mesh.visible = false;
          f.targetFoodId = null;
          f.chompTimer = 0.32;
          f.wanderTimer = 0.35;
          f.satiety = Math.min(MAX_SATIETY, f.satiety + FOOD_SATIETY_GAIN);
          ateAnyFood = true;
          this.spawnBubbleBurst(mouthX, mouthY, mouthZ, 2);
          this.spawnDetritusBurst(mouthX, mouthY, mouthZ, 4);
          this.triggerWaterSurfaceInteraction(
            chasedFood.pos.x,
            chasedFood.pos.y,
            chasedFood.pos.z,
            0.65
          );
        }
      }

      const chompBoost = f.chompTimer > 0 ? 1.45 : 1.0;
      const speedNorm = f.speed / Math.max(0.01, f.baseSpeed);
      // Spine wave frequency accelerates on kicks & coasts slower during glide
      f.swimPhase += dt * (3.1 + f.swimEffort * 4.6 + speedNorm * 1.4) * chompBoost * motionScale;
      // Pectoral sculling is more active during slow glides, hovering, and turns
      const scullRate = 2.6 + (1.4 - Math.min(1.1, f.swimEffort * 0.55)) * 1.6 + Math.min(1.5, Math.abs(yawStep));
      f.scullPhase += dt * scullRate * motionScale;
      f.breathPhase += dt * (2.3 + Math.min(2.2, f.swimEffort * 1.1)) * motionScale;

      const targetBend = THREE.MathUtils.clamp(-yawStep * 0.22, -0.34, 0.34);
      f.turnBendSmooth += (targetBend - f.turnBendSmooth) * Math.min(1, dt * 5.2);

      const chompRatio = f.chompTimer > 0 ? Math.sin((f.chompTimer / 0.32) * Math.PI) : 0;
      updateFishSkeleton(f.rig, this.elapsedTime, {
        swimPhase: f.swimPhase,
        scullPhase: f.scullPhase,
        breathPhase: f.breathPhase,
        effort: f.swimEffort * (f.chompTimer > 0 ? 1.2 : 1.0),
        speedNorm,
        yawRate: yawStep,
        pitchAngle: f.pitch,
        chompRatio,
        motionScale,
        turnBendSmooth: f.turnBendSmooth,
      });
    }

    if (ateAnyFood) {
      this.saveState();
    }

    // Strict 3D spine-segment collision separation: fish-to-fish AND fish-to-plants/stones
    const fishCount = this.fishList.length;
    for (let iter = 0; iter < 2; iter++) {
      if (fishCount > 1) {
        for (let i = 0; i < fishCount; i++) {
          const fa = this.fishList[i];
          const condA = computeFishConditionScales(fa.visualSatiety);
          const scA = fa.baseScale * Math.max(0.45, fa.spawnScale);
          const halfLenA = 0.45 * scA * condA.sx;
          const radA = (0.19 * Math.max(condA.sy, condA.sz * 0.88) + 0.048) * scA;

          const cosPA = Math.cos(fa.pitch);
          _fwdA.set(
            Math.cos(fa.yaw) * cosPA,
            Math.sin(fa.pitch),
            -Math.sin(fa.yaw) * cosPA
          );
          _segA0.copy(fa.pos).addScaledVector(_fwdA, -halfLenA * 1.16);
          _segA1.copy(fa.pos).addScaledVector(_fwdA, halfLenA * 0.96);

          for (let j = i + 1; j < fishCount; j++) {
            const fb = this.fishList[j];
            const condB = computeFishConditionScales(fb.visualSatiety);
            const scB = fb.baseScale * Math.max(0.45, fb.spawnScale);
            const halfLenB = 0.45 * scB * condB.sx;
            const radB = (0.19 * Math.max(condB.sy, condB.sz * 0.88) + 0.048) * scB;

            const cosPB = Math.cos(fb.pitch);
            _fwdB.set(
              Math.cos(fb.yaw) * cosPB,
              Math.sin(fb.pitch),
              -Math.sin(fb.yaw) * cosPB
            );
            _segB0.copy(fb.pos).addScaledVector(_fwdB, -halfLenB * 1.16);
            _segB1.copy(fb.pos).addScaledVector(_fwdB, halfLenB * 0.96);

            closestPointsBetweenSegments(_segA0, _segA1, _segB0, _segB1, _pA, _pB);
            _sepDiff.copy(_pA).sub(_pB);
            const dist = _sepDiff.length();
            const minSep = radA + radB;

            if (dist < minSep) {
              if (dist > 1e-4) {
                _sepDiff.divideScalar(dist);
              } else {
                const angle = (i * 2.17 + j * 1.31) % (Math.PI * 2);
                _sepDiff.set(Math.cos(angle), 0.18, Math.sin(angle)).normalize();
              }
              const push = (minSep - dist) * 0.52;
              fa.pos.addScaledVector(_sepDiff, push);
              fb.pos.addScaledVector(_sepDiff, -push);

              fa.pos.x = THREE.MathUtils.clamp(fa.pos.x, -maxW, maxW);
              fa.pos.y = THREE.MathUtils.clamp(
                fa.pos.y,
                Math.max(minY, sandHeightAt(fa.pos.x, fa.pos.z) + 0.13),
                maxY
              );
              fa.pos.z = THREE.MathUtils.clamp(fa.pos.z, -maxZ, maxZ);

              fb.pos.x = THREE.MathUtils.clamp(fb.pos.x, -maxW, maxW);
              fb.pos.y = THREE.MathUtils.clamp(
                fb.pos.y,
                Math.max(minY, sandHeightAt(fb.pos.x, fb.pos.z) + 0.13),
                maxY
              );
              fb.pos.z = THREE.MathUtils.clamp(fb.pos.z, -maxZ, maxZ);
            }
          }
        }
      }

      for (let i = 0; i < fishCount; i++) {
        const f = this.fishList[i];
        const cond = computeFishConditionScales(f.visualSatiety);
        const sc = f.baseScale * Math.max(0.45, f.spawnScale);
        const halfLen = 0.44 * sc * cond.sx;
        const fishRad = (0.18 * Math.max(cond.sy, cond.sz * 0.88) + 0.05) * sc;
        this.resolveFishObstacleCollisions(f, fishRad, halfLen, maxW, minY, maxY, maxZ);
      }
    }

    // Apply final separated transforms, strictly re-enforce sand floor clearance, and feed plant leaf pushers
    for (const f of this.fishList) {
      const bobY = Math.sin(f.bobPhase) * f.bobAmp * motionScale;
      const chompNod =
        f.chompTimer > 0 ? Math.sin((f.chompTimer / 0.32) * Math.PI * 2) * 0.12 : 0;
      const sc = f.baseScale * f.spawnScale;
      const cond = computeFishConditionScales(f.visualSatiety);

      this.enforceFishAboveSand(f, bobY, sc, cond, maxY);

      f.rig.root.position.set(f.pos.x, f.pos.y + bobY, f.pos.z);
      f.rig.root.rotation.set(f.roll, f.yaw, f.pitch + chompNod);
      f.rig.root.scale.set(sc * cond.sx, sc * cond.sy, sc * cond.sz);
    }

    // Push soft plant leaves gently aside around fish swimming inside/near each rosette (roots stay anchored)
    for (const p of this.plantList) {
      const pushers = p.handle.uniforms.uFishPushers.value;
      const grow = Math.max(0.25, p.growProgress);
      const maxReachXZ = p.handle.radiusXZ * p.scale * grow + 0.72;
      const minPlantY = p.y - 0.15;
      const maxPlantY = p.y + p.handle.height * p.scale * grow + 0.36;

      let slotIdx = 0;
      for (let i = 0; i < this.fishList.length && slotIdx < pushers.length; i++) {
        const f = this.fishList[i];
        const fy = f.rig.root.position.y;
        if (fy < minPlantY || fy > maxPlantY) continue;
        const dx = f.pos.x - p.x;
        const dz = f.pos.z - p.z;
        if (dx * dx + dz * dz > maxReachXZ * maxReachXZ) continue;
        const sc = f.baseScale * f.spawnScale;
        const cond = computeFishConditionScales(f.visualSatiety);
        const radiusStrength = 0.24 * sc * Math.max(cond.sy, cond.sz) * motionScale;
        pushers[slotIdx].set(f.pos.x, fy, f.pos.z, radiusStrength);
        slotIdx++;
      }
      while (slotIdx < pushers.length) {
        pushers[slotIdx].set(0, -99, 0, 0);
        slotIdx++;
      }
    }

    // 6. 3D Rising Bubbles (sandbed + corner airstone + circular water current + turbulence)
    this.ambientBubbleTimer -= dt * motionScale;
    if (this.ambientBubbleTimer <= 0) {
      this.spawnAmbientBottomBubbles(false);
      this.ambientBubbleTimer = 0.24 + Math.random() * 0.72;
    }

    this.airstoneTimer -= dt * motionScale;
    if (this.airstoneTimer <= 0) {
      this.spawnAirstoneBubbles(false);
      this.airstoneTimer = 0.11 + Math.random() * 0.14;
    }

    const bubbleMaxX = TANK_W * 0.5 - 0.16;
    const bubbleMaxZ = TANK_D * 0.5 - 0.16;
    const damp = Math.exp(-2.8 * dt);
    for (const b of this.bubbles) {
      if (!b.active) continue;
      const sizeNorm = THREE.MathUtils.clamp((b.radius - 0.005) / 0.038, 0, 1);
      b.vy = Math.min(1.18, b.vy + dt * (0.045 + sizeNorm * 0.075));

      b.wobblePhase += b.wobbleSpeed * dt * motionScale;
      b.driftPhase += b.driftSpeed * dt * motionScale;
      b.squashPhase += b.squashSpeed * dt * motionScale;

      // Stochastic vortex-shedding turbulence + dual incommensurate oscillations
      const turbImpulse = (0.32 + sizeNorm * 0.55) * Math.sqrt(dt);
      b.vx = b.vx * damp + (Math.random() - 0.5) * turbImpulse;
      b.vz = b.vz * damp + (Math.random() - 0.5) * turbImpulse;

      const oscX =
        Math.sin(b.wobblePhase) * b.wobbleAmp +
        Math.cos(b.driftPhase * 1.37) * b.wobbleAmp * 0.55;
      const oscZ =
        Math.cos(b.wobblePhase * 0.79) * b.wobbleAmp * 0.9 +
        Math.sin(b.driftPhase * 1.13) * b.wobbleAmp * 0.55;

      // Gentle circular filter circulation current inside the tank
      const curX = -b.pos.z * 0.036;
      const curZ = b.pos.x * 0.026;

      const stepVx = b.vx + oscX * 2.2 + curX;
      const stepVz = b.vz + oscZ * 2.0 + curZ;

      b.pos.y += b.vy * dt * motionScale;
      b.pos.x = THREE.MathUtils.clamp(
        b.pos.x + stepVx * dt * motionScale,
        -bubbleMaxX,
        bubbleMaxX
      );
      b.pos.z = THREE.MathUtils.clamp(
        b.pos.z + stepVz * dt * motionScale,
        -bubbleMaxZ,
        bubbleMaxZ
      );
      b.mesh.position.copy(b.pos);

      // Bank & flex organically along instantaneous drift direction so bubbles never look circular
      const bankZ = THREE.MathUtils.clamp(-stepVx * 1.15, -0.34, 0.34);
      const bankX = THREE.MathUtils.clamp(stepVz * 1.15, -0.34, 0.34);
      b.mesh.rotation.set(bankX, b.yaw, bankZ);

      const sq1 = Math.sin(b.squashPhase) * b.squashAmp;
      const sq2 = Math.cos(b.squashPhase * 1.63 + b.driftPhase) * b.squashAmp * 0.55;
      b.mesh.scale.set(
        b.radius * b.xzRatio * (1 + sq1 + sq2 * 0.5),
        b.radius * b.flatness * (1 - sq1 * 0.75),
        (b.radius / b.xzRatio) * (1 + sq1 * 0.45 - sq2)
      );

      if (b.pos.y > TANK_WATER_TOP_Y - 0.03) {
        if (b.radius > 0.015) {
          this.tank?.triggerSurfaceWave(
            b.pos.x,
            b.pos.z,
            THREE.MathUtils.clamp(b.radius * 18, 0.24, 0.78)
          );
        }
        b.active = false;
        b.mesh.visible = false;
      }
    }

    // 8. Suspended bokeh motes following circular filter circulation & illuminated by light shafts
    if (this.motesPoints && this.motesMat && this.motesPhases) {
      this.motesMat.uniforms.uTime.value = this.elapsedTime;
      this.motesMat.uniforms.uColor.value.lerp(presetCfg.beamColor, lk);
      this.motesMat.uniforms.uLightIntensity.value = eff;

      const posAttr = this.motesPoints.geometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const mMaxX = TANK_W * 0.5 - 0.24;
      const mMaxZ = TANK_D * 0.5 - 0.24;
      const airPos = this.tank?.airstoneTop;

      for (let i = 0; i < this.motesCount; i++) {
        const ix = i * 3;
        let mx = arr[ix];
        let my = arr[ix + 1];
        let mz = arr[ix + 2];
        const ph = this.motesPhases[i];

        // Gentle counterclockwise circular filter swirl + organic vertical eddy
        let vx = -mz * 0.048 + Math.sin(this.elapsedTime * 0.45 + ph) * 0.014;
        let vz = mx * 0.036 + Math.cos(this.elapsedTime * 0.41 + ph * 1.3) * 0.012;
        let vy = Math.sin(this.elapsedTime * 0.62 + ph * 2.1) * 0.016 - 0.004;

        if (airPos) {
          const dxAir = mx - airPos.x;
          const dzAir = mz - airPos.z;
          const d2Air = dxAir * dxAir + dzAir * dzAir;
          if (d2Air < 0.55) {
            vy += (1 - d2Air / 0.55) * 0.09;
            vx -= 0.025;
            vz += 0.025;
          }
        }

        mx += vx * dt * motionScale;
        my += vy * dt * motionScale;
        mz += vz * dt * motionScale;

        if (mx > mMaxX) mx = -mMaxX + 0.05;
        else if (mx < -mMaxX) mx = mMaxX - 0.05;
        if (mz > mMaxZ) mz = -mMaxZ + 0.05;
        else if (mz < -mMaxZ) mz = mMaxZ - 0.05;
        if (my > TANK_WATER_TOP_Y - 0.08) my = -0.92;
        else if (my < -1.0) my = TANK_WATER_TOP_Y - 0.14;

        arr[ix] = mx;
        arr[ix + 1] = my;
        arr[ix + 2] = mz;
      }
      posAttr.needsUpdate = true;
    }

    // 8b. Floating organic detritus & micro food crumbs drifting slowly with circular current
    if (this.detritusPoints && this.detritusMat && this.detritusPhases && this.detritusSinkRates) {
      this.detritusMat.uniforms.uTime.value = this.elapsedTime;
      this.detritusMat.uniforms.uLightIntensity.value = eff;

      const detPosAttr = this.detritusPoints.geometry.attributes.position as THREE.BufferAttribute;
      const dArr = detPosAttr.array as Float32Array;
      const dMaxX = TANK_W * 0.5 - 0.24;
      const dMaxZ = TANK_D * 0.5 - 0.24;
      const airPos = this.tank?.airstoneTop;

      for (let i = 0; i < this.detritusCount; i++) {
        const ix = i * 3;
        let dx = dArr[ix];
        let dy = dArr[ix + 1];
        let dz = dArr[ix + 2];
        const ph = this.detritusPhases[i];
        const sink = this.detritusSinkRates[i];

        // Slow circular tank current + subtle organic eddy & gentle settling
        let vx = -dz * 0.036 + Math.sin(this.elapsedTime * 0.34 + ph) * 0.011;
        let vz = dx * 0.028 + Math.cos(this.elapsedTime * 0.31 + ph * 1.4) * 0.010;
        let vy = sink + Math.sin(this.elapsedTime * 0.48 + ph * 1.9) * 0.008;

        if (airPos) {
          const dxAir = dx - airPos.x;
          const dzAir = dz - airPos.z;
          const d2Air = dxAir * dxAir + dzAir * dzAir;
          if (d2Air < 0.65) {
            vy += (1 - d2Air / 0.65) * 0.068;
            vx -= 0.018;
            vz += 0.018;
          }
        }

        dx += vx * dt * motionScale;
        dy += vy * dt * motionScale;
        dz += vz * dt * motionScale;

        if (dx > dMaxX) dx = -dMaxX + 0.06;
        else if (dx < -dMaxX) dx = dMaxX - 0.06;
        if (dz > dMaxZ) dz = -dMaxZ + 0.06;
        else if (dz < -dMaxZ) dz = dMaxZ - 0.06;

        const floorHere = sandHeightAt(dx, dz) + 0.02;
        if (dy < floorHere) {
          // Resuspend gently from top or updraft
          dy = TANK_WATER_TOP_Y - 0.14 - Math.random() * 0.18;
        } else if (dy > TANK_WATER_TOP_Y - 0.07) {
          dy = floorHere + 0.08 + Math.random() * 0.25;
        }

        dArr[ix] = dx;
        dArr[ix + 1] = dy;
        dArr[ix + 2] = dz;
      }
      detPosAttr.needsUpdate = true;
    }

    // 8c. Sand/silt dust clouds rising a few centimeters when fish touch/graze sand & settling softly
    if (this.sandDustPoints && this.sandDustMat) {
      this.sandDustMat.uniforms.uLightIntensity.value = eff;
      const dustGeom = this.sandDustPoints.geometry;
      const dPosAttr = dustGeom.attributes.position as THREE.BufferAttribute;
      const dSizeAttr = dustGeom.attributes.aSize as THREE.BufferAttribute;
      const dAlphaAttr = dustGeom.attributes.aAlpha as THREE.BufferAttribute;
      const pArr = dPosAttr.array as Float32Array;
      const sArr = dSizeAttr.array as Float32Array;
      const aArr = dAlphaAttr.array as Float32Array;
      const drag = Math.exp(-3.1 * dt);
      let anyDustDirty = false;

      for (let i = 0; i < this.sandDustPool.length; i++) {
        const slot = this.sandDustPool[i];
        if (!slot.active) {
          if (aArr[i] !== 0) {
            aArr[i] = 0;
            anyDustDirty = true;
          }
          continue;
        }
        anyDustDirty = true;
        slot.age += dt * motionScale;
        if (slot.age >= slot.maxAge) {
          slot.active = false;
          aArr[i] = 0;
          continue;
        }

        // Hydrodynamic drag + subtle water current + gentle negative buoyancy settling
        slot.vx = slot.vx * drag + (-slot.z * 0.014) * dt;
        slot.vz = slot.vz * drag + (slot.x * 0.011) * dt;
        slot.vy = slot.vy * drag - 0.14 * dt;

        slot.x = THREE.MathUtils.clamp(slot.x + slot.vx * dt * motionScale, -TANK_W * 0.48, TANK_W * 0.48);
        slot.z = THREE.MathUtils.clamp(slot.z + slot.vz * dt * motionScale, -TANK_D * 0.48, TANK_D * 0.48);
        slot.y += slot.vy * dt * motionScale;
        if (slot.y < slot.floorY) {
          slot.y = slot.floorY;
          slot.vy = 0;
          slot.vx *= 0.85;
          slot.vz *= 0.85;
        }

        const tNorm = slot.age / slot.maxAge;
        const fadeIn = THREE.MathUtils.smoothstep(tNorm, 0.0, 0.10);
        const fadeOut = 1.0 - THREE.MathUtils.smoothstep(tNorm, 0.36, 1.0);
        pArr[i * 3] = slot.x;
        pArr[i * 3 + 1] = slot.y;
        pArr[i * 3 + 2] = slot.z;
        sArr[i] = slot.baseSize * (0.85 + tNorm * 1.35);
        aArr[i] = fadeIn * fadeOut * 0.62;
      }

      if (anyDustDirty) {
        dPosAttr.needsUpdate = true;
        dSizeAttr.needsUpdate = true;
        dAlphaAttr.needsUpdate = true;
      }
    }

    // 8d. Coarse kicked-up sand grains arcing up a few centimeters and settling smoothly back to sandbed
    if (this.sandGrainsPoints && this.sandGrainsMat) {
      this.sandGrainsMat.uniforms.uLightIntensity.value = eff;
      const gGeom = this.sandGrainsPoints.geometry;
      const gPosAttr = gGeom.attributes.position as THREE.BufferAttribute;
      const gSizeAttr = gGeom.attributes.aSize as THREE.BufferAttribute;
      const gAlphaAttr = gGeom.attributes.aAlpha as THREE.BufferAttribute;
      const gpArr = gPosAttr.array as Float32Array;
      const gsArr = gSizeAttr.array as Float32Array;
      const gaArr = gAlphaAttr.array as Float32Array;
      const gDrag = Math.exp(-2.2 * dt);
      let anyGrainDirty = false;

      for (let i = 0; i < this.sandGrainPool.length; i++) {
        const g = this.sandGrainPool[i];
        if (!g.active) {
          if (gaArr[i] !== 0) {
            gaArr[i] = 0;
            anyGrainDirty = true;
          }
          continue;
        }
        anyGrainDirty = true;
        g.age += dt * motionScale;
        if (g.age >= g.maxAge) {
          g.active = false;
          gaArr[i] = 0;
          continue;
        }

        g.vx *= gDrag;
        g.vz *= gDrag;
        g.vy = g.vy * gDrag - 0.92 * dt;

        g.x = THREE.MathUtils.clamp(g.x + g.vx * dt * motionScale, -TANK_W * 0.48, TANK_W * 0.48);
        g.z = THREE.MathUtils.clamp(g.z + g.vz * dt * motionScale, -TANK_D * 0.48, TANK_D * 0.48);
        g.y += g.vy * dt * motionScale;
        if (g.y <= g.floorY) {
          g.y = g.floorY;
          g.vy = 0;
          g.vx *= 0.6;
          g.vz *= 0.6;
        }

        const tNorm = g.age / g.maxAge;
        const alpha = 0.92 * (1.0 - THREE.MathUtils.smoothstep(tNorm, 0.55, 1.0));
        gpArr[i * 3] = g.x;
        gpArr[i * 3 + 1] = g.y;
        gpArr[i * 3 + 2] = g.z;
        gsArr[i] = g.size;
        gaArr[i] = alpha;
      }

      if (anyGrainDirty) {
        gPosAttr.needsUpdate = true;
        gSizeAttr.needsUpdate = true;
        gAlphaAttr.needsUpdate = true;
      }
    }

    // 9. Selection ring subtle pulse
    if (this.selectionRing.visible) {
      this.selectionRingMat.opacity = 0.65 + Math.sin(this.elapsedTime * 4.2) * 0.2;
    }
  }

  private startLoop(): void {
    const tick = (now: number) => {
      if (this.disposed) return;
      const safeNow = Number.isFinite(now) ? now : performance.now();
      const rawDt = (safeNow - this.lastFrameMs) / 1000;
      const dt = Number.isFinite(rawDt) ? Math.min(0.05, Math.max(0.001, rawDt)) : 0.016;
      this.lastFrameMs = safeNow;

      this.updateScene(dt);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(() => {
          if (!this.disposed) tick(performance.now());
        });
      } else {
        this.rafId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      tick(performance.now());
    } else {
      this.rafId = requestAnimationFrame(tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        if (sync && gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED) {
          gl.deleteSync(sync);
          this.softTimerId = window.setTimeout(cb, 80);
        } else {
          this.softTimerId = window.setTimeout(poll, 16);
        }
      };
      this.softTimerId = window.setTimeout(poll, 16);
    } else {
      this.softTimerId = window.setTimeout(cb, 80);
    }
  }

  public dispose(): void {
    this.applyWallClockHunger();
    this.saveState();
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.softTimerId !== null) clearTimeout(this.softTimerId);

    this.resizeObserver.disconnect();
    this.motionQuery.removeEventListener('change', this.handleMotionChange);
    document.removeEventListener('visibilitychange', this.handleVisibilityOrHide);
    window.removeEventListener('pagehide', this.handleVisibilityOrHide);
    this.controls.dispose();

    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.handlePointerDown);
    dom.removeEventListener('pointermove', this.handlePointerMove);
    dom.removeEventListener('pointerup', this.handlePointerUp);
    dom.removeEventListener('pointercancel', this.handlePointerUp);
    dom.removeEventListener('webglcontextlost', this.handleContextLost);

    for (const f of this.fishList) {
      f.rig.skeleton.dispose();
    }
    this.scene.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh ||
        obj instanceof THREE.Points ||
        obj instanceof THREE.LineSegments
      ) {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m?.dispose();
      }
    });

    if (this.photoTextures) {
      disposeAquariumPhotoTextures(this.photoTextures);
    }
    for (const key of Object.keys(this.speciesTextures) as FishSpecies[]) {
      const set = this.speciesTextures[key];
      if (set) disposeSpeciesTextureSet(set);
    }

    this.bubbleGeom.dispose();
    this.bubbleMat.dispose();
    this.foodGeom.dispose();
    for (const m of this.foodMats) m.dispose();
    this.rockShadowGeom.dispose();
    this.rockShadowTex.dispose();
    this.pmremTarget.dispose();
    this.renderer.dispose();

    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
