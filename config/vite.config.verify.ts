import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAuthoritativeLocalProvider } from './vite.config.ts';

const inherited = { LLM_PROVIDER: 'openai' };
applyAuthoritativeLocalProvider(
  inherited,
  'export LLM_PROVIDER = "deepseek" # checkout selection wins\n',
);
assert.equal(
  inherited.LLM_PROVIDER,
  'deepseek',
  '.env.local uses dotenv quoting/export/comment syntax and overrides inherited process env',
);

const singleQuoted = { LLM_PROVIDER: 'openai' };
applyAuthoritativeLocalProvider(singleQuoted, "LLM_PROVIDER='anthropic' # quoted provider\n");
assert.equal(singleQuoted.LLM_PROVIDER, 'anthropic');

const absent = { LLM_PROVIDER: 'gemini' };
applyAuthoritativeLocalProvider(absent, 'OTHER_SETTING=value\n');
const explicitlyEmpty = { LLM_PROVIDER: 'openai' };
applyAuthoritativeLocalProvider(explicitlyEmpty, 'LLM_PROVIDER= # use repository default\n');
assert.equal(
  explicitlyEmpty.LLM_PROVIDER,
  '',
  'an explicit local provider setting still shadows inherited process env when empty',
);

assert.equal(absent.LLM_PROVIDER, 'gemini', 'an absent local provider preserves inherited selection');

const source = readFileSync(new URL('./vite.config.ts', import.meta.url), 'utf8');
assert.match(source, /startupSurfaceBudget\(\)/, 'production builds keep renderer startup budgets enabled');
assert.match(source, /clientFiles: \['src\/main\.tsx', 'src\/App\.tsx'\]/, 'Windows warmup entries stay filesystem-relative');
assert.doesNotMatch(source, /clientFiles: \['\/src\//, 'leading-slash warmup paths would resolve through /@fs on Windows');
assert.match(source, /name: 'heic'.*includeDependenciesRecursively: false/, 'HEIC stays isolated from shared startup dependencies');

console.log('Vite dotenv provider precedence verification passed');
