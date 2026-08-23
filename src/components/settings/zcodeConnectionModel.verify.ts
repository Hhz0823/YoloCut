import assert from 'node:assert/strict';
import { parseZCodeStatus, zcodeStatusTone } from './zcodeConnectionModel.ts';

const ready = {
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

assert.deepEqual(parseZCodeStatus(ready), ready);
assert.equal(zcodeStatusTone(ready), 'ready');
assert.equal(zcodeStatusTone({ ...ready, authenticated: false }), 'warning');
assert.equal(zcodeStatusTone({ ...ready, installed: false, running: false, authenticated: false }), 'error');
assert.equal(parseZCodeStatus({ ...ready, port: 70_000 }), null);
assert.equal(parseZCodeStatus({ ...ready, models: ['ok', 123] }), null);
assert.equal(parseZCodeStatus({ ...ready, message: 'x'.repeat(501) }), null);
assert.equal(parseZCodeStatus(null), null);

console.log('zcodeConnectionModel.verify: ok');
