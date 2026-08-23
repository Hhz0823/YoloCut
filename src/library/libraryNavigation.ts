import type { IconName } from '../components/icons';

export const LIBRARY_RESOURCE_TABS = ['MG 动画', '音效', '转场', '特效', '缩放', 'LUT'] as const;

export type LibraryResourceTab = (typeof LIBRARY_RESOURCE_TABS)[number];
export type LibraryMainTab = '我的素材' | '序列' | '资源库' | '文字' | '文字稿' | '字幕' | '技能';

export interface LibraryToolTarget {
  mainTab: LibraryMainTab;
  subTab?: LibraryResourceTab;
}

export interface LibraryToolItem {
  id: string;
  label: string;
  icon: IconName;
  group: 'primary' | 'secondary';
  target: LibraryToolTarget;
}

export const LIBRARY_TOOL_ITEMS: readonly LibraryToolItem[] = [
  { id: 'media', label: '媒体', icon: 'film', group: 'primary', target: { mainTab: '我的素材' } },
  { id: 'audio', label: '音频', icon: 'music', group: 'primary', target: { mainTab: '资源库', subTab: '音效' } },
  { id: 'text', label: '文字', icon: 'text', group: 'primary', target: { mainTab: '文字' } },
  { id: 'captions', label: '字幕', icon: 'captions', group: 'primary', target: { mainTab: '字幕' } },
  { id: 'templates', label: '模板', icon: 'grid', group: 'primary', target: { mainTab: '资源库', subTab: 'MG 动画' } },
  { id: 'effects', label: '特效', icon: 'sparkles', group: 'primary', target: { mainTab: '资源库', subTab: '特效' } },
  { id: 'transitions', label: '转场', icon: 'swap', group: 'primary', target: { mainTab: '资源库', subTab: '转场' } },
  { id: 'filters', label: '滤镜', icon: 'filter', group: 'primary', target: { mainTab: '资源库', subTab: 'LUT' } },
  { id: 'transcript', label: '文字稿', icon: 'bookOpen', group: 'secondary', target: { mainTab: '文字稿' } },
  { id: 'sequences', label: '序列', icon: 'copy', group: 'secondary', target: { mainTab: '序列' } },
  { id: 'skills', label: '技能', icon: 'wand', group: 'secondary', target: { mainTab: '技能' } },
] as const;

export function isLibraryToolActive(
  item: LibraryToolItem,
  mainTab: LibraryMainTab,
  subTab: LibraryResourceTab,
): boolean {
  if (item.target.mainTab !== mainTab) return false;
  return item.target.subTab === undefined || item.target.subTab === subTab;
}
