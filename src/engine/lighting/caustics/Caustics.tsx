import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DataUtils,
  Group,
  HalfFloatType,
  CustomBlending,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  RGBAFormat,
  ShaderMaterial,
  Sphere,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { useMutracerStore } from '@/engine/stores/mutracerStore';
import { isGizmoDragging } from '@/features/models/gizmoGuard';
import { startCausticJob, type CausticJob, type CausticPatch } from './causticTrace';

/**
 * 커스틱 — 유리를 지나 휘어 모인 빛을 바닥·벽에 더한다(causticTrace 광자 추적 결과).
 * 조각마다 메시 하나를 면 위 2mm 에 띄운다:
 * - 래스터: 장면과 함께 밝기 격자를 더하기 혼합으로 그린다
 * - 경로 추적: 경로 추적 장면에는 넣지 않는다(MutracerRenderer 가 건너뜀). 경로 추적 화면 위에 덧그린다
 *   ({@link renderCausticsOverlay}). 예전엔 장면 안에 「덮는 비율 × 발광」 판으로 넣었는데, 그 판이 그림자 광선을
 *   덮는 비율만큼 막아 둘레 그림자가 얼룩지고 화면 광선이 확률로 맞아 잡티가 생겼다(사용자 지적 2026-10-22)
 *
 * 다시 계산하는 때 — 유리·조명·메시가 움직이거나 재질이 바뀌면 0.4초 뒤(기즈모로 끄는 중엔 놓은 뒤).
 * 계산은 화면을 멈추지 않게 조금씩 나눠 한다. 계산하는 동안엔 옛 커스틱을 숨긴다(자리가 틀리므로).
 */

/** 면에서 띄우는 거리(m) */
const LIFT = 0.002;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const fragment = /* glsl */ `
uniform sampler2D map;
uniform float strength;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(map, vUv).rgb * strength, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // 알파 = 밝기 — 경로 추적 화면 위(투명 캔버스)에서 브라우저 합성이 색 + (1 − 알파) × 아래 화면 = 스크린 혼합이 된다
  gl_FragColor.a = clamp(max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)), 0.0, 1.0);
}`;

function patchMesh(p: CausticPatch, strength: number): Mesh {
  const { cols, rows, radiance } = p;
  // 래스터용 — 반정밀 실수 RGBA
  const half = new Uint16Array(cols * rows * 4);
  for (let i = 0; i < cols * rows; i++) {
    half[i * 4] = DataUtils.toHalfFloat(Math.min(radiance[i * 3], 65000));
    half[i * 4 + 1] = DataUtils.toHalfFloat(Math.min(radiance[i * 3 + 1], 65000));
    half[i * 4 + 2] = DataUtils.toHalfFloat(Math.min(radiance[i * 3 + 2], 65000));
    half[i * 4 + 3] = DataUtils.toHalfFloat(1);
  }
  const tex = new DataTexture(half, cols, rows, RGBAFormat, HalfFloatType);
  tex.magFilter = tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const mat = new ShaderMaterial({
    uniforms: { map: { value: tex }, strength: { value: strength } },
    vertexShader: vertex,
    fragmentShader: fragment,
    // 색·알파 모두 더한다 — 래스터 화면에선 보통 더하기(바탕 알파가 이미 1),
    // 경로 추적 화면 위(투명 r3f 캔버스)에선 알파 = 밝기라 합성이 스크린 혼합이 된다
    // (알파 0 에 색만 더하면 브라우저 합성이 그 색을 버려 보이지 않았다, 실측)
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  mat.toneMapped = true;
  mat.userData.causticPatch = true;

  // 사각형 — uv (0,0) 이 격자 행 0·열 0(−e1·−e2 모서리)
  const hw = p.width / 2, hh = p.height / 2;
  const c = p.center.clone().addScaledVector(p.normal, LIFT);
  const corners = [
    [-hw, -hh, 0, 0],
    [hw, -hh, 1, 0],
    [hw, hh, 1, 1],
    [-hw, hh, 0, 1],
  ];
  const pos = new Float32Array(12);
  const uv = new Float32Array(8);
  corners.forEach(([u, v, s, t], i) => {
    const w = c.clone().addScaledVector(p.e1, u).addScaledVector(p.e2, v);
    pos.set([w.x, w.y, w.z], i * 3);
    uv.set([s, t], i * 2);
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array([...p.normal.toArray(), ...p.normal.toArray(), ...p.normal.toArray(), ...p.normal.toArray()]), 3));
  // e1 × e2 = normal 이므로 0-1-2, 0-2-3 이 면 방향을 본다
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, mat);
  mesh.userData.causticPatch = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 10;
  mesh.raycast = () => {}; // 클릭을 가로채지 않게
  return mesh;
}

/** 덧그리기 전 깊이만 그리는 재질 — 앞에 있는 물체가 커스틱을 가리게 */
const depthOnly = new MeshBasicMaterial({ colorWrite: false });
const _hidden: Object3D[] = [];

/**
 * 경로 추적 화면 위에 커스틱을 덧그린다(MutracerRenderer 덧그리기 단계에서 화면을 지운 직후 부른다).
 * 1) 물체의 깊이만 그린다 — 유리도 넣는다(빼면 유리 몸체 위에 커스틱이 덧칠돼 하얗게 떠 보였다, 실측).
 *    편집 보조물(발광 재질·선)과 거의 투명한 판(클릭용 바닥판 등)만 뺀다
 * 2) 커스틱 조각을 깊이 비교해 더하기 혼합으로 그린다
 * 3) 깊이를 지운다 — 뒤이어 그리는 기즈모·선택 상자는 예전처럼 늘 보이게
 * 커스틱 조각이 없으면 아무것도 하지 않는다(깊이 그리기 비용도 없음).
 */
export function renderCausticsOverlay(gl: WebGLRenderer, scene: Scene, camera: Camera) {
  const group = scene.getObjectByName('caustics');
  if (!group || !group.visible || !group.children.length) return;
  scene.traverseVisible((o) => {
    if (o === group) return;
    const any = o as Object3D & { isLine?: boolean; isPoints?: boolean; isSprite?: boolean; isMesh?: boolean; material?: Material | Material[] };
    if (any.isLine || any.isPoints || any.isSprite) {
      _hidden.push(o);
      return;
    }
    if (!any.isMesh || !any.material) return;
    const m = (Array.isArray(any.material) ? any.material[0] : any.material) as Material & { isMeshBasicMaterial?: boolean; isShaderMaterial?: boolean };
    const nearlyClear = m.transparent && m.opacity < 0.5 && m.userData.glassTranslucent == null;
    if (m.isMeshBasicMaterial || m.isShaderMaterial || nearlyClear) _hidden.push(o);
  });
  group.visible = false;
  for (const o of _hidden) o.visible = false;
  const autoClear = gl.autoClear;
  const override = scene.overrideMaterial;
  const background = scene.background;
  gl.autoClear = false;
  scene.overrideMaterial = depthOnly;
  scene.background = null;
  gl.render(scene, camera);
  scene.overrideMaterial = override;
  scene.background = background;
  for (const o of _hidden) o.visible = true;
  _hidden.length = 0;
  group.visible = true;
  gl.render(group, camera);
  gl.clearDepth();
  gl.autoClear = autoClear;
}

/** 커스틱을 받거나 가리는 메시인지 — causticTrace.collectBodies 와 같은 기준(편집 보조물·하늘·선 제외) */
function isSolid(m: Mesh): boolean {
  if (!m.isMesh || m.userData.causticPatch || !m.layers.isEnabled(0)) return false;
  const first = (Array.isArray(m.material) ? m.material[0] : m.material) as Material & { isMeshBasicMaterial?: boolean; isShaderMaterial?: boolean };
  return !!first && !first.isMeshBasicMaterial && !first.isShaderMaterial;
}

/**
 * 다시 계산할지 가르는 지문 — 조명, 유리(위치·투과 재질 값), 유리 둘레(REACH 안) 메시의 위치.
 * 장면 전체 메시를 보면 카메라를 따라 움직이는 것(하늘 등) 때문에 매 순간 바뀌어 계산만 되풀이했다.
 */
const REACH = 2.5;
const _sphere = new Sphere();
function signature(scene: Object3D): string {
  const parts: string[] = [];
  const glass: Sphere[] = [];
  const solids: Mesh[] = [];
  scene.traverseVisible((o) => {
    if (o.userData.causticPatch) return;
    const l = o as Object3D & { isLight?: boolean; intensity?: number; angle?: number; penumbra?: number; color?: { getHex(): number } };
    if (l.isLight) {
      const e = o.matrixWorld.elements;
      parts.push(`L${o.id}:${l.intensity?.toFixed(3)}:${l.color?.getHex()}:${l.angle}:${l.penumbra}:${e[12].toFixed(3)},${e[13].toFixed(3)},${e[14].toFixed(3)}`);
      const t = (o as unknown as { target?: Object3D }).target;
      if (t) parts.push(t.matrixWorld.elements.slice(12, 15).map((v) => v.toFixed(3)).join(','));
      return;
    }
    const m = o as Mesh;
    if (!isSolid(m)) return;
    const mat = m.material as { transmission?: number; ior?: number; thickness?: number; color?: { getHex(): number }; userData?: Record<string, unknown> };
    if (!Array.isArray(m.material) && mat.transmission && mat.transmission > 0 && !mat.userData?.noCaustics) {
      parts.push(`G${m.id}:${mat.transmission}:${mat.ior}:${mat.thickness}:${mat.color?.getHex()}:${m.matrixWorld.elements.map((v) => v.toFixed(4)).join(',')}`);
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      glass.push(m.geometry.boundingSphere!.clone().applyMatrix4(m.matrixWorld));
    } else solids.push(m);
  });
  if (!glass.length) return parts.join('|');
  for (const m of solids) {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    _sphere.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
    if (!glass.some((g) => g.center.distanceTo(_sphere.center) < g.radius + _sphere.radius + REACH)) continue;
    const e = m.matrixWorld.elements;
    parts.push(`M${m.id}:${[0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14].map((i) => e[i].toFixed(4)).join(',')}`);
  }
  return parts.join('|');
}

/** 화면 시험·확인용 */
const debug = { runs: 0, running: false, last: null as CausticJob['stats'] | null, patches: 0, info: [] as { peak: number; size: string; at: string }[] };
(window as unknown as { __caustics?: unknown }).__caustics = debug;

export function Caustics() {
  const scene = useThree((s) => s.scene);
  const enabled = useMutracerStore((s) => s.mt.causticShadows);
  const photons = useMutracerStore((s) => s.mt.causticPhotons);
  const blur = useMutracerStore((s) => s.mt.causticBlur);
  const strength = useMutracerStore((s) => s.mt.causticStrength);

  useEffect(() => {
    if (!enabled) return;
    (debug as { sig?: () => string }).sig = () => signature(scene);
    const group = new Group();
    group.name = 'caustics';
    group.userData.causticPatch = true;
    scene.add(group);
    let lastSig = '';
    let changedAt = 0;
    let job: CausticJob | null = null;
    // 계산 중 장면이 바뀌면 취소하고 다시 — 단 연달아 2번 취소됐으면 이번 것은 끝까지 하고 보여 준 뒤 다시 한다
    // (불러오는 중처럼 계속 바뀔 때 끝없이 다시 시작만 하지 않게)
    let cancels = 0;
    const clear = () => {
      for (const c of [...group.children]) {
        const m = c as Mesh<BufferGeometry, ShaderMaterial>;
        m.geometry.dispose();
        (m.material.uniforms.map.value as DataTexture).dispose();
        m.material.dispose();
        group.remove(m);
      }
    };
    const tick = () => {
      const sig = signature(scene);
      if (sig !== lastSig) {
        lastSig = sig;
        changedAt = performance.now();
        group.visible = false;
        if (job && cancels < 2) {
          job.cancel();
          job = null;
          cancels++;
        }
      }
      if (!changedAt || job || performance.now() - changedAt < 400 || isGizmoDragging()) return;
      changedAt = 0;
      const s = useMutracerStore.getState().mt;
      const mine = (job = startCausticJob(scene, { photons: s.causticPhotons, blur: s.causticBlur, reach: REACH }));
      debug.running = true;
      debug.runs++;
      void mine.done.then((patches) => {
        if (job !== mine) return; // 그새 장면이 바뀌어 취소됨
        job = null;
        cancels = 0;
        debug.running = false;
        debug.last = { ...mine.stats };
        if (!patches) return;
        clear();
        const k = useMutracerStore.getState().mt.causticStrength;
        for (const p of patches) group.add(patchMesh(p, k));
        debug.patches = patches.length;
        debug.info = patches.map((p) => ({ peak: +p.peak.toFixed(3), size: `${p.width.toFixed(2)}×${p.height.toFixed(2)}m ${p.cols}×${p.rows}`, at: p.center.toArray().map((v) => v.toFixed(2)).join(',') }));
        group.visible = true;
      });
    };
    const id = window.setInterval(tick, 250);
    tick();
    return () => {
      window.clearInterval(id);
      job?.cancel();
      clear();
      scene.remove(group);
      debug.running = false;
    };
  }, [scene, enabled, photons, blur]);

  // 세기만 바뀌면 다시 계산하지 않고 곱만 바꾼다
  useEffect(() => {
    scene.getObjectByName('caustics')?.traverse((o) => {
      const m = (o as Mesh).material as ShaderMaterial | undefined;
      if (m?.uniforms?.strength) m.uniforms.strength.value = strength;
    });
  }, [scene, strength]);
  return null;
}
