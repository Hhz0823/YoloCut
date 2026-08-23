import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createMiniConnect } from '../desktop/mini-connect.ts';
import {
  expandLlmProviderPatch,
  llmOperationPath,
  resolveLlmBaseUrl,
  resolveLlmProviderConfig,
} from './llm-config.ts';
import { proxyMiddleware } from './proxy.ts';
import { normalizeZCodeBaseUrl } from './zcode-policy.ts';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

assert.equal(resolveLlmBaseUrl('anthropic', ''), 'https://api.anthropic.com/v1');
assert.equal(resolveLlmBaseUrl('kimi', ''), 'https://api.moonshot.ai/v1');
assert.equal(resolveLlmBaseUrl('qwen', ''), 'https://dashscope-us.aliyuncs.com/compatible-mode/v1');
assert.equal(resolveLlmBaseUrl('glm', ''), 'https://open.bigmodel.cn/api/paas/v4');
assert.equal(resolveLlmBaseUrl('deepseek', ''), 'https://api.deepseek.com');
assert.equal(resolveLlmBaseUrl('minimax', ''), 'https://api.minimaxi.com/v1');
assert.equal(resolveLlmBaseUrl('gemini', ''), 'https://generativelanguage.googleapis.com/v1beta');
assert.equal(resolveLlmBaseUrl('openai', 'https://api.openai.com', ''), 'https://api.openai.com/v1');
assert.equal(resolveLlmBaseUrl('anthropic', 'https://relay.test/api', ''), 'https://relay.test/api/v1');
assert.equal(llmOperationPath('kimi'), '/chat/completions');
assert.equal(llmOperationPath('zcode'), '/chat/completions', 'ZCode uses its verified OpenAI-compatible operation path');
assert.equal(normalizeZCodeBaseUrl('http://127.0.0.1:18080'), 'http://127.0.0.1:18080/v1');
assert.equal(normalizeZCodeBaseUrl('http://127.0.0.1:18180/v1/'), 'http://127.0.0.1:18180/v1');
for (const unsafe of [
  'https://127.0.0.1:18080/v1',
  'http://localhost:18080/v1',
  'http://127.0.0.1:18079/v1',
  'http://127.0.0.1:18181/v1',
  'http://user:secret@127.0.0.1:18080/v1',
  'http://127.0.0.1:18080/v1?key=secret',
  'http://127.0.0.1:18080/admin',
]) {
  assert.throws(() => normalizeZCodeBaseUrl(unsafe), /127\.0\.0\.1:18080\.\.18180\/v1/);
}
const zcodeConfig = resolveLlmProviderConfig('zcode', (name) => ({
  LLM_ZCODE_API_KEY: 'server-only-key',
  LLM_ZCODE_BASE_URL: 'http://127.0.0.1:18081',
  LLM_ZCODE_MODEL: 'gemini-3.7-flash',
}[name] ?? ''));
assert.deepEqual(zcodeConfig, {
  provider: 'zcode',
  apiKey: 'server-only-key',
  baseUrl: 'http://127.0.0.1:18081/v1',
  model: 'gemini-3.7-flash',
});

// ── llmHeaders: Inject upstream authentication according to the protocol (google=x-goog-api-key;anthropic=x-api-key; the rest Bearer) ──
{
  const { KEY_NAMES, seedKeystore } = await import('./keystore.ts');
  const { llmErrorMessage, llmHeaders } = await import('./plugins/llm-proxy.ts');
  seedKeystore({
    ...Object.fromEntries(KEY_NAMES.map((name) => [name, ''])),
    LLM_PROVIDER: 'anthropic',
    LLM_GEMINI_API_KEY: 'gk-1',
    LLM_MINIMAX_API_KEY: 'mk-1',
    LLM_ZCODE_API_KEY: 'zk-1',
    LLM_API_KEY: 'ak-1',
  } as Record<string, string>);
  const reqFor = (provider: string) => ({ headers: { 'x-yolocut-provider': provider } } as never);
  assert.deepEqual(llmHeaders(reqFor('gemini')), { 'x-goog-api-key': 'gk-1' }, 'gemini 原生协议注入 x-goog-api-key');
  assert.deepEqual(llmHeaders(reqFor('minimax')), { authorization: 'Bearer mk-1' }, 'openai-compatible 厂商 Bearer');
  assert.deepEqual(llmHeaders(reqFor('zcode')), { authorization: 'Bearer zk-1' }, 'ZCode current protocol uses server-side Bearer auth');
  assert.deepEqual(llmHeaders(reqFor('anthropic')), { 'x-api-key': 'ak-1', 'anthropic-version': '2023-06-01' }, 'anthropic x-api-key(经遗留迁移)');
  assert.match(llmErrorMessage(401, reqFor('gemini')), /Gemini.*设置.*API Key/, '认证错误给设置入口');
  assert.match(llmErrorMessage(429, reqFor('openai')), /额度不足.*稍后重试/, '限流错误给额度提示');
  assert.match(llmErrorMessage(400, reqFor('zcode')), /OpenAI-compatible.*chat\/completions.*手动检查/, 'protocol errors identify the live ZCode request family');
  assert.match(llmErrorMessage(401, reqFor('zcode')), /重新执行自动连接.*URL、API Key 和模型/, 'ZCode auth errors include manual recovery');
  assert.match(llmErrorMessage(404, reqFor('zcode')), /\/v1\/models.*gemini-3\.7-flash/, 'missing ZCode routes/models are diagnosable');
  assert.match(llmErrorMessage(502, reqFor('zcode')), /本地网关或其上游.*手动检查/, 'transport failures keep the ZCode/upstream boundary explicit');
}

const switched = expandLlmProviderPatch(new Map([['LLM_PROVIDER', 'openai']]), 'anthropic');
assert.deepEqual(Object.fromEntries(switched), {
  LLM_PROVIDER: 'openai',
  LLM_MODEL: '',
  LLM_BASE_URL: '',
});
const explicit = expandLlmProviderPatch(new Map([
  ['LLM_PROVIDER', 'openai'],
  ['LLM_MODEL', 'gpt-custom'],
  ['LLM_BASE_URL', 'https://relay.test/v2'],
]), 'anthropic');
assert.equal(explicit.get('LLM_MODEL'), 'gpt-custom');
assert.equal(explicit.get('LLM_BASE_URL'), 'https://relay.test/v2');

const seen: Array<{
  url: string;
  authorization?: string;
  xApiKey?: string;
  xGoogApiKey?: string;
  provider?: string;
  body: string;
  cookie?: string;
}> = [];
const upstream = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  seen.push({
    url: req.url ?? '',
    authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    xApiKey: typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined,
    xGoogApiKey: typeof req.headers['x-goog-api-key'] === 'string' ? req.headers['x-goog-api-key'] : undefined,
    provider: typeof req.headers['x-yolocut-provider'] === 'string'
      ? req.headers['x-yolocut-provider']
      : undefined,
    cookie: typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
    body: Buffer.concat(chunks).toString('utf8'),
  });
  if (req.url?.includes('/unauthorized')) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"error":{"type":"vendor_auth_error","secret_debug":"raw body must stay hidden"}}');
    return;
  }
  res.setHeader('set-cookie', 'oauth-session=must-not-reach-browser');
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('{"ok":true}');
});
const upstreamPort = await listen(upstream);

let target = `http://127.0.0.1:${upstreamPort}/v1beta/openai?api-version=preview`;
const app = createMiniConnect((error) => { throw error; });
app.use('/llm', proxyMiddleware({
  target: () => target,
  headers: () => ({ authorization: 'Bearer server-secret' }),
  forceJsonContentType: true,
  errorMessage: (status) => `Friendly provider error (${status}). Check Agent settings.`,
}));
const proxy = createServer(app.handle);
const proxyPort = await listen(proxy);
const warnings: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

try {
  const first = await fetch(`http://127.0.0.1:${proxyPort}/llm/chat/completions?stream=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-yolocut-provider': 'kimi' },
    body: '{"model":"compatible"}',
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'application/json');
  assert.equal(first.headers.get('set-cookie'), null, 'upstream cookies never enter the browser origin');
  assert.deepEqual(await first.json(), { ok: true });

  target = `http://127.0.0.1:${upstreamPort}/v1`;
  await fetch(`http://127.0.0.1:${proxyPort}/llm/responses`, {
    method: 'POST',
    body: '{"model":"openai"}',
  });

  // Browser cookies (shared across every localhost port) must never reach upstream.
  await fetch(`http://127.0.0.1:${proxyPort}/llm/responses`, {
    method: 'POST',
    headers: {
      'x-yolocut-provider': 'kimi',
      cookie: 'session=must-not-leak',
      authorization: 'Bearer browser-auth-must-not-leak',
      'x-api-key': 'browser-x-api-key-must-not-leak',
      'x-goog-api-key': 'browser-google-key-must-not-leak',
    },
    body: '{"model":"openai"}',
  });

  await fetch(`http://127.0.0.1:${proxyPort}/llm/chat/completions`, {
    method: 'POST',
    headers: { 'x-yolocut-provider': 'zcode' },
    body: '{"model":"gemini-3.7-flash","messages":[{"role":"user","content":"test"}]}',
  });

  assert.deepEqual(seen, [
    {
      url: '/v1beta/openai/chat/completions?api-version=preview&stream=true',
      authorization: 'Bearer server-secret',
      xApiKey: undefined,
      xGoogApiKey: undefined,
      provider: undefined,
      cookie: undefined,
      body: '{"model":"compatible"}',
    },
    {
      url: '/v1/responses',
      authorization: 'Bearer server-secret',
      xApiKey: undefined,
      xGoogApiKey: undefined,
      provider: undefined,
      cookie: undefined,
      body: '{"model":"openai"}',
    },
    {
      url: '/v1/responses',
      authorization: 'Bearer server-secret',
      xApiKey: undefined,
      xGoogApiKey: undefined,
      provider: undefined,
      cookie: undefined,
      body: '{"model":"openai"}',
    },
    {
      url: '/v1/chat/completions',
      authorization: 'Bearer server-secret',
      xApiKey: undefined,
      xGoogApiKey: undefined,
      provider: undefined,
      cookie: undefined,
      body: '{"model":"gemini-3.7-flash","messages":[{"role":"user","content":"test"}]}',
    },
  ]);

  const denied = await fetch(`http://127.0.0.1:${proxyPort}/llm/unauthorized`);
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), {
    error: { message: 'Friendly provider error (401). Check Agent settings.' },
  }, 'raw provider JSON is replaced with one actionable message');
  assert.ok(warnings.some((warning) => /upstream returned HTTP 401/.test(warning)));
  assert.doesNotMatch(warnings.join('\n'), /secret_debug|raw body must stay hidden|browser-.*must-not-leak|server-secret/);

  target = 'http://127.0.0.1:1/v1';
  const unavailable = await fetch(`http://127.0.0.1:${proxyPort}/llm/chat/completions`, {
    method: 'POST',
    body: '{"model":"gemini-3.7-flash"}',
  });
  assert.equal(unavailable.status, 502);
  assert.deepEqual(await unavailable.json(), {
    error: { message: 'Friendly provider error (502). Check Agent settings.' },
  });
  assert.ok(warnings.some((warning) => /transport failure \(ECONNREFUSED\)/.test(warning)));
  assert.doesNotMatch(warnings.join('\n'), /127\.0\.0\.1:1|upstream request failed/);
} finally {
  console.warn = originalWarn;
  await close(proxy);
  await close(upstream);
}

console.log('llm proxy checks passed');
