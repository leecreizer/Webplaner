import { Vector2, Vector3, Plane, Raycaster } from 'three';
import type { PerspectiveCamera, OrthographicCamera } from 'three';

/**
 * 사용자 입력 매니저 (r3f friendly).
 *
 * Unity `InputManager`(MonoBehaviour + Unity Input System) 대응. 차이점:
 * - Unity Input System은 DOM `pointer*` / `wheel` / `keydown` 이벤트로 대체
 * - 싱글톤 패턴 유지 (`InputManager.instance`)
 * - 이벤트 발행은 `EventTarget` 기반 (`addEventListener`/`removeEventListener`)
 *
 * 사용 패턴:
 * ```ts
 * useEffect(() => {
 *   const im = InputManager.instance;
 *   im.attach(canvasEl);
 *   const onSel = () => console.log('selected');
 *   im.on('select', onSel);
 *   return () => { im.off('select', onSel); im.detach(); };
 * }, []);
 * ```
 *
 * 또는 r3f 컴포넌트가 직접 `<mesh onPointerDown={...}>`를 쓰는 게 자연스러우면 그렇게 해도 됨.
 * 본 매니저는 *글로벌 단축키 / 드래그 감지 / 카메라 ray 헬퍼*가 필요할 때 쓴다.
 */

/** 발행되는 이벤트 이름. */
export type InputEventName =
  | 'leftDown'
  | 'leftUp'
  | 'rightDown'
  | 'rightUp'
  | 'pointerMove'
  | 'wheel'
  | 'wasd'
  | 'doubleClick'
  | 'select'
  | 'drag'
  | 'cancel'
  | 'delete';

/** 각 이벤트의 payload 타입 매핑. */
export interface InputEventMap {
  leftDown: { x: number; y: number };
  leftUp: { x: number; y: number };
  rightDown: { x: number; y: number };
  rightUp: { x: number; y: number };
  /** 화면 이동 델타(px). */
  pointerMove: { dx: number; dy: number };
  /** 휠 (`deltaY`의 부호 반전, 양수 = 줌인). */
  wheel: number;
  /** WASD 키 입력 (-1/0/1 정규화 Vector2). */
  wasd: { x: number; y: number };
  /** 더블클릭. */
  doubleClick: { x: number; y: number };
  /** 드래그 임계값 미만으로 떼면 select. */
  select: { x: number; y: number };
  /** 드래그 중 매 프레임 발행. */
  drag: { dx: number; dy: number };
  /** Esc 키. */
  cancel: void;
  /** Delete/Backspace 키. */
  delete: void;
}

type Listener<K extends InputEventName> = (payload: InputEventMap[K]) => void;

export class InputManager {
  // ===== 싱글톤 =================================================
  private static _instance: InputManager | null = null;
  static get instance(): InputManager {
    if (this._instance === null) this._instance = new InputManager();
    return this._instance;
  }

  // ===== 상태 ==================================================
  /** 매 프레임 마우스 이동량(px). */
  mouseDelta: Vector2 = new Vector2();

  /** 화면 좌표(클라이언트). */
  pointerPosition: Vector2 = new Vector2();

  /** Shift 등 axis-snap 키가 눌려있는지. */
  isAxisSnapPressed: boolean = false;

  /** 클릭 vs 드래그 판별 임계값(px). Unity 원본과 동일. */
  dragMoveThreshold: number = 30;

  private _leftPressed: boolean = false;
  private _dragMoveStartCount: number = 0;
  private _isDragging: boolean = false;
  private _lastPointer: Vector2 = new Vector2();

  /** 매니저가 연결된 DOM 요소 (보통 r3f Canvas의 `gl.domElement`). */
  private _element: HTMLElement | null = null;

  /** 이벤트 리스너 저장소. */
  private _listeners: Map<InputEventName, Set<Listener<InputEventName>>> = new Map();

  /** WASD 키 상태 추적. */
  private _keyState: Record<string, boolean> = {};

  // ===== 부착/분리 ==============================================

  /**
   * DOM 요소에 본 매니저를 부착한다. r3f의 경우 `gl.domElement`(canvas)를 전달.
   * 동일 매니저를 여러 요소에 부착할 수는 없다 — 기존 부착을 분리한 후 부착.
   */
  attach(element: HTMLElement): void {
    if (this._element === element) return;
    if (this._element !== null) this.detach();

    this._element = element;
    element.addEventListener('pointerdown', this._onPointerDown);
    element.addEventListener('pointerup', this._onPointerUp);
    element.addEventListener('pointermove', this._onPointerMove);
    element.addEventListener('wheel', this._onWheel, { passive: true });
    element.addEventListener('dblclick', this._onDoubleClick);
    element.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  /** 부착 해제 + 리스너 정리. */
  detach(): void {
    if (this._element === null) return;
    const el = this._element;
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('pointermove', this._onPointerMove);
    el.removeEventListener('wheel', this._onWheel);
    el.removeEventListener('dblclick', this._onDoubleClick);
    el.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this._element = null;
  }

  // ===== 이벤트 구독/해제 =======================================

  on<K extends InputEventName>(name: K, listener: Listener<K>): void {
    let set = this._listeners.get(name);
    if (!set) {
      set = new Set();
      this._listeners.set(name, set);
    }
    set.add(listener as Listener<InputEventName>);
  }

  off<K extends InputEventName>(name: K, listener: Listener<K>): void {
    this._listeners.get(name)?.delete(listener as Listener<InputEventName>);
  }

  private _emit<K extends InputEventName>(name: K, payload: InputEventMap[K]): void {
    const set = this._listeners.get(name);
    if (!set) return;
    for (const l of set) (l as (p: InputEventMap[K]) => void)(payload);
  }

  // ===== DOM 이벤트 핸들러 ======================================

  private _onPointerDown = (e: PointerEvent): void => {
    this.pointerPosition.set(e.clientX, e.clientY);
    if (e.button === 0) {
      this._leftPressed = true;
      this._dragMoveStartCount = 0;
      this._isDragging = false;
      this._emit('leftDown', { x: e.clientX, y: e.clientY });
    } else if (e.button === 2) {
      this._emit('rightDown', { x: e.clientX, y: e.clientY });
    }
  };

  private _onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) {
      const wasLeft = this._leftPressed;
      this._leftPressed = false;
      this._emit('leftUp', { x: e.clientX, y: e.clientY });
      if (wasLeft && !this._isDragging) {
        this._emit('select', { x: e.clientX, y: e.clientY });
      }
      this._dragMoveStartCount = 0;
      this._isDragging = false;
    } else if (e.button === 2) {
      this._emit('rightUp', { x: e.clientX, y: e.clientY });
    }
  };

  private _onPointerMove = (e: PointerEvent): void => {
    const dx = e.clientX - this._lastPointer.x;
    const dy = e.clientY - this._lastPointer.y;
    this._lastPointer.set(e.clientX, e.clientY);
    this.pointerPosition.set(e.clientX, e.clientY);
    this.mouseDelta.set(dx, dy);

    if (this._leftPressed && !this._isDragging) {
      this._dragMoveStartCount += Math.hypot(dx, dy);
      if (this._dragMoveStartCount > this.dragMoveThreshold) {
        this._isDragging = true;
      }
    }
    if (this._isDragging) {
      this._emit('drag', { dx, dy });
    }
    this._emit('pointerMove', { dx, dy });
  };

  private _onWheel = (e: WheelEvent): void => {
    // deltaY > 0 = 스크롤 다운(줌아웃) → 부호 반전
    this._emit('wheel', -Math.sign(e.deltaY));
  };

  private _onDoubleClick = (e: MouseEvent): void => {
    this._emit('doubleClick', { x: e.clientX, y: e.clientY });
  };

  private _onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private _onKeyDown = (e: KeyboardEvent): void => {
    this._keyState[e.code] = true;
    this.isAxisSnapPressed = e.shiftKey;
    if (e.code === 'Escape') this._emit('cancel', undefined);
    if (e.code === 'Delete' || e.code === 'Backspace') this._emit('delete', undefined);
    this._dispatchWasd();
  };

  private _onKeyUp = (e: KeyboardEvent): void => {
    this._keyState[e.code] = false;
    this.isAxisSnapPressed = e.shiftKey;
    this._dispatchWasd();
  };

  private _dispatchWasd(): void {
    const x =
      (this._keyState['KeyD'] || this._keyState['ArrowRight'] ? 1 : 0) -
      (this._keyState['KeyA'] || this._keyState['ArrowLeft'] ? 1 : 0);
    const y =
      (this._keyState['KeyW'] || this._keyState['ArrowUp'] ? 1 : 0) -
      (this._keyState['KeyS'] || this._keyState['ArrowDown'] ? 1 : 0);
    if (x !== 0 || y !== 0) this._emit('wasd', { x, y });
  }

  // ===== 카메라 ray 헬퍼 =======================================

  /**
   * 현재 포인터 위치에서 Y=0 평면(XZ 바닥)에 떨어진 월드 좌표를 반환.
   * Unity `InputManager.PointerWorldPositionXZ()` 대응.
   *
   * @param camera Three.js 카메라
   * @param viewport Canvas의 위치/크기 (`getBoundingClientRect()` 결과 또는 동등 정보)
   * @returns 평면 교차점. 평행이면 null.
   */
  pointerWorldPositionXZ(
    camera: PerspectiveCamera | OrthographicCamera,
    viewport: { left: number; top: number; width: number; height: number },
  ): Vector3 | null {
    // NDC 좌표 (-1..1)
    const ndc = new Vector2(
      ((this.pointerPosition.x - viewport.left) / viewport.width) * 2 - 1,
      -(((this.pointerPosition.y - viewport.top) / viewport.height) * 2 - 1),
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
    const hit = new Vector3();
    const ok = raycaster.ray.intersectPlane(groundPlane, hit);
    return ok ? hit : null;
  }
}