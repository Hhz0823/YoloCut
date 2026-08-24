import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_ROOTS = ['src', 'server', 'desktop', 'shared', 'remotion', 'config'];
const SOURCE_EXTENSION = /\.(?:[cm]?ts|tsx)$/i;
const NON_PRODUCT_SOURCE = /(?:\.verify(?:-[^.]+)?|\.check)\.(?:[cm]?ts|tsx)$/i;

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return SOURCE_EXTENSION.test(entry.name)
      && !entry.name.endsWith('.d.ts')
      && !NON_PRODUCT_SOURCE.test(entry.name)
      ? [path.resolve(absolute)]
      : [];
  });
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

const files = SOURCE_ROOTS.flatMap((directory) => walk(path.join(ROOT, directory))).sort();
const fileSet = new Set(files.map((file) => path.normalize(file)));
const graph = new Map(files.map((file) => [file, new Set()]));
const literalMediaBinarySpawns = [];
const directHardwareDecodeConsumers = [];
const HARDWARE_DECODE_BOUNDARY = new Set([
  'server/media-performance-profile.ts',
  'server/media-runtime-decode.ts',
]);
const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  jsx: ts.JsxEmit.ReactJSX,
};

function runtimeModuleSpecifier(node) {
  if (ts.isImportDeclaration(node)) {
    if (!node.importClause) return node.moduleSpecifier;
    if (node.importClause.isTypeOnly) return undefined;
    if (node.importClause.name) return node.moduleSpecifier;
    const bindings = node.importClause.namedBindings;
    if (!bindings || ts.isNamespaceImport(bindings)) return node.moduleSpecifier;
    return bindings.elements.some((element) => !element.isTypeOnly) ? node.moduleSpecifier : undefined;
  }
  if (ts.isExportDeclaration(node)) {
    if (!node.moduleSpecifier || node.isTypeOnly) return undefined;
    if (node.exportClause && ts.isNamedExports(node.exportClause)
      && node.exportClause.elements.every((element) => element.isTypeOnly)) return undefined;
    return node.moduleSpecifier;
  }
  if (ts.isImportEqualsDeclaration(node)
    && !node.isTypeOnly
    && ts.isExternalModuleReference(node.moduleReference)) return node.moduleReference.expression;
  return undefined;
}

function addResolvedEdge(from, specifier) {
  if (!specifier.startsWith('.')) return;
  const resolved = ts.resolveModuleName(specifier, from, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
  if (!resolved) return;
  const target = path.normalize(path.resolve(resolved));
  if (fileSet.has(target)) graph.get(from)?.add(target);
}

function calledName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return '';
}

function inspectRuntimeBoundary(file, source) {
  const fileName = relative(file);
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calledName(node.expression);
      const first = node.arguments[0];
      if (['spawn', 'spawnSync', 'execFile', 'execFileSync'].includes(name)
        && first && ts.isStringLiteralLike(first)
        && /^(?:ffmpeg|ffprobe)(?:\.exe)?$/i.test(first.text)) {
        literalMediaBinarySpawns.push(`${fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
      }
      if (name === 'resolveHwDecodeArgs' && !HARDWARE_DECODE_BOUNDARY.has(fileName)) {
        directHardwareDecodeConsumers.push(`${fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

for (const file of files) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  inspectRuntimeBoundary(file, source);
  for (const statement of source.statements) {
    const moduleSpecifier = runtimeModuleSpecifier(statement);
    if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)) {
      addResolvedEdge(file, moduleSpecifier.text);
    }
  }
}

let nextIndex = 0;
const indices = new Map();
const lowLinks = new Map();
const stack = [];
const onStack = new Set();
const components = [];

function connect(file) {
  indices.set(file, nextIndex);
  lowLinks.set(file, nextIndex);
  nextIndex += 1;
  stack.push(file);
  onStack.add(file);

  for (const dependency of graph.get(file) ?? []) {
    if (!indices.has(dependency)) {
      connect(dependency);
      lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(dependency)));
    } else if (onStack.has(dependency)) {
      lowLinks.set(file, Math.min(lowLinks.get(file), indices.get(dependency)));
    }
  }

  if (lowLinks.get(file) !== indices.get(file)) return;
  const component = [];
  let member;
  do {
    member = stack.pop();
    onStack.delete(member);
    component.push(member);
  } while (member !== file);
  components.push(component);
}

for (const file of files) {
  if (!indices.has(file)) connect(file);
}

const cycles = components
  .filter((component) => component.length > 1
    || (component.length === 1 && graph.get(component[0])?.has(component[0])))
  .map((component) => component.map(relative).sort())
  .sort((left, right) => left[0].localeCompare(right[0]));

function topLevel(file) {
  return relative(file).split('/')[0];
}

const forbiddenDependencies = [];
for (const [from, dependencies] of graph) {
  const fromLayer = topLevel(from);
  for (const dependency of dependencies) {
    const toLayer = topLevel(dependency);
    const sharedImportsProductLayer = fromLayer === 'shared'
      && ['src', 'server', 'desktop', 'remotion', 'config'].includes(toLayer);
    const rendererImportsHostLayer = fromLayer === 'src' && ['server', 'desktop'].includes(toLayer);
    const serverImportsDesktop = fromLayer === 'server' && toLayer === 'desktop';
    if (sharedImportsProductLayer || rendererImportsHostLayer || serverImportsDesktop) {
      forbiddenDependencies.push(`${relative(from)} -> ${relative(dependency)}`);
    }
  }
}
forbiddenDependencies.sort();

if (cycles.length > 0 || forbiddenDependencies.length > 0
  || literalMediaBinarySpawns.length > 0 || directHardwareDecodeConsumers.length > 0) {
  if (cycles.length > 0) {
    console.error(`Runtime dependency cycles (${cycles.length}):`);
    for (const cycle of cycles) console.error(`  - ${cycle.join(' -> ')}`);
  }
  if (forbiddenDependencies.length > 0) {
    console.error(`Layer boundary violations (${forbiddenDependencies.length}):`);
    for (const violation of forbiddenDependencies) console.error(`  - ${violation}`);
  }
  if (literalMediaBinarySpawns.length > 0) {
    console.error(`Unresolved packaged media binaries (${literalMediaBinarySpawns.length}):`);
    for (const violation of literalMediaBinarySpawns) console.error(`  - ${violation}`);
  }
  if (directHardwareDecodeConsumers.length > 0) {
    console.error(`Hardware-only decode boundary violations (${directHardwareDecodeConsumers.length}):`);
    for (const violation of directHardwareDecodeConsumers) console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  const edgeCount = [...graph.values()].reduce((total, dependencies) => total + dependencies.size, 0);
  console.log(`Architecture OK: ${files.length} product modules, ${edgeCount} runtime imports, no cycles/layer violations, media binaries and decode fallback centralized.`);
}
