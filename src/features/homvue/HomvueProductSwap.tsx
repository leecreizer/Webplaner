import { useEffect, useMemo } from 'react';
import { useHomvueStore } from './homvueStore';
import { placedProducts, won } from './homvueAssets';
import { MaterialList } from './HomvueSpaceMaterial';

/**
 * 선택한 상품 · 상품 교체 — 언리얼 WB_ChangeProductCell · HVPlayer::ChangeProduct 대응.
 *
 * 후보 = 상품 마스터에서 같은 ProductType (HVProductManager::GetChangeableProductList).
 * 마스터가 없는 소품(책·쿠션 등)은 언리얼에서도 후보가 없다 — 선택만 되고 교체 목록은 비어 있다.
 */
export function HomvueProductSwap() {
  const plan = useHomvueStore((s) => s.plan);
  const modules = useHomvueStore((s) => s.modules);
  const overrides = useHomvueStore((s) => s.overrides);
  const selected = useHomvueStore((s) => s.selected);
  const catalog = useHomvueStore((s) => s.catalog);
  const materials = useHomvueStore((s) => s.materials);
  const matProduct = useHomvueStore((s) => s.matProduct);

  useEffect(() => {
    // 상품이 아닌 물체(벽·바닥·레벨 메시 = part:)는 교체 목록이 없다
    if (selected && !selected.startsWith('part:')) void useHomvueStore.getState().loadCatalog();
  }, [selected]);

  const current = useMemo(
    () => (plan && selected ? placedProducts(plan, modules, overrides).find((p) => p.key === selected) : undefined),
    [plan, modules, overrides, selected],
  );
  if (!current) return null;

  const s = useHomvueStore.getState();
  const master = current.item.product;
  const candidates = master && catalog ? catalog[master.type] ?? [] : [];
  const ready = candidates.filter((c) => c.glb);
  const name = master?.name ?? current.item.blueprint.split('/').pop();
  // ChangeableType=Material 인 상품 — 교체 대신 재질 목록 (AHVPlayer::ChangeProductMat)
  const matChangeable = !!materials?.targets.product.includes(current.item.blueprint);

  return (
    <div style={boxStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, fontWeight: 600 }}>{name}</div>
        <button onClick={() => s.select(null)} style={closeBtnStyle} title="선택 해제">
          ✕
        </button>
      </div>
      {master ? (
        <div style={hintStyle}>
          {master.code} · {master.type} · {master.price > 0 ? won(master.price) : '가격 없음'}
        </div>
      ) : (
        <div style={hintStyle}>소품 — 상품 마스터에 없어 교체 후보가 없습니다 (언리얼과 같음)</div>
      )}

      {matChangeable && materials && (
        <MaterialList title="재질 바꾸기" kind="product" list={materials.materials.product} current={matProduct[current.key]}
          onPick={(id) => s.setMaterial('product', current.key, id)} />
      )}
      {master && !matChangeable && (
        <>
          <div style={{ fontSize: 11, opacity: 0.8, margin: '6px 0 2px' }}>
            같은 종류로 교체 {catalog ? `(${ready.length}/${candidates.length})` : '— 목록 불러오는 중…'}
          </div>
          <div style={listStyle}>
            {ready.map((c) => {
              const isCurrent = c.blueprint === current.item.blueprint;
              return (
                <button
                  key={c.id}
                  disabled={isCurrent}
                  onClick={() => s.swap(current.key, current.item, c)}
                  style={isCurrent ? itemActiveStyle : itemStyle}
                  title={`${c.code} · ${c.name}`}
                >
                  <span style={{ flex: 1, textAlign: 'left' }}>{c.name}</span>
                  <span style={{ opacity: 0.7 }}>{c.price > 0 ? won(c.price) : ''}</span>
                </button>
              );
            })}
          </div>
          {catalog && candidates.length > ready.length && (
            <div style={hintStyle}>변환 전 {candidates.length - ready.length}개는 변환이 끝나면 목록에 나옵니다</div>
          )}
        </>
      )}
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  border: '1px solid #facc15', borderRadius: 4, padding: '6px 8px', background: 'rgba(250,204,21,0.06)',
};
const listStyle: React.CSSProperties = { maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 };
const itemStyle: React.CSSProperties = {
  display: 'flex', gap: 6, padding: '4px 6px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)',
  background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 11,
};
const itemActiveStyle: React.CSSProperties = { ...itemStyle, border: '1px solid #facc15', color: '#fef9c3', cursor: 'default' };
const closeBtnStyle: React.CSSProperties = { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' };
const hintStyle: React.CSSProperties = { fontSize: 11, opacity: 0.6 };
