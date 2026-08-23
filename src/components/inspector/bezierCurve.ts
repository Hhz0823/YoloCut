import { easingControlPoints } from '../../editor/keyframes';
import type { KeyframeEasing } from '../../editor/types';

export type BezierControlPoints = [number, number, number, number];

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export function normalizeBezierControlPoints(value: readonly number[]): BezierControlPoints {
  return [clamp01(value[0] ?? 0), clamp01(value[1] ?? 0), clamp01(value[2] ?? 1), clamp01(value[3] ?? 1)];
}

export function editableBezierControlPoints(easing: KeyframeEasing | undefined): BezierControlPoints {
  return normalizeBezierControlPoints(easingControlPoints(easing) ?? [0, 0, 1, 1]);
}

export function bezierCurvePath(
  value: BezierControlPoints,
  width = 240,
  height = 140,
  padding = 16,
): string {
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const x = (unit: number) => padding + unit * innerWidth;
  const y = (unit: number) => padding + (1 - unit) * innerHeight;
  return `M ${x(0)} ${y(0)} C ${x(value[0])} ${y(value[1])}, ${x(value[2])} ${y(value[3])}, ${x(1)} ${y(1)}`;
}
