import { fetchWithEditorSession } from '../persist/projectStoreTransport';
import {
  isCompatibleMcpServerName,
  LEGACY_MCP_STATUS_TOOLS,
  MCP_PROTOCOL_SERVER_NAME,
  MCP_STATUS_TOOL,
  PRODUCT_NAME,
  PRODUCT_SLUG,
} from '../../shared/product-brand';

export type McpToolExposureMode = 'full' | 'progressive';

export interface McpConnectionSnippet {
  id: 'codex-powershell' | 'codex-bash' | 'claude-code' | 'gemini-cli' | 'cursor' | 'generic';
  label: string;
  code: string;
}

export interface McpConnectionManifestView {
  version: 1;
  server: 'yolocut';
  product: {
    name: 'YoloCut';
    clientName: 'yolocut';
    protocolNamespace: 'yolocut';
    statusTools: readonly [typeof MCP_STATUS_TOOL, ...typeof LEGACY_MCP_STATUS_TOOLS];
  };
  transport: 'streamable-http';
  endpointPath: string;
  progressiveEndpointPath: string;
  skillBaseline: string;
  readiness: {
    endpoint: 'ready';
    fullEditing: 'ready' | 'open_editor_required' | 'catalog_mismatch';
  };
  session: {
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
  };
  browserRequiredFor: readonly string[];
}

export interface McpProbeResult {
  serverName: string;
  protocolVersion: string;
  toolCount: number;
  hasConnectionManifest: boolean;
  checkedAt: string;
}

const MCP_PATH = '/api/external-mcp/mcp';
const MCP_PROTOCOL_VERSION = '2025-03-26';

function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function bashLiteral(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function mcpEndpoint(origin: string, exposure: McpToolExposureMode): string {
  const endpoint = new URL(MCP_PATH, origin);
  if (exposure === 'progressive') endpoint.searchParams.set('toolExposure', 'progressive');
  return endpoint.toString();
}

export function mcpConnectionSnippets(endpoint: string, token: string): McpConnectionSnippet[] {
  const authorization = `Authorization: Bearer ${token}`;
  return [
    {
      id: 'codex-powershell',
      label: 'Codex · Windows PowerShell',
      code: [
        `$env:YOLOCUT_MCP_TOKEN = ${powershellLiteral(token)}`,
        `codex mcp add ${PRODUCT_SLUG} --url ${powershellLiteral(endpoint)} --bearer-token-env-var YOLOCUT_MCP_TOKEN`,
      ].join('\n'),
    },
    {
      id: 'codex-bash',
      label: 'Codex · macOS / Linux',
      code: [
        `export YOLOCUT_MCP_TOKEN=${bashLiteral(token)}`,
        `codex mcp add ${PRODUCT_SLUG} --url ${bashLiteral(endpoint)} --bearer-token-env-var YOLOCUT_MCP_TOKEN`,
      ].join('\n'),
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      code: `claude mcp add --transport http --header ${powershellLiteral(authorization)} ${PRODUCT_SLUG} ${powershellLiteral(endpoint)}`,
    },
    {
      id: 'gemini-cli',
      label: 'Gemini CLI',
      code: `gemini mcp add --transport http ${PRODUCT_SLUG} ${powershellLiteral(endpoint)} --header ${powershellLiteral(authorization)}`,
    },
    {
      id: 'cursor',
      label: 'Cursor · mcp.json',
      code: JSON.stringify({
        mcpServers: {
          [PRODUCT_SLUG]: {
            type: 'http',
            url: endpoint,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      }, null, 2),
    },
    {
      id: 'generic',
      label: 'Generic Streamable HTTP',
      code: JSON.stringify({
        name: PRODUCT_SLUG,
        transport: 'streamable-http',
        url: endpoint,
        headers: { Authorization: `Bearer ${token}` },
      }, null, 2),
    },
  ];
}

export function mcpStarterPrompt(): string {
  return [
    `连接 ${PRODUCT_NAME} 后，请先调用 ${MCP_STATUS_TOOL} 和 get_connection_manifest（旧状态别名 ${LEGACY_MCP_STATUS_TOOLS.join(' / ')} 仍兼容）。`,
    '用 list_projects 查找工程，再用 target_project 将当前 MCP 会话绑定到唯一工程。',
    '通过 load_skill 或 ToolSearch 读取任务流程与精确工具参数。',
    '调用 begin_edit_session（默认 approvalMode="manual"），把返回的 editSessionId 传给每个读取和剪辑工具。',
    '完成剪辑后调用 review_edit_session，再轮询 get_edit_session；只有 status="applied" 才能报告完成。',
    '若 fullEditing 不是 ready，请先让用户打开目标工程编辑器；不要把 server-direct 回退描述成完整功能。',
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseMcpJsonRpcBody(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('MCP 返回了空响应');
  const candidates = trimmed.startsWith('{') || trimmed.startsWith('[')
    ? [trimmed]
    : trimmed.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== '[DONE]');
  for (const candidate of candidates.reverse()) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        const entry = parsed.find(isRecord);
        if (entry) return entry;
      }
      if (isRecord(parsed)) return parsed;
    } catch {
      // Continue through other SSE data lines before failing closed below.
    }
  }
  throw new Error('MCP 返回的不是有效 JSON-RPC 响应');
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(12_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function mcpPost(
  endpoint: string,
  token: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  sessionId?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const details = (await response.text()).trim();
    throw new Error(`MCP HTTP ${response.status}${details ? `: ${details}` : ''}`);
  }
  return response;
}

/** Perform a real initialize -> initialized -> tools/list -> DELETE exchange. */
export async function probeMcpConnection(
  endpoint: string,
  token: string,
  signal?: AbortSignal,
): Promise<McpProbeResult> {
  const activeSignal = requestSignal(signal);
  let sessionId = '';
  try {
    const initialize = await mcpPost(endpoint, token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: `${PRODUCT_SLUG}-connection-center`, version: '1.0.0' },
      },
    }, activeSignal);
    sessionId = initialize.headers.get('mcp-session-id') ?? '';
    if (!sessionId) throw new Error('MCP 初始化未返回 session id');
    const initializedBody = parseMcpJsonRpcBody(await initialize.text());
    const initializeResult = isRecord(initializedBody.result) ? initializedBody.result : null;
    const serverInfo = initializeResult && isRecord(initializeResult.serverInfo)
      ? initializeResult.serverInfo
      : null;
    const protocolVersion = initializeResult?.protocolVersion;
    if (!serverInfo || !isCompatibleMcpServerName(serverInfo.name) || typeof protocolVersion !== 'string') {
      throw new Error(`MCP 初始化响应缺少 ${PRODUCT_NAME} serverInfo`);
    }

    await mcpPost(endpoint, token, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }, activeSignal, sessionId);
    const listed = await mcpPost(endpoint, token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, activeSignal, sessionId);
    const listBody = parseMcpJsonRpcBody(await listed.text());
    const listResult = isRecord(listBody.result) ? listBody.result : null;
    const tools = Array.isArray(listResult?.tools) ? listResult.tools : null;
    if (!tools) throw new Error('MCP tools/list 响应缺少工具目录');
    const toolNames = tools.flatMap((tool) => (
      isRecord(tool) && typeof tool.name === 'string' ? [tool.name] : []
    ));
    return {
      serverName: String(serverInfo.name),
      protocolVersion,
      toolCount: toolNames.length,
      hasConnectionManifest: toolNames.includes('get_connection_manifest'),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    if (sessionId) {
      await fetch(endpoint, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId,
        },
        cache: 'no-store',
      }).catch(() => undefined);
    }
  }
}

export async function fetchMcpConnectionManifest(
  signal?: AbortSignal,
): Promise<McpConnectionManifestView> {
  const response = await fetchWithEditorSession('/api/external-agent/diagnostics', {
    method: 'GET',
    signal,
  });
  if (!response.ok) throw new Error(`MCP 诊断失败: HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!isRecord(value)
    || value.version !== 1
    || value.server !== MCP_PROTOCOL_SERVER_NAME
    || !isRecord(value.product)
    || value.product.name !== PRODUCT_NAME
    || !isRecord(value.readiness)
    || !isRecord(value.capabilityCoverage)
    || !isRecord(value.editors)) {
    throw new Error('MCP 诊断返回了无效响应');
  }
  return value as unknown as McpConnectionManifestView;
}
