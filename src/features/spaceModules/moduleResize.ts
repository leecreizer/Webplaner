import type { ModuleSide } from './spaceModuleStore';
import { useSpaceModuleStore } from './spaceModuleStore';
import { moduleEdges } from './compileModules';

/**
 * 모듈 변 크기조절 공용 로직.
 *
 * - 변 핸들 드래그(ModulePlacement)와 **모듈발 벽 직접 드래그(WallView)** 가 공유.
 * - 드래그한 변만 포인터를 따라가고 반대 변은 고정(치수 변경 + 중심 절반 이동).
 * - 회전(ry 자유각) 상태에서도 로컬 좌표 환산으로 동작.
 */
const MIN_EDGE = 0.6; // 최소 변 길이(m)

export function resizeModuleEdge(id: string, side: ModuleSide, px: number, pz: number): void {
  const st = useSpaceModuleStore.getState();
  const m = st.modules.find((x) => x.id === id);
  if (!m) return;
  const phi = (m.ry * Math.PI) / 180;
  const cos = Math.cos(-phi), sin = Math.sin(-phi);
  // 포인터를 모듈 로컬로 (월드 회전 역변환)
  const rx = px - m.x, rz = pz - m.z;
  const lx = rx * cos - rz * sin;
  const lz = rx * sin + rz * cos;
  let w = m.w, d = m.d, cxL = 0, czL = 0; // 중심 이동(로컬)
  if (side === 'E') { const nw = Math.max(MIN_EDGE, lx + m.w / 2); cxL = (nw - m.w) / 2; w = nw; }
  else if (side === 'W') { const nw = Math.max(MIN_EDGE, m.w / 2 - lx); cxL = -(nw - m.w) / 2; w = nw; }
  else if (side === 'S') { const nd = Math.max(MIN_EDGE, lz + m.d / 2); czL = (nd - m.d) / 2; d = nd; }
  else { const nd = Math.max(MIN_EDGE, m.d / 2 - lz); czL = -(nd - m.d) / 2; d = nd; }
  const c2 = Math.cos(phi), s2 = Math.sin(phi);
  st.update(id, {
    w: Math.round(w * 100) / 100,
    d: Math.round(d * 100) / 100,
    x: m.x + cxL * c2 - czL * s2,
    z: m.z + cxL * s2 + czL * c2,
  });
}

/**
 * 모듈발 벽(양 끝점)이 어느 모듈의 어느 변인지 판별.
 * 벽 중점이 변 선분 위(수직거리 5cm 이내 + 구간 안)에 있으면 그 변으로 본다.
 * 공유벽(2모듈)은 첫 번째로 매칭된 모듈 기준.
 */
export function findModuleSideForWall(
  moduleIds: string[],
  midX: number, midZ: number,
): { moduleId: string; side: ModuleSide } | null {
  const st = useSpaceModuleStore.getState();
  for (const id of moduleIds) {
    const m = st.modules.find((x) => x.id === id);
    if (!m) continue;
    const edges = moduleEdges(m);
    for (const side of ['N', 'E', 'S', 'W'] as ModuleSide[]) {
      const e = edges[side];
      const dx = e.bx - e.ax, dz = e.bz - e.az;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const t = (midX - e.ax) * ux + (midZ - e.az) * uz;
      if (t < -0.05 || t > len + 0.05) continue;
      const perp = Math.abs((midX - e.ax) * -uz + (midZ - e.az) * ux);
      if (perp < 0.05) return { moduleId: id, side };
    }
  }
  return null;
}
