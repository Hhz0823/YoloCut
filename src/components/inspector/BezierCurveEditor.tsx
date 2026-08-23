import { useEffect, useRef } from 'react';
import type { KeyframeEasing } from '../../editor/types';
import { useT } from '../../i18n/locale';
import { Icon } from '../icons';
import { useHistoryGesture } from './historyGesture';
import {
  bezierCurvePath,
  editableBezierControlPoints,
} from './bezierCurve';

const BEZIER_PRESETS: readonly { id: string; label: string; value?: KeyframeEasing }[] = [
  { id: 'linear', label: '线性' },
  { id: 'easeIn', label: '缓入', value: 'easeIn' },
  { id: 'easeOut', label: '缓出', value: 'easeOut' },
  { id: 'easeInOut', label: '缓入出', value: 'easeInOut' },
] as const;

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

interface BezierCurveEditorProps {
  easing: KeyframeEasing | undefined;
  onChange: (easing: KeyframeEasing | undefined) => void;
  onClose: () => void;
}

const GRAPH_WIDTH = 240;
const GRAPH_HEIGHT = 140;
const GRAPH_PADDING = 16;

export function BezierCurveEditor({ easing, onChange, onClose }: BezierCurveEditorProps) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<0 | 1 | null>(null);
  const onCloseRef = useRef(onClose);
  const gesture = useHistoryGesture();
  const control = editableBezierControlPoints(easing);
  const innerWidth = GRAPH_WIDTH - GRAPH_PADDING * 2;
  const innerHeight = GRAPH_HEIGHT - GRAPH_PADDING * 2;
  const point = (index: 0 | 1) => ({
    x: GRAPH_PADDING + control[index * 2] * innerWidth,
    y: GRAPH_PADDING + (1 - control[index * 2 + 1]) * innerHeight,
  });
  const p1 = point(0);
  const p2 = point(1);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const updateHandle = (index: 0 | 1, clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const x = clamp01(((clientX - rect.left) / rect.width * GRAPH_WIDTH - GRAPH_PADDING) / innerWidth);
    const y = clamp01(1 - (((clientY - rect.top) / rect.height * GRAPH_HEIGHT - GRAPH_PADDING) / innerHeight));
    const next = [...control] as [number, number, number, number];
    next[index * 2] = Number(x.toFixed(3));
    next[index * 2 + 1] = Number(y.toFixed(3));
    onChange(next);
  };

  const setNumeric = (index: number, raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const next = [...control] as [number, number, number, number];
    next[index] = Number(clamp01(parsed).toFixed(3));
    onChange(next);
  };

  return (
    <div className="cc-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cc-modal cc-bezier-dialog" role="dialog" aria-modal="true" aria-labelledby="cc-bezier-title">
        <header>
          <div>
            <strong id="cc-bezier-title">{t('关键帧曲线编辑器')}</strong>
            <small>{t('调整当前关键帧到下一关键帧的速度曲线')}</small>
          </div>
          <button type="button" className="cc-bezier-close" aria-label={t('关闭')} onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="cc-bezier-presets">
          {BEZIER_PRESETS.map((preset) => (
            <button key={preset.id} type="button" onClick={() => onChange(preset.value)}>{t(preset.label)}</button>
          ))}
          <button type="button" className={Array.isArray(easing) ? 'selected' : ''} onClick={() => onChange(control)}>{t('自定义')}</button>
        </div>
        <svg
          ref={svgRef}
          className="cc-bezier-graph"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          role="img"
          aria-label={t('贝塞尔速度曲线')}
          onPointerMove={(event) => {
            if (dragging.current === null) return;
            updateHandle(dragging.current, event.clientX, event.clientY);
          }}
          onPointerUp={() => { dragging.current = null; }}
          onPointerCancel={() => { dragging.current = null; }}
        >
          <line x1={GRAPH_PADDING} y1={GRAPH_PADDING} x2={GRAPH_PADDING} y2={GRAPH_HEIGHT - GRAPH_PADDING} className="axis" />
          <line x1={GRAPH_PADDING} y1={GRAPH_HEIGHT - GRAPH_PADDING} x2={GRAPH_WIDTH - GRAPH_PADDING} y2={GRAPH_HEIGHT - GRAPH_PADDING} className="axis" />
          <line x1={GRAPH_PADDING} y1={GRAPH_HEIGHT - GRAPH_PADDING} x2={p1.x} y2={p1.y} className="handle-line" />
          <line x1={GRAPH_WIDTH - GRAPH_PADDING} y1={GRAPH_PADDING} x2={p2.x} y2={p2.y} className="handle-line" />
          <path d={bezierCurvePath(control)} className="curve" />
          {([p1, p2] as const).map((handle, index) => (
            <circle
              key={index}
              cx={handle.x}
              cy={handle.y}
              r={6}
              tabIndex={0}
              aria-label={t('控制点 {n}', { n: index + 1 })}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                dragging.current = index as 0 | 1;
                gesture.onPointerDown();
                updateHandle(index as 0 | 1, event.clientX, event.clientY);
              }}
            />
          ))}
        </svg>
        <div className="cc-bezier-values">
          {control.map((value, index) => (
            <label key={index}>
              <span>{index % 2 === 0 ? `X${Math.floor(index / 2) + 1}` : `Y${Math.floor(index / 2) + 1}`}</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={value}
                onPointerDown={gesture.onPointerDown}
                onKeyDown={gesture.onKeyDown}
                onKeyUp={gesture.onKeyUp}
                onChange={(event) => setNumeric(index, event.target.value)}
              />
            </label>
          ))}
        </div>
        <footer>
          <code>cubic-bezier({control.map((value) => Number(value.toFixed(3))).join(', ')})</code>
          <button type="button" className="primary" onClick={onClose}>{t('完成')}</button>
        </footer>
      </div>
    </div>
  );
}
