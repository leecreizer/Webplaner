import type { ModuleSide, SpaceModule } from './spaceModuleStore';

/** 컴파일 산출 개구부 — 세그먼트 a→b 방향 기준 위치. */
export interface CompiledOpening {
  moduleId: string; openingId: string;
  type: 'door'|'opening';
  t: number; width: number; height: number;
}
/** 컴파일 산출 벽 세그먼트 — XZ 평면 축 정렬 선분. */
export interface CompiledWall {
  ax: number; az: number; bx: number; bz: number;
  h: number;
  sourceModuleIds: string[];
  openings: CompiledOpening[];
}
/** 공유벽에서 양쪽 개구부 구간이 겹치는데 승자 미지정 — UI가 선택 다이얼로그 표시. */
export interface OpeningConflict {
  a: { moduleId: string; openingId: string };
  b: { moduleId: string; openingId: string };
}

const EPS = 1e-3;
type Edge = { ax: number; az: number; bx: number; bz: number };

/** 모듈 4변(월드, 시계방향 N→E→S→W). ry는 중심 기준 90° 단위 회전. */
export function moduleEdges(m: SpaceModule): Record<ModuleSide, Edge> {
  const hw = m.w / 2, hd = m.d / 2;
  // ry=0 로컬 코너 (시계방향: NW→NE→SE→SW), N=-z
  let corners = [
    { x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd },
  ];
  const rot = ((m.ry % 360) + 360) % 360;
  const times = rot / 90;
  for (let i = 0; i < times; i++) {
    corners = corners.map((c) => ({ x: -c.z, z: c.x })); // +90° (y축)
  }
  const w = corners.map((c) => ({ x: c.x + m.x, z: c.z + m.z }));
  const edge = (a: { x: number; z: number }, b: { x: number; z: number }): Edge =>
    ({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  return { N: edge(w[0], w[1]), E: edge(w[1], w[2]), S: edge(w[2], w[3]), W: edge(w[3], w[0]) };
}

/** 변이 수평(z 상수)인지. 아니면 수직(x 상수) — 축 정렬 전제. */
const isHorizontal = (e: Edge) => Math.abs(e.az - e.bz) < EPS;
/** 변의 1D 구간 [lo,hi]와 고정축 좌표. */
function span(e: Edge) {
  return isHorizontal(e)
    ? { lo: Math.min(e.ax, e.bx), hi: Math.max(e.ax, e.bx), fixed: e.az, horiz: true }
    : { lo: Math.min(e.az, e.bz), hi: Math.max(e.az, e.bz), fixed: e.ax, horiz: false };
}

interface Piece { lo: number; hi: number; owners: { moduleId: string; side: ModuleSide; edge: Edge }[] }

export function compileModules(modules: SpaceModule[]): { walls: CompiledWall[]; conflicts: OpeningConflict[] } {
  const conflicts: OpeningConflict[] = [];
  const walls: CompiledWall[] = [];
  const byId = new Map(modules.map((m) => [m.id, m]));

  // (horiz, fixed좌표) 그룹으로 동일선상 변들을 모은다
  type Item = { moduleId: string; side: ModuleSide; edge: Edge; lo: number; hi: number };
  const groups = new Map<string, Item[]>();
  for (const m of modules) {
    const edges = moduleEdges(m);
    for (const side of ['N', 'E', 'S', 'W'] as ModuleSide[]) {
      const e = edges[side];
      const s = span(e);
      const key = `${s.horiz ? 'H' : 'V'}:${Math.round(s.fixed / EPS)}`;
      const arr = groups.get(key) ?? [];
      arr.push({ moduleId: m.id, side, edge: e, lo: s.lo, hi: s.hi });
      groups.set(key, arr);
    }
  }

  for (const [key, items] of groups) {
    const horiz = key.startsWith('H');
    const fixed = span(items[0].edge).fixed;
    // 구간 경계점으로 조각 분할 (모든 lo/hi 수집)
    const cuts = [...new Set(items.flatMap((i) => [i.lo, i.hi]))].sort((a, b) => a - b);
    const pieces: Piece[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const lo = cuts[i], hi = cuts[i + 1];
      if (hi - lo < EPS) continue;
      const mid = (lo + hi) / 2;
      const owners = items.filter((it) => it.lo - EPS < mid && mid < it.hi + EPS)
        .map((it) => ({ moduleId: it.moduleId, side: it.side, edge: it.edge }));
      if (owners.length === 0) continue;
      pieces.push({ lo, hi, owners });
    }

    for (const p of pieces) {
      const ids = [...new Set(p.owners.map((o) => o.moduleId))];
      const h = Math.max(...ids.map((id) => byId.get(id)!.wallH));
      const wall: CompiledWall = horiz
        ? { ax: p.lo, az: fixed, bx: p.hi, bz: fixed, h, sourceModuleIds: ids, openings: [] }
        : { ax: fixed, az: p.lo, bx: fixed, bz: p.hi, h, sourceModuleIds: ids, openings: [] };

      // 이 조각 구간에 걸치는 개구부 수집 (모듈별)
      const cand: CompiledOpening[] = [];
      for (const o of p.owners) {
        const m = byId.get(o.moduleId)!;
        for (const op of m.openings) {
          if (op.side !== o.side) continue;
          // opening 중심의 월드 1D 좌표 — 변 방향(a→b)이 lo→hi와 반대일 수 있어 정규화
          const s = span(o.edge);
          const startWorld = horiz
            ? (o.edge.ax <= o.edge.bx ? s.lo : s.hi)
            : (o.edge.az <= o.edge.bz ? s.lo : s.hi);
          const dir = horiz
            ? (o.edge.ax <= o.edge.bx ? 1 : -1)
            : (o.edge.az <= o.edge.bz ? 1 : -1);
          const centerWorld = startWorld + dir * op.offset;
          if (centerWorld < p.lo - EPS || centerWorld > p.hi + EPS) continue; // 이 조각 밖
          // suppressed 유효성: 이긴 상대가 같은 공유 조각에 실제로 있으면 제외
          if (op.suppressedBy) {
            const winnerHere = p.owners.some((ow) =>
              byId.get(ow.moduleId)!.openings.some((x) => x.id === op.suppressedBy && x.side === ow.side));
            if (winnerHere) continue;
          }
          cand.push({
            moduleId: o.moduleId, openingId: op.id, type: op.type,
            t: centerWorld - p.lo, width: op.width, height: op.height,
          });
        }
      }
      // 공유벽 개구부 충돌: 서로 다른 모듈의 후보 구간이 겹치면 conflict + 해당 쌍 전부 제외
      const excluded = new Set<string>();
      for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
        const a = cand[i], b = cand[j];
        if (a.moduleId === b.moduleId) continue;
        const overlap = Math.min(a.t + a.width / 2, b.t + b.width / 2)
                      - Math.max(a.t - a.width / 2, b.t - b.width / 2);
        if (overlap > EPS) {
          conflicts.push({
            a: { moduleId: a.moduleId, openingId: a.openingId },
            b: { moduleId: b.moduleId, openingId: b.openingId },
          });
          excluded.add(a.openingId); excluded.add(b.openingId);
        }
      }
      wall.openings = cand.filter((c) => !excluded.has(c.openingId));
      walls.push(wall);
    }
  }
  return { walls, conflicts };
}
