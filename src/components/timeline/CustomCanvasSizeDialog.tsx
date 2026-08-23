import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CANVAS_DIMENSION_MAX,
  CANVAS_DIMENSION_MIN,
  customCanvasSize,
  ratioLabel,
} from '../../editor/aspectTypes';
import { useT } from '../../i18n/locale';
import { Icon } from '../icons';

interface CustomCanvasSizeDialogProps {
  width: number;
  height: number;
  onApply: (width: number, height: number) => void;
  onClose: () => void;
}

export function CustomCanvasSizeDialog({ width, height, onApply, onClose }: CustomCanvasSizeDialogProps) {
  const t = useT();
  const widthRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const [widthValue, setWidthValue] = useState(String(width));
  const [heightValue, setHeightValue] = useState(String(height));
  const parsed = useMemo(() => customCanvasSize(widthValue, heightValue), [heightValue, widthValue]);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    widthRef.current?.focus();
    widthRef.current?.select();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const apply = () => {
    if (!parsed) return;
    onApply(parsed.width, parsed.height);
  };

  return (
    <div
      className="cc-modal-backdrop"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <form
        className="cc-modal cc-custom-canvas-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cc-custom-canvas-title"
        onSubmit={(event) => { event.preventDefault(); apply(); }}
      >
        <header>
          <div>
            <strong id="cc-custom-canvas-title">{t('自定义画布尺寸')}</strong>
            <small>{t('输入 16–8192 像素的整数尺寸')}</small>
          </div>
          <button type="button" className="cc-custom-canvas-close" aria-label={t('关闭')} onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="cc-custom-canvas-fields">
          <label>
            <span>{t('宽度')}</span>
            <input
              ref={widthRef}
              type="number"
              inputMode="numeric"
              min={CANVAS_DIMENSION_MIN}
              max={CANVAS_DIMENSION_MAX}
              step={1}
              value={widthValue}
              onChange={(event) => setWidthValue(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="cc-custom-canvas-swap"
            aria-label={t('交换宽高')}
            title={t('交换宽高')}
            onClick={() => {
              setWidthValue(heightValue);
              setHeightValue(widthValue);
            }}
          >
            <Icon name="swap" size={15} />
          </button>
          <label>
            <span>{t('高度')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={CANVAS_DIMENSION_MIN}
              max={CANVAS_DIMENSION_MAX}
              step={1}
              value={heightValue}
              onChange={(event) => setHeightValue(event.target.value)}
            />
          </label>
        </div>
        <p className={parsed ? 'cc-custom-canvas-summary' : 'cc-custom-canvas-error'} role={parsed ? undefined : 'alert'}>
          {parsed
            ? `${parsed.width} × ${parsed.height} · ${ratioLabel(parsed.width, parsed.height)}`
            : t('宽度和高度必须是 16–8192 之间的整数')}
        </p>
        <footer>
          <button type="button" onClick={onClose}>{t('取消')}</button>
          <button type="submit" className="primary" disabled={!parsed}>{t('应用尺寸')}</button>
        </footer>
      </form>
    </div>
  );
}
