// Skin selector: brush button + drop-down card, row = three-color point (bottom/panel/accent)
// Preview + name + check mark. The switch takes effect immediately (applySkin changes to <html data-cc-skin>),
// localStorage is persistent; TopBar is shared with Dashboard header.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { theme, themeAlpha } from '../../theme';
import { useT } from '../../i18n/locale';
import { SKINS, applySkin, getSkin } from '../../skins';
import { Icon } from '../icons';

export function SkinPicker() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(getSkin);
  const [position, setPosition] = useState({ top: 42, right: 8 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pick = (id: string): void => { applySkin(id); setCurrent(id); };
  const placeMenu = useCallback((): void => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: Math.max(8, rect.bottom + 6),
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) placeMenu();
  }, [open, placeMenu]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, placeMenu]);

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button ref={triggerRef} type="button" data-tip={t('皮肤')} aria-label={t('皮肤')}
        aria-haspopup="menu" aria-expanded={open} className="cc-header-btn cc-tip cc-tip-r" onClick={() => setOpen((o) => !o)}
        style={{ ...trigger, color: open ? theme.text : theme.textDim, background: open ? theme.panelAlt : 'none' }}>
        <Icon name="brush" size={16} />
      </button>
      {open && createPortal(
        <>
          <div role="presentation" onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 120 }} />
          <div className="cc-chat-popover" role="menu" aria-label={t('皮肤')} style={{ ...pop, top: position.top, right: position.right }}>
            <div style={head}>{t('皮肤')}</div>
            {SKINS.map((s) => {
              const active = current === s.id;
              return (
                <button key={s.id} type="button" role="menuitemradio" aria-checked={active} onClick={() => pick(s.id)}
                  style={{ ...row, background: active ? theme.panel : 'none' }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = theme.panel; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'none'; }}>
                  <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
                    <span style={dot(s.tokens.bg)} />
                    <span style={dot(s.tokens.panelAlt)} />
                    <span style={dot(s.tokens.accent)} />
                  </span>
                  <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(s.nameZh)}</span>
                  {active && <span style={{ color: theme.accent, display: 'inline-flex' }}><Icon name="check" size={12} strokeWidth={2.4} /></span>}
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

const trigger: React.CSSProperties = {
  border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', background: 'none',
};
const pop: React.CSSProperties = {
  position: 'fixed', zIndex: 121, minWidth: 168,
    background: theme.panelAlt, border: `1px solid ${theme.borderLight}`, borderRadius: 4,
  boxShadow: 'none', padding: 4, display: 'flex', flexDirection: 'column', gap: 1,
};
const head: React.CSSProperties = { fontSize: 10.5, color: theme.textDim, padding: '4px 8px 5px', letterSpacing: 0.4 };
const row: React.CSSProperties = {
  font: 'inherit', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '6px 8px', border: 'none', borderRadius: 3, cursor: 'pointer', color: theme.text,
};
function dot(color: string): React.CSSProperties {
  return { width: 10, height: 10, borderRadius: '50%', background: color, border: `1px solid ${themeAlpha.ink(0.45)}` };
}
