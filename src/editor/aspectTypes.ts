/** how 16:9-designed content adapts when the canvas ratio changes (`fit`) */
export type AspectFit = 'contain' | 'cover';

export interface AspectPreset {
  label: string;
  width: number;
  height: number;
}

export const CANVAS_DIMENSION_MIN = 16;
export const CANVAS_DIMENSION_MAX = 8192;

/** canvas ratios for long-to-short retargeting (manage_timelines `ratio`) */
export const ASPECT_PRESETS: AspectPreset[] = [
  { label: '16:9', width: 1920, height: 1080 },
  { label: '9:16', width: 1080, height: 1920 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '4:3', width: 1440, height: 1080 },
  { label: '3:4', width: 1080, height: 1440 },
];

export interface CustomCanvasSize {
  width: number;
  height: number;
}

/** Validate a user-entered canvas dimension without silently rounding or clamping it. */
export function canvasDimensionFromInput(value: string | number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(parsed)) return null;
  if (parsed < CANVAS_DIMENSION_MIN || parsed > CANVAS_DIMENSION_MAX) return null;
  return parsed;
}

export function customCanvasSize(
  width: string | number,
  height: string | number,
): CustomCanvasSize | null {
  const parsedWidth = canvasDimensionFromInput(width);
  const parsedHeight = canvasDimensionFromInput(height);
  return parsedWidth && parsedHeight ? { width: parsedWidth, height: parsedHeight } : null;
}

/** short ratio badge for a canvas size, e.g. 1920×1080 → "16:9". */
export function ratioLabel(width: number, height: number): string {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(width, height) || 1;
  return `${width / d}:${height / d}`;
}
