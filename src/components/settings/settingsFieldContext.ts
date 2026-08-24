import type { CodexSettingsController } from './useCodexSettings';
import type {
  KeyStatusResponse,
  SettingsField,
  StagedValues,
} from './settingsSchema';

/** Shared field-rendering contract for settings panes. */
export interface FieldCtx {
  status: KeyStatusResponse | null;
  values: StagedValues;
  reveal: boolean;
  onStage: (field: SettingsField, raw: string) => void;
  onToggleClear: (field: SettingsField) => void;
  modelOptions: Record<string, readonly string[]>;
  onModelsDiscovered: (name: string, models: readonly string[]) => void;
  onServerSettingsApplied: (status: KeyStatusResponse, clearedFields: readonly string[]) => void;
  codex: CodexSettingsController;
}
