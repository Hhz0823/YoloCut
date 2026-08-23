import { Icon } from '../components/icons';
import { useT } from '../i18n/locale';
import { TEXT_PRESETS, type TextClipPreset } from './textPresets';

export function TextBrowser({ onAdd }: { onAdd: (preset: TextClipPreset) => void }) {
  const t = useT();

  return (
    <section className="cc-text-browser" aria-labelledby="cc-text-browser-title">
      <header className="cc-text-browser-header">
        <div>
          <h2 id="cc-text-browser-title">{t('添加文字')}</h2>
          <p>{t('添加到播放头，然后在预览画布或右侧属性中编辑。')}</p>
        </div>
        <Icon name="text" size={18} />
      </header>
      <div className="cc-text-preset-grid">
        {TEXT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`cc-text-preset cc-text-preset-${preset.id}`}
            aria-label={t('添加文字：{name}', { name: t(preset.label) })}
            onClick={() => onAdd({
              ...preset.clip,
              name: t(preset.label),
              text: t(preset.placeholder),
            })}
          >
            <span className="cc-text-preset-preview">{t(preset.label)}</span>
            <span className="cc-text-preset-copy">
              <strong>{t(preset.label)}</strong>
              <small>{t(preset.description)}</small>
            </span>
            <span className="cc-text-preset-add" aria-hidden><Icon name="plus" size={13} /></span>
          </button>
        ))}
      </div>
    </section>
  );
}
