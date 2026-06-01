# HomePlanner3 Web

Unity 6.3 `homeplanner3-unity-web` 프로젝트의 Three.js + React 마이그레이션 버전.

원본 Unity 프로젝트는 **수정하지 않으며**, 본 폴더가 신규 코드의 단일 소스입니다.

## 마이그레이션 원칙

1. **자산은 GLB로 직접 export** — FBX→glTF 변환 파이프라인 없음
2. **시각 정확도 1:1 아님** — URP 셰이더는 폐기, glTF PBR 기본값 사용
3. **부모 React 호스트와 props/callback 통신** — `dispatchReactUnityEvent` jslib bridge 제거
4. **Snapit 연동 유지** — `fetch()` 기반 HTTP 호출만 사용 (React 무관)
5. **Coplay 협업 기능 제거** — Unity Editor 전용 플러그인이라 런타임 영향 없음

## 스택

- **Vite 6** + **React 18** + **TypeScript 5 (strict)**
- **react-three-fiber** — Three.js 씬을 React 컴포넌트로
- **@react-three/drei** — OrbitControls, TransformControls, useGLTF, Environment 등
- **zustand** — 평면도 도메인 상태 스토어 (Unity의 static AllNodes/AllWalls 대체)
- **three** — 렌더링 코어

## 아키텍처

상세 레이어 분류 + 모듈별 책임은 [ARCHITECTURE.md](ARCHITECTURE.md) 참고.

```
src/
├── ui/            # 사용자 패널 (Toolbar, LightingPanel)
├── features/      # 인터랙션 (scene, drawing, editing, selection, undoredo)
├── engine/        # Three.js 렌더링 (lighting, postfx, pathtracer, mesh, stores)
├── domain/        # 도메인 모델 (structures, layout, products, camera, state)
├── lib/           # 순수 유틸 (math, constants)
├── host/          # 외부 호스트 bridge
├── networking/    # Snapit 백엔드 client
├── persistence/   # Plan 직렬화
├── input/         # 입력 추상화
├── tasks/         # 워크플로 상태머신
├── App.tsx        # 루트 (Canvas + 레이어 wiring)
└── main.tsx       # 엔트리
```

**의존 방향**: UI → Features → Engine → Domain → Lib. 단방향 강제 (역방향 import 금지).
**공공 API**: 각 레이어의 `index.ts`에서 export — 다른 프로젝트에서 `@/engine`, `@/domain` 등으로 부분만 떼어 사용 가능.

## 개발

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc 검증
npm run build      # 프로덕션 번들
```

## 진행 상태

이 마이그레이션은 단계적으로 진행됩니다. 현재 완료된 부분과 미구현 부분은 `src/` 각 디렉토리 README 또는 본 문서 갱신으로 추적합니다.

### 완료
- [x] 프로젝트 스캐폴드 (Vite/React/TS/r3f)
- [x] 도메인 DTO 전체 (`saveload/PlanSaveData.ts`)
- [x] Math 상수 + Vector 헬퍼
- [x] ObjectBase (Dirty 패턴)
- [x] Node (도메인 데이터 클래스)
- [x] Zustand 상태 스토어 (`structures/state.ts`)
- [x] 빈 r3f 씬 부트

### 진행 예정 (우선순위 순)
1. Wall / Space 전체 로직 (1229 + 709 LOC)
2. Utils/Math (2939 LOC — 기하 알고리즘 다수)
3. MeshGenerator/MeshController (메시 생성)
4. Drawing/GLDrawer (와이어프레임)
5. Camera 컨트롤러
6. Products (ProductWallFilled, ProductStretchable)
7. UndoRedo
8. Tasks (비동기 작업 44 파일)
9. Networking/NanoBanana
10. UI 패널
11. Input/DataManager/Effects/Symbols