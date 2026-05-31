import { CeilingFloorBase } from './CeilingFloorBase';
import { Space } from '../structures/Space';

/**
 * 바닥 오브젝트. 공간의 바닥면을 책임진다.
 *
 * Unity `Layout.Floor` 1:1 포팅. 메시 생성은 r3f 컴포넌트가 본 데이터를 구독해 처리한다.
 */
export class Floor extends CeilingFloorBase {
  constructor(space: Space) {
    super(space);
    // Unity 원본 Start()에서 Height = Space.DEFAULT_FLOOR_HEIGHT 설정
    this.height = Space.DEFAULT_FLOOR_HEIGHT;
  }

  /**
   * Dirty 갱신 시 소속 공간의 중심점/면적도 재계산.
   * Unity 원본 `Floor.DirtyUpdate`.
   */
  override dirtyUpdate(): void {
    super.dirtyUpdate();
    this.space.updateCenter();
    this.space.updateArea();
  }
}