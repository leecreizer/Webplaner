import { Vector3 } from 'three';
import type { Space } from '../structures/Space';
import { type PlaceProductParam, PlaceType, posStringToPlaceType } from './ProductTypes';

/**
 * 배치된 상품의 런타임 정보.
 *
 * Unity `ProductInfo`(MonoBehaviour) 1:1 포팅. Unity의 transform 위치는 본 클래스의 `position`
 * 필드로 옮겼고, Space 양방향 동기화는 setter로 유지한다.
 *
 * ### 책임
 * - **Space 양방향 동기화**: `space = newSpace` 호출 시 이전 공간의 products에서 자동 제거되고,
 *   새 공간 products에 자동 등록된다.
 * - **카탈로그 정보 보관**: `contentsMaster`(=`PlaceProductParam`)를 들고 있어 렌더링·저장 시 참조.
 *
 * 시각화(메시·콜라이더·MeshWireObject)는 r3f 컴포넌트가 본 데이터를 구독해 처리한다.
 */
export class ProductInfo {
  /** 월드 위치(m). */
  position: Vector3 = new Vector3();
  /** 월드 회전(오일러, 도). */
  rotationEuler: Vector3 = new Vector3();
  /** 현재 크기(m). Unity의 BoxCollider.size 대응. */
  size: Vector3 = new Vector3();

  /** 웹/콘텐츠 마스터에서 내려온 상품 메타데이터. {@link setInfo}로 설정한다. */
  contentsMaster: PlaceProductParam | null = null;

  private _space: Space | null = null;

  /**
   * 이 상품이 배치된 공간. 도면 밖이면 null.
   *
   * setter 호출 시 이전 `space.allProducts`에서 제거되고, 새 `space.allProducts`에 등록된다.
   */
  get space(): Space | null {
    return this._space;
  }

  set space(value: Space | null) {
    if (this._space === value) return;

    if (this._space !== null) {
      const arr = this._space._internalProducts();
      const idx = arr.indexOf(this);
      if (idx >= 0) arr.splice(idx, 1);
    }

    this._space = value;

    if (this._space !== null) {
      const arr = this._space._internalProducts();
      if (!arr.includes(this)) arr.push(this);
    }
  }

  /** 콘텐츠 마스터 정보를 저장한다. */
  setInfo(info: PlaceProductParam): void {
    this.contentsMaster = info;
  }

  /** 상품의 배치 유형 (바닥/벽/천장). 마스터가 비어있으면 null. */
  get placeType(): PlaceType | null {
    if (this.contentsMaster === null) return null;
    return posStringToPlaceType(this.contentsMaster.pos);
  }

  /**
   * 명시적 해제 — 본 ProductInfo를 모든 컬렉션에서 빼낸다 (소속 공간의 products 등).
   * Unity의 `OnDestroy`에서 `Space = null` 호출 대응.
   */
  dispose(): void {
    this.space = null;
  }
}