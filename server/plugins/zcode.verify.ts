import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZCodePublicStatus } from '../../shared/zcode.ts';
import type { KeyStatus } from '../keystore.ts';
import type { ZCodeDiscoveryResult } from '../zcode-discovery.ts';
import { handleZCodeRequest, type ZCodePluginDependencies } from './zcode.ts';

const secret = 'server-only-zcode-secret';
const status: ZCodePublicStatus = {
  supported: true,
  installed: true,
  running: true,
  authenticated: true,
  keyAvailable: true,
  port: 18_080,
  baseUrl: 'http://127.0.0.1:18080/v1',
  version: '0.6.4-test',
  models: ['gemini-3.7-flash'],
  message: 'ZCode 已就绪',
};
const discovery: ZCodeDiscoveryResult = {
  status,
  credentials: { apiKey: secret, baseUrl: status.baseUrl! },
};
const settings: KeyStatus = {
  keys: { LLM_ZCODE_API_KEY: { configured: true, source: 'runtime' } },
  caps: {} as KeyStatus['caps'],
  models: {
    LLM_PROVIDER: 'zcode',
    LLM_ZCODE_BASE_URL: status.baseUrl!,
    LLM_ZCODE_MODEL: 'gemini-3.7-flash',
  },
};

interface CapturedResponse { statusCode: number; headers: Record<string, string>; body: string; }
function response(): CapturedResponse & ServerResponse {
  const captured = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
  return Object.assign(captured, {
    setHeader(name: string, value: string) { captured.headers[name] = value; },
    end(body = '') { captured.body = String(body); },
  }) as CapturedResponse & ServerResponse;
}
function request(method: string, url: string): IncomingMessage {
  return { method, url } as IncomingMessage;
}

let persisted: Record<string, unknown> | null = null;
const dependencies: ZCodePluginDependencies = {
  discover: async () => discovery,
  persist: async (patch) => { persisted = patch; },
  settingsStatus: () => settings,
};

{
  const res = response();
  await handleZCodeRequest(request('GET', '/status'), res, dependencies);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), status);
  assert.doesNotMatch(res.body, new RegExp(secret));
}

{
  const res = response();
  await handleZCodeRequest(request('POST', '/connect'), res, dependencies);
  assert.equal(res.statusCode, 200);
  assert.equal(persisted?.LLM_ZCODE_API_KEY, secret, 'secret is persisted server-side');
  assert.doesNotMatch(res.body, new RegExp(secret), 'secret never enters the browser response');
  const body = JSON.parse(res.body) as { settings: KeyStatus };
  assert.equal(body.settings.models.LLM_PROVIDER, 'zcode');
  assert.equal(body.settings.keys.LLM_ZCODE_API_KEY.configured, true);
}

{
  persisted = null;
  const res = response();
  const missingTarget: ZCodePluginDependencies = {
    ...dependencies,
    discover: async () => ({
      status: {
        ...status,
        authenticated: false,
        models: ['gemini-3.6-flash'],
        message: '实时模型目录中不存在 gemini-3.7-flash，可手动填写 URL、API Key 和模型',
      },
      credentials: null,
    }),
  };
  await handleZCodeRequest(request('POST', '/connect'), res, missingTarget);
  assert.equal(res.statusCode, 409);
  assert.equal(persisted, null, 'a gateway with an accepted local key still fails closed without the exact live target model');
  assert.match(res.body, /不存在 gemini-3\.7-flash.*手动填写/);
  assert.doesNotMatch(res.body, new RegExp(secret));
}

{
  persisted = null;
  const res = response();
  const offline: ZCodePluginDependencies = {
    ...dependencies,
    discover: async () => ({
      status: { ...status, authenticated: false, message: '网关离线' },
      credentials: null,
    }),
  };
  await handleZCodeRequest(request('POST', '/connect'), res, offline);
  assert.equal(res.statusCode, 409);
  assert.equal(persisted, null);
  assert.match(res.body, /网关离线/);
}

console.log('zcode.verify: ok');
