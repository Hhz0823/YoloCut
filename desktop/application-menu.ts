import type { MenuItemConstructorOptions } from 'electron';
import type { DesktopLocale } from '../shared/desktop-locale.ts';

export interface NativeMenuLabels {
  readonly file: string;
  readonly edit: string;
  readonly view: string;
  readonly window: string;
  readonly about: string;
  readonly services: string;
  readonly hide: string;
  readonly hideOthers: string;
  readonly showAll: string;
  readonly quit: string;
  readonly closeWindow: string;
  readonly undo: string;
  readonly redo: string;
  readonly cut: string;
  readonly copy: string;
  readonly paste: string;
  readonly delete: string;
  readonly selectAll: string;
  readonly reload: string;
  readonly forceReload: string;
  readonly developerTools: string;
  readonly actualSize: string;
  readonly zoomIn: string;
  readonly zoomOut: string;
  readonly toggleFullScreen: string;
  readonly minimize: string;
  readonly maximize: string;
  readonly bringAllToFront: string;
}

const LABELS: Record<DesktopLocale, NativeMenuLabels> = {
  zh: {
    file: '文件',
    edit: '编辑',
    view: '视图',
    window: '窗口',
    about: '关于',
    services: '服务',
    hide: '隐藏',
    hideOthers: '隐藏其他',
    showAll: '全部显示',
    quit: '退出',
    closeWindow: '关闭窗口',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    delete: '删除',
    selectAll: '全选',
    reload: '重新加载',
    forceReload: '强制重新加载',
    developerTools: '开发者工具',
    actualSize: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    toggleFullScreen: '切换全屏',
    minimize: '最小化',
    maximize: '最大化或还原',
    bringAllToFront: '全部置于前台',
  },
  en: {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    about: 'About',
    services: 'Services',
    hide: 'Hide',
    hideOthers: 'Hide Others',
    showAll: 'Show All',
    quit: 'Quit',
    closeWindow: 'Close Window',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    delete: 'Delete',
    selectAll: 'Select All',
    reload: 'Reload',
    forceReload: 'Force Reload',
    developerTools: 'Developer Tools',
    actualSize: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    toggleFullScreen: 'Toggle Full Screen',
    minimize: 'Minimize',
    maximize: 'Maximize or Restore',
    bringAllToFront: 'Bring All to Front',
  },
};

export function nativeMenuLabels(locale: DesktopLocale): NativeMenuLabels {
  return LABELS[locale];
}

export function buildApplicationMenuTemplate(
  locale: DesktopLocale,
  platform: NodeJS.Platform,
  productName: string,
): MenuItemConstructorOptions[] {
  const label = nativeMenuLabels(locale);
  const template: MenuItemConstructorOptions[] = [];

  if (platform === 'darwin') {
    template.push({
      label: productName,
      submenu: [
        { role: 'about', label: `${label.about} ${productName}` },
        { type: 'separator' },
        { role: 'services', label: label.services },
        { type: 'separator' },
        { role: 'hide', label: `${label.hide} ${productName}` },
        { role: 'hideOthers', label: label.hideOthers },
        { role: 'unhide', label: label.showAll },
        { type: 'separator' },
        { role: 'quit', label: `${label.quit} ${productName}` },
      ],
    });
  }

  template.push({
    label: label.file,
    submenu: platform === 'darwin'
      ? [{ role: 'close', label: label.closeWindow }]
      : [
          { role: 'close', label: label.closeWindow },
          { type: 'separator' },
          { role: 'quit', label: `${label.quit} ${productName}` },
        ],
  });
  template.push({
    label: label.edit,
    submenu: [
      { role: 'undo', label: label.undo },
      { role: 'redo', label: label.redo },
      { type: 'separator' },
      { role: 'cut', label: label.cut },
      { role: 'copy', label: label.copy },
      { role: 'paste', label: label.paste },
      { role: 'delete', label: label.delete },
      { type: 'separator' },
      { role: 'selectAll', label: label.selectAll },
    ],
  });
  template.push({
    label: label.view,
    submenu: [
      { role: 'reload', label: label.reload },
      { role: 'forceReload', label: label.forceReload },
      { role: 'toggleDevTools', label: label.developerTools },
      { type: 'separator' },
      { role: 'resetZoom', label: label.actualSize },
      { role: 'zoomIn', label: label.zoomIn },
      { role: 'zoomOut', label: label.zoomOut },
      { type: 'separator' },
      { role: 'togglefullscreen', label: label.toggleFullScreen },
    ],
  });
  template.push({
    label: label.window,
    submenu: [
      { role: 'minimize', label: label.minimize },
      { role: 'zoom', label: label.maximize },
      { role: 'close', label: label.closeWindow },
      ...(platform === 'darwin'
        ? [
            { type: 'separator' } as MenuItemConstructorOptions,
            { role: 'front', label: label.bringAllToFront } as MenuItemConstructorOptions,
          ]
        : []),
    ],
  });

  return template;
}
