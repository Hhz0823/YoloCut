import assert from 'node:assert/strict';

import {
  localAutoEditVlmBackend,
  parseLocalAutoEditReferenceStyle,
} from './local-auto-edit-vlm.ts';

assert.equal(localAutoEditVlmBackend('ggml_cuda_init CUDA\noffloaded 12/12 layers to GPU'), 'cuda');
assert.equal(localAutoEditVlmBackend('Metal backend initialized\noffloading 12 repeating layers to GPU'), 'metal');
assert.equal(localAutoEditVlmBackend('CPU buffer size 123 MiB'), 'cpu');
assert.equal(localAutoEditVlmBackend('RTX 4090 requested by user'), 'unknown', 'hardware preference is not execution evidence');
assert.equal(localAutoEditVlmBackend('CUDA backend loaded\noffloaded 0/12 layers to GPU'), 'unknown');

const profile = parseLocalAutoEditReferenceStyle('```json\n' + JSON.stringify({
  summary: 'fast product reel',
  shotRhythm: 'short opening shots',
  visualStyle: 'clean tabletop',
  captionStyle: 'two lines',
  transitionStyle: 'mostly hard cuts',
  colorStyle: 'neutral contrast',
  audioStyle: 'voice first',
}) + '\n```');
assert.equal(profile.structureOnly, true);
assert.equal(profile.transitionStyle, 'mostly hard cuts');
assert.match(profile.audioStyle, /单独分析参考音轨/);

console.log('local-auto-edit-vlm.verify: structured profile and actual-backend audit passed');
