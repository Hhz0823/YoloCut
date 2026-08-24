import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

interface BuilderConfig {
  publish?: unknown[] | null;
  appId?: string;
  productName?: string;
  artifactName?: string;
  mac?: { target?: string[] };
  linux?: { executableName?: string };
  files?: string[];
}

async function configFor(target: string): Promise<BuilderConfig> {
  // Query isolation is intentional: the config reads CC_EB_TARGET once at module evaluation.
  process.env.CC_EB_TARGET = target;
  const moduleUrl = new URL(`../config/electron-builder.config.mjs?target=${target}`, import.meta.url);
  const loaded = await import(moduleUrl.href) as { default: BuilderConfig };
  return loaded.default;
}

delete process.env.YOLOCUT_RELEASE_REPOSITORY;
delete process.env.GITHUB_REPOSITORY;
const arm64 = await configFor('darwin-arm64');
assert.equal(arm64.publish, null, 'release installers must explicitly disable electron-updater feed inference');
assert.equal(arm64.appId, 'dev.yolocut.desktop');
assert.equal(arm64.productName, 'YoloCut');
assert.equal(arm64.artifactName, '${productName}-v${version}-${arch}.${ext}');
assert.deepEqual(arm64.mac?.target, ['dmg'], 'macOS releases must build only the directly installable DMG');
assert.ok(arm64.files?.includes('desktop-dist/native-asr-worker.mjs'));
assert.ok(
  arm64.files?.includes('desktop-dist/embedded-server.mjs'),
  'the lazily loaded embedded server bundle must ship with the desktop main process',
);
assert.ok(arm64.files?.includes('desktop-dist/project-store-ipc.mjs'));
assert.ok(arm64.files?.includes('desktop-dist/smoke-probe.mjs'));
assert.ok(arm64.files?.includes('desktop-dist/remotion-render.mjs'));
assert.ok(arm64.files?.includes('desktop-dist/native-semantic-worker.mjs'));
assert.ok(arm64.files?.includes('desktop-dist/native-clap-worker.mjs'));
assert.ok(arm64.files?.includes('desktop-dist/native-rhythm-worker.mjs'));
assert.ok(arm64.files?.includes('desktop-dist/native-tts-worker.mjs'));
assert.equal(
  arm64.files?.includes('!node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/**'),
  false,
  'the target ONNX Runtime binary must remain packaged',
);
assert.ok(
  arm64.files?.includes('!node_modules/onnxruntime-node/bin/napi-v6/win32/x64/**'),
  'foreign ONNX Runtime binaries must be excluded',
);

const x64 = await configFor('darwin-x64');
assert.equal(x64.publish, null);
assert.equal(
  x64.files?.includes('!node_modules/onnxruntime-node/bin/napi-v6/darwin/x64/**'),
  false,
  'x64 packages must retain the x64 ONNX Runtime binary',
);

const linux = await configFor('linux-x64');
assert.equal(linux.publish, null);
assert.equal(linux.linux?.executableName, 'yolocut');
for (const worker of ['asr', 'semantic', 'clap', 'rhythm', 'tts']) {
  assert.ok(
    linux.files?.includes(`desktop-dist/native-${worker}-worker.mjs`),
    `Linux packages must ship the native ${worker} worker`,
  );
}
assert.equal(
  linux.files?.includes('!node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**'),
  false,
  'Linux packages must retain the target ONNX Runtime binary',
);
assert.ok(
  linux.files?.includes('!node_modules/onnxruntime-node/bin/napi-v6/win32/x64/**'),
  'Linux packages must exclude foreign ONNX Runtime binaries',
);
assert.equal(
  linux.files?.includes('!node_modules/sqlite-vec-linux-x64/**'),
  false,
  'Linux x64 packages must retain sqlite-vec-linux-x64',
);
for (const foreignPackage of [
  'darwin-arm64',
  'darwin-x64',
  'windows-x64',
  'linux-arm64',
]) {
  assert.ok(
    linux.files?.includes(`!node_modules/sqlite-vec-${foreignPackage}/**`),
    `Linux x64 packages must exclude sqlite-vec-${foreignPackage}`,
  );
}

const linuxArm64 = await configFor('linux-arm64');
assert.equal(
  linuxArm64.files?.includes('!node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**'),
  false,
  'Linux arm64 packages must retain the arm64 ONNX Runtime binary',
);

const windows = await configFor('win32-x64');
assert.equal(windows.publish, null);
assert.equal(
  windows.files?.includes('!node_modules/onnxruntime-node/bin/napi-v6/win32/x64/**'),
  false,
  'Windows packages must retain the WebGPU-capable ONNX Runtime binary and companion DLLs',
);
assert.equal(
  windows.files?.includes('!node_modules/sqlite-vec-windows-x64/**'),
  false,
  'Windows packages must map win32-x64 to sqlite-vec-windows-x64',
);
assert.ok(
  windows.files?.includes('!node_modules/sqlite-vec-linux-x64/**'),
  'Windows packages must exclude foreign sqlite-vec extensions',
);

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  overrides?: Record<string, string>;
  devDependencies: Record<string, string>;
};
assert.equal(packageJson.dependencies['onnxruntime-node'], '1.27.0');
assert.equal(packageJson.overrides?.['onnxruntime-node'], '1.27.0');
for (const nativeFile of ['onnxruntime_binding.node', 'onnxruntime.dll', 'dxcompiler.dll', 'dxil.dll']) {
  await access(new URL(`../node_modules/onnxruntime-node/bin/napi-v6/win32/x64/${nativeFile}`, import.meta.url));
}
assert.equal(
  packageJson.devDependencies['electron-builder'],
  '26.15.7',
  'Windows NSIS packaging must retain the BCJ extraction fix shipped in electron-builder 26.15.6+',
);
assert.match(
  packageJson.scripts['desktop:build:main'],
  /native-rhythm-worker\.ts.*native-rhythm-worker\.mjs/,
  'desktop build must bundle the native rhythm utility process',
);
assert.match(
  packageJson.scripts['desktop:build:main'],
  /native-tts-worker\.ts.*native-tts-worker\.mjs/,
  'desktop build must bundle the native local TTS utility process',
);
assert.match(packageJson.scripts['desktop:dist'], /--mac --arm64/, 'arm64 packaging must build every configured mac target');
assert.match(packageJson.scripts['desktop:dist:mac-x64'], /--mac --x64/, 'x64 packaging must build every configured mac target');
assert.doesNotMatch(packageJson.scripts['desktop:dist'], /--mac (?:dmg|zip)/, 'mac packaging must use the installer-only target from shared config');
const windowsDistScript = packageJson.scripts['desktop:dist:win'];
for (const [scriptName, target] of [
  ['desktop:dist', 'darwin-arm64'],
  ['desktop:dist:mac-x64', 'darwin-x64'],
  ['desktop:dist:win', 'win32-x64'],
  ['desktop:dist:linux', 'linux-x64'],
] as const) {
  assert.match(
    packageJson.scripts[scriptName],
    new RegExp(`node scripts/clean-desktop-release-output\\.mjs ${target}`),
    `${scriptName} must remove target-specific stale release output before packaging`,
  );
}
assert.match(
  windowsDistScript,
  /spawnSync\(process\.execPath,\['node_modules\/electron-builder\/cli\.js'/,
  'Windows packaging must launch electron-builder through a cross-platform Node wrapper',
);
assert.match(
  windowsDistScript,
  /env:\{\.\.\.process\.env,CC_EB_TARGET:'win32-x64'\}/,
  'Windows packaging must explicitly select win32-x64 filters on every host',
);
assert.doesNotMatch(
  windowsDistScript,
  /&& electron-builder /,
  'Windows packaging must not invoke electron-builder with host-derived filters',
);
assert.match(
  windowsDistScript,
  /'--config','config\/electron-builder\.config\.mjs'/,
  'Windows packaging must pass the categorized electron-builder config path',
);
assert.match(
  packageJson.scripts['desktop:dist'],
  /--config config\/electron-builder\.config\.mjs/,
  'macOS packaging must pass the categorized electron-builder config path',
);
assert.match(
  packageJson.scripts['desktop:dist:linux'],
  /--config config\/electron-builder\.config\.mjs/,
  'Linux packaging must pass the categorized electron-builder config path',
);

const workflow = await readFile(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8');
const ciWorkflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const windowsInstallerSmoke = await readFile(
  new URL('../scripts/smoke-yolocut-installer.ps1', import.meta.url),
  'utf8',
);
for (const nativeArtifact of ['release/*.dmg', 'release/*.exe', 'release/*.AppImage']) {
  assert.ok(workflow.includes(nativeArtifact), `desktop jobs must retain the CI artifact ${nativeArtifact}`);
}
assert.doesNotMatch(
  workflow,
  /release\/\*\.(?:zip|yml|blockmap)/,
  'CI artifact upload must not retain updater metadata or non-installer archives',
);
assert.match(workflow, /EXPECTED_VERSION="\$\{GITHUB_REF_NAME#v\}"/, 'release gate must derive its package version');
for (const installer of ['x64.exe', 'arm64.dmg', 'x64.dmg']) {
  assert.ok(
    workflow.includes(`release-files/YoloCut-v\${EXPECTED_VERSION}-${installer}`),
    `release gate must stage ${installer}`,
  );
}
assert.match(workflow, /mkdir release-assets/);
assert.ok(
  workflow.includes("find release-assets -type f ! \\( -name '*.exe' -o -name '*.dmg' \\)"),
  'release staging must reject every non-EXE/DMG file',
);
assert.doesNotMatch(workflow, /SHA256SUMS\.txt/, 'checksums belong in release notes, not a release asset');
assert.match(ciWorkflow, /install -y -qq ffmpeg xvfb/, 'tag CI must install the virtual X server used by Electron tests');
assert.match(
  ciWorkflow,
  /run: xvfb-run --auto-servernum npm test/,
  'tag CI must run Electron and WebGL tests under Xvfb',
);

assert.doesNotMatch(
  workflow,
  /find release -type d -name YoloCut\.app|(?:mac|win|linux)-unpacked\b/,
  'desktop smoke tests must never launch unpacked electron-builder output',
);
assert.equal(
  workflow.match(/CC_SMOKE: '1'/g)?.length,
  2,
  'macOS and Linux artifacts must run the application smoke contract directly',
);
assert.equal(
  workflow.match(/CC_SMOKE_RENDER: '1'/g)?.length,
  2,
  'macOS and Linux artifacts must run the render smoke contract directly',
);
assert.match(
  workflow,
  /Smoke test Windows installer[\s\S]*?smoke-yolocut-installer\.ps1[\s\S]*?-Installer/,
  'the Windows release must use the shared installed-application smoke',
);
assert.doesNotMatch(workflow, /-ExpectUpdateFeed/, 'installer-only releases must not require updater metadata');
for (const smokeFlag of ['CC_SMOKE', 'CC_SMOKE_RENDER', 'CC_SMOKE_MCP_RECOVERY']) {
  assert.ok(
    windowsInstallerSmoke.includes(`$env:${smokeFlag} = '1'`),
    `the installed Windows application must set ${smokeFlag}`,
  );
}
assert.match(workflow, /hdiutil attach[\s\S]*?"\$\{dmgs\[0\]\}"/, 'macOS smoke must mount the generated DMG');
assert.match(
  workflow,
  /ditto "\$mounted_app" "\$app_dir\/YoloCut\.app"/,
  'macOS smoke must copy the mounted application to a writable temporary directory',
);
assert.doesNotMatch(workflow, /unzip|-name '\*\.zip'/, 'macOS release validation must not depend on a ZIP archive');
assert.match(
  workflow,
  /"\$copied_app\/Contents\/MacOS\/YoloCut"/,
  'macOS smoke must execute the application copied from the DMG',
);
assert.match(
  workflow,
  /"\$copied_app\/Contents\/Frameworks\/Electron Framework\.framework\/Versions\/A\/Electron Framework"/,
  'the copied DMG application must contain the Electron runtime',
);
assert.match(
  workflow,
  /render_runtime="YoloCut\.app\/Contents\/Resources\/chrome-headless-shell\//,
  'the copied DMG application must contain the packaged render runtime',
);
assert.match(
  workflow,
  /Get-ChildItem -LiteralPath release -Filter '\*\.exe' -File/,
  'Windows smoke must select the generated NSIS installer',
);
assert.match(
  windowsInstallerSmoke,
  /ArgumentList @\('\/S', "\/D=\$installDir"\)/,
  'Windows smoke must silently install NSIS into an isolated path',
);
assert.match(
  windowsInstallerSmoke,
  /Start-Process -FilePath \$installedExe[\s\S]*?-Wait -PassThru/,
  'Windows smoke must launch the installed executable',
);
assert.match(
  windowsInstallerSmoke,
  /Get-ChildItem -LiteralPath \$installDir -Filter 'Uninstall\*\.exe' -File/,
  'Windows smoke must run the generated uninstaller',
);
assert.match(
  windowsInstallerSmoke,
  /Installer-only YoloCut package unexpectedly contains a direct update feed/,
  'every installer-only package must fail closed when updater metadata is embedded',
);
assert.match(
  workflow,
  /xvfb-run --auto-servernum "\$\{appimages\[0\]\}" --appimage-extract-and-run/,
  'Linux smoke must execute the generated AppImage without relying on FUSE',
);
for (const smokeName of [
  'Smoke test macOS distribution',
  'Smoke test Windows installer',
  'Smoke test Linux AppImage',
]) {
  const smokeIndex = workflow.indexOf(`- name: ${smokeName}`);
  const artifactIndex = workflow.indexOf('- uses: actions/upload-artifact@v7');
  assert.ok(smokeIndex >= 0 && smokeIndex < artifactIndex, `${smokeName} must gate artifact publication`);
}

const draftIndex = workflow.indexOf('- name: Create or reuse draft release');
const pruneIndex = workflow.indexOf('- name: Remove non-installer release assets');
const uploadIndex = workflow.indexOf('- name: Upload and verify release assets');
const checksumNotesIndex = workflow.indexOf('- name: Put installer checksums in release notes');
const publishIndex = workflow.indexOf('- name: Publish verified draft');
assert.ok(
  draftIndex >= 0
    && draftIndex < pruneIndex
    && pruneIndex < uploadIndex
    && uploadIndex < checksumNotesIndex
    && checksumNotesIndex < publishIndex,
  'release workflow must create a draft, prune, verify installers, add checksums, then publish',
);
assert.match(
  workflow,
  /gh release create[\s\S]*?--draft; then/,
  'new GitHub Releases must begin as drafts',
);
assert.match(
  workflow,
  /if \[\[ "\$is_draft" != "true" \]\]; then[\s\S]*?already public/,
  'release retries must reject an existing public release',
);
assert.match(
  workflow,
  /gh release upload[\s\S]*?release-assets\/\*[\s\S]*?--clobber; then/,
  'draft retries must replace installer-only assets',
);
assert.match(
  workflow,
  /case "\$asset_name" in[\s\S]*?\*\.exe\|\*\.dmg\)[\s\S]*?gh api --method DELETE/,
  'the draft must delete every remote asset that is not an EXE or DMG',
);
assert.doesNotMatch(
  workflow,
  /gh release upload[\s\S]*?release-files\/\*/,
  'raw CI artifacts must never be uploaded directly to a GitHub Release',
);
assert.match(workflow, /sha256sum "\$asset"/, 'release verification must hash each local asset');
assert.match(
  workflow,
  /gh release view "\$GITHUB_REF_NAME"[\s\S]*?--json isDraft,assets/,
  'draft asset verification must use the release command that can read draft releases',
);
assert.match(
  workflow,
  /\.assets\[\] \| \[\.name, \(\.digest \/\/ ""\)\]/,
  'release verification must read back every remote asset name and digest',
);
assert.match(
  workflow,
  /cmp -s "\$local_manifest" "\$remote_manifest"/,
  'remote asset names and SHA-256 digests must exactly match the local manifest',
);
assert.match(workflow, /yolocut-installer-checksums:start/);
assert.match(workflow, /--notes-file "\$next_notes"/, 'installer hashes must be published in release notes');
assert.ok(
  workflow.indexOf('--draft=false') > publishIndex,
  'the verified draft must be published only in the final release step',
);

console.log('update-packaging.verify: installer-only release, manual update, smoke and digest contracts OK');
