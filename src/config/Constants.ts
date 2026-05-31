/**
 * 글로벌 환경 상수.
 *
 * Unity `GlobalEnvironments.Constants` 1:1 포팅이지만, 자산 시스템이 다르다:
 *
 * - **Unity**: `Resources.Load<GameObject>("Prefabs/Structures/Wall")` 등으로 prefab을 로드.
 * - **Three.js**: 본 프로젝트는 GLB 자산을 `useGLTF`(drei) / `GLTFLoader`로 로드하며,
 *   `Prefab` 개념은 존재하지 않는다. 본 파일의 PREFAB_PATH_* 상수는 *논리 키*로만 의미를 갖고,
 *   실제 자산 매핑은 `assetURL` (각 `ContentsMasterData`에 포함)에서 직접 가져온다.
 *
 * 따라서 `PREFAB_PATH_*` 상수들은 직접 참조하지 않는 것이 권장되며, Wall/Node/Space의
 * 도메인 인스턴스화 로직은 r3f 컴포넌트 트리(`<WallView>`, `<NodeView>`)가 직접 책임진다.
 * 본 파일은 마이그레이션 추적성/문서화를 위해 보존한다.
 */

/** 에셋 번들 다운로드 base URL. 빈 문자열이면 같은 origin에서 상대 경로로 fetch. */
export const URL_HEADING = '';

/** @deprecated Three.js에서는 r3f 컴포넌트가 직접 책임진다. 추적성 목적으로만 보존. */
export const PREFAB_PATH_SPACE = 'Prefabs/Structures/Space';

/** @deprecated 위와 동일. */
export const PREFAB_PATH_WALL = 'Prefabs/Structures/Wall';

/** @deprecated 위와 동일. */
export const PREFAB_PATH_NODE = 'Prefabs/Structures/Node';

/** @deprecated 위와 동일. */
export const PREFAB_PATH_SPACEROOT = 'Prefabs/Structures/SpaceRoot';

/** @deprecated 위와 동일. */
export const PREFAB_PATH_WALLROOT = 'Prefabs/Structures/WallRoot';

/** @deprecated 위와 동일. */
export const PREFAB_PATH_NODEROOT = 'Prefabs/Structures/NodeRoot';

/** @deprecated 위와 동일. */
export const PREFAB_PATH_CAMERA = 'Prefabs/MainCamera';