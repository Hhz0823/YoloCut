import {
  AGENT_WORKBENCH_DOCK_SIDE_STORAGE_KEY,
  type AgentDockSide,
} from '../../shared/agent-workbench';
import { LEGACY_PERSISTENCE_IDS } from '../../shared/product-compat';
import { readMigratedStorageItem } from './storageKeyMigration';

export function loadAgentWorkbenchDockSide(): AgentDockSide {
  try {
    return readMigratedStorageItem(
      localStorage,
      AGENT_WORKBENCH_DOCK_SIDE_STORAGE_KEY,
      [LEGACY_PERSISTENCE_IDS.agentDockSideStorageKey],
    ) === 'left' ? 'left' : 'right';
  } catch {
    return 'right';
  }
}

export function saveAgentWorkbenchDockSide(side: AgentDockSide): void {
  try {
    localStorage.setItem(AGENT_WORKBENCH_DOCK_SIDE_STORAGE_KEY, side);
  } catch {
    // Keep the in-memory layout when browser storage is unavailable.
  }
}
