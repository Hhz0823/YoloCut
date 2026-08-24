import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const mcpConfig = JSON.parse(read('.mcp.json'));
const builder = read('config/electron-builder.config.mjs');
const index = read('index.html');
const readme = read('README.md');
const workflow = read('.github/workflows/desktop.yml');

assert.equal(packageJson.name, 'yolocut');
assert.equal(packageJson.version, '0.0.2');
assert.equal(packageJson.desktopName, 'yolocut.desktop');
assert.equal(packageJson.repository?.url, 'git+https://github.com/Hhz0823/YoloCut.git');
assert.match(builder, /appId:\s*'dev\.yolocut\.desktop'/);
assert.match(builder, /productName:\s*'YoloCut'/);
assert.match(builder, /artifactName:\s*'\$\{productName\}-v\$\{version\}-\$\{arch\}\.\$\{ext\}'/);
assert.match(index, /href="\/yolocut-icon\.png"/);
assert.match(index, /<title>YoloCut<\/title>/);
assert.deepEqual(Object.keys(mcpConfig.mcpServers ?? {}), ['yolocut']);
assert.match(readme, /YoloCut-v0\.0\.2-x64\.exe/);
assert.match(readme, /releases\/tag\/v0\.0\.2/);
assert.match(workflow, /refs\/tags\/v/);
for (const installer of ['x64.exe', 'arm64.dmg', 'x64.dmg']) {
  assert.match(workflow, new RegExp(`YoloCut-v\\$\\{EXPECTED_VERSION\\}-${installer.replace('.', '\\.')}"`));
}
assert.match(workflow, /gh release upload[\s\S]*?release-assets\/\*/);
assert.doesNotMatch(workflow, /gh release upload[\s\S]*?release-files\/\*/);

const allowedHistoricalBrandFiles = new Set([
  'CHANGELOG.md',
  'README.md',
  'README_ZH.md',
  'YOLOCUT_AGENT_CONNECTION.md',
  'desktop/yolocut-compat.verify.ts',
  'scripts/verify-live-mcp.mjs',
  'scripts/smoke-yolocut-installer.ps1',
  'server/data-dir.verify.ts',
  'server/external-agent/external-skill.verify.mjs',
  'server/mcp-token.verify.ts',
  'shared/product-brand.verify.ts',
  'shared/product-compat.ts',
  'skills/yolocut/SKILL.md',
  'skills/yolocut/references/getting-started.md',
  'skills/yolocut/references/known-errors.md',
  'src/agent/skills/NOTICE.md',
]);
const textExtensions = /\.(?:cjs|css|html|js|json|jsx|md|mjs|mts|ps1|ts|tsx|yaml|yml)$/i;
const brandPattern = new RegExp(`(?:open)?${'chat'}${'cut'}`, 'i');
const paths = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
}).split(/\r?\n/).filter(Boolean);
const unexpected = [];
const legacyPaths = [];
for (const path of paths) {
  const normalized = path.replaceAll('\\', '/');
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
  if (brandPattern.test(normalized)) legacyPaths.push(normalized);
  if (!textExtensions.test(normalized) || statSync(absolute).size > 5 * 1024 * 1024) continue;
  if (allowedHistoricalBrandFiles.has(normalized)) continue;
  const text = readFileSync(absolute, 'utf8');
  if (brandPattern.test(text)) unexpected.push(normalized);
}
assert.deepEqual(legacyPaths, [], `tracked product paths still contain a historical brand: ${legacyPaths.join(', ')}`);
assert.deepEqual(unexpected, [], `historical brand leaked outside compatibility/legal files: ${unexpected.join(', ')}`);

console.log('verify-product-identity: YoloCut v0.0.2 package, UI, MCP, docs and path contracts OK');
