import assert from 'node:assert/strict';
import {
  isCompatibleMcpServerName,
  LEGACY_MCP_STATUS_TOOL,
  LEGACY_MCP_STATUS_TOOLS,
  MCP_PROTOCOL_SERVER_NAME,
  MCP_STATUS_TOOL,
  PRODUCT,
  PRODUCT_DISPLAY_VERSION,
  PRODUCT_MACHINE_STATE_DIR_ENV,
  PRODUCT_NAME,
  PRODUCT_SLUG,
  PRODUCT_VERSION,
} from './product-brand';
import {
  applyLegacyEnvironmentAliases,
  migrateLegacyEnvironmentKey,
  migrateLegacyEnvironmentText,
} from './product-compat';

assert.equal(PRODUCT_NAME, 'YoloCut');
assert.equal(PRODUCT_SLUG, 'yolocut');
assert.equal(PRODUCT_VERSION, '0.0.1');
assert.equal(PRODUCT_DISPLAY_VERSION, 'v0.0.1');
assert.equal(PRODUCT_MACHINE_STATE_DIR_ENV, 'YOLOCUT_MACHINE_STATE_DIR');
assert.equal(PRODUCT.repository.url, 'https://github.com/Hhz0823/YoloCut');
assert.equal(MCP_PROTOCOL_SERVER_NAME, 'yolocut');
assert.equal(MCP_STATUS_TOOL, 'yolocut_status');
assert.equal(LEGACY_MCP_STATUS_TOOL, 'chatcut_status');
assert.deepEqual(LEGACY_MCP_STATUS_TOOLS, ['chatcut_status', 'openchatcut_status']);
assert.equal(isCompatibleMcpServerName('yolocut'), true);
assert.equal(isCompatibleMcpServerName('chatcut'), true);
assert.equal(isCompatibleMcpServerName('openchatcut'), true);
assert.equal(isCompatibleMcpServerName('other'), false);
assert.equal(migrateLegacyEnvironmentKey('CHATCUT_MCP_TOKEN'), 'YOLOCUT_MCP_TOKEN');
assert.equal(migrateLegacyEnvironmentKey('OPENCHATCUT_DATA_DIR'), 'YOLOCUT_DATA_DIR');
assert.equal(migrateLegacyEnvironmentKey('UNRELATED'), 'UNRELATED');
assert.equal(
  migrateLegacyEnvironmentText('CHATCUT_A=1\nexport OPENCHATCUT_B=2\nVALUE=CHATCUT_C\n'),
  'YOLOCUT_A=1\nexport YOLOCUT_B=2\nVALUE=CHATCUT_C\n',
);
const environment: Record<string, string | undefined> = {
  YOLOCUT_MCP_TOKEN: 'current',
  CHATCUT_MCP_TOKEN: 'recent',
  OPENCHATCUT_MCP_TOKEN: 'older',
  CHATCUT_DATA_DIR: 'recent-data',
  OPENCHATCUT_DATA_DIR: 'older-data',
};
applyLegacyEnvironmentAliases(environment);
assert.equal(environment.YOLOCUT_MCP_TOKEN, 'current', 'current values always win');
assert.equal(environment.YOLOCUT_DATA_DIR, 'recent-data', 'newer legacy alias wins');

console.log('product-brand.verify: YoloCut identity and isolated legacy compatibility aliases OK');
