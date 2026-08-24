import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Agent } from 'undici';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIRECT_LOOPBACK = new Agent();

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function requiredProjectName() {
  const value = argument('--project-name')?.trim();
  if (!value) throw new Error('--project-name is required so the verifier never selects an arbitrary open project');
  return value;
}

function endpoint() {
  const raw = argument('--url') ?? process.env.YOLOCUT_MCP_URL
    ?? 'http://127.0.0.1:5199/api/external-mcp/mcp';
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('YoloCut live MCP verification is restricted to a loopback HTTP endpoint');
  }
  return parsed;
}

async function token() {
  const configured = process.env.YOLOCUT_MCP_TOKEN?.trim();
  if (configured) {
    if (!TOKEN_PATTERN.test(configured)) throw new Error('YOLOCUT_MCP_TOKEN has an invalid shape');
    return configured;
  }
  for (const directory of ['.yolocut', '.chatcut', '.openchatcut']) {
    const candidate = await readFile(join(homedir(), directory, 'mcp-token'), 'utf8')
      .then((value) => value.trim())
      .catch(() => '');
    if (TOKEN_PATTERN.test(candidate)) return candidate;
  }
  throw new Error('No persisted YoloCut MCP token was found; open Agent Connection Center (MCP)');
}

function structured(result, toolName) {
  if (result.isError === true) {
    const message = result.content?.find((entry) => entry.type === 'text')?.text ?? 'unknown error';
    throw new Error(`${toolName} failed: ${message}`);
  }
  if (!result.structuredContent || typeof result.structuredContent !== 'object'
    || Array.isArray(result.structuredContent)) {
    throw new Error(`${toolName} returned no structured content`);
  }
  return result.structuredContent;
}

function projectEntries(value) {
  for (const key of ['projects', 'result']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function timelineItems(value) {
  if (Array.isArray(value.items)) return value.items;
  if (value.timeline && typeof value.timeline === 'object' && Array.isArray(value.timeline.items)) {
    return value.timeline.items;
  }
  return [];
}

const projectName = requiredProjectName();
const client = new Client({ name: 'yolocut-live-verifier', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(endpoint(), {
  fetch: (input, init) => globalThis.fetch(input, { ...init, dispatcher: DIRECT_LOOPBACK }),
  requestInit: { headers: { Authorization: `Bearer ${await token()}` } },
});
let ownedSessionId = null;

async function call(name, args = {}) {
  return structured(await client.callTool({ name, arguments: args }), name);
}

async function discardOwnedSession() {
  if (!ownedSessionId) return null;
  const id = ownedSessionId;
  ownedSessionId = null;
  return await call('discard_edit_session', { editSessionId: id });
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const status = await call('yolocut_status');
  const manifest = await call('get_connection_manifest');
  const readiness = manifest.readiness;
  const coverage = manifest.capabilityCoverage;
  if (readiness?.fullEditing !== 'ready' || coverage?.complete !== true) {
    throw new Error(`Full editing is unavailable: ${JSON.stringify({ readiness, coverage })}`);
  }
  const connectedProjectIds = manifest.editors?.connectedProjectIds;
  if (!Array.isArray(connectedProjectIds) || connectedProjectIds.length !== 1
    || typeof connectedProjectIds[0] !== 'string') {
    throw new Error(`Expected exactly one connected editor project; found ${connectedProjectIds?.length ?? 0}`);
  }
  const projectId = connectedProjectIds[0];
  const listed = await call('list_projects');
  const selected = projectEntries(listed).find((entry) => entry?.id === projectId);
  if (!selected || selected.name !== projectName) {
    throw new Error(`Connected project is ${JSON.stringify(selected?.name ?? null)}, not ${JSON.stringify(projectName)}`);
  }
  await call('target_project', { projectId });

  const begun = await call('begin_edit_session', {
    approvalMode: 'manual',
    clientName: 'YoloCut live MCP verifier',
  });
  if (begun.resumed === true) {
    throw new Error('The connected project already has a resumable edit session; refusing to alter or discard it');
  }
  if (typeof begun.editSessionId !== 'string') throw new Error('begin_edit_session returned no editSessionId');
  ownedSessionId = begun.editSessionId;
  const project = await call('read_project', { editSessionId: ownedSessionId, view: 'timeline' });
  const before = await call('read_timeline', { editSessionId: ownedSessionId });
  const candidate = timelineItems(before).find((item) => typeof item?.id === 'string'
    && Number.isInteger(item.durationInFrames) && item.durationInFrames > 1);
  if (!candidate) throw new Error('The connected smoke project has no editable timeline item');
  const originalDuration = candidate.durationInFrames;
  const draftDuration = originalDuration - 1;
  await call('set_item_timing', {
    editSessionId: ownedSessionId,
    itemId: candidate.id,
    durationInFrames: draftDuration,
  });
  const draft = await call('read_timeline', { editSessionId: ownedSessionId });
  const draftItem = timelineItems(draft).find((item) => item?.id === candidate.id);
  if (draftItem?.durationInFrames !== draftDuration) throw new Error('Draft timing edit was not visible on readback');
  const discarded = await discardOwnedSession();
  if (discarded?.status !== 'cancelled') throw new Error(`Discard returned status ${String(discarded?.status)}`);

  const verifyBegin = await call('begin_edit_session', {
    approvalMode: 'manual',
    clientName: 'YoloCut live MCP readback verifier',
  });
  if (verifyBegin.resumed === true || typeof verifyBegin.editSessionId !== 'string') {
    throw new Error('Could not create a clean readback session after discard');
  }
  ownedSessionId = verifyBegin.editSessionId;
  const liveReadback = await call('read_timeline', { editSessionId: ownedSessionId });
  const liveItem = timelineItems(liveReadback).find((item) => item?.id === candidate.id);
  if (liveItem?.durationInFrames !== originalDuration) {
    throw new Error(`Discard changed the live item duration (${originalDuration} -> ${String(liveItem?.durationInFrames)})`);
  }
  await discardOwnedSession();

  console.log(JSON.stringify({
    server: status.server ?? manifest.server,
    protocolVersion: manifest.protocolVersion ?? null,
    tools: tools.tools.length,
    canonicalTools: coverage.canonicalToolCount,
    fullEditing: readiness.fullEditing,
    project: selected.name,
    projectItemCount: timelineItems(project.timeline ?? project).length,
    draftItem: candidate.name,
    originalDuration,
    draftDuration,
    discarded: true,
    liveReadbackUnchanged: true,
  }, null, 2));
} finally {
  await discardOwnedSession().catch(() => undefined);
  await transport.terminateSession().catch(() => undefined);
  await client.close().catch(() => undefined);
}
