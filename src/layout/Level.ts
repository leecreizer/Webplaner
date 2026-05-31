import { ObjectBase } from '../structures/ObjectBase';
import type { Space } from '../structures/Space';

/**
 * 층 오브젝트 — 여러 공간을 포함하는 층 단위.
 *
 * Unity `Layout.Level`은 사실상 빈 클래스이며(Create() == null), 다층 구조를 위한 자리만
 * 잡아둔 상태다. 본 포팅도 동일한 스텁만 유지하며, 다층 구조 도입 시 확장한다.
 */
export class Level extends ObjectBase {
  /** 이 층에 포함된 공간 목록. */
  spaces: Space[] = [];

  /** 층 식별 문자열 (예: "1F"). */
  level: string = '';

  /** 생성자는 {@link create}를 통해서만 호출. @internal */
  private constructor() {
    super();
  }

  /**
   * 새 층을 생성한다.
   * Unity 원본은 null 반환 (미구현). 본 포팅에서는 빈 인스턴스를 반환한다.
   */
  static create(): Level {
    return new Level();
  }

  /**
   * 지정된 층을 삭제한다. 본 포팅에서는 단순 cleanup (Unity의 Destroy는 r3f 컴포넌트 unmount로 대체).
   */
  static delete(_level: Level): void {
    // r3f가 컴포넌트 unmount 시 GameObject 자원 정리를 자동 수행
  }
}