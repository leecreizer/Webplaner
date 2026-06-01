/**
 * 모든 레이아웃 도메인 오브젝트의 기본 클래스. Dirty 패턴으로 업데이트를 관리한다.
 *
 * Unity `ObjectBase: MonoBehaviour`의 1:1 포팅이지만, MonoBehaviour의 라이프사이클
 * (Awake/Start/Update)은 React + r3f의 컴포넌트 라이프사이클로 대체된다. 따라서 이 클래스는
 * **순수 데이터 + Dirty 플래그**만 갖는 추상 부모로 축소했다.
 *
 * 시각화는 별도의 r3f 컴포넌트(`<NodeView>`, `<WallView>` 등)가 본 데이터를 구독하여 그린다.
 */
export abstract class ObjectBase {
  /** 오브젝트의 Dirty(갱신 필요) 상태 내부 플래그. */
  private _isDirty: boolean = true;

  /** 오브젝트가 갱신이 필요한 상태(Dirty)인지 여부. */
  get isDirty(): boolean {
    return this._isDirty;
  }

  /**
   * 오브젝트를 Dirty 상태로 설정한다. 이미 Dirty면 단락(short-circuit)하여 재귀를 방지한다.
   *
   * 서브클래스(예: `Node`)는 본 메서드를 override하여 의존 오브젝트(연결된 벽 등)를 함께
   * Dirty로 설정한다.
   */
  setDirty(): void {
    this._isDirty = true;
  }

  /**
   * Dirty 상태일 때 호출되어 오브젝트를 갱신한다. 호출 종료 시 Dirty 플래그를 해제한다.
   *
   * Unity의 `Update()`에서 매 프레임 검사하던 패턴 대신, r3f의 `useFrame` 훅 또는 명시적
   * 트리거(예: 사용자 액션 후)에서 호출된다.
   */
  dirtyUpdate(): void {
    this._isDirty = false;
  }

  /** 외부에서 Dirty 플래그를 강제 해제할 때 사용 (테스트/리셋용). */
  protected clearDirty(): void {
    this._isDirty = false;
  }
}