# Helper 영역 기반 메시 스트레치 (웹 R3F 포팅)

## 배경 / 목표

3ds Max에서 제작된 상품 모델은 `helper` 노드 아래에 `L/R/T/B/F/K` 등의 **박스 메시**를 이미
포함하고 있다. 각 박스가 감싸는 AABB 영역이 "어느 정점을 어느 축으로 늘릴지"를 정의한다.
Unity(`ProductStretchable` + `VertexScaler`)는 이를 읽어 상품을 치수에 맞게 메시 변형한다.

웹(R3F) 포팅에는 이 로직이 **아직 없다**. `ProductView.tsx`는 GLB를 `useGLTF`로 로드해
`scene.clone()` 후 position/rotation만 적용하고, `ProductWallFilled.resize()`도 데이터만 갱신한다.

**이번 작업 목표**: 모델에 이미 존재하는 helper 영역을 읽어 메시를 변형하는 기능을 웹에 신설하고,
우선 **폭(W) → L/R 영역 스트레치**가 실제로 동작하는지 검증한다.

## 설계룰 근거

"홈플래너 3.0 컨텐츠 - 로직 제어 룰 정의"의 **상품 크기 조정** 섹션을 따른다:

1. "어셋 구성 정의"의 `helper`와 같이 상품 크기를 조정할 수 있다.
2. 장 내 구성품(`childContents`, `replaceableW`, `replaceableH` 등)은 어셋 번들에 지정된
   helper의 바운딩 박스에 맞춰 **함께 크기가 조정돼야 한다.**
   - 단, **`replaceable*` 하위의 `childContents`는 사이즈 변경에서 제외.**
   - **`replaceableW`, `replaceableH`는 장 사이즈 변경에 영향을 받지 않는다(고정).**
     그 외 구성품은 장 사이즈에 맞춰 같이 늘어난다.
3. (별도 기능) 구성품 선택적 노출 — `replaceableW/H`에 사이즈별 구성품 모델링을 자식으로
   미리 넣어두고 현재 사이즈 구간에 해당하는 이름의 구성품만 노출. → **이번 스코프 밖.**

## 스코프

- 포함: helper 영역(L/R/T/B/F/K) 수집 인프라 + W(L/R) 실동작 검증
- 포함: 메인 몸통 + 일반 구성품(childContents) 메시를 helper 영역 기준으로 **함께 변형**
- 포함: 변형 제외 처리 — `replaceableW`/`replaceableH` 노드 및 그 하위는 정점 변형 대상에서 제외
- 포함: helper/hotspot/replaceableW/replaceableH 노드 렌더 숨김
- 제외: 구성품 선택적 노출(사이즈 구간별 replaceable 자식 표시/교체) — 별도 작업
- 제외: 폭 조절 UI(슬라이더/입력) — 검증은 하드코딩 W값으로 수행
- 비고: T/B/F/K 영역 수집·축 산출 인프라는 같이 구현하되, 이번 검증 대상은 W만

## 아키텍처

```
GLB 로드(useGLTF) → scene.clone() + 메인 메시 geometry deep clone
  → HelperScaler.build(scene)        // helper 영역 분석 (인스턴스당 1회)
  → HelperScaler.applyResize(W,H,D)  // 정점 이동 (currentSize 변경 시)
  → helper/hotspot/replaceableW 노드 visible=false → <primitive> 렌더
```

## 핵심 모듈: `HelperScaler` (`src/domain/products/HelperScaler.ts`)

THREE에만 의존하는 독립 테스트 가능 클래스. Unity `VertexScaler`의 포팅.

### build(root: THREE.Object3D)

1. `root.traverse`로 다음을 식별:
   - `helper` 노드와 자식 박스 메시(`L/R/T/B/F/K`, 연번 `L1` 등 포함 — Unity INITIAL 규칙)
   - `hotspot` 노드와 자식들
   - **변형 대상 메시(transformable meshes)**: 몸통 메인 메시 + 일반 구성품(childContents) 메시.
     아래는 변형 대상에서 **제외**:
     - `helper` / `hotspot` / wireframe
     - `replaceableW` / `replaceableH` 노드 및 그 **모든 하위**(replaceable 하위 childContents 포함)
2. 각 helper 자식 메시 geometry의 정점을 상품 루트 로컬 좌표로 변환해 AABB(`THREE.Box3`) 산출
   (= Unity `BuildBound`)
3. **모든 변형 대상 메시**의 정점 중 각 Box3 안에 드는 (메시, 정점 인덱스)를 수집 (= Unity `Collect`,
   단 룰에 따라 단일 몸통 메시가 아니라 구성품 메시까지 포함)
4. 축·바깥방향(sign)·분배 산출:
   - 축: helper 자식 이름 머릿글자 → `L/R=x`, `T/B=y`, `F/K=z`
   - 바깥방향 `sign`: 영역 중심이 전체 메시 중심 기준 어느 쪽인지로 판정
     (`sign = Math.sign(regionCenter[axis] - meshCenter[axis])`). **이름규약(L=좌 등)에 의존하지 않음.**
   - 분배 `shareDivisor`: 같은 축에 존재하는 distinct sign 수. 양/음 영역이 모두 있으면 2 →
     절반씩 이동해 중심을 고정한 채 양쪽으로 확장. 한쪽만 있으면 1 → 그쪽이 델타 전부 흡수(반대편 고정).
   - 원본 치수 `origSize`(변형 대상 메시 합산 bounding box size) 저장

> Unity `ResetAxisRatios`의 collider 기반 ratio 공식은 helper 박스 이름과 실제 정점 측면이
> 어긋나는 모델 규약 의존성이 있어 그대로 포팅하지 않고, 위의 데이터 기반(영역 위치) 방식으로 대체함.

### applyResize(target: THREE.Vector3)

- 축별 델타: `deltaW = target.x - origSize.x`, `deltaH = target.y - origSize.y`,
  `deltaD = target.z - origSize.z`
- 각 스케일러: 수집된 (메시, 정점)들을 `sign * (delta_for_axis / shareDivisor)` 만큼 해당 축으로 이동
- 변형된 각 메시의 `geometry.attributes.position` 갱신 + `needsUpdate=true` +
  `computeBoundingBox()/computeBoundingSphere()`
- 같은 영역에 속한 hotspot 자식의 위치도 동일 델타 이동
- `replaceableW`/`replaceableH` 및 그 하위는 정점 수집 대상이 아니므로 자동으로 고정 유지

## 인스턴스 격리 (`ProductView.tsx` 통합)

- `useGLTF`는 URL별 geometry를 캐시·공유한다. 정점을 직접 mutate하면 동일 모델 모든
  인스턴스가 함께 변형되는 버그가 생긴다. → **변형 대상 메시들의 geometry를 각각 deep clone** 후 적용.
- `useMemo`로 인스턴스당 `HelperScaler`를 1회 build, `product.currentSize` 변경 시 applyResize.
- helper/hotspot/replaceableW/replaceableH 노드는 `visible = false`
  (현재 전체 clone 렌더로 박스가 보일 수 있음).

## 검증

### 단위테스트 (`HelperScaler.test.ts`)
코드로 미니 THREE scene 구성: 메인 박스 메시 + `helper` 노드 아래 좌/우 박스(L, R).
`applyResize`로 폭을 늘렸을 때:
- 좌측 영역 정점만 −X, 우측 영역 정점만 +X로 이동
- 중앙 정점은 불변
- 총 폭 변화 = 지정 델타

### 통합 검증
HP_IK00003 로드 후 코드로 강제 W값(예: 원본 × 1.5) 적용 → 좌우 패널만 늘어나고 중앙 유지되는지
시각 확인.

## 실측 발견 (2026-06-29, HP_IK00003.glb 분석)

- FBX에는 `helper`/`hotspot`/`DP`/`replaceableW` + L/R/T/B/F/K가 모두 있으나, **GLB export 시
  메시가 아닌 dummy/그룹 노드가 전부 누락**된다. GLB = 메시 2개(몸통 + 구성품 "900")뿐, 부모 그룹
  노드는 이름까지 사라짐.
- 결정(사용자): helper L/R/T/B/F/K를 **메시 박스로 변환**해 export → "900"처럼 GLB에 살아남음.
- 따라서 웹은 `helper` 부모 노드가 아니라 **메시 이름으로 영역 인식**한다:
  - 영역 메시: `^[LRTBFK]\d*$` (L, R, L1, K2 …) → 축 결정
  - replaceable 구성품: `^\d+$` (900, 1000) → 변형 제외
- GLB raw geometry = mm, z-up, 원점중심. **transform은 node `matrix` 필드**에 있고, matrix 적용한
  **월드 공간 = m, y-up** (x=폭, y=높이, z=깊이)에서 helper가 몸통 가장자리를 정확히 잡는다.
  three.js는 matrix를 적용하므로 월드공간 기준 처리가 정답. (직접 GLB 파싱 시 matrix 적용 필수)
- 초기 helper 누락은 export 한계가 아니라 3ds Max에서 helper를 **숨김 처리**했기 때문 → 숨김 해제 후
  export로 해결됨(메시 박스 그대로 export됨).
- HP_IK00003_2.glb 실측: L 좌측끝/R 우측끝/T 상단/F 앞/K 뒤를 정확히 캡처. 폭 0.9→1.2m 시뮬레이션
  결과 폭 정확·중앙 정점 0개 이동(형태 보존) 확인.

### applyResize 단위/축 처리 (구현 확정)
로컬(mm·z-up)과 월드(m·y-up)가 다르므로 정점 이동은 월드공간에서 수행:
`localToWorld → 월드 축으로 move 가산 → worldToLocal`. origSize·target은 월드 m·y-up 기준.

## 미해결/리스크

- 변형 대상 메시가 단일인지 다중(DP > HD/X, 구성품 childContents 등)인지 모델별로 다름 →
  룰에 따라 helper/hotspot/replaceableW/H 제외한 메시를 모두 변형 대상으로 두고 각각 정점 수집.
- `childContents`가 어떤 노드 이름/규칙으로 GLB에 들어오는지 실제 모델로 확인 필요
  (replaceable 하위 childContents 제외 판정을 위해 노드 계층 기준으로 처리 — replaceable* 서브트리 전체 제외).
- helper 자식이 연번(`L1`, `L2`)으로 여러 개일 때 Unity는 리스트로 누적 — 동일하게 처리.
- GLB export 시 helper 박스에 material이 붙어 보일 수 있음 → visible=false로 차단.
