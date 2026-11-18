import * as THREE from 'three';
import type { FishSpecies } from '../types/aquarium';
import { applyWaterDepthFog, type WaterFogUniforms } from './waterFogShader';

export interface FishUniforms {
  uTime: { value: number };
  uSwimPhase: { value: number };
  uSwimAmp: { value: number };
  uTurnBend: { value: number };
}

export interface FishRig3D {
  root: THREE.Group;
  uniforms: FishUniforms;
  leftPectoral: THREE.Group;
  rightPectoral: THREE.Group;
  leftPelvic: THREE.Group;
  rightPelvic: THREE.Group;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

export interface SpeciesTextureSet {
  bodyMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  finCaudalMap: THREE.CanvasTexture;
  finDorsalMap: THREE.CanvasTexture;
  finPectoralMap: THREE.CanvasTexture;
  eyeMap: THREE.CanvasTexture;
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
    secondary: '#fde68a',
    trim: '#fff7ed',
    iris: '#fbbf24',
    aspectHeight: 0.48,
    aspectWidth: 0.25,
  },
};

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Extracts a clean 512x256 body-torso photographic texture from a side-profile fish photo
 * (fish facing right on white studio background), excluding protruding thin fins and white halo.
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
  // Fallback procedural base gradient
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
    const tctx = tmp.getContext('2d');
    if (tctx) {
      tctx.drawImage(img, 0, 0, srcW, srcH);
      const raw = tctx.getImageData(0, 0, srcW, srcH);
      const data = raw.data;
      const total = srcW * srcH;

      // Border BFS flood-fill to isolate studio white background while keeping white stripes
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

      // Tight foreground bounds
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

      // Torso starts after caudal fin (~21% from tail end) and extends to nose tip (100%)
      const torsoStartX = minX + Math.round(fgW * 0.21);
      const torsoEndX = maxX - 2;
      const torsoSpanX = Math.max(1, torsoEndX - torsoStartX);

      // Measure column vertical spans inside the muscular core (exclude outer thin dorsal/ventral fins)
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
          // Inset slightly from fin ridges toward muscular torso contour
          const span = lastY - firstY;
          const u = ix / torsoSpanX;
          const topTrim = u > 0.1 && u < 0.78 ? 0.16 : 0.08;
          const botTrim = u > 0.12 && u < 0.72 ? 0.15 : 0.08;
          colTop[ix] = firstY + span * topTrim;
          colBot[ix] = lastY - span * botTrim;
        }
      }

      // Smooth column bounds vertically so UV mapping has zero jitter
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
          // Inset 3% inward from top/bottom silhouette to guarantee crisp foreground colors
          const sampleY = topY + (botY - topY) * (0.04 + vNorm * 0.92);
          const sy = Math.min(srcH - 1, Math.max(0, Math.round(sampleY)));

          // Search nearby inside column if sample falls on background
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

          // Subtle natural dorsal-to-ventral shading balance
          const dorsalDarken = 1 - Math.max(0, 0.25 - vNorm) * 0.45;
          r = clampByte(r * dorsalDarken);
          g = clampByte(g * dorsalDarken);
          b = clampByte(b * dorsalDarken);

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

  // 1. Heightfield for imbricated fish scales
  const heightBuf = new Float32Array(w * h);
  const scaleCols = 42;
  const scaleRows = 22;

  for (let y = 0; y < h; y++) {
    const fy = (y / h) * scaleRows;
    for (let x = 0; x < w; x++) {
      // Scales fade smoothly near head (u > 0.74) where operculum & snout skin are smooth
      const u = x / w;
      const headFade = 1 - Math.max(0, Math.min(1, (u - 0.68) / 0.14));

      const row = Math.floor(fy);
      const fx = (x / w) * scaleCols + (row % 2) * 0.5;
      const dx = (fx - Math.floor(fx)) - 0.5;
      const dy = (fy - row) - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dome = Math.max(0, 1 - dist * 1.75);
      // Slight lateral line subtle groove along y = 0.46
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

      // Natural submerged satin skin: soft sheen on scale crowns, matte crevices
      const hVal = heightBuf[y * w + x];
      const roughByte = clampByte(205 - hVal * 48);
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
 * Generates translucent rayed fin textures tailored to each species.
 * Alpha tapers toward trailing edges so water and plants show softly through fins.
 */
function buildFinTexture(
  species: FishSpecies,
  kind: 'caudal' | 'dorsal' | 'pectoral',
  maxAnisotropy: number
): THREE.CanvasTexture {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const pal = SPECIES_PALETTES[species];

  ctx.clearRect(0, 0, w, h);

  if (kind === 'caudal') {
    // Fan shape: attached at right edge (u=1, body peduncle), flaring toward left edge (u=0, trailing tips)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w * 0.98, h * 0.34);
    ctx.bezierCurveTo(w * 0.62, h * 0.14, w * 0.24, h * 0.04, w * 0.06, h * 0.14);
    if (species === 'clown') {
      // Rounded clownfish paddle tail
      ctx.bezierCurveTo(w * 0.01, h * 0.34, w * 0.01, h * 0.66, w * 0.06, h * 0.86);
    } else {
      // Gently forked / scalloped reef tail
      ctx.bezierCurveTo(w * 0.18, h * 0.38, w * 0.18, h * 0.62, w * 0.06, h * 0.86);
    }
    ctx.bezierCurveTo(w * 0.24, h * 0.96, w * 0.62, h * 0.86, w * 0.98, h * 0.66);
    ctx.closePath();
    ctx.clip();

    const grad = ctx.createLinearGradient(w, h * 0.5, 0, h * 0.5);
    if (species === 'clown') {
      grad.addColorStop(0, 'rgba(244, 94, 22, 0.96)');
      grad.addColorStop(0.58, 'rgba(247, 112, 34, 0.88)');
      grad.addColorStop(0.76, 'rgba(22, 18, 20, 0.92)');
      grad.addColorStop(0.92, 'rgba(255, 250, 245, 0.62)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.28)');
    } else if (species === 'tang') {
      grad.addColorStop(0, 'rgba(18, 42, 92, 0.95)');
      grad.addColorStop(0.25, 'rgba(245, 204, 24, 0.88)');
      grad.addColorStop(0.85, 'rgba(250, 212, 36, 0.62)');
      grad.addColorStop(1, 'rgba(15, 23, 42, 0.72)');
    } else {
      grad.addColorStop(0, 'rgba(249, 115, 22, 0.92)');
      grad.addColorStop(0.5, 'rgba(253, 186, 116, 0.62)');
      grad.addColorStop(1, 'rgba(255, 247, 237, 0.25)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Fin rays radiating from peduncle
    ctx.lineCap = 'round';
    for (let i = 0; i < 20; i++) {
      const t = i / 19;
      const y0 = h * (0.36 + t * 0.28);
      const y1 = h * (0.10 + t * 0.80);
      ctx.strokeStyle =
        species === 'clown'
          ? 'rgba(255, 215, 180, 0.24)'
          : 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(w * 0.98, y0);
      ctx.quadraticCurveTo(w * 0.45, (y0 + y1) * 0.5, w * 0.04, y1);
      ctx.stroke();
    }
    ctx.restore();
  } else if (kind === 'dorsal') {
    // Bottom edge (v=0 -> y=h) attaches to fish spine; top (v=1 -> y=0) flares upward
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w * 0.03, h * 0.98);
    if (species === 'clown') {
      // Twin-lobed clownfish dorsal fin
      ctx.bezierCurveTo(w * 0.14, h * 0.15, w * 0.42, h * 0.10, w * 0.50, h * 0.48);
      ctx.bezierCurveTo(w * 0.58, h * 0.12, w * 0.85, h * 0.08, w * 0.96, h * 0.98);
    } else {
      ctx.bezierCurveTo(w * 0.20, h * 0.16, w * 0.72, h * 0.12, w * 0.96, h * 0.98);
    }
    ctx.closePath();
    ctx.clip();

    const grad = ctx.createLinearGradient(0, h, 0, 0);
    if (species === 'clown') {
      grad.addColorStop(0, 'rgba(244, 94, 22, 0.96)');
      grad.addColorStop(0.62, 'rgba(247, 108, 30, 0.86)');
      grad.addColorStop(0.80, 'rgba(18, 16, 18, 0.92)');
      grad.addColorStop(0.95, 'rgba(255, 252, 248, 0.65)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.35)');
    } else if (species === 'tang') {
      grad.addColorStop(0, 'rgba(22, 102, 216, 0.95)');
      grad.addColorStop(0.75, 'rgba(15, 23, 42, 0.90)');
      grad.addColorStop(1, 'rgba(147, 197, 253, 0.55)');
    } else {
      grad.addColorStop(0, 'rgba(249, 115, 22, 0.90)');
      grad.addColorStop(0.6, 'rgba(253, 186, 116, 0.55)');
      grad.addColorStop(1, 'rgba(255, 247, 237, 0.25)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 22; i++) {
      const t = i / 21;
      const x0 = w * (0.06 + t * 0.88);
      const x1 = x0 - w * 0.06;
      ctx.strokeStyle = 'rgba(255, 240, 225, 0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, h * 0.98);
      ctx.lineTo(x1, h * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    // Pectoral / Pelvic rounded paddle attached on right edge (u=1 -> x=w)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w * 0.96, h * 0.36);
    ctx.bezierCurveTo(w * 0.55, h * 0.06, w * 0.14, h * 0.08, w * 0.06, h * 0.48);
    ctx.bezierCurveTo(w * 0.10, h * 0.88, w * 0.52, h * 0.92, w * 0.96, h * 0.64);
    ctx.closePath();
    ctx.clip();

    const grad = ctx.createRadialGradient(w * 0.88, h * 0.5, 8, w * 0.45, h * 0.5, w * 0.58);
    if (species === 'clown') {
      grad.addColorStop(0, 'rgba(244, 94, 22, 0.92)');
      grad.addColorStop(0.62, 'rgba(248, 118, 42, 0.72)');
      grad.addColorStop(0.84, 'rgba(18, 16, 18, 0.88)');
      grad.addColorStop(1, 'rgba(255, 248, 242, 0.45)');
    } else if (species === 'tang') {
      grad.addColorStop(0, 'rgba(22, 102, 216, 0.88)');
      grad.addColorStop(0.68, 'rgba(250, 204, 21, 0.78)');
      grad.addColorStop(1, 'rgba(254, 240, 138, 0.38)');
    } else {
      grad.addColorStop(0, 'rgba(249, 115, 22, 0.84)');
      grad.addColorStop(0.65, 'rgba(253, 186, 116, 0.52)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.22)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      ctx.strokeStyle = pal.trim === '#141214' ? 'rgba(255, 220, 190, 0.22)' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(w * 0.95, h * (0.4 + t * 0.2));
      ctx.lineTo(w * 0.08, h * (0.14 + t * 0.72));
      ctx.stroke();
    }
    ctx.restore();
  }

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

  // Subtle iris striations
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
    finCaudalMap: buildFinTexture(species, 'caudal', maxAnisotropy),
    finDorsalMap: buildFinTexture(species, 'dorsal', maxAnisotropy),
    finPectoralMap: buildFinTexture(species, 'pectoral', maxAnisotropy),
    eyeMap: buildEyeTexture(species, maxAnisotropy),
  };
}

export function disposeSpeciesTextureSet(set: SpeciesTextureSet): void {
  set.bodyMap.dispose();
  set.normalMap.dispose();
  set.roughnessMap.dispose();
  set.finCaudalMap.dispose();
  set.finDorsalMap.dispose();
  set.finPectoralMap.dispose();
  set.eyeMap.dispose();
}

/**
 * Injects continuous GPU traveling S-wave spine undulation + smooth U-turn C-bend
 * into both vertex positions and surface normals so scales shimmer naturally while flexing.
 */
function applyFishSpineShader(
  material: THREE.Material,
  uniforms: FishUniforms,
  cacheKey: string
): void {
  material.customProgramCacheKey = () => cacheKey;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSwimPhase = uniforms.uSwimPhase;
    shader.uniforms.uSwimAmp = uniforms.uSwimAmp;
    shader.uniforms.uTurnBend = uniforms.uTurnBend;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uSwimPhase;
uniform float uSwimAmp;
uniform float uTurnBend;

float fishLateralOffset(float x) {
  // x spans roughly -0.78 (tail tip) to +0.50 (snout)
  float tailT = clamp((0.44 - x) / 1.22, 0.0, 1.0);
  float wave = sin(uSwimPhase - tailT * 5.4) * uSwimAmp * pow(max(0.0001, tailT), 1.42);
  float bendT = clamp((0.36 - x) / 1.14, 0.0, 1.0);
  float turnCurve = uTurnBend * pow(max(0.0001, bendT), 1.65);
  return wave + turnCurve;
}`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
float eps = 0.015;
float dzdx = (fishLateralOffset(position.x + eps) - fishLateralOffset(position.x - eps)) / (2.0 * eps);
vec3 bentNormal = vec3(
  objectNormal.x - objectNormal.z * dzdx,
  objectNormal.y,
  objectNormal.z + objectNormal.x * dzdx
);
objectNormal = normalize(bentNormal);`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
transformed.z += fishLateralOffset(position.x);`
      );
  };
}

/**
 * Anatomical cross-section profile along t in [0..1] (0 = caudal peduncle, 1 = snout).
 */
function sampleBodyProfile(t: number, species: FishSpecies): { hh: number; hw: number; yCenter: number } {
  const pal = SPECIES_PALETTES[species];
  let hFactor = 0;
  let wFactor = 0;
  let yCenter = 0;

  if (t < 0.08) {
    // Narrow caudal peduncle tapering smoothly into tail fin socket
    const k = THREE.MathUtils.clamp(t / 0.08, 0, 1);
    hFactor = 0.28 + 0.14 * Math.sin(k * Math.PI * 0.5);
    wFactor = 0.20 + 0.16 * k;
  } else if (t < 0.64) {
    // Full rounded mid-torso with plump dorsal arch
    const k = THREE.MathUtils.clamp((t - 0.08) / 0.56, 0, 1);
    hFactor = 0.42 + 0.58 * Math.pow(Math.max(0, Math.sin(k * Math.PI * 0.85)), 0.72);
    wFactor = 0.36 + 0.64 * Math.sin(k * Math.PI * 0.92);
    yCenter = 0.014 * Math.sin(k * Math.PI);
  } else {
    // Head & rounded reef snout
    const k = THREE.MathUtils.clamp((t - 0.64) / 0.36, 0, 1);
    const snoutCurve = Math.sqrt(Math.max(0.0001, 1 - Math.pow(k, 1.85)));
    hFactor = 0.89 * snoutCurve;
    wFactor = 0.93 * Math.pow(snoutCurve, 0.92);
    yCenter = -0.025 * Math.pow(k, 1.4);
  }

  // Slight gill operculum flair near t = 0.72
  const gillDelta = Math.exp(-Math.pow((t - 0.72) / 0.032, 2)) * 0.055;
  wFactor += gillDelta;

  return {
    hh: Math.max(0.004, pal.aspectHeight * 0.5 * hFactor),
    hw: Math.max(0.004, pal.aspectWidth * 0.5 * wFactor),
    yCenter,
  };
}

/**
 * Builds sculpted anatomical 3D body BufferGeometry (length = 1.0 along X: [-0.50..+0.50]).
 */
function buildBodyGeometry(species: FishSpecies): THREE.BufferGeometry {
  const lengthSegs = 54;
  const radialSegs = 34;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= lengthSegs; i++) {
    const t = i / lengthSegs; // 0 (tail base) -> 1 (snout)
    const x = -0.5 + t;
    const { hh, hw, yCenter } = sampleBodyProfile(t, species);

    for (let j = 0; j <= radialSegs; j++) {
      const theta = (j / radialSegs) * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      // Subtle lateral compression sharper along dorsal spine ridge & ventral keel
      const y = yCenter + hh * sinT;
      const ridgePinch = 1 - 0.16 * Math.pow(Math.abs(sinT), 3.2);
      // Slight eye-socket boss near t=0.84, upper cheek
      const eyeSocketDist = Math.hypot((t - 0.84) / 0.055, (sinT - 0.30) / 0.30);
      const eyeBoss = eyeSocketDist < 1 ? (1 - eyeSocketDist * eyeSocketDist) * 0.009 : 0;

      const z = (hw * ridgePinch + eyeBoss) * cosT;

      positions.push(x, y, z);
      normals.push(0, sinT, cosT); // recomputed cleanly below

      // Map photo torso cleanly across both flanks: u = t (0 tail -> 1 snout), v = 0.03..0.97
      const u = t;
      const v = 0.5 + 0.47 * sinT;
      uvs.push(u, v);
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
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a subdivided dorsal fin ribbon anchored cleanly into the dorsal spine ridge.
 */
function buildDorsalGeometry(species: FishSpecies): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(0.56, species === 'tang' ? 0.16 : 0.145, 22, 6);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i); // -0.28..+0.28
    const ly = pos.getY(i); // -0.072..+0.072 (v=0 bottom -> v=1 top)
    const u = (lx + 0.28) / 0.56;
    const v = (ly + (species === 'tang' ? 0.08 : 0.0725)) / (species === 'tang' ? 0.16 : 0.145);

    const worldX = -0.34 + u * 0.56; // t from 0.16 to 0.72
    const t = worldX + 0.5;
    const prof = sampleBodyProfile(t, species);
    // Embed fin base 10% inside dorsal muscle ridge so there is never a gap when bending
    const spineY = prof.yCenter + prof.hh * 0.90;
    const finReach = (species === 'tang' ? 0.175 : 0.155) * (0.65 + 0.35 * Math.sin(u * Math.PI));

    pos.setXYZ(i, worldX, spineY + v * finReach, Math.sin(u * Math.PI) * 0.003 * (v - 0.2));
  }
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a subdivided anal fin anchored along the lower rear belly ridge.
 */
function buildAnalGeometry(species: FishSpecies): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(0.26, 0.11, 12, 4);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const u = (lx + 0.13) / 0.26;
    const v = (ly + 0.055) / 0.11; // 0 = bottom tip, 1 = root

    const worldX = -0.36 + u * 0.26; // t from 0.14 to 0.40
    const t = worldX + 0.5;
    const prof = sampleBodyProfile(t, species);
    const bellyY = prof.yCenter - prof.hh * 0.88;
    const finDrop = (1 - v) * (0.105 * Math.sin((0.15 + u * 0.75) * Math.PI));

    pos.setXYZ(i, worldX, bellyY - finDrop, 0);
  }
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a subdivided caudal tail fin extending cleanly from x = -0.46 to -0.77.
 */
function buildCaudalGeometry(species: FishSpecies): THREE.BufferGeometry {
  const tailLen = species === 'goldfish' ? 0.34 : 0.29;
  const tailHeight = species === 'clown' ? 0.30 : 0.34;
  const geom = new THREE.PlaneGeometry(tailLen, tailHeight, 14, 14);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i); // -tailLen/2 .. +tailLen/2
    const ly = pos.getY(i); // -tailHeight/2 .. +tailHeight/2
    const u = THREE.MathUtils.clamp((lx + tailLen * 0.5) / tailLen, 0, 1); // 0 = tip, 1 = peduncle attachment
    const worldX = -0.46 - (1 - u) * tailLen;
    // Slight natural fan flare & subtle cup
    const spread = 0.32 + 0.68 * Math.pow(Math.max(0, 1 - u), 0.65);
    const worldY = ly * spread;
    const cupZ = Math.sin(u * Math.PI) * 0.008 * Math.sign(worldY);
    pos.setXYZ(i, worldX, worldY, cupZ);
  }
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Creates a complete hyperrealistic 3D composite fish rig with:
 * - Sculpted anatomical 3D body + photo-projected skin + procedural scale normal/roughness maps
 * - Wet clearcoat & iridescence PBR shader + traveling spine S-wave & U-turn C-bend
 * - Subdivided translucent caudal, dorsal, anal fins sharing spine shader
 * - Hinged left/right pectoral & pelvic paddle fins for live sculling & braking
 * - 3D dual-layer eyeballs (iris/pupil + clearcoat cornea dome)
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
  root.rotation.order = 'YXZ';
  root.scale.setScalar(worldScale);

  const uniforms: FishUniforms = {
    uTime: { value: 0 },
    uSwimPhase: { value: Math.random() * Math.PI * 2 },
    uSwimAmp: { value: 0.036 },
    uTurnBend: { value: 0 },
  };

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // 1. Body mesh
  const bodyGeom = buildBodyGeometry(species);
  geometries.push(bodyGeom);

  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: textures.bodyMap,
    normalMap: textures.normalMap,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughnessMap: textures.roughnessMap,
    roughness: 0.72,
    metalness: 0.0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.52,
    iridescence: 0.04,
    iridescenceIOR: 1.33,
    envMapIntensity: 0.34,
    transparent: false,
    opacity: 1.0,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  applyFishSpineShader(bodyMat, uniforms, `fish-body-${species}`);
  if (waterFog) applyWaterDepthFog(bodyMat, waterFog, 1.18, 0.32);
  materials.push(bodyMat);

  const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
  bodyMesh.userData.fishId = fishId;
  root.add(bodyMesh);

  // 2. Median fins (caudal, dorsal, anal) sharing the continuous spine wave shader
  const caudalGeom = buildCaudalGeometry(species);
  const dorsalGeom = buildDorsalGeometry(species);
  const analGeom = buildAnalGeometry(species);
  geometries.push(caudalGeom, dorsalGeom, analGeom);

  const makeFinMat = (map: THREE.CanvasTexture, key: string) => {
    const m = new THREE.MeshPhysicalMaterial({
      map,
      transparent: true,
      alphaTest: 0.03,
      side: THREE.DoubleSide,
      roughness: 0.62,
      metalness: 0.0,
      clearcoat: 0.10,
      clearcoatRoughness: 0.48,
      envMapIntensity: 0.28,
      depthWrite: false,
    });
    applyFishSpineShader(m, uniforms, key);
    if (waterFog) applyWaterDepthFog(m, waterFog, 1.18, 0.16);
    materials.push(m);
    return m;
  };

  const caudalMat = makeFinMat(textures.finCaudalMap, `fish-caudal-${species}`);
  const dorsalMat = makeFinMat(textures.finDorsalMap, `fish-dorsal-${species}`);
  const analMat = makeFinMat(textures.finDorsalMap, `fish-anal-${species}`);

  const caudalMesh = new THREE.Mesh(caudalGeom, caudalMat);
  caudalMesh.userData.fishId = fishId;
  root.add(caudalMesh);

  const dorsalMesh = new THREE.Mesh(dorsalGeom, dorsalMat);
  dorsalMesh.userData.fishId = fishId;
  root.add(dorsalMesh);

  const analMesh = new THREE.Mesh(analGeom, analMat);
  analMesh.userData.fishId = fishId;
  root.add(analMesh);

  // 3. Hinged Pectoral & Pelvic paddle fins (pivot at gill socket)
  const pectGeom = new THREE.PlaneGeometry(0.18, 0.145, 6, 4);
  // Shift geometry so right edge (u=1) sits at pivot origin (0,0,0), fin extends backward (-X)
  pectGeom.translate(-0.09, 0, 0);
  const pelvGeom = new THREE.PlaneGeometry(0.13, 0.095, 4, 3);
  pelvGeom.translate(-0.065, -0.025, 0);
  geometries.push(pectGeom, pelvGeom);

  const pectMat = new THREE.MeshPhysicalMaterial({
    map: textures.finPectoralMap,
    transparent: true,
    alphaTest: 0.03,
    side: THREE.DoubleSide,
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.10,
    clearcoatRoughness: 0.48,
    envMapIntensity: 0.28,
    depthWrite: false,
  });
  if (waterFog) applyWaterDepthFog(pectMat, waterFog, 1.18);
  materials.push(pectMat);

  const gillProfile = sampleBodyProfile(0.71, species);
  const leftPectoral = new THREE.Group();
  leftPectoral.position.set(0.20, gillProfile.yCenter - 0.035, gillProfile.hw * 0.90);
  const leftPectMesh = new THREE.Mesh(pectGeom, pectMat);
  leftPectMesh.userData.fishId = fishId;
  leftPectoral.add(leftPectMesh);
  root.add(leftPectoral);

  const rightPectoral = new THREE.Group();
  rightPectoral.position.set(0.20, gillProfile.yCenter - 0.035, -gillProfile.hw * 0.90);
  const rightPectMesh = new THREE.Mesh(pectGeom, pectMat);
  rightPectMesh.userData.fishId = fishId;
  rightPectoral.add(rightPectMesh);
  root.add(rightPectoral);

  const pelvProfile = sampleBodyProfile(0.61, species);
  const leftPelvic = new THREE.Group();
  leftPelvic.position.set(0.10, pelvProfile.yCenter - pelvProfile.hh * 0.85, pelvProfile.hw * 0.38);
  const leftPelvMesh = new THREE.Mesh(pelvGeom, pectMat);
  leftPelvMesh.userData.fishId = fishId;
  leftPelvic.add(leftPelvMesh);
  root.add(leftPelvic);

  const rightPelvic = new THREE.Group();
  rightPelvic.position.set(0.10, pelvProfile.yCenter - pelvProfile.hh * 0.85, -pelvProfile.hw * 0.38);
  const rightPelvMesh = new THREE.Mesh(pelvGeom, pectMat);
  rightPelvMesh.userData.fishId = fishId;
  rightPelvic.add(rightPelvMesh);
  root.add(rightPelvic);

  // 4. 3D Glossy Dual-Layer Eyeballs (Iris + Clearcoat Cornea Dome)
  const eyeSocket = sampleBodyProfile(0.84, species);
  const eyeX = 0.34;
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
    // Orient sphere UV face outward along ±Z
    eyeGroup.rotation.y = side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
    eyeGroup.scale.set(0.82, 1.0, 1.0);

    const iris = new THREE.Mesh(irisGeom, irisMat);
    iris.userData.fishId = fishId;
    const cornea = new THREE.Mesh(corneaGeom, corneaMat);
    cornea.userData.fishId = fishId;

    eyeGroup.add(iris, cornea);
    root.add(eyeGroup);
  }

  return {
    root,
    uniforms,
    leftPectoral,
    rightPectoral,
    leftPelvic,
    rightPelvic,
    materials,
    geometries,
  };
}
