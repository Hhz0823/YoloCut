import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AgentContext } from '../../src/agent/context.ts';
import {
  captureExternalToolActions,
  createExternalEditSession,
  externalDraftContext,
  finishExternalEditSession,
  forkExternalEditSession,
  reviewExternalEditSession,
  revisionOf,
  type ExternalEditSession,
} from '../../src/agent/external-edit-session.ts';
import { externalToolSchemas, validateExternalInvocation } from '../../src/agent/external-tool-schemas.ts';
import { execCoreDataTool } from '../../src/agent/tools/core-data-tools.ts';
import { execReadProjectTool } from '../../src/agent/tools/read-project-tools.ts';
import { TOOL_SCHEMAS } from '../../src/agent/tools.ts';
import { historyReduce, type History } from '../../src/editor/reduce.ts';
import { makeDraft, replayActions } from '../../src/editor/store.ts';
import type { ProjectDoc } from '../../src/editor/types.ts';
import { acceptanceDocumentHash } from '../../desktop/agent-edit-acceptance-contract.ts';
import { CURRENT_PROJECT_VERSION } from '../../shared/project-version.ts';
import {
  nextEditorCall,
  registerEditor,
  resetExternalAgentBrokerForTest,
  settleEditorCall,
  touchEditor,
} from './broker.ts';
import {
  handleMcpRequest,
  resetMcpSessionsForTest,
} from './mcp.ts';
import { closeClient, connectClient } from './mcp-session-verifier.ts';

const execFileAsync = promisify(execFile);
const projectId = 'mcp-video-edit-acceptance';
const editorId = 'mcp-video-edit-editor';
const clipId = 'clip_acceptance_main';
const assetId = 'asset_acceptance_main';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

async function generateVideo(path: string): Promise<{ bytes: number; sha256: string }> {
  const executable = join(
    process.cwd(),
    'node_modules',
    'ffmpeg-static',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
  );
  await execFileAsync(executable, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
    '-t', '6', '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    path,
  ], { windowsHide: true, maxBuffer: 1024 * 1024 });
  const bytes = (await stat(path)).size;
  const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
  return { bytes, sha256 };
}

function fixtureDocument(src: string, bytes: number, sha256: string): ProjectDoc {
  return {
    version: CURRENT_PROJECT_VERSION,
    assets: [{
      id: assetId,
      name: 'mcp-agent-fixture.mp4',
      sourceFilename: 'mcp-agent-fixture.mp4',
      kind: 'video',
      src,
      durationInFrames: 180,
      sourceRevision: `sha256:${sha256}`,
      sourceContentHash: sha256,
      sourceSize: bytes,
      width: 320,
      height: 180,
    }],
    mediaFolders: [],
    activeTimelineId: 'timeline_acceptance',
    timelines: [{
      id: 'timeline_acceptance',
      name: 'MCP Video Edit Acceptance',
      order: 0,
      fps: 30,
      width: 320,
      height: 180,
      selectedId: null,
      trackOrder: ['track_v2', 'track_v1', 'track_a1'],
      tracks: {
        track_v2: { kind: 'video', name: 'Titles' },
        track_v1: { kind: 'video', name: 'Main Video' },
        track_a1: { kind: 'audio', name: 'Audio' },
      },
      items: [{
        id: clipId,
        name: 'mcp-agent-fixture.mp4',
        kind: 'video',
        track: 'track_v1',
        startFrame: 0,
        durationInFrames: 180,
        srcInFrame: 0,
        src,
        sourceAssetId: assetId,
        sourceRevision: `sha256:${sha256}`,
        sourceContentHash: sha256,
        sourceFilename: 'mcp-agent-fixture.mp4',
        volume: 1,
      }],
    }],
  };
}

function structured(result: CallToolResult): Record<string, unknown> {
  assert(result.structuredContent && typeof result.structuredContent === 'object');
  return result.structuredContent;
}

function sessionInfo(session: ExternalEditSession): Record<string, unknown> {
  return {
    editSessionId: session.id,
    approvalMode: session.approvalMode,
    status: session.status,
    operationCount: session.operationCount,
    applied: session.status === 'applied',
  };
}

const root = await mkdtemp(join(tmpdir(), 'occ-mcp-video-edit-'));
const videoPath = join(root, 'mcp-agent-fixture.mp4');
const media = await generateVideo(videoPath);
const baseDoc = fixtureDocument(pathToFileURL(videoPath).href, media.bytes, media.sha256);
const live = makeDraft(baseDoc);
const context: AgentContext = {
  commands: live.commands,
  getState: live.getState,
  getDoc: live.getDoc,
  getCreativeMode: () => null,
  templates: [],
  audio: [],
  getProjectId: () => projectId,
  getOfflineMediaSrcs: () => new Set(),
};
let session: ExternalEditSession | null = null;
let editorRevision = revisionOf(baseDoc);

async function executeEditorTool(name: string, rawArgs: Record<string, unknown>): Promise<unknown> {
  if (name === 'begin_edit_session') {
    const args = validateExternalInvocation(name, rawArgs);
    session = createExternalEditSession(live.getDoc(), args.clientName, args.approvalMode);
    return sessionInfo(session);
  }
  assert(session, 'an edit session must exist');
  assert.equal(rawArgs.editSessionId, session.id);
  const args = validateExternalInvocation(name, rawArgs);
  if (name === 'read_project') {
    return execReadProjectTool(name, args, externalDraftContext(session, context));
  }
  if (name === 'read_timeline') {
    return execCoreDataTool(name, args, externalDraftContext(session, context));
  }
  if (name === 'set_item_timing' || name === 'set_aspect_ratio') {
    const isolated = forkExternalEditSession(session);
    const result = execCoreDataTool(name, args, externalDraftContext(isolated, context));
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error(String(result.error));
    }
    session = captureExternalToolActions(isolated, name, args);
    return result;
  }
  if (name === 'review_edit_session') {
    session = reviewExternalEditSession(session, args.summary);
    assert.equal(session.approvalMode, 'auto');
    const operations = session.proposal?.options[0].operations ?? [];
    const resultDoc = replayActions(live.getDoc(), operations.flatMap((operation) => operation.actions));
    live.commands.applyDoc(resultDoc);
    session = finishExternalEditSession(session, 'applied', operations.length);
    return sessionInfo(session);
  }
  if (name === 'get_edit_session') return sessionInfo(session);
  throw new Error(`unexpected acceptance tool ${name}`);
}

await resetMcpSessionsForTest();
resetExternalAgentBrokerForTest();
const registrationCapability = registerEditor(
  projectId,
  editorId,
  editorRevision,
  externalToolSchemas(),
);
const server = createServer((request, response) => {
  void handleMcpRequest(request, response, 'http://127.0.0.1').catch((error) => {
    if (!response.headersSent) response.writeHead(500);
    response.end(error instanceof Error ? error.message : String(error));
  });
});
const port = await listen(server);
const client = await connectClient(new URL(`http://127.0.0.1:${port}/mcp`), 'mcp-video-edit-acceptance');

async function callEditor(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const pending = client.client.callTool({ name, arguments: args });
  const call = await nextEditorCall(
    projectId,
    editorId,
    editorRevision,
    AbortSignal.timeout(2_000),
    registrationCapability,
  );
  assert(call, `editor did not receive ${name}`);
  assert.equal(call.name, name);
  try {
    const value = await executeEditorTool(call.name, call.arguments);
    assert.equal(settleEditorCall(call.id, 'applied', value, registrationCapability), true);
  } catch (error) {
    settleEditorCall(
      call.id,
      'failed',
      error instanceof Error ? error.message : String(error),
      registrationCapability,
    );
  }
  const result = await pending;
  const nextRevision = revisionOf(live.getDoc());
  if (nextRevision !== editorRevision) {
    editorRevision = nextRevision;
    assert.equal(await touchEditor(
      projectId,
      editorId,
      editorRevision,
      registrationCapability,
    ), true);
  }
  return result;
}

try {
  const listed = await client.client.listTools();
  const listedNames = new Set(listed.tools.map((tool) => tool.name));
  for (const schema of TOOL_SCHEMAS) {
    assert.equal(listedNames.has(schema.name), true, `canonical tool ${schema.name} is exposed`);
  }
  const manifest = structured(await client.client.callTool({
    name: 'get_connection_manifest', arguments: {},
  }));
  const coverage = manifest.capabilityCoverage as Record<string, unknown>;
  assert.equal(manifest.readiness && (manifest.readiness as Record<string, unknown>).fullEditing, 'ready');
  assert.equal(coverage.complete, true);
  assert.equal(coverage.availableCanonicalToolCount, TOOL_SCHEMAS.length);
  assert.deepEqual(coverage.missingCanonicalTools, []);

  const target = await client.client.callTool({
    name: 'target_project', arguments: { projectId },
  });
  assert.notEqual(target.isError, true);
  const begun = structured(await callEditor('begin_edit_session', {
    clientName: 'Codex MCP acceptance',
    approvalMode: 'auto',
  }));
  const editSessionId = String(begun.editSessionId);

  const assets = structured(await callEditor('read_project', {
    editSessionId,
    view: 'assets',
  }));
  assert.match(JSON.stringify(assets), /mcp-agent-fixture\.mp4/);
  const timeline = structured(await callEditor('read_timeline', { editSessionId }));
  assert.match(JSON.stringify(timeline), new RegExp(clipId));

  const trimmed = await callEditor('set_item_timing', {
    editSessionId,
    itemId: clipId,
    durationInFrames: 120,
    fadeOutSeconds: 0.25,
  });
  assert.notEqual(trimmed.isError, true);
  const reframed = await callEditor('set_aspect_ratio', {
    editSessionId,
    ratio: '9:16',
    fit: 'cover',
  });
  assert.notEqual(reframed.isError, true);
  const reviewed = structured(await callEditor('review_edit_session', {
    editSessionId,
    summary: 'Trim the video to four seconds, add a short fade, and reframe it vertically.',
  }));
  assert.equal(reviewed.status, 'applied');
  const terminal = structured(await callEditor('get_edit_session', { editSessionId }));
  assert.equal(terminal.status, 'applied');

  const resultDoc = live.getDoc();
  const main = resultDoc.timelines[0]!.items.find((item) => item.id === clipId);
  assert.equal(main?.durationInFrames, 120);
  assert.equal(main?.fadeOutFrames, 8);
  assert.equal(resultDoc.timelines[0]!.width, 1080);
  assert.equal(resultDoc.timelines[0]!.height, 1920);
  assert.equal(resultDoc.timelines[0]!.fit, 'cover');
  const history: History = { past: [], present: baseDoc, future: [] };
  const committed = historyReduce(history, { type: 'tl.setDoc', doc: resultDoc });
  assert.equal(committed.past.length, 1);
  assert.equal(
    acceptanceDocumentHash(historyReduce(committed, { type: 'undo' }).present),
    acceptanceDocumentHash(baseDoc),
  );
  assert(media.bytes > 0);
  console.log([
    'mcp-video-edit.verify: real MCP client edited a generated MP4',
    `${TOOL_SCHEMAS.length}/${TOOL_SCHEMAS.length} canonical tools`,
    'status=applied',
    `sha256=${media.sha256}`,
  ].join(' | '));
} finally {
  await closeClient(client);
  await resetMcpSessionsForTest();
  resetExternalAgentBrokerForTest();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 10 });
}
