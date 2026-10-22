import { describe, expect, it } from 'vitest';
import type { PlacedItem, PlanData, ProductMasterInfo } from './homvueAssets';
import { buildEstimate } from './homvueEstimate';

const master = (code: string, price: number, type = 'Sofa', id = 1): ProductMasterInfo => ({
  id, code, name: code, type, group: 'None', price, eventPrice: 0,
});
const item = (product?: ProductMasterInfo): PlacedItem => ({
  blueprint: `/Game/Homvue/BP_Asset/Product/X/BP_${product?.code ?? 'deco'}`,
  glb: null, location_cm: [0, 0, 0], rotation_deg: [0, 0, 0], scale: [1, 1, 1], product,
});

const plan: PlanData = {
  id: '58', apt: { id: '13', dong: 'Common_01', name: 'Base_01', label: '공용' }, planName: '43', alias: null, area: null,
  base: { level: 'base', apartment: [], travel: [], staticMeshes: 0, products: [item(master('BASE', 9999))] },
  rooms: [
    {
      type: 'Living01', label: '거실',
      modules: [
        { no: 1, name: '소파형', isDefault: true, style: 'LS2P', level: null, travel: [], unconverted: 0, apartment: [],
          products: [item(master('CHAIR', 100, 'DiningChair')), item(master('CHAIR', 100, 'DiningChair')), item(master('SOFA', 500)), item(), item(master('FREE', 0))] },
        { no: 2, name: '홈다이닝형', isDefault: false, style: 'LS2P', level: null, travel: [], unconverted: 0, apartment: [],
          products: [item(master('TABLE', 300, 'DiningTable'))] },
      ],
    },
    {
      type: 'Room01', label: '방1',
      modules: [{ no: 1, name: '침대', isDefault: true, style: 'LS2P', level: null, travel: [], unconverted: 0, apartment: [],
        products: [item(master('CHAIR', 100, 'DiningChair')), item(master('NOID', 50, 'Bed', 0))] }],
    },
  ],
};

describe('buildEstimate', () => {
  it('전체 + 방별 탭, 같은 코드는 수량 합산, 가격 0·마스터 없음·ID 0·기본 레벨 상품 제외', () => {
    const tabs = buildEstimate(plan, { Living01: 1, Room01: 1 }, {});
    expect(tabs.map((t) => t.label)).toEqual(['전체', '거실', '방1']);
    const all = tabs[0];
    expect(all.rows.map((r) => [r.product.code, r.count, r.total])).toEqual([
      ['SOFA', 1, 500],
      ['CHAIR', 3, 300],
    ]);
    expect(all.total).toBe(800);
    expect(tabs[1].total).toBe(700);
    expect(tabs[2].rows).toEqual([expect.objectContaining({ count: 1, total: 100 })]);
  });

  it('고른 모듈만 셈한다', () => {
    const tabs = buildEstimate(plan, { Living01: 2, Room01: 1 }, {});
    expect(tabs[1].rows.map((r) => r.product.code)).toEqual(['TABLE']);
    expect(tabs[0].total).toBe(400);
  });

  it('교체한 상품은 교체본 가격으로', () => {
    const swapped = { ...item(master('SOFA2', 800)) };
    const tabs = buildEstimate(plan, { Living01: 1, Room01: 1 }, { 'Living01-1-2': swapped });
    expect(tabs[1].rows.find((r) => r.product.code === 'SOFA2')?.total).toBe(800);
    expect(tabs[1].rows.find((r) => r.product.code === 'SOFA')).toBeUndefined();
  });
});
