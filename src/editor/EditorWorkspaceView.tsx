import type { ComponentProps } from 'react';
import { theme } from '../theme';
import { ExportDialog } from '../export/ExportDialog';
import { TopBar } from '../components/TopBar';
import { ChatPanel } from '../components/chat/ChatPanel';
import { LibraryPanel } from '../library/LibraryPanel';
import { PreviewPanel } from '../components/PreviewPanel';
import { InspectorPanel } from '../components/InspectorPanel';
import { Timeline } from '../components/timeline/Timeline';
import { TimelineTabs } from '../components/timeline/TimelineTabs';
import { Divider } from '../components/Divider';
import { DesignStylePanel } from '../components/settings/DesignStylePanel';
import { VersionHistory } from '../components/VersionHistory';
import { SettingsDialog } from '../components/settings/SettingsDialog';
import { ShortcutsDialog } from '../shortcuts/ShortcutsDialog';
import { AppToastHost } from '../ui/AppToastHost';
import { AgentDockPreview } from '../components/chat/AgentDockPreview';
import type { AgentDockSide, AgentWorkbenchPlacement } from '../../shared/agent-workbench';

export interface EditorWorkspaceViewProps {
  gridTemplateColumns: string;
  gridTemplateRows: string;
  topBar: ComponentProps<typeof TopBar>;
  exportDialog: ComponentProps<typeof ExportDialog> | null;
  designStylePanel: ComponentProps<typeof DesignStylePanel> | null;
  versionHistory: ComponentProps<typeof VersionHistory> | null;
  shortcutsDialog: ComponentProps<typeof ShortcutsDialog> | null;
  settingsDialog: ComponentProps<typeof SettingsDialog> | null;
  chatPanel: ComponentProps<typeof ChatPanel>;
  chatPlacement: AgentWorkbenchPlacement;
  agentDockPreview: AgentDockSide | null;
  chatCollapsed: boolean;
  onResizeChat: ComponentProps<typeof Divider>['onResize'];
  libraryPanel: ComponentProps<typeof LibraryPanel>;
  onResizeLibrary: ComponentProps<typeof Divider>['onResize'];
  previewPanel: ComponentProps<typeof PreviewPanel>;
  inspectorPanel: ComponentProps<typeof InspectorPanel> | null;
  onResizeTimeline: ComponentProps<typeof Divider>['onResize'];
  timelineTabs: ComponentProps<typeof TimelineTabs>;
  timeline: ComponentProps<typeof Timeline>;
}

interface WorkspacePlacement {
  libraryColumn: number;
  libraryDividerColumn: number;
  previewColumn: number;
  chatDividerColumn: number | null;
  mainColumnRange: string;
}

function placementFor(chatPlacement: AgentWorkbenchPlacement): WorkspacePlacement {
  if (chatPlacement === 'left') {
    return {
      libraryColumn: 3,
      libraryDividerColumn: 4,
      previewColumn: 5,
      chatDividerColumn: 2,
      mainColumnRange: '3 / 6',
    };
  }
  return {
    libraryColumn: 1,
    libraryDividerColumn: 2,
    previewColumn: 3,
    chatDividerColumn: chatPlacement === 'right' ? 4 : null,
    mainColumnRange: '1 / 4',
  };
}

function renderLibrary(props: EditorWorkspaceViewProps, placement: WorkspacePlacement) {
  return (
    <div className="cc-workspace-library" style={{ gridColumn: placement.libraryColumn, gridRow: 2, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      <LibraryPanel {...props.libraryPanel} />
    </div>
  );
}

function renderPreview(props: EditorWorkspaceViewProps, placement: WorkspacePlacement) {
  return (
    <div className="cc-preview-workspace" style={{ gridColumn: placement.previewColumn, gridRow: 2 }}>
      <PreviewPanel {...props.previewPanel} />
      {props.inspectorPanel && <InspectorPanel {...props.inspectorPanel} />}
    </div>
  );
}

function renderTimeline(props: EditorWorkspaceViewProps, placement: WorkspacePlacement) {
  return (
    <div className="cc-workspace-timeline" style={{ gridColumn: placement.mainColumnRange, gridRow: 4, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <TimelineTabs {...props.timelineTabs} />
      <Timeline {...props.timeline} />
    </div>
  );
}

export function EditorWorkspaceView(props: EditorWorkspaceViewProps) {
  const placement = placementFor(props.chatPlacement);
  return (
    <div
      className="cc-editor-shell"
      style={{
        display: 'grid',
        gridTemplateColumns: props.gridTemplateColumns,
        gridTemplateRows: props.gridTemplateRows,
        height: '100dvh',
        overflow: 'hidden',
        background: theme.bg,
        color: theme.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <TopBar {...props.topBar} />
      {props.exportDialog && <ExportDialog {...props.exportDialog} />}
      {props.settingsDialog && <SettingsDialog {...props.settingsDialog} />}
      {props.designStylePanel && <DesignStylePanel {...props.designStylePanel} />}
      {props.versionHistory && <VersionHistory {...props.versionHistory} />}
      {props.shortcutsDialog && <ShortcutsDialog {...props.shortcutsDialog} />}
      {props.chatPlacement !== 'detached' && <ChatPanel {...props.chatPanel} />}
      {props.agentDockPreview && <AgentDockPreview target={props.agentDockPreview} />}
      {renderLibrary(props, placement)}
      <div style={{ gridColumn: placement.libraryDividerColumn, gridRow: 2 }}>
        <Divider onResize={props.onResizeLibrary} />
      </div>
      {renderPreview(props, placement)}
      {placement.chatDividerColumn !== null && (
        <div style={{ gridColumn: placement.chatDividerColumn, gridRow: '2 / 5' }}>
          {!props.chatCollapsed && <Divider onResize={(delta) => (
            props.onResizeChat(props.chatPlacement === 'left' ? delta : -delta)
          )} />}
        </div>
      )}
      <div style={{ gridColumn: placement.mainColumnRange, gridRow: 3 }}>
        <Divider orientation="horizontal" onResize={props.onResizeTimeline} />
      </div>
      {renderTimeline(props, placement)}
      <AppToastHost />
    </div>
  );
}
