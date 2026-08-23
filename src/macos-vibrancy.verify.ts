import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, root), 'utf8');

const [
  design,
  contract,
  handoff,
  css,
  indexCss,
  main,
  skins,
  dashboard,
  topbar,
  settings,
  desktopMain,
  liquidCss,
  liquidBackdrop,
  packageJson,
  notices,
  dashboardShell,
  libraryRail,
  chatPanel,
  icons,
  desktopPackaging,
] = await Promise.all([
  read('DESIGN.md'),
  read('design-contract.md'),
  read('implementation-handoff.md'),
  read('src/macos-vibrancy.css'),
  read('src/index.css'),
  read('src/main.tsx'),
  read('src/skins.ts'),
  read('src/components/dashboard/DashboardViews.tsx'),
  read('src/components/TopBar.tsx'),
  read('src/components/settings/SettingsDialog.tsx'),
  read('desktop/main.ts'),
  read('src/liquid-glass.css'),
  read('src/ui/LiquidGlassBackdrop.tsx'),
  read('package.json'),
  read('THIRD_PARTY_NOTICES.md'),
  read('src/components/Dashboard.tsx'),
  read('src/library/LibraryToolRail.tsx'),
  read('src/components/chat/ChatPanelView.tsx'),
  read('src/components/icons.tsx'),
  read('config/electron-builder.config.mjs'),
]);

const requiredHeadings = [
  '## 1. Visual Theme & Atmosphere',
  '## 2. Color',
  '## 3. Typography',
  '## 4. Spacing & Grid',
  '## 5. Layout & Composition',
  '## 6. Components',
  '## 7. Motion & Interaction',
  '## 8. Voice & Brand',
  '## 9. Anti-patterns',
];
assert.deepEqual(
  design.match(/^## .+$/gm),
  requiredHeadings,
  'DESIGN.md must retain the standard nine-section contract',
);
for (const phrase of ['Target artifact:', 'Audience:', 'Keep', 'Change', 'Do not copy', 'inferred']) {
  assert.ok(contract.includes(phrase), `design-contract.md must include ${phrase}`);
}
assert.ok(handoff.length < 3_000, 'implementation handoff must stay operational and concise');

const indexImport = main.indexOf("import './index.css';");
const vibrancyImport = main.indexOf("import './macos-vibrancy.css';");
const liquidImport = main.indexOf("import './liquid-glass.css';");
assert.ok(indexImport >= 0 && vibrancyImport > indexImport, 'vibrancy CSS must load after legacy component CSS');
assert.ok(liquidImport > vibrancyImport, 'Liquid Glass CSS must load after the base vibrancy contract');

for (const token of [
  "bg: '#1c1c1e'",
  "inset: '#1c1c1e'",
  "panel: '#2c2c2e'",
  "panelAlt: '#3a3a3c'",
  "accent: '#0a84ff'",
  "success: '#30d158'",
  "gold: '#ff9f0a'",
  "danger: '#ff453a'",
]) {
  assert.ok(skins.includes(token), `default skin is missing ${token}`);
}
assert.match(skins, /id: 'graphite', nameZh: 'macOS 毛玻璃'/);

for (const token of [
  '--cc-font-heading: Georgia',
  '--cc-radius-control: 8px',
  '--cc-radius-panel: 12px',
  'backdrop-filter: blur(24px)',
  'transition-property: color, background-color, border-color, opacity',
  '@media (prefers-reduced-motion: reduce)',
  '@media (hover: none) and (pointer: coarse)',
]) {
  assert.ok(css.includes(token), `macOS Vibrancy CSS is missing ${token}`);
}
assert.doesNotMatch(css, /gradient\(/i, 'application chrome stylesheet must not use gradients');
assert.doesNotMatch(css, /@keyframes/i, 'application chrome stylesheet must not define decorative animation');
assert.ok(
  css.includes(':not(.cc-preview-canvas, .cc-preview-canvas *, .cc-authored-preview, .cc-authored-preview *)'),
  'chrome-only resets must exclude user-authored canvas and motion-graphic previews',
);
for (const line of css.split(/\r?\n/).filter((entry) => entry.includes('box-shadow:'))) {
  assert.match(line, /box-shadow:\s*none\s*!important/, `only a shadow reset is allowed: ${line.trim()}`);
}

for (const source of [indexCss, css, dashboard, topbar, settings]) {
  assert.doesNotMatch(source, /0\.5px/, 'application chrome must use one-pixel hairlines');
  assert.doesNotMatch(source, /999px|borderRadius:\s*999/, 'application chrome must not use pill radii');
}
for (const source of [indexCss, dashboard, topbar, settings]) {
  assert.doesNotMatch(source, /gradient\(/i, 'high-frequency application chrome must not use gradients');
}
assert.match(dashboard, /cc-project-card/);
assert.match(dashboard, /cc-dashboard-toolbar/);
assert.match(topbar, /cc-primary-action/);
assert.match(topbar, /cc-account-placeholder/);
assert.match(settings, /cc-settings-sidebar/);
assert.match(settings, /cc-settings-nav-row/);
assert.doesNotMatch(settings, /borderLeft:\s*`2px/, 'settings selection must not use an accent stripe');
assert.equal(
  desktopMain.match(/backgroundColor: '#1c1c1e'/g)?.length,
  3,
  'main, transcript, and detachable Agent windows must start on the deepest graphite surface',
);

assert.match(packageJson, /"liquid-glass-react": "1\.1\.1"/);
for (const token of [
  "lazy(() => import('liquid-glass-react'))",
  '<Suspense fallback={<div className="cc-liquid-glass-fallback" />}>',
  'mode="standard"',
  'cornerRadius={12}',
  'elasticity={0}',
  'globalMousePos={STATIC_POINTER}',
  "tier: profile?.tier ?? null",
]) {
  assert.ok(liquidBackdrop.includes(token), `Liquid Glass wrapper is missing ${token}`);
}
assert.match(liquidCss, /data-cc-glass-tone="light"/);
assert.match(liquidCss, /data-cc-glass-tone="dark"/);
assert.match(liquidCss, /data-cc-glass-tone="mixed"[\s\S]*linear-gradient/);
assert.match(liquidCss, /cc-liquid-glass-fallback/);
assert.match(notices, /liquid-glass-react[\s\S]*Version: 1\.1\.1[\s\S]*MIT[\s\S]*MAX ROVENSKY/);
assert.match(desktopPackaging, /'THIRD_PARTY_NOTICES\.md'/,
  'desktop installers must carry the Liquid Glass MIT attribution');
for (const source of [dashboardShell, topbar, libraryRail, chatPanel, settings]) {
  assert.match(source, /cc-liquid-glass-host/);
  assert.match(source, /<LiquidGlassBackdrop \/>/);
}
assert.match(icons, /<linearGradient[\s\S]*cc-wordmark-mixed/);
assert.doesNotMatch(dashboard, /cc-project-card[\s\S]{0,200}<LiquidGlassBackdrop/,
  'repeated dashboard cards must not each mount a refraction engine');

console.log('macos-vibrancy.verify: design contract and application chrome gates passed');
