import type { ICommand } from '../ICommand';
import type { PlanSaveData } from '@/persistence/PlanSaveData';
import { buildPlanData } from '@/networking/RenderPlanBuilder';
import { SpaceManager } from '@/domain/layout/SpaceManager';
import { useSpaceModuleStore } from '@/features/spaceModules/spaceModuleStore';
import { syncModuleWalls } from '@/features/spaceModules/syncModuleWalls';
import { modulesFromSaveData } from '@/features/spaceModules/serialization';

/**
 * 플랜 불러오기 커맨드.
 *
 * Unity `UndoRedo.Commands.LoadPlanCommand` 1:1 포팅. 외부에서 전달받은 `PlanSaveData`(또는
 * 그 JSON 문자열)로 평면도를 복원하며, before/after 상태도 동일 포맷으로 캡처해
 * 단일 Undo/Redo 단위로 처리한다.
 *
 * - **execute**: 현재 상태 스냅샷 → clearWalls → loadPlan(target) → after 스냅샷
 * - **undo**: clearWalls → loadPlan(before)
 * - **redo**: clearWalls → loadPlan(after)
 *
 * ### 포팅 상태
 * - **완료**: before/after 캡처 + undo/redo 구조
 * - **TODO**: `_loadPlan(plan)` 실제 구현 — `PlanSaveData` → 노드/벽/공간 복원 로직. Tasks
 *   모듈의 `SubTaskLoadPlan` 포팅 후 활성화. 본 클래스는 그 시점에 비동기로 전환된다.
 */
export class LoadPlanCommand implements ICommand {
  private readonly _target: string | PlanSaveData;
  private _before: PlanSaveData | null = null;
  private _after: PlanSaveData | null = null;

  /**
   * @param target 로드할 플랜 — JSON 문자열 또는 PlanSaveData 객체
   */
  constructor(target: string | PlanSaveData) {
    this._target = target;
  }

  execute(): void {
    this._before = buildPlanData();
    SpaceManager.clearWalls();
    LoadPlanCommand._loadPlan(this._target);
    // Unity 원본은 비동기 콜백(`() => _after = GeneratePlanData()`)이지만 본 stub은 동기.
    this._after = buildPlanData();
  }

  undo(): void {
    if (this._before === null) return;
    SpaceManager.clearWalls();
    LoadPlanCommand._loadPlan(this._before);
  }

  redo(): void {
    if (this._after === null) return;
    SpaceManager.clearWalls();
    LoadPlanCommand._loadPlan(this._after);
  }

  /**
   * TODO(port): `PlanSaveData` → 노드/벽/공간 재생성 로직.
   * Unity 원본은 Tasks/LoadPlan 시리즈로 비동기 처리.
   *
   * @param plan PlanSaveData 객체 또는 JSON 문자열
   */
  private static _loadPlan(plan: string | PlanSaveData): void {
    const _parsed: PlanSaveData = typeof plan === 'string' ? JSON.parse(plan) : plan;
    // TODO(port): _parsed.Nodes → Node.create, _parsed.Walls → Wall.create, _parsed.Spaces → ...
    // 본 stub은 의도적으로 비어있다 — Tasks 모듈 포팅 후 채워진다.

    // 공간 모듈은 별도 스토어이므로 Nodes/Walls 포팅 여부와 무관하게 복원 가능하다.
    // syncModuleWalls()가 모듈발 벽을 재생성한다 — 저장 시 모듈발 벽은 직렬화에서 제외되어 있다.
    useSpaceModuleStore.setState({ modules: modulesFromSaveData(_parsed.spaceModules) });
    syncModuleWalls();
  }
}