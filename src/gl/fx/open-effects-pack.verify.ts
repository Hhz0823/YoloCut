import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ids = [
  'builtin:fx-vhs',
  'builtin:fx-zoom-blur',
  'builtin:fx-prism',
  'builtin:fx-ripple',
  'builtin:fx-night-vision',
  'builtin:fx-thermal',
  'builtin:fx-comic',
  'builtin:fx-emboss',
  'builtin:fx-old-film',
  'builtin:fx-liquid-glass',
] as const;
const files = [
  'vhs.frag',
  'zoom-blur.frag',
  'prism.frag',
  'ripple.frag',
  'night-vision.frag',
  'thermal.frag',
  'comic.frag',
  'emboss.frag',
  'old-film.frag',
  'liquid-glass.frag',
] as const;

const catalog = readFileSync(new URL('./effects.ts', import.meta.url), 'utf8');
const translations = readFileSync(new URL('../../i18n/dict/en/fx.ts', import.meta.url), 'utf8');
for (const id of ids) {
  assert.equal(catalog.match(new RegExp(`'${id}'`, 'g'))?.length, 3, `${id} is imported once, defined once, and ordered once`);
}
for (const file of files) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source, /^#version 300 es/);
  assert.match(source, /uniform sampler2D u_input;/);
  assert.match(source, /in vec2 v_texCoord;/);
  assert.match(source, /out vec4 fragColor;/);
  assert.doesNotMatch(source, /fragColor[^\n]*,\s*1\.0\s*\)\s*;/, `${file} must not force opaque alpha`);
}
for (const name of [
  'VHS 录像带', '变焦模糊', '棱镜色散', '水波扭曲', '夜视仪',
  '热成像', '漫画描边', '浮雕', '老电影划痕', '液态玻璃折射',
]) {
  assert.match(translations, new RegExp(`'${name}'`), `${name} has an English display label`);
}

assert.match(catalog, /Open Effects Pack: dependency-free GLSL distributed with YoloCut under AGPL-3\.0/);
console.log('open-effects-pack.verify: 10 AGPL GPU effects are catalogued, ordered, alpha-safe, and localized');
