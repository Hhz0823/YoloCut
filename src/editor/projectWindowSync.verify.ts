import assert from 'node:assert/strict';
import { compareProjectWindowVersion } from './projectWindowSync';

assert.ok(compareProjectWindowVersion({ clock: 2, source: 'main:a' }, { clock: 1, source: 'agent:z' }) > 0);
assert.ok(compareProjectWindowVersion({ clock: 2, source: 'main:z' }, { clock: 2, source: 'agent:a' }) > 0);
assert.equal(compareProjectWindowVersion({ clock: 3, source: 'main:a' }, { clock: 3, source: 'main:a' }), 0);

console.log('projectWindowSync.verify: Lamport ordering passed');
