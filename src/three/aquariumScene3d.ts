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
  spawnScale: number;
  baseScale: number;
  chompTimer: number;
  targetFoodId: string | null;
}

interface PlantEntity3D {
  id: string;
  style: PlantStyle;
  handle: Plant3DHandle;
  x: number;
  y: number;
  z: number;
  scale: number;
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
  dropProgress: number;
}

interface BubbleEntity3D {
  active: boolean;
  pos: THREE.Vector3;
  vy: number;
  wobblePhase: number;
  wobbleAmp: number;
  radius: number;
  mesh: THREE.Mesh;
}

interface RippleEntity3D {
  active: boolean;
  radius: number;
  maxRadius: number;
  alpha: number;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
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

export interface AquariumScene3DCallbacks {
  onCountsChange: (counts: AquariumCounts) => void;
  onSelectionChange: (selected: SelectedDecor | null) => void;
}

// Pre-allocated scratch helpers (zero GC in render loop)
const _vec2 = new THREE.Vector2();
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _dragPlane = new THREE.Plane();
const _hitPoint = new THREE.Vector3();

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
  private sunbeams: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number }[] = [];

  private hemiLight!: THREE.HemisphereLight;
  private sunKeyLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private sandBounceLight!: THREE.DirectionalLight;
  private targetLighting: AquariumLighting = { preset: 'day', intensity: 1.0 };
  private currentIntensity = 1.0;
  private currentBeamOpacity = 0.044;

  private fishList: FishEntity3D[] = [];
  private plantList: PlantEntity3D[] = [];
  private stoneList: StoneEntity3D[] = [];
  private bubbles: BubbleEntity3D[] = [];
  private ripples: RippleEntity3D[] = [];
  private foods: FoodEntity3D[] = [];

  private bubbleGeom: THREE.SphereGeometry;
  private bubbleMat: THREE.MeshPhysicalMaterial;
  private rippleGeom: THREE.RingGeometry;
  private foodGeom: THREE.IcosahedronGeometry;
  private foodMats: THREE.MeshStandardMaterial[];
  private rockShadowGeom: THREE.PlaneGeometry;
  private rockShadowTex: THREE.CanvasTexture;
  private motesPoints: THREE.Points | null = null;
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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x061b2c);
    this.scene.fog = new THREE.FogExp2(0x061b2c, 0.032);

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

    // Shared bubble & ripple pools
    this.bubbleGeom = new THREE.SphereGeometry(1, 14, 12);
    this.bubbleMat = new THREE.MeshPhysicalMaterial({
      color: 0xdff6ff,
      roughness: 0.06,
      metalness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    });
    this.rippleGeom = new THREE.RingGeometry(0.84, 1.0, 40);
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

    void this.initAssetsAndPopulate();

    this.lastFrameMs = performance.now();
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
    this.targetLighting = {
      preset: next.preset,
      intensity: THREE.MathUtils.clamp(next.intensity, 0.15, 1.6),
    };
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
    // Soft volumetric sunbeams inside the 3D tank descending from water surface
    const beamGeom = new THREE.PlaneGeometry(0.95, 2.55);
    const beamConfigs = [
      { x: -1.35, z: -0.45, rotZ: -0.22, rotY: 0.15, phase: 0.2 },
      { x: 0.15, z: -0.65, rotZ: -0.18, rotY: -0.1, phase: 2.1 },
      { x: 1.45, z: -0.25, rotZ: -0.24, rotY: 0.2, phase: 4.0 },
    ];
    for (const cfg of beamConfigs) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbbeeff,
        transparent: true,
        opacity: 0.055,
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

    // Subtle floating underwater motes inside tank volume
    const moteCount = 54;
    const positions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * (TANK_W - 0.5);
      positions[i * 3 + 1] = -0.9 + Math.random() * 2.1;
      positions[i * 3 + 2] = (Math.random() - 0.5) * (TANK_D - 0.5);
    }
    const moteGeom = new THREE.BufferGeometry();
    moteGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const moteMat = new THREE.PointsMaterial({
      color: 0xdff6ff,
      size: 0.028,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.motesPoints = new THREE.Points(moteGeom, moteMat);
    this.scene.add(this.motesPoints);
  }

  private async initAssetsAndPopulate(): Promise<void> {
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

    this.tank = createAquariumTank3D(photoTextures, this.isSoftwareGl);
    this.scene.add(this.tank.group);

    // Populate photorealistic 3D aquarium: 3 3D plants, 2 3D Seiryu rocks, 1 hyperrealistic 3D Clownfish
    this.populateInitialScene();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
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

    const id = genId('plant');
    const handle = createPlant3D(
      id,
      style,
      this.nextSeed++,
      this.photoTextures!,
      this.isSoftwareGl
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

    const id = genId('stone');
    const handle = createRock3D(
      id,
      this.nextSeed++,
      this.photoTextures!,
      this.tank!.uniforms,
      this.isSoftwareGl
    );
    handle.group.position.set(x, y + 0.35, z);
    handle.group.rotation.y = Math.random() * Math.PI * 2;
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
      dropProgress: 0.08,
    };
    this.stoneList.push(entity);
    return entity;
  }

  private spawnFishInternal(
    species: FishSpecies,
    x?: number,
    y?: number,
    z?: number
  ): FishEntity3D {
    const id = genId('fish');
    const textures = this.getSpeciesTextures(species);
    const baseScale = species === 'clown' ? 0.88 : 0.94;
    const rig = createHyperrealisticFish3D(id, species, textures, baseScale);

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
      bobAmp: 0.035,
      swimPhase: Math.random() * Math.PI * 2,
      spawnScale: 0.08,
      baseScale,
      chompTimer: 0,
      targetFoodId: null,
    };

    this.fishList.push(entity);
    return entity;
  }

  private pickNextFishWaypoint(currentX: number): THREE.Vector3 {
    const maxW = TANK_W * 0.5 - 0.65;
    const minY = -0.68;
    const maxY = 0.96;
    const maxZ = TANK_D * 0.5 - 0.52;
    const targetSide = currentX > 0 ? -1 : 1;
    const tx = targetSide * (0.28 + Math.random() * 0.68) * maxW;
    const ty = minY + Math.random() * (maxY - minY);
    const tz = (Math.random() * 2 - 1) * maxZ;
    return new THREE.Vector3(tx, ty, tz);
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
  }

  public addFish(): void {
    if (!this.editMode) return;
    const order: FishSpecies[] = ['tang', 'goldfish', 'clown'];
    const species = order[this.nextExtraSpeciesIdx % order.length];
    this.nextExtraSpeciesIdx += 1;
    const fish = this.spawnFishInternal(species);
    this.spawnBubbleBurst(fish.pos.x, fish.pos.y, fish.pos.z, 6);
    this.emitCounts();
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
    this.populateInitialScene();
    this.resetCamera();
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

  private spawnBubbleBurst(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      let slot = this.bubbles.find((b) => !b.active);
      if (!slot) {
        if (this.bubbles.length >= 70) {
          slot = this.bubbles[0];
        } else {
          const mesh = new THREE.Mesh(this.bubbleGeom, this.bubbleMat);
          this.scene.add(mesh);
          slot = {
            active: false,
            pos: new THREE.Vector3(),
            vy: 0.7,
            wobblePhase: 0,
            wobbleAmp: 0.04,
            radius: 0.025,
            mesh,
          };
          this.bubbles.push(slot);
        }
      }
      slot.active = true;
      slot.pos.set(
        x + (Math.random() - 0.5) * 0.18,
        y + (Math.random() - 0.5) * 0.14,
        z + (Math.random() - 0.5) * 0.18
      );
      slot.vy = 0.52 + Math.random() * 0.42;
      slot.wobblePhase = Math.random() * Math.PI * 2;
      slot.wobbleAmp = 0.025 + Math.random() * 0.03;
      slot.radius = 0.016 + Math.random() * 0.024;
      slot.mesh.visible = true;
      slot.mesh.position.copy(slot.pos);
      slot.mesh.scale.setScalar(slot.radius);
    }
  }

  private spawnRipple(x: number, y: number, z: number): void {
    let slot = this.ripples.find((r) => !r.active);
    if (!slot) {
      if (this.ripples.length >= 10) {
        slot = this.ripples[0];
      } else {
        const material = new THREE.MeshBasicMaterial({
          color: 0xbaf0ff,
          transparent: true,
          opacity: 0.65,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(this.rippleGeom, material);
        this.scene.add(mesh);
        slot = {
          active: false,
          radius: 0.05,
          maxRadius: 0.48,
          alpha: 0.65,
          mesh,
          material,
        };
        this.ripples.push(slot);
      }
    }
    slot.active = true;
    slot.radius = 0.05;
    slot.maxRadius = 0.42 + Math.random() * 0.12;
    slot.alpha = 0.65;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, y, z);
    slot.mesh.quaternion.copy(this.camera.quaternion);
    slot.mesh.scale.setScalar(slot.radius);
    slot.material.opacity = slot.alpha;
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
        // Quick tap on water -> clear selection & create 3D ripple + bubbles inside tank
        this.setSelection(null);
        this.updatePointerNDC(e.clientX, e.clientY);
        _raycaster.setFromCamera(_vec2, this.camera);
        this.camera.getWorldDirection(_camForward);
        _dragPlane.setFromNormalAndCoplanarPoint(_camForward, this.controls.target);
        if (_raycaster.ray.intersectPlane(_dragPlane, _hitPoint)) {
          const rx = THREE.MathUtils.clamp(_hitPoint.x, -TANK_W * 0.44, TANK_W * 0.44);
          const ry = THREE.MathUtils.clamp(_hitPoint.y, -0.8, TANK_WATER_TOP_Y - 0.15);
          const rz = THREE.MathUtils.clamp(_hitPoint.z, -TANK_D * 0.42, TANK_D * 0.42);
          this.spawnRipple(rx, ry, rz);
          this.spawnBubbleBurst(rx, ry, rz, 4);
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

    this.spawnRipple(tapPoint.x, tapPoint.y, tapPoint.z);
    this.spawnBubbleBurst(fish.pos.x, fish.pos.y, fish.pos.z, 6);
  }

  private updateScene(dt: number): void {
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
    const presetCfg = LIGHTING_PRESETS[this.targetLighting.preset];
    const lk = 1 - Math.exp(-6.0 * dt);
    this.currentIntensity += (this.targetLighting.intensity - this.currentIntensity) * lk;
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

    // 1. Tank water waves & sand caustics
    if (this.tank) {
      this.tank.uniforms.uTime.value = this.elapsedTime;
      this.tank.uniforms.uMotionAmp.value = motionScale;
      this.tank.uniforms.uCausticIntensity.value = THREE.MathUtils.clamp(
        presetCfg.causticScale * eff,
        0.1,
        1.75
      );
    }

    // 2. Volumetric sunbeams shimmer
    for (const b of this.sunbeams) {
      b.mat.color.lerp(presetCfg.beamColor, lk);
      b.mat.opacity = Math.max(
        0.005,
        this.currentBeamOpacity + Math.sin(this.elapsedTime * 0.65 + b.phase) * 0.016 * eff
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
        s.dropProgress = Math.min(1, s.dropProgress + dt * 3.4);
        const dropOffset = (1 - s.dropProgress) * (1 - s.dropProgress) * 0.42;
        s.handle.group.position.set(s.x, s.y + dropOffset, s.z);
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
          if (Math.random() < 0.45) {
            this.spawnRipple(food.pos.x, TANK_WATER_TOP_Y - 0.015, food.pos.z);
          }
          if (Math.random() < 0.5) {
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

        const floorY = sandHeightAt(food.pos.x, food.pos.z) + 0.022;
        if (food.pos.y <= floorY) {
          food.pos.y = floorY;
          food.settled = true;
          food.ageOnSand = 0;
        }
        food.mesh.position.copy(food.pos);
      } else {
        food.ageOnSand += dt;
        if (food.ageOnSand > 12) {
          const fade = Math.max(0, 1 - (food.ageOnSand - 12) / 1.5);
          if (fade <= 0.01) {
            food.active = false;
            food.mesh.visible = false;
          } else {
            food.mesh.scale.copy(food.baseScale).multiplyScalar(fade);
          }
        }
      }
    }

    // 5. 3D Hyperrealistic Fish swimming, foraging/eating food, slow U-turns, and fin kinetics
    const maxW = TANK_W * 0.5 - 0.58;
    const minY = -0.82;
    const maxY = 1.08;
    const maxZ = TANK_D * 0.5 - 0.48;

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

      const desiredSpeed =
        f.fleeTimer > 0
          ? f.baseSpeed * (1.25 + (f.fleeTimer / 1.25) * 1.9)
          : chasedFood
            ? f.baseSpeed * 1.92
            : f.baseSpeed * (0.92 + 0.16 * Math.sin(this.elapsedTime * 0.7 + f.bobPhase));
      f.speed += (desiredSpeed - f.speed) * Math.min(1, dt * 3.8);

      const horizLen = Math.max(0.001, Math.hypot(_vec3A.x, _vec3A.z));
      const desiredYaw = Math.atan2(-_vec3A.z, _vec3A.x);
      const pitchCap = chasedFood ? 0.62 : 0.46;
      const desiredPitch = THREE.MathUtils.clamp(
        Math.atan2(_vec3A.y, horizLen),
        -pitchCap,
        pitchCap
      );

      // Slow, natural curved U-turn rate (slightly livelier when snapping at food)
      const yawDiff = wrapAngle(desiredYaw - f.yaw);
      const maxYawRate = f.fleeTimer > 0 ? 3.8 : chasedFood ? 2.65 : 1.15;
      const yawStep = THREE.MathUtils.clamp(yawDiff * (chasedFood ? 3.0 : 2.2), -maxYawRate, maxYawRate);
      f.yaw = wrapAngle(f.yaw + yawStep * dt * motionScale);

      const pitchDiff = desiredPitch - f.pitch;
      f.pitch += pitchDiff * Math.min(1, dt * (chasedFood ? 3.4 : 2.2)) * motionScale;

      const targetRoll = THREE.MathUtils.clamp(-yawStep * 0.28, -0.34, 0.34);
      f.roll += (targetRoll - f.roll) * Math.min(1, dt * 4.0);

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

      // Check if fish mouth reaches chased food and eats it
      if (chasedFood) {
        const mouthReach = 0.44 * f.baseScale;
        const headReach = 0.25 * f.baseScale;
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
          this.spawnBubbleBurst(mouthX, mouthY, mouthZ, 2);
          this.spawnRipple(chasedFood.pos.x, chasedFood.pos.y, chasedFood.pos.z);
        }
      }

      f.bobPhase += f.bobFreq * dt * motionScale;
      const bobY = Math.sin(f.bobPhase) * f.bobAmp * motionScale;

      const chompBoost = f.chompTimer > 0 ? 1.55 : 1.0;
      const speedNorm = f.speed / Math.max(0.01, f.baseSpeed);
      f.swimPhase += dt * (4.6 + speedNorm * 4.4) * chompBoost * motionScale;
      f.rig.uniforms.uTime.value = this.elapsedTime;
      f.rig.uniforms.uSwimPhase.value = f.swimPhase;
      f.rig.uniforms.uSwimAmp.value =
        (0.028 + 0.018 * Math.min(2.6, speedNorm)) *
        (f.chompTimer > 0 ? 1.3 : 1.0) *
        motionScale;

      const targetBend = THREE.MathUtils.clamp(-yawStep * 0.13, -0.22, 0.22);
      f.rig.uniforms.uTurnBend.value +=
        (targetBend - f.rig.uniforms.uTurnBend.value) * Math.min(1, dt * 5.0);

      const turnMag = Math.min(1, Math.abs(yawStep) / 1.2);
      const pectBaseFlare = 0.28 + turnMag * 0.42;
      const scullL = Math.sin(f.swimPhase * 0.85) * 0.24 * motionScale;
      const scullR = Math.sin(f.swimPhase * 0.85 + 0.9) * 0.24 * motionScale;

      f.rig.leftPectoral.rotation.y = pectBaseFlare + scullL;
      f.rig.leftPectoral.rotation.z = -0.18 + Math.cos(f.swimPhase * 0.85) * 0.14 * motionScale;

      f.rig.rightPectoral.rotation.y = -(pectBaseFlare + scullR);
      f.rig.rightPectoral.rotation.z = -0.18 + Math.cos(f.swimPhase * 0.85 + 0.9) * 0.14 * motionScale;

      f.rig.leftPelvic.rotation.y = 0.15 + scullL * 0.45;
      f.rig.rightPelvic.rotation.y = -(0.15 + scullR * 0.45);

      const chompNod =
        f.chompTimer > 0 ? Math.sin((f.chompTimer / 0.32) * Math.PI * 2) * 0.12 : 0;
      const sc = f.baseScale * f.spawnScale;
      f.rig.root.position.set(f.pos.x, f.pos.y + bobY, f.pos.z);
      f.rig.root.rotation.set(f.roll, f.yaw, f.pitch + chompNod);
      f.rig.root.scale.setScalar(sc);
    }

    // 6. 3D Rising Bubbles
    for (const b of this.bubbles) {
      if (!b.active) continue;
      b.pos.y += b.vy * dt * motionScale;
      b.wobblePhase += 3.2 * dt;
      b.pos.x += Math.sin(b.wobblePhase) * b.wobbleAmp * dt * 2.2;
      b.mesh.position.copy(b.pos);

      if (b.pos.y > TANK_WATER_TOP_Y - 0.04) {
        b.active = false;
        b.mesh.visible = false;
      }
    }

    // 7. 3D Water Ripples
    for (const r of this.ripples) {
      if (!r.active) continue;
      r.radius += (r.maxRadius - r.radius) * Math.min(1, dt * 4.5) + dt * 0.22;
      r.alpha -= dt * 1.15;
      if (r.alpha <= 0.01) {
        r.active = false;
        r.mesh.visible = false;
      } else {
        r.mesh.quaternion.copy(this.camera.quaternion);
        r.mesh.scale.setScalar(r.radius);
        r.material.opacity = r.alpha;
      }
    }

    // 8. Gentle underwater motes drift
    if (this.motesPoints) {
      this.motesPoints.rotation.y = Math.sin(this.elapsedTime * 0.08) * 0.04;
      this.motesPoints.position.y = Math.sin(this.elapsedTime * 0.22) * 0.06;
    }

    // 9. Selection ring subtle pulse
    if (this.selectionRing.visible) {
      this.selectionRingMat.opacity = 0.65 + Math.sin(this.elapsedTime * 4.2) * 0.2;
    }
  }

  private startLoop(): void {
    const tick = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameMs) / 1000));
      this.lastFrameMs = now;

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
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.softTimerId !== null) clearTimeout(this.softTimerId);

    this.resizeObserver.disconnect();
    this.motionQuery.removeEventListener('change', this.handleMotionChange);
    this.controls.dispose();

    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.handlePointerDown);
    dom.removeEventListener('pointermove', this.handlePointerMove);
    dom.removeEventListener('pointerup', this.handlePointerUp);
    dom.removeEventListener('pointercancel', this.handlePointerUp);

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
    this.rippleGeom.dispose();
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
