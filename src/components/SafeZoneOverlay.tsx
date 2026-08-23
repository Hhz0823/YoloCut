import type { CSSProperties } from 'react';
import { SAFE_ZONE_PRESETS, type SafeZonePreset } from './safeZonePresets';

const frame = (inset: string, opacity: number): CSSProperties => ({
  position: 'absolute',
  inset,
  boxSizing: 'border-box',
  border: `1px dashed rgba(255,255,255,${opacity})`,
  borderRadius: 2,
});

const centerLine: CSSProperties = {
  position: 'absolute',
  background: 'rgba(255,255,255,0.28)',
};

function TitleActionGuide() {
  return (
    <>
      <div style={frame('5%', 0.58)} />
      <div style={frame('10%', 0.38)} />
      <div style={{ ...centerLine, left: '50%', top: '46%', width: 1, height: '8%' }} />
      <div style={{ ...centerLine, top: '50%', left: '46%', height: 1, width: '8%' }} />
    </>
  );
}

function GridGuide() {
  return (
    <>
      {[33.333, 66.667].map((position) => (
        <div key={`v-${position}`} style={{ ...centerLine, left: `${position}%`, top: 0, bottom: 0, width: 1 }} />
      ))}
      {[33.333, 66.667].map((position) => (
        <div key={`h-${position}`} style={{ ...centerLine, top: `${position}%`, left: 0, right: 0, height: 1 }} />
      ))}
    </>
  );
}

interface PlatformInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const PLATFORM_GUIDES: Record<Exclude<SafeZonePreset, 'title-action' | 'grid'>, PlatformInsets> = {
  tiktok: { top: 8, right: 17, bottom: 22, left: 6 },
  reels: { top: 8, right: 10, bottom: 18, left: 6 },
  shorts: { top: 8, right: 16, bottom: 18, left: 6 },
  spotlight: { top: 9, right: 12, bottom: 20, left: 6 },
};

function PlatformGuide({ preset }: { preset: keyof typeof PLATFORM_GUIDES }) {
  const insets = PLATFORM_GUIDES[preset];
  const label = SAFE_ZONE_PRESETS.find((entry) => entry.id === preset)?.label ?? preset;
  const exclusion = 'rgba(0,0,0,0.2)';
  return (
    <>
      <div style={{ position: 'absolute', inset: `${insets.top}% ${insets.right}% ${insets.bottom}% ${insets.left}%`, border: '1px dashed rgba(255,255,255,0.72)', borderRadius: 2 }} />
      <div style={{ position: 'absolute', inset: '0 0 auto 0', height: `${insets.top}%`, background: exclusion }} />
      <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: `${insets.bottom}%`, background: exclusion }} />
      <div style={{ position: 'absolute', top: `${insets.top}%`, right: 0, bottom: `${insets.bottom}%`, width: `${insets.right}%`, background: exclusion }} />
      <div style={{ position: 'absolute', top: `${insets.top}%`, left: 0, bottom: `${insets.bottom}%`, width: `${insets.left}%`, background: exclusion }} />
      <span style={{ position: 'absolute', top: `calc(${insets.top}% + 5px)`, left: `calc(${insets.left}% + 7px)`, padding: '2px 5px', borderRadius: 3, background: 'rgba(0,0,0,0.58)', color: 'rgba(255,255,255,0.88)', fontSize: 9, lineHeight: 1.2 }}>
        {label}
      </span>
    </>
  );
}

/** Editor-only composition guides; they are never part of preview input props or exports. */
export function SafeZoneOverlay({ preset = 'title-action' }: { preset?: SafeZonePreset }) {
  return (
    <div
      aria-hidden="true"
      data-guide-preset={preset}
      style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {preset === 'title-action' ? <TitleActionGuide />
        : preset === 'grid' ? <GridGuide />
          : <PlatformGuide preset={preset} />}
    </div>
  );
}
