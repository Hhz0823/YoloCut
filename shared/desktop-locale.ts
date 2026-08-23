export const DESKTOP_LOCALE_CHANNEL = 'yolocut:set-locale';

export type DesktopLocale = 'zh' | 'en';

export function isDesktopLocale(value: unknown): value is DesktopLocale {
  return value === 'zh' || value === 'en';
}
