import type { PreviewCanvasSize } from './previewCanvasGeometry';

export const PREVIEW_ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const PREVIEW_ZOOM_MIN = PREVIEW_ZOOM_LEVELS[0];
export const PREVIEW_ZOOM_MAX = PREVIEW_ZOOM_LEVELS[PREVIEW_ZOOM_LEVELS.length - 1];

export interface PreviewPan {
  x: number;
  y: number;
}

export function clampPreviewZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, value));
}

export function stepPreviewZoom(current: number, direction: -1 | 1): number {
  const zoom = clampPreviewZoom(current);
  if (direction > 0) {
    return PREVIEW_ZOOM_LEVELS.find((level) => level > zoom + 1e-6) ?? PREVIEW_ZOOM_MAX;
  }
  return [...PREVIEW_ZOOM_LEVELS].reverse().find((level) => level < zoom - 1e-6) ?? PREVIEW_ZOOM_MIN;
}

export function zoomedPreviewCanvasSize(
  fitted: PreviewCanvasSize,
  zoom: number,
): PreviewCanvasSize {
  const safeZoom = clampPreviewZoom(zoom);
  return {
    width: fitted.width * safeZoom,
    height: fitted.height * safeZoom,
  };
}

/**
 * Keep panning bounded to the extra canvas created by zooming. At fit or below,
 * the canvas remains centered and cannot be lost outside the preview stage.
 */
export function clampPreviewPan(
  pan: PreviewPan,
  fitted: PreviewCanvasSize,
  zoom: number,
): PreviewPan {
  const safeZoom = clampPreviewZoom(zoom);
  if (safeZoom <= 1 || fitted.width <= 0 || fitted.height <= 0) return { x: 0, y: 0 };
  const maxX = (fitted.width * (safeZoom - 1)) / 2;
  const maxY = (fitted.height * (safeZoom - 1)) / 2;
  return {
    x: Math.min(maxX, Math.max(-maxX, Number.isFinite(pan.x) ? pan.x : 0)),
    y: Math.min(maxY, Math.max(-maxY, Number.isFinite(pan.y) ? pan.y : 0)),
  };
}
