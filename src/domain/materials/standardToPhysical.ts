import { MeshPhysicalMaterial, MeshStandardMaterial } from 'three';

/**
 * MeshStandardMaterial → MeshPhysicalMaterial 안전 변환.
 *
 * `MeshPhysicalMaterial.copy(standard)`는 Standard에 없는 Vector2(clearcoatNormalScale 등)를
 * 읽다 crash하므로, 공통 PBR 속성만 수동 이전한다. 텍스처 맵은 참조 공유.
 *
 * Physical로 올려두면 HDRI 환경맵(IBL) 반사·클리어코트·투과 등 고급 환경 반응이 가능해진다.
 * (GLB 기본 Standard 재질은 환경 반사가 약하고 인스펙터 편집 슬롯이 잡히지 않는다.)
 */
export function standardToPhysical(std: MeshStandardMaterial): MeshPhysicalMaterial {
  const phys = new MeshPhysicalMaterial();
  phys.name = std.name;
  phys.color.copy(std.color);
  phys.roughness = std.roughness;
  phys.metalness = std.metalness;
  phys.emissive.copy(std.emissive);
  phys.emissiveIntensity = std.emissiveIntensity;
  phys.opacity = std.opacity;
  phys.transparent = std.transparent;
  phys.side = std.side;
  phys.flatShading = std.flatShading;
  phys.vertexColors = std.vertexColors;
  phys.wireframe = std.wireframe;
  phys.envMapIntensity = std.envMapIntensity;
  // 텍스처 맵 — 참조 공유
  phys.map = std.map;
  phys.normalMap = std.normalMap;
  if (std.normalScale) phys.normalScale.copy(std.normalScale);
  phys.roughnessMap = std.roughnessMap;
  phys.metalnessMap = std.metalnessMap;
  phys.emissiveMap = std.emissiveMap;
  phys.aoMap = std.aoMap;
  phys.aoMapIntensity = std.aoMapIntensity;
  phys.alphaMap = std.alphaMap;
  phys.bumpMap = std.bumpMap;
  phys.bumpScale = std.bumpScale;
  phys.displacementMap = std.displacementMap;
  phys.needsUpdate = true;
  return phys;
}