import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const moduleUrl = new URL('./context-menu.ts', import.meta.url);
assert.equal(existsSync(moduleUrl), true, 'desktop text surfaces need a native editing context menu');

if (existsSync(moduleUrl)) {
  const { buildTextContextMenuTemplate } = await import(moduleUrl.href);

  assert.deepEqual(
    buildTextContextMenuTemplate({
      isEditable: false,
      selectionText: 'selected read-only text',
      editFlags: { canCopy: true },
    }),
    [{ role: 'copy', label: '复制', enabled: true }],
    'selected read-only text exposes Copy',
  );

  assert.deepEqual(
    buildTextContextMenuTemplate({
      isEditable: true,
      selectionText: 'prompt',
      editFlags: {
        canUndo: true,
        canRedo: false,
        canCut: true,
        canCopy: true,
        canPaste: true,
        canSelectAll: true,
      },
    }),
    [
      { role: 'undo', label: '撤销', enabled: true },
      { role: 'redo', label: '重做', enabled: false },
      { type: 'separator' },
      { role: 'cut', label: '剪切', enabled: true },
      { role: 'copy', label: '复制', enabled: true },
      { role: 'paste', label: '粘贴', enabled: true },
      { type: 'separator' },
      { role: 'selectAll', label: '全选', enabled: true },
    ],
    'editable fields expose standard native editing commands',
  );

  assert.deepEqual(
    buildTextContextMenuTemplate({
      isEditable: false,
      selectionText: '',
      editFlags: {},
    }),
    [],
    'non-editable surfaces without selected text do not open an empty menu',
  );

  assert.equal(
    buildTextContextMenuTemplate({
      isEditable: false,
      selectionText: 'read-only',
      editFlags: { canCopy: true },
    }, 'en')[0]?.label,
    'Copy',
    'text context menus follow the English UI locale',
  );
}

console.log('desktop context-menu verification passed');
