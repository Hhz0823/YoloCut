import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useMediaPerformanceProfile } from '../media/mediaPerformance';
import {
  chooseLiquidGlassRuntime,
  classifyLiquidGlassTone,
  parseComputedColor,
  type LiquidGlassTone,
  type LiquidGlassTonePreference,
} from './liquidGlassPolicy';

const STATIC_POINTER = Object.freeze({ x: 0, y: 0 });
const LiquidGlass = lazy(() => import('liquid-glass-react'));

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function detectHostTone(host: HTMLElement, preference: LiquidGlassTonePreference): LiquidGlassTone {
  if (preference !== 'auto') return preference;
  let node: HTMLElement | null = host;
  for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.backgroundImage && style.backgroundImage !== 'none') return 'mixed';
    const background = parseComputedColor(style.backgroundColor);
    if (background && background.a > 0.08) {
      return classifyLiquidGlassTone({
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        colorScheme: style.colorScheme,
      });
    }
  }
  const root = getComputedStyle(document.documentElement);
  return classifyLiquidGlassTone({ colorScheme: root.getPropertyValue('--cc-color-scheme') || root.colorScheme });
}

export function LiquidGlassBackdrop({
  tone = 'auto',
  className = '',
}: {
  readonly tone?: LiquidGlassTonePreference;
  readonly className?: string;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [resolvedTone, setResolvedTone] = useState<LiquidGlassTone>(tone === 'auto' ? 'dark' : tone);
  const profile = useMediaPerformanceProfile();
  const reducedMotion = useReducedMotion();
  const supportsBackdropFilter = typeof CSS !== 'undefined'
    && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
  const chromium = typeof navigator !== 'undefined' && /(Chrome|Chromium|Edg)\//.test(navigator.userAgent);
  const runtime = chooseLiquidGlassRuntime({
    tier: profile?.tier ?? null,
    prefersReducedMotion: reducedMotion,
    supportsBackdropFilter,
    chromium,
  });

  useEffect(() => {
    const host = layerRef.current?.parentElement;
    if (!host) return undefined;
    const update = (): void => setResolvedTone(detectHostTone(host, tone));
    update();
    const observer = new MutationObserver(update);
    observer.observe(host, { attributes: true, attributeFilter: ['class', 'style'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-cc-skin'] });
    return () => observer.disconnect();
  }, [tone]);

  useEffect(() => {
    const host = layerRef.current?.parentElement;
    if (!host) return undefined;
    host.dataset.ccGlassTone = resolvedTone;
    host.dataset.ccGlassRuntime = runtime;
    return () => {
      delete host.dataset.ccGlassTone;
      delete host.dataset.ccGlassRuntime;
    };
  }, [resolvedTone, runtime]);

  const config = runtime === 'performance'
    ? { displacementScale: 18, blurAmount: 0.48, saturation: 118, aberrationIntensity: 0.65 }
    : { displacementScale: 10, blurAmount: 0.36, saturation: 108, aberrationIntensity: 0.3 };

  return (
    <div
      ref={layerRef}
      className={`cc-liquid-glass-layer${className ? ` ${className}` : ''}`}
      data-runtime={runtime}
      data-tone={resolvedTone}
      aria-hidden="true"
    >
      {runtime === 'fallback' ? <div className="cc-liquid-glass-fallback" /> : (
        <Suspense fallback={<div className="cc-liquid-glass-fallback" />}>
          <LiquidGlass
            className="cc-liquid-glass-engine"
            mode="standard"
            cornerRadius={12}
            padding="0"
            elasticity={0}
            overLight={resolvedTone === 'light'}
            globalMousePos={STATIC_POINTER}
            mouseOffset={STATIC_POINTER}
            displacementScale={config.displacementScale}
            blurAmount={config.blurAmount}
            saturation={config.saturation}
            aberrationIntensity={config.aberrationIntensity}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            <span className="cc-liquid-glass-fill" />
          </LiquidGlass>
        </Suspense>
      )}
    </div>
  );
}
