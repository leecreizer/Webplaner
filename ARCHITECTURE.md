# Architecture

본 문서는 **HomePlanner3-Web**(Webplaner)의 모듈 구조를 4개 레이어로 분류하고, 각 모듈의 책임과 공공 API를 명세한다. 다른 프로젝트에서 일부 레이어만 떼어 재사용할 수 있도록 의존 방향을 강하게 제약한다.

## 4-레이어 모델

```
┌─────────────────────────────────────────────────────────────┐
│ UI/UX                  ← 사용자 HTML overlay (Toolbar, Panel) │
├─────────────────────────────────────────────────────────────┤
│ Features (Frontend)    ← 인터랙션 + 씬뷰 (drawing/editing/...) │
├─────────────────────────────────────────────────────────────┤
│ Engine                 ← Three.js 렌더링/라이팅/PostFX/CSG     │
├─────────────────────────────────────────────────────────────┤
│ Domain                 ← Node/Wall/Space/Product/Layout 모델  │
├─────────────────────────────────────────────────────────────┤
│ Lib                    ← 순수 수학/유틸 (외부 의존 0)          │
└─────────────────────────────────────────────────────────────┘
        ↕
Host  ←  외부 host(Unity, web shell) 와의 bridge — 이벤트/명령
Network ← Snapit 백엔드 클라이언트
Persistence ← Plan 저장/로드
```

**의존 규칙**: 위→아래 단방향만 허용. UI → Features → Engine → Domain → Lib.  
Host/Network/Persistence는 Domain ↔ 외부 시스템의 어댑터로, *어느 레이어에서도 import 가능*하지만 *역방향 의존 금지*.

## 레이어별 매핑

### ① UI/UX  (`src/ui/`)
React HTML overlay — Canvas 위에 떠 있는 패널/툴바.

| 모듈 | 파일 | 책임 |
|---|---|---|
| Toolbar | `ui/Toolbar.tsx` | 그리기/편집/2D-3D 전환, 환경 프리셋, 카메라 뷰 |
| LightingPanel | `ui/LightingPanel.tsx` | 광원·그림자·GI·라이트맵·PostFX·LightProbe 조정 |

### ② Features (Frontend interaction)  (`src/features/`)
사용자 입력 → 도메인 상태 변이. R3F 컴포넌트로 씬에 mount.

| 모듈 | 폴더 | 책임 |
|---|---|---|
| Scene rendering | `features/scene/` | PlanScene + WallView/FloorView/CeilingView/ProductView/SunGizmo (도메인 ↔ Three.js 메쉬) |
| Drawing tool | `features/drawing/` | WallDrawingTool, NodeMarkers, DragGuideLines, snapHelpers, wallDrawingStore |
| Editing (CSG) | `features/editing/` | EditTool, EditOverlay, editStore (벽/바닥/천장 cut/extrude) |
| Selection | `features/selection/` | selectionStore (선택 상태) |
| Undo/Redo | `features/undoredo/` | ICommand, UndoRedoManager, commands/* |

### ③ Engine (Three.js layer)  (`src/engine/`)
순수 Three.js / R3F 렌더링. 도메인 미참조 — 어떤 씬에도 재사용.

| 모듈 | 폴더 | 책임 |
|---|---|---|
| Lighting | `engine/lighting/` | SceneLightProbe(CubeCamera+SH), SpaceLightmap(AccumulativeShadows), CustomLights |
| Post-FX | `engine/postfx/` | PostFX (N8AO, GTAO, Bloom, Vignette, DOF, ToneMapping) |
| Path tracer | `engine/pathtracer/` | PathtracerRenderer (three-gpu-pathtracer) |
| Mesh utils | `engine/mesh/` | MeshGenerator (polygon → BufferGeometry, extrude) |
| Stores | `engine/stores/` | lightingStore, viewStore, customLightStore |

### ④ Domain  (`src/domain/`)
공간/벽/노드/제품/카메라 — 도메인 모델 + 도메인 상태.

| 모듈 | 폴더 | 책임 |
|---|---|---|
| Structures | `domain/structures/` | Node, Wall, Space, ObjectBase |
| Layout | `domain/layout/` | Floor, Ceiling, Level, CeilingFloorBase, SpaceBuilder, SpaceManager, LayoutSplitWallsResolver |
| Products | `domain/products/` | ProductInfo, ProductTypes, ProductWallFilled |
| Camera | `domain/camera/` | CameraTypes, CameraPreset, CameraFov, CaptureResolution |
| State | `domain/state/` | layoutStore (`Node[]`, `Wall[]`, `Space[]`의 zustand 컬렉션) |

### ⑤ Lib  (`src/lib/`)
순수 함수만 — 의존성 0 (three는 허용, react는 금지).

| 모듈 | 폴더 | 책임 |
|---|---|---|
| Math | `lib/math/` | Math, Geometry, Triangulator, QuadTree, VectorExtensions, LineSegmentIntersection |
| Constants | `lib/constants/` | EPSILON, DEFAULT_HEIGHT 등 |

### 어댑터들

| 모듈 | 폴더 | 책임 |
|---|---|---|
| Host | `src/host/` | HostBridge, HostContext, HostEvents, HostCommands — 외부(Unity, web shell)와의 이벤트/명령 bridge |
| Networking | `src/networking/` | SnapitClient, RenderPlanBuilder — Snapit 렌더링 백엔드 |
| Persistence | `src/persistence/` | PlanSaveData — Plan 직렬화/역직렬화 |
| Input | `src/input/` | InputManager — pointer/keyboard 추상화 |
| Tasks | `src/tasks/` | TaskBase, TaskUnit, SubTaskUnit, TaskSwitcher — workflow 상태머신 |

## 공공 API (각 폴더 `index.ts`)

```ts
// engine/index.ts
export { PostFX } from './postfx/PostFX';
export { SceneLightProbe } from './lighting/SceneLightProbe';
export { SpaceLightmap } from './lighting/SpaceLightmap';
export { CustomLights } from './lighting/CustomLights';
export { PathtracerRenderer } from './pathtracer/PathtracerRenderer';
export { useLightingStore } from './stores/lightingStore';
export { useViewStore } from './stores/viewStore';
export { useCustomLightStore } from './stores/customLightStore';

// features/index.ts
export { PlanScene } from './scene/PlanScene';
export { WallDrawingTool } from './drawing/WallDrawingTool';
export { EditTool } from './editing/EditTool';
export { EditOverlay } from './editing/EditOverlay';
export { UndoRedoManager } from './undoredo/UndoRedoManager';

// domain/index.ts
export * from './structures';
export * from './layout';
export * from './products';
export * from './camera';
export { useLayoutStore } from './state/layoutStore';

// lib/index.ts
export * from './math';
export * from './constants';
```

## 다른 프로젝트에서 재사용

### 시나리오 A: 엔진만 떼어쓰기 (다른 씬에 lighting + post-fx 적용)
```ts
import { PostFX, SceneLightProbe, useLightingStore } from 'homeplanner3-web/engine';
// LightingPanel UI는 ui/에서 별도 import
```

### 시나리오 B: 도메인 + 엔진을 *별도 React 호스트*에 마운트
```tsx
import { Canvas } from '@react-three/fiber';
import App from 'homeplanner3-web';   // 전체 App을 외부에서 호스팅
<App handlers={...} showLightingPanel={false} />
```

### 시나리오 C: 도메인만 사용 (서버사이드 계산 등)
```ts
import { SpaceBuilder, Node, Wall } from 'homeplanner3-web/domain';
// Engine/UI 미참조 — three.js 의존성만 따라옴
```

## 의존성 그래프 위반 검출

```bash
# 향후 madge 추가 권장
npx madge --circular src/
npx madge --orphans src/
```

## 변경 이력

- **v0.1 (2026-06-01)**: 초기 4-레이어 분류 + 모듈화 (commit `82a464e` 직후).