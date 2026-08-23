import assert from 'node:assert/strict';
import { LEGACY_MCP_STATUS_TOOLS, MCP_STATUS_TOOL } from '../../shared/product-brand.ts';
import { externalToolSchemas } from '../../src/agent/external-tool-schemas.ts';
import { TOOL_SCHEMAS } from '../../src/agent/tools.ts';
import { MCP_CONTROL_TOOL_NAMES, MCP_CONTROL_TOOLS } from './mcp-controls.ts';
import { buildMcpConnectionManifest } from './mcp-manifest.ts';
import { offlineExternalToolSchemas } from './offline-tools.ts';

const editorTools = externalToolSchemas();
const browserFullNames = [
  ...MCP_CONTROL_TOOLS.map((tool) => tool.name),
  ...editorTools
    .filter((tool) => MCP_CONTROL_TOOL_NAMES[tool.name] !== true)
    .map((tool) => tool.name),
];
const liveInput = {
  skillBaseline: 'test-baseline',
  connectedProjectIds: ['project-a'],
  editors: [{
    projectId: 'project-a',
    editorId: 'editor-a',
    baseRevision: 'revision-a',
    connected: true,
    toolCount: editorTools.length,
  }],
  exposureMode: 'full' as const,
  bindingMode: 'browser' as const,
  sessionBinding: { projectId: 'project-a' },
};
const ready = buildMcpConnectionManifest({
  ...liveInput,
  registeredToolNames: editorTools.map((tool) => tool.name),
  currentToolNames: browserFullNames,
  fullToolNames: browserFullNames,
});

assert(TOOL_SCHEMAS.length > 100, 'the canonical editor catalog remains broad');
assert.equal(ready.capabilityCoverage.canonicalToolCount, TOOL_SCHEMAS.length);
assert.equal(ready.capabilityCoverage.externalEditorCatalogToolCount, editorTools.length);
assert.equal(ready.capabilityCoverage.availableCanonicalToolCount, TOOL_SCHEMAS.length);
assert.deepEqual(ready.capabilityCoverage.missingCanonicalTools, []);
assert.deepEqual(ready.capabilityCoverage.missingRegisteredEditorTools, []);
assert.equal(ready.capabilityCoverage.complete, true);
assert.equal(ready.readiness.fullEditing, 'ready');
assert.deepEqual(ready.product, {
  name: 'YoloCut',
  clientName: 'yolocut',
  protocolNamespace: 'yolocut',
  statusTools: [MCP_STATUS_TOOL, ...LEGACY_MCP_STATUS_TOOLS],
});
assert.equal(ready.workflow[0]?.action, MCP_STATUS_TOOL);
assert.equal(ready.session.availableToolTier, 'browser');
assert.equal(ready.discovery.recommendedExposure, 'full');
assert.equal(ready.safety.appliedStatusRequiredBeforeClaimingCompletion, true);
for (const name of [MCP_STATUS_TOOL, ...LEGACY_MCP_STATUS_TOOLS]) {
  assert.equal(MCP_CONTROL_TOOL_NAMES[name], true);
}

const offlineNames = [
  ...MCP_CONTROL_TOOLS.map((tool) => tool.name),
  ...offlineExternalToolSchemas()
    .filter((tool) => MCP_CONTROL_TOOL_NAMES[tool.name] !== true)
    .map((tool) => tool.name),
];
const offline = buildMcpConnectionManifest({
  skillBaseline: 'test-baseline',
  connectedProjectIds: [],
  editors: [],
  registeredToolNames: [],
  currentToolNames: offlineNames,
  fullToolNames: offlineNames,
  exposureMode: 'full',
  bindingMode: null,
  sessionBinding: null,
});
assert.equal(offline.readiness.fullEditing, 'open_editor_required');
assert.equal(offline.session.availableToolTier, 'server-direct');
assert.equal(offline.capabilityCoverage.complete, false);
assert(offline.capabilityCoverage.missingCanonicalTools.length > 0);

const missingCanonicalName = TOOL_SCHEMAS.find((tool) => (
  MCP_CONTROL_TOOL_NAMES[tool.name] !== true
))!.name;
const mismatched = buildMcpConnectionManifest({
  ...liveInput,
  registeredToolNames: editorTools.map((tool) => tool.name)
    .filter((name) => name !== missingCanonicalName),
  currentToolNames: browserFullNames.filter((name) => name !== missingCanonicalName),
  fullToolNames: browserFullNames.filter((name) => name !== missingCanonicalName),
});
assert.equal(mismatched.readiness.fullEditing, 'catalog_mismatch');
assert.equal(mismatched.capabilityCoverage.complete, false);
assert.deepEqual(mismatched.capabilityCoverage.missingCanonicalTools, [missingCanonicalName]);

const missingLifecycleName = 'discard_edit_session';
const lifecycleMismatch = buildMcpConnectionManifest({
  ...liveInput,
  registeredToolNames: editorTools.map((tool) => tool.name)
    .filter((name) => name !== missingLifecycleName),
  currentToolNames: browserFullNames.filter((name) => name !== missingLifecycleName),
  fullToolNames: browserFullNames.filter((name) => name !== missingLifecycleName),
});
assert.equal(lifecycleMismatch.capabilityCoverage.availableCanonicalToolCount, TOOL_SCHEMAS.length);
assert.equal(lifecycleMismatch.capabilityCoverage.complete, false);
assert.equal(lifecycleMismatch.readiness.fullEditing, 'catalog_mismatch');
assert.deepEqual(lifecycleMismatch.capabilityCoverage.missingRegisteredEditorTools, [missingLifecycleName]);

console.log(`mcp-manifest.verify: ${TOOL_SCHEMAS.length}/${TOOL_SCHEMAS.length} canonical tools covered by the browser MCP surface`);
