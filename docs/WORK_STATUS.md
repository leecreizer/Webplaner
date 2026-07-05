# 작업 현황 인수인계 (2026-07-03)

집/다른 PC에서 이어서 작업하기 위한 문서. 최신 상태는 git log와 `docs/` 문서들이 기준.

## 저장소 & 배포

| 항목 | 값 |
|------|-----|
| 웹플래너 repo | https://github.com/leecreizer/Webplaner (이 저장소) |
| 어드민 repo | https://github.com/leecreizer/HP3_admin |
| 작업 브랜치 | `feat/three-upgrade-ssgi` (main과 동기 유지 중 — 푸시 시 둘 다) |
| 현재 버전 | v0.1.33 |
| 배포 | GitHub Pages **gh-pages 브랜치 방식** — main/feat 푸시 시 `.github/workflows/deploy.yml`이 dist를 gh-pages로 강제 푸시 (actions/deploy-pages는 반복 실패해 폐기) |
| 라이브 | https://leecreizer.github.io/Webplaner/ · 어드민 https://leecreizer.github.io/HP3_admin/ (설계 메뉴에서 iframe 임베드) |

## 로컬 개발 환경

```bash
# 웹플래너 (포트 5190 고정 — vite.config.ts)
cd homeplanner3-web && npm i && npm run dev

# 어드민 (포트 5180 고정)
cd HP3_admin && npm i && npm run dev
# 어드민 설계 메뉴가 host:5190 을 iframe으로 로드 (localStorage 'hp3-webplaner-url' 이 우선하니
# 다른 주소가 뜨면 ?planer=http://localhost:5190/ 로 접속해 갱신)

# 검증 3종 (커밋 전 필수)
npx vitest run && npx tsc --noEmit && npx vite build
```

⚠ **Git Bash에서 `vite build --base=/Webplaner/` 금지** — MSYS 경로 변환이 base를
`C:/Program Files/...`로 바꿔치기함. base 빌드는 PowerShell에서 하거나 CI에 맡길 것.

⚠ 커밋 규칙: 커밋마다 package.json 버전 0.0.1 증가 + 커밋 메시지에 (vX.Y.Z) 표기.

## 이번 스프린트에서 개발된 것 (v0.1.8 → v0.1.33)

### 1. 스택 업그레이드 안정화 (v0.1.8~0.1.17)
- three 0.185 / fiber 9 / drei 10 / React 19. SSGI(realism-effects)는 영구 사용 불가 →
  GI 4모드(hemisphere/probe/probe-grid 2-bounce/path-tracer)로 대체
- React19 StrictMode 재질편집 버그(cloneSkeleton), dispose 누수, PCSS 소프트섀도,
  섀도맵 demand 렌더링, 배치 성능(geometry clone 조건부화·셰이더 선컴파일·텍스처 프리워밍)
- Draco 압축 GLB 디코드: `useGLTF(url, BASE_URL+'draco/')`, 디코더는 `public/draco/`

### 2. 공간 모듈 시스템 (v0.1.18~) — 핵심 신기능
평면을 벽 그리기 대신 **방 모듈 조립**으로 구성. 스펙/플랜:
- `docs/superpowers/specs/2026-07-03-space-modules-design.md`
- `docs/superpowers/plans/2026-07-03-space-modules.md`

구조 (전부 `src/features/spaceModules/`):
- `spaceModuleStore.ts` — 모듈(SpaceModule)+개구부(ModuleOpening: door/opening/window, sill)
  + pendingKind/pendingOpeningType/movingOpening + `transformModule`(내부 상품 동반 이동·회전)
- `compileModules.ts` — 순수 컴파일러: 공유벽 병합/분할(축정렬끼리), 개구부 승계/충돌,
  자유각 회전(대각 변은 단독 벽). `moduleEdges(m)` 공용
- `syncModuleWalls.ts` — 모듈 → 기존 layoutStore Wall 실시간 동기화(50ms debounce).
  모듈발 벽은 Symbol 태그(`isModuleWall`). 개구부는 editStore CSG cut으로 **벽에 실제 구멍**
- `ModulePlacement.tsx` — 배치/드래그(2D 전용)/스냅/회전(↻ 드래그 자유회전, 5°/45°/90° 스냅)/
  개구부 부착(캔버스 캡처 레이캐스트 — 벽 stopPropagation 우회)/재배치(표식 클릭)
- `OpeningMarkers.tsx` — 문(갈색)/개구부(하늘)/창호(유리+창틀, sill) 표식
- UI: `src/ui/ModulePalette.tsx`, `SpaceModuleInspector.tsx`, `OpeningConflictDialog.tsx`
- 직렬화: PlanSaveData.spaceModules (모듈발 벽은 저장 제외)

### 3. 기본 모델링 메뉴 (구 "기본 도형")
- 툴바 드롭다운: 벽 부착(도어/창호/개구부 — 모듈 벽 클릭 설계) + 기본 도형
- 벽에서 떨어진 곳 클릭 = 독립 모델(ImportedModel primitive: door/window/openingFrame)
- 모델 scale 축별 [x,y,z] — 크기 기즈모 3축 핸들

### 4. UX 정책 (확정)
- 모듈 이동·회전은 **2D(탑뷰) 전용**, 3D는 선택/개구부 배치/편집만
- 그라운드(기본 plane) 클릭: 다른 선택 있으면 전체 해제, 없으면 바닥 선택(재클릭=해제)
- 벽 선택 해제는 상품과 동일(빈공간/타객체 클릭), 벽 삭제 버튼 제거(Del 키)

### 5. FBX→GLB 압축 파이프라인 (HP3_admin 쪽)
`HP3_admin/src/data/fbxConvert.ts`: 정점용접(mergeVertices) + 텍스처 WebP + Draco.
실측 21.93MB → **1.50MB (93%↓)**. 변환 로그 localStorage 영속. 어드민 미리보기(AssetViewer)에도
DRACOLoader 연결됨. 분리형 GLTF(.gltf+bin)는 미리보기 불가(안내 표시).

## 알려진 이슈 / 다음 작업 (우선순위)

상세: `docs/2026-07-03-system-audit.md` (웹) · HP3_admin `docs/2026-07-03-system-audit.md`

1. **LoadPlanCommand가 그린 벽 복원 안 함** (빈 스텁) — 불러오기 기능 결함, 최우선
2. editStore.removeOperation에 boxGeometry.dispose() 누락 — GPU 누수
3. WallView가 editStore.operations 전체 구독 — 벽 1개 변경에 전체 CSG 재평가 (드래그 프레임 드랍)
4. 번들 2.37MB 단일 청크 — manualChunks + Pathtracer/Probe lazy 분리
5. 조명/임포트모델/CSG컷 저장 안 됨 — PlanSaveData 확장 or UI 명시
6. OpeningMarkers 80ms 타이머 → lastCompiled 직접 구독으로
7. (어드민) 스키마 버전 불일치 시 데이터 폐기 / postMessage origin 미검증 / 백엔드 부재

## 테스트

- `npx vitest run` — 38개 (spaceModules 단위 테스트 중심: compile/snap/serialization/sync)
- SDD 진행 원장: `.superpowers/sdd/progress.md` (Task 1~9 완료 기록)
