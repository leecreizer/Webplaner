import { Vector3 } from 'three';
import type { Wall } from '@/domain/structures/Wall';
import { ProductInfo } from './ProductInfo';
import {
  FilledType,
  FilledDetailType,
  OpenDir,
  contentsCDToDetailType,
  detailTypeToFilledType,
} from './ProductTypes';
import { mmToM } from '@/lib/math/Math';

/**
 * 벽체에 삽입되는 제품(문/창문).
 *
 * Unity `ProductWallFilled` 1:1 포팅.
 *
 * ### 책임
 * - 부모 Wall 참조 (`parent`)
 * - 타입 (DOOR/WINDOW) + 세부타입 + 열림방향
 * - 현재 크기 (`currentSize`) + 중심 (`currentCenter`)
 * - 부모 Wall의 `filledObjects` 컬렉션에 자동 등록/해제
 *
 * 시각화(SymbolFilled, BoxCollider)는 r3f 컴포넌트가 데이터를 구독해 처리한다.
 */
export class ProductWallFilled {
  /** 부모 Wall (벽에 삽입되어 있을 때만 non-null). */
  private _parent: Wall | null = null;

  /** 제품 유형 (문/창문). */
  type: FilledType = FilledType.DOOR;

  /** 제품 세부 유형. */
  detailType: FilledDetailType = FilledDetailType.DoorOpening;

  /** 본 제품의 ProductInfo 참조 (카탈로그 정보·Space 동기화). */
  readonly productInfo: ProductInfo;

  /** 원본 크기 (초기 설정값, 향후 Resize 비율 계산 기준). */
  private _originSize: Vector3 = new Vector3();

  /** 현재 크기(m). */
  currentSize: Vector3 = new Vector3();

  /** 현재 중심 좌표(부모 Wall 로컬). */
  currentCenter: Vector3 = new Vector3();

  /** 월드 좌표 위치 (벽 진행방향 기준 alongWall 거리로 결정). */
  position: Vector3 = new Vector3();

  /** 월드 회전 (오일러, 도). */
  rotationEuler: Vector3 = new Vector3();

  private _openDir: OpenDir = OpenDir.NONE;

  /** 부모 벽 — setter는 transform reparenting 대응(Three.js에서는 단순 참조 갱신). */
  get parent(): Wall | null {
    return this._parent;
  }

  set parent(value: Wall | null) {
    this._parent = value;
  }

  /**
   * 문 열림 방향. 본 setter는 DOOR 타입에만 적용되며, 변경 시 현재 BoxCollider 크기/중심을
   * 갱신한다 (Z축 방향으로 size.x만큼 확장).
   *
   * WINDOW에 setter 호출 시 무시.
   */
  get openDir(): OpenDir {
    return this._openDir;
  }

  set openDir(value: OpenDir) {
    if (this.type !== FilledType.DOOR || this._openDir === value) return;
    this._openDir = value;

    // 콜라이더 확장 — Unity 원본 ProductWallFilled.cs:91-104:
    // size.z = depth + size.x
    // center.z = (size.z - depth) * 0.5
    const size = this.currentSize.clone();
    const center = this.currentCenter.clone();
    const depth = size.z;
    size.z = depth + size.x;
    center.z = (size.z - depth) * 0.5;
    this.currentSize.copy(size);
    this.currentCenter.copy(center);

    // TODO(port): SymbolDoorOpening의 OpenDir도 동기화 — Symbols 모듈 포팅 후
  }

  /**
   * 팩토리 — ProductInfo로부터 ProductWallFilled를 만든다.
   * Unity 원본은 `productInfo.gameObject.AddComponent<ProductWallFilled>()` 패턴이지만,
   * TS에서는 새 인스턴스를 생성해 양방향 참조를 묶는다.
   */
  static create(productInfo: ProductInfo): ProductWallFilled {
    const wallFilled = new ProductWallFilled(productInfo);
    wallFilled.init();
    return wallFilled;
  }

  /** 생성자. {@link create}를 통해서만 호출하라. @internal */
  constructor(productInfo: ProductInfo) {
    this.productInfo = productInfo;
  }

  /**
   * 초기화 — 카탈로그 마스터의 length/depth/height를 m로 환산해 초기 크기 설정.
   * Unity `ProductWallFilled.Init()`.
   */
  init(): void {
    if (!this.productInfo.contentsMaster) return;

    // 카탈로그 정보로부터 detailType / type 결정
    this.detailType = contentsCDToDetailType(this.productInfo.contentsMaster.contentsCD);
    this.type = detailTypeToFilledType(this.detailType);

    const cm = this.productInfo.contentsMaster;
    const length = mmToM(cm.length);
    const height = mmToM(cm.height);
    // depth는 벽 두께와 동일 — Wall.DEFAULT_THICK 사용
    const depth = 0.2;

    this._originSize.set(length, height, depth);
    this.currentSize.copy(this._originSize);
    this.currentCenter.set(0, 0, 0);
  }

  /**
   * 본 제품을 대상 벽에 삽입한다 — `targetWall.insert(this)` 호출과 동일.
   * Unity `ProductWallFilled.Insert(targetWall)`.
   */
  insert(targetWall: Wall): void {
    targetWall.insert(this);
  }

  /**
   * 부모 벽에서 본 제품을 제거한다. 벽이 파괴 진행 중이면 무시.
   * Unity `ProductWallFilled.Remove()`.
   */
  remove(): void {
    if (this._parent !== null && !this._parent.isDestroying) {
      this._parent.remove(this);
    }
  }

  /**
   * 제품 크기를 변경하고 size/center 캐시를 갱신한다.
   *
   * Unity 원본은 `ProductStretchable.Transform`을 통해 메시도 재변형하지만, 본 포팅에서는
   * 데이터 갱신만 한다. 메시 재변형은 r3f 컴포넌트가 본 데이터를 구독해 GLB 인스턴스에 적용.
   */
  resize(newSize: Vector3): void {
    this.currentSize.copy(newSize);
    // center는 size 변경에 따라 일반적으로 유지 (Unity 원본도 BoxCollider 갱신 후 size/center를
    // 단순 복사). openDir-확장 로직은 별도 setter에서 처리.
  }

  /**
   * 제품의 방향을 반전한다 — DOOR는 열림 방향을 RIGHT↔LEFT 토글, WINDOW는 forward 회전.
   * Unity `ProductWallFilled.Flip()`.
   */
  flip(): void {
    const parent = this._parent;
    this.remove();

    if (this.type === FilledType.DOOR) {
      if (this._openDir === OpenDir.RIGHT) {
        this.openDir = OpenDir.LEFT;
      } else {
        // forward를 -1배 회전 (Y축 180도 회전과 동일)
        this.rotationEuler.y = (this.rotationEuler.y + 180) % 360;
        this.openDir = OpenDir.RIGHT;
      }
    } else if (this.type === FilledType.WINDOW) {
      this.rotationEuler.y = (this.rotationEuler.y + 180) % 360;
    }

    if (parent !== null) this.insert(parent);
  }
}