import type { ClientMediaPerformanceTier } from '../media/mediaPerformance';

export type LiquidGlassTone = 'light' | 'dark' | 'mixed';
export type LiquidGlassTonePreference = LiquidGlassTone | 'auto';
export type LiquidGlassRuntime = 'fallback' | 'balanced' | 'performance';

export interface ParsedColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface LiquidGlassRuntimeInput {
  readonly tier: ClientMediaPerformanceTier | null;
  readonly prefersReducedMotion: boolean;
  readonly supportsBackdropFilter: boolean;
  readonly chromium: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Parse the color forms Chromium returns from getComputedStyle(). */
export function parseComputedColor(value: string): ParsedColor | null {
  const input = value.trim().toLowerCase();
  if (!input || input === 'transparent') return null;

  const hex = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input)?.[1];
  if (hex) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  const numbers = input.match(/-?\d*\.?\d+/g)?.map(Number);
  if (!numbers || numbers.length < 3) return null;
  if (input.startsWith('color(srgb')) {
    return {
      r: clamp(numbers[0]! * 255, 0, 255),
      g: clamp(numbers[1]! * 255, 0, 255),
      b: clamp(numbers[2]! * 255, 0, 255),
      a: clamp(numbers[3] ?? 1, 0, 1),
    };
  }
  if (input.startsWith('rgb')) {
    return {
      r: clamp(numbers[0]!, 0, 255),
      g: clamp(numbers[1]!, 0, 255),
      b: clamp(numbers[2]!, 0, 255),
      a: clamp(numbers[3] ?? 1, 0, 1),
    };
  }
  return null;
}

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: ParsedColor): number {
  return (0.2126 * linearChannel(color.r))
    + (0.7152 * linearChannel(color.g))
    + (0.0722 * linearChannel(color.b));
}

export function classifyLiquidGlassTone(input: {
  readonly preference?: LiquidGlassTonePreference;
  readonly backgroundColor?: string;
  readonly backgroundImage?: string;
  readonly colorScheme?: string;
}): LiquidGlassTone {
  if (input.preference && input.preference !== 'auto') return input.preference;
  if (input.backgroundImage && input.backgroundImage !== 'none') return 'mixed';
  const parsed = parseComputedColor(input.backgroundColor ?? '');
  if (parsed && parsed.a > 0.08) return relativeLuminance(parsed) >= 0.46 ? 'light' : 'dark';
  return input.colorScheme?.toLowerCase().includes('light') ? 'light' : 'dark';
}

/**
 * Refraction is visual chrome, so it yields before editing throughput. Economy
 * machines and reduced-motion users get the same translucent surface without
 * SVG displacement or mouse work.
 */
export function chooseLiquidGlassRuntime(input: LiquidGlassRuntimeInput): LiquidGlassRuntime {
  if (input.prefersReducedMotion || !input.supportsBackdropFilter || !input.chromium) return 'fallback';
  if (input.tier === 'economy') return 'fallback';
  if (input.tier === 'performance') return 'performance';
  if (input.tier === 'balanced') return 'balanced';
  return 'fallback';
}
