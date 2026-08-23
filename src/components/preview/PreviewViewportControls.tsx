import { theme } from '../../theme';
import { useT } from '../../i18n/locale';
import { Icon } from '../icons';
import { PREVIEW_ZOOM_MAX, PREVIEW_ZOOM_MIN } from './previewViewport';

interface PreviewViewportControlsProps {
  zoom: number;
  panMode: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onTogglePan: () => void;
}

function ControlButton({ label, disabled, active, children, onClick }: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="cc-preview-viewport-button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      title={label}
      onClick={onClick}
      style={{ color: active ? theme.accent : theme.textMuted }}
    >
      {children}
    </button>
  );
}

export function PreviewViewportControls({
  zoom, panMode, onZoomOut, onZoomIn, onFit, onTogglePan,
}: PreviewViewportControlsProps) {
  const t = useT();
  const percent = Math.round(zoom * 100);
  return (
    <div className="cc-preview-viewport-controls" aria-label={t('预览画布视图')}>
      <ControlButton label={t('缩小预览画布')} disabled={zoom <= PREVIEW_ZOOM_MIN} onClick={onZoomOut}>
        <Icon name="zoomOut" size={13} />
      </ControlButton>
      <button type="button" className="cc-preview-zoom-value" title={t('适配预览画布')} onClick={onFit}>
        {percent}%
      </button>
      <ControlButton label={t('放大预览画布')} disabled={zoom >= PREVIEW_ZOOM_MAX} onClick={onZoomIn}>
        <Icon name="zoomIn" size={13} />
      </ControlButton>
      <ControlButton label={t('适配预览画布')} disabled={zoom === 1 && !panMode} onClick={onFit}>
        <Icon name="fit" size={13} />
      </ControlButton>
      <ControlButton label={t('拖动平移预览画布')} disabled={zoom <= 1} active={panMode} onClick={onTogglePan}>
        <Icon name="hand" size={13} />
      </ControlButton>
    </div>
  );
}
