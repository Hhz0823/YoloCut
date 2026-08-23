import { Icon } from '../components/icons';
import { useT } from '../i18n/locale';
import { LiquidGlassBackdrop } from '../ui/LiquidGlassBackdrop';
import {
  LIBRARY_TOOL_ITEMS,
  isLibraryToolActive,
  type LibraryMainTab,
  type LibraryResourceTab,
  type LibraryToolTarget,
} from './libraryNavigation';

interface LibraryToolRailProps {
  mainTab: LibraryMainTab;
  subTab: LibraryResourceTab;
  onSelect: (target: LibraryToolTarget) => void;
}

export function LibraryToolRail({ mainTab, subTab, onSelect }: LibraryToolRailProps) {
  const t = useT();
  const secondaryStart = LIBRARY_TOOL_ITEMS.findIndex((item) => item.group === 'secondary');

  return (
    <nav className="cc-main-tabs cc-liquid-glass-host" aria-label={t('剪辑工具')}>
      <LiquidGlassBackdrop />
      {LIBRARY_TOOL_ITEMS.map((item, index) => {
        const selected = isLibraryToolActive(item, mainTab, subTab);
        return (
          <div className="cc-main-tab-entry" key={item.id}>
            {index === secondaryStart && <div className="cc-main-tabs-divider" role="separator" />}
            <button
              type="button"
              title={t(item.label)}
              aria-label={t(item.label)}
              aria-current={selected ? 'page' : undefined}
              data-tool-id={item.id}
              onClick={() => onSelect(item.target)}
              className={`cc-main-tab${selected ? ' selected' : ''}`}
            >
              <Icon name={item.icon} size={16} />
              <span className="cc-main-tab-label cc-glass-muted-ink">{t(item.label)}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
