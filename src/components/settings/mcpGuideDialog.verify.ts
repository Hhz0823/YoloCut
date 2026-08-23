import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./McpGuide.tsx', import.meta.url), 'utf8');

assert.match(source, /import \{ createPortal \} from 'react-dom'/,
  'the MCP guide must use a document-level portal');
assert.match(source, /createPortal\(dialog, document\.body\)/,
  'the MCP guide must escape filtered title-bar containing blocks');
assert.match(source, /data-cc-mcp-guide-dialog/,
  'the viewport dialog needs a stable desktop-smoke selector');
assert.match(source, /role="dialog"/);
assert.match(source, /aria-modal="true"/);
assert.match(source, /aria-labelledby="cc-mcp-guide-title"/);
assert.match(source, /event\.key === 'Escape'/,
  'the connection center must remain closable when pointer geometry is unavailable');
assert.match(source, /<button type="button" autoFocus onClick=\{onClose\}/,
  'the close action must be immediately keyboard reachable');

console.log('mcpGuideDialog.verify: body portal, viewport geometry, and close accessibility passed');
