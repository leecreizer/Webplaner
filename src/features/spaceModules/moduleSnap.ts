import { moduleEdges } from './compileModules';
import type { SpaceModule } from './spaceModuleStore';

/** 스냅 임계 거리(m). */
export const MODULE_SNAP_DIST = 0.15;
const EPS = 1e-6;

type Edge = { ax: number; az: number; bx: number; bz: number };
const isH = (e: Edge) => Math.abs(e.az - e.bz) < 1e-4;
const span1D = (e: Edge) => isH(e)
  ? { lo: Math.min(e.ax, e.bx), hi: Math.max(e.ax, e.bx), fixed: e.az }
  : { lo: Math.min(e.az, e.bz), hi: Math.max(e.az, e.bz), fixed: e.ax };

/** 이동 중 모듈(가상 위치 x,z)이 다른 모듈 벽면에 스냅될 보정량. 스냅 없으면 {dx:0,dz:0}. */
export function computeModuleSnap(
  moving: SpaceModule, x: number, z: number, others: SpaceModule[],
): { dx: number; dz: number } {
  const virt: SpaceModule = { ...moving, x, z };
  const myEdges = Object.values(moduleEdges(virt));
  let bestDx = 0, bx = MODULE_SNAP_DIST;
  let bestDz = 0, bz = MODULE_SNAP_DIST;
  // 모서리 정렬 후보 (면이 이미 맞거나 이번에 맞춰질 때만 적용)
  let cornerDx = 0, cbx = MODULE_SNAP_DIST;
  let cornerDz = 0, cbz = MODULE_SNAP_DIST;

  for (const o of others) {
    if (o.id === moving.id) continue;
    for (const oe of Object.values(moduleEdges(o))) {
      for (const me of myEdges) {
        if (isH(me) !== isH(oe)) continue; // 평행 변만
        const a = span1D(me), b = span1D(oe);
        const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
        const gap = b.fixed - a.fixed; // 면 맞춤 보정량
        if (overlap > EPS && Math.abs(gap) < (isH(me) ? bz : bx)) {
          if (isH(me)) { bz = Math.abs(gap); bestDz = gap; }
          else { bx = Math.abs(gap); bestDx = gap; }
        }
        // 면이 (거의) 맞닿아 있으면 진행방향 모서리 정렬
        if (Math.abs(gap) < MODULE_SNAP_DIST + EPS && overlap > -MODULE_SNAP_DIST) {
          const pairs: [number, number][] = [[a.lo, b.lo], [a.hi, b.hi], [a.lo, b.hi], [a.hi, b.lo]];
          for (const [ue, oe2] of pairs) {
            const d = oe2 - ue;
            if (Math.abs(d) < (isH(me) ? cbx : cbz) && Math.abs(d) > EPS) {
              if (isH(me)) { cbx = Math.abs(d); cornerDx = d; }   // 수평 변 → 진행축 x
              else { cbz = Math.abs(d); cornerDz = d; }            // 수직 변 → 진행축 z
            }
          }
        }
      }
    }
  }
  return {
    dx: bestDx !== 0 ? bestDx : cornerDx,
    dz: bestDz !== 0 ? bestDz : cornerDz,
  };
}