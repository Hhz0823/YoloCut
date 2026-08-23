import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const composer = readFileSync(new URL('./ChatComposer.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(css, /grid-template-columns:minmax\(0,1fr\) minmax\(320px,40%\)/,
  'wide Agent windows must not split messages and composer into disconnected columns');
assert.match(css, /\.cc-chat-panel--detached \.cc-chat-workbench-content \{[\s\S]*?max-width:1180px;/,
  'detached Agent content should use a centered readable wide column');
assert.match(css, /\.cc-chat-panel--detached \.cc-chat-composer-section \{[\s\S]*?border-top:1px solid var\(--cc-border\) !important; border-left:0;/,
  'the composer must remain below the conversation in wide windows');
assert.match(css, /\.cc-chat-panel--detached \.cc-chat-starter-list \{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  'wide onboarding should use the available width without separating the composer');

for (const contract of [
  /id="cc-agent-composer-input"/,
  /name="yolocut-agent-prompt"/,
  /data-cc-agent-input="true"/,
  /aria-label=\{inputAriaLabel\}/,
  /event\.currentTarget\.focus\(\{ preventScroll: true \}\)/,
]) {
  assert.match(composer, contract, 'Agent textarea must expose a stable focusable automation contract');
}

console.log('agentWorkbenchLayout.verify: coherent wide layout and Agent input automation contract passed');
