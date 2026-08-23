import toolCatalog from '../../assets/agent/yolocut-tool-schemas.json';
import { EXTERNAL_SESSION_TOOLS } from '../../src/agent/external-tool-shape.js';
import {
  LEGACY_MCP_STATUS_TOOLS,
  MCP_PROTOCOL_SERVER_NAME,
  MCP_STATUS_TOOL,
  PRODUCT_NAME,
  PRODUCT_SLUG,
} from '../../shared/product-brand.ts';

export const MCP_ENDPOINT_PATH = '/api/external-mcp/mcp';
export const MCP_PROGRESSIVE_ENDPOINT_PATH = `${MCP_ENDPOINT_PATH}?toolExposure=progressive`;

export const MCP_BROWSER_REQUIRED_FOR = [
  'visual/canvas inspection',
  'generation',
  'upload',
  'network',
  'preset',
  'render',
  'export',
  'manual approval',
] as const;

export interface McpManifestEditorStatus {
  projectId: string;
  editorId: string;
  baseRevision: string;
  connected: boolean;
  toolCount: number;
}

export interface McpConnectionManifestInput {
  skillBaseline: string;
  connectedProjectIds: string[];
  editors: McpManifestEditorStatus[];
  registeredToolNames: string[];
  currentToolNames: string[];
  fullToolNames: string[];
  exposureMode: 'full' | 'progressive';
  bindingMode: 'browser' | 'offline' | null;
  sessionBinding: unknown;
}

export interface McpConnectionManifest {
  version: 1;
  server: 'yolocut';
  product: {
    name: 'YoloCut';
    clientName: 'yolocut';
    protocolNamespace: 'yolocut';
    statusTools: readonly [typeof MCP_STATUS_TOOL, ...typeof LEGACY_MCP_STATUS_TOOLS];
  };
  transport: 'streamable-http';
  endpointPath: typeof MCP_ENDPOINT_PATH;
  progressiveEndpointPath: typeof MCP_PROGRESSIVE_ENDPOINT_PATH;
  authentication: 'bearer';
  skillBaseline: string;
  readiness: {
    endpoint: 'ready';
    fullEditing: 'ready' | 'open_editor_required' | 'catalog_mismatch';
  };
  session: {
    bindingMode: 'browser' | 'offline' | null;
    binding: unknown;
    exposureMode: 'full' | 'progressive';
    availableToolTier: 'browser' | 'server-direct';
    currentToolCount: number;
    fullToolCount: number;
  };
  capabilityCoverage: {
    canonicalToolCount: number;
    availableCanonicalToolCount: number;
    complete: boolean;
    missingCanonicalTools: string[];
    externalEditorCatalogToolCount: number;
    registeredEditorToolCount: number;
    missingRegisteredEditorTools: string[];
  };
  editors: {
    liveCount: number;
    connectedProjectIds: string[];
    entries: McpManifestEditorStatus[];
  };
  discovery: {
    catalogMethod: 'tools/list';
    searchTool: 'ToolSearch';
    skillTool: 'load_skill';
    recommendedExposure: 'full';
    progressiveRequires: 'notifications/tools/list_changed';
  };
  workflow: Array<{ step: number; action: string; success: string }>;
  browserRequiredFor: readonly string[];
  offlineFallback: string;
  safety: {
    defaultApprovalMode: 'manual';
    editSessionRequired: true;
    appliedStatusRequiredBeforeClaimingCompletion: true;
  };
}

function uniqueNames(names: readonly string[]): string[] {
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

/**
 * Build a machine-readable contract from the catalog registered by the live
 * editor and the tools visible to this MCP transport. The expected names come
 * from the same canonical schema modules as the built-in Agent, so the UI and
 * external clients never infer completeness from a hard-coded count.
 */
export function buildMcpConnectionManifest(
  input: McpConnectionManifestInput,
): McpConnectionManifest {
  const canonicalNames = uniqueNames(toolCatalog.edit.map((tool) => tool.name));
  const expectedEditorNames = uniqueNames([
    ...canonicalNames,
    ...EXTERNAL_SESSION_TOOLS.map((tool) => tool.name),
  ]);
  const registeredNames = new Set(input.registeredToolNames);
  const fullNames = new Set(input.fullToolNames);
  const missingCanonicalTools = canonicalNames.filter((name) => !fullNames.has(name));
  const missingRegisteredEditorTools = expectedEditorNames.filter((name) => !registeredNames.has(name));
  const liveEditors = input.editors.filter((editor) => editor.connected);
  const browserTier = input.bindingMode === 'browser'
    || (input.bindingMode === null && input.connectedProjectIds.length > 0);
  const complete = browserTier
    && liveEditors.length > 0
    && missingCanonicalTools.length === 0
    && missingRegisteredEditorTools.length === 0;
  const fullEditing = complete
    ? 'ready'
    : liveEditors.length === 0
      ? 'open_editor_required'
      : 'catalog_mismatch';

  return {
    version: 1,
    server: MCP_PROTOCOL_SERVER_NAME,
    product: {
      name: PRODUCT_NAME,
      clientName: PRODUCT_SLUG,
      protocolNamespace: MCP_PROTOCOL_SERVER_NAME,
      statusTools: [MCP_STATUS_TOOL, ...LEGACY_MCP_STATUS_TOOLS],
    },
    transport: 'streamable-http',
    endpointPath: MCP_ENDPOINT_PATH,
    progressiveEndpointPath: MCP_PROGRESSIVE_ENDPOINT_PATH,
    authentication: 'bearer',
    skillBaseline: input.skillBaseline,
    readiness: { endpoint: 'ready', fullEditing },
    session: {
      bindingMode: input.bindingMode,
      binding: input.sessionBinding,
      exposureMode: input.exposureMode,
      availableToolTier: browserTier ? 'browser' : 'server-direct',
      currentToolCount: uniqueNames(input.currentToolNames).length,
      fullToolCount: uniqueNames(input.fullToolNames).length,
    },
    capabilityCoverage: {
      canonicalToolCount: canonicalNames.length,
      availableCanonicalToolCount: canonicalNames.length - missingCanonicalTools.length,
      complete,
      missingCanonicalTools,
      externalEditorCatalogToolCount: expectedEditorNames.length,
      registeredEditorToolCount: uniqueNames(input.registeredToolNames).length,
      missingRegisteredEditorTools,
    },
    editors: {
      liveCount: liveEditors.length,
      connectedProjectIds: [...input.connectedProjectIds],
      entries: input.editors.map((editor) => ({ ...editor })),
    },
    discovery: {
      catalogMethod: 'tools/list',
      searchTool: 'ToolSearch',
      skillTool: 'load_skill',
      recommendedExposure: 'full',
      progressiveRequires: 'notifications/tools/list_changed',
    },
    workflow: [
      { step: 1, action: MCP_STATUS_TOOL, success: 'Inspect editor and capability readiness.' },
      { step: 2, action: 'list_projects then target_project', success: 'Bind this transport to exactly one project.' },
      { step: 3, action: 'load_skill or ToolSearch', success: 'Load the task playbook and discover exact tool schemas.' },
      { step: 4, action: 'begin_edit_session', success: 'Receive an editSessionId; manual approval is the safe default.' },
      { step: 5, action: 'read and edit tools with editSessionId', success: 'Stage edits through EditorCore without mutating the live project.' },
      { step: 6, action: 'review_edit_session', success: 'Create a review proposal or atomically apply an auto session.' },
      { step: 7, action: 'get_edit_session', success: 'Only status=applied is completion.' },
    ],
    browserRequiredFor: MCP_BROWSER_REQUIRED_FOR,
    offlineFallback: 'Server-direct mode is a safe data-only subset and requires approvalMode="auto". Open the project editor for the complete surface.',
    safety: {
      defaultApprovalMode: 'manual',
      editSessionRequired: true,
      appliedStatusRequiredBeforeClaimingCompletion: true,
    },
  };
}
