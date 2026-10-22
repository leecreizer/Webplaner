import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { DoubleSide, Raycaster, Vector3, type Mesh, type Object3D } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useHomvueStore } from './homvueStore';
import { useCameraMotionStore } from '@/engine/camera/CameraMotion';
import { isGizmoBusy } from '@/features/models/gizmoGuard';
import { sameDotSpace, type PlanData } from './homvueAssets';
import { toScene, travelSpots, type TravelSpot } from './homvueTravel';

/**
 * 투어 지점 표시 — 언리얼 WB_TravelTargetPoint · WB_Dot · WB_RoomDotButton 대응. 아파트 그룹 안(평면 좌표)에 둔다.
 *
 * - 공간별 표시: 지금 방(카메라 아래 바닥의 방, 거실·주방은 한 공간)의 투어 지점만 보이고, 다른 방은 주 지점 하나만
 *   「방 이동」 점(큰 고리)으로 보인다. 지금 방을 모르면(위에서 내려다볼 때) 방마다 주 지점만.
 * - 바닥에 붙이기: 언리얼 투어 지점은 바닥 위 5cm(Z=5)에 놓여 있어 그대로 쓰면 떠 보인다 — 바로 아래 실제 바닥면 위 5mm.
 * - 누르면 그 지점 눈높이로 이동(투어 모드 켜짐). 방 이동 점이면 그 방을 보며 도착(방 이동 버튼과 같음).
 * - 가구·벽에 가려지면 가려진 대로 그린다(사용자 요청 2026-10-22 — 예전엔 언리얼 WB_Dot 처럼 늘 위에 그려 소파·테이블
 *   위로 떠 보였다). 경로 추적 화면에선 덧그리기 전에 장면 깊이를 먼저 그려 맞춘다(userData.overlayDepth).
 *   클릭도 보이는 점만 — 앞에 다른 물체가 먼저 맞으면 점은 양보한다(HomvueApartment yieldsToDot · dotHidden).
 */
export function HomvueTravelPoints({ plan }: { plan: PlanData }) {
  const modules = useHomvueStore((s) => s.modules);
  const currentRoom = useHomvueStore((s) => s.currentRoom);
  const walk = useHomvueStore((s) => s.walk);
  // 카메라를 움직이거나 돌리는 동안엔 숨긴다(사용자 요청 2026-10-22) — 멈추면 다시 보인다
  const moving = useCameraMotionStore((s) => s.moving);
  const spots = useMemo(() => travelSpots(plan, modules), [plan, modules]);
  const floorY = useFloorHeights(plan.id, spots);

  const here = (s: TravelSpot) => walk && !!currentRoom && sameDotSpace(s.room, currentRoom);
  const shown = spots.map((s, i) => ({ s, i })).filter(({ s }) => here(s) || s.main);

  return (
    <group name="homvue:travel" userData={{ overlayDepth: true }} visible={!moving}>
      {shown.map(({ s, i }) => (
        <TravelDot key={i} spot={s} y={floorY[i] ?? s.local.y} roomJump={!here(s)} />
      ))}
    </group>
  );
}

/** 투어 지점마다 바로 아래 바닥면 높이(평면 좌표). 바닥 GLB 가 늦게 들어오므로 다 찾을 때까지 몇 번 다시 본다 */
function useFloorHeights(planId: string, spots: TravelSpot[]): (number | undefined)[] {
  const scene = useThree((s) => s.scene);
  const [ys, setYs] = useState<(number | undefined)[]>([]);
  useEffect(() => {
    let tries = 0;
    let timer = 0;
    const run = () => {
      const root = scene.getObjectByName(`homvue:${planId}`);
      const floors: Object3D[] = [];
      root?.traverse((o) => {
        if (o.userData?.homvueFloorRoom || o.userData?.homvue?.blueprint?.startsWith('/LevelStatic/')) floors.push(o);
      });
      // 러그처럼 바닥에 깔린 얇은 물체 — 점이 그 아래 묻혀 가려지지 않게 윗면에 올린다(바닥 위 RUG_MAX 까지만, 가구 윗면 제외)
      const RUG_MAX = 0.05;
      const others: Object3D[] = [];
      root?.traverse((o) => {
        if ((o as Mesh).isMesh && o.visible && !o.userData?.homvueCeiling && !floors.includes(o) && !o.parent?.userData?.homvueDot && !o.userData?.homvueDot) others.push(o);
      });
      if (!root || !floors.length) {
        if (tries++ < 20) timer = window.setTimeout(run, 1500);
        return;
      }
      root.updateMatrixWorld(true);
      const ray = new Raycaster();
      const down = new Vector3(0, -1, 0);
      const next = spots.map((s) => {
        const from = s.local.clone().applyMatrix4(root.matrixWorld).add(new Vector3(0, 0.5, 0));
        ray.set(from, down);
        ray.far = 1.2;
        const hit = ray.intersectObjects(floors, true).find((h) => !h.object.userData.homvueCeiling);
        if (!hit) return undefined;
        const rug = ray.intersectObjects(others, false).find((h) => h.point.y >= hit.point.y - 0.001 && h.point.y <= hit.point.y + RUG_MAX);
        return root.worldToLocal((rug ?? hit).point.clone()).y;
      });
      setYs(next);
      if (next.some((y) => y === undefined) && tries++ < 20) timer = window.setTimeout(run, 1500);
    };
    run();
    return () => window.clearTimeout(timer);
  }, [scene, planId, spots]);
  return ys;
}

function TravelDot({ spot, y, roomJump }: { spot: TravelSpot; y: number; roomJump: boolean }) {
  const [hover, setHover] = useState(false);
  const gl = useThree((s) => s.gl);
  const { x, z } = spot.local;
  const inner = roomJump ? 0.2 : 0.12;
  const outer = roomJump ? (hover ? 0.3 : 0.27) : hover ? 0.2 : 0.17;
  return (
    <group
      renderOrder={20}
      position={[x, y + 0.005, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      userData={{ homvueDot: true, roomJump, room: spot.room }}
      onPointerOver={(e) => {
        if (dotHidden(e)) return;
        e.stopPropagation();
        setHover(true);
        gl.domElement.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHover(false);
        gl.domElement.style.cursor = '';
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (isGizmoBusy()) return; // 기즈모 손잡이를 잡는 클릭 — 투어 이동하지 않는다
        if (dotHidden(e)) return; // 가구 뒤에 가려진 점 — 앞 물체의 클릭
        e.stopPropagation();
        if (e.delta > 4) return; // 둘러보느라 끈 것
        const st = useHomvueStore.getState();
        if (roomJump && spot.room) st.goToRoom(spot.room);
        else st.travelTo(toScene(new Vector3(x, y, z), st.offset), spot.room);
      }}
    >
      {/* 고리 안쪽(빈 가운데)을 눌러도 잡히도록 보이지 않는 원판을 클릭 영역으로 */}
      <mesh>
        <circleGeometry args={[outer + 0.06, 24]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} side={DoubleSide} />
      </mesh>
      <mesh renderOrder={20}>
        <ringGeometry args={[inner, outer, 40]} />
        {/* 편집 보조물과 같은 MeshBasicMaterial — MuTracer 렌더에서 빠지고 위에 겹쳐 그려진다 */}
        <meshBasicMaterial
          color={hover ? '#38bdf8' : roomJump ? '#7dd3fc' : '#ffffff'}
          transparent
          opacity={hover ? 0.95 : 0.8}
          side={DoubleSide}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
    </group>
  );
}

/** 점 앞에 다른 물체가 먼저 맞았는지(가구 뒤에 가려진 점) — 점 자신·다른 점은 건너뛴다 */
export function dotHidden(e: ThreeEvent<MouseEvent | PointerEvent>): boolean {
  let dot = Infinity;
  let other = Infinity;
  for (const i of e.intersections) {
    let isDot = false;
    for (let o: Object3D | null = i.object; o; o = o.parent) if (o.userData?.homvueDot) isDot = true;
    if (isDot) dot = Math.min(dot, i.distance);
    else other = Math.min(other, i.distance);
  }
  return other < dot - 0.01;
}
