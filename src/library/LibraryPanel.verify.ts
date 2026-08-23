import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LIBRARY_TOOL_ITEMS,
  isLibraryToolActive,
} from './libraryNavigation';
import { TEXT_PRESETS } from './textPresets';

const primaryLabels = LIBRARY_TOOL_ITEMS
  .filter((item) => item.group === 'primary')
  .map((item) => item.label);
assert.deepEqual(
  primaryLabels,
  ['媒体', '音频', '文字', '字幕', '模板', '特效', '转场', '滤镜'],
  'the primary rail should expose the common editing categories without a hidden first hop',
);
assert.equal(
  new Set(LIBRARY_TOOL_ITEMS.map((item) => item.id)).size,
  LIBRARY_TOOL_ITEMS.length,
  'tool ids must stay unique for stable navigation and automation',
);

const audioTool = LIBRARY_TOOL_ITEMS.find((item) => item.id === 'audio');
const mediaTool = LIBRARY_TOOL_ITEMS.find((item) => item.id === 'media');
assert.ok(audioTool && mediaTool);
assert.equal(isLibraryToolActive(audioTool, '资源库', '音效'), true);
assert.equal(isLibraryToolActive(audioTool, '资源库', '特效'), false);
assert.equal(isLibraryToolActive(mediaTool, '我的素材', 'MG 动画'), true);

assert.deepEqual(
  TEXT_PRESETS.map((preset) => [preset.id, preset.clip.fontSize, preset.clip.fontWeight, preset.clip.align]),
  [
    ['title', 96, 750, 'center'],
    ['subtitle', 56, 600, 'center'],
    ['body', 40, 500, 'left'],
  ],
  'text presets should preserve an intentional hierarchy',
);

const [railSource, browserSource, panelSource, controllerSource, css] = await Promise.all([
  readFile(new URL('./LibraryToolRail.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./TextBrowser.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./LibraryPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../editor/useEditorController.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../index.css', import.meta.url), 'utf8'),
]);

assert.match(railSource, /aria-current=\{selected \? 'page' : undefined\}/);
assert.match(railSource, /<span className="cc-main-tab-label cc-glass-muted-ink">/);
assert.match(browserSource, /onClick=\{\(\) => onAdd\(\{/);
assert.match(panelSource, /<LibraryToolRail[\s\S]*?<TextBrowser onAdd=\{onAddText\}/);
assert.match(
  controllerSource,
  /commands\.addTextClip\(\{ startFrame: getPlayhead\(\), \.\.\.preset \}\)[\s\S]*?commands\.selectItem\(id\)[\s\S]*?setInspectorCollapsed\(false\)/,
  'manual text insertion must go through EditorCommands, select the new item, and expose its properties',
);

const mediumInspectorRule = css.match(
  /@container preview-workspace \(max-width:720px\) \{([\s\S]*?)\n\}/,
)?.[1] ?? '';
assert.match(mediumInspectorRule, /width:clamp\(264px, 42%, 280px\)/);
assert.doesNotMatch(
  mediumInspectorRule,
  /position:absolute/,
  'the 1280px-class workspace must shrink the preview beside Properties instead of covering it',
);
assert.match(
  css,
  /@container preview-workspace \(max-width:560px\)[\s\S]*?position:absolute/,
  'very narrow preview workspaces should retain an overlay fallback',
);

console.log('LibraryPanel.verify: task rail, EditorCommands text insertion, and responsive inspector passed');
