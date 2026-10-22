import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  Box3,
  Color,
  MeshBasicMaterial,
  OrthographicCamera,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { useHomvueStore } from './homvueStore';
import { isCeiling } from './homvueAssets';
import { roomSpot, toScene, travelSpots } from './homvueTravel';

/**
 * 미니맵 — 언리얼 WB_MinimapWidget · WB_MinimapSpaceButton 대응.
 *
 * - 위에서 내려다본 직교 캡처(언리얼 SceneCaptureComponent2D, Orthographic), 천장·표시용 지점은 빼고
 * - 화면 오른쪽 위, 높이 300px · 가로는 집 비율 (UHVMinimapWidget::UpdateMinimap)
 * - 방마다 공간 버튼(방 주 투어 지점 자리) — 누르면 그 방으로 이동, 지금 방은 강조
 *
 * 언리얼 위젯에는 플레이어 위치 표시가 없어 넣지 않았다.
 */
const HEIGHT = 300;
const CAPTURE_SCALE = 2; // 고해상도 화면에서도 선명하게

/** 캔버스 안 — 평면·모듈·교체가 바뀌면 캡처를 다시 뜬다. */
export function HomvueMinimapCapture() {
  const plan = useHomvueStore((s) => s.plan);
  const modules = useHomvueStore((s) => s.modules);
  const overrides = useHomvueStore((s) => s.overrides);
  const loadState = useHomvueStore((s) => s.loadState);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    if (!plan || loadState !== 'ready') return;
    let alive = true;
    let timer = 0;
    // 부품은 셰이더를 미리 컴파일한 뒤에 보인다(HomvueApartment CompiledPrimitive) — 다 보일 때 찍는다(최대 60초).
    // 상품 GLB 가 늦게 들어오는 경우가 있어 한 번 더 찍는다.
    const pending = () => {
      let n = 0;
      scene.getObjectByName(`homvue:${plan.id}`)?.traverse((o) => {
        if (o.userData.homvueCompiling) n++;
      });
      return n;
    };
    const run = async (tries: number, again: boolean) => {
      if (!alive) return;
      if (pending() > 0 && tries < 60) {
        timer = window.setTimeout(() => void run(tries + 1, again), 1000);
        return;
      }
      const m = await capture(gl, scene, `homvue:${plan.id}`);
      if (m && alive) useHomvueStore.getState().setMinimap(m);
      if (again) timer = window.setTimeout(() => void run(0, false), 5000);
    };
    timer = window.setTimeout(() => void run(0, true), 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [plan, modules, overrides, loadState, gl, scene]);
  return null;
}

/** 미니맵용 조명 없는 재질 — 원래 재질마다 하나 만들어 재사용 */
const flat = new WeakMap<Material, MeshBasicMaterial>();
function flatOf(src: Material): Material {
  if ((src as MeshBasicMaterial).isMeshBasicMaterial) return src;
  let f = flat.get(src);
  if (!f) {
    const s = src as MeshStandardMaterial;
    f = new MeshBasicMaterial({
      color: s.color ?? new Color(1, 1, 1),
      map: s.map ?? null,
      transparent: src.transparent,
      opacity: src.opacity,
      side: src.side,
      alphaTest: src.alphaTest,
    });
    flat.set(src, f);
  }
  return f;
}

async function capture(gl: import('three').WebGLRenderer, scene: import('three').Scene, rootName: string) {
  const root = scene.getObjectByName(rootName);
  if (!root) return null;
  const box = new Box3();
  root.traverse((o) => {
    const bp = (o.userData?.homvue as { blueprint?: string } | undefined)?.blueprint;
    if (bp?.includes('/APT/') && !/cell?ing/i.test(bp)) box.expandByObject(o);
  });
  if (box.isEmpty()) return null;

  // 집만 찍히게 — 다른 최상위 물체(홈플래너3 바닥판·격자 등)·천장·투어 지점은 잠시 숨긴다. 조명은 둔다.
  const restore: [Object3D, boolean][] = [];
  const hide = (o: Object3D) => {
    restore.push([o, o.visible]);
    o.visible = false;
  };
  for (const c of scene.children) if (c !== root && !(c as { isLight?: boolean }).isLight) hide(c);
  root.traverse((o) => {
    if (o.name === 'homvue:travel') hide(o);
    const bp = (o.userData?.homvue as { blueprint?: string } | undefined)?.blueprint;
    if (bp && isCeiling({ blueprint: bp } as never)) hide(o);
    if (o.userData?.homvueCeiling) hide(o); // 레벨 메시 중 천장 높이 (HomvueApartment LevelStatic)
  });

  const size = box.getSize(new Vector3());
  const c = box.getCenter(new Vector3());
  const h = HEIGHT * CAPTURE_SCALE;
  const w = Math.round((h * size.x) / size.z);
  // 화면 오른쪽 = +x, 아래 = +z
  const cam = new OrthographicCamera(-size.x / 2, size.x / 2, size.z / 2, -size.z / 2, 0.1, 100);
  cam.position.set(c.x, box.max.y + 10, c.z);
  cam.up.set(0, 0, -1);
  cam.lookAt(c.x, box.min.y, c.z);
  cam.updateMatrixWorld();

  // 위에서 본 그림은 조명 없이 재질 색·텍스처만으로 찍는다. 원래 재질로 찍으면 새로 들어온 가구 재질마다
  // 조명 수십 개를 담은 셰이더를 그 자리에서 컴파일해 공간 변경 한 번에 42초 멈췄다(실측, 셰이더 45개).
  // 조명 없는 재질 셰이더는 텍스처 유무 정도로 몇 개뿐이라 바로 끝난다.
  const swapped: [Mesh, Material | Material[]][] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    swapped.push([mesh, mesh.material]);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(flatOf) : flatOf(mesh.material);
  });

  const rt = new WebGLRenderTarget(w, h);
  rt.texture.colorSpace = SRGBColorSpace;
  const prevTarget = gl.getRenderTarget();
  const prevClear = gl.getClearColor(new Color());
  const prevAlpha = gl.getClearAlpha();
  const prevBg = scene.background;
  scene.background = null;
  gl.setRenderTarget(rt);
  gl.setClearColor(0xf1f5f9, 1);
  gl.clear();
  gl.render(scene, cam);
  gl.setRenderTarget(prevTarget);
  gl.setClearColor(prevClear, prevAlpha);
  scene.background = prevBg;
  for (const [m, mat] of swapped) m.material = mat;
  for (const [o, v] of restore) o.visible = v;
  // 읽기는 비동기 — 동기 읽기는 GPU 가 쌓인 일(경로 추적 포함)을 다 끝낼 때까지 화면을 멈춰 공간 변경 때 2.5초 걸렸다
  const px = new Uint8Array(w * h * 4);
  try {
    await gl.readRenderTargetPixelsAsync(rt, 0, 0, w, h, px);
  } finally {
    rt.dispose();
  }

  // 렌더 타깃은 아래에서 위로 — 뒤집어서 캔버스에
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), bounds: [box.min.x, box.min.z, box.max.x, box.max.z] as [number, number, number, number] };
}

/** 캔버스 밖 — 오른쪽 위 미니맵과 공간 버튼 */
export function HomvueMinimap() {
  const plan = useHomvueStore((s) => s.plan);
  const modules = useHomvueStore((s) => s.modules);
  const minimap = useHomvueStore((s) => s.minimap);
  const offset = useHomvueStore((s) => s.offset);
  const currentRoom = useHomvueStore((s) => s.currentRoom);

  const buttons = useMemo(() => {
    if (!plan || !minimap) return [];
    const spots = travelSpots(plan, modules);
    const [x0, z0, x1, z1] = minimap.bounds;
    const spotsToButtons = plan.rooms.flatMap((room) => {
      const spot = roomSpot(spots, room.type);
      if (!spot) return [];
      const [x, , z] = toScene(spot.local, offset);
      return [{ room: room.type, label: room.label, u: (x - x0) / (x1 - x0), v: (z - z0) / (z1 - z0) }];
    });
    // 트인 공간(거실·주방)은 주 지점이 가까워 버튼이 겹친다 — 겹치면 아래쪽 버튼을 버튼 높이만큼 내린다
    const w = (HEIGHT * (x1 - x0)) / (z1 - z0);
    const list = spotsToButtons.sort((a, b) => a.v - b.v);
    for (let i = 1; i < list.length; i++) {
      for (let j = 0; j < i; j++) {
        const dx = Math.abs(list[i].u - list[j].u) * w;
        const dy = (list[i].v - list[j].v) * HEIGHT;
        if (dx < 56 && Math.abs(dy) < 22) list[i].v = list[j].v + 24 / HEIGHT;
      }
    }
    return list;
  }, [plan, modules, minimap, offset]);

  if (!plan || !minimap) return null;
  const [x0, z0, x1, z1] = minimap.bounds;
  const width = (HEIGHT * (x1 - x0)) / (z1 - z0);

  return (
    <div style={{ ...boxStyle, width, height: HEIGHT }} data-testid="homvue-minimap">
      <img src={minimap.url} width={width} height={HEIGHT} style={{ display: 'block' }} alt="미니맵" draggable={false} />
      {buttons.map((b) => (
        <button
          key={b.room}
          onClick={() => useHomvueStore.getState().goToRoom(b.room)}
          style={{ ...spaceBtnStyle, ...(b.room === currentRoom ? spaceBtnActiveStyle : null), left: b.u * width, top: b.v * HEIGHT }}
          title={`${b.label}(으)로 이동`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  position: 'absolute', right: 16, top: 120, zIndex: 20, borderRadius: 6, overflow: 'hidden',
  boxShadow: '0 4px 16px rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.25)', background: '#f1f5f9',
};
const spaceBtnStyle: React.CSSProperties = {
  position: 'absolute', transform: 'translate(-50%, -50%)', padding: '3px 8px', borderRadius: 12,
  border: '1px solid rgba(15,23,42,0.4)', background: 'rgba(255,255,255,0.9)', color: '#0f172a',
  fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};
const spaceBtnActiveStyle: React.CSSProperties = { background: '#0284c7', color: '#fff', border: '1px solid #0369a1' };
