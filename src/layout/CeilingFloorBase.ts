import { Vector2, Vector3 } from 'three';
import { ObjectBase } from '../structures/ObjectBase';
import type { Space } from '../structures/Space';

/**
 * 바닥/천정 메시 공통 베이스 클래스.
 *
 * Unity `Layout.CeilingFloorBase` 1:1 포팅. 소속 Space의 외곽 꼭짓점을 받아 폴리곤 메시를
 * 생성하고, height/thickness 변경 시 위치를 갱신한다.
 *
 * ### 포팅 상태
 * - **완료**: height/thickness 프로퍼티 + resetPosition + dirtyUpdate 시그니처
 * - **TODO**: `generatePolyToMesh` — Three.js BufferGeometry 빌더로 대체 (Drawing/MeshGenerator
 *   포팅 후). 본 클래스는 *데이터*만 들고 있고, 실제 메시 생성은 r3f 컴포넌트가 책임진다.
 */
export abstract class CeilingFloorBase extends ObjectBase {
  /** 소속 Space. */
  readonly space: Space;

  /** 바닥/천정의 현재 높이(m). */
  protected _height: number = 0;

  /** 바닥/천정의 돌출 높이(m). 음수 입력은 무시된다. */
  protected _thickness: number = 0;

  /**
   * 현재 위치(로컬). Unity의 `transform.localPosition` 대체.
   * r3f 컴포넌트가 본 값을 group의 position prop으로 바인딩한다.
   */
  localPosition: Vector3 = new Vector3();

  constructor(space: Space) {
    super();
    this.space = space;
  }

  /** 바닥/천정의 높이를 가져오거나 설정한다. 변경 시 위치를 갱신. */
  get height(): number {
    return this._height;
  }

  set height(value: number) {
    this._height = value;
    this.resetPosition();
  }

  /** 바닥/천정의 돌출 높이. 음수 또는 동일 값은 무시. */
  get thickness(): number {
    return this._thickness;
  }

  set thickness(value: number) {
    if (value < 0 || this._thickness === value) return;
    this._thickness = value;
    this.resetPosition();
    this.setDirty();
  }

  /**
   * Dirty 상태일 때 호출 — 본 클래스에서는 데이터 갱신만 하고, 실제 메시 재생성은 r3f 컴포넌트가 책임.
   * Unity 원본 `DirtyUpdate`는 `MeshFilter.mesh = generatePolyToMesh(points)`로 직접 메시 갱신.
   */
  override dirtyUpdate(): void {
    // r3f 컴포넌트가 space.cornerPoints / thickness 변화를 감지해 BufferGeometry를 다시 빌드한다.
    // 따라서 본 메서드는 Dirty 플래그만 해제하고 끝.
    super.dirtyUpdate();
  }

  /**
   * 변경된 배치 높이와 두께에 맞춰 로컬 위치를 재조정한다.
   * Unity 원본: `transform.localPosition = transform.up * (_height + _thickness)`.
   *
   * `Ceiling`은 본 메서드를 오버라이드해 `_thickness`를 더하지 않는다.
   */
  protected resetPosition(): void {
    this.localPosition.set(0, this._height + this._thickness, 0);
  }

  /**
   * 폴리곤 점 → 메시 변환 (현재 TODO 상태).
   *
   * Unity 원본: `MeshGenerator.GeneratePolyToMesh(points, origin, forward, thickness, reverse)`.
   * Three.js에서는 `BufferGeometry` + `Triangulator`(이미 포팅됨) + `ShapeGeometry`로 대체할 예정.
   *
   * @returns null. r3f 컴포넌트가 본 데이터를 구독해 직접 BufferGeometry를 빌드한다.
   */
  protected generatePolyToMesh(
    _points: Vector2[],
    _origin: Vector3,
    _forward: Vector3,
    _thickness: number,
    _reverse: boolean = false,
  ): null {
    // TODO(port): Drawing/MeshGenerator 포팅 후 BufferGeometry 반환.
    return null;
  }
}