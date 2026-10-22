import type { PlacedItem, PlanData, ProductMasterInfo } from './homvueAssets';

/**
 * Homvue 견적 — 언리얼 UHVEstimateWidget::K2_CahcingDatas 그대로.
 *
 * - 대상: 상품 코드·마스터 ID 가 있고 가격 > 0 이며 방이 정해진 상품 (방 미지정 = 기본 레벨 상품은 제외)
 * - 탭: 전체 + 방별. 같은 상품 코드는 수량을 합치고 금액 = 가격 × 수량
 * - 정렬: 상품 종류(ProductType) 내림차순 — 언리얼은 enum 순서, 여기서는 종류 이름 순서
 * - 벽지·바닥재 견적(AHVConstructionActor::MakeEstimates)은 언리얼에서도 호출되지 않아 넣지 않는다
 *
 * 변환 전이라 장면에 안 보이는 상품도 설계에 들어 있으므로 셈한다 (언리얼은 놓인 액터를 모두 센다).
 */
export interface EstimateRow {
  product: ProductMasterInfo;
  count: number;
  total: number;
}

export interface EstimateTab {
  /** null = 전체 */
  room: string | null;
  label: string;
  rows: EstimateRow[];
  total: number;
}

export function buildEstimate(
  plan: PlanData,
  modules: Record<string, number>,
  overrides: Record<string, PlacedItem>,
): EstimateTab[] {
  const entries: { room: string; product: ProductMasterInfo }[] = [];
  for (const room of plan.rooms) {
    const m = room.modules.find((x) => x.no === modules[room.type]);
    m?.products.forEach((item, i) => {
      const p = (overrides[`${room.type}-${m.no}-${i}`] ?? item).product;
      if (p && p.code && p.id > 0 && p.price > 0) entries.push({ room: room.type, product: p });
    });
  }

  const group = (list: typeof entries): { rows: EstimateRow[]; total: number } => {
    const byCode = new Map<string, EstimateRow>();
    for (const { product } of list) {
      const row = byCode.get(product.code);
      if (row) {
        row.count += 1;
        row.total = row.product.price * row.count;
      } else {
        byCode.set(product.code, { product, count: 1, total: product.price });
      }
    }
    const rows = [...byCode.values()].sort((a, b) => b.product.type.localeCompare(a.product.type));
    return { rows, total: rows.reduce((s, r) => s + r.total, 0) };
  };

  const tabs: EstimateTab[] = [{ room: null, label: '전체', ...group(entries) }];
  for (const room of plan.rooms) {
    const list = entries.filter((e) => e.room === room.type);
    if (list.length) tabs.push({ room: room.type, label: room.label, ...group(list) });
  }
  return tabs;
}
