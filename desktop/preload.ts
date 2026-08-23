import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import {
  importLocalMediaFromFile,
  type LocalMediaPreloadDependencies,
} from './local-media-bridge.ts';
import {
  PROJECT_STORE_CHANNEL,
  type ProjectStoreRequest,
  type ProjectStoreResponse,
} from '../shared/project-store-transport.ts';
import {
  EDITOR_CREDENTIALS_CHANNEL,
  type EditorBootstrapInfo,
} from '../shared/editor-auth-transport.ts';
import {
  DESKTOP_UPDATE_CHANNELS,
  isDesktopUpdateState,
  type DesktopUpdateCheckSource,
  type DesktopUpdateState,
} from '../shared/desktop-update.ts';
import {
  DESKTOP_INFERENCE_CHANNELS,
  isDesktopAsrResponse,
  isDesktopClapResponse,
  isDesktopInferenceCapabilities,
  isDesktopInferenceProgress,
  isDesktopModelLoadResponse,
  isDesktopSemanticResponse,
  isDesktopRhythmResponse,
  type DesktopAsrPreloadRequest,
  type DesktopAsrRequest,
  type DesktopAsrResponse,
  type DesktopClapRequest,
  type DesktopClapResponse,
  type DesktopInferenceCapabilities,
  type DesktopInferenceProgress,
  type DesktopModelLoadResponse,
  type DesktopSemanticRequest,
  type DesktopSemanticResponse,
  type DesktopRhythmRequest,
  type DesktopRhythmResponse,
} from '../shared/desktop-inference.ts';
import {
  AGENT_PATH_IMPORT_CHANNEL,
  DIRECTORY_IMPORT_CHANNELS,
  isDirectoryImportEvent,
  isDirectoryWatchStartResult,
  type DirectoryImportDisposition,
  type DirectoryImportEvent,
  type AgentPathImportRequest,
  type AgentPathImportResult,
  type DirectoryWatchStartResult,
} from '../shared/directory-import.ts';
import { isTranscriptWindowPayload, TRANSCRIPT_WINDOW_CHANNELS, type TranscriptWindowPayload } from '../shared/transcript-window.ts';
import {
  AGENT_WORKBENCH_CHANNELS,
  isAgentWorkbenchState,
  type AgentWorkbenchDockRequest,
  type AgentWorkbenchRequest,
  type AgentWorkbenchState,
} from '../shared/agent-workbench.ts';
import { DESKTOP_LOCALE_CHANNEL, type DesktopLocale } from '../shared/desktop-locale.ts';
import {
  AUTO_EDIT_SOURCE_CHANNELS,
  isAutoEditSourceImportResult,
  isAutoEditSourceSelection,
  type AutoEditSourceImportRequest,
  type AutoEditSourceImportResult,
  type AutoEditSourceSelection,
} from '../shared/auto-edit-source.ts';

export interface DesktopExportDirectoryGrant {
  readonly grantId: string;
  readonly label: string;
}

export interface DesktopExportFileGrant extends DesktopExportDirectoryGrant {
  readonly filename: string;
}

export interface DesktopUpdateApi {
  getState(): Promise<DesktopUpdateState>;
  check(source: DesktopUpdateCheckSource): Promise<DesktopUpdateState>;
  download(): Promise<DesktopUpdateState>;
  install(): Promise<DesktopUpdateState>;
  subscribe(listener: (state: DesktopUpdateState) => void): () => void;
}
export interface DesktopInferenceApi {
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

export interface DesktopAgentWorkbenchApi {
  getState(): Promise<AgentWorkbenchState>;
  detach(request: AgentWorkbenchRequest): Promise<AgentWorkbenchState>;
  dock(request: AgentWorkbenchDockRequest): Promise<AgentWorkbenchState>;
  subscribe(listener: (state: AgentWorkbenchState) => void): () => void;
}


export interface YoloCutDesktopApi {
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
}

const localMediaPreloadDependencies: LocalMediaPreloadDependencies<File> = {
  getPathForFile: webUtils.getPathForFile.bind(webUtils),
  invoke: ipcRenderer.invoke.bind(ipcRenderer),
};

async function invokeDesktopUpdate(
  channel: string,
  ...args: unknown[]
): Promise<DesktopUpdateState> {
  const state: unknown = await ipcRenderer.invoke(channel, ...args);
  if (!isDesktopUpdateState(state)) throw new Error('invalid desktop update state');
  return state;
}

const api: YoloCutDesktopApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file) || undefined,
  platform: process.platform,
  setLocale: (locale) => ipcRenderer.invoke(DESKTOP_LOCALE_CHANNEL, locale) as Promise<void>,
  selectDirectory: (defaultPath) =>
    ipcRenderer.invoke('yolocut:select-directory', defaultPath) as Promise<string | null>,
  selectAutoEditSources: async () => {
    const value: unknown = await ipcRenderer.invoke(AUTO_EDIT_SOURCE_CHANNELS.select);
    if (value === null) return null;
    if (!isAutoEditSourceSelection(value)) throw new Error('invalid auto-edit source selection');
    return value;
  },
  listAutoEditSources: async (grantId) => {
    const value: unknown = await ipcRenderer.invoke(AUTO_EDIT_SOURCE_CHANNELS.list, grantId);
    if (value === null) return null;
    if (!isAutoEditSourceSelection(value)) throw new Error('invalid auto-edit source selection');
    return value;
  },
  importAutoEditSource: async (request) => {
    const value: unknown = await ipcRenderer.invoke(AUTO_EDIT_SOURCE_CHANNELS.import, request);
    if (!isAutoEditSourceImportResult(value)) throw new Error('invalid auto-edit source import result');
    return value;
  },
  selectExportDirectory: () =>
    ipcRenderer.invoke('yolocut:select-export-directory') as Promise<DesktopExportDirectoryGrant | null>,
  selectExportFile: (suggestedFilename) =>
    ipcRenderer.invoke('yolocut:select-export-file', suggestedFilename) as Promise<DesktopExportFileGrant | null>,
  restoreExportDirectory: () =>
    ipcRenderer.invoke('yolocut:restore-export-directory') as Promise<DesktopExportDirectoryGrant | null>,
  importLocalMedia: (file) => importLocalMediaFromFile(file, localMediaPreloadDependencies),
  prepareTransparentMovProxy: (storedName) =>
    ipcRenderer.invoke('yolocut:transparent-mov-proxy', storedName) as Promise<{ src: string } | null>,
  startImportDirectoryWatch: async (projectId, existingContentHashes) => {
    const value: unknown = await ipcRenderer.invoke(
      DIRECTORY_IMPORT_CHANNELS.start, projectId, existingContentHashes,
    );
    if (value === null) return null;
    if (!isDirectoryWatchStartResult(value)) throw new Error('invalid directory watch response');
    return value;
  },
  activateImportDirectoryWatch: (watchId) =>
    ipcRenderer.invoke(DIRECTORY_IMPORT_CHANNELS.activate, watchId) as Promise<void>,
  importAgentPaths: (request) =>
    ipcRenderer.invoke(AGENT_PATH_IMPORT_CHANNEL, request) as Promise<AgentPathImportResult>,
  acknowledgeImportDirectoryFile: (watchId, importId, disposition) =>
    ipcRenderer.invoke(
      DIRECTORY_IMPORT_CHANNELS.acknowledge, watchId, importId, disposition,
    ) as Promise<void>,
  stopImportDirectoryWatch: (watchId) =>
    ipcRenderer.invoke(DIRECTORY_IMPORT_CHANNELS.stop, watchId) as Promise<void>,
  subscribeImportDirectory: (listener) => {
    const handleImported = (_event: IpcRendererEvent, value: unknown): void => {
      if (isDirectoryImportEvent(value)) listener(value);
    };
    ipcRenderer.on(DIRECTORY_IMPORT_CHANNELS.imported, handleImported);
    return () => { ipcRenderer.removeListener(DIRECTORY_IMPORT_CHANNELS.imported, handleImported); };
  },
  windowAction: (action) =>
    ipcRenderer.invoke('yolocut:window-action', action) as Promise<void>,
  zoomStep: (step) =>
    ipcRenderer.invoke('yolocut:zoom-step', step) as Promise<void>,
  subscribeUiScale: (listener) => {
    const handleScale = (_event: IpcRendererEvent, value: unknown): void => {
      if (typeof value === 'number' && Number.isFinite(value)) listener(value);
    };
    ipcRenderer.on('yolocut:ui-scale-changed', handleScale);
    return () => { ipcRenderer.removeListener('yolocut:ui-scale-changed', handleScale); };
  },
  openTranscriptWindow: (payload) =>
    ipcRenderer.invoke(TRANSCRIPT_WINDOW_CHANNELS.open, payload) as Promise<void>,
  subscribeTranscriptWindow: (listener) => {
    const handleUpdate = (_event: IpcRendererEvent, value: unknown): void => {
      if (isTranscriptWindowPayload(value)) listener(value);
    };
    ipcRenderer.on(TRANSCRIPT_WINDOW_CHANNELS.update, handleUpdate);
    return () => { ipcRenderer.removeListener(TRANSCRIPT_WINDOW_CHANNELS.update, handleUpdate); };
  },
  agentWorkbench: {
    getState: async () => {
      const value: unknown = await ipcRenderer.invoke(AGENT_WORKBENCH_CHANNELS.getState);
      if (!isAgentWorkbenchState(value)) throw new Error('invalid Agent workbench state');
      return value;
    },
    detach: async (request) => {
      const value: unknown = await ipcRenderer.invoke(AGENT_WORKBENCH_CHANNELS.detach, request);
      if (!isAgentWorkbenchState(value)) throw new Error('invalid Agent workbench state');
      return value;
    },
    dock: async (request) => {
      const value: unknown = await ipcRenderer.invoke(AGENT_WORKBENCH_CHANNELS.dock, request);
      if (!isAgentWorkbenchState(value)) throw new Error('invalid Agent workbench state');
      return value;
    },
    subscribe: (listener) => {
      const handleState = (_event: IpcRendererEvent, value: unknown): void => {
        if (isAgentWorkbenchState(value)) listener(value);
      };
      ipcRenderer.on(AGENT_WORKBENCH_CHANNELS.state, handleState);
      return () => { ipcRenderer.removeListener(AGENT_WORKBENCH_CHANNELS.state, handleState); };
    },
  },
  revealExport: (destinationId, filename) =>
    ipcRenderer.invoke('yolocut:reveal-export', destinationId, filename) as Promise<void>,
  projectStore: (request) =>
    ipcRenderer.invoke(PROJECT_STORE_CHANNEL, request) as Promise<ProjectStoreResponse>,
  editorCredentials: () =>
    ipcRenderer.invoke(EDITOR_CREDENTIALS_CHANNEL) as Promise<EditorBootstrapInfo>,
  inference: {
    setEnabled: (enabled) =>
      ipcRenderer.invoke(DESKTOP_INFERENCE_CHANNELS.setEnabled, enabled) as Promise<void>,
    getCapabilities: async () => {
      const value: unknown = await ipcRenderer.invoke(DESKTOP_INFERENCE_CHANNELS.capabilities);
      if (!isDesktopInferenceCapabilities(value)) throw new Error('invalid desktop inference capabilities');
      return value;
    },
    preloadAsr: async (request) => {
      const value: unknown = await ipcRenderer.invoke(DESKTOP_INFERENCE_CHANNELS.preloadAsr, request);
      if (!isDesktopModelLoadResponse(value)) throw new Error('invalid desktop ASR preload response');
      return value;
    },
    transcribe: async (request) => {
      const value: unknown = await ipcRenderer.invoke(DESKTOP_INFERENCE_CHANNELS.transcribe, request);
      if (!isDesktopAsrResponse(value)) throw new Error('invalid desktop ASR response');
      return value;
    },
    semantic: async (request) => {
      const value: unknown = await ipcRenderer.invoke(DESKTOP_INFERENCE_CHANNELS.semantic, request);
      if (!isDesktopSemanticResponse(value)) throw new Error('invalid desktop semantic response');
      return value;
    },
    clap: async (request) => {
      const value: unknown = await ipcRenderer.invoke(DESKTOP_INFERENCE_CHANNELS.clap, request);
      if (!isDesktopClapResponse(value)) throw new Error('invalid desktop CLAP response');
      return value;
    },
    rhythm: async (request) => {
      const value: unknown = await ipcRenderer.invoke(DESKTOP_INFERENCE_CHANNELS.rhythm, request);
      if (!isDesktopRhythmResponse(value)) throw new Error('invalid desktop rhythm response');
      return value;
    },
    cancel: (requestId) =>
      ipcRenderer.invoke(DESKTOP_INFERENCE_CHANNELS.cancel, requestId) as Promise<void>,
    subscribeProgress: (listener) => {
      const handleProgress = (_event: IpcRendererEvent, value: unknown): void => {
        if (isDesktopInferenceProgress(value)) listener(value);
      };
      ipcRenderer.on(DESKTOP_INFERENCE_CHANNELS.progress, handleProgress);
      return () => { ipcRenderer.removeListener(DESKTOP_INFERENCE_CHANNELS.progress, handleProgress); };
    },
  },
  updates: {
    getState: () => invokeDesktopUpdate(DESKTOP_UPDATE_CHANNELS.getState),
    check: (source) => invokeDesktopUpdate(DESKTOP_UPDATE_CHANNELS.check, source),
    download: () => invokeDesktopUpdate(DESKTOP_UPDATE_CHANNELS.download),
    install: () => invokeDesktopUpdate(DESKTOP_UPDATE_CHANNELS.install),
    subscribe: (listener) => {
      const handleState = (_event: IpcRendererEvent, state: unknown): void => {
        if (isDesktopUpdateState(state)) listener(state);
      };
      ipcRenderer.on(DESKTOP_UPDATE_CHANNELS.state, handleState);
      return () => { ipcRenderer.removeListener(DESKTOP_UPDATE_CHANNELS.state, handleState); };
    },
  },
};

contextBridge.exposeInMainWorld('yoloCutDesktop', api);
