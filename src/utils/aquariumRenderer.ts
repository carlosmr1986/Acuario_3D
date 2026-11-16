import type {
  AmbientParticle,
  AquariumState,
  Bubble,
  Fish,
  FishSpecies,
  Plant,
  PlantBlade,
  PlantStyle,
  SandPebble,
  SelectedDecor,
  Stone,
  StoneVertex,
} from '../types/aquarium';
import type { AquariumSprites } from './spriteLoader';

let idCounter = 0;
let layerCounter = 10;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

function nextLayer(): number {
  layerCounter += 1;
  return layerCounter;
}

const FISH_PRESETS: Array<{
  species: FishSpecies;
  bodyColor: string;
  accentColor: string;
  finColor: string;
  sizeRange: [number, number];
  speedRange: [number, number];
}> = [
  {
    species: 'clown',
    bodyColor: '#EA580C',
    accentColor: '#FFF7ED',
    finColor: '#F97316',
    sizeRange: [64, 84],
    speedRange: [42, 66],
  },
  {
    species: 'tang',
    bodyColor: '#1D4ED8',
    accentColor: '#FACC15',
    finColor: '#3B82F6',
    sizeRange: [76, 98],
    speedRange: [52, 78],
  },
  {
    species: 'goldfish',
    bodyColor: '#D97706',
    accentColor: '#FEF3C7',
    finColor: '#F59E0B',
    sizeRange: [72, 94],
    speedRange: [38, 62],
  },
];

const PLANT_PALETTES: Array<{
  style: PlantStyle;
  baseColor: string;
  tipColor: string;
}> = [
  { style: 'vallisneria', baseColor: '#064E3B', tipColor: '#34D399' },
  { style: 'sword', baseColor: '#14532D', tipColor: '#4ADE80' },
];

const STONE_PALETTES = [
  {
    baseColor: '#475569',
    highlightColor: '#94A3B8',
    shadowColor: '#1E293B',
    mossColor: '#15803D',
  },
  {
    baseColor: '#57534E',
    highlightColor: '#A8A29E',
    shadowColor: '#292524',
    mossColor: '#166534',
  },
];

const PEBBLE_COLORS = [
  'rgba(120, 96, 66, 0.5)',
  'rgba(168, 145, 112, 0.6)',
  'rgba(87, 83, 78, 0.45)',
  'rgba(245, 232, 204, 0.5)',
];

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function getWaterTopY(height: number): number {
  return Math.max(64, height * 0.185);
}

export function getSandY(x: number, width: number, height: number): number {
  const safeWidth = Math.max(1, width);
  const nx = x / safeWidth;
  const baseFloor = Math.min(height - 96, Math.max(height * 0.84, height - 124));
  const undulation = Math.sin(nx * Math.PI * 2.1 + 0.5) * 6;
  return baseFloor + undulation;
}

export function createFish(options?: {
  xRatio?: number;
  yRatio?: number;
  layerOrder?: number;
  immediate?: boolean;
}): Fish {
  const preset = FISH_PRESETS[Math.floor(Math.random() * FISH_PRESETS.length)];
  const dir: 1 | -1 = Math.random() > 0.5 ? 1 : -1;
  const baseSpeed = randomBetween(preset.speedRange[0], preset.speedRange[1]);
  const startY = options?.yRatio ?? randomBetween(0.28, 0.74);

  return {
    id: nextId('fish'),
    xRatio: options?.xRatio ?? randomBetween(0.18, 0.82),
    yRatio: startY,
    vx: dir * baseSpeed,
    vy: randomBetween(-14, 14),
    baseSpeed,
    facing: dir,
    turnAngle: dir === 1 ? 0 : Math.PI,
    targetDir: dir,
    targetYRatio: randomBetween(0.24, 0.78),
    wanderTimer: randomBetween(1.6, 4.2),
    layerOrder: options?.layerOrder ?? nextLayer(),
    size: randomBetween(preset.sizeRange[0], preset.sizeRange[1]),
    species: preset.species,
    bodyColor: preset.bodyColor,
    accentColor: preset.accentColor,
    finColor: preset.finColor,
    tailPhase: randomBetween(0, Math.PI * 2),
    bobPhase: randomBetween(0, Math.PI * 2),
    bobFreq: randomBetween(0.95, 1.5),
    bobAmp: randomBetween(6, 13),
    spawnScale: options?.immediate ? 1 : 0.05,
    fleeTimer: 0,
  };
}

export function createPlant(options?: {
  xRatio?: number;
  sandOffset?: number;
  layerOrder?: number;
  immediate?: boolean;
}): Plant {
  const palette = PLANT_PALETTES[Math.floor(Math.random() * PLANT_PALETTES.length)];
  const bladeCount = 5;
  const blades: PlantBlade[] = [];

  for (let i = 0; i < bladeCount; i++) {
    const spread = (i - (bladeCount - 1) / 2) * 5;
    blades.push({
      offsetX: spread,
      height: randomBetween(100, 175),
      width: palette.style === 'sword' ? 16 : 9,
      lean: spread,
      phaseOffset: randomBetween(0, Math.PI * 1.6),
      hueShift: 0,
    });
  }

  return {
    id: nextId('plant'),
    xRatio: options?.xRatio ?? randomBetween(0.08, 0.92),
    sandOffset: options?.sandOffset ?? randomBetween(-4, 8),
    layerOrder: options?.layerOrder ?? nextLayer(),
    style: palette.style,
    baseColor: palette.baseColor,
    tipColor: palette.tipColor,
    blades,
    swaySpeed: randomBetween(1.15, 1.75),
    phaseOffset: randomBetween(0, Math.PI * 2),
    scale: randomBetween(0.86, 1.18),
    flipX: Math.random() > 0.5,
    growProgress: options?.immediate ? 1 : 0.02,
  };
}

export function createStone(options?: {
  xRatio?: number;
  sandOffset?: number;
  layerOrder?: number;
  immediate?: boolean;
}): Stone {
  const palette = STONE_PALETTES[Math.floor(Math.random() * STONE_PALETTES.length)];
  const width = randomBetween(66, 108);
  const height = width * randomBetween(0.56, 0.72);
  const vertexCount = 10;
  const vertices: StoneVertex[] = [];

  for (let i = 0; i < vertexCount; i++) {
    const angle = (i / vertexCount) * Math.PI * 2;
    const isBottom = Math.sin(angle) > 0.2;
    vertices.push({
      angle,
      radiusX: width * 0.5 * randomBetween(0.85, 1.1),
      radiusY: height * 0.5 * (isBottom ? randomBetween(0.65, 0.82) : randomBetween(0.88, 1.1)),
    });
  }

  return {
    id: nextId('stone'),
    xRatio: options?.xRatio ?? randomBetween(0.08, 0.92),
    sandOffset: options?.sandOffset ?? randomBetween(-2, 10),
    layerOrder: options?.layerOrder ?? nextLayer(),
    width,
    height,
    baseColor: palette.baseColor,
    highlightColor: palette.highlightColor,
    shadowColor: palette.shadowColor,
    hasMoss: Math.random() > 0.35,
    mossColor: palette.mossColor,
    vertices,
    dropProgress: options?.immediate ? 1 : 0,
    depthOffset: 0,
    flipX: Math.random() > 0.5,
  };
}

export function createInitialAquariumState(): AquariumState {
  layerCounter = 10;

  const particles: AmbientParticle[] = Array.from({ length: 30 }, () => ({
    xRatio: Math.random(),
    yRatio: randomBetween(0.2, 0.84),
    radius: randomBetween(0.9, 2.0),
    speedY: randomBetween(2.5, 7.0),
    driftPhase: randomBetween(0, Math.PI * 2),
    alpha: randomBetween(0.14, 0.36),
  }));

  const pebbles: SandPebble[] = Array.from({ length: 36 }, () => ({
    xRatio: randomBetween(0.02, 0.98),
    depthRatio: randomBetween(0.1, 0.88),
    rx: randomBetween(1.8, 4.5),
    ry: randomBetween(1.0, 2.4),
    rotation: randomBetween(-0.4, 0.4),
    color: PEBBLE_COLORS[Math.floor(Math.random() * PEBBLE_COLORS.length)],
  }));

  // Interleave plants, stones, and fish layerOrder so fish swim between foreground & background plants
  const p1 = createPlant({ xRatio: 0.16, sandOffset: -4, layerOrder: 11, immediate: true });
  const s1 = createStone({ xRatio: 0.28, sandOffset: 6, layerOrder: 12, immediate: true });
  const f1 = createFish({ xRatio: 0.28, yRatio: 0.42, layerOrder: 13, immediate: true });
  const p2 = createPlant({ xRatio: 0.5, sandOffset: 2, layerOrder: 14, immediate: true });
  const f2 = createFish({ xRatio: 0.68, yRatio: 0.58, layerOrder: 15, immediate: true });
  const p3 = createPlant({ xRatio: 0.84, sandOffset: -2, layerOrder: 16, immediate: true });
  const s2 = createStone({ xRatio: 0.72, sandOffset: 8, layerOrder: 17, immediate: true });
  layerCounter = 18;

  return {
    fish: [f1, f2],
    plants: [p1, p2, p3],
    stones: [s1, s2],
    bubbles: [],
    ripples: [],
    particles,
    pebbles,
    time: 0,
  };
}

export function spawnBubbleBurst(
  state: AquariumState,
  x: number,
  y: number,
  count: number
): void {
  for (let i = 0; i < count; i++) {
    state.bubbles.push({
      id: nextId('bubble'),
      x: x + randomBetween(-14, 14),
      y: y + randomBetween(-8, 10),
      radius: randomBetween(1.8, 5.4),
      vy: randomBetween(36, 76),
      wobblePhase: randomBetween(0, Math.PI * 2),
      wobbleAmp: randomBetween(6, 16),
      alpha: randomBetween(0.45, 0.85),
    });
  }
}

function getPlantDimensions(
  plant: Plant,
  height: number,
  sprite: HTMLCanvasElement | null
): { w: number; h: number } {
  const heightScale = Math.min(1.12, Math.max(0.68, height / 700)) * plant.scale;
  const targetH = (plant.style === 'vallisneria' ? 195 : 165) * heightScale;
  const aspect = sprite ? sprite.width / Math.max(1, sprite.height) : 0.6;
  return { w: Math.max(54, targetH * aspect), h: targetH };
}

function getStoneDimensions(
  stone: Stone,
  sprite: HTMLCanvasElement | null
): { w: number; h: number } {
  const aspect = sprite ? sprite.width / Math.max(1, sprite.height) : 1.4;
  return { w: stone.width, h: stone.width / aspect };
}

export type HitTarget =
  | { kind: 'fish'; fish: Fish }
  | { kind: 'decor'; decor: SelectedDecor };

/**
 * Checks fish, plants, and stones in front-to-back render order (highest layerOrder first)
 * so whatever the user sees on top responds to touch/click.
 */
export function hitTestTopMost(
  state: AquariumState,
  x: number,
  y: number,
  width: number,
  height: number,
  sprites: AquariumSprites | null
): HitTarget | null {
  type Entry =
    | { kind: 'fish'; item: Fish; layerOrder: number }
    | { kind: 'plant'; item: Plant; layerOrder: number }
    | { kind: 'stone'; item: Stone; layerOrder: number };

  const all: Entry[] = [
    ...state.fish.map((item) => ({ kind: 'fish' as const, item, layerOrder: item.layerOrder })),
    ...state.plants.map((item) => ({ kind: 'plant' as const, item, layerOrder: item.layerOrder })),
    ...state.stones.map((item) => ({ kind: 'stone' as const, item, layerOrder: item.layerOrder })),
  ];

  all.sort((a, b) => b.layerOrder - a.layerOrder);

  for (const entry of all) {
    if (entry.kind === 'fish') {
      const fish = entry.item;
      const fx = fish.xRatio * width;
      const fy = fish.yRatio * height;
      const hitRx = Math.max(38, fish.size * 0.64);
      const hitRy = Math.max(30, fish.size * 0.48);
      const normDistSq =
        Math.pow((x - fx) / hitRx, 2) + Math.pow((y - fy) / hitRy, 2);
      if (normDistSq <= 1) {
        return { kind: 'fish', fish };
      }
    } else if (entry.kind === 'stone') {
      const stone = entry.item;
      const sx = stone.xRatio * width;
      const groundY = getSandY(sx, width, height) + stone.sandOffset;
      const { w, h } = getStoneDimensions(stone, sprites?.stone ?? null);
      const pad = 10;
      const left = sx - w * 0.5 - pad;
      const right = sx + w * 0.5 + pad;
      const top = groundY - h + 6 - pad;
      const bottom = groundY + 12 + pad;
      if (x >= left && x <= right && y >= top && y <= bottom) {
        return { kind: 'decor', decor: { id: stone.id, kind: 'stone' } };
      }
    } else {
      const plant = entry.item;
      const px = plant.xRatio * width;
      const anchorY = getSandY(px, width, height) + 8 + plant.sandOffset;
      const sprite =
        plant.style === 'sword'
          ? sprites?.plants.sword ?? null
          : sprites?.plants.vallisneria ?? null;
      const { w, h } = getPlantDimensions(plant, height, sprite);
      const pad = 8;
      const left = px - w * 0.42 - pad;
      const right = px + w * 0.42 + pad;
      const top = anchorY - h - pad;
      const bottom = anchorY + pad;
      if (x >= left && x <= right && y >= top && y <= bottom) {
        return { kind: 'decor', decor: { id: plant.id, kind: 'plant' } };
      }
    }
  }

  return null;
}

export function getDecorAnchor(
  state: AquariumState,
  decor: SelectedDecor,
  width: number,
  height: number
): { x: number; y: number } {
  const item =
    decor.kind === 'stone'
      ? state.stones.find((s) => s.id === decor.id)
      : state.plants.find((p) => p.id === decor.id);
  if (!item) return { x: width * 0.5, y: getSandY(width * 0.5, width, height) };
  const x = item.xRatio * width;
  const y = getSandY(x, width, height) + item.sandOffset;
  return { x, y };
}

export function moveDecorItem(
  state: AquariumState,
  decor: SelectedDecor,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const clampedX = Math.max(width * 0.05, Math.min(width * 0.95, x));
  const nextXRatio = clampedX / Math.max(1, width);
  const baseSandY = getSandY(clampedX, width, height);
  const waterTop = getWaterTopY(height);

  if (decor.kind === 'stone') {
    const stone = state.stones.find((s) => s.id === decor.id);
    if (stone) {
      stone.xRatio = nextXRatio;
      // Allow stones to be stacked freely anywhere from the sand floor up into the tank
      const minStoneOffset = -(baseSandY - waterTop - 54);
      stone.sandOffset = Math.max(minStoneOffset, Math.min(24, y - baseSandY));
    }
  } else {
    const plant = state.plants.find((p) => p.id === decor.id);
    if (plant) {
      plant.xRatio = nextXRatio;
      plant.sandOffset = Math.max(-20, Math.min(24, y - baseSandY));
    }
  }
}

export function bringDecorForward(state: AquariumState, decor: SelectedDecor): void {
  const maxOrder = Math.max(
    0,
    ...state.plants.map((p) => p.layerOrder),
    ...state.stones.map((s) => s.layerOrder),
    ...state.fish.map((f) => f.layerOrder)
  );
  const target =
    decor.kind === 'plant'
      ? state.plants.find((p) => p.id === decor.id)
      : state.stones.find((s) => s.id === decor.id);

  if (target) {
    target.layerOrder = maxOrder + 1;
    layerCounter = Math.max(layerCounter, target.layerOrder);
  }
}

export function sendDecorBackward(state: AquariumState, decor: SelectedDecor): void {
  const allOrders = [
    ...state.plants.map((p) => p.layerOrder),
    ...state.stones.map((s) => s.layerOrder),
    ...state.fish.map((f) => f.layerOrder),
  ];
  const minOrder = allOrders.length > 0 ? Math.min(...allOrders) : 0;
  const target =
    decor.kind === 'plant'
      ? state.plants.find((p) => p.id === decor.id)
      : state.stones.find((s) => s.id === decor.id);

  if (target) {
    target.layerOrder = minOrder - 1;
  }
}

export function triggerFishFlee(
  state: AquariumState,
  fish: Fish,
  tapX: number,
  tapY: number,
  width: number,
  height: number
): void {
  const fx = fish.xRatio * width;
  const fy = fish.yRatio * height;
  const dx = fx - tapX;
  const dy = fy - tapY;

  if (Math.abs(dx) < 12) {
    fish.targetDir = fish.targetDir === 1 ? -1 : 1;
  } else {
    fish.targetDir = dx >= 0 ? 1 : -1;
  }

  fish.fleeTimer = 1.0;
  fish.vy =
    (Math.abs(dy) < 6 ? (Math.random() > 0.5 ? 1 : -1) : Math.sign(dy)) *
    randomBetween(52, 86);
  fish.targetYRatio = Math.max(
    0.22,
    Math.min(0.78, (fy + fish.vy * 0.45) / Math.max(1, height))
  );

  spawnBubbleBurst(state, fx - fish.targetDir * (fish.size * 0.35), fy, 4);
}

export function spawnTapInteraction(
  state: AquariumState,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const topY = getWaterTopY(height);
  const sandY = getSandY(x, width, height);
  const clampedY = Math.max(topY + 12, Math.min(sandY - 8, y));

  state.ripples.push({
    id: nextId('ripple'),
    x,
    y: clampedY,
    radius: 6,
    maxRadius: 58,
    alpha: 0.62,
  });

  spawnBubbleBurst(state, x, clampedY, 5);

  const nx = x / Math.max(1, width);
  const ny = clampedY / Math.max(1, height);
  for (const fish of state.fish) {
    const dx = nx - fish.xRatio;
    const dy = ny - fish.yRatio;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.35 && dist > 0.03) {
      fish.vy += dy > 0 ? 22 : -22;
    }
  }
}

export function updateAquarium(
  state: AquariumState,
  dt: number,
  width: number,
  height: number,
  reducedMotion: boolean
): void {
  const safeDt = Math.min(dt, 0.05);
  const motionFactor = reducedMotion ? 0.25 : 1;
  state.time += safeDt * motionFactor;

  const waterTop = getWaterTopY(height);
  const approxFloor = getSandY(width * 0.5, width, height);

  if (!reducedMotion && Math.random() < safeDt * (0.65 + state.plants.length * 0.28)) {
    if (state.plants.length > 0 && state.bubbles.length < 44) {
      const plant = state.plants[Math.floor(Math.random() * state.plants.length)];
      const px = plant.xRatio * width;
      const py = getSandY(px, width, height) + plant.sandOffset - 36;
      state.bubbles.push({
        id: nextId('bubble'),
        x: px + randomBetween(-12, 12),
        y: py,
        radius: randomBetween(1.8, 4.4),
        vy: randomBetween(28, 52),
        wobblePhase: randomBetween(0, Math.PI * 2),
        wobbleAmp: randomBetween(5, 12),
        alpha: randomBetween(0.35, 0.72),
      });
    }
  }

  for (const plant of state.plants) {
    if (plant.growProgress < 1) {
      plant.growProgress = Math.min(1, plant.growProgress + safeDt * 2.2);
    }
  }

  for (const stone of state.stones) {
    if (stone.dropProgress < 1) {
      stone.dropProgress = Math.min(1, stone.dropProgress + safeDt * 2.6);
    }
  }

  const minLayer = Math.min(
    10,
    ...state.plants.map((p) => p.layerOrder),
    ...state.stones.map((s) => s.layerOrder)
  );
  const maxLayer = Math.max(
    18,
    ...state.plants.map((p) => p.layerOrder),
    ...state.stones.map((s) => s.layerOrder)
  );

  for (const fish of state.fish) {
    if (fish.spawnScale < 1) {
      fish.spawnScale = Math.min(1, fish.spawnScale + safeDt * 3.2);
    }

    if (fish.fleeTimer > 0) {
      fish.fleeTimer = Math.max(0, fish.fleeTimer - safeDt);
    }

    const isFleeing = fish.fleeTimer > 0;
    const fleeBoost = isFleeing ? 1 + (fish.fleeTimer / 1.0) * 1.35 : 1;

    let x = fish.xRatio * width;
    let y = fish.yRatio * height;

    const marginX = Math.max(46, fish.size * 0.68);
    const minY = waterTop + fish.size * 0.36 + 10;
    // Allow fish to swim deep down among the lower plant blades and rocks
    const maxY = approxFloor - fish.size * 0.26;

    const turnZone = Math.min(135, width * 0.19);
    const wasTurningLeft = fish.targetDir === -1;
    if (x < marginX + turnZone && fish.targetDir === -1) {
      fish.targetDir = 1;
    } else if (x > width - marginX - turnZone && fish.targetDir === 1) {
      fish.targetDir = -1;
    }

    // When reversing at a tank edge, pick a fresh depth and occasionally weave between plant layers
    if ((fish.targetDir === -1) !== wasTurningLeft) {
      fish.targetYRatio = randomBetween(0.24, 0.79);
      if (state.plants.length > 0 && Math.random() > 0.35) {
        fish.layerOrder = Math.round(randomBetween(minLayer - 1, maxLayer + 1));
      }
    }

    // Wandering vertical depth changes so fish climb and dive naturally across the tank
    fish.wanderTimer -= safeDt * motionFactor;
    if (fish.wanderTimer <= 0) {
      fish.wanderTimer = randomBetween(2.2, 5.2);
      fish.targetYRatio = randomBetween(0.23, 0.80);
    }

    // Slow, realistic angular turn (0 -> PI rad): ~1.7s for a calm turn, ~0.75s when fleeing
    const targetAngle = fish.targetDir === 1 ? 0 : Math.PI;
    const angleDiff = targetAngle - fish.turnAngle;
    const turnSpeed = isFleeing ? 4.2 : 1.85;
    if (Math.abs(angleDiff) > 0.001) {
      const step = Math.min(Math.abs(angleDiff), turnSpeed * safeDt * motionFactor);
      fish.turnAngle += Math.sign(angleDiff) * step;
    }

    fish.facing = Math.cos(fish.turnAngle);
    const sTurn = Math.sin(fish.turnAngle);

    // Forward velocity follows facing projection so fish never slide backwards mid-turn
    const desiredVx = fish.facing * fish.baseSpeed * fleeBoost * motionFactor;
    fish.vx += (desiredVx - fish.vx) * Math.min(1, safeDt * 4.5);

    // Vertical swimming toward targetYRatio + subtle U-turn arc + organic bobbing
    const targetY = Math.max(minY, Math.min(maxY, fish.targetYRatio * height));
    const maxVerticalSpeed = fish.baseSpeed * 0.62 * fleeBoost;
    const desiredVy = Math.max(
      -maxVerticalSpeed,
      Math.min(maxVerticalSpeed, (targetY - y) * 1.45)
    );
    fish.vy += (desiredVy - fish.vy) * Math.min(1, safeDt * 2.6);

    fish.bobPhase += safeDt * fish.bobFreq * motionFactor;
    const bobVelocity = Math.cos(fish.bobPhase) * fish.bobAmp * motionFactor;
    const turnArcVy = sTurn * Math.sin(fish.bobPhase * 0.7) * 14 * motionFactor;

    x += fish.vx * safeDt;
    y += (fish.vy + bobVelocity + turnArcVy) * safeDt;

    if (x < marginX) {
      x = marginX;
      fish.vx = Math.abs(fish.vx) * 0.35;
      fish.targetDir = 1;
    } else if (x > width - marginX) {
      x = width - marginX;
      fish.vx = -Math.abs(fish.vx) * 0.35;
      fish.targetDir = -1;
    }

    if (y < minY) {
      y = minY;
      fish.vy = Math.abs(fish.vy) * 0.45 + 10;
      fish.targetYRatio = randomBetween(0.35, 0.72);
    } else if (y > maxY) {
      y = maxY;
      fish.vy = -Math.abs(fish.vy) * 0.45 - 10;
      fish.targetYRatio = randomBetween(0.25, 0.58);
    }

    fish.xRatio = x / Math.max(1, width);
    fish.yRatio = y / Math.max(1, height);

    const speedRatio = Math.min(2.4, Math.abs(fish.vx) / Math.max(1, fish.baseSpeed));
    fish.tailPhase += safeDt * (4.8 + speedRatio * 7.0 + sTurn * 3.8) * motionFactor;
  }

  for (let i = state.bubbles.length - 1; i >= 0; i--) {
    const b = state.bubbles[i];
    b.y -= b.vy * safeDt;
    b.wobblePhase += safeDt * 3.5;
    b.x += Math.sin(b.wobblePhase) * b.wobbleAmp * safeDt;
    if (b.y <= waterTop + 2) {
      state.bubbles.splice(i, 1);
    }
  }

  for (let i = state.ripples.length - 1; i >= 0; i--) {
    const r = state.ripples[i];
    r.radius += safeDt * 95;
    r.alpha = Math.max(0, 0.62 * (1 - r.radius / r.maxRadius));
    if (r.radius >= r.maxRadius) {
      state.ripples.splice(i, 1);
    }
  }

  for (const p of state.particles) {
    p.driftPhase += safeDt * 0.9 * motionFactor;
    p.yRatio -= (p.speedY * safeDt * motionFactor) / Math.max(1, height);
    p.xRatio += (Math.sin(p.driftPhase) * 6 * safeDt * motionFactor) / Math.max(1, width);
    if (p.yRatio < 0.19) {
      p.yRatio = 0.84;
      p.xRatio = Math.random();
    }
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number
): void {
  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const canvasRatio = width / Math.max(1, height);
  let drawW = width;
  let drawH = height;
  let drawX = 0;
  let drawY = 0;

  if (canvasRatio > imgRatio) {
    drawW = width;
    drawH = width / imgRatio;
    drawY = (height - drawH) * 0.65;
  } else {
    drawH = height;
    drawW = height * imgRatio;
    drawX = (width - drawW) * 0.5;
  }

  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

export function renderAquarium(
  ctx: CanvasRenderingContext2D,
  state: AquariumState,
  width: number,
  height: number,
  sprites?: AquariumSprites | null,
  selectedDecorId?: string | null
): void {
  ctx.clearRect(0, 0, width, height);

  const waterTop = getWaterTopY(height);

  if (sprites?.backdrop && sprites.backdrop.complete) {
    drawCoverImage(ctx, sprites.backdrop, width, height);

    const waterOverlay = ctx.createLinearGradient(0, waterTop, 0, height);
    waterOverlay.addColorStop(0, 'rgba(56, 189, 248, 0.14)');
    waterOverlay.addColorStop(0.5, 'rgba(14, 165, 233, 0.18)');
    waterOverlay.addColorStop(1, 'rgba(8, 47, 73, 0.24)');
    ctx.fillStyle = waterOverlay;
    ctx.fillRect(0, 0, width, height);
  } else {
    const fallbackGrad = ctx.createLinearGradient(0, 0, 0, height);
    fallbackGrad.addColorStop(0, '#0E7490');
    fallbackGrad.addColorStop(0.25, '#0284C7');
    fallbackGrad.addColorStop(0.82, '#075985');
    fallbackGrad.addColorStop(1, '#C8A878');
    ctx.fillStyle = fallbackGrad;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.save();
  const rayCount = Math.max(4, Math.min(7, Math.floor(width / 170)));
  for (let i = 0; i < rayCount; i++) {
    const baseRatio = (i + 0.5) / rayCount;
    const sway = Math.sin(state.time * 0.42 + i * 1.9) * (width * 0.03);
    const rx = baseRatio * width + sway;
    const rayTopWidth = width * 0.04;
    const rayBottomWidth = width * 0.14;

    const rayGrad = ctx.createLinearGradient(rx, waterTop, rx + 25, height * 0.85);
    rayGrad.addColorStop(0, 'rgba(240, 249, 255, 0.14)');
    rayGrad.addColorStop(0.55, 'rgba(186, 230, 253, 0.05)');
    rayGrad.addColorStop(1, 'rgba(186, 230, 253, 0)');

    ctx.fillStyle = rayGrad;
    ctx.beginPath();
    ctx.moveTo(rx - rayTopWidth * 0.5, waterTop);
    ctx.lineTo(rx + rayTopWidth * 0.5, waterTop);
    ctx.lineTo(rx + rayBottomWidth * 0.5 + 30, height * 0.88);
    ctx.lineTo(rx - rayBottomWidth * 0.5 + 10, height * 0.88);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const causticCount = Math.max(5, Math.floor(width / 100));
  for (let c = 0; c < causticCount; c++) {
    const cx =
      ((c + 0.5) / causticCount) * width +
      Math.sin(state.time * 0.85 + c * 2.1) * 24;
    const cy = getSandY(cx, width, height) + 12 + Math.cos(state.time * 0.7 + c) * 4;
    const cw = 28 + Math.sin(state.time * 1.3 + c * 1.7) * 9;
    const ch = 6 + Math.cos(state.time * 1.1 + c) * 2;
    const alpha = 0.12 + Math.sin(state.time * 1.6 + c * 2.4) * 0.05;

    ctx.fillStyle = `rgba(224, 242, 254, ${Math.max(0.04, alpha)})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw, ch, Math.sin(c) * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of state.particles) {
    ctx.fillStyle = `rgba(224, 242, 254, ${p.alpha})`;
    ctx.beginPath();
    ctx.arc(p.xRatio * width, p.yRatio * height, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Unified depth-sorted rendering across plants, stones, AND fish so fish weave between plants!
  type SceneEntry =
    | { kind: 'plant'; item: Plant; layerOrder: number }
    | { kind: 'stone'; item: Stone; layerOrder: number }
    | { kind: 'fish'; item: Fish; layerOrder: number };

  const sceneEntries: SceneEntry[] = [
    ...state.plants.map((item) => ({ kind: 'plant' as const, item, layerOrder: item.layerOrder })),
    ...state.stones.map((item) => ({ kind: 'stone' as const, item, layerOrder: item.layerOrder })),
    ...state.fish.map((item) => ({ kind: 'fish' as const, item, layerOrder: item.layerOrder })),
  ];
  sceneEntries.sort((a, b) => a.layerOrder - b.layerOrder);

  for (const entry of sceneEntries) {
    if (entry.kind === 'stone') {
      const stone = entry.item;
      drawPhotoStone(
        ctx,
        stone,
        width,
        height,
        sprites?.stone ?? null,
        selectedDecorId === stone.id
      );
    } else if (entry.kind === 'plant') {
      const plant = entry.item;
      const sprite =
        plant.style === 'sword'
          ? sprites?.plants.sword ?? null
          : sprites?.plants.vallisneria ?? null;
      drawPhotoPlant(
        ctx,
        plant,
        state.time,
        width,
        height,
        sprite,
        selectedDecorId === plant.id
      );
    } else {
      const fish = entry.item;
      const sprite = sprites?.fish[fish.species] ?? null;
      drawPhotoFish(ctx, fish, state.time, width, height, sprite);
    }
  }

  for (const b of state.bubbles) {
    drawBubble(ctx, b);
  }

  for (const r of state.ripples) {
    ctx.save();
    ctx.strokeStyle = `rgba(224, 242, 254, ${r.alpha})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
    ctx.stroke();

    if (r.radius > 14) {
      ctx.strokeStyle = `rgba(186, 230, 253, ${r.alpha * 0.5})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPhotoStone(
  ctx: CanvasRenderingContext2D,
  stone: Stone,
  width: number,
  height: number,
  sprite: HTMLCanvasElement | null,
  isSelected: boolean
): void {
  const x = stone.xRatio * width;
  const groundY = getSandY(x, width, height) + stone.sandOffset + stone.depthOffset;
  const dropEase = easeOutCubic(stone.dropProgress);
  const dropOffset = (1 - dropEase) * -44;

  ctx.save();
  ctx.globalAlpha = Math.min(1, stone.dropProgress * 1.4);

  if (isSelected) {
    drawSelectionRing(ctx, x, groundY + 4, stone.width * 0.58, stone.height * 0.22);
  }

  ctx.fillStyle = `rgba(8, 47, 73, ${0.42 * dropEase})`;
  ctx.beginPath();
  ctx.ellipse(
    x,
    groundY + 4,
    stone.width * 0.52 * dropEase,
    stone.height * 0.16,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  if (sprite) {
    const { w: drawW, h: drawH } = getStoneDimensions(stone, sprite);
    const drawY = groundY - drawH + 8 + dropOffset;

    ctx.save();
    ctx.translate(x, drawY + drawH * 0.5);
    if (stone.flipX) ctx.scale(-1, 1);
    ctx.drawImage(sprite, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
    ctx.restore();
  } else {
    ctx.fillStyle = stone.baseColor;
    ctx.beginPath();
    ctx.ellipse(
      x,
      groundY - stone.height * 0.3 + dropOffset,
      stone.width * 0.45,
      stone.height * 0.4,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  ctx.restore();
}

function drawPhotoPlant(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  time: number,
  width: number,
  height: number,
  sprite: HTMLCanvasElement | null,
  isSelected: boolean
): void {
  const anchorX = plant.xRatio * width;
  const anchorY = getSandY(anchorX, width, height) + 8 + plant.sandOffset;
  const grow = easeOutCubic(plant.growProgress);
  const heightScale = Math.min(1.12, Math.max(0.68, height / 700)) * plant.scale * grow;

  ctx.save();

  if (isSelected) {
    drawSelectionRing(ctx, anchorX, anchorY - 2, 34 * plant.scale, 10);
  }

  ctx.fillStyle = `rgba(8, 47, 73, ${0.32 * grow})`;
  ctx.beginPath();
  ctx.ellipse(anchorX, anchorY - 2, 26 * plant.scale * grow, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (sprite) {
    const targetH = (plant.style === 'vallisneria' ? 195 : 165) * heightScale;
    const aspect = sprite.width / Math.max(1, sprite.height);
    const targetW = targetH * aspect;

    const slices = 26;
    const srcSliceH = sprite.height / slices;
    const dstSliceH = targetH / slices;

    ctx.translate(anchorX, anchorY);
    if (plant.flipX) ctx.scale(-1, 1);

    for (let i = 0; i < slices; i++) {
      const sy = i * srcSliceH;
      const t = 1 - (i + 0.5) / slices;

      const currentDrift = Math.sin(time * 0.55) * 4 * t;
      const waveX =
        Math.sin(time * plant.swaySpeed + plant.phaseOffset - t * 2.9) *
          (14 * Math.pow(t, 1.45)) +
        currentDrift;

      const dy = -targetH + i * dstSliceH;
      ctx.drawImage(
        sprite,
        0,
        sy,
        sprite.width,
        srcSliceH + 0.8,
        -targetW * 0.5 + waveX,
        dy,
        targetW,
        dstSliceH + 0.8
      );
    }
  } else {
    for (const blade of plant.blades) {
      const h = blade.height * heightScale;
      const sway = Math.sin(time * plant.swaySpeed + blade.phaseOffset) * 10;
      ctx.fillStyle = plant.baseColor;
      ctx.beginPath();
      ctx.moveTo(anchorX + blade.offsetX - 3, anchorY);
      ctx.quadraticCurveTo(
        anchorX + blade.offsetX + sway * 0.5,
        anchorY - h * 0.5,
        anchorX + blade.offsetX + sway,
        anchorY - h
      );
      ctx.quadraticCurveTo(
        anchorX + blade.offsetX + sway * 0.5 + 4,
        anchorY - h * 0.5,
        anchorX + blade.offsetX + 3,
        anchorY
      );
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawPhotoFish(
  ctx: CanvasRenderingContext2D,
  fish: Fish,
  time: number,
  width: number,
  height: number,
  sprite: HTMLCanvasElement | null
): void {
  const x = fish.xRatio * width;
  const y = fish.yRatio * height;
  const len = fish.size;
  const scale = easeOutCubic(fish.spawnScale);

  const absFacing = Math.abs(fish.facing);
  const turnSin = Math.sin(fish.turnAngle); // 0 when broadside, 1 at 90deg frontal
  const dirSign = fish.facing >= 0 ? 1 : -1;

  // Volumetric 3D-like turning: stays wide & swells vertically instead of collapsing like a paper sheet
  const broadScaleX = dirSign * Math.max(0.36, Math.pow(absFacing, 0.52));
  const girthScaleY = 1 + turnSin * 0.28;

  const isFleeing = fish.fleeTimer > 0;
  const waveAmp = (isFleeing ? 8.5 : 4.2) * (len / 80);

  const sandY = getSandY(x, width, height);
  const distToSand = sandY - y;
  if (distToSand > 0 && distToSand < 150) {
    const shadowAlpha = (1 - distToSand / 150) * 0.24 * scale;
    ctx.save();
    ctx.fillStyle = `rgba(8, 47, 73, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(x, sandY + 4, len * 0.38 * scale, len * 0.07 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(x, y);

  // Tilt nose smoothly upward when climbing and downward when diving
  const speedHoriz = Math.max(20, Math.abs(fish.vx));
  const pitch = Math.max(-0.42, Math.min(0.42, Math.atan2(fish.vy, speedHoriz) * 0.65)) * dirSign;
  ctx.rotate(pitch);
  ctx.scale(broadScaleX * scale, girthScaleY * scale);

  if (sprite) {
    const aspect = sprite.width / Math.max(1, sprite.height);
    const drawW = len;
    const drawH = drawW / aspect;

    const slices = 22;
    const srcSliceW = sprite.width / slices;
    const dstSliceW = drawW / slices;

    for (let i = 0; i < slices; i++) {
      const u = (i + 0.5) / slices; // 0 = tail, 1 = nose
      const s = 1 - u; // 0 = nose, 1 = tail
      const flex = Math.pow(Math.max(0, s - 0.2), 1.45);

      const swimWave = Math.sin(fish.tailPhase - s * 3.6) * waveAmp * flex;
      const turnBend = turnSin * Math.pow(s, 1.3) * (len * 0.11);
      const waveY = swimWave + turnBend;

      const perspScaleY = 1 + turnSin * (0.14 - s * 0.22);
      const sliceH = drawH * perspScaleY;

      const sx = i * srcSliceW;
      const dx = -drawW * 0.5 + i * dstSliceW;

      ctx.drawImage(
        sprite,
        sx,
        0,
        srcSliceW + 0.8,
        sprite.height,
        dx,
        -sliceH * 0.5 + waveY,
        dstSliceW + 0.8,
        sliceH
      );
    }

    const shimmer = 0.08 + Math.sin(time * 2.5 + x * 0.02) * 0.04;
    ctx.fillStyle = `rgba(186, 230, 253, ${Math.max(0.03, shimmer)})`;
    ctx.beginPath();
    ctx.ellipse(0, -drawH * 0.22, drawW * 0.28, drawH * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = fish.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.42, len * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawBubble(ctx: CanvasRenderingContext2D, b: Bubble): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
  const bubbleGrad = ctx.createRadialGradient(
    b.x - b.radius * 0.3,
    b.y - b.radius * 0.3,
    b.radius * 0.1,
    b.x,
    b.y,
    b.radius
  );
  bubbleGrad.addColorStop(0, `rgba(255, 255, 255, ${b.alpha * 0.42})`);
  bubbleGrad.addColorStop(0.7, `rgba(186, 230, 253, ${b.alpha * 0.14})`);
  bubbleGrad.addColorStop(1, `rgba(255, 255, 255, ${b.alpha * 0.75})`);
  ctx.fillStyle = bubbleGrad;
  ctx.fill();

  ctx.strokeStyle = `rgba(255, 255, 255, ${b.alpha * 0.88})`;
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(
    b.x - b.radius * 0.32,
    b.y - b.radius * 0.32,
    Math.max(0.7, b.radius * 0.24),
    0,
    Math.PI * 2
  );
  ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, b.alpha + 0.15)})`;
  ctx.fill();
  ctx.restore();
}
