import { describe, expect, it } from 'vitest';
import type { PlanData, PlanIndexEntry } from './homvueAssets';
import { makeSave, parseSave } from './homvueSave';

const mod = (type: string, no: number, isDefault: boolean) => ({
  no, name: `${type}${no}`, isDefault, style: 'LS2P', level: null, products: [], travel: [], unconverted: 0, apartment: [],
  master: { Name: `${type}-${no}`, ID: String(900 + no), PlanID: '58', PlanName: '43', RoomStyle: 'LS2P', RoomType: type,
    OptionNo: '0', IsDefault: isDefault ? 'True' : 'False', ModuleNo: String(no), ModuleName: `${type}${no}`, CoohomVRURL: '',
    ModuleDetailInfo: '', ModuleThumbnailPath: 'None' },
});
const plan: PlanData = {
  id: '58', apt: { id: '13', dong: 'Common_01', name: 'Base_01', label: '공용' }, planName: '43', alias: '2BAY', area: '43',
  base: { level: 'b', apartment: [], products: [], travel: [], staticMeshes: 0 },
  rooms: [
    { type: 'Living01', label: '거실', modules: [mod('Living01', 1, true), mod('Living01', 2, false)] },
    { type: 'Room01', label: '방1', modules: [mod('Room01', 1, true), mod('Room01', 3, false)] },
  ],
};
const plans = [{ id: '58' }] as PlanIndexEntry[];

describe('homvueSave', () => {
  it('언리얼 FSaveData 형식 — 고른 모듈의 방 마스터 행, 숫자·불 형식, 첫 글자 소문자 키', () => {
    const save = makeSave(plan, { Living01: 2, Room01: 1 }, { phone: '01000000000' });
    expect(save.userPhoneNum).toBe('01000000000');
    expect(save.roomList.map((r) => [r.roomType, r.moduleNo, r.iD, r.isDefault, r.planID])).toEqual([
      ['Living01', 2, 902, false, 58],
      ['Room01', 1, 901, true, 58],
    ]);
  });

  it('저장한 것을 다시 읽으면 같은 평면·모듈', () => {
    const save = makeSave(plan, { Living01: 2, Room01: 3 }, {});
    expect(parseSave(JSON.parse(JSON.stringify(save)), plans)).toEqual({ planId: '58', modules: { Living01: 2, Room01: 3 }, phone: '' });
  });

  it('키 대소문자 무시 — 대문자 키로 쓴 파일도 읽는다', () => {
    const upper = { UserPhoneNum: 'x', RoomList: [{ PlanID: 58, RoomType: 'Room01', ModuleNo: 3 }] };
    expect(parseSave(upper, plans).modules).toEqual({ Room01: 3 });
  });

  it('방이 없거나 옮기지 않은 평면이면 오류', () => {
    expect(() => parseSave({ roomList: [] }, plans)).toThrow('방 정보가 없습니다');
    expect(() => parseSave({ roomList: [{ planID: 7, roomType: 'Room01', moduleNo: 1 }] }, plans)).toThrow('옮기지 않은 평면');
  });
});
