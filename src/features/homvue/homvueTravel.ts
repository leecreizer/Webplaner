import { Vector3 } from 'three';
import type { PlanData, Vec3 } from './homvueAssets';
import { ueTransformToMatrix } from './ueTransform';

/**
 * 투어 지점 — 방 모듈 레벨마다 주 지점(BP_TravelPoint) 1개 + 보조 지점(BP_SubTravelTargetPoint) 5~8개.
 * 방 스타일(모듈)을 바꾸면 그 모듈 레벨의 지점으로 바뀐다(언리얼 UpdateTravelPointsOnRoomChanged).
 */
export interface TravelSpot {
  room: string | null;
  /** 주 지점 = 방으로 이동할 때 가는 곳 · 미니맵 공간 버튼 자리 */
  main: boolean;
  /** 보조 지점 중 「방을 볼 때 향하는 곳」(언리얼 IsCapturePoint) — 추출 전이면 undefined */
  capture?: boolean;
  /** 처음 시작 지점(IsPlayerStartPoint) */
  start?: boolean;
  /** 평면 좌표(언리얼에서 옮긴 값, m) — 아파트 그룹 안의 좌표 */
  local: Vector3;
}

/** 언리얼 플레이어: 액터 높이 90cm + 스프링암 50cm = 눈높이 140cm (HVPlayer BeginPlay · 생성자) */
export const EYE_HEIGHT_CM = 140;
/** 방을 볼 때 고개를 숙이는 각도 (FocusRoom: Dir.Rotation() + FRotator(-10, 0, 0)) */
export const FOCUS_PITCH_DEG = -10;
export const MAIN_POINT = 'BP_TravelPoint';

export function travelSpots(plan: PlanData, modules: Record<string, number>): TravelSpot[] {
  const at = (loc: Vec3) => new Vector3().setFromMatrixPosition(ueTransformToMatrix(loc, [0, 0, 0]));
  const spots: TravelSpot[] = plan.base.travel.map((t) => ({
    room: null, main: t.kind === MAIN_POINT, capture: t.capture, start: t.start, local: at(t.location_cm),
  }));
  for (const room of plan.rooms) {
    const m = room.modules.find((x) => x.no === modules[room.type]);
    m?.travel.forEach((t) =>
      spots.push({ room: room.type, main: t.kind === MAIN_POINT, capture: t.capture, start: t.start, local: at(t.location_cm) }),
    );
  }
  return spots;
}

/** 방으로 이동할 지점 — 언리얼 TravelToRoom: 그 방의 주 지점. 주 지점이 없으면 보조 지점 무게중심에 가장 가까운 곳 */
export function roomSpot(spots: TravelSpot[], room: string): TravelSpot | null {
  const list = spots.filter((s) => s.room === room);
  const main = list.find((s) => s.main);
  if (main) return main;
  if (!list.length) return null;
  const c = centroid(list);
  return list.reduce((best, s) => (s.local.distanceTo(c) < best.local.distanceTo(c) ? s : best));
}

/** 방을 볼 때 향하는 곳 — 언리얼 FocusRoom: 그 방의 IsCapturePoint 보조 지점.
 *  속성을 아직 추출하지 않은 평면은 보조 지점 무게중심(방 안쪽)을 향한다. */
export function roomFocus(spots: TravelSpot[], room: string): Vector3 | null {
  const subs = spots.filter((s) => s.room === room && !s.main);
  const capture = subs.find((s) => s.capture);
  if (capture) return capture.local.clone();
  return subs.length ? centroid(subs) : null;
}

/** 처음 시작 지점 — 언리얼 TravelToStartPoint: IsPlayerStartPoint, 없으면 거실 주 지점, 없으면 첫 주 지점 */
export function startRoom(spots: TravelSpot[]): string | null {
  const mains = spots.filter((s) => s.main);
  return (mains.find((s) => s.start) ?? mains.find((s) => s.room === 'Living01') ?? mains[0])?.room ?? null;
}

const centroid = (list: TravelSpot[]) => list.reduce((acc, s) => acc.add(s.local), new Vector3()).divideScalar(list.length);

/** 평면 좌표 → 장면 좌표 */
export const toScene = (local: Vector3, offset: Vec3): Vec3 => [local.x + offset[0], local.y + offset[1], local.z + offset[2]];
