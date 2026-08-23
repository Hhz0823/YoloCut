import assert from 'node:assert/strict';

const saved: string[] = [];
const nativeUpdates: string[] = [];
const documentElement = { lang: '' };

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => key === 'cc.locale' ? 'en' : null,
    setItem: (key: string, value: string) => saved.push(`${key}=${value}`),
  },
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { documentElement },
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    yoloCutDesktop: {
      setLocale: async (locale: string) => { nativeUpdates.push(locale); },
    },
  },
});

const { getLocale, setLocale } = await import('./locale.ts');
await Promise.resolve();

assert.equal(getLocale(), 'en');
assert.equal(documentElement.lang, 'en', 'persisted locale updates the document language at startup');
assert.deepEqual(nativeUpdates, ['en'], 'persisted locale reaches the native menu at startup');

setLocale('zh');
await Promise.resolve();
assert.equal(documentElement.lang, 'zh-CN');
assert.deepEqual(saved, ['cc.locale=zh']);
assert.deepEqual(nativeUpdates, ['en', 'zh'], 'runtime language changes reach the native menu');

setLocale('zh');
await Promise.resolve();
assert.deepEqual(
  nativeUpdates,
  ['en', 'zh', 'zh'],
  'reapplying the active locale can recover a native surface that was attached later',
);

console.log('desktop locale synchronization verification passed');
