import { create } from 'zustand';
import type { BufferGeometry } from 'three';
import { Vector3 } from 'three';

/**
 * 3D 에디트 모드 — 벽/천장/바닥 면을 선택하고 그 면 위에 사각형을 그려 **뚫거나 돌출**시킨다.
 *
 * 흐름:
 *  1. Toolbar "에디트 모드" 토글 ON
 *  2. operation 선택 (뚫기/돌출)
 *  3. 캔버스에서 hover로 면(wall/floor/ceiling) 강조 → 클릭으로 시작 코너 확정
 *  4. 마우스 이동으로 사각형 프리뷰 (그 면의 평면 좌표계에서 직사각형)
 *  5. 두 번째 클릭으로 확정 → CSG 라이브러리로 SUBTRACT/UNION 적용
 *
 * CSG 결과는 별도 *editOverlayMeshes* 컬렉션에 저장되어 매 렌더 시 wall/floor/ceiling 위에 그려진다.
 * (원본 geometry는 보존 — 사용자가 모드 OFF 시 원상복구 가능)
 */
export type EditOperation = 'cut' | 'extrude';

/** 선택된 면의 메타데이터. mesh 자체 ref + hit point + 법선 + 평면 정렬용 basis. */
export interface EditFaceTarget {
  /** 'wall' / 'floor' / 'ceiling' */
  kind: 'wall' | 'floor' | 'ceiling';
  /** 도메인 객체 식별자 — wall: wallIndex, floor/ceiling: spaceIndex. */
  ownerId: number;
  /** 면의 정렬 origin (사각형 그리기 기준점 — hit point 가까운 곳). */
  origin: Vector3;
  /** 면 외향 법선. */
  normal: Vector3;
  /** 면 평면 위 U 축 (사각형의 가로 방향). */
  u: Vector3;
  /** 면 평면 위 V 축 (사각형의 세로 방향). normal × u. */
  v: Vector3;
}

/** 면 평면 좌표계에서 그려진 직사각형. (u 축 min/max, v 축 min/max). */
export interface EditRect {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

/**
 * 적용된 cut/extrude 1건 — 대상 면(wall/floor/ceiling) 식별자 + world 좌표 box geometry.
 * WallView/FloorView/CeilingView가 본 store를 구독해 자기 mesh에 적용된 ops로 CSG 평가.
 */
export interface EditOperationRecord {
  id: number;
  kind: 'cut' | 'extrude';
  targetKind: 'wall' | 'floor' | 'ceiling';
  ownerId: number;
  /** world 좌표 BoxGeometry. CSG 평가 시 Brush로 wrap해 사용. */
  boxGeometry: BufferGeometry;
}

export interface EditState {
  enabled: boolean;
  operation: EditOperation;
  /** 현재 선택된 면. 처음 클릭 후 두번째 클릭 전까지 유지. */
  target: EditFaceTarget | null;
  /** 그리기 중 사각형 (target이 있을 때만 의미). */
  rect: EditRect | null;
  /** 뚫기/돌출 두께(m). 사용자가 슬라이더로 조정. */
  thickness: number;
  /** 누적 적용된 cut/extrude 기록 — 대상 mesh가 CSG로 적용. */
  operations: EditOperationRecord[];

  enable: (op?: EditOperation) => void;
  disable: () => void;
  setOperation: (op: EditOperation) => void;
  setTarget: (t: EditFaceTarget | null) => void;
  setRect: (r: EditRect | null) => void;
  setThickness: (v: number) => void;
  addOperation: (op: Omit<EditOperationRecord, 'id'>) => number;
  removeOperation: (id: number) => void;
  clearOperations: () => void;
}

let _opSeq = 0;

export const useEditStore = create<EditState>((set) => ({
  enabled: false,
  operation: 'cut',
  target: null,
  rect: null,
  thickness: 0.3,
  operations: [],

  enable: (op = 'cut') => set({ enabled: true, operation: op, target: null, rect: null }),
  disable: () => set({ enabled: false, target: null, rect: null }),
  setOperation: (op) => set({ operation: op }),
  setTarget: (t) => set({ target: t, rect: null }),
  setRect: (r) => set({ rect: r }),
  setThickness: (v) => set({ thickness: v }),
  addOperation: (op) => {
    const id = ++_opSeq;
    set((s) => ({ operations: [...s.operations, { id, ...op }] }));
    return id;
  },
  removeOperation: (id) =>
    set((s) => ({ operations: s.operations.filter((o) => o.id !== id) })),
  clearOperations: () => set({ operations: [] }),
}));

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTimeout(() => { (window as any).__editStore = useEditStore; }, 0);
}