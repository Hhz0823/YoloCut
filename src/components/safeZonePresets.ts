export type SafeZonePreset =
  | 'title-action'
  | 'grid'
  | 'tiktok'
  | 'reels'
  | 'shorts'
  | 'spotlight';

export const SAFE_ZONE_PRESETS: readonly { id: SafeZonePreset; label: string }[] = [
  { id: 'title-action', label: '标题 / 动作安全区' },
  { id: 'grid', label: '三分构图网格' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'reels', label: 'Instagram Reels' },
  { id: 'shorts', label: 'YouTube Shorts' },
  { id: 'spotlight', label: 'Snapchat Spotlight' },
] as const;
