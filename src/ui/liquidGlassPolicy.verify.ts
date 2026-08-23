import assert from 'node:assert/strict';
import {
  chooseLiquidGlassRuntime,
  classifyLiquidGlassTone,
  parseComputedColor,
  relativeLuminance,
} from './liquidGlassPolicy';

const dark = parseComputedColor('#1c1c1e');
const light = parseComputedColor('rgb(239, 241, 245)');
const translucent = parseComputedColor('color(srgb 0.11 0.11 0.12 / 0.8)');
assert.ok(dark && light && translucent);
assert.ok(relativeLuminance(dark) < relativeLuminance(light));
assert.equal(translucent.a, 0.8);

assert.equal(classifyLiquidGlassTone({ backgroundColor: '#1c1c1e' }), 'dark');
assert.equal(classifyLiquidGlassTone({ backgroundColor: '#eff1f5' }), 'light');
assert.equal(classifyLiquidGlassTone({ backgroundImage: 'url(thumbnail.jpg)', backgroundColor: '#1c1c1e' }), 'mixed');
assert.equal(classifyLiquidGlassTone({ preference: 'mixed', backgroundColor: '#1c1c1e' }), 'mixed');
assert.equal(classifyLiquidGlassTone({ backgroundColor: 'transparent', colorScheme: 'light' }), 'light');

const capable = {
  prefersReducedMotion: false,
  supportsBackdropFilter: true,
  chromium: true,
} as const;
assert.equal(chooseLiquidGlassRuntime({ ...capable, tier: 'performance' }), 'performance');
assert.equal(chooseLiquidGlassRuntime({ ...capable, tier: 'balanced' }), 'balanced');
assert.equal(chooseLiquidGlassRuntime({ ...capable, tier: 'economy' }), 'fallback');
assert.equal(chooseLiquidGlassRuntime({ ...capable, tier: 'performance', prefersReducedMotion: true }), 'fallback');
assert.equal(chooseLiquidGlassRuntime({ ...capable, tier: 'performance', chromium: false }), 'fallback');
assert.equal(chooseLiquidGlassRuntime({ ...capable, tier: null }), 'fallback');

console.log('liquidGlassPolicy.verify: adaptive ink and performance fallbacks passed');
