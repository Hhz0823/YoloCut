import assert from 'node:assert/strict';

import { discoverLlamaCppRuntime } from './llama-cpp-runtime-discovery.ts';

const missing = await discoverLlamaCppRuntime(['yolocut-definitely-missing-llama-server'], false);
assert.equal(missing.available, false);
assert.match(missing.reason ?? '', /llama\.cpp|llama-server/i);

console.log('llama-cpp-runtime-discovery.verify: missing and minimum-version paths fail closed');
