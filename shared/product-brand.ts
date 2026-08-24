import {
  isLegacyMcpStatusTool,
  isLegacyProductSlug,
  LEGACY_MCP_STATUS_TOOLS,
  LEGACY_PRODUCT_NAMES,
  type LegacyProductSlug,
} from './product-compat.ts';

/** Single runtime source of truth for public YoloCut product metadata. */
export const PRODUCT = {
  name: 'YoloCut',
  slug: 'yolocut',
  version: '0.0.2',
  displayVersion: 'v0.0.2',
  appId: 'dev.yolocut.desktop',
  desktopName: 'yolocut.desktop',
  repository: {
    owner: 'Hhz0823',
    name: 'YoloCut',
    url: 'https://github.com/Hhz0823/YoloCut',
  },
} as const;

export const PRODUCT_NAME = PRODUCT.name;
export const PRODUCT_SLUG = PRODUCT.slug;
export const PRODUCT_VERSION = PRODUCT.version;
export const PRODUCT_DISPLAY_VERSION = PRODUCT.displayVersion;
export const MCP_PROTOCOL_SERVER_NAME = PRODUCT.slug;
export const MCP_STATUS_TOOL = 'yolocut_status' as const;
export const PRODUCT_DATA_DIR_ENV = 'YOLOCUT_DATA_DIR' as const;
export const PRODUCT_MACHINE_STATE_DIR_ENV = 'YOLOCUT_MACHINE_STATE_DIR' as const;
export const MIGRATED_MEDIA_DIR_ENV = 'YOLOCUT_LEGACY_MEDIA_DIR' as const;

/** Transitional singular exports retained for modules not yet array-aware. */
export const LEGACY_PRODUCT_NAME = LEGACY_PRODUCT_NAMES[0];
export const LEGACY_MCP_STATUS_TOOL = LEGACY_MCP_STATUS_TOOLS[0];
export const LEGACY_MEDIA_DIR_ENV = MIGRATED_MEDIA_DIR_ENV;

export { LEGACY_MCP_STATUS_TOOLS, LEGACY_PRODUCT_SLUGS } from './product-compat.ts';

export function isCompatibleMcpServerName(
  value: unknown,
): value is typeof PRODUCT_SLUG | LegacyProductSlug {
  return value === PRODUCT_SLUG || isLegacyProductSlug(value);
}

export function isCompatibleMcpStatusTool(value: unknown): boolean {
  return value === MCP_STATUS_TOOL || isLegacyMcpStatusTool(value);
}
