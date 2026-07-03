import type { SpaceModuleData, SpaceModuleOpeningData } from '@/persistence/PlanSaveData';
import type { SpaceModule, ModuleOpening, ModuleKind, ModuleSide } from './spaceModuleStore';

const VALID_KINDS: ModuleKind[] = ['bedroom', 'living', 'kitchen', 'bath', 'entrance', 'corridor', 'custom'];
const VALID_SIDES: ModuleSide[] = ['N', 'E', 'S', 'W'];
const VALID_TYPES: ModuleOpening['type'][] = ['door', 'opening', 'window'];

/** 알 수 없는 kind 문자열은 'custom'으로 폴백. */
function toModuleKind(kind: string): ModuleKind {
  return (VALID_KINDS as string[]).includes(kind) ? (kind as ModuleKind) : 'custom';
}

/** 알 수 없는 side 문자열은 'N'으로 폴백. */
function toModuleSide(side: string): ModuleSide {
  return (VALID_SIDES as string[]).includes(side) ? (side as ModuleSide) : 'N';
}

/** 알 수 없는 type 문자열은 'opening'으로 폴백. */
function toOpeningType(type: string): ModuleOpening['type'] {
  return (VALID_TYPES as string[]).includes(type) ? (type as ModuleOpening['type']) : 'opening';
}

function openingToData(o: ModuleOpening): SpaceModuleOpeningData {
  return {
    id: o.id,
    side: o.side,
    type: o.type,
    ...(o.sill !== undefined ? { sill: o.sill } : {}),
    offset: o.offset,
    width: o.width,
    height: o.height,
    ...(o.suppressedBy !== undefined ? { suppressedBy: o.suppressedBy } : {}),
  };
}

function openingFromData(o: SpaceModuleOpeningData): ModuleOpening {
  return {
    id: o.id,
    side: toModuleSide(o.side),
    type: toOpeningType(o.type),
    ...(typeof o.sill === 'number' ? { sill: o.sill } : {}),
    offset: o.offset,
    width: o.width,
    height: o.height,
    ...(o.suppressedBy !== undefined ? { suppressedBy: o.suppressedBy } : {}),
  };
}

/** {@link SpaceModule} 목록 → 저장용 {@link SpaceModuleData} 목록. */
export function modulesToSaveData(modules: SpaceModule[]): SpaceModuleData[] {
  return modules.map((m) => ({
    id: m.id,
    kind: m.kind,
    name: m.name,
    x: m.x,
    z: m.z,
    ry: m.ry,
    w: m.w,
    d: m.d,
    wallH: m.wallH,
    openings: m.openings.map(openingToData),
  }));
}

/**
 * 저장된 {@link SpaceModuleData} 목록 → {@link SpaceModule} 목록.
 * 구버전 데이터(undefined)는 빈 배열로 취급하며, 모르는 kind/side/type 값은 안전 기본값으로 폴백한다.
 */
export function modulesFromSaveData(data: SpaceModuleData[] | undefined): SpaceModule[] {
  if (!data) return [];
  return data.map((m) => ({
    id: m.id,
    kind: toModuleKind(m.kind),
    name: m.name,
    x: m.x,
    z: m.z,
    ry: normalizeRy(m.ry),
    w: m.w,
    d: m.d,
    wallH: m.wallH,
    openings: m.openings.map(openingFromData),
  }));
}

/** 저장된 ry가 90° 단위가 아니면 가장 가까운 유효값으로 보정. */
function normalizeRy(ry: number): 0 | 90 | 180 | 270 {
  const options: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  return options.includes(ry as 0 | 90 | 180 | 270) ? (ry as 0 | 90 | 180 | 270) : 0;
}
