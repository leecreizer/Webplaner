import type { PlanData, PlanIndexEntry } from './homvueAssets';

/**
 * Homvue 저장·불러오기 — 언리얼 UHVGameInstance 저장(FSaveData → JSON)과 같은 형식.
 *
 * - 저장 내용: 방마다 고른 모듈(방 마스터 행 = FRoomMaster) + 사용자 ID·전화번호.
 *   상품 교체·재질 변경은 언리얼에서도 저장하지 않는다.
 * - 키 이름: 언리얼 FJsonObjectConverter 는 첫 글자만 소문자로 바꾼다(ID → iD, PlanID → planID).
 *   읽을 때는 언리얼처럼 대소문자를 가리지 않는다 → 키오스크(HVPlanSaved)에서 저장한 파일도 열린다.
 */
export interface SaveRoom {
  name: string;
  iD: number;
  planID: number;
  planName: string;
  roomStyle: string;
  roomType: string;
  optionNo: number;
  isDefault: boolean;
  moduleNo: number;
  moduleName: string;
  coohomVRURL: string;
  moduleDetailInfo: string;
  moduleThumbnailPath: string;
  levelPath: string;
}

export interface SaveData {
  userID: string;
  userPhoneNum: string;
  roomList: SaveRoom[];
}

const num = (v: string | undefined) => Number(v ?? 0) || 0;

export function makeSave(plan: PlanData, modules: Record<string, number>, user: { id?: string; phone?: string }): SaveData {
  const roomList = plan.rooms.flatMap((room) => {
    const m = room.modules.find((x) => x.no === modules[room.type]);
    if (!m) return [];
    const r = m.master ?? {};
    return [
      {
        name: r.Name ?? '',
        iD: num(r.ID),
        planID: num(r.PlanID ?? plan.id),
        planName: r.PlanName ?? plan.planName,
        roomStyle: r.RoomStyle ?? m.style,
        roomType: r.RoomType ?? room.type,
        optionNo: num(r.OptionNo),
        isDefault: (r.IsDefault ?? String(m.isDefault)) === 'True' || r.IsDefault === 'true',
        moduleNo: num(r.ModuleNo ?? String(m.no)),
        moduleName: r.ModuleName ?? m.name,
        coohomVRURL: r.CoohomVRURL ?? '',
        moduleDetailInfo: r.ModuleDetailInfo ?? '',
        moduleThumbnailPath: r.ModuleThumbnailPath ?? '',
        levelPath: '',
      },
    ];
  });
  return { userID: user.id ?? '', userPhoneNum: user.phone ?? '', roomList };
}

/** 저장 JSON → 열 평면 ID 와 방별 모듈 번호. 키 대소문자 무시(언리얼 JsonObjectStringToUStruct 와 같음). */
export function parseSave(json: unknown, plans: PlanIndexEntry[]): { planId: string; modules: Record<string, number>; phone: string } {
  const obj = lowerKeys(json) as Record<string, unknown>;
  const list = (obj.roomlist as Record<string, unknown>[] | undefined) ?? [];
  if (!list.length) throw new Error('저장 파일에 방 정보가 없습니다 (No Room in save)');
  const planId = String(list[0].planid ?? '');
  if (!plans.some((p) => p.id === planId)) throw new Error(`평면 ${planId} 은(는) 아직 옮기지 않은 평면입니다`);
  const modules: Record<string, number> = {};
  for (const r of list) modules[String(r.roomtype)] = Number(r.moduleno);
  return { planId, modules, phone: String(obj.userphonenum ?? '') };
}

function lowerKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(lowerKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.toLowerCase(), lowerKeys(x)]));
  }
  return v;
}

/* ── 이 기기 저장 목록 — 키오스크의 HVPlanSaved 폴더 대응. 언리얼처럼 이름 = 전화번호(없으면 시각) ── */

export interface SavedEntry {
  name: string;
  savedAt: string;
  data: SaveData;
}

const KEY = 'homvue:saves';

export function readSaves(): SavedEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedEntry[];
  } catch {
    return [];
  }
}

export function writeSaves(list: SavedEntry[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
