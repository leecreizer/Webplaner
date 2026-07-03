# 공간 모듈 시스템 설계 (Space Modules)

2026-07-03 · 브랜치 feat/three-upgrade-ssgi 기준

## 목표

전체 도면을 벽으로 그리는 기존 방식과 별개로, **공간(방) 모듈을 배치하고 서로 붙여서
전체 평면을 조립**하는 방식을 추가한다. 두 방식은 같은 도면에서 혼용 가능하다.

## 설계 원칙 (최우선 제약)

**기존 구조 무변경 확장.** 모듈 시스템은 기존 파이프라인 위의 새 레이어다.
기존 코드를 건드리는 지점은 아래 3곳뿐이며, 그 외 Wall/Space/SpaceBuilder/
상품배치/렌더/GI 코드는 수정하지 않는다:

1. **컴파일 진입점 1곳** — SpaceBuilder 에 넘기는 벽 목록에 `그린 벽 + 모듈 컴파일 벽`을
   합쳐 전달하는 지점 (기존 호출부에 배열 concat 1줄 수준)
2. **persistence** — 저장 스키마에 `spaceModules` 배열 필드 추가 (기존 필드 무변경)
3. **UI 패널 추가** — 모듈 팔레트/인스펙터 2개 신규 (기존 패널 무수정)

모듈이 원본(source of truth), Node/Wall/Space 는 파생 렌더 모델이다.

## 확정된 요구사항 (Q&A 결과)

- **모듈 단위**: 파라메트릭 사각 방(용도+폭×깊이)으로 시작, 자유형/관리자 프리셋은
  후속 확장 (데이터 모델은 확장 가능하게)
- **연결 방식**: 벽면 스냅(맞벽). 자유 배치 허용 — 붙일 때만 스냅 개입
- **개구부 승계**: 문/개구부 있는 벽 + 빈 벽 → 공유벽에 자동 적용.
  양쪽 모두 있고 구간이 겹치면 → 사용자가 어느 쪽을 살릴지 선택
- **이동 모델**: 모듈은 끝까지 독립 객체. 그룹핑/합체 없음. "연결"은 맞닿아 있는
  상태 그 자체 — 드래그로 떼면 자연 분리(벽·개구부 원상복구)
- **벽 편집**: 벽 드래그는 그 모듈만 변경. 공유벽 연동 리사이즈는 만들지 않음
- **파이프라인**: 모듈 → Node/Wall 실시간 컴파일(A안). bake 없음
- **MVP 범위**: 팔레트·배치 / 치수 편집 / 스냅·공유벽·개구부 승계·충돌선택 /
  개구부 직접 편집 / 자유 그리기 혼용 / 저장·불러오기 — 전부 포함

## 1. 데이터 모델 — `src/features/spaceModules/spaceModuleStore.ts` (신규)

```ts
interface SpaceModule {
  id: string;
  kind: 'bedroom'|'living'|'kitchen'|'bath'|'entrance'|'corridor'|'custom';
  name: string;              // "침실1" — kind 별 자동 넘버링
  x: number; z: number;      // 중심 위치(m)
  ry: 0|90|180|270;          // 회전 — 축 정렬 유지 (스냅/공유벽 판정 AABB 단순화)
  w: number; d: number;      // 폭×깊이(m, 내벽 기준)
  wallH: number;             // 벽 높이(m), 기본 2.4
  openings: ModuleOpening[];
}

interface ModuleOpening {
  id: string;
  side: 'N'|'E'|'S'|'W';     // 모듈 로컬 벽면
  type: 'door'|'opening';    // 문 | 개구부(통로)
  offset: number;            // 해당 벽 시작점→중심 거리(m)
  width: number; height: number;
  /** 개구부 충돌에서 진 쪽 비활성 표시. 모듈 분리 시 자동 해제. */
  suppressedBy?: string;     // 이긴 opening id
}
```

zustand store: `modules[]`, `selectedId`, add/remove/update/select 액션.
kind 별 기본 치수 프리셋(침실 3.6×3.0, 욕실 2.4×1.8 등)은 상수 테이블.

## 2. 컴파일러 — `src/features/spaceModules/compileModules.ts` (신규, 순수 함수)

`compileModules(modules): { nodes, walls }` — 배치 변경 시(debounce ~50ms) 재실행.

1. 각 모듈 4변 → 벽 선분 후보 (두께/높이 포함)
2. **공유벽 병합**: 동일선상(법선 거리 < ε=1mm) + 구간 겹침인 선분 쌍을 찾아
   겹침 구간은 1개 벽으로, 벽면 남는 구간은 각자 벽으로 분할
3. **개구부 주입**: 유효(억제 안 된) 개구부를 해당 벽 구간에 기록.
   공유벽에서 양쪽 개구부 구간이 겹치는데 suppressed 지정이 없으면
   `conflicts[]` 로 보고 (UI 가 충돌 다이얼로그 표시)
4. 산출 Node/Wall 에 `sourceModuleId` 태그 — 선택 하이라이트/역추적용
5. 호출부에서 `그린 벽 + 컴파일 벽` concat 후 기존 SpaceBuilder 에 전달 (혼용)

개구부의 실제 3D 표현은 기존 `Wall` 문/창호 삽입 구조(`ProductWallFilled` 계열)를
사용한다 — 신규 렌더 코드 없음.

## 3. 스냅 + 개구부 승계 — `src/features/spaceModules/moduleSnap.ts` (신규)

- 드래그 중 다른 모듈 벽면과 거리 < 0.15m → 면-맞춤 스냅 (상품 computeSnap 패턴 재사용)
- 스냅 확정 시: 컴파일러가 공유벽/개구부를 자동 반영 (별도 복사 없음)
- 개구부 충돌 시: 다이얼로그에서 선택 → 진 쪽 `suppressedBy` 기록
- 분리 시: 맞닿음이 사라지면 컴파일 결과가 자동 원복, `suppressedBy` 는
  상대 모듈과 더 이상 인접하지 않으면 store 액션이 해제

## 4. UI (신규 2개 + 다이얼로그)

- **ModulePalette** (DraggablePanel): kind 버튼 → 바닥 클릭 배치.
  고스트 미리보기는 상품 배치 고스트 패턴 재사용
- **ModuleInspector**: 이름/종류/폭×깊이/회전/벽높이 + 개구부 목록
  (추가·삭제, 변(side)·offset·폭·높이 편집). 4변 중간 핸들 드래그로 치수 조절
- **OpeningConflictDialog**: 충돌 구간 표시 + "1번 것 / 2번 것" 선택

## 5. 직렬화

persistence 스키마에 `spaceModules: SpaceModule[]` 추가. 로드 시 컴파일 1회.
기존 저장 데이터(모듈 없음)는 빈 배열로 로드 — 하위 호환.

## 6. 테스트 (vitest)

컴파일러가 순수 함수이므로 단위 테스트 중심:
- 공유벽 병합/분할 (완전 맞벽, 부분 겹침, T자 인접)
- 개구부 승계 (빈 벽 상대), 충돌 감지 (겹침 구간)
- suppress → 분리 시 복원
- 그린 벽과의 concat 혼용 (기존 SpaceBuilder 스냅샷)

## 구현 순서

1. store + 컴파일러 + 테스트 (UI 없이 검증 완료)
2. 팔레트·배치·이동·스냅
3. 인스펙터·치수 편집
4. 개구부 편집·승계·충돌 다이얼로그
5. 직렬화·하위 호환 확인

## 비범위 (후속)

- 자유형 모듈 템플릿, 관리자 프리셋 라이브러리 (데이터 모델만 확장 가능하게 설계)
- 공유벽 연동 리사이즈, 모듈 그룹 이동
- 45° 등 비축정렬 회전