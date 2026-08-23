/**
 * Compatibility aliases from the two product names that preceded YoloCut.
 * Keep every legacy identifier in this module so new product code never needs
 * to scatter historical branding through runtime modules.
 */
export const LEGACY_PRODUCT_NAMES = ['ChatCut', 'OpenChatCut'] as const;
export const LEGACY_PRODUCT_SLUGS = ['chatcut', 'openchatcut'] as const;
export const LEGACY_MCP_STATUS_TOOLS = ['chatcut_status', 'openchatcut_status'] as const;
export const LEGACY_USER_DATA_DIR_NAMES = ['ChatCut', 'OpenChatCut'] as const;
export const LEGACY_HOME_DIR_NAMES = ['.chatcut', '.openchatcut'] as const;
export const LEGACY_MCP_TOKEN_ENV_NAMES = ['CHATCUT_MCP_TOKEN', 'OPENCHATCUT_MCP_TOKEN'] as const;
export const LEGACY_MCP_TOOL_EXPOSURE_HEADERS = [
  'x-chatcut-tool-exposure',
  'x-openchatcut-tool-exposure',
] as const;
export const LEGACY_MEDIA_DIR_ENV_NAMES = [
  'CHATCUT_LEGACY_MEDIA_DIR',
  'OPENCHATCUT_LEGACY_MEDIA_DIR',
] as const;

/**
 * Durable identifiers that cannot be renamed in place without hiding or
 * duplicating existing user data. Runtime modules import these values instead
 * of embedding historical product names themselves.
 */
export const LEGACY_PERSISTENCE_IDS = Object.freeze({
  sharedDatabase: 'openchatcut',
  sharedMigrationKey: '__openchatcut_shared_store_v1__',
  sharedPendingKeysKey: '__openchatcut_shared_pending_v1__',
  mediaDatabase: 'openchatcut-media',
  mediaImportPrefix: 'openchatcut-media-import:',
  captionsDatabase: 'openchatcut-captions',
  musicIntelligenceDatabase: 'openchatcut-music-intelligence',
  exportDestinationsDatabase: 'openchatcut-export-destinations',
  serverExportRecoveryDatabase: 'openchatcut-server-export-recovery',
  geometryDatabase: 'openchatcut-geometry',
  semanticIndexDatabase: 'openchatcut-semantic-index',
  agentDockSideStorageKey: 'chatcut.agentWorkbenchDockSide.v1',
  agentRunOwnerStorageKey: 'openchatcut.agent-run-owner',
  frictionLogStorageKey: 'openchatcut.friction.log',
  agentProviderOptionsKey: 'openchatcut',
  checkpointMarkerOpen: '<openchatcut_checkpoint>',
  checkpointMarkerClose: '</openchatcut_checkpoint>',
});

/** Historical portable formats accepted at import/read boundaries only. */
export const LEGACY_PORTABLE_FORMATS = Object.freeze({
  projectJson: 'openchatcut-project@1',
  projectStream: 'openchatcut-project@2',
  projectMime: 'application/x-openchatcut-project',
  designStyle: 'openchatcut.design-style',
  plugin: 'openchatcut-plugin@1',
  autoEditBatch: 'chatcut-auto-edit-batch@1',
  autoEditSourceGrants: 'chatcut-auto-edit-source-grants@1',
  fishS2Runtime: 'openchatcut-fish-s2-runtime@1',
});
const LEGACY_ENV_PREFIXES = ['CHATCUT_', 'OPENCHATCUT_'] as const;
const CURRENT_ENV_PREFIX = 'YOLOCUT_';

export type LegacyProductSlug = typeof LEGACY_PRODUCT_SLUGS[number];
export type LegacyMcpStatusTool = typeof LEGACY_MCP_STATUS_TOOLS[number];

export function isLegacyProductSlug(value: unknown): value is LegacyProductSlug {
  return typeof value === 'string'
    && (LEGACY_PRODUCT_SLUGS as readonly string[]).includes(value);
}

export function isLegacyMcpStatusTool(value: unknown): value is LegacyMcpStatusTool {
  return typeof value === 'string'
    && (LEGACY_MCP_STATUS_TOOLS as readonly string[]).includes(value);
}

/** Convert one historical environment key to its YoloCut equivalent. */
export function migrateLegacyEnvironmentKey(name: string): string {
  const prefix = LEGACY_ENV_PREFIXES.find((candidate) => name.startsWith(candidate));
  return prefix ? `${CURRENT_ENV_PREFIX}${name.slice(prefix.length)}` : name;
}

/**
 * Make old launch scripts keep working without allowing them to override an
 * explicitly configured YoloCut value. ChatCut takes precedence over the older
 * OpenChatCut alias when both historical variables are present.
 */
export function applyLegacyEnvironmentAliases(
  env: Record<string, string | undefined>,
): void {
  const entries = Object.entries(env);
  for (const prefix of LEGACY_ENV_PREFIXES) {
    for (const [name, value] of entries) {
      if (value === undefined || !name.startsWith(prefix)) continue;
      const currentName = migrateLegacyEnvironmentKey(name);
      if (env[currentName] === undefined) env[currentName] = value;
    }
  }
}

/** Rewrite only environment variable names at the beginning of dotenv lines. */
export function migrateLegacyEnvironmentText(text: string): string {
  return text.replace(
    /(^|\r?\n)([\t ]*(?:export[\t ]+)?)(?:CHATCUT|OPENCHATCUT)_/g,
    `$1$2${CURRENT_ENV_PREFIX}`,
  );
}
