import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const exportHistory = await readFile(new URL('./ExportHistory.tsx', import.meta.url), 'utf8');
const skinPicker = await readFile(new URL('./settings/SkinPicker.tsx', import.meta.url), 'utf8');

assert.match(
  exportHistory,
  /<TopBarIconButton[\s\S]*?icon="download"[\s\S]*?label=\{t\('导出历史'\)\}/,
  '导出历史按钮应复用顶部栏图标按钮',
);
assert.doesNotMatch(
  exportHistory,
  /<button title=\{t\('导出历史'\)\}/,
  '导出历史按钮不应使用样式不可控的原生 title',
);

for (const [name, source] of [['导出历史', exportHistory], ['皮肤', skinPicker]] as const) {
  assert.match(source, /createPortal\(/, `${name}浮层应脱离带毛玻璃滤镜的顶部栏坐标系`);
  assert.match(source, /document\.body/, `${name}浮层应挂载到 document.body`);
  assert.match(source, /event\.key === 'Escape'/, `${name}浮层应支持 Escape 关闭`);
}
assert.match(exportHistory, /role="dialog"/, '导出历史应暴露对话框语义');
assert.match(skinPicker, /role="menu"/, '皮肤选择器应暴露菜单语义');

console.log('top bar immediate tooltips verified');
