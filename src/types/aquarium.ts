export type FishSpecies = 'goldfish' | 'clown' | 'tang' | 'koi';

export type GoldfishVariety =
  | 'metallic_orange'
  | 'sarasa'
  | 'calico'
  | 'red_cap'
  | 'sakura'
  | 'tiger'
  | 'panda'
  | 'black_oranda'
  | 'lemon'
  | 'chocolate';


export interface Fish {
  id: string;
  xRatio: number; // 0..1 normalized horizontal position
  yRatio: number; // 0..1 normalized vertical position
  vx: number; // px/sec horizontal velocity
  vy: number; // px/sec vertical velocity
  baseSpeed: number; // preferred cruising speed px/sec
  facing: number; // -1 (left) to 1 (right), derived from cos(turnAngle)
  turnAngle: number; // 0 (right) to Math.PI (left) for slow 3D-like turning
  targetDir: 1 | -1;
  targetYRatio: number; // wandering target vertical depth
  wanderTimer: number; // seconds until picking next vertical cruising target
  layerOrder: number; // z-order interleaved with plants & stones
  size: number; // base body length in px
  species: FishSpecies;
  bodyColor: string;
  accentColor: string;
  finColor: string;
  tailPhase: number;
  bobPhase: number;
  bobFreq: number;
  bobAmp: number;
  spawnScale: number; // 0..1 entrance animation
  fleeTimer: number; // >0 when startled by tap/click, decays back to 0
}

export type PlantStyle = 'vallisneria' | 'sword';

export interface PlantBlade {
  offsetX: number;
  height: number;
  width: number;
  lean: number;
  phaseOffset: number;
  hueShift: number;
}

export interface Plant {
  id: string;
  xRatio: number; // 0..1 normalized horizontal position
  sandOffset: number; // px offset within sandbed depth (-14..24)
  layerOrder: number; // z-order among stones & plants
  style: PlantStyle;
  baseColor: string;
  tipColor: string;
  blades: PlantBlade[];
  swaySpeed: number;
  phaseOffset: number;
  scale: number;
  flipX: boolean;
  growProgress: number; // 0..1 entrance growth animation
}

export interface StoneVertex {
  angle: number;
  radiusX: number;
  radiusY: number;
}

export interface Stone {
  id: string;
  xRatio: number; // 0..1 normalized horizontal position
  sandOffset: number; // px offset within sandbed depth (-14..24)
  layerOrder: number; // z-order among stones & plants
  width: number;
  height: number;
  baseColor: string;
  highlightColor: string;
  shadowColor: string;
  hasMoss: boolean;
  mossColor: string;
  vertices: StoneVertex[];
  dropProgress: number; // 0..1 settling animation
  depthOffset: number; // subtle y offset on the sandbed
  flipX: boolean;
}

export interface SelectedDecor {
  id: string;
  kind: 'plant' | 'stone';
}

export interface Bubble {
  id: string;
  x: number;
  y: number;
  radius: number;
  vy: number;
  wobblePhase: number;
  wobbleAmp: number;
  alpha: number;
}

export interface Ripple {
  id: string;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

export interface AmbientParticle {
  xRatio: number;
  yRatio: number;
  radius: number;
  speedY: number;
  driftPhase: number;
  alpha: number;
}

export interface SandPebble {
  xRatio: number;
  depthRatio: number; // 0..1 depth below sand surface
  rx: number;
  ry: number;
  rotation: number;
  color: string;
}

export interface AquariumState {
  fish: Fish[];
  plants: Plant[];
  stones: Stone[];
  bubbles: Bubble[];
  ripples: Ripple[];
  particles: AmbientParticle[];
  pebbles: SandPebble[];
  time: number;
}

export interface AquariumCounts {
  fish: number;
  plants: number;
  stones: number;
}

export type LightingPreset = 'day' | 'reef' | 'sunset' | 'night';

export interface AquariumLighting {
  preset: LightingPreset;
  intensity: number; // 0.15 .. 1.6
}

export type TankSizePreset = 'compact' | 'standard' | 'large' | 'panoramic' | 'custom';

export interface TankDimensions {
  preset: TankSizePreset;
  width: number; // 3.6 .. 7.6
  height: number; // 2.4 .. 4.0
  depth: number; // 2.2 .. 4.2
}

export type AquariumBackgroundId =
  | 'natural'
  | 'reef'
  | 'amazon'
  | 'slate'
  | 'frosted'
  | 'abyss';
