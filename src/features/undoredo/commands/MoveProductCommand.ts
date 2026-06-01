import { Vector3 } from 'three';
import type { ICommand } from '../ICommand';
import type { ProductInfo } from '@/domain/products/ProductInfo';
import type { Space } from '@/domain/structures/Space';

/**
 * 상품 이동 커맨드.
 *
 * Unity `MoveProductCommand` 1:1 포팅. 기즈모 드래그 또는 배치 SubTask를 통한 이동 완료
 * 시점에 생성한다. 이미 이동이 끝난 상태에서 호출되므로 `execute()`는 no-op.
 */
export class MoveProductCommand implements ICommand {
  private readonly _productInfo: ProductInfo;
  private readonly _oldPosition: Vector3;
  private readonly _oldRotationEuler: Vector3;
  private readonly _oldSpace: Space | null;
  private readonly _newPosition: Vector3;
  private readonly _newRotationEuler: Vector3;
  private readonly _newSpace: Space | null;

  constructor(
    productInfo: ProductInfo,
    oldPosition: Vector3,
    oldRotationEuler: Vector3,
    oldSpace: Space | null,
  ) {
    this._productInfo = productInfo;
    this._oldPosition = oldPosition.clone();
    this._oldRotationEuler = oldRotationEuler.clone();
    this._oldSpace = oldSpace;
    this._newPosition = productInfo.position.clone();
    this._newRotationEuler = productInfo.rotationEuler.clone();
    this._newSpace = productInfo.space;
  }

  execute(): void {
    // 이미 이동된 상태에서 생성되므로 no-op
  }

  undo(): void {
    this._productInfo.position.copy(this._oldPosition);
    this._productInfo.rotationEuler.copy(this._oldRotationEuler);
    this._productInfo.space = this._oldSpace;
  }

  redo(): void {
    this._productInfo.position.copy(this._newPosition);
    this._productInfo.rotationEuler.copy(this._newRotationEuler);
    this._productInfo.space = this._newSpace;
  }
}