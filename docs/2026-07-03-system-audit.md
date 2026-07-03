# HomePlanner3-web 시스템 감사 보고서

- **감사일**: 2026-07-03 (v0.1.33 기준)
- **대상**: React 19 + R3F 9 + three 0.185 웹플래너

## 1. 오류/버그 위험

**[상] LoadPlanCommand._loadPlan이 벽/노드/공간 복원을 하지 않는 빈 스텁**
`src/features/undoredo/commands/LoadPlanCommand.ts:63-72` — `Nodes/Walls/Spaces` 반영 코드 없음(TODO만). `spaceModules`만 복원됨. **저장된 plan을 로드하면 그린 벽이 사라진 채 열림** — 실사용 시 "저장했는데 사라졌다" CS 직결. undo/redo도 동일 스텁이라 무의미.

**[상] 개구부 컷 BoxGeometry dispose 누락 — GPU 메모리 누수**
`src/features/spaceModules/syncModuleWalls.ts:78-83`에서 sync마다 `new BoxGeometry` 등록, 이전 op은 `removeOperation`으로 제거하지만 `editStore.removeOperation`에 `boxGeometry.dispose()`가 없음. **개구부 있는 모듈을 드래그할 때마다(50ms 디바운스 반복) GPU geometry 누수 누적.**

**[중] OpeningMarkers 80ms 하드코딩 딜레이 — 레이스 컨디션**
`OpeningMarkers.tsx:9-15` — sync(50ms debounce)와 마커 리렌더(80ms 타이머)가 독립 타이머로 동기화. 느린 기기/복잡한 씬에서 마커가 구버전 표시 가능. `lastCompiled`를 구독 가능한 store/신호로 교체가 근본 해법.

**[중] 전역 `_openingOpIds` 모듈 스코프 mutable — 재진입/HMR 취약** (`syncModuleWalls.ts:23`)

**[하] ShadowDemand 등 store 전체 subscribe 패턴** — dirty flag로 실피해 적음.

## 2. 성능

**[상] WallView가 editStore.operations 전체 배열 구독 → 벽 1개 변경에 전체 벽 CSG 재평가**
`WallView.tsx:46-50` — operations가 새 참조가 될 때마다 모든 WallView 리렌더 + geometry useMemo(three-bvh-csg Evaluator) 재실행. 모듈 드래그 중 50ms마다 컷 op 재등록되므로 **드래그 동안 모든 벽 CSG 전량 반복 재평가** — 벽 많은 도면의 프레임 드랍 유력 원인.
→ 벽별 파생 selector(`operationsByWall`) 또는 useShallow로 참조 안정화.

**[중] syncModuleWalls: 모듈발 벽 전체 delete→재생성→buildSpaces 매번 수행** — 모듈 다수 시 비용 배가. 변경분 diff 처리 검토.

**[상] 프로덕션 번들 단일 청크 2.37MB (+ 9.3MB sourcemap)**
`vite.config.ts`에 manualChunks 없음. three/r3f/drei/csg/pathtracer 일괄 로드. 분리 후보: Pathtracer, LightProbe 계열(React.lazy), `manualChunks: { three: ['three'] }`. sourcemap 배포 제외 권장.

**[하·양호] useFrame들은 ref 재사용/in-place 갱신으로 GC 압박 낮게 잘 작성됨. ShadowDemand demand 렌더링도 긍정적.**

## 3. 운영/관리

**[중] PlanSaveData 저장 범위 밖 상태 (세션 간 유실)**
- 조명 설정(lightingStore/customLightStore)
- 임포트한 3D 모델(importedModelStore)
- EditTool 자유형 벽 CSG 컷(editStore.operations) — WallSnapshot에도 TODO로 미복원
→ "현재 저장되지 않는 편집 상태" 목록으로 운영 공유 필요.

**[중] 콘솔 로그 12건 프로덕션 노출** — IrradianceProbeGrid/SceneLightProbe/PathtracerRenderer/ProductPlacement/ProductView. `esbuild.drop: ['console']` 미설정.

**[중] 최상위 ErrorBoundary 부재** — ModelErrorBoundary는 GLTF 국소 처리뿐. CSG Evaluator throw 등으로 흰 화면 가능. Canvas 상단 폴백 UI 권장.

**[하] TODO(port) 49건** — 대부분 문서화된 관리형 부채. 단 LoadPlanCommand·WallSnapshot filledObjects 2건은 체감 버그로 우선순위 상이.

## 4. 아키텍처 부채

**[중] NumberField/NumberRow 5개 인스펙터 중복** — BuiltinLight/Light/Mesh/Model/SpaceModule 인스펙터에 유사 구현 복붙. NaN 가드 로직 미세 차이. `src/ui/common/NumberField.tsx` 공통화 필요.

**[중] 모듈발 벽 Symbol 태깅 구조** — Wall이 태그를 모르는 상태에서 산재된 `isModuleWall()` 체크에 의존. 장기적으로 `Wall.source: 'user'|'module'` 정식 필드가 안전.

**[하] HostBridge는 postMessage가 아닌 직접 호출 방식** — 계약 취약성 낮음. 다만 다수 메서드 TODO(카메라 FOV/스크린샷 등).

## 최우선 조치 Top 10

1. **[상][버그]** LoadPlanCommand 실제 구현 — Nodes/Walls/Spaces 복원 (불러오기 정상화)
2. **[상][누수]** editStore.removeOperation에 boxGeometry.dispose() 추가
3. **[상][성능]** WallView operations 구독을 벽별 selector로 — 전체 CSG 재평가 해소
4. **[상][번들]** manualChunks + Pathtracer/LightProbe lazy 분리, sourcemap 배포 제외
5. **[중][운영]** 저장 안 되는 상태(조명/임포트모델/CSG컷) 정의·반영 또는 UI 명시
6. **[중][버그]** OpeningMarkers 80ms 타이머 → lastCompiled 직접 구독으로 교체
7. **[중][아키텍처]** NumberField 공통 컴포넌트화 (5곳)
8. **[중][운영]** 프로덕션 console.log 제거 (esbuild.drop)
9. **[중][운영]** App 최상단 ErrorBoundary 추가
10. **[중][성능]** syncModuleWalls 전체 재생성 → 변경분 diff 처리 검토