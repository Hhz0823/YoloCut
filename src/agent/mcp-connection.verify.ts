import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  mcpConnectionSnippets,
  mcpEndpoint,
  mcpStarterPrompt,
  parseMcpJsonRpcBody,
  probeMcpConnection,
} from './mcp-connection.ts';
import {
  handleMcpRequest,
  resetMcpSessionsForTest,
} from '../../server/external-agent/mcp.ts';

const full = mcpEndpoint('http://127.0.0.1:5199/editor', 'full');
const progressive = mcpEndpoint('http://127.0.0.1:5199/editor', 'progressive');
assert.equal(full, 'http://127.0.0.1:5199/api/external-mcp/mcp');
assert.equal(progressive, 'http://127.0.0.1:5199/api/external-mcp/mcp?toolExposure=progressive');

const token = "token-with-'quote";
const snippets = mcpConnectionSnippets(full, token);
assert.deepEqual(snippets.map((snippet) => snippet.id), [
  'codex-powershell',
  'codex-bash',
  'claude-code',
  'gemini-cli',
  'cursor',
  'generic',
]);
for (const snippet of snippets) {
  assert.match(snippet.code, /yolocut/i);
  assert.match(snippet.code, /5199/);
}
assert.match(snippets[0]!.code, /\$env:YOLOCUT_MCP_TOKEN/);
assert.match(snippets[0]!.code, /codex mcp add yolocut/);
assert.match(snippets[0]!.code, /token-with-''quote/, 'PowerShell literals escape apostrophes');
assert.match(snippets[1]!.code, /token-with-'"'"'quote/, 'Bash literals escape apostrophes');
assert.match(snippets[3]!.code, /gemini mcp add --transport http/);
assert.match(mcpStarterPrompt(), /status="applied"/);
assert.match(mcpStarterPrompt(), /server-direct/);
assert.match(mcpStarterPrompt(), /yolocut_status/);
assert.match(mcpStarterPrompt(), /yolocut_status/);

assert.deepEqual(parseMcpJsonRpcBody('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'), {
  jsonrpc: '2.0', id: 1, result: { ok: true },
});
assert.deepEqual(parseMcpJsonRpcBody([
  'event: message',
  'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}',
  '',
].join('\n')), {
  jsonrpc: '2.0', id: 2, result: { tools: [] },
});
assert.throws(() => parseMcpJsonRpcBody('event: ping\n\n'), /有效 JSON-RPC/);

const tokenForProbe = 'connection-probe-token';
const server = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${tokenForProbe}`) {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'invalid YoloCut MCP token' }));
    return;
  }
  void handleMcpRequest(request, response, 'http://127.0.0.1').catch((error) => {
    if (!response.headersSent) response.writeHead(500);
    response.end(error instanceof Error ? error.message : String(error));
  });
});
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert(address && typeof address !== 'string');
const probeUrl = `http://127.0.0.1:${address.port}/mcp`;
try {
  const result = await probeMcpConnection(probeUrl, tokenForProbe);
  assert.equal(result.serverName, 'yolocut');
  assert.equal(result.hasConnectionManifest, true);
  assert(result.toolCount > 10);
  await assert.rejects(probeMcpConnection(probeUrl, 'wrong-token'), /MCP HTTP 401/);
} finally {
  await resetMcpSessionsForTest();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log('mcp-connection.verify: configs, workflow, JSON/SSE parsing, and real authenticated handshake passed');
