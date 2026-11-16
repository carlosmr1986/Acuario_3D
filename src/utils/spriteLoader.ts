import backdropUrl from '../assets/images/aquarium_backdrop_1794773613348.jpg';
import plantVallisneriaUrl from '../assets/images/plant_vallisneria_1794773612377.jpg';
import plantSwordUrl from '../assets/images/plant_amazon_sword_1794773613212.jpg';
import stoneRockUrl from '../assets/images/stone_aquarium_rock_1794773614993.jpg';
import fishClownUrl from '../assets/images/fish_clownfish_1794773613069.jpg';
import fishTangUrl from '../assets/images/fish_blue_tang_1794773615252.jpg';
import fishGoldfishUrl from '../assets/images/fish_orange_goldfish_1794773615976.jpg';

export interface AquariumSprites {
  backdrop: HTMLImageElement | null;
  plants: {
    vallisneria: HTMLCanvasElement | null;
    sword: HTMLCanvasElement | null;
  };
  stone: HTMLCanvasElement | null;
  fish: {
    clown: HTMLCanvasElement | null;
    tang: HTMLCanvasElement | null;
    goldfish: HTMLCanvasElement | null;
  };
  fishPhotos: {
    clown: HTMLImageElement | null;
    tang: HTMLImageElement | null;
    goldfish: HTMLImageElement | null;
  };
  loaded: boolean;
}

type SpriteKind = 'plant' | 'stone' | 'fish-clown' | 'fish-tang' | 'fish-goldfish';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * High-precision background removal and translucency processor:
 * 1. Removes outer white studio backgrounds (BFS flood-fill for fish to protect internal markings;
 *    global neutral-white keying for plants/rocks to clear enclosed leaf gaps).
 * 2. Computes foreground distance-to-background map for multi-pixel edge feathering.
 * 3. Un-premultiplies white studio spill on edge pixels so zero white cutout halo remains.
 * 4. Applies natural botanical translucency to plant leaves and membrane translucency to fish fins.
 */
function createTransparentSprite(
  img: HTMLImageElement,
  kind: SpriteKind,
  options?: {
    maxDim?: number;
    cropBottomRatio?: number;
  }
): HTMLCanvasElement {
  const maxDim = options?.maxDim ?? 520;
  const cropBottomRatio = options?.cropBottomRatio ?? 0;

  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const fullH = Math.max(1, Math.round(img.naturalHeight * scale));
  const h = Math.max(1, Math.round(fullH * (1 - cropBottomRatio)));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.drawImage(img, 0, 0, w, fullH);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const total = w * h;

  const isPlant = kind === 'plant';
  const isStone = kind === 'stone';
  const isFish = kind.startsWith('fish');

  // Tuned thresholds to catch JPEG anti-aliased bright/grey studio background pixels
  const whiteMin = isPlant || isStone ? 186 : 204;
  const satMax = isPlant || isStone ? 44 : 36;

  const isNeutralBright = (idx: number, minThreshold = whiteMin, maxSat = satMax): boolean => {
    const p = idx * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const maxC = r > g ? (r > b ? r : b) : g > b ? g : b;
    const minC = r < g ? (r < b ? r : b) : g < b ? g : b;
    return minC >= minThreshold && maxC - minC <= maxSat;
  };

  const bgMask = new Uint8Array(total);

  if (isPlant) {
    // Global keying removes both outer studio white AND trapped white gaps between crossing leaves
    for (let i = 0; i < total; i++) {
      if (isNeutralBright(i)) {
        bgMask[i] = 1;
      }
    }
  } else {
    // 4-connected border BFS flood-fill protects internal markings (clownfish stripes, wet stone glints)
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    const enqueue = (idx: number) => {
      if (bgMask[idx] === 0 && isNeutralBright(idx)) {
        bgMask[idx] = 1;
        queue[tail++] = idx;
      }
    };

    for (let x = 0; x < w; x++) {
      enqueue(x);
      enqueue((h - 1) * w + x);
    }
    for (let y = 1; y < h - 1; y++) {
      enqueue(y * w);
      enqueue(y * w + (w - 1));
    }

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % w;
      const y = (idx - x) / w;
      if (x > 0) enqueue(idx - 1);
      if (x < w - 1) enqueue(idx + 1);
      if (y > 0) enqueue(idx - w);
      if (y < h - 1) enqueue(idx + w);
    }

    // For tang & goldfish (no enclosed white body stripes), also clear any small enclosed pockets
    if (isFish && kind !== 'fish-clown') {
      for (let i = 0; i < total; i++) {
        if (bgMask[i] === 0 && isNeutralBright(i, 214, 24)) {
          bgMask[i] = 1;
        }
      }
    }
  }

  // Erode isolated 1px speckles in background boundary so edges stay clean
  const distToBg = new Uint16Array(total);
  const INF = 9999;
  for (let i = 0; i < total; i++) {
    distToBg[i] = bgMask[i] === 1 ? 0 : INF;
  }

  // Fast 2-pass Manhattan distance transform
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (distToBg[idx] === 0) continue;
      let d = distToBg[idx];
      if (x > 0) d = Math.min(d, distToBg[idx - 1] + 1);
      if (y > 0) d = Math.min(d, distToBg[idx - w] + 1);
      distToBg[idx] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const idx = y * w + x;
      if (distToBg[idx] === 0) continue;
      let d = distToBg[idx];
      if (x < w - 1) d = Math.min(d, distToBg[idx + 1] + 1);
      if (y < h - 1) d = Math.min(d, distToBg[idx + w] + 1);
      distToBg[idx] = d;
    }
  }

  // First compute tight bounding box of foreground pixels (dist >= 2) to normalize fin geometry
  let fgMinX = w;
  let fgMaxX = 0;
  let fgMinY = h;
  let fgMaxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (distToBg[idx] >= 2) {
        if (x < fgMinX) fgMinX = x;
        if (x > fgMaxX) fgMaxX = x;
        if (y < fgMinY) fgMinY = y;
        if (y > fgMaxY) fgMaxY = y;
      }
    }
  }
  const fgW = Math.max(1, fgMaxX - fgMinX);
  const fgH = Math.max(1, fgMaxY - fgMinY);

  let cropMinX = w;
  let cropMinY = h;
  let cropMaxX = 0;
  let cropMaxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const p = idx * 4;
      const dist = distToBg[idx];

      if (dist === 0) {
        data[p + 3] = 0;
        continue;
      }

      let r = data[p];
      let g = data[p + 1];
      let b = data[p + 2];
      const maxC = r > g ? (r > b ? r : b) : g > b ? g : b;
      const minC = r < g ? (r < b ? r : b) : g < b ? g : b;
      const sat = maxC - minC;
      const lum = (r + g + b) / 3;

      let alpha = 255;

      // Edge white-halo removal & color decontamination (strips white studio bleed)
      if (dist <= 3) {
        if (dist === 1) {
          // Drop residual pale neutral fringe completely
          if (lum > 155 && sat < 45) {
            data[p + 3] = 0;
            continue;
          }
          const coverage = sat < 25 ? smoothstep(220, 120, lum) * 0.6 : smoothstep(245, 165, lum) * 0.72;
          alpha = Math.round(255 * Math.max(0.08, coverage));
          // Un-premultiply white studio background contribution
          const cov = Math.max(0.35, alpha / 255);
          r = (r - (1 - cov) * 255) / cov;
          g = (g - (1 - cov) * 255) / cov;
          b = (b - (1 - cov) * 255) / cov;
        } else if (dist === 2) {
          if (lum > 185 && sat < 36) {
            alpha = Math.round(255 * smoothstep(235, 175, lum) * 0.7);
          } else {
            alpha = 228;
          }
          // Light white-fringe decontamination
          r = r * 1.06 - 14;
          g = g * 1.06 - 14;
          b = b * 1.06 - 14;
        } else if (dist === 3 && lum > 205 && sat < 28) {
          alpha = 235;
        }
      }

      // Botanical translucency for real aquatic leaves
      if (isPlant) {
        // Thinner sunlit green leaves let subtle blue water shine through
        const leafTranslucency = 0.88 - smoothstep(115, 205, lum) * 0.14;
        alpha = Math.round(alpha * leafTranslucency);
      }

      // Membrane translucency for fish fins (caudal, dorsal, ventral/anal fins)
      if (isFish) {
        // Normalized coordinates inside tight fish bounding box (nose = 1, tail = 0)
        const nx = (x - fgMinX) / fgW;
        const ny = (y - fgMinY) / fgH;

        // Detect fin regions while keeping body torso & head 100% solid
        const tailWeight = 1 - smoothstep(0.18, 0.34, nx); // left side tail fin
        const dorsalWeight = 1 - smoothstep(0.08, 0.24, ny); // top dorsal fin
        const ventralWeight = smoothstep(0.72, 0.88, ny); // bottom pelvic/anal fins
        const finZone = Math.max(tailWeight, dorsalWeight * (1 - smoothstep(0.68, 0.82, nx)), ventralWeight * (1 - smoothstep(0.65, 0.80, nx)));

        if (finZone > 0.05) {
          // Thin fin membranes are shallower (smaller dist) and brighter than thick muscle
          const thinness = 1 - smoothstep(4, 24, dist);
          const brightnessBoost = smoothstep(110, 225, lum) * 0.35;
          const translucency = Math.min(0.46, finZone * (0.28 + thinness * 0.22 + brightnessBoost));
          alpha = Math.round(alpha * (1 - translucency));
        }
      }

      // Subtle underwater ambient color integration so sprites share the tank lighting
      r = clampByte(r * 0.91 + 10 * 0.09);
      g = clampByte(g * 0.95 + 145 * 0.05);
      b = clampByte(b * 0.97 + 200 * 0.03);

      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = clampByte(alpha);

      if (data[p + 3] > 14) {
        if (x < cropMinX) cropMinX = x;
        if (x > cropMaxX) cropMaxX = x;
        if (y < cropMinY) cropMinY = y;
        if (y > cropMaxY) cropMaxY = y;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  if (cropMaxX <= cropMinX || cropMaxY <= cropMinY) {
    return canvas;
  }

  const cropW = cropMaxX - cropMinX + 1;
  const cropH = cropMaxY - cropMinY + 1;
  const cropped = document.createElement('canvas');
  cropped.width = cropW;
  cropped.height = cropH;
  const croppedCtx = cropped.getContext('2d');
  if (croppedCtx) {
    croppedCtx.drawImage(canvas, cropMinX, cropMinY, cropW, cropH, 0, 0, cropW, cropH);
  }
  return cropped;
}

export async function loadAquariumSprites(): Promise<AquariumSprites> {
  const [
    backdropRes,
    vallisneriaRes,
    swordRes,
    stoneRes,
    clownRes,
    tangRes,
    goldfishRes,
  ] = await Promise.allSettled([
    loadImage(backdropUrl),
    loadImage(plantVallisneriaUrl),
    loadImage(plantSwordUrl),
    loadImage(stoneRockUrl),
    loadImage(fishClownUrl),
    loadImage(fishTangUrl),
    loadImage(fishGoldfishUrl),
  ]);

  return {
    backdrop: backdropRes.status === 'fulfilled' ? backdropRes.value : null,
    plants: {
      vallisneria:
        vallisneriaRes.status === 'fulfilled'
          ? createTransparentSprite(vallisneriaRes.value, 'plant', {
              maxDim: 560,
              cropBottomRatio: 0.14, // bury roots cleanly under sand
            })
          : null,
      sword:
        swordRes.status === 'fulfilled'
          ? createTransparentSprite(swordRes.value, 'plant', {
              maxDim: 560,
              cropBottomRatio: 0.14, // bury roots cleanly under sand
            })
          : null,
    },
    stone:
      stoneRes.status === 'fulfilled'
        ? createTransparentSprite(stoneRes.value, 'stone', {
            maxDim: 460,
          })
        : null,
    fish: {
      clown:
        clownRes.status === 'fulfilled'
          ? createTransparentSprite(clownRes.value, 'fish-clown', {
              maxDim: 440,
            })
          : null,
      tang:
        tangRes.status === 'fulfilled'
          ? createTransparentSprite(tangRes.value, 'fish-tang', {
              maxDim: 440,
            })
          : null,
      goldfish:
        goldfishRes.status === 'fulfilled'
          ? createTransparentSprite(goldfishRes.value, 'fish-goldfish', {
              maxDim: 440,
            })
          : null,
    },
    fishPhotos: {
      clown: clownRes.status === 'fulfilled' ? clownRes.value : null,
      tang: tangRes.status === 'fulfilled' ? tangRes.value : null,
      goldfish: goldfishRes.status === 'fulfilled' ? goldfishRes.value : null,
    },
    loaded: true,
  };
}
