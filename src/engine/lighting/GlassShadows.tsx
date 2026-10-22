import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { MeshDepthMaterial, MeshDistanceMaterial, type Material, type Mesh } from 'three';
import { requestShadowUpdate } from './ShadowDemand';

/**
 * 래스터 그림자에서 반투명(투명도로 비치는) 재질이 빛을 통과시키게 — 경로 추적은 투명도만큼 그림자 광선을 통과시킨다.
 * three.js 그림자 지도는 재질의 투명도를 보지 않아 반투명 유리 그림자가 벽돌처럼 새까맣다.
 * 굴절 유리(투과)는 그림자를 그대로 둔다 — 빛은 휘어서 다른 곳에 모이고 그 빛은 커스틱(Caustics)이 더한다.
 * 반투명 메시에 그림자용 재질을 따로 달아, 덮는 비율(불투명도)만큼만 그림자 지도에 점을 찍는다
 * (나머지는 점무늬로 비운다 — 부드러운 그림자 필터가 고르게 펴서 옅은 그림자가 된다).
 * 투과 재질은 늦게 바뀌기도 해서(유리 굴절 켜기·재질 편집) 1초마다 다시 맞춘다 — 바뀐 메시만 고친다.
 */

const STEPS = 20;
const depthCache = new Map<number, MeshDepthMaterial>();
const distanceCache = new Map<number, MeshDistanceMaterial>();

/** 화면 위치로 고정된 점무늬 — 덮는 비율보다 크면 버린다 */
function dither<T extends Material>(m: T, coverage: number): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.glassCoverage = { value: coverage };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float glassCoverage;\nvoid main() {\n\tif ( fract( sin( dot( floor( gl_FragCoord.xy ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) >= glassCoverage ) discard;');
  };
  m.customProgramCacheKey = () => 'glassShadow';
  m.userData.glassShadow = coverage;
  return m;
}

function shadowMaterials(coverage: number) {
  const step = Math.max(1, Math.round(coverage * STEPS));
  let depth = depthCache.get(step);
  if (!depth) depthCache.set(step, (depth = dither(new MeshDepthMaterial(), step / STEPS)));
  let distance = distanceCache.get(step);
  if (!distance) distanceCache.set(step, (distance = dither(new MeshDistanceMaterial(), step / STEPS)));
  return { depth, distance };
}

/** 그림자를 덮는 비율 — 유리·반투명이 아니면 null(보통 그림자) */
export function glassShadowCoverage(material: Material | Material[]): number | null {
  if (Array.isArray(material)) return null;
  const m = material as Material & { transmission?: number };
  // 굴절·커스틱을 끈 유리 — 보통 그림자(빛이 새지 않는다)
  if (m.userData.glassTranslucent != null) return null;
  // 굴절 유리는 보통 그림자 — 빛은 휘어서 다른 곳에 모인다(커스틱이 그 빛을 더한다, Caustics)
  if (m.transmission && m.transmission > 0) return null;
  if (m.transparent && m.opacity < 1) return Math.max(0.05, m.opacity);
  return null;
}

/** 그림자 재질을 바꿨으면 true */
export function applyGlassShadow(mesh: Mesh): boolean {
  const coverage = glassShadowCoverage(mesh.material);
  const mark = mesh.userData.glassShadowSet as boolean | undefined;
  if (coverage == null || coverage >= 0.999) {
    if (mark) {
      mesh.customDepthMaterial = undefined;
      mesh.customDistanceMaterial = undefined;
      mesh.userData.glassShadowSet = false;
      return true;
    }
    return false;
  }
  const { depth, distance } = shadowMaterials(coverage);
  if (mesh.customDepthMaterial === depth) return false;
  // 다른 용도로 단 그림자 재질은 건드리지 않는다
  if (mesh.customDepthMaterial && !mesh.customDepthMaterial.userData.glassShadow) return false;
  mesh.customDepthMaterial = depth;
  mesh.customDistanceMaterial = distance;
  mesh.userData.glassShadowSet = true;
  return true;
}

export function GlassShadows() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const sync = () => {
      let changed = false;
      scene.traverse((o) => {
        if ((o as Mesh).isMesh && (o as Mesh).castShadow && applyGlassShadow(o as Mesh)) changed = true;
      });
      // 그림자 지도는 바뀔 때만 다시 그린다(ShadowDemand) — 바꿨으면 알린다
      if (changed) requestShadowUpdate();
    };
    sync();
    const id = window.setInterval(sync, 1000);
    return () => window.clearInterval(id);
  }, [scene]);
  return null;
}
