import { useRef, useState } from 'react';
import { useWallDrawingStore } from '@/features/drawing/wallDrawingStore';
import { useViewStore } from '@/engine/stores/viewStore';
import { useLayoutStore, layoutRegistry } from '@/domain/state/layoutStore';
import { buildSpaces } from '@/domain/layout/SpaceBuilder';
import { useCustomLightStore, type LightKind } from '@/engine/stores/customLightStore';
import { useEditStore } from '@/features/editing/editStore';
import { useImportedModelStore, type PrimitiveKind } from '@/features/models/importedModelStore';
import { usePlacedProductStore } from '@/features/placement/placedProductStore';

const LIGHT_OPTIONS: { kind: LightKind; label: string; desc: string }[] = [
  { kind: 'point', label: '포인트 (옴니)', desc: '360° 점 광원' },
  { kind: 'spot', label: '스팟 (타겟)', desc: '타겟 방향 콘 광원' },
  { kind: 'rect', label: '렉탱글 (면광원)', desc: '직사각 면 광원' },
  { kind: 'hemisphere', label: '헤미스피어', desc: 'sky/ground 그라데이션' },
];

/**
 * Canvas 위에 떠 있는 HTML overlay 툴바.
 *
 * 섹션: 모드(2D/3D) · 벽 그리기 · 두께/마커 · 공간/초기화.
 */
export function Toolbar() {
  const enabled = useWallDrawingStore((s) => s.enabled);
  const mode = useWallDrawingStore((s) => s.mode);
  const viewMode = useViewStore((s) => s.viewMode);
  const wallThick = useViewStore((s) => s.wallThickPreview);
  const lineWidth = useViewStore((s) => s.drawingLineWidth);
  const showNodes = useViewStore((s) => s.showNodeMarkers);

  const lineActive = enabled && mode === 'line';
  const rectActive = enabled && mode === 'rectangle';

  const toggleLine = () => {
    const s = useWallDrawingStore.getState();
    if (lineActive) {
      s.disable();
      runBuildSpaces();
    } else {
      s.enable('line');
    }
  };

  const toggleRect = () => {
    const s = useWallDrawingStore.getState();
    if (rectActive) {
      s.disable();
      runBuildSpaces();
    } else {
      s.enable('rectangle');
    }
  };

  const reset = () => {
    useLayoutStore.getState().reset();
    useWallDrawingStore.getState().disable();
  };

  return (
    <div style={containerStyle}>
      {/* 2D / 3D 토글 */}
      <div style={segmentedStyle}>
        <button
          onClick={() => useViewStore.getState().setViewMode('2D')}
          style={viewMode === '2D' ? segmentActiveStyle : segmentStyle}
          title="평면도 (탑뷰 Orthographic, 회전 불가)"
        >
          2D
        </button>
        <button
          onClick={() => useViewStore.getState().setViewMode('3D')}
          style={viewMode === '3D' ? segmentActiveStyle : segmentStyle}
          title="3D Perspective (자유 회전)"
        >
          3D
        </button>
      </div>

      <button onClick={toggleLine} style={lineActive ? activeButtonStyle : buttonStyle}>
        {lineActive ? '✓ 벽 그리기 완료 (Esc/더블클릭)' : '벽 그리기'}
      </button>
      <button onClick={toggleRect} style={rectActive ? activeButtonStyle : buttonStyle}>
        {rectActive ? '✓ 공간 그리기 완료 (Esc)' : '공간 그리기'}
      </button>
      <button onClick={runBuildSpaces} style={buttonStyle}>
        공간 자동 검출
      </button>

      <AddLightDropdown />
      <AddPrimitiveDropdown />
      <ImportModelButton />
      <EditModeControls />
      <DoorControls />
      <button onClick={reset} style={dangerButtonStyle}>
        초기화
      </button>

      {/* 벽 두께 슬라이더 */}
      <MiniSlider
        label="벽 두께"
        unit="m"
        min={0.05}
        max={0.5}
        step={0.01}
        value={wallThick}
        onChange={useViewStore.getState().setWallThickPreview}
      />

      {/* 그리기 라인 두께 */}
      <MiniSlider
        label="라인"
        unit="px"
        min={1}
        max={8}
        step={0.5}
        value={lineWidth}
        onChange={useViewStore.getState().setDrawingLineWidth}
      />

      {/* 꼭지점 마커 토글 */}
      <label style={checkboxStyle}>
        <input
          type="checkbox"
          checked={showNodes}
          onChange={(e) => useViewStore.getState().setShowNodeMarkers(e.target.checked)}
        />
        <span>꼭지점</span>
      </label>

      <span style={hintStyle}>
        {lineActive
          ? '좌클릭=점, 폐쇄 시 바닥 자동, Shift=각도해제, ESC=취소'
          : rectActive
            ? '클릭=시작, 이동=프리뷰, 다시 클릭=확정, Shift=정사각형, ESC=취소'
            : viewMode === '2D'
              ? '2D 탑뷰 (회전 불가)'
              : '가운데 드래그=이동, 우클릭 드래그=회전, 휠=줌'}
      </span>
    </div>
  );
}

function MiniSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={miniSliderContainerStyle}>
      <span style={miniSliderLabelStyle}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ accentColor: '#ff9800', width: 60 }}
      />
      <span style={miniSliderValueStyle}>
        {value.toFixed(step < 0.1 ? 2 : 1)}
        {unit ?? ''}
      </span>
    </div>
  );
}

/**
 * 도어 컨트롤 — 부착된 도어 열기/닫기 토글 + 열림 각도 조절(슬라이더+숫자).
 * 힌지(바깥 변) 기준 회전이며 각도 0=닫힘, 양수=앞으로 열림.
 */
function DoorControls() {
  const doorsOpen = usePlacedProductStore((s) => s.doorsOpen);
  const toggleDoors = usePlacedProductStore((s) => s.toggleDoors);
  const deg = usePlacedProductStore((s) => s.doorOpenDeg);
  const setDeg = usePlacedProductStore((s) => s.setDoorOpenDeg);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={toggleDoors}
        style={doorsOpen ? activeButtonStyle : buttonStyle}
        title="부착된 도어 열기/닫기 (단축키 O)"
      >
        {doorsOpen ? '🚪 도어 닫기' : '🚪 도어 열기'}
      </button>
      <MiniSlider label="도어각도" unit="°" min={-180} max={180} step={5} value={deg} onChange={setDeg} />
      <input
        type="number"
        value={deg}
        min={-180}
        max={180}
        step={5}
        onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) setDeg(v); }}
        style={{ width: 52, background: '#1f2430', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}
        title="도어 열림 각도(도). 음수면 반대 방향."
      />
    </div>
  );
}

/**
 * 모델 불러오기 버튼 — 숨겨진 file input 트리거. GLB/GLTF 선택 시 blob URL 로 즉시 씬에 로드.
 * 여러 파일 동시 선택 가능. gltf 는 외부 .bin/텍스처 참조가 있을 수 있어 자체완결 .glb 권장.
 */
function ImportModelButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const addFromFile = useImportedModelStore((s) => s.addFromFile);
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        style={buttonStyle}
        title="GLB / GLTF 3D 모델 파일을 불러옵니다 (.glb 권장 — 자체완결 포맷)"
      >
        📦 모델 불러오기
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files;
          if (files) {
            for (const f of Array.from(files)) addFromFile(f);
          }
          // 같은 파일 재선택 가능하도록 초기화
          e.target.value = '';
        }}
      />
    </>
  );
}

/**
 * 탑 메뉴 드롭다운 — "조명 추가" 버튼 클릭 시 4종 라이트 옵션 표시. 항목 클릭 → store에 add.
 * outside-click + ESC로 닫힘.
 */
function AddLightDropdown() {
  const [open, setOpen] = useState(false);
  const add = useCustomLightStore((s) => s.add);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={open ? activeButtonStyle : buttonStyle}
        title="다양한 종류의 조명 추가"
      >
        + 조명 추가 ▾
      </button>
      {open && (
        <>
          {/* outside-click 차단용 invisible overlay */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10 }}
          />
          <div style={dropdownStyle}>
            {LIGHT_OPTIONS.map((o) => (
              <button
                key={o.kind}
                onClick={() => {
                  add(o.kind);
                  setOpen(false);
                }}
                style={dropdownItemStyle}
                title={o.desc}
              >
                <span style={{ fontWeight: 600 }}>{o.label}</span>
                <span style={{ color: '#888', fontSize: 11 }}>{o.desc}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const PRIMITIVE_OPTIONS: { kind: PrimitiveKind; label: string; icon: string }[] = [
  { kind: 'box', label: '박스', icon: '⬛' },
  { kind: 'sphere', label: '구', icon: '⚫' },
  { kind: 'plane', label: '평면', icon: '▭' },
  { kind: 'cone', label: '원뿔', icon: '🔺' },
  { kind: 'cylinder', label: '실린더', icon: '🥫' },
  { kind: 'torus', label: '토러스', icon: '🍩' },
  { kind: 'torusKnot', label: '토러스 매듭', icon: '🪢' },
  { kind: 'teapot', label: '주전자', icon: '🫖' },
  { kind: 'tube', label: '튜브', icon: '〰️' },
];

/**
 * "기본 도형 추가" 드롭다운 — primitive geometry 를 씬에 추가. 추가된 도형은 imported model 과
 * 동일하게 선택/이동/회전/크기/PBR 머티리얼 편집 가능.
 */
function AddPrimitiveDropdown() {
  const [open, setOpen] = useState(false);
  const addPrimitive = useImportedModelStore((s) => s.addPrimitive);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={open ? activeButtonStyle : buttonStyle}
        title="기본 도형(박스/구/원뿔 등)을 씬에 추가"
      >
        ◇ 기본 도형 ▾
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={dropdownStyle}>
            {PRIMITIVE_OPTIONS.map((o) => (
              <button
                key={o.kind}
                onClick={() => {
                  addPrimitive(o.kind);
                  setOpen(false);
                }}
                style={dropdownItemStyle}
              >
                <span style={{ fontWeight: 600 }}>{o.icon} {o.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 3D 에디트 모드 컨트롤 — 토글 + 뚫기/돌출 선택 + 두께 슬라이더.
 * 활성 시 EditTool이 raycast로 면을 잡고 사각형을 그릴 수 있게 된다.
 */
function EditModeControls() {
  const enabled = useEditStore((s) => s.enabled);
  const operation = useEditStore((s) => s.operation);
  const thickness = useEditStore((s) => s.thickness);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={() => {
          const s = useEditStore.getState();
          if (s.enabled) s.disable();
          else s.enable('cut');
        }}
        style={enabled ? activeButtonStyle : buttonStyle}
        title="3D 면 편집 (뚫기/돌출)"
      >
        {enabled ? '✓ 에디트 (Esc)' : '에디트 모드'}
      </button>
      {enabled && (
        <>
          <div style={segmentedStyle}>
            <button
              onClick={() => useEditStore.getState().setOperation('cut')}
              style={operation === 'cut' ? segmentActiveStyle : segmentStyle}
              title="선택한 면에 사각형으로 구멍 뚫기"
            >
              뚫기
            </button>
            <button
              onClick={() => useEditStore.getState().setOperation('extrude')}
              style={operation === 'extrude' ? segmentActiveStyle : segmentStyle}
              title="선택한 면 밖으로 사각형을 돌출"
            >
              돌출
            </button>
          </div>
          <MiniSlider
            label="두께"
            unit="m"
            min={0.05}
            max={2}
            step={0.05}
            value={thickness}
            onChange={useEditStore.getState().setThickness}
          />
        </>
      )}
    </div>
  );
}

function runBuildSpaces(): void {
  buildSpaces(useLayoutStore.getState().walls, layoutRegistry);
  for (const space of useLayoutStore.getState().spaces) {
    space.invalidateCornerPoints();
    void space.cornerPoints;
    space.updateCenter();
    space.updateArea();
  }
}

// ===== Inline styles ============================================

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  zIndex: 10,
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
  padding: '8px 12px',
  background: 'rgba(20, 20, 24, 0.72)',
  border: '1px solid #333',
  borderRadius: 8,
  color: '#e0e0e0',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 13,
  pointerEvents: 'auto',
  maxWidth: 'calc(100% - 320px)',
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#2a2a30',
  color: '#e0e0e0',
  border: '1px solid #444',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

const activeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#ff9800',
  color: '#000',
  borderColor: '#ff9800',
  fontWeight: 600,
};

const dangerButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#3a1f1f',
  borderColor: '#5a2a2a',
};

const segmentedStyle: React.CSSProperties = {
  display: 'flex',
  borderRadius: 4,
  overflow: 'hidden',
  border: '1px solid #444',
};

const segmentStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: '#2a2a30',
  color: '#bbb',
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
};

const segmentActiveStyle: React.CSSProperties = {
  ...segmentStyle,
  background: '#42a5f5',
  color: '#000',
  fontWeight: 700,
};

const miniSliderContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: '#bbb',
};

const miniSliderLabelStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
};

const miniSliderValueStyle: React.CSSProperties = {
  color: '#fff',
  fontVariantNumeric: 'tabular-nums',
  minWidth: 36,
  textAlign: 'right',
};

const checkboxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  color: '#bbb',
  cursor: 'pointer',
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  marginLeft: 4,
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(20, 20, 24, 0.96)',
  border: '1px solid #444',
  borderRadius: 6,
  padding: 4,
  minWidth: 200,
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
};

const dropdownItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  padding: '6px 10px',
  background: 'transparent',
  color: '#e0e0e0',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  textAlign: 'left',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};