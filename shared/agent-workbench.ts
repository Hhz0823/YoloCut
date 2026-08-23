export type AgentDockSide = 'left' | 'right';
export type AgentWorkbenchPlacement = AgentDockSide | 'detached';

export interface AgentWorkbenchDetachPoint {
  /** Physical desktop coordinates reported by PointerEvent, not renderer CSS pixels. */
  readonly screenX: number;
  readonly screenY: number;
}

export interface AgentWorkbenchRequest {
  readonly projectId: string;
  readonly dockSide: AgentDockSide;
  /** Optional release point used to place a window created by a tear-off drag. */
  readonly detachAt?: AgentWorkbenchDetachPoint;
}

export interface AgentWorkbenchDockRequest {
  readonly projectId: string;
  readonly dockSide: AgentDockSide;
}

export interface AgentWorkbenchState {
  readonly placement: AgentWorkbenchPlacement;
  readonly dockSide: AgentDockSide;
  readonly projectId: string | null;
  /** Native-window drag preview shown over the main editor. */
  readonly dockPreview: AgentDockSide | null;
}

export interface RectangleLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PointLike {
  readonly x: number;
  readonly y: number;
}

export interface NativeAgentDockDecision {
  readonly armed: boolean;
  readonly target: AgentDockSide | null;
}

export const AGENT_WORKBENCH_CHANNELS = {
  state: 'yolocut:agent-workbench-state',
  getState: 'yolocut:agent-workbench-get-state',
  detach: 'yolocut:agent-workbench-detach',
  dock: 'yolocut:agent-workbench-dock',
} as const;

export const AGENT_WORKBENCH_DOCKING_SESSION_KEY = 'yolocut.agentWorkbenchDocking.v1';
export const AGENT_WORKBENCH_DOCK_SIDE_STORAGE_KEY = 'yolocut.agentWorkbenchDockSide.v1';

const MAX_PROJECT_ID_LENGTH = 256;
const MAX_SCREEN_COORDINATE = 1_000_000;

export function isAgentDockSide(value: unknown): value is AgentDockSide {
  return value === 'left' || value === 'right';
}

export function isAgentWorkbenchRequest(value: unknown): value is AgentWorkbenchRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  const detachAt = request.detachAt;
  const validDetachPoint = detachAt === undefined || (
    typeof detachAt === 'object'
    && detachAt !== null
    && typeof Reflect.get(detachAt, 'screenX') === 'number'
    && Number.isFinite(Reflect.get(detachAt, 'screenX'))
    && Math.abs(Reflect.get(detachAt, 'screenX') as number) <= MAX_SCREEN_COORDINATE
    && typeof Reflect.get(detachAt, 'screenY') === 'number'
    && Number.isFinite(Reflect.get(detachAt, 'screenY'))
    && Math.abs(Reflect.get(detachAt, 'screenY') as number) <= MAX_SCREEN_COORDINATE
  );
  return typeof request.projectId === 'string'
    && request.projectId.length > 0
    && request.projectId.length <= MAX_PROJECT_ID_LENGTH
    && isAgentDockSide(request.dockSide)
    && validDetachPoint;
}

export const isAgentWorkbenchDockRequest = isAgentWorkbenchRequest;

export function isAgentWorkbenchState(value: unknown): value is AgentWorkbenchState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return (isAgentDockSide(state.placement) || state.placement === 'detached')
    && isAgentDockSide(state.dockSide)
    && (state.projectId === null || (
      typeof state.projectId === 'string'
      && state.projectId.length > 0
      && state.projectId.length <= MAX_PROJECT_ID_LENGTH
    ))
    && (state.dockPreview === null || isAgentDockSide(state.dockPreview));
}

/** Three-zone drop target used while dragging a docked Agent header. */
export function agentWorkbenchDropTarget(
  clientX: number,
  viewportWidth: number,
): AgentWorkbenchPlacement {
  const width = Math.max(1, viewportWidth);
  const x = Math.max(0, Math.min(width, clientX));
  // Keep edge docking intentional. A 30% edge zone covered almost the whole
  // docked panel, so a normal short pull away from the right/left rail simply
  // re-docked the workbench instead of tearing it off.
  if (x <= width * 0.2) return 'left';
  if (x >= width * 0.8) return 'right';
  return 'detached';
}

/**
 * Renderer tear-off target. The side zones remain available inside the editor;
 * releasing outside the native viewport always means "create a window".
 */
export function agentWorkbenchPointerTarget(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): AgentWorkbenchPlacement {
  if (clientX < 0 || clientY < 0 || clientX > viewportWidth || clientY > viewportHeight) {
    return 'detached';
  }
  return agentWorkbenchDropTarget(clientX, viewportWidth);
}

/** Compact native drop area at each corner of the main YoloCut window. */
export const NATIVE_AGENT_DOCK_CORNER_SIZE = 96;

/**
 * Native-window docking target. Only the four compact corner hotspots of the
 * main window accept a floating Agent; the remaining edges and centre are safe
 * places to move or keep the window detached.
 */
export function nativeAgentDockTarget(
  main: RectangleLike,
  pointer: PointLike,
): AgentDockSide | null {
  if (main.width <= 0 || main.height <= 0) return null;
  const right = main.x + main.width;
  const bottom = main.y + main.height;
  if (pointer.x < main.x || pointer.x > right || pointer.y < main.y || pointer.y > bottom) return null;
  const nearTop = pointer.y - main.y <= NATIVE_AGENT_DOCK_CORNER_SIZE;
  const nearBottom = bottom - pointer.y <= NATIVE_AGENT_DOCK_CORNER_SIZE;
  if (!nearTop && !nearBottom) return null;
  if (pointer.x - main.x <= NATIVE_AGENT_DOCK_CORNER_SIZE) return 'left';
  if (right - pointer.x <= NATIVE_AGENT_DOCK_CORNER_SIZE) return 'right';
  return null;
}

/**
 * Newly detached windows start disarmed. They must first be dragged through a
 * non-corner area before a later corner entry can dock, preventing an initial
 * placement near a corner from snapping straight back into the editor.
 */
export function nativeAgentDockDecision(
  main: RectangleLike,
  pointer: PointLike,
  armed: boolean,
): NativeAgentDockDecision {
  const target = nativeAgentDockTarget(main, pointer);
  if (armed) return { armed: true, target };
  if (target === null) return { armed: true, target: null };
  return { armed: false, target: null };
}
