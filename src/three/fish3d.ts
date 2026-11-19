import * as THREE from 'three';
import type { FishSpecies } from '../types/aquarium';
import { applyWaterDepthFog, type WaterFogUniforms } from './waterFogShader';

export interface FishUniforms {
  uTime: { value: number };
  uSwimPhase: { value: number };
  uScullPhase: { value: number };
  uFinWaveAmp: { value: number };
  uPectWaveAmp: { value: number };
}

export interface FishSkeletonBones {
  spineCranium: THREE.Bone;
  spine1: THREE.Bone;
  spine2: THREE.Bone;
  spine3: THREE.Bone;
  spine4: THREE.Bone;
  spine5: THREE.Bone;
  caudalMid: THREE.Bone;
  caudalTip: THREE.Bone;
  jaw: THREE.Bone;
  operculumL: THREE.Bone;
  operculumR: THREE.Bone;
  pectLBase: THREE.Bone;
  pectLMid: THREE.Bone;
  pectLTip: THREE.Bone;
  pectRBase: THREE.Bone;
  pectRMid: THREE.Bone;
  pectRTip: THREE.Bone;
  pelvicLBase: THREE.Bone;
  pelvicLTip: THREE.Bone;
  pelvicRBase: THREE.Bone;
  pelvicRTip: THREE.Bone;
}

export interface FishRig3D {
  root: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: FishSkeletonBones;
  uniforms: FishUniforms;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

export interface SpeciesTextureSet {
  bodyMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  finAtlasMap: THREE.CanvasTexture;
  eyeMap: THREE.CanvasTexture;
}

export interface FishKinematicInput {
  swimPhase: number;
  scullPhase: number;
  breathPhase: number;
  effort: number; // ~0.25 (glide) .. 1.0 (cruise) .. 2.2 (burst/flee)
  speedNorm: number; // ~0.2 .. 2.6
  yawRate: number; // signed rad/s
  pitchAngle: number; // rad
  chompRatio: number; // 0..1
  motionScale: number; // 0.25 (reduced motion) or 1.0
  turnBendSmooth: number; // smoothed signed turn bend
}

const SPECIES_PALETTES: Record<
  FishSpecies,
  {
    primary: string;
    secondary: string;
    trim: string;
    iris: string;
    aspectHeight: number;
    aspectWidth: number;
  }
> = {
  clown: {
    primary: '#f45e16',
    secondary: '#fff7ee',
    trim: '#141214',
    iris: '#f59e0b',
    aspectHeight: 0.44,
    aspectWidth: 0.23,
  },
  tang: {
    primary: '#1666d8',
    secondary: '#0f172a',
    trim: '#facc15',
    iris: '#38bdf8',
    aspectHeight: 0.56,
    aspectWidth: 0.19,
  },
  goldfish: {
    primary: '#f97316',
    secondary: '#fff8ef',
    trim: '#fde68a',
    iris: '#fbbf24',
    aspectHeight: 0.45,
    aspectWidth: 0.24,
  },
};

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Extracts a clean 512x256 body-torso photographic texture from a side-profile fish photo,
 * and enhances the goldfish with subtle Kohaku orange-and-white koi carp markings while keeping
 * natural scale iridescence and shading.
 */
function buildBodyTexture(
  img: HTMLImageElement | null,
  species: FishSpecies,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const outW = 512;
  const outH = 256;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const palette = SPECIES_PALETTES[species];
  const grad = ctx.createLinearGradient(0, 0, 0, outH);
  grad.addColorStop(0, palette.primary);
  grad.addColorStop(0.55, palette.primary);
  grad.addColorStop(1, palette.secondary);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, outW, outH);

  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const srcW = Math.min(480, img.naturalWidth);
    const srcH = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * srcW));
    const tmp = document.createElement('canvas');
    tmp.width = srcW;
    tmp.height = srcH;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    if (tctx) {
      tctx.drawImage(img, 0, 0, srcW, srcH);
      const raw = tctx.getImageData(0, 0, srcW, srcH);
      const data = raw.data;
      const total = srcW * srcH;

      const bg = new Uint8Array(total);
      const queue = new Int32Array(total);
      let head = 0;
      let tail = 0;
      const isWhiteBg = (idx: number) => {
        const p = idx * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const maxC = r > g ? (r > b ? r : b) : g > b ? g : b;
        const minC = r < g ? (r < b ? r : b) : g < b ? g : b;
        return minC >= 204 && maxC - minC <= 38;
      };
      const enq = (idx: number) => {
        if (bg[idx] === 0 && isWhiteBg(idx)) {
          bg[idx] = 1;
          queue[tail++] = idx;
        }
      };
      for (let x = 0; x < srcW; x++) {
        enq(x);
        enq((srcH - 1) * srcW + x);
      }
      for (let y = 1; y < srcH - 1; y++) {
        enq(y * srcW);
        enq(y * srcW + srcW - 1);
      }
      while (head < tail) {
        const idx = queue[head++];
        const x = idx % srcW;
        const y = (idx - x) / srcW;
        if (x > 0) enq(idx - 1);
        if (x < srcW - 1) enq(idx + 1);
        if (y > 0) enq(idx - srcW);
        if (y < srcH - 1) enq(idx + srcW);
      }

      let minX = srcW;
      let maxX = 0;
      let minY = srcH;
      let maxY = 0;
      for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < srcW; x++) {
          if (bg[y * srcW + x] === 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      const fgW = Math.max(1, maxX - minX + 1);
      const fgH = Math.max(1, maxY - minY + 1);
      const torsoStartRatio = species === 'goldfish' ? 0.41 : species === 'tang' ? 0.20 : 0.21;
      const torsoStartX = minX + Math.round(fgW * torsoStartRatio);
      const torsoEndX = maxX - 2;
      const torsoSpanX = Math.max(1, torsoEndX - torsoStartX);

      const colTop = new Float32Array(torsoSpanX + 1);
      const colBot = new Float32Array(torsoSpanX + 1);

      for (let ix = 0; ix <= torsoSpanX; ix++) {
        const sx = torsoStartX + ix;
        let firstY = -1;
        let lastY = -1;
        for (let y = minY; y <= maxY; y++) {
          if (bg[y * srcW + sx] === 0) {
            if (firstY === -1) firstY = y;
            lastY = y;
          }
        }
        if (firstY === -1) {
          colTop[ix] = minY + fgH * 0.28;
          colBot[ix] = maxY - fgH * 0.22;
        } else {
          const span = lastY - firstY;
          const u = ix / torsoSpanX;
          const topTrim = u > 0.1 && u < 0.78 ? 0.16 : 0.08;
          const botTrim = u > 0.12 && u < 0.72 ? 0.15 : 0.08;
          colTop[ix] = firstY + span * topTrim;
          colBot[ix] = lastY - span * botTrim;
        }
      }

      const smoothTop = new Float32Array(torsoSpanX + 1);
      const smoothBot = new Float32Array(torsoSpanX + 1);
      const rad = 5;
      for (let ix = 0; ix <= torsoSpanX; ix++) {
        let sumT = 0;
        let sumB = 0;
        let count = 0;
        for (let k = -rad; k <= rad; k++) {
          const j = Math.max(0, Math.min(torsoSpanX, ix + k));
          sumT += colTop[j];
          sumB += colBot[j];
          count++;
        }
        smoothTop[ix] = sumT / count;
        smoothBot[ix] = Math.max(smoothTop[ix] + 8, sumB / count);
      }

      const outImg = ctx.createImageData(outW, outH);
      const outData = outImg.data;

      for (let ox = 0; ox < outW; ox++) {
        const u = ox / (outW - 1);
        const fx = u * torsoSpanX;
        const ix0 = Math.min(torsoSpanX, Math.floor(fx));
        const ix1 = Math.min(torsoSpanX, ix0 + 1);
        const fracX = fx - ix0;
        const topY = smoothTop[ix0] * (1 - fracX) + smoothTop[ix1] * fracX;
        const botY = smoothBot[ix0] * (1 - fracX) + smoothBot[ix1] * fracX;
        const sx = Math.min(srcW - 1, Math.max(0, Math.round(torsoStartX + fx)));

        for (let oy = 0; oy < outH; oy++) {
          const vNorm = oy / (outH - 1);
          const sampleY = topY + (botY - topY) * (0.04 + vNorm * 0.92);
          const sy = Math.min(srcH - 1, Math.max(0, Math.round(sampleY)));

          let chosenY = sy;
          if (bg[chosenY * srcW + sx] === 1) {
            const center = Math.round((topY + botY) * 0.5);
            const step = chosenY < center ? 1 : -1;
            for (let k = 1; k < 24; k++) {
              const cand = chosenY + step * k;
              if (cand >= 0 && cand < srcH && bg[cand * srcW + sx] === 0) {
                chosenY = cand;
                break;
              }
            }
          }

          const sp = (chosenY * srcW + sx) * 4;
          const dp = (oy * outW + ox) * 4;
          let r = data[sp];
          let g = data[sp + 1];
          let b = data[sp + 2];

          const dorsalDarken = 1 - Math.max(0, 0.25 - vNorm) * 0.45;
          r = clampByte(r * dorsalDarken);
          g = clampByte(g * dorsalDarken);
          b = clampByte(b * dorsalDarken);

          // Softly blend surrounding cheek pigment over the 2D photo iris/pupil in the socket zone
          // so only the 3D dual-layer eyeball renders with zero double-eye artifact
          const eyeDu = (u - 0.815) / 0.085;
          const eyeDv = (vNorm - 0.40) / 0.16;
          const eyeR2 = eyeDu * eyeDu + eyeDv * eyeDv;
          if (eyeR2 < 1.0) {
            const blend = 1 - eyeR2;
            const cheekHue =
              species === 'tang'
                ? [22, 102, 216]
                : species === 'clown'
                  ? [240, 102, 24]
                  : [228, 78, 16];
            const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
            if (lum < 0.48) {
              const k = Math.min(1, blend * 1.45);
              r = clampByte(r * (1 - k) + cheekHue[0] * k);
              g = clampByte(g * (1 - k) + cheekHue[1] * k);
              b = clampByte(b * (1 - k) + cheekHue[2] * k);
            }
          }

          // For the goldfish/koi, blend organic Kohaku pearly-white belly & koi saddle patches
          // while preserving underlying scale luminance & micro-detail
          if (species === 'goldfish') {
            const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
            const bellyFade = Math.max(0, Math.min(1, (vNorm - 0.64) / 0.28));
            const patch1 = Math.exp(
              -(Math.pow((u - 0.34) / 0.11, 2) + Math.pow((vNorm - 0.32) / 0.28, 2))
            );
            const patch2 = Math.exp(
              -(Math.pow((u - 0.62) / 0.085, 2) + Math.pow((vNorm - 0.44) / 0.26, 2))
            );
            const patch3 = Math.exp(
              -(Math.pow((u - 0.11) / 0.075, 2) + Math.pow((vNorm - 0.42) / 0.22, 2))
            );
            const wave = Math.sin(u * 26 + vNorm * 14) * 0.08;
            const koiRaw = Math.max(bellyFade * 0.88, Math.max(patch1, Math.max(patch2, patch3)) + wave);
            const whiteMask = Math.max(0, Math.min(1, (koiRaw - 0.42) / 0.22));
            if (whiteMask > 0.005) {
              const pearl = 216 + lum * 38;
              r = clampByte(r * (1 - whiteMask) + pearl * whiteMask);
              g = clampByte(g * (1 - whiteMask) + pearl * 0.985 * whiteMask);
              b = clampByte(b * (1 - whiteMask) + pearl * 0.96 * whiteMask);
            }
          }

          outData[dp] = r;
          outData[dp + 1] = g;
          outData[dp + 2] = b;
          outData[dp + 3] = 255;
        }
      }
      ctx.putImageData(outImg, 0, 0);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds procedural overlapping diamond fish-scale normal & roughness maps (linear NoColorSpace).
 */
function buildScaleMaps(maxAnisotropy: number): {
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const w = 512;
  const h = 256;

  const heightBuf = new Float32Array(w * h);
  const scaleCols = 44;
  const scaleRows = 22;

  for (let y = 0; y < h; y++) {
    const fy = (y / h) * scaleRows;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const headFade = 1 - Math.max(0, Math.min(1, (u - 0.68) / 0.14));

      const row = Math.floor(fy);
      const fx = (x / w) * scaleCols + (row % 2) * 0.5;
      const dx = fx - Math.floor(fx) - 0.5;
      const dy = fy - row - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dome = Math.max(0, 1 - dist * 1.75);
      const latDist = Math.abs(y / h - 0.46);
      const lateralGroove = latDist < 0.015 ? -0.18 * (1 - latDist / 0.015) : 0;

      heightBuf[y * w + x] = (Math.pow(dome, 0.72) * 0.85 + lateralGroove) * headFade;
    }
  }

  const normCanvas = document.createElement('canvas');
  normCanvas.width = w;
  normCanvas.height = h;
  const nctx = normCanvas.getContext('2d')!;
  const normImg = nctx.createImageData(w, h);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = w;
  roughCanvas.height = h;
  const rctx = roughCanvas.getContext('2d')!;
  const roughImg = rctx.createImageData(w, h);

  const strength = 1.55;
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;

      const dX = (heightBuf[y * w + xp] - heightBuf[y * w + xm]) * strength;
      const dY = (heightBuf[yp * w + x] - heightBuf[ym * w + x]) * strength;
      const nx = -dX;
      const ny = -dY;
      const nz = 1.0;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);

      const p = (y * w + x) * 4;
      normImg.data[p] = clampByte((nx * invLen * 0.5 + 0.5) * 255);
      normImg.data[p + 1] = clampByte((ny * invLen * 0.5 + 0.5) * 255);
      normImg.data[p + 2] = clampByte((nz * invLen * 0.5 + 0.5) * 255);
      normImg.data[p + 3] = 255;

      const hVal = heightBuf[y * w + x];
      const roughByte = clampByte(200 - hVal * 48);
      roughImg.data[p] = roughByte;
      roughImg.data[p + 1] = roughByte;
      roughImg.data[p + 2] = roughByte;
      roughImg.data[p + 3] = 255;
    }
  }
  nctx.putImageData(normImg, 0, 0);
  rctx.putImageData(roughImg, 0, 0);

  const normalMap = new THREE.CanvasTexture(normCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = maxAnisotropy;
  normalMap.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = maxAnisotropy;
  roughnessMap.needsUpdate = true;

  return { normalMap, roughnessMap };
}

/**
 * Generates a unified 512x512 4-quadrant translucent rayed fin atlas:
 * - Top-Left: Caudal tail fin
 * - Top-Right: Dorsal fin
 * - Bottom-Left: Anal fin
 * - Bottom-Right: Pectoral & pelvic paired fins
 */
function buildFinAtlasTexture(
  species: FishSpecies,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const size = 512;
  const q = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const pal = SPECIES_PALETTES[species];
  ctx.clearRect(0, 0, size, size);

  // 1. CAUDAL (Top-Left: [0..256, 0..256]) — root at right edge (x=q-6), trailing edge at left (x=8)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(q - 4, q * 0.34);
  ctx.bezierCurveTo(q * 0.62, q * 0.14, q * 0.24, q * 0.04, 10, q * 0.13);
  if (species === 'clown') {
    ctx.bezierCurveTo(4, q * 0.34, 4, q * 0.66, 10, q * 0.87);
  } else if (species === 'goldfish') {
    // Flowing deeply scalloped Koi/Veiltail caudal fork
    ctx.bezierCurveTo(q * 0.26, q * 0.40, q * 0.26, q * 0.60, 10, q * 0.87);
  } else {
    ctx.bezierCurveTo(q * 0.18, q * 0.38, q * 0.18, q * 0.62, 10, q * 0.87);
  }
  ctx.bezierCurveTo(q * 0.24, q * 0.96, q * 0.62, q * 0.86, q - 4, q * 0.66);
  ctx.closePath();
  ctx.clip();

  const cGrad = ctx.createLinearGradient(q - 4, q * 0.5, 6, q * 0.5);
  if (species === 'clown') {
    cGrad.addColorStop(0, 'rgba(244, 94, 22, 0.96)');
    cGrad.addColorStop(0.58, 'rgba(247, 112, 34, 0.88)');
    cGrad.addColorStop(0.76, 'rgba(22, 18, 20, 0.92)');
    cGrad.addColorStop(0.92, 'rgba(255, 250, 245, 0.64)');
    cGrad.addColorStop(1, 'rgba(255, 255, 255, 0.28)');
  } else if (species === 'tang') {
    cGrad.addColorStop(0, 'rgba(18, 42, 92, 0.95)');
    cGrad.addColorStop(0.25, 'rgba(245, 204, 24, 0.88)');
    cGrad.addColorStop(0.85, 'rgba(250, 212, 36, 0.62)');
    cGrad.addColorStop(1, 'rgba(15, 23, 42, 0.72)');
  } else {
    cGrad.addColorStop(0, 'rgba(246, 106, 18, 0.99)');
    cGrad.addColorStop(0.52, 'rgba(249, 126, 34, 0.92)');
    cGrad.addColorStop(0.82, 'rgba(255, 224, 186, 0.74)');
    cGrad.addColorStop(1, 'rgba(255, 252, 248, 0.48)');
  }
  ctx.fillStyle = cGrad;
  ctx.fillRect(0, 0, q, q);

  ctx.lineCap = 'round';
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    const y0 = q * (0.36 + t * 0.28);
    const y1 = q * (0.10 + t * 0.80);
    ctx.strokeStyle =
      species === 'goldfish'
        ? 'rgba(255, 245, 230, 0.36)'
        : species === 'clown'
          ? 'rgba(255, 215, 180, 0.24)'
          : 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = species === 'goldfish' ? 1.8 : 2.1;
    ctx.beginPath();
    ctx.moveTo(q - 4, y0);
    ctx.quadraticCurveTo(q * 0.46, (y0 + y1) * 0.5, 8, y1);
    ctx.stroke();
  }
  ctx.restore();

  // 2. DORSAL (Top-Right: [256..512, 0..256]) — spine root at bottom (y=q-6)
  ctx.save();
  ctx.translate(q, 0);
  ctx.beginPath();
  ctx.moveTo(10, q - 6);
  if (species === 'clown') {
    ctx.bezierCurveTo(q * 0.14, q * 0.16, q * 0.42, q * 0.10, q * 0.50, q * 0.48);
    ctx.bezierCurveTo(q * 0.58, q * 0.12, q * 0.85, q * 0.08, q - 10, q - 6);
  } else if (species === 'goldfish') {
    // Graceful sweeping dorsal crest curving softly backward
    ctx.bezierCurveTo(q * 0.10, q * 0.18, q * 0.35, q * 0.06, q * 0.80, q * 0.16);
    ctx.bezierCurveTo(q * 0.90, q * 0.28, q * 0.94, q * 0.62, q - 10, q - 6);
  } else {
    ctx.bezierCurveTo(q * 0.20, q * 0.16, q * 0.72, q * 0.12, q - 10, q - 6);
  }
  ctx.closePath();
  ctx.clip();

  const dGrad = ctx.createLinearGradient(0, q - 6, 0, 8);
  if (species === 'clown') {
    dGrad.addColorStop(0, 'rgba(244, 94, 22, 0.96)');
    dGrad.addColorStop(0.62, 'rgba(247, 108, 30, 0.86)');
    dGrad.addColorStop(0.80, 'rgba(18, 16, 18, 0.92)');
    dGrad.addColorStop(0.95, 'rgba(255, 252, 248, 0.65)');
    dGrad.addColorStop(1, 'rgba(255, 255, 255, 0.35)');
  } else if (species === 'tang') {
    dGrad.addColorStop(0, 'rgba(22, 102, 216, 0.95)');
    dGrad.addColorStop(0.75, 'rgba(15, 23, 42, 0.90)');
    dGrad.addColorStop(1, 'rgba(147, 197, 253, 0.55)');
  } else {
    dGrad.addColorStop(0, 'rgba(246, 106, 18, 0.98)');
    dGrad.addColorStop(0.58, 'rgba(251, 134, 42, 0.90)');
    dGrad.addColorStop(0.86, 'rgba(255, 228, 198, 0.72)');
    dGrad.addColorStop(1, 'rgba(255, 252, 248, 0.48)');
  }
  ctx.fillStyle = dGrad;
  ctx.fillRect(0, 0, q, q);

  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    const x0 = 14 + t * (q - 28);
    const x1 = x0 - q * 0.08;
    ctx.strokeStyle = 'rgba(255, 242, 228, 0.28)';
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(x0, q - 6);
    ctx.lineTo(x1, 16);
    ctx.stroke();
  }
  ctx.restore();

  // 3. ANAL (Bottom-Left: [0..256, 256..512]) — belly root at top (y=q+6), tip downward
  ctx.save();
  ctx.translate(0, q);
  ctx.beginPath();
  ctx.moveTo(12, 8);
  ctx.bezierCurveTo(q * 0.22, q * 0.88, q * 0.72, q * 0.90, q - 12, 8);
  ctx.closePath();
  ctx.clip();

  const aGrad = ctx.createLinearGradient(0, 8, 0, q - 8);
  if (species === 'clown') {
    aGrad.addColorStop(0, 'rgba(244, 94, 22, 0.95)');
    aGrad.addColorStop(0.68, 'rgba(22, 18, 20, 0.90)');
    aGrad.addColorStop(0.92, 'rgba(255, 252, 248, 0.58)');
    aGrad.addColorStop(1, 'rgba(255, 255, 255, 0.26)');
  } else if (species === 'tang') {
    aGrad.addColorStop(0, 'rgba(22, 102, 216, 0.94)');
    aGrad.addColorStop(0.75, 'rgba(15, 23, 42, 0.88)');
    aGrad.addColorStop(1, 'rgba(147, 197, 253, 0.50)');
  } else {
    aGrad.addColorStop(0, 'rgba(249, 115, 22, 0.88)');
    aGrad.addColorStop(0.60, 'rgba(253, 186, 116, 0.52)');
    aGrad.addColorStop(1, 'rgba(255, 250, 242, 0.24)');
  }
  ctx.fillStyle = aGrad;
  ctx.fillRect(0, 0, q, q);

  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const x0 = 18 + t * (q - 36);
    ctx.strokeStyle = 'rgba(255, 240, 225, 0.26)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x0, 8);
    ctx.lineTo(x0 - q * 0.08, q - 16);
    ctx.stroke();
  }
  ctx.restore();

  // 4. PECTORAL & PELVIC (Bottom-Right: [256..512, 256..512])
  // Right edge (x = q-6) = shoulder root, Top edge = stiff leading ray, Left = trailing tip
  ctx.save();
  ctx.translate(q, q);
  ctx.beginPath();
  ctx.moveTo(q - 6, q * 0.30);
  ctx.bezierCurveTo(q * 0.55, q * 0.06, q * 0.14, q * 0.08, 10, q * 0.42);
  ctx.bezierCurveTo(8, q * 0.84, q * 0.52, q * 0.90, q - 6, q * 0.64);
  ctx.closePath();
  ctx.clip();

  const pGrad = ctx.createRadialGradient(q * 0.88, q * 0.46, 8, q * 0.46, q * 0.48, q * 0.56);
  if (species === 'clown') {
    pGrad.addColorStop(0, 'rgba(244, 94, 22, 0.92)');
    pGrad.addColorStop(0.60, 'rgba(248, 118, 42, 0.72)');
    pGrad.addColorStop(0.84, 'rgba(18, 16, 18, 0.88)');
    pGrad.addColorStop(1, 'rgba(255, 248, 242, 0.45)');
  } else if (species === 'tang') {
    pGrad.addColorStop(0, 'rgba(22, 102, 216, 0.88)');
    pGrad.addColorStop(0.68, 'rgba(250, 204, 21, 0.78)');
    pGrad.addColorStop(1, 'rgba(254, 240, 138, 0.38)');
  } else {
    pGrad.addColorStop(0, 'rgba(249, 115, 22, 0.94)');
    pGrad.addColorStop(0.56, 'rgba(251, 138, 48, 0.76)');
    pGrad.addColorStop(0.86, 'rgba(255, 232, 206, 0.48)');
    pGrad.addColorStop(1, 'rgba(255, 252, 248, 0.28)');
  }
  ctx.fillStyle = pGrad;
  ctx.fillRect(0, 0, q, q);

  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    ctx.strokeStyle =
      pal.trim === '#141214' ? 'rgba(255, 220, 190, 0.24)' : 'rgba(255, 244, 232, 0.28)';
    ctx.lineWidth = i === 0 ? 2.6 : 1.7;
    ctx.beginPath();
    ctx.moveTo(q - 6, q * (0.34 + t * 0.26));
    ctx.quadraticCurveTo(q * 0.48, q * (0.20 + t * 0.52), 14, q * (0.14 + t * 0.72));
    ctx.stroke();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates realistic multi-ring iris & deep pupil eye texture.
 */
function buildEyeTexture(species: FishSpecies, maxAnisotropy: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const pal = SPECIES_PALETTES[species];
  const cx = size * 0.5;
  const cy = size * 0.5;

  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, size, size);

  const irisGrad = ctx.createRadialGradient(cx, cy, size * 0.16, cx, cy, size * 0.48);
  irisGrad.addColorStop(0, '#020617');
  irisGrad.addColorStop(0.42, '#020617');
  irisGrad.addColorStop(0.48, pal.iris);
  irisGrad.addColorStop(0.76, species === 'clown' ? '#ea580c' : pal.primary);
  irisGrad.addColorStop(0.95, '#111827');
  irisGrad.addColorStop(1, '#09090b');

  ctx.fillStyle = irisGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.49, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * size * 0.24, cy + Math.sin(a) * size * 0.24);
    ctx.lineTo(cx + Math.cos(a) * size * 0.41, cy + Math.sin(a) * size * 0.41);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createSpeciesTextureSet(
  img: HTMLImageElement | null,
  species: FishSpecies,
  maxAnisotropy: number
): SpeciesTextureSet {
  const { normalMap, roughnessMap } = buildScaleMaps(maxAnisotropy);
  return {
    bodyMap: buildBodyTexture(img, species, maxAnisotropy),
    normalMap,
    roughnessMap,
    finAtlasMap: buildFinAtlasTexture(species, maxAnisotropy),
    eyeMap: buildEyeTexture(species, maxAnisotropy),
  };
}

export function disposeSpeciesTextureSet(set: SpeciesTextureSet): void {
  set.bodyMap.dispose();
  set.normalMap.dispose();
  set.roughnessMap.dispose();
  set.finAtlasMap.dispose();
  set.eyeMap.dispose();
}

/**
 * Adds fine secondary fluid-membrane fin-ray undulation on top of the true skeletal bones,
 * keeping every fin root welded seamlessly into the body skin (smoothstep(0.0, 0.08, spanV) == 0).
 */
function applyFishFinMembraneShader(
  material: THREE.Material,
  uniforms: FishUniforms,
  cacheKey: string
): void {
  material.customProgramCacheKey = () => cacheKey;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSwimPhase = uniforms.uSwimPhase;
    shader.uniforms.uScullPhase = uniforms.uScullPhase;
    shader.uniforms.uFinWaveAmp = uniforms.uFinWaveAmp;
    shader.uniforms.uPectWaveAmp = uniforms.uPectWaveAmp;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aFinInfo;
uniform float uTime;
uniform float uSwimPhase;
uniform float uScullPhase;
uniform float uFinWaveAmp;
uniform float uPectWaveAmp;

vec3 finRayDisplacement(vec4 info, float uOff, float vOff) {
  float fType = info.x;
  if (fType < 0.5) return vec3(0.0);
  float spanV = clamp(info.y + vOff, 0.0, 1.0);
  float chordU = clamp(info.z + uOff, 0.0, 1.0);
  float side = info.w;
  float rootWeld = smoothstep(0.0, 0.09, spanV);

  if (fType < 1.5) {
    // Dorsal & anal soft-ray travelling membrane wave (lags behind spine ridge)
    float flex = pow(max(0.0001, spanV), 1.45) * rootWeld;
    float wave = sin(uSwimPhase - chordU * 2.85 - spanV * 2.35) * uFinWaveAmp * 1.45 * flex;
    return vec3(0.0, 0.0, wave);
  } else if (fType < 2.5) {
    // Caudal fin ray flexibility & trailing margin whip/cupping
    float flex = pow(max(0.0001, spanV), 1.32) * rootWeld;
    float lobe = (chordU - 0.5) * 2.0;
    float zWave = sin(uSwimPhase - 3.6 - spanV * 2.15 - abs(lobe) * 0.55) * uFinWaveAmp * 1.35 * flex;
    float yCup = cos(uSwimPhase - 3.2 - spanV * 1.6) * uFinWaveAmp * 0.28 * flex * lobe;
    return vec3(0.0, yCup, zWave);
  } else {
    // Pectoral & pelvic chordwise trailing-edge ribbon ripple (leading ray stiff, trailing margin silky)
    float spanFlex = pow(max(0.0001, spanV), 1.18) * rootWeld;
    float chordFlex = 0.18 + 0.82 * pow(max(0.0001, chordU), 1.15);
    float rip = sin(uScullPhase - spanV * 2.35 - chordU * 2.15 + side * 0.55) * uPectWaveAmp * spanFlex * chordFlex;
    return vec3(rip * 0.14, rip * 0.62, side * rip * 0.72);
  }
}`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
if (aFinInfo.x > 0.5) {
  vec3 d0 = finRayDisplacement(aFinInfo, 0.0, 0.0);
  vec3 du = finRayDisplacement(aFinInfo, 0.04, 0.0) - d0;
  vec3 dv = finRayDisplacement(aFinInfo, 0.0, 0.04) - d0;
  objectNormal = normalize(objectNormal - (du + dv) * 1.6);
}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
transformed += finRayDisplacement(aFinInfo, 0.0, 0.0);`
      );
  };
}

/**
 * Anatomical cross-section profile along t in [0..1] (0 = caudal peduncle, 1 = snout).
 */
function sampleBodyProfile(
  t: number,
  species: FishSpecies
): { hh: number; hw: number; yCenter: number } {
  const pal = SPECIES_PALETTES[species];
  let hFactor = 0;
  let wFactor = 0;
  let yCenter = 0;

  if (t < 0.08) {
    const k = THREE.MathUtils.clamp(t / 0.08, 0, 1);
    hFactor = 0.28 + 0.14 * Math.sin(k * Math.PI * 0.5);
    wFactor = 0.20 + 0.16 * k;
  } else if (t < 0.64) {
    const k = THREE.MathUtils.clamp((t - 0.08) / 0.56, 0, 1);
    hFactor = 0.42 + 0.58 * Math.pow(Math.max(0, Math.sin(k * Math.PI * 0.85)), 0.72);
    wFactor = 0.36 + 0.64 * Math.sin(k * Math.PI * 0.92);
    yCenter = 0.014 * Math.sin(k * Math.PI);
  } else {
    const k = THREE.MathUtils.clamp((t - 0.64) / 0.36, 0, 1);
    const snoutCurve = Math.sqrt(Math.max(0.0001, 1 - Math.pow(k, 1.85)));
    hFactor = 0.89 * snoutCurve;
    wFactor = 0.93 * Math.pow(snoutCurve, 0.92);
    yCenter = -0.025 * Math.pow(k, 1.4);
  }

  const gillDelta = Math.exp(-Math.pow((t - 0.72) / 0.032, 2)) * 0.055;
  wFactor += gillDelta;

  return {
    hh: Math.max(0.004, pal.aspectHeight * 0.5 * hFactor),
    hw: Math.max(0.004, pal.aspectWidth * 0.5 * wFactor),
    yCenter,
  };
}

// Bone index map in skeleton.bones:
// 0: spineCranium (x=+0.28)
// 1: spine1       (x=+0.13)
// 2: spine2       (x=-0.02)
// 3: spine3       (x=-0.17)
// 4: spine4       (x=-0.32)
// 5: spine5       (x=-0.47)
// 6: caudalMid    (x=-0.60)
// 7: caudalTip    (x=-0.74)
// 8: jaw, 9: operculumL, 10: operculumR
// 11..13: pectLBase, pectLMid, pectLTip
// 14..16: pectRBase, pectRMid, pectRTip
// 17..18: pelvicLBase, pelvicLTip
// 19..20: pelvicRBase, pelvicRTip
const AXIAL_BONE_X = [0.28, 0.13, -0.02, -0.17, -0.32, -0.47, -0.60, -0.74];

/**
 * Computes smooth 4-bone Gaussian skinning weights along the axial vertebral chain [0..7],
 * guaranteeing seamless elastic curvature across vertebrae without kinks.
 */
function computeAxialSkinWeights(
  x: number,
  maxBoneIdx: number,
  sigma = 0.145
): { indices: [number, number, number, number]; weights: [number, number, number, number] } {
  const candidates: { idx: number; w: number }[] = [];
  for (let b = 0; b <= maxBoneIdx; b++) {
    const dx = x - AXIAL_BONE_X[b];
    // Anterior to cranium center: anchor firmly onto cranium
    const dist = b === 0 && x > AXIAL_BONE_X[0] ? 0 : dx;
    const w = Math.exp(-(dist * dist) / (2 * sigma * sigma));
    candidates.push({ idx: b, w });
  }
  candidates.sort((a, b) => b.w - a.w);
  const top = candidates.slice(0, 4);
  let sum = 0;
  for (const c of top) sum += c.w;
  if (sum <= 1e-6) {
    return { indices: [0, 1, 2, 3], weights: [1, 0, 0, 0] };
  }
  return {
    indices: [top[0].idx, top[1].idx, top[2].idx, top[3].idx],
    weights: [top[0].w / sum, top[1].w / sum, top[2].w / sum, top[3].w / sum],
  };
}

/**
 * Builds sculpted anatomical 3D body BufferGeometry (X: [-0.50..+0.50]) with smooth multi-vertebra
 * skinning weights + jaw/operculum respiratory weights.
 */
function buildBodyGeometry(species: FishSpecies): THREE.BufferGeometry {
  const lengthSegs = 64;
  const radialSegs = 36;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const finInfo: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= lengthSegs; i++) {
    const t = i / lengthSegs;
    const x = -0.5 + t;
    const { hh, hw, yCenter } = sampleBodyProfile(t, species);

    const axial = computeAxialSkinWeights(x, 5, 0.135);

    for (let j = 0; j <= radialSegs; j++) {
      const theta = (j / radialSegs) * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      const y = yCenter + hh * sinT;
      const ridgePinch = 1 - 0.16 * Math.pow(Math.abs(sinT), 3.2);
      const eyeSocketDist = Math.hypot((t - 0.84) / 0.055, (sinT - 0.30) / 0.30);
      const eyeBoss = eyeSocketDist < 1 ? (1 - eyeSocketDist * eyeSocketDist) * 0.009 : 0;
      const z = (hw * ridgePinch + eyeBoss) * cosT;

      positions.push(x, y, z);
      normals.push(0, sinT, cosT);
      uvs.push(t, 0.5 + 0.47 * sinT);
      finInfo.push(0, 0, 0, 0);

      // Default axial spine skinning
      const bIdx: [number, number, number, number] = [...axial.indices];
      const bW: [number, number, number, number] = [...axial.weights];

      // Lower jaw respiratory articulation near snout underside (t > 0.88, sinT < -0.1)
      const jawWeightRaw =
        THREE.MathUtils.smoothstep(t, 0.86, 0.96) *
        THREE.MathUtils.smoothstep(-sinT, 0.05, 0.65);
      // Gill operculum respiratory flare on flanks near t = 0.70..0.77
      const gillXMask = Math.exp(-Math.pow((t - 0.72) / 0.036, 2));
      const gillYMask = Math.max(0, 1 - Math.abs(sinT + 0.1) / 0.72);
      const gillZMask = THREE.MathUtils.smoothstep(Math.abs(cosT), 0.45, 0.9);
      const gillWeightRaw = gillXMask * gillYMask * gillZMask * 0.52;

      if (jawWeightRaw > 0.02) {
        const jw = Math.min(0.75, jawWeightRaw * 0.75);
        bIdx[0] = 0;
        bW[0] = 1 - jw;
        bIdx[1] = 8; // jaw
        bW[1] = jw;
        bIdx[2] = 1;
        bW[2] = 0;
        bIdx[3] = 2;
        bW[3] = 0;
      } else if (gillWeightRaw > 0.02) {
        const gw = Math.min(0.55, gillWeightRaw);
        const opIdx = cosT >= 0 ? 9 : 10;
        bIdx[0] = 0;
        bW[0] = (1 - gw) * 0.85;
        bIdx[1] = 1;
        bW[1] = (1 - gw) * 0.15;
        bIdx[2] = opIdx;
        bW[2] = gw;
        bIdx[3] = 2;
        bW[3] = 0;
      }

      skinIndices.push(bIdx[0], bIdx[1], bIdx[2], bIdx[3]);
      skinWeights.push(bW[0], bW[1], bW[2], bW[3]);
    }
  }

  const stride = radialSegs + 1;
  for (let i = 0; i < lengthSegs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geom.setAttribute('aFinInfo', new THREE.Float32BufferAttribute(finInfo, 4));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Builds ALL translucent fins (caudal, dorsal, anal, left/right pectoral, left/right pelvic)
 * into ONE unified SkinnedMesh BufferGeometry sharing the exact same vertebral & fin-ray skeleton,
 * with sculpted curved paired fins rooted directly inside the body flank.
 */
function buildUnifiedFinsGeometry(species: FishSpecies): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const finInfo: number[] = [];
  const indices: number[] = [];

  const pushVertex = (
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    bIdx: [number, number, number, number],
    bW: [number, number, number, number],
    info: [number, number, number, number]
  ): number => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    uvs.push(u, v);
    skinIndices.push(bIdx[0], bIdx[1], bIdx[2], bIdx[3]);
    skinWeights.push(bW[0], bW[1], bW[2], bW[3]);
    finInfo.push(info[0], info[1], info[2], info[3]);
    return idx;
  };

  const addGridTriangles = (baseIdx: number, cols: number, rows: number) => {
    const stride = rows + 1;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = baseIdx + i * stride + j;
        const b = baseIdx + (i + 1) * stride + j;
        const c = baseIdx + (i + 1) * stride + (j + 1);
        const d = baseIdx + i * stride + (j + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }
  };

  // Atlas quadrant UV helpers (6px safe padding inside each 256x256 tile -> [0.025 .. 0.475])
  const padLo = 0.025;
  const padHi = 0.475;
  const uvCaudal = (lu: number, lv: number): [number, number] => [
    THREE.MathUtils.lerp(padLo, padHi, lu),
    THREE.MathUtils.lerp(0.5 + padLo, 0.5 + padHi, lv),
  ];
  const uvDorsal = (lu: number, lv: number): [number, number] => [
    THREE.MathUtils.lerp(0.5 + padLo, 0.5 + padHi, lu),
    THREE.MathUtils.lerp(0.5 + padLo, 0.5 + padHi, lv),
  ];
  const uvAnal = (lu: number, lv: number): [number, number] => [
    THREE.MathUtils.lerp(padLo, padHi, lu),
    THREE.MathUtils.lerp(padLo, padHi, lv),
  ];
  const uvPectoral = (lu: number, lv: number): [number, number] => [
    THREE.MathUtils.lerp(0.5 + padLo, 0.5 + padHi, lu),
    THREE.MathUtils.lerp(padLo, padHi, lv),
  ];

  // 1. CAUDAL TAIL FIN (embedded cleanly inside peduncle at x=-0.45 out to tip)
  {
    const cols = 20;
    const rows = 18;
    const tailLen = species === 'goldfish' ? 0.36 : species === 'tang' ? 0.31 : 0.29;
    const tailHeight = species === 'clown' ? 0.30 : species === 'goldfish' ? 0.38 : 0.34;
    const baseIdx = positions.length / 3;

    for (let i = 0; i <= cols; i++) {
      const span = i / cols; // 0 = peduncle root, 1 = trailing margin
      const x = -0.45 - span * tailLen;
      const spread = 0.28 + 0.72 * Math.pow(span, 0.66);
      const axial = computeAxialSkinWeights(x, 7, 0.125);

      for (let j = 0; j <= rows; j++) {
        const lobeNorm = j / rows; // 0 = bottom, 1 = top
        const ly = (lobeNorm - 0.5) * tailHeight;
        const y = ly * spread;
        const cupZ = Math.sin(span * Math.PI) * 0.008 * Math.sign(y);
        const [u, v] = uvCaudal(1 - span, lobeNorm);
        pushVertex(x, y, cupZ, u, v, axial.indices, axial.weights, [2, span, lobeNorm, 0]);
      }
    }
    addGridTriangles(baseIdx, cols, rows);
  }

  // 2. DORSAL FIN (root welded inside dorsal ridge, sharing exact axial spine weights)
  {
    const cols = 28;
    const rows = 8;
    const xStart = -0.35;
    const xSpan = 0.57;
    const maxHeight = species === 'tang' ? 0.175 : species === 'goldfish' ? 0.195 : 0.155;
    const baseIdx = positions.length / 3;

    for (let i = 0; i <= cols; i++) {
      const chordU = i / cols; // 0 = rear -> 1 = front
      const x = xStart + chordU * xSpan;
      const t = x + 0.5;
      const prof = sampleBodyProfile(t, species);
      const spineY = prof.yCenter + prof.hh * 0.88;
      const finReach = maxHeight * (0.62 + 0.38 * Math.sin(chordU * Math.PI));
      const axial = computeAxialSkinWeights(x, 5, 0.135);

      for (let j = 0; j <= rows; j++) {
        const spanV = j / rows; // 0 = spine root -> 1 = outer crest
        const sweepBack = species === 'goldfish' ? -0.055 * spanV * spanV : -0.02 * spanV;
        const y = spineY + spanV * finReach;
        const z = Math.sin(chordU * Math.PI) * 0.003 * (spanV - 0.15);
        const [u, v] = uvDorsal(chordU, spanV);
        pushVertex(
          x + sweepBack,
          y,
          z,
          u,
          v,
          axial.indices,
          axial.weights,
          [1, spanV, 1 - chordU, 1]
        );
      }
    }
    addGridTriangles(baseIdx, cols, rows);
  }

  // 3. ANAL FIN (root welded inside ventral ridge)
  {
    const cols = 16;
    const rows = 6;
    const xStart = -0.37;
    const xSpan = 0.27;
    const dropHeight = species === 'goldfish' ? 0.13 : 0.105;
    const baseIdx = positions.length / 3;

    for (let i = 0; i <= cols; i++) {
      const chordU = i / cols;
      const x = xStart + chordU * xSpan;
      const t = x + 0.5;
      const prof = sampleBodyProfile(t, species);
      const bellyY = prof.yCenter - prof.hh * 0.86;
      const finDrop = dropHeight * Math.sin((0.15 + chordU * 0.75) * Math.PI);
      const axial = computeAxialSkinWeights(x, 5, 0.135);

      for (let j = 0; j <= rows; j++) {
        const spanV = j / rows; // 0 = belly root -> 1 = lower tip
        const sweepBack = -0.025 * spanV * spanV;
        const y = bellyY - spanV * finDrop;
        const [u, v] = uvAnal(chordU, 1 - spanV);
        pushVertex(
          x + sweepBack,
          y,
          0,
          u,
          v,
          axial.indices,
          axial.weights,
          [1, spanV, 1 - chordU, -1]
        );
      }
    }
    addGridTriangles(baseIdx, cols, rows);
  }

  // 4. SCULPTED CURVED PECTORAL FINS (Left & Right, 3-bone articulated chain + cambered hydrofoil)
  const gillProfile = sampleBodyProfile(0.71, species);
  const pectLen = species === 'goldfish' ? 0.215 : 0.185;
  const pectHeight = species === 'goldfish' ? 0.155 : 0.138;
  for (const side of [1, -1] as const) {
    const cols = 16;
    const rows = 12;
    const baseBone = side > 0 ? 11 : 14;
    const midBone = side > 0 ? 12 : 15;
    const tipBone = side > 0 ? 13 : 16;
    const rootX = 0.215;
    const rootY = gillProfile.yCenter - 0.042;
    const rootZ = side * gillProfile.hw * 0.84; // anchored inside flank behind operculum
    const baseIdx = positions.length / 3;

    for (let i = 0; i <= cols; i++) {
      const span = i / cols; // 0 = shoulder socket -> 1 = distal fin tip
      // Natural swept-back & gently flared hydrofoil midline
      const centerX = rootX - span * pectLen;
      const centerY = rootY - span * 0.026 + Math.sin(span * Math.PI) * 0.008;
      const centerZ = rootZ + side * (Math.pow(span, 0.82) * 0.052);

      // Tight muscular socket at span=0 fanning smoothly out to paddle chord
      const halfChord = (0.18 + 0.82 * Math.sin(Math.min(1, span * 0.92 + 0.15) * Math.PI * 0.62)) * (pectHeight * 0.5);

      // Smooth 4-bone skinning weights: shoulder socket welded to cranium (0) -> base -> mid -> tip
      let wCran = Math.max(0, 1 - span / 0.16);
      wCran = wCran * wCran * (3 - 2 * wCran) * 0.72;
      const wBase = Math.exp(-Math.pow((span - 0.22) / 0.22, 2)) * (1 - wCran);
      const wMid = Math.exp(-Math.pow((span - 0.56) / 0.24, 2));
      const wTip = Math.exp(-Math.pow((span - 0.94) / 0.25, 2));
      const wSum = Math.max(1e-5, wCran + wBase + wMid + wTip);
      const bIdx: [number, number, number, number] = [0, baseBone, midBone, tipBone];
      const bW: [number, number, number, number] = [
        wCran / wSum,
        wBase / wSum,
        wMid / wSum,
        wTip / wSum,
      ];

      for (let j = 0; j <= rows; j++) {
        const chordU = j / rows; // 0 = stiff leading upper ray -> 1 = soft trailing lower ray
        // Sweep trailing rays slightly further aft for an organic teardrop fin silhouette
        const sweepOffset = -chordU * 0.032 * span;
        const yOff = (0.5 - chordU) * 2 * halfChord;
        // Subtle cambered arch across chord so fin is 3D curved, never a flat board
        const camberZ = side * Math.sin(chordU * Math.PI) * 0.011 * span;
        const [u, v] = uvPectoral(1 - span, 1 - chordU);

        pushVertex(
          centerX + sweepOffset,
          centerY + yOff,
          centerZ + camberZ,
          u,
          v,
          bIdx,
          bW,
          [3, span, chordU, side]
        );
      }
    }
    addGridTriangles(baseIdx, cols, rows);
  }

  // 5. SCULPTED PELVIC FINS (Left & Right, 2-bone chain rooted in ventral belly)
  const pelvProfile = sampleBodyProfile(0.60, species);
  const pelvLen = species === 'goldfish' ? 0.155 : 0.128;
  const pelvSpread = species === 'goldfish' ? 0.095 : 0.080;
  for (const side of [1, -1] as const) {
    const cols = 12;
    const rows = 8;
    const baseBone = side > 0 ? 17 : 19;
    const tipBone = side > 0 ? 18 : 20;
    const rootX = 0.095;
    const rootY = pelvProfile.yCenter - pelvProfile.hh * 0.80;
    const rootZ = side * pelvProfile.hw * 0.30;
    const baseIdx = positions.length / 3;

    for (let i = 0; i <= cols; i++) {
      const span = i / cols;
      const cx = rootX - span * pelvLen;
      const cy = rootY - span * 0.044;
      const cz = rootZ + side * span * 0.032;
      const halfChord = (0.20 + 0.80 * Math.sin(Math.min(1, span * 0.9 + 0.16) * Math.PI * 0.62)) * (pelvSpread * 0.5);

      let wSpine1 = Math.max(0, 1 - span / 0.18);
      wSpine1 = wSpine1 * wSpine1 * (3 - 2 * wSpine1) * 0.72;
      const wBase = Math.exp(-Math.pow((span - 0.32) / 0.28, 2)) * (1 - wSpine1);
      const wTip = Math.exp(-Math.pow((span - 0.88) / 0.30, 2));
      const wSum = Math.max(1e-5, wSpine1 + wBase + wTip);
      const bIdx: [number, number, number, number] = [1, baseBone, tipBone, 0];
      const bW: [number, number, number, number] = [wSpine1 / wSum, wBase / wSum, wTip / wSum, 0];

      for (let j = 0; j <= rows; j++) {
        const chordU = j / rows;
        const yOff = (0.5 - chordU) * 2 * halfChord * 0.55;
        const zOff = side * chordU * 0.014 * span;
        const [u, v] = uvPectoral(1 - span, 1 - chordU);

        pushVertex(
          cx - chordU * 0.018 * span,
          cy + yOff,
          cz + zOff,
          u,
          v,
          bIdx,
          bW,
          [3, span, chordU, side]
        );
      }
    }
    addGridTriangles(baseIdx, cols, rows);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geom.setAttribute('aFinInfo', new THREE.Float32BufferAttribute(finInfo, 4));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Updates the full 21-bone anatomical fish skeleton and fin-ray membrane uniforms each frame:
 * - Arc-length-preserving 8-vertebra carangiform traveling S-wave + C-turn bend
 * - Cranial yaw recoil + gill operculum / mandible buccal respiratory pump
 * - 3-joint pectoral figure-8 sculling with feathering twist & asymmetric turn-braking
 * - 2-joint pelvic fin stabilization
 */
export function updateFishSkeleton(
  rig: FishRig3D,
  time: number,
  input: FishKinematicInput
): void {
  const { bones, uniforms } = rig;
  const m = input.motionScale;
  const phase = input.swimPhase;
  const scull = input.scullPhase;
  const breath = input.breathPhase;
  const effort = input.effort;
  const speedNorm = input.speedNorm;

  // Tail beat angular amplitude grows with effort (gliding uses gentle trailing wave, bursting whips strongly)
  const waveAmp = (0.36 + 0.64 * Math.min(1.85, effort)) * m;
  const turnBend = input.turnBendSmooth; // negative when turning left (-Z)

  // 1. Cranium: subtle counter-yaw recoil opposite tail beat + gentle respiratory pitch
  bones.spineCranium.rotation.y = Math.sin(phase - 0.15) * 0.032 * waveAmp;
  bones.spineCranium.rotation.z = Math.sin(breath) * 0.012 * m;

  // 2. Buccal-opercular respiratory pump + food bite snap
  const breathPulse = 0.5 + 0.5 * Math.sin(breath);
  const gillFlare = 0.5 + 0.5 * Math.sin(breath - 1.35);
  bones.jaw.rotation.z = -(0.02 + 0.038 * breathPulse * m + input.chompRatio * 0.34);
  bones.operculumL.rotation.y = (0.018 + 0.068 * gillFlare * m) * (1 + Math.min(0.6, effort * 0.25));
  bones.operculumR.rotation.y = -(0.018 + 0.068 * gillFlare * m) * (1 + Math.min(0.6, effort * 0.25));

  // 3. Vertebral column (5 thoracic/caudal vertebrae + 2 caudal fin ray segments)
  // Progressive traveling wave phase lag (~280 deg total wave across body)
  bones.spine1.rotation.y = Math.sin(phase - 0.55) * 0.042 * waveAmp + turnBend * 0.09;
  bones.spine2.rotation.y = Math.sin(phase - 1.15) * 0.078 * waveAmp + turnBend * 0.18;
  bones.spine3.rotation.y = Math.sin(phase - 1.85) * 0.125 * waveAmp + turnBend * 0.26;
  bones.spine4.rotation.y = Math.sin(phase - 2.60) * 0.175 * waveAmp + turnBend * 0.28;
  bones.spine5.rotation.y = Math.sin(phase - 3.35) * 0.225 * waveAmp + turnBend * 0.22;

  // Caudal fin rays whip smoothly behind the hypural peduncle with slight pitch twist
  bones.caudalMid.rotation.y = Math.sin(phase - 4.10) * 0.265 * waveAmp + turnBend * 0.14;
  bones.caudalTip.rotation.y = Math.sin(phase - 4.90) * 0.295 * waveAmp + turnBend * 0.08;
  bones.caudalMid.rotation.x = Math.cos(phase - 3.8) * 0.045 * waveAmp;
  bones.caudalTip.rotation.x = Math.cos(phase - 4.6) * 0.065 * waveAmp;

  // Subtle vertical compliance along spine during pitch maneuvers
  const pitchFlex = THREE.MathUtils.clamp(-input.pitchAngle * 0.08, -0.05, 0.05);
  bones.spine2.rotation.z = pitchFlex * 0.4;
  bones.spine4.rotation.z = pitchFlex * 0.6;

  // 4. Pectoral Fins: 3-bone articulated figure-8 labriform sculling + asymmetric turn braking
  // Left side is -Z (pectR in local +Z/-Z terms: note pectL is at +Z right flank, pectR is at -Z left flank)
  const fastFold = THREE.MathUtils.clamp((speedNorm - 0.9) * 0.28, 0, 0.34);
  const scullAmp = THREE.MathUtils.lerp(0.28, 0.13, fastFold / 0.34) * m;

  // yawRate > 0 turns LEFT (-Z flank is inside turn, +Z flank is outside turn)
  const turnNorm = THREE.MathUtils.clamp(input.yawRate / 1.4, -1, 1);
  const flarePlusZ = 0.08 - fastFold * 0.35 + Math.max(0, -turnNorm) * 0.42; // inside brake on right turn
  const flareMinusZ = 0.08 - fastFold * 0.35 + Math.max(0, turnNorm) * 0.42; // inside brake on left turn
  const drivePlusZ = 1 + Math.max(0, turnNorm) * 0.45;
  const driveMinusZ = 1 + Math.max(0, -turnNorm) * 0.45;

  // +Z side pectoral (pectL bones)
  const phL = scull;
  const sweepL = Math.sin(phL) * scullAmp * drivePlusZ;
  const flapL = Math.cos(phL) * scullAmp * 0.72 * drivePlusZ;
  const featherL = Math.sin(phL + 0.52) * scullAmp * 0.95;

  bones.pectLBase.rotation.set(featherL, flarePlusZ + sweepL, -0.06 + flapL);
  bones.pectLMid.rotation.set(
    Math.sin(phL - 0.65) * 0.16 * m,
    Math.sin(phL - 0.72) * scullAmp * 0.72 * drivePlusZ,
    Math.cos(phL - 0.72) * scullAmp * 0.55
  );
  bones.pectLTip.rotation.set(
    Math.sin(phL - 1.35) * 0.24 * m,
    Math.sin(phL - 1.45) * scullAmp * 0.92 * drivePlusZ,
    Math.cos(phL - 1.45) * scullAmp * 0.72
  );

  // -Z side pectoral (pectR bones, natural slight phase offset for graceful sculling)
  const phR = scull + 0.65;
  const sweepR = Math.sin(phR) * scullAmp * driveMinusZ;
  const flapR = Math.cos(phR) * scullAmp * 0.72 * driveMinusZ;
  const featherR = Math.sin(phR + 0.52) * scullAmp * 0.95;

  bones.pectRBase.rotation.set(-featherR, -(flareMinusZ + sweepR), -0.06 + flapR);
  bones.pectRMid.rotation.set(
    -Math.sin(phR - 0.65) * 0.16 * m,
    -Math.sin(phR - 0.72) * scullAmp * 0.72 * driveMinusZ,
    Math.cos(phR - 0.72) * scullAmp * 0.55
  );
  bones.pectRTip.rotation.set(
    -Math.sin(phR - 1.35) * 0.24 * m,
    -Math.sin(phR - 1.45) * scullAmp * 0.92 * driveMinusZ,
    Math.cos(phR - 1.45) * scullAmp * 0.72
  );

  // 5. Pelvic Fins: 2-bone stabilization (tuck back when bursting, gently flare when gliding/turning)
  const pelvFlare = (0.12 + (1 - fastFold) * 0.12 + Math.abs(turnNorm) * 0.16) * m;
  bones.pelvicLBase.rotation.set(
    Math.sin(phL * 0.7) * 0.08 * m,
    pelvFlare + Math.sin(phL * 0.85) * 0.09 * m,
    -0.08 - fastFold * 0.18
  );
  bones.pelvicLTip.rotation.set(
    0,
    Math.sin(phL * 0.85 - 0.9) * 0.14 * m,
    Math.cos(phL * 0.85 - 0.9) * 0.10 * m
  );

  bones.pelvicRBase.rotation.set(
    -Math.sin(phR * 0.7) * 0.08 * m,
    -(pelvFlare + Math.sin(phR * 0.85) * 0.09 * m),
    -0.08 - fastFold * 0.18
  );
  bones.pelvicRTip.rotation.set(
    0,
    -Math.sin(phR * 0.85 - 0.9) * 0.14 * m,
    Math.cos(phR * 0.85 - 0.9) * 0.10 * m
  );

  // 6. Secondary fluid membrane shader uniforms
  uniforms.uTime.value = time;
  uniforms.uSwimPhase.value = phase;
  uniforms.uScullPhase.value = scull;
  uniforms.uFinWaveAmp.value = (0.016 + 0.014 * Math.min(2.0, effort)) * m;
  uniforms.uPectWaveAmp.value = (0.014 + 0.011 * (1 - fastFold * 0.6)) * m;
}

/**
 * Creates a unified, true skeletal hyperrealistic 3D fish rig:
 * - 21-bone anatomical skeleton (8 axial spine/caudal vertebrae, mandible, twin gill opercula,
 *   3-bone pectoral chains, 2-bone pelvic chains)
 * - Continuous SkinnedMesh body + unified SkinnedMesh fin-ray membranes sharing the exact same Skeleton
 * - Zero detached block fins: every fin root is embedded & skin-weighted smoothly into the body torso
 * - Eyeballs parented directly to the cranium bone so eyes lock naturally with head recoil & breathing
 */
export function createHyperrealisticFish3D(
  fishId: string,
  species: FishSpecies,
  textures: SpeciesTextureSet,
  worldScale: number,
  waterFog?: WaterFogUniforms
): FishRig3D {
  const root = new THREE.Group();
  root.userData.fishId = fishId;
  root.rotation.order = 'YZX';

  const uniforms: FishUniforms = {
    uTime: { value: 0 },
    uSwimPhase: { value: Math.random() * Math.PI * 2 },
    uScullPhase: { value: Math.random() * Math.PI * 2 },
    uFinWaveAmp: { value: 0.024 },
    uPectWaveAmp: { value: 0.018 },
  };

  // Build 21-bone anatomical skeleton in unscaled root space
  const gillProfile = sampleBodyProfile(0.71, species);
  const gillOpProfile = sampleBodyProfile(0.78, species);
  const pelvProfile = sampleBodyProfile(0.60, species);

  const spineCranium = new THREE.Bone();
  spineCranium.position.set(0.28, 0, 0);

  const spine1 = new THREE.Bone();
  spine1.position.set(-0.15, 0, 0);
  const spine2 = new THREE.Bone();
  spine2.position.set(-0.15, 0, 0);
  const spine3 = new THREE.Bone();
  spine3.position.set(-0.15, 0, 0);
  const spine4 = new THREE.Bone();
  spine4.position.set(-0.15, 0, 0);
  const spine5 = new THREE.Bone();
  spine5.position.set(-0.15, 0, 0);
  const caudalMid = new THREE.Bone();
  caudalMid.position.set(-0.13, 0, 0);
  const caudalTip = new THREE.Bone();
  caudalTip.position.set(-0.14, 0, 0);

  spineCranium.add(spine1);
  spine1.add(spine2);
  spine2.add(spine3);
  spine3.add(spine4);
  spine4.add(spine5);
  spine5.add(caudalMid);
  caudalMid.add(caudalTip);

  const jaw = new THREE.Bone();
  jaw.position.set(0.14, -0.055, 0);
  const operculumL = new THREE.Bone();
  operculumL.position.set(0.02, -0.01, gillOpProfile.hw * 0.72);
  const operculumR = new THREE.Bone();
  operculumR.position.set(0.02, -0.01, -gillOpProfile.hw * 0.72);
  spineCranium.add(jaw, operculumL, operculumR);

  const pectLBase = new THREE.Bone();
  pectLBase.position.set(-0.07, gillProfile.yCenter - 0.042, gillProfile.hw * 0.84);
  const pectLMid = new THREE.Bone();
  pectLMid.position.set(-0.068, -0.008, 0.018);
  const pectLTip = new THREE.Bone();
  pectLTip.position.set(-0.068, -0.008, 0.018);
  pectLBase.add(pectLMid);
  pectLMid.add(pectLTip);
  spineCranium.add(pectLBase);

  const pectRBase = new THREE.Bone();
  pectRBase.position.set(-0.07, gillProfile.yCenter - 0.042, -gillProfile.hw * 0.84);
  const pectRMid = new THREE.Bone();
  pectRMid.position.set(-0.068, -0.008, -0.018);
  const pectRTip = new THREE.Bone();
  pectRTip.position.set(-0.068, -0.008, -0.018);
  pectRBase.add(pectRMid);
  pectRMid.add(pectRTip);
  spineCranium.add(pectRBase);

  const pelvicLBase = new THREE.Bone();
  pelvicLBase.position.set(-0.035, pelvProfile.yCenter - pelvProfile.hh * 0.80, pelvProfile.hw * 0.30);
  const pelvicLTip = new THREE.Bone();
  pelvicLTip.position.set(-0.062, -0.024, 0.014);
  pelvicLBase.add(pelvicLTip);
  spine1.add(pelvicLBase);

  const pelvicRBase = new THREE.Bone();
  pelvicRBase.position.set(-0.035, pelvProfile.yCenter - pelvProfile.hh * 0.80, -pelvProfile.hw * 0.30);
  const pelvicRTip = new THREE.Bone();
  pelvicRTip.position.set(-0.062, -0.024, -0.014);
  pelvicRBase.add(pelvicRTip);
  spine1.add(pelvicRBase);

  const boneArray: THREE.Bone[] = [
    spineCranium,
    spine1,
    spine2,
    spine3,
    spine4,
    spine5,
    caudalMid,
    caudalTip,
    jaw,
    operculumL,
    operculumR,
    pectLBase,
    pectLMid,
    pectLTip,
    pectRBase,
    pectRMid,
    pectRTip,
    pelvicLBase,
    pelvicLTip,
    pelvicRBase,
    pelvicRTip,
  ];

  const bones: FishSkeletonBones = {
    spineCranium,
    spine1,
    spine2,
    spine3,
    spine4,
    spine5,
    caudalMid,
    caudalTip,
    jaw,
    operculumL,
    operculumR,
    pectLBase,
    pectLMid,
    pectLTip,
    pectRBase,
    pectRMid,
    pectRTip,
    pelvicLBase,
    pelvicLTip,
    pelvicRBase,
    pelvicRTip,
  };

  root.add(spineCranium);

  // Build skinned geometries & materials
  const bodyGeom = buildBodyGeometry(species);
  const finsGeom = buildUnifiedFinsGeometry(species);
  const geometries: THREE.BufferGeometry[] = [bodyGeom, finsGeom];
  const materials: THREE.Material[] = [];

  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: textures.bodyMap,
    normalMap: textures.normalMap,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughnessMap: textures.roughnessMap,
    roughness: 0.70,
    metalness: 0.0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.48,
    iridescence: 0.05,
    iridescenceIOR: 1.33,
    envMapIntensity: 0.36,
    transparent: false,
    opacity: 1.0,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  if (waterFog) applyWaterDepthFog(bodyMat, waterFog, 1.18, 0.32);
  materials.push(bodyMat);

  const finsMat = new THREE.MeshPhysicalMaterial({
    map: textures.finAtlasMap,
    transparent: true,
    alphaTest: 0.025,
    side: THREE.DoubleSide,
    roughness: 0.58,
    metalness: 0.0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.45,
    envMapIntensity: 0.30,
    depthWrite: false,
  });
  applyFishFinMembraneShader(finsMat, uniforms, `fish-fins-${species}-v3`);
  if (waterFog) applyWaterDepthFog(finsMat, waterFog, 1.18, 0.18);
  materials.push(finsMat);

  const bodyMesh = new THREE.SkinnedMesh(bodyGeom, bodyMat);
  bodyMesh.userData.fishId = fishId;
  bodyMesh.frustumCulled = false;

  const finsMesh = new THREE.SkinnedMesh(finsGeom, finsMat);
  finsMesh.userData.fishId = fishId;
  finsMesh.frustumCulled = false;

  root.add(bodyMesh, finsMesh);

  // Bind both SkinnedMeshes to the exact same unscaled skeleton in root local space
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneArray);
  const identityBind = new THREE.Matrix4();
  bodyMesh.bind(skeleton, identityBind);
  finsMesh.bind(skeleton, identityBind);

  // Apply world scale after clean identity bind
  root.scale.setScalar(worldScale);

  // 3D Dual-Layer Eyeballs attached directly to spineCranium so eyes lock with head recoil
  const eyeSocket = sampleBodyProfile(0.84, species);
  const eyeX = 0.34 - spineCranium.position.x; // relative to spineCranium
  const eyeY = eyeSocket.yCenter + eyeSocket.hh * 0.24;
  const eyeZ = eyeSocket.hw * 0.84;
  const eyeRadius = species === 'tang' ? 0.034 : 0.038;

  const irisGeom = new THREE.SphereGeometry(eyeRadius, 20, 16);
  const corneaGeom = new THREE.SphereGeometry(eyeRadius * 1.12, 20, 16);
  geometries.push(irisGeom, corneaGeom);

  const irisMat = new THREE.MeshStandardMaterial({
    map: textures.eyeMap,
    roughness: 0.22,
    metalness: 0.1,
  });
  if (waterFog) applyWaterDepthFog(irisMat, waterFog, 1.18);
  const corneaMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.04,
    metalness: 0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.36,
    reflectivity: 1.0,
    depthWrite: false,
  });
  if (waterFog) applyWaterDepthFog(corneaMat, waterFog, 1.18);
  materials.push(irisMat, corneaMat);

  for (const side of [1, -1] as const) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(eyeX, eyeY, side * eyeZ);
    eyeGroup.rotation.y = side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
    eyeGroup.scale.set(0.82, 1.0, 1.0);

    const iris = new THREE.Mesh(irisGeom, irisMat);
    iris.userData.fishId = fishId;
    const cornea = new THREE.Mesh(corneaGeom, corneaMat);
    cornea.userData.fishId = fishId;

    eyeGroup.add(iris, cornea);
    spineCranium.add(eyeGroup);
  }

  return {
    root,
    skeleton,
    bones,
    uniforms,
    materials,
    geometries,
  };
}
