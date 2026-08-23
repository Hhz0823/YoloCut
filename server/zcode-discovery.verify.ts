import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverZCode,
  selectZCodeModel,
  zcodePortCandidates,
  zcodeSettingsPatch,
} from './zcode-discovery.ts';

const fixture = await mkdtemp(join(tmpdir(), 'yolocut-zcode-'));
const secret = 'zcode-test-secret-never-public';
let acceptedKey = secret;
let modelStatus = 200;
let modelBody: unknown = {
  data: [
    { id: 'grok-code-fast-1' },
    { id: 'gemini-3.7-flash' },
    { id: 'gemini-3.7-flash' },
  ],
};
let seenAuthorization: string | undefined;
let seenXApiKey: string | string[] | undefined;

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/') {
    res.end(JSON.stringify({ message: 'CLI Proxy API Server' }));
    return;
  }
  if (req.url === '/healthz') {
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.url === '/v1/models') {
    seenAuthorization = req.headers.authorization;
    seenXApiKey = req.headers['x-api-key'];
    if (seenAuthorization !== `Bearer ${acceptedKey}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.statusCode = modelStatus;
    res.end(JSON.stringify(modelBody));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});

async function listenInZCodeRange(): Promise<number> {
  for (let candidate = 18_180; candidate >= 18_081; candidate -= 1) {
    const available = await new Promise<boolean>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        if (error.code === 'EADDRINUSE') resolve(false);
        else reject(error);
      };
      server.once('error', onError);
      server.listen(candidate, '127.0.0.1', () => {
        server.off('error', onError);
        resolve(true);
      });
    });
    if (available) return candidate;
  }
  throw new Error('no free test port in the ZCode loopback range');
}

const port = await listenInZCodeRange();

try {
  const bounded = zcodePortCandidates(18_120, 65_000);
  assert.equal(bounded.length, 101, 'production discovery covers every port from 18080 through 18180 exactly once');
  assert.equal(bounded[0], 18_120, 'valid current state port is still probed first');
  assert.ok(bounded.includes(18_080) && bounded.includes(18_180));
  assert.ok(bounded.every((candidate) => candidate >= 18_080 && candidate <= 18_180));
  assert.equal(zcodePortCandidates(65_000, 18_181)[0], 18_080, 'out-of-range state cannot redirect local probes');

  await writeFile(join(fixture, 'state.json'), JSON.stringify({
    port,
    launcherVersion: '0.6.4-test',
    models: ['stale-model-must-not-be-trusted'],
  }));
  await writeFile(join(fixture, 'manager-settings.json'), JSON.stringify({ preferredPort: port, portScanEnd: port }));
  await writeFile(join(fixture, 'local-api-key'), `${secret}\n`, { mode: 0o600 });

  const ready = await discoverZCode({ rootDir: fixture, candidatePorts: [0, port] });
  assert.equal(ready.status.installed, true);
  assert.equal(ready.status.running, true);
  assert.equal(ready.status.authenticated, true);
  assert.equal(ready.status.port, port);
  assert.equal(ready.status.baseUrl, `http://127.0.0.1:${port}/v1`);
  assert.equal(ready.status.version, '0.6.4-test');
  assert.deepEqual(ready.status.models, ['gemini-3.7-flash', 'grok-code-fast-1']);
  assert.equal(ready.credentials?.apiKey, secret);
  assert.equal(seenAuthorization, `Bearer ${secret}`, 'live /v1/models uses ZCode current Bearer authentication');
  assert.equal(seenXApiKey, undefined, 'the random key is not duplicated into an extra header');
  assert.doesNotMatch(JSON.stringify(ready.status), new RegExp(secret));

  const patch = zcodeSettingsPatch(ready);
  assert.deepEqual(patch, {
    LLM_PROVIDER: 'zcode',
    LLM_ZCODE_API_KEY: secret,
    LLM_ZCODE_BASE_URL: `http://127.0.0.1:${port}/v1`,
    LLM_ZCODE_MODEL: 'gemini-3.7-flash',
  });
  assert.equal(selectZCodeModel(['gemini-3.7-flash', 'gemini-3.6-flash']), 'gemini-3.7-flash');
  assert.throws(() => selectZCodeModel(['gemini-3.6-flash']), /gemini-3\.7-flash/);

  modelBody = { data: [{ id: 'gemini-3.6-flash' }, { id: 'other-model' }] };
  const targetMissing = await discoverZCode({ rootDir: fixture, candidatePorts: [port] });
  assert.equal(targetMissing.status.authenticated, false, 'readiness stays false even though the message records accepted local auth');
  assert.equal(targetMissing.credentials, null, 'automatic connection fails closed without the exact live target');
  assert.deepEqual(targetMissing.status.models, ['gemini-3.6-flash', 'other-model']);
  assert.match(targetMissing.status.message, /实时模型目录.*不存在 gemini-3\.7-flash.*手动填写/);
  assert.doesNotMatch(JSON.stringify(targetMissing.status), /stale-model-must-not-be-trusted/);
  assert.throws(() => zcodeSettingsPatch(targetMissing), /不存在 gemini-3\.7-flash/);

  modelBody = { data: [] };
  const emptyCatalog = await discoverZCode({ rootDir: fixture, candidatePorts: [port] });
  assert.equal(emptyCatalog.status.authenticated, false);
  assert.equal(emptyCatalog.credentials, null);
  assert.deepEqual(emptyCatalog.status.models, []);
  assert.match(emptyCatalog.status.message, /未返回有效.*不会使用状态文件缓存兜底/);

  modelBody = { data: [{ id: 'gemini-3.7-flash' }] };
  modelStatus = 503;
  const unavailableCatalog = await discoverZCode({ rootDir: fixture, candidatePorts: [port] });
  assert.equal(unavailableCatalog.status.authenticated, false);
  assert.equal(unavailableCatalog.credentials, null);
  assert.deepEqual(unavailableCatalog.status.models, []);
  assert.match(unavailableCatalog.status.message, /HTTP 503.*手动填写/);

  modelStatus = 200;
  acceptedKey = 'different-key';
  const rejected = await discoverZCode({ rootDir: fixture, candidatePorts: [port] });
  assert.equal(rejected.status.running, true);
  assert.equal(rejected.status.authenticated, false);
  assert.equal(rejected.credentials, null);
  assert.deepEqual(rejected.status.models, []);
  assert.match(rejected.status.message, /验证失败.*HTTP 401.*手动填写/);
  assert.doesNotMatch(rejected.status.message, new RegExp(secret));
  assert.throws(() => zcodeSettingsPatch(rejected), /验证失败/);

  acceptedKey = secret;
  await writeFile(join(fixture, 'local-api-key'), 'bad key with spaces');
  const missingKey = await discoverZCode({ rootDir: fixture, candidatePorts: [port] });
  assert.equal(missingKey.status.keyAvailable, false);
  assert.equal(missingKey.status.running, true);
  assert.equal(missingKey.credentials, null);
  assert.match(missingKey.status.message, /未找到有效.*手动填写/);

  const absent = await discoverZCode({ rootDir: join(fixture, 'missing'), candidatePorts: [port] });
  assert.equal(absent.status.installed, false);
  assert.equal(absent.credentials, null);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(fixture, { recursive: true, force: true });
}

console.log('zcode-discovery.verify: ok');
