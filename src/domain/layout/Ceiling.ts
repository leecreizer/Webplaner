import { Vector2, Vector3 } from 'three';
import { CeilingFloorBase } from './CeilingFloorBase';
import { Space } from '@/domain/structures/Space';

/**
 * 천장 오브젝트. 공간의 천장면을 책임진다.
 *
 * Unity `Layout.Ceiling` 1:1 포팅. Floor와 달리 thickness를 위치에 반영하지 않으며,
 * 메시 생성 시 reverse 플래그를 thickness ≤ 0 조건으로 자동 결정한다.
 */
export class Ceiling extends CeilingFloorBase {
  constructor(space: Space) {
    super(space);
    // Unity 원본 Start()에서 Height = Space.DEFAULT_CEILING_HEIGHT 설정
    this.height = Space.DEFAULT_CEILING_HEIGHT;
  }

  /**
   * Ceiling은 thickness를 위치에 반영하지 않는다 (천정은 위에 매달리므로).
   * Unity 원본 `Ceiling.ResetPosition()`.
   */
  protected override resetPosition(): void {
    this.localPosition.set(0, this._height, 0);
  }

  /**
   * 천정은 thickness ≤ 0 (단순 평면)일 때 삼각형 winding을 반전한다.
   * Unity 원본 `Ceiling.GeneratePolyToMesh`.
   */
  protected override generatePolyToMesh(
    points: Vector2[],
    origin: Vector3,
    forward: Vector3,
    thickness: number,
    _reverse: boolean = false,
  ): null {
    return super.generatePolyToMesh(points, origin, forward, thickness, thickness <= 0);
  }
}