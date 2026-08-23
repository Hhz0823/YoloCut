import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import { isDesktopLocale } from '../shared/desktop-locale.ts';
import { buildApplicationMenuTemplate } from './application-menu.ts';

function submenu(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  assert.ok(Array.isArray(item.submenu), `menu ${item.label ?? item.role ?? 'unknown'} has a submenu`);
  return item.submenu;
}

assert.equal(isDesktopLocale('zh'), true);
assert.equal(isDesktopLocale('en'), true);
assert.equal(isDesktopLocale('zh-CN'), false, 'IPC locale contract rejects unsupported values');

const zh = buildApplicationMenuTemplate('zh', 'win32', 'YoloCut');
assert.deepEqual(zh.map((item) => item.label), ['文件', '编辑', '视图', '窗口']);
assert.deepEqual(
  submenu(zh[1]).filter((item) => item.role).map((item) => [item.role, item.label]),
  [
    ['undo', '撤销'],
    ['redo', '重做'],
    ['cut', '剪切'],
    ['copy', '复制'],
    ['paste', '粘贴'],
    ['delete', '删除'],
    ['selectAll', '全选'],
  ],
  'Chinese editing labels retain native Electron roles and accelerators',
);
assert.deepEqual(
  submenu(zh[2]).filter((item) => item.role).map((item) => item.role),
  ['reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen'],
  'view commands retain native Electron roles',
);

const en = buildApplicationMenuTemplate('en', 'win32', 'YoloCut');
assert.deepEqual(en.map((item) => item.label), ['File', 'Edit', 'View', 'Window']);
assert.deepEqual(
  submenu(en[1]).filter((item) => item.role).map((item) => item.label),
  ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select All'],
);

const mac = buildApplicationMenuTemplate('zh', 'darwin', 'YoloCut');
assert.deepEqual(mac.map((item) => item.label), ['YoloCut', '文件', '编辑', '视图', '窗口']);
assert.equal(submenu(mac[0])[0]?.label, '关于 YoloCut');
assert.equal(submenu(mac[0]).at(-1)?.label, '退出 YoloCut');

console.log('desktop application-menu localization verification passed');
