import { lstat, readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import type { ZCodePublicStatus } from '../shared/zcode.ts';
import {
  isZCodePort,
  ZCODE_PORT_END,
  ZCODE_PORT_START,
  ZCODE_REQUIRED_MODEL,
  zcodeBaseUrl,
} from './zcode-policy.ts';

const FILE_LIMITS = Object.freeze({
  state: 1_000_000,
  settings: 100_000,
  key: 4_096,
});

interface ZCodeState {
  readonly port?: unknown;
  readonly launcherVersion?: unknown;
}

interface ZCodeManagerSettings {
  readonly preferredPort?: unknown;
}

interface LocalJsonResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ZCodeCredentials {
  readonly apiKey: string;
  readonly baseUrl: string;
}

/** Internal discovery result. Callers must serialize only `status`. */
export interface ZCodeDiscoveryResult {
  readonly status: ZCodePublicStatus;
  readonly credentials: ZCodeCredentials | null;
}

export interface DiscoverZCodeOptions {
  /** Test hook. Production always resolves LOCALAPPDATA/ZCodeAntigravity. */
  readonly rootDir?: string;
  /** Test hook. Production candidates come only from ZCode's bounded port range. */
  readonly candidatePorts?: readonly number[];
  readonly platform?: NodeJS.Platform;
  readonly localAppData?: string;
}

function publicStatus(overrides: Partial<ZCodePublicStatus>): ZCodePublicStatus {
  return Object.freeze({
    supported: true,
    installed: false,
    running: false,
    authenticated: false,
    keyAvailable: false,
    port: null,
    baseUrl: null,
    version: null,
    models: [],
    message: '未检测到 ZCode Antigravity',
    ...overrides,
  });
}

async function isPlainDirectory(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Read only fixed-name regular files. Symlinks and oversized files fail closed. */
async function readBoundedRegularFile(rootDir: string, name: string, maxBytes: number): Promise<string | null> {
  const path = join(rootDir, name);
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function parseObject(text: string | null): Record<string, unknown> {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function validPort(value: unknown): number | null {
  const port = typeof value === 'number' ? value : Number.NaN;
  return Number.isSafeInteger(port) && port >= 1_024 && port <= 65_535 ? port : null;
}

function safeVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const version = value.trim();
  return version.length > 0 && version.length <= 64 && /^[a-zA-Z0-9.+_-]+$/.test(version)
    ? version
    : null;
}

function safeModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((row) => {
    const id = typeof row === 'string'
      ? row
      : row && typeof row === 'object'
        ? typeof (row as { id?: unknown }).id === 'string'
          ? (row as { id: string }).id
          : typeof (row as { name?: unknown }).name === 'string'
            ? (row as { name: string }).name
            : ''
        : '';
    const trimmed = id.trim();
    const hasForbiddenControl = trimmed.includes('\r') || trimmed.includes('\n') || trimmed.includes('\0');
    return trimmed.length > 0 && trimmed.length <= 200 && !hasForbiddenControl ? [trimmed] : [];
  }))].sort((a, b) => a.localeCompare(b));
}

function validApiKey(text: string | null): string | null {
  const key = text?.trim() ?? '';
  // Header-safe visible ASCII only. The bundled manager generates a random token.
  return key.length >= 8 && key.length <= FILE_LIMITS.key && /^[\x21-\x7e]+$/.test(key) ? key : null;
}

export function zcodePortCandidates(statePort: unknown, preferredPort: unknown): number[] {
  const priority = [statePort, preferredPort].filter(isZCodePort);
  const range = Array.from(
    { length: ZCODE_PORT_END - ZCODE_PORT_START + 1 },
    (_, index) => ZCODE_PORT_START + index,
  );
  return [...new Set([...priority, ...range])];
}

function candidatePorts(
  state: ZCodeState,
  settings: ZCodeManagerSettings,
  explicit?: readonly number[],
): number[] {
  if (explicit) return [...new Set(explicit.map(validPort).filter((port): port is number => port !== null))];
  return zcodePortCandidates(state.port, settings.preferredPort);
}

function requestLocalJson(
  port: number,
  path: '/' | '/healthz' | '/v1/models',
  headers: Readonly<Record<string, string>> = {},
  timeoutMs = 800,
): Promise<LocalJsonResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, result?: LocalJsonResponse): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result!);
    };
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > FILE_LIMITS.state) {
          req.destroy(new Error('ZCode response too large'));
          return;
        }
        chunks.push(buffer);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: unknown = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = null; }
        finish(null, { status: res.statusCode ?? 0, body });
      });
      res.on('error', (error) => finish(error));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('ZCode request timed out')));
    req.on('error', (error) => finish(error));
    req.end();
  });
}

async function probeGateway(port: number): Promise<boolean> {
  try {
    const root = await requestLocalJson(port, '/');
    const marker = root.body && typeof root.body === 'object'
      ? (root.body as { message?: unknown }).message
      : null;
    if (root.status !== 200 || marker !== 'CLI Proxy API Server') return false;
    const health = await requestLocalJson(port, '/healthz');
    return health.status === 200
      && Boolean(health.body)
      && typeof health.body === 'object'
      && (health.body as { status?: unknown }).status === 'ok';
  } catch {
    return false;
  }
}

async function findGateway(ports: readonly number[]): Promise<number | null> {
  // The persisted/current candidates are first and usually make this a two-request path.
  for (const port of ports.slice(0, 3)) {
    if (await probeGateway(port)) return port;
  }
  // A stale/missing state file falls back to a small bounded concurrent scan.
  const remaining = ports.slice(3);
  for (let offset = 0; offset < remaining.length; offset += 12) {
    const batch = remaining.slice(offset, offset + 12);
    const results = await Promise.all(batch.map(async (port) => ({ port, ok: await probeGateway(port) })));
    const found = results.find((result) => result.ok);
    if (found) return found.port;
  }
  return null;
}

interface AuthenticatedModels {
  readonly authenticated: boolean;
  readonly catalogValid: boolean;
  readonly status: number;
  readonly models: string[];
}

async function authenticatedModels(port: number, apiKey: string): Promise<AuthenticatedModels> {
  try {
    const response = await requestLocalJson(port, '/v1/models', {
      Authorization: `Bearer ${apiKey}`,
    }, 3_000);
    const body = response.body && typeof response.body === 'object'
      ? response.body as { data?: unknown; models?: unknown }
      : {};
    const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : null;
    const authenticated = response.status >= 200 && response.status < 300;
    const models = authenticated && rows ? safeModelIds(rows) : [];
    return {
      authenticated,
      catalogValid: authenticated && rows !== null && models.length > 0,
      status: response.status,
      models,
    };
  } catch {
    return { authenticated: false, catalogValid: false, status: 0, models: [] };
  }
}

const MANUAL_RECOVERY = '可在“设置 → Agent 模型”中手动填写 URL、API Key 和模型。';

function catalogFailureMessage(status: number): string {
  if (status === 401 || status === 403) {
    return `ZCode 网关在线，但本地 API Key 验证失败（HTTP ${status}）。${MANUAL_RECOVERY}`;
  }
  if (status === 404) {
    return `ZCode 网关未提供实时模型目录 /v1/models。${MANUAL_RECOVERY}`;
  }
  if (status === 429) {
    return `ZCode 实时模型目录请求过于频繁（HTTP 429），请稍后重试。${MANUAL_RECOVERY}`;
  }
  if (status >= 500) {
    return `ZCode 网关暂时无法读取实时模型目录（HTTP ${status}）。${MANUAL_RECOVERY}`;
  }
  return `ZCode 实时模型目录连接超时或失败。${MANUAL_RECOVERY}`;
}

/**
 * Discover the separately managed ZCode loopback gateway without reading its
 * OAuth/account directory. The API key exists only in the returned internal
 * `credentials`; the browser receives `status` alone.
 */
export async function discoverZCode(options: DiscoverZCodeOptions = {}): Promise<ZCodeDiscoveryResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32' && !options.rootDir) {
    return { status: publicStatus({ supported: false, message: 'ZCode 自动发现当前仅支持 Windows' }), credentials: null };
  }
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA ?? '';
  const rootDir = options.rootDir ?? (localAppData ? join(localAppData, 'ZCodeAntigravity') : '');
  if (!rootDir || !(await isPlainDirectory(rootDir))) {
    return { status: publicStatus({ message: '未检测到 ZCode Antigravity 本机数据目录' }), credentials: null };
  }

  const [stateText, settingsText, keyText] = await Promise.all([
    readBoundedRegularFile(rootDir, 'state.json', FILE_LIMITS.state),
    readBoundedRegularFile(rootDir, 'manager-settings.json', FILE_LIMITS.settings),
    readBoundedRegularFile(rootDir, 'local-api-key', FILE_LIMITS.key),
  ]);
  const state = parseObject(stateText) as ZCodeState;
  const settings = parseObject(settingsText) as ZCodeManagerSettings;
  const version = safeVersion(state.launcherVersion);
  const apiKey = validApiKey(keyText);
  const port = await findGateway(candidatePorts(state, settings, options.candidatePorts));

  if (port === null) {
    return {
      status: publicStatus({
        installed: true,
        keyAvailable: apiKey !== null,
        version,
        message: `已安装 ZCode，但 127.0.0.1:${ZCODE_PORT_START}..${ZCODE_PORT_END} 内未找到有效网关。请先启动 ZCode。${MANUAL_RECOVERY}`,
      }),
      credentials: null,
    };
  }

  const baseUrl = zcodeBaseUrl(port);
  if (!apiKey) {
    return {
      status: publicStatus({
        installed: true,
        running: true,
        port,
        baseUrl,
        version,
        message: `ZCode 网关在线，但未找到有效的本地 API Key。${MANUAL_RECOVERY}`,
      }),
      credentials: null,
    };
  }

  const catalog = await authenticatedModels(port, apiKey);
  if (!catalog.authenticated) {
    return {
      status: publicStatus({
        installed: true,
        running: true,
        keyAvailable: true,
        port,
        baseUrl,
        version,
        message: catalogFailureMessage(catalog.status),
      }),
      credentials: null,
    };
  }

  if (!catalog.catalogValid) {
    return {
      status: publicStatus({
        installed: true,
        running: true,
        keyAvailable: true,
        port,
        baseUrl,
        version,
        message: `ZCode 已通过本地 API Key 鉴权，但 /v1/models 未返回有效的实时模型目录；不会使用状态文件缓存兜底。${MANUAL_RECOVERY}`,
      }),
      credentials: null,
    };
  }

  const models = catalog.models;
  if (!models.includes(ZCODE_REQUIRED_MODEL)) {
    return {
      status: publicStatus({
        installed: true,
        running: true,
        keyAvailable: true,
        port,
        baseUrl,
        version,
        models,
        message: `ZCode 已通过本地 API Key 鉴权，但实时模型目录中不存在 ${ZCODE_REQUIRED_MODEL}。${MANUAL_RECOVERY}`,
      }),
      credentials: null,
    };
  }

  return {
    status: publicStatus({
      installed: true,
      running: true,
      authenticated: true,
      keyAvailable: true,
      port,
      baseUrl,
      version,
      models,
      message: `ZCode 已就绪 · 实时验证 ${models.length} 个模型 · ${ZCODE_REQUIRED_MODEL} 可用`,
    }),
    credentials: Object.freeze({ apiKey, baseUrl }),
  };
}

export function selectZCodeModel(models: readonly string[]): string {
  if (models.includes(ZCODE_REQUIRED_MODEL)) return ZCODE_REQUIRED_MODEL;
  throw new Error(`ZCode 实时模型目录中不存在 ${ZCODE_REQUIRED_MODEL}`);
}

export function zcodeSettingsPatch(result: ZCodeDiscoveryResult): Record<string, string> {
  if (!result.status.authenticated || !result.credentials) {
    throw new Error(result.status.message);
  }
  return {
    LLM_PROVIDER: 'zcode',
    LLM_ZCODE_API_KEY: result.credentials.apiKey,
    LLM_ZCODE_BASE_URL: result.credentials.baseUrl,
    LLM_ZCODE_MODEL: selectZCodeModel(result.status.models),
  };
}
