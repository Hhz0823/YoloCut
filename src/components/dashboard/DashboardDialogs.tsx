import { useEffect } from 'react';
import { MediaCleanupDialog } from '../../media/MediaCleanupDialog';
import { ShortcutsDialog } from '../../shortcuts/ShortcutsDialog';
import { bindAction } from '../../shortcuts/actionRegistry';
import { McpGuideDialog } from '../settings/McpGuide';
import { SettingsDialog } from '../settings/SettingsDialog';
import { StorageMigrationDialog } from '../settings/StorageMigrationDialog';
import type { DashboardModel } from './useDashboardModel';

export default function DashboardDialogs({ model }: { model: DashboardModel }) {
  // The settings dialog's Anthropic pane summons the MCP guide through the
  // action registry; in the editor the top bar answers, here the dashboard's
  // own dialog state does. Mounting this layer with the first open dashboard
  // dialog keeps that route intact without charging every startup for it.
  useEffect(() => bindAction('open-mcp-guide', () => model.setDialog('mcp', true)), [model]);
  return (
    <>
      {model.dialogs.settings && <SettingsDialog onClose={() => model.setDialog('settings', false)} />}
      {model.dialogs.shortcuts && <ShortcutsDialog onClose={() => model.setDialog('shortcuts', false)} />}
      {model.dialogs.mcp && <McpGuideDialog onClose={() => model.setDialog('mcp', false)} />}
      {model.dialogs.cleanup && <MediaCleanupDialog onClose={() => model.setDialog('cleanup', false)} />}
      {model.dialogs.storage && <StorageMigrationDialog onClose={() => model.setDialog('storage', false)} />}
    </>
  );
}
