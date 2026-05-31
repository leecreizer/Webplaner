import { Vector3 } from 'three';
import type { ICommand } from '../ICommand';
import type { ProductInfo } from '../../products/ProductInfo';

/**
 * 상품 회전 커맨드.
 *
 * Unity `RotateProductCommand` 1:1 포팅. 기즈모 회전 조작 완료 시점에 생성한다.
 */
export class RotateProductCommand implements ICommand {
  private readonly _productInfo: ProductInfo;
  private readonly _oldRotationEuler: Vector3;
  private readonly _newRotationEuler: Vector3;

  constructor(productInfo: ProductInfo, oldRotationEuler: Vector3) {
    this._productInfo = productInfo;
    this._oldRotationEuler = oldRotationEuler.clone();
    this._newRotationEuler = productInfo.rotationEuler.clone();
  }

  execute(): void {
    // no-op
  }

  undo(): void {
    this._productInfo.rotationEuler.copy(this._oldRotationEuler);
  }

  redo(): void {
    this._productInfo.rotationEuler.copy(this._newRotationEuler);
  }
}