import { Vector3 } from 'three';
import { Wall } from '@/domain/structures/Wall';
import { ProductInfo } from '@/domain/products/ProductInfo';
import { ProductWallFilled } from '@/domain/products/ProductWallFilled';
import { FilledType, OpenDir, type PlaceProductParam } from '@/domain/products/ProductTypes';
import { EPSILON } from '@/lib/math/Math';

/**
 * 벽체 제품(문/창호)의 복원용 스냅샷.
 *
 * Unity `UndoRedo.Commands.ProductWallFilledSnapshot` (DrawWallCommand.cs:371) 1:1 포팅.
 *
 * 모든 상태를 *순수 값*으로 보관해 ProductWallFilled가 destroy/recreate되어도 정확히 복원
 * 가능하도록 한다. 이름·타입·위치·회전·열림방향·크기·카탈로그 마스터 정보를 모두 캡처한다.
 */
export class ProductWallFilledSnapshot {
  private readonly _type: FilledType;
  private readonly _worldPosition: Vector3;
  private readonly _worldRotationEuler: Vector3;
  private readonly _openDir: OpenDir;
  private readonly _contentsMaster: PlaceProductParam;
  private readonly _currentSize: Vector3;

  /**
   * 현재 ProductWallFilled로부터 스냅샷을 만든다.
   * @throws contentsMaster가 비어있으면 예외 (배치된 적 없는 제품).
   */
  constructor(filled: ProductWallFilled) {
    if (!filled.productInfo.contentsMaster) {
      throw new Error('ProductWallFilledSnapshot: filled has no contentsMaster');
    }
    this._type = filled.type;
    this._worldPosition = filled.position.clone();
    this._worldRotationEuler = filled.rotationEuler.clone();
    this._openDir = filled.openDir;
    this._contentsMaster = { ...filled.productInfo.contentsMaster };
    this._currentSize = filled.currentSize.clone();
  }

  /**
   * 스냅샷 데이터로 새 ProductWallFilled를 생성하여 대상 벽에 삽입한다.
   *
   * Unity 원본은 `Resources.Load(_contentsMaster.assetURL)`로 prefab을 가져와 인스턴스화하지만,
   * 본 포팅에서는 assetURL을 GLB 자산 키로 그대로 저장만 한다 — 실제 시각화는 r3f의
   * `<ProductView>`가 useGLTF로 처리한다.
   *
   * @returns 복원된 ProductWallFilled (실패 시 null)
   */
  restore(parentWall: Wall): ProductWallFilled | null {
    const productInfo = new ProductInfo();
    productInfo.setInfo(this._contentsMaster);

    const product = ProductWallFilled.create(productInfo);

    // Init()이 기본 크기로 초기화한 후, 스냅샷 크기가 다르면 재조정
    if (!product.currentSize.equals(this._currentSize)) {
      product.resize(this._currentSize);
    }

    product.position.copy(this._worldPosition);
    product.rotationEuler.copy(this._worldRotationEuler);

    parentWall.insert(product);

    if (this._type === FilledType.DOOR) {
      product.openDir = this._openDir;
    }
    return product;
  }

  /**
   * 지정된 벽에서 본 스냅샷과 일치하는 ProductWallFilled를 찾는다.
   * 월드 좌표(EPSILON 이내) + 타입으로 매칭.
   */
  findInWall(wall: Wall | undefined): ProductWallFilled | undefined {
    if (!wall) return undefined;
    const eps2 = EPSILON * EPSILON;
    return wall.filledObjects.find(
      (f) =>
        f.position.distanceToSquared(this._worldPosition) < eps2 && f.type === this._type,
    );
  }
}