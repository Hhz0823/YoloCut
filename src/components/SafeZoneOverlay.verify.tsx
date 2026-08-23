import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeZoneOverlay } from './SafeZoneOverlay';
import { SAFE_ZONE_PRESETS } from './safeZonePresets';

const markup = renderToStaticMarkup(<SafeZoneOverlay />);
assert.match(markup, /aria-hidden="true"/);
assert.match(markup, /data-guide-preset="title-action"/);
assert.equal((markup.match(/border:1px dashed/g) ?? []).length, 2);
assert.match(markup, /inset:5%/);
assert.match(markup, /inset:10%/);

const grid = renderToStaticMarkup(<SafeZoneOverlay preset="grid" />);
assert.match(grid, /data-guide-preset="grid"/);
assert.match(grid, /left:33\.333%/);
assert.match(grid, /top:66\.667%/);

for (const preset of SAFE_ZONE_PRESETS.filter((entry) => !['title-action', 'grid'].includes(entry.id))) {
  const platform = renderToStaticMarkup(<SafeZoneOverlay preset={preset.id} />);
  assert.match(platform, new RegExp(`data-guide-preset="${preset.id}"`));
  assert.ok(platform.includes(preset.label));
}

console.log('SafeZoneOverlay.verify: title/action, grid, and platform guides passed');
