import * as THREE from 'three';
import backdropUrl from '../assets/images/aquarium_backdrop_1794773613348.jpg';
import macroSandUrl from '../assets/images/macro_aquarium_sand_1794778201320.jpg';
import macroRockUrl from '../assets/images/macro_wet_rock_1794778201956.jpg';
import macroSwordUrl from '../assets/images/macro_leaf_sword_1794778202485.jpg';
import macroVallisneriaUrl from '../assets/images/macro_leaf_vallisneria_1794778202347.jpg';
import type { AquariumBackgroundId } from '../types/aquarium';

export interface AquariumPhotoTextures {
  backdropMap: THREE.Texture | null;
  backdrops: Record<AquariumBackgroundId, THREE.Texture | null>;
  sandAlbedo: THREE.CanvasTexture;
  sandNormal: THREE.CanvasTexture;
  sandRoughness: THREE.CanvasTexture;
  rockAlbedo: THREE.CanvasTexture;
  rockNormal: THREE.CanvasTexture;
  rockRoughness: THREE.CanvasTexture;
  swordAlbedo: THREE.CanvasTexture;
  swordNormal: THREE.CanvasTexture;
  vallisneriaAlbedo: THREE.CanvasTexture;
  vallisneriaNormal: THREE.CanvasTexture;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load texture image: ${url}`));
    img.src = url;
  });
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Computes Sobel tangent-space Normal Map and Roughness Map directly from an albedo Canvas.
 */
function deriveNormalAndRoughness(
  albedoCanvas: HTMLCanvasElement,
  options: {
    normalStrength: number;
    roughBase: number;
    roughContrast: number;
    tileable: boolean;
    maxAnisotropy: number;
  }
): { normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const w = albedoCanvas.width;
  const h = albedoCanvas.height;
  const actx = albedoCanvas.getContext('2d', { willReadFrequently: true })!;
  const srcData = actx.getImageData(0, 0, w, h).data;

  const lumBuf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    lumBuf[i] = (srcData[p] * 0.299 + srcData[p + 1] * 0.587 + srcData[p + 2] * 0.114) / 255;
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

  const s = options.normalStrength;
  for (let y = 0; y < h; y++) {
    const ym = options.tileable ? (y - 1 + h) % h : Math.max(0, y - 1);
    const yp = options.tileable ? (y + 1) % h : Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = options.tileable ? (x - 1 + w) % w : Math.max(0, x - 1);
      const xp = options.tileable ? (x + 1) % w : Math.min(w - 1, x + 1);

      const dX = (lumBuf[y * w + xp] - lumBuf[y * w + xm]) * s;
      const dY = (lumBuf[yp * w + x] - lumBuf[ym * w + x]) * s;
      const nx = -dX;
      const ny = -dY;
      const nz = 1.0;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);

      const idx = y * w + x;
      const p = idx * 4;
      normImg.data[p] = clampByte((nx * inv * 0.5 + 0.5) * 255);
      normImg.data[p + 1] = clampByte((ny * inv * 0.5 + 0.5) * 255);
      normImg.data[p + 2] = clampByte((nz * inv * 0.5 + 0.5) * 255);
      normImg.data[p + 3] = 255;

      const rVal = clampByte(
        (options.roughBase - (lumBuf[idx] - 0.5) * options.roughContrast) * 255
      );
      roughImg.data[p] = rVal;
      roughImg.data[p + 1] = rVal;
      roughImg.data[p + 2] = rVal;
      roughImg.data[p + 3] = 255;
    }
  }
  nctx.putImageData(normImg, 0, 0);
  rctx.putImageData(roughImg, 0, 0);

  const normalMap = new THREE.CanvasTexture(normCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = options.maxAnisotropy;
  if (options.tileable) {
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
  }

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = options.maxAnisotropy;
  if (options.tileable) {
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;
  }

  return { normalMap, roughnessMap };
}

/**
 * Resamples a macro photo onto a target canvas with optional underwater color integration.
 */
function imageToCanvas(
  img: HTMLImageElement | null,
  sizeW: number,
  sizeH: number,
  fallbackColor: string,
  underwaterTint?: { rMul: number; gMul: number; bMul: number; bAdd: number }
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = sizeW;
  canvas.height = sizeH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = fallbackColor;
  ctx.fillRect(0, 0, sizeW, sizeH);

  if (img && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0, sizeW, sizeH);
    if (underwaterTint) {
      const id = ctx.getImageData(0, 0, sizeW, sizeH);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clampByte(d[i] * underwaterTint.rMul);
        d[i + 1] = clampByte(d[i + 1] * underwaterTint.gMul);
        d[i + 2] = clampByte(d[i + 2] * underwaterTint.bMul + underwaterTint.bAdd);
      }
      ctx.putImageData(id, 0, 0);
    }
  }
  return canvas;
}

/**
 * Aligns the botanical midrib of macro_leaf_sword vertically along u = 0.5,
 * and carves a natural lanceolate leaf silhouette + petiole stem into the alpha channel.
 */
function buildSwordLeafCanvas(img: HTMLImageElement | null): HTMLCanvasElement {
  const w = 384;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  if (img && img.naturalWidth > 0) {
    // Rotate +38deg so the diagonal midrib of the macro leaf runs vertically along center
    ctx.save();
    ctx.translate(w * 0.5, h * 0.5);
    ctx.rotate((38 * Math.PI) / 180);
    const drawScale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * 1.58;
    const dw = img.naturalWidth * drawScale;
    const dh = img.naturalHeight * drawScale;
    ctx.drawImage(img, -dw * 0.52, -dh * 0.5, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = '#3b7d35';
    ctx.fillRect(0, 0, w, h);
  }

  // Apply organic lanceolate Amazon Sword silhouette + subtle root darkening
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  for (let y = 0; y < h; y++) {
    // v = 0 at top tip (y=0), v = 1 at root stem (y=h-1)
    const vFromRoot = 1 - y / (h - 1);
    let halfLeafWidth: number;
    if (vFromRoot < 0.18) {
      // Narrow stem/petiole
      halfLeafWidth = 0.08 + (vFromRoot / 0.18) * 0.05;
    } else {
      const k = (vFromRoot - 0.18) / 0.82;
      // Organic slightly wavy lanceolate profile
      const waveEdge = Math.sin(vFromRoot * 28.0) * 0.015 * Math.sin(k * Math.PI);
      halfLeafWidth = 0.13 + 0.36 * Math.pow(Math.sin(k * Math.PI * 0.94), 0.72) + waveEdge;
    }

    const rootShade = 0.62 + 0.38 * Math.min(1, vFromRoot / 0.25);

    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x / (w - 1) - 0.5);
      const p = (y * w + x) * 4;
      if (dx > halfLeafWidth) {
        data[p + 3] = 0;
      } else {
        const edgeDist = (halfLeafWidth - dx) / Math.max(0.02, halfLeafWidth);
        const edgeAlpha = Math.min(1, edgeDist * 14);
        data[p] = clampByte(data[p] * rootShade * 0.92);
        data[p + 1] = clampByte(data[p + 1] * rootShade * 0.98);
        data[p + 2] = clampByte(data[p + 2] * rootShade * 0.96 + 4);
        data[p + 3] = clampByte(edgeAlpha * 255);
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Processes macro Vallisneria leaf photo into a crisp ribbon blade with slightly tapered tip
 * and subtle root shading.
 */
function buildVallisneriaBladeCanvas(img: HTMLImageElement | null): HTMLCanvasElement {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  if (img && img.naturalWidth > 0) {
    // Crop central clean section of Vallisneria blade fibers
    ctx.drawImage(
      img,
      img.naturalWidth * 0.18,
      img.naturalHeight * 0.08,
      img.naturalWidth * 0.64,
      img.naturalHeight * 0.84,
      0,
      0,
      w,
      h
    );
  } else {
    ctx.fillStyle = '#3f843a';
    ctx.fillRect(0, 0, w, h);
  }

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  for (let y = 0; y < h; y++) {
    const vFromRoot = 1 - y / (h - 1);
    const tipFade = vFromRoot > 0.9 ? 1 - (vFromRoot - 0.9) / 0.1 : 1;
    const halfW = 0.48 * Math.pow(Math.max(0.02, tipFade), 0.55);
    const rootShade = 0.65 + 0.35 * Math.min(1, vFromRoot / 0.22);

    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x / (w - 1) - 0.5);
      const p = (y * w + x) * 4;
      if (dx > halfW) {
        data[p + 3] = 0;
      } else {
        const edgeDist = (halfW - dx) / Math.max(0.02, halfW);
        const edgeAlpha = Math.min(1, edgeDist * 16);
        data[p] = clampByte(data[p] * rootShade * 0.90);
        data[p + 1] = clampByte(data[p + 1] * rootShade * 0.98);
        data[p + 2] = clampByte(data[p + 2] * rootShade * 0.98 + 4);
        data[p + 3] = clampByte(edgeAlpha * 242);
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function createProceduralBackdropTexture(
  id: AquariumBackgroundId,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const w = 768;
  const h = 432;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  if (id === 'frosted') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#f8fdff');
    grad.addColorStop(0.35, '#d4effa');
    grad.addColorStop(0.75, '#9cd3eb');
    grad.addColorStop(1.0, '#66a4c7');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.5, h * 0.18, 24, w * 0.5, h * 0.36, w * 0.62);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    glow.addColorStop(0.6, 'rgba(220, 246, 255, 0.18)');
    glow.addColorStop(1, 'rgba(25, 80, 118, 0.24)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.filter = 'blur(12px)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.beginPath();
    ctx.ellipse(w * 0.35, h * 0.24, 190, 42, -0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w * 0.72, h * 0.32, 160, 36, 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.filter = 'none';
  } else if (id === 'slate') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#273240');
    grad.addColorStop(0.55, '#141b25');
    grad.addColorStop(1.0, '#080c12');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.filter = 'blur(8px)';
    for (let i = 0; i < 8; i++) {
      const rx = (i / 7) * w;
      const rw = 115 + (i % 3) * 42;
      const rh = 120 + (i % 4) * 38;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(95, 122, 148, 0.22)' : 'rgba(8, 12, 18, 0.52)';
      ctx.beginPath();
      ctx.moveTo(rx - rw * 0.5, h);
      ctx.lineTo(rx - rw * 0.18, h - rh);
      ctx.lineTo(rx + rw * 0.26, h - rh * 0.82);
      ctx.lineTo(rx + rw * 0.56, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.filter = 'none';

    const spot = ctx.createRadialGradient(w * 0.5, 0, 18, w * 0.5, h * 0.14, w * 0.62);
    spot.addColorStop(0, 'rgba(130, 178, 206, 0.18)');
    spot.addColorStop(1, 'rgba(3, 6, 12, 0.48)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, w, h);
  } else if (id === 'reef') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#1ab0d4');
    grad.addColorStop(0.34, '#0a6d9c');
    grad.addColorStop(0.74, '#053b63');
    grad.addColorStop(1.0, '#021b33');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.filter = 'blur(9px)';
    const shafts = [0.22, 0.48, 0.74];
    for (const sx of shafts) {
      const sg = ctx.createLinearGradient(w * sx, 0, w * (sx + 0.08), h * 0.88);
      sg.addColorStop(0, 'rgba(175, 245, 255, 0.34)');
      sg.addColorStop(1, 'rgba(175, 245, 255, 0.0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(w * (sx - 0.05), 0);
      ctx.lineTo(w * (sx + 0.05), 0);
      ctx.lineTo(w * (sx + 0.17), h * 0.9);
      ctx.lineTo(w * (sx - 0.02), h * 0.9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(3, 28, 52, 0.78)';
    for (let i = 0; i < 6; i++) {
      const cx = 65 + i * 132;
      const cy = h - 22 - (i % 2) * 30;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 98 + (i % 3) * 24, 72 + (i % 2) * 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(36, 198, 206, 0.30)';
    for (let i = 0; i < 4; i++) {
      const cx = 110 + i * 168;
      ctx.beginPath();
      ctx.ellipse(cx, h - 82 - (i % 2) * 22, 46, 30, (i - 1.5) * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(244, 128, 96, 0.22)';
    for (let i = 0; i < 3; i++) {
      const cx = 190 + i * 195;
      ctx.beginPath();
      ctx.ellipse(cx, h - 72 - (i % 2) * 16, 32, 24, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = 'none';
  } else if (id === 'amazon') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#3e855c');
    grad.addColorStop(0.36, '#184a36');
    grad.addColorStop(0.78, '#0b2b20');
    grad.addColorStop(1.0, '#04140f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.filter = 'blur(8px)';
    ctx.strokeStyle = 'rgba(6, 26, 18, 0.78)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const bx = 24 + i * 43 + ((i * 19) % 17);
      const topY = 44 + ((i * 37) % 130);
      ctx.lineWidth = 10 + (i % 4) * 5;
      ctx.beginPath();
      ctx.moveTo(bx, h + 10);
      ctx.quadraticCurveTo(bx + ((i % 2 === 0 ? 1 : -1) * 28), (h + topY) * 0.5, bx + (i % 3 - 1) * 22, topY);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(116, 190, 110, 0.22)';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.ellipse(70 + i * 92, 125 + (i % 3) * 44, 52, 95, (i % 2 === 0 ? 0.2 : -0.2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = 'none';

    const canopyGlow = ctx.createRadialGradient(w * 0.45, 0, 18, w * 0.48, h * 0.2, w * 0.58);
    canopyGlow.addColorStop(0, 'rgba(222, 240, 158, 0.30)');
    canopyGlow.addColorStop(1, 'rgba(4, 18, 12, 0.42)');
    ctx.fillStyle = canopyGlow;
    ctx.fillRect(0, 0, w, h);
  } else if (id === 'abyss') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#14589c');
    grad.addColorStop(0.32, '#083063');
    grad.addColorStop(0.75, '#031533');
    grad.addColorStop(1.0, '#010716');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const cone = ctx.createRadialGradient(w * 0.5, -20, 18, w * 0.5, h * 0.22, w * 0.56);
    cone.addColorStop(0, 'rgba(104, 198, 255, 0.38)');
    cone.addColorStop(0.55, 'rgba(20, 86, 158, 0.16)');
    cone.addColorStop(1, 'rgba(1, 8, 22, 0.48)');
    ctx.fillStyle = cone;
    ctx.fillRect(0, 0, w, h);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#2a8ab8');
    grad.addColorStop(0.5, '#12537a');
    grad.addColorStop(1.0, '#062640');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export async function loadAquariumPhotoTextures(
  maxAnisotropy: number
): Promise<AquariumPhotoTextures> {
  const [backdropRes, sandRes, rockRes, swordRes, valRes] = await Promise.allSettled([
    loadImage(backdropUrl),
    loadImage(macroSandUrl),
    loadImage(macroRockUrl),
    loadImage(macroSwordUrl),
    loadImage(macroVallisneriaUrl),
  ]);

  const backdropImg = backdropRes.status === 'fulfilled' ? backdropRes.value : null;
  const sandImg = sandRes.status === 'fulfilled' ? sandRes.value : null;
  const rockImg = rockRes.status === 'fulfilled' ? rockRes.value : null;
  const swordImg = swordRes.status === 'fulfilled' ? swordRes.value : null;
  const valImg = valRes.status === 'fulfilled' ? valRes.value : null;

  // 1. Softly blurred underwater backdrop variants for rear glass depth
  let naturalBackdrop: THREE.Texture | null = null;
  if (backdropImg) {
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 768;
    bgCanvas.height = 432;
    const bgCtx = bgCanvas.getContext('2d')!;
    bgCtx.filter = 'blur(3.5px) saturate(0.92) brightness(0.86)';
    bgCtx.drawImage(backdropImg, -12, -12, bgCanvas.width + 24, bgCanvas.height + 24);
    bgCtx.filter = 'none';
    // Subtle deep-water vignette gradient so foreground 3D rocks & plants pop cleanly
    const grad = bgCtx.createLinearGradient(0, 0, 0, bgCanvas.height);
    grad.addColorStop(0, 'rgba(18, 120, 175, 0.15)');
    grad.addColorStop(0.65, 'rgba(8, 65, 108, 0.34)');
    grad.addColorStop(1, 'rgba(5, 38, 66, 0.56)');
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

    naturalBackdrop = new THREE.CanvasTexture(bgCanvas);
    naturalBackdrop.colorSpace = THREE.SRGBColorSpace;
    naturalBackdrop.anisotropy = maxAnisotropy;
  } else {
    naturalBackdrop = createProceduralBackdropTexture('natural', maxAnisotropy);
  }

  const backdrops: Record<AquariumBackgroundId, THREE.Texture | null> = {
    natural: naturalBackdrop,
    reef: createProceduralBackdropTexture('reef', maxAnisotropy),
    amazon: createProceduralBackdropTexture('amazon', maxAnisotropy),
    slate: createProceduralBackdropTexture('slate', maxAnisotropy),
    frosted: createProceduralBackdropTexture('frosted', maxAnisotropy),
    abyss: createProceduralBackdropTexture('abyss', maxAnisotropy),
  };

  // 2. Macro Quartz Sand PBR set
  const sandCanvas = imageToCanvas(sandImg, 512, 512, '#bda988', {
    rMul: 0.90,
    gMul: 0.95,
    bMul: 0.99,
    bAdd: 6,
  });
  const sandAlbedo = new THREE.CanvasTexture(sandCanvas);
  sandAlbedo.colorSpace = THREE.SRGBColorSpace;
  sandAlbedo.wrapS = THREE.RepeatWrapping;
  sandAlbedo.wrapT = THREE.RepeatWrapping;
  sandAlbedo.repeat.set(3.4, 2.0);
  sandAlbedo.anisotropy = maxAnisotropy;

  const { normalMap: sandNormal, roughnessMap: sandRoughness } = deriveNormalAndRoughness(
    sandCanvas,
    {
      normalStrength: 3.4,
      roughBase: 0.88,
      roughContrast: 0.24,
      tileable: true,
      maxAnisotropy,
    }
  );
  sandNormal.repeat.set(3.4, 2.0);
  sandRoughness.repeat.set(3.4, 2.0);

  // 3. Macro Wet Seiryu Rock PBR set
  const rockCanvas = imageToCanvas(rockImg, 512, 512, '#434a4f', {
    rMul: 0.92,
    gMul: 0.96,
    bMul: 1.02,
    bAdd: 4,
  });
  const rockAlbedo = new THREE.CanvasTexture(rockCanvas);
  rockAlbedo.colorSpace = THREE.SRGBColorSpace;
  rockAlbedo.wrapS = THREE.RepeatWrapping;
  rockAlbedo.wrapT = THREE.RepeatWrapping;
  rockAlbedo.anisotropy = maxAnisotropy;

  const { normalMap: rockNormal, roughnessMap: rockRoughness } = deriveNormalAndRoughness(
    rockCanvas,
    {
      normalStrength: 4.2,
      roughBase: 0.56,
      roughContrast: 0.34,
      tileable: true,
      maxAnisotropy,
    }
  );

  // 4. Macro Botanical Sword Leaf PBR set
  const swordCanvas = buildSwordLeafCanvas(swordImg);
  const swordAlbedo = new THREE.CanvasTexture(swordCanvas);
  swordAlbedo.colorSpace = THREE.SRGBColorSpace;
  swordAlbedo.anisotropy = maxAnisotropy;
  const { normalMap: swordNormal } = deriveNormalAndRoughness(swordCanvas, {
    normalStrength: 2.8,
    roughBase: 0.40,
    roughContrast: 0.2,
    tileable: false,
    maxAnisotropy,
  });

  // 5. Macro Botanical Vallisneria Blade PBR set
  const valCanvas = buildVallisneriaBladeCanvas(valImg);
  const vallisneriaAlbedo = new THREE.CanvasTexture(valCanvas);
  vallisneriaAlbedo.colorSpace = THREE.SRGBColorSpace;
  vallisneriaAlbedo.anisotropy = maxAnisotropy;
  const { normalMap: vallisneriaNormal } = deriveNormalAndRoughness(valCanvas, {
    normalStrength: 2.4,
    roughBase: 0.42,
    roughContrast: 0.2,
    tileable: false,
    maxAnisotropy,
  });

  return {
    backdropMap: naturalBackdrop,
    backdrops,
    sandAlbedo,
    sandNormal,
    sandRoughness,
    rockAlbedo,
    rockNormal,
    rockRoughness,
    swordAlbedo,
    swordNormal,
    vallisneriaAlbedo,
    vallisneriaNormal,
  };
}

export function disposeAquariumPhotoTextures(tex: AquariumPhotoTextures): void {
  const seen = new Set<THREE.Texture>();
  if (tex.backdropMap) {
    tex.backdropMap.dispose();
    seen.add(tex.backdropMap);
  }
  for (const b of Object.values(tex.backdrops)) {
    if (b && !seen.has(b)) {
      b.dispose();
      seen.add(b);
    }
  }
  tex.sandAlbedo.dispose();
  tex.sandNormal.dispose();
  tex.sandRoughness.dispose();
  tex.rockAlbedo.dispose();
  tex.rockNormal.dispose();
  tex.rockRoughness.dispose();
  tex.swordAlbedo.dispose();
  tex.swordNormal.dispose();
  tex.vallisneriaAlbedo.dispose();
  tex.vallisneriaNormal.dispose();
}
