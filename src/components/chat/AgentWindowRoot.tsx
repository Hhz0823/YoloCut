import { useEffect, useState } from 'react';
import {
  AGENT_WORKBENCH_DOCKING_SESSION_KEY,
  type AgentDockSide,
} from '../../../shared/agent-workbench';
import { useAgentBackendSync, useLocalAsrWarmup } from '../../app/appShell';
import { SettingsDialog } from '../settings/SettingsDialog';
import { useEditorController } from '../../editor/useEditorController';
import type { ProjectDoc } from '../../editor/types';
import { useUiScaleShortcuts } from '../../hooks/useUiScaleShortcuts';
import { useT } from '../../i18n/locale';
import {
  listProjects,
  loadProject,
  renameProject,
} from '../../persist/projectStore';
import {
  loadAgentWorkbenchDockSide,
  saveAgentWorkbenchDockSide,
} from '../../persist/agentWorkbenchPreference';
import type { ProjectMeta } from '../../persist/projectStoreCoordinators';
import { theme } from '../../theme';
import { AppToastHost } from '../../ui/AppToastHost';
import { ChatPanel } from './ChatPanel';

interface LoadedAgentProject {
  readonly meta: ProjectMeta;
  readonly doc: ProjectDoc;
}

function AgentWindowWorkspace({ initial }: { initial: LoadedAgentProject }) {
  const [meta, setMeta] = useState(initial.meta);
  const [dockSide, setDockSide] = useState<AgentDockSide>(loadAgentWorkbenchDockSide);
  const workspace = useEditorController({
    initial: initial.doc,
    project: meta,
    agentWindow: true,
    onHome: () => undefined,
    onRename: (name) => {
      setMeta((current) => ({ ...current, name, updatedAt: Date.now() }));
      void renameProject(meta.id, name);
    },
  });

  useEffect(() => {
    const desktop = window.yoloCutDesktop?.agentWorkbench;
    if (!desktop) return undefined;
    void desktop.getState().then((state) => setDockSide(state.dockSide)).catch(() => undefined);
    return desktop.subscribe((state) => {
      if (state.projectId !== meta.id) return;
      setDockSide(state.dockSide);
      if (state.placement === 'detached' && !state.dockPreview) {
        sessionStorage.removeItem(AGENT_WORKBENCH_DOCKING_SESSION_KEY);
      } else sessionStorage.setItem(AGENT_WORKBENCH_DOCKING_SESSION_KEY, '1');
    });
  }, [meta.id]);

  const dock = async (side: AgentDockSide): Promise<void> => {
    setDockSide(side);
    sessionStorage.setItem(AGENT_WORKBENCH_DOCKING_SESSION_KEY, '1');
    saveAgentWorkbenchDockSide(side);
    const desktop = window.yoloCutDesktop?.agentWorkbench;
    if (desktop) {
      try {
        await desktop.dock({ projectId: meta.id, dockSide: side });
      } catch {
        // Keep the native window usable so the user can retry either dock side.
        sessionStorage.removeItem(AGENT_WORKBENCH_DOCKING_SESSION_KEY);
      }
      return;
    }
    window.opener?.postMessage({
      type: 'yolocut-agent-dock',
      projectId: meta.id,
      dockSide: side,
    }, window.location.origin);
    window.close();
  };

  return (
    <main className="cc-agent-window-root" style={{ background: theme.bg, color: theme.text }}>
      <ChatPanel
        {...workspace.chatPanel}
        collapsed={false}
        hostMode="detached"
        dockSide={dockSide}
        canDetach={false}
        onToggleCollapse={() => { void dock(dockSide); }}
        onDock={dock}
        onDetach={undefined}
      />
      {workspace.settingsDialog && <SettingsDialog {...workspace.settingsDialog} />}
      <AppToastHost />
    </main>
  );
}

export function AgentWindowRoot() {
  const t = useT();
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId')?.trim() ?? '';
  const [loaded, setLoaded] = useState<LoadedAgentProject | null>(null);
  const [missing, setMissing] = useState(false);
  useAgentBackendSync();
  useLocalAsrWarmup('editor');
  useUiScaleShortcuts();

  useEffect(() => {
    // index.html sets the generic product title after BrowserWindow creation.
    // Keep the detached surface uniquely addressable by desktop automation.
    document.title = 'YoloCut Agent';
  }, []);

  useEffect(() => {
    let alive = true;
    if (!projectId) {
      setMissing(true);
      return () => { alive = false; };
    }
    void Promise.all([loadProject(projectId), listProjects()]).then(([doc, projects]) => {
      if (!alive) return;
      if (!doc) {
        setMissing(true);
        return;
      }
      const meta = projects.find((entry) => entry.id === projectId) ?? {
        id: projectId,
        name: t('未命名工程'),
        updatedAt: Date.now(),
      };
      setLoaded({ meta, doc });
    });
    return () => { alive = false; };
  }, [projectId, t]);

  if (missing) {
    return <div className="cc-agent-window-state">{t('工程不存在，无法打开 Agent 工作台。')}</div>;
  }
  if (!loaded) return <div className="cc-agent-window-state">{t('加载 Agent 工作台…')}</div>;
  return <AgentWindowWorkspace key={loaded.meta.id} initial={loaded} />;
}
