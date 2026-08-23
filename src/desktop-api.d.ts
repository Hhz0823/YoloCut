export {};
import type {
  ProjectStoreRequest,
  ProjectStoreResponse,
} from '../shared/project-store-transport';
import type { AgentPathImportRequest, AgentPathImportResult } from '../shared/directory-import';
import type { EditorBootstrapInfo } from '../shared/editor-auth-transport';
import type {
  DesktopUpdateCheckSource,
  DesktopUpdateState,
} from '../shared/desktop-update';
import type {
  DesktopAsrPreloadRequest,
  DesktopAsrRequest,
  DesktopAsrResponse,
  DesktopClapRequest,
  DesktopClapResponse,
  DesktopInferenceCapabilities,
  DesktopInferenceProgress,
  DesktopModelLoadResponse,
  DesktopSemanticRequest,
  DesktopSemanticResponse,
  DesktopRhythmRequest,
  DesktopRhythmResponse,
} from '../shared/desktop-inference';
import type {
  DirectoryImportDisposition,
  DirectoryImportEvent,
  DirectoryWatchStartResult,
} from '../shared/directory-import';
import type { TranscriptWindowPayload } from '../shared/transcript-window';
import type {
  AgentWorkbenchDockRequest,
  AgentWorkbenchRequest,
  AgentWorkbenchState,
} from '../shared/agent-workbench';
import type { DesktopLocale } from '../shared/desktop-locale';
import type {
  AutoEditSourceImportRequest,
  AutoEditSourceImportResult,
  AutoEditSourceSelection,
} from '../shared/auto-edit-source';
interface DesktopExportDirectoryGrant {
  readonly grantId: string;
  readonly label: string;
}
interface DesktopExportFileGrant extends DesktopExportDirectoryGrant {
  readonly filename: string;
}

interface DesktopUpdateApi {
  getState(): Promise<DesktopUpdateState>;
  check(source: DesktopUpdateCheckSource): Promise<DesktopUpdateState>;
  download(): Promise<DesktopUpdateState>;
  install(): Promise<DesktopUpdateState>;
  subscribe(listener: (state: DesktopUpdateState) => void): () => void;
}
interface DesktopInferenceApi {
  getCapabilities(): Promise<DesktopInferenceCapabilities>;
  setEnabled(enabled: boolean): Promise<void>;
  preloadAsr(request: DesktopAsrPreloadRequest): Promise<DesktopModelLoadResponse>;
  transcribe(request: DesktopAsrRequest): Promise<DesktopAsrResponse>;
  semantic(request: DesktopSemanticRequest): Promise<DesktopSemanticResponse>;
  clap(request: DesktopClapRequest): Promise<DesktopClapResponse>;
  rhythm(request: DesktopRhythmRequest): Promise<DesktopRhythmResponse>;
  cancel(requestId: string): Promise<void>;
  subscribeProgress(listener: (progress: DesktopInferenceProgress) => void): () => void;
}
interface DesktopAgentWorkbenchApi {
  getState(): Promise<AgentWorkbenchState>;
  detach(request: AgentWorkbenchRequest): Promise<AgentWorkbenchState>;
  dock(request: AgentWorkbenchDockRequest): Promise<AgentWorkbenchState>;
  subscribe(listener: (state: AgentWorkbenchState) => void): () => void;
}

declare global {
  interface Window {
    yoloCutDesktop?: {
      getPathForFile(file: File): string | undefined;
      platform: NodeJS.Platform;
      setLocale(locale: DesktopLocale): Promise<void>;
      selectDirectory(defaultPath?: string): Promise<string | null>;
      selectAutoEditSources(): Promise<AutoEditSourceSelection | null>;
      listAutoEditSources(grantId: string): Promise<AutoEditSourceSelection | null>;
      importAutoEditSource(request: AutoEditSourceImportRequest): Promise<AutoEditSourceImportResult>;
      selectExportDirectory(): Promise<DesktopExportDirectoryGrant | null>;
      selectExportFile(suggestedFilename: string): Promise<DesktopExportFileGrant | null>;
      restoreExportDirectory(): Promise<DesktopExportDirectoryGrant | null>;
      importLocalMedia(file: File): Promise<{ src: string; storedName: string; contentHash: string } | null>;
      prepareTransparentMovProxy(storedName: string): Promise<{ src: string } | null>;
      startImportDirectoryWatch(
        projectId: string,
        existingContentHashes: readonly string[],
      ): Promise<DirectoryWatchStartResult | null>;
      activateImportDirectoryWatch(watchId: string): Promise<void>;
      acknowledgeImportDirectoryFile(
        watchId: string,
        importId: string,
        disposition: DirectoryImportDisposition,
      ): Promise<void>;
      stopImportDirectoryWatch(watchId: string): Promise<void>;
      importAgentPaths(request: AgentPathImportRequest): Promise<AgentPathImportResult>;
      subscribeImportDirectory(listener: (event: DirectoryImportEvent) => void): () => void;
      windowAction(action: 'close' | 'minimize' | 'toggle-maximize' | 'apply-ui-scale'): Promise<void>;
      zoomStep(step: number | 'reset'): Promise<void>;
      subscribeUiScale(listener: (scale: number) => void): () => void;
      openTranscriptWindow(payload: TranscriptWindowPayload): Promise<void>;
      subscribeTranscriptWindow(listener: (payload: TranscriptWindowPayload) => void): () => void;
      agentWorkbench: DesktopAgentWorkbenchApi;
      revealExport(destinationId: string, filename: string): Promise<void>;
      projectStore(request: ProjectStoreRequest): Promise<ProjectStoreResponse>;
      editorCredentials(): Promise<EditorBootstrapInfo>;
      updates: DesktopUpdateApi;
      inference: DesktopInferenceApi;
    };
  }
}
