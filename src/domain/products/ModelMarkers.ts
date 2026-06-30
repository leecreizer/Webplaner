import { Object3D, Vector3 } from 'three';

/**
 * 모델(GLB)에 보존된 더미 마커 정보 읽기 — 몸통 DP 타입, 도어 부착 hotspot.
 *
 * FBX→GLB 변환기(admin)가 더미(DP/HD/X, hotspot/DL1...)를 이름 보존 노드로 살려두므로,
 * 웹은 이름으로 이 정보를 읽어 도어 매칭/배치에 사용한다. GLTFLoader가 붙이는 `_N` 접미사는
 * 무시한다.
 */

/** GLTFLoader `_N` 접미사 제거. 예: "HD_1" → "HD". */
export function baseName(name: string): string {
  return name.trim().replace(/_\d+$/, '');
}

/** 베이스 이름이 일치하는 첫 노드. */
function findByBaseName(root: Object3D, base: string): Object3D | null {
  let found: Object3D | null = null;
  const target = base.toUpperCase();
  root.traverse((o) => {
    if (!found && o.name && baseName(o.name).toUpperCase() === target) found = o;
  });
  return found;
}

/** 베이스 이름이 일치하는 모든 노드. */
function findAllByBaseName(root: Object3D, base: string): Object3D[] {
  const out: Object3D[] = [];
  const target = base.toUpperCase();
  root.traverse((o) => {
    if (o.name && baseName(o.name).toUpperCase() === target) out.push(o);
  });
  return out;
}

/**
 * 몸통 DP 타입 목록 — `DP` 노드의 자식 이름들. 예: ["X", "HD"].
 * 모델에 DP 노드가 없으면 빈 배열.
 */
export function readDpTypes(root: Object3D): string[] {
  const dp = findByBaseName(root, 'DP');
  if (!dp) return [];
  const out: string[] = [];
  for (const c of dp.children) {
    const n = baseName(c.name);
    if (n && n.toUpperCase() !== 'DP') out.push(n);
  }
  return out;
}

export interface Hotspot {
  /** 부착 키 (DL1/DR1/LY1/RY1/XL1/XR1 ...). */
  name: string;
  /** 월드 좌표 (m, y-up). */
  position: [number, number, number];
}

/** 도어 슬롯 — 몸통 hotspot 마커에서 계산한 도어 1장 정보. 치수는 mm. */
export interface DoorSlot {
  /** 부착 면 — 'L' | 'R'. */
  pos: 'L' | 'R';
  /** 도어 폭(mm) = |D{side} − X{side}| (x). */
  w: number;
  /** 도어 높이(mm) = |D{side} − {side}Y| (y). */
  h: number;
  /** 도어 중심 — 몸통 모델 로컬(월드) 좌표 mm (x,y,z). */
  center: [number, number, number];
}

/**
 * 몸통 hotspot 마커로 도어 슬롯 계산.
 *
 * 규약(3ds Max 더미):
 * - `DL{n}`/`DR{n}` = 도어 하단 바깥 앵커. **개수** = 이 앵커 수(예: DL1+DR1 → 2도어).
 * - `XL{n}`/`XR{n}` = 안쪽 X끝 → 폭 = |D − X|.
 * - `LY{n}`/`RY{n}` = 상단 Y끝 → 높이 = |D − Y|.
 *
 * 모델은 mm→m 정규화되어 마커 월드좌표가 m이므로 ×1000으로 mm 환산해 반환한다.
 */
export function readDoorSlots(root: Object3D): DoorSlot[] {
  root.updateWorldMatrix(true, true);
  const M = 1000; // m → mm
  const w = new Vector3();

  // hotspot이 여러 개일 수 있다(몸통 도어 hotspot + replaceableW 안의 서랍 애니메이션 hotspot).
  // DL/DR·M은 애니메이션용으로도 쓰이므로, **짝 마커(X{side}, {side}Y)가 모두 있는** 도어 앵커만
  // 슬롯으로 인정한다 → 애니메이션 전용 hotspot(M1 등, 짝 없음)은 자연히 제외된다.
  const computeFor = (hotspot: Object3D): DoorSlot[] => {
    const byName = new Map<string, [number, number, number]>();
    for (const c of hotspot.children) {
      c.getWorldPosition(w);
      byName.set(baseName(c.name).toUpperCase(), [w.x, w.y, w.z]);
    }
    const slots: DoorSlot[] = [];
    for (const [name, d] of byName) {
      const m = /^D([LR])(\d*)$/.exec(name);
      if (!m) continue;
      const side = m[1] as 'L' | 'R';
      const n = m[2];
      const x = byName.get(`X${side}${n}`);
      const y = byName.get(`${side}Y${n}`);
      if (!x || !y) continue; // 짝 마커 없으면(=애니메이션용) 스킵
      slots.push({
        pos: side,
        w: Math.round(Math.abs(d[0] - x[0]) * M),
        h: Math.round(Math.abs(d[1] - y[1]) * M),
        center: [((d[0] + x[0]) / 2) * M, ((d[1] + y[1]) / 2) * M, d[2] * M],
      });
    }
    return slots;
  };

  // 유효 슬롯이 나오는 hotspot 중 슬롯 수가 가장 많은 것을 몸통 도어 hotspot으로 채택.
  let best: DoorSlot[] = [];
  for (const hs of findAllByBaseName(root, 'hotspot')) {
    const s = computeFor(hs);
    if (s.length > best.length) best = s;
  }
  // L → R 순 정렬(좌측 먼저).
  best.sort((a, b) => (a.pos === b.pos ? 0 : a.pos === 'L' ? -1 : 1));
  return best;
}

/**
 * 도어 부착 hotspot 목록 — `hotspot` 노드의 자식 이름+월드위치.
 * 모델에 hotspot 노드가 없으면 빈 배열.
 */
export function readHotspots(root: Object3D): Hotspot[] {
  const hs = findByBaseName(root, 'hotspot');
  if (!hs) return [];
  root.updateWorldMatrix(true, true);
  const out: Hotspot[] = [];
  const w = new Vector3();
  for (const c of hs.children) {
    c.getWorldPosition(w);
    out.push({ name: baseName(c.name), position: [w.x, w.y, w.z] });
  }
  return out;
}
