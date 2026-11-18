import * as THREE from 'three';

export interface WaterFogUniforms {
  uWaterColor: { value: THREE.Color };
  uWaterDensity: { value: number };
  uTime: { value: number };
  uMotionAmp: { value: number };
  uCausticIntensity: { value: number };
  uSunColor: { value: THREE.Color };
}

export function createWaterFogUniforms(): WaterFogUniforms {
  return {
    uWaterColor: { value: new THREE.Color(0x11587a) },
    uWaterDensity: { value: 0.24 },
    uTime: { value: 0 },
    uMotionAmp: { value: 1.0 },
    uCausticIntensity: { value: 1.0 },
    uSunColor: { value: new THREE.Color(0xfff1d6) },
  };
}

/**
 * Injects physically motivated tank-interior water absorption, optical contrast
 * softening, and optional upward-facing animated underwater caustics into any
 * MeshStandardMaterial / MeshPhysicalMaterial.
 */
export function applyWaterDepthFog(
  material: THREE.Material,
  uniforms: WaterFogUniforms,
  densityScale = 1.0,
  causticStrength = 0.0
): void {
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;

  material.customProgramCacheKey = () =>
    `${prevKey ? prevKey.call(material) : 'std'}-waterfog-${densityScale.toFixed(2)}-c${causticStrength.toFixed(2)}`;

  material.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) {
      prevCompile.call(material, shader, renderer);
    }

    shader.uniforms.uWaterColor = uniforms.uWaterColor;
    shader.uniforms.uWaterDensity = uniforms.uWaterDensity;

    const useCaustics = causticStrength > 0.001;
    if (useCaustics) {
      shader.uniforms.uWfTime = uniforms.uTime;
      shader.uniforms.uWfMotionAmp = uniforms.uMotionAmp;
      shader.uniforms.uWfCausticIntensity = uniforms.uCausticIntensity;
      shader.uniforms.uWfSunColor = uniforms.uSunColor;
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWaterWorldPos;${useCaustics ? '\nvarying vec3 vWaterWorldNormal;' : ''}`
      )
      .replace(
        '#include <project_vertex>',
        `#ifdef USE_INSTANCING
  vWaterWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;${
    useCaustics
      ? '\n  vWaterWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);'
      : ''
  }
#else
  vWaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;${
    useCaustics
      ? '\n  vWaterWorldNormal = normalize(mat3(modelMatrix) * objectNormal);'
      : ''
  }
#endif
#include <project_vertex>`
      );

    const causticSnippet = useCaustics
      ? `float wTc = uWfTime * 0.78 * uWfMotionAmp;
vec2 wUvC = (vWaterWorldPos.xz + vWaterWorldPos.y * 0.14) * 1.65;
float wC1 = sin(wUvC.x * 2.1 + wTc + cos(wUvC.y * 1.9 - wTc * 0.8));
float wC2 = cos(wUvC.y * 2.4 - wTc * 1.1 + sin(wUvC.x * 2.2 + wTc * 0.7));
float wCaustic = pow(max(0.0001, 1.0 - abs(wC1 + wC2) * 0.65), 3.3);
float wUpMask = smoothstep(-0.15, 0.78, vWaterWorldNormal.y);
float wHeightMask = mix(0.52, 1.15, clamp((vWaterWorldPos.y + 1.15) / 2.45, 0.0, 1.0));
gl_FragColor.rgb += uWfSunColor * vec3(0.24, 0.42, 0.46) * wCaustic * wUpMask * wHeightMask * ${causticStrength.toFixed(3)} * uWfCausticIntensity;
`
      : '';

    const fragUniforms = useCaustics
      ? `uniform vec3 uWaterColor;
uniform float uWaterDensity;
uniform float uWfTime;
uniform float uWfMotionAmp;
uniform float uWfCausticIntensity;
uniform vec3 uWfSunColor;
varying vec3 vWaterWorldPos;
varying vec3 vWaterWorldNormal;`
      : `uniform vec3 uWaterColor;
uniform float uWaterDensity;
varying vec3 vWaterWorldPos;`;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${fragUniforms}`
      )
      .replace(
        '#include <dithering_fragment>',
        `${causticSnippet}vec3 wRay = vWaterWorldPos - cameraPosition;
float wSegLen = length(wRay);
vec3 wDir = wRay / max(wSegLen, 0.0001);
vec3 wSafeDir = vec3(
  abs(wDir.x) < 0.0001 ? 0.0001 : wDir.x,
  abs(wDir.y) < 0.0001 ? 0.0001 : wDir.y,
  abs(wDir.z) < 0.0001 ? 0.0001 : wDir.z
);
vec3 wInvDir = 1.0 / wSafeDir;
vec3 wT0 = (vec3(-2.70, -1.55, -1.50) - cameraPosition) * wInvDir;
vec3 wT1 = (vec3( 2.70,  1.32,  1.50) - cameraPosition) * wInvDir;
vec3 wTMin = min(wT0, wT1);
float wEnter = max(max(wTMin.x, wTMin.y), max(wTMin.z, 0.0));
float wDist = max(0.0, wSegLen - wEnter);
float wDepthT = clamp((wDist - 0.16) / 2.85, 0.0, 1.0);
float wLuma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
vec3 wSoft = mix(gl_FragColor.rgb, vec3(wLuma * 0.96 + 0.04), wDepthT * 0.30 * ${densityScale.toFixed(2)});
float wScatter = 1.0 - exp(-max(0.0, wDist - 0.12) * uWaterDensity * ${densityScale.toFixed(2)});
wScatter = clamp(wScatter, 0.0, 0.64);
gl_FragColor.rgb = mix(wSoft, uWaterColor, wScatter);
#include <dithering_fragment>`
      );
  };
}
