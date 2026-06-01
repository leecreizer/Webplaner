import { Vector3 } from 'three';
import type { ICommand } from '../ICommand';
import type { ProductInfo } from '@/domain/products/ProductInfo';
import type { Space } from '@/domain/structures/Space';

/**
 * 상품 배치/삭제 통합 커맨드.
 *
 * Unity `PlaceProductCommand` 1:1 포팅.
 *
 * - `isPlace = true`: 배치 확정 직후 `pushCommand`. Undo→비활성화(공간 해제), Redo→재활성화
 * - `isPlace = false`: 삭제 시 `executeCommand`. Execute→비활성화, Undo→재활성화
 *
 * 본 포팅에서 "비활성화"는 `product.space = null`로 모든 공간에서 해제하는 것을 의미한다.
 * Unity의 `gameObject.SetActive(false)`는 r3f에서 자동 — products는 `space.allProducts`에만
 * 등록될 때 렌더링되므로, space에서 빠지면 자동으로 화면에서 사라진다.
 */
export class PlaceProductCommand implements ICommand {
  private readonly _productInfo: ProductInfo;
  private readonly _position: Vector3;
  private readonly _rotationEuler: Vector3;
  private readonly _space: Space | null;
  private readonly _isPlace: boolean;

  constructor(productInfo: ProductInfo, isPlace: boolean = true) {
    this._productInfo = productInfo;
    this._position = productInfo.position.clone();
    this._rotationEuler = productInfo.rotationEuler.clone();
    this._space = productInfo.space;
    this._isPlace = isPlace;
  }

  execute(): void {
    // 배치 모드는 이미 배치 완료된 상태에서 호출됨 — no-op. 삭제 모드는 즉시 비활성화.
    if (!this._isPlace) this._deactivate();
  }

  undo(): void {
    if (this._isPlace) this._deactivate();
    else this._activate();
  }

  redo(): void {
    if (this._isPlace) this._activate();
    else this._deactivate();
  }

  /** 상품을 캡처된 위치/회전/공간으로 복원하고 화면에 다시 등장. */
  private _activate(): void {
    this._productInfo.position.copy(this._position);
    this._productInfo.rotationEuler.copy(this._rotationEuler);
    this._productInfo.space = this._space;
  }

  /** 상품을 공간에서 해제 — `allProducts`에서 사라지므로 화면에서도 자동 제거. */
  private _deactivate(): void {
    this._productInfo.space = null;
  }
}