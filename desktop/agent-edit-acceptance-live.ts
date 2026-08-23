import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { jsonSchema, streamText, tool, type ModelMessage, type ToolSet } from 'ai';
import type { AgentContext } from '../src/agent/context.ts';
import {
  captureExternalToolActions,
  createExternalEditSession,
  externalDraftContext,
  forkExternalEditSession,
  reviewExternalEditSession,
} from '../src/agent/external-edit-session.ts';
import { externalToolSchemas, validateExternalInvocation } from '../src/agent/external-tool-schemas.ts';
import { execCoreDataTool } from '../src/agent/tools/core-data-tools.ts';
import { execEditItemTool } from '../src/agent/tools/edit-item-tools.ts';
import { execReadProjectTool } from '../src/agent/tools/read-project-tools.ts';
import { makeDraft, replayActions } from '../src/editor/store.ts';
import { activeEditorState, type ProjectDoc } from '../src/editor/types.ts';
import { historyReduce, type History } from '../src/editor/reduce.ts';
import { createServerLanguageModel } from '../server/agent-runs/model.ts';
import { ffmpegBin } from '../server/media-binaries.ts';
import { runtimeProfile } from '../server/runtime-profile.ts';
import { CURRENT_PROJECT_VERSION } from '../shared/project-version.ts';
import {
  acceptanceDocumentHash,
  AGENT_EDIT_ACCEPTANCE_ASSET_ID,
  AGENT_EDIT_ACCEPTANCE_CLIP_ID,
  AGENT_EDIT_ACCEPTANCE_MODEL,
  AGENT_EDIT_ACCEPTANCE_PROJECT_ID,
  AGENT_EDIT_ACCEPTANCE_PROJECT_NAME,
  AGENT_EDIT_ACCEPTANCE_SOURCE_FRAMES,
  validateAgentEditTrace,
  type AgentEditToolTrace,
} from './agent-edit-acceptance-contract.ts';

const execFileAsync = promisify(execFile);
const TOOL_NAMES = ['read_project', 'read_timeline', 'edit_item', 'review_edit_session'] as const;
const MAX_MODEL_ROUNDS = 8;

interface PublicZCodeStatus {
  readonly authenticated?: boolean;
  readonly models?: string[];
  readonly port?: number;
  readonly version?: string | null;
}

interface PublicKeyStatus {
  readonly models?: Record<string, string>;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function safeOrigin(value: string | null): string {
  if (!value) throw new Error('--origin is required');
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost')) {
    throw new Error('--origin must be a loopback HTTP origin');
  }
  return parsed.origin;
}

function safeArtifactDirectory(value: string | null): string {
  if (!value) throw new Error('--artifact-dir is required');
  return resolve(value);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function generateFixtureVideo(output: string): Promise<{ bytes: number; sha256: string }> {
  await execFileAsync(ffmpegBin(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
    '-t', '6', '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    output,
  ], { windowsHide: true, maxBuffer: 1024 * 1024 });
  const bytes = (await stat(output)).size;
  const sha256 = await import('node:fs/promises').then(async ({ readFile }) => (
    createHash('sha256').update(await readFile(output)).digest('hex')
  ));
  return { bytes, sha256 };
}

function fixtureDocument(sourceName: string, sourceHash: string, sourceBytes: number): ProjectDoc {
  const src = `/media/uploads/${sourceName}`;
  return {
    version: CURRENT_PROJECT_VERSION,
    assets: [{
      id: AGENT_EDIT_ACCEPTANCE_ASSET_ID,
      name: sourceName,
      sourceFilename: sourceName,
      kind: 'video',
      src,
      durationInFrames: AGENT_EDIT_ACCEPTANCE_SOURCE_FRAMES,
      sourceRevision: `sha256:${sourceHash}`,
      sourceContentHash: sourceHash,
      sourceSize: sourceBytes,
      width: 640,
      height: 360,
    }],
    mediaFolders: [],
    activeTimelineId: 'timeline_acceptance',
    timelines: [{
      id: 'timeline_acceptance',
      name: 'Acceptance Timeline',
      order: 0,
      fps: 30,
      width: 640,
      height: 360,
      selectedId: null,
      trackOrder: ['track_v2', 'track_v1', 'track_a1'],
      tracks: {
        track_v2: { kind: 'video', name: 'Titles' },
        track_v1: { kind: 'video', name: 'Main Video' },
        track_a1: { kind: 'audio', name: 'Audio' },
      },
      items: [{
        id: AGENT_EDIT_ACCEPTANCE_CLIP_ID,
        name: sourceName,
        kind: 'video',
        track: 'track_v1',
        startFrame: 0,
        durationInFrames: AGENT_EDIT_ACCEPTANCE_SOURCE_FRAMES,
        srcInFrame: 0,
        src,
        sourceAssetId: AGENT_EDIT_ACCEPTANCE_ASSET_ID,
        sourceRevision: `sha256:${sourceHash}`,
        sourceContentHash: sourceHash,
        sourceFilename: sourceName,
        volume: 1,
      }],
    }],
  };
}

function hasError(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && ('error' in value || ('outcome' in value && value.outcome !== 'applied')));
}

async function fetchZCodeStatus(origin: string): Promise<{
  status: PublicZCodeStatus;
  settings: PublicKeyStatus;
}> {
  const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  const response = await fetch(`${origin}/api/zcode/status`, {
    headers,
    cache: 'no-store',
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('application/json')) {
    throw new Error(`source /api/zcode/status is unavailable (HTTP ${response.status}, ${contentType || 'no content-type'})`);
  }
  const status = await response.json() as PublicZCodeStatus;
  if (!status.authenticated || !status.models?.includes(AGENT_EDIT_ACCEPTANCE_MODEL)) {
    throw new Error(`ZCode is not authenticated with ${AGENT_EDIT_ACCEPTANCE_MODEL}`);
  }
  const keysResponse = await fetch(`${origin}/api/keys`, { headers, cache: 'no-store' });
  if (!keysResponse.ok) throw new Error(`source /api/keys is unavailable (HTTP ${keysResponse.status})`);
  const settings = await keysResponse.json() as PublicKeyStatus;
  if (settings.models?.LLM_ZCODE_MODEL !== AGENT_EDIT_ACCEPTANCE_MODEL) {
    throw new Error(`source profile selected ${settings.models?.LLM_ZCODE_MODEL ?? 'no model'}`);
  }
  return { status, settings };
}

async function runAcceptance(origin: string, artifactDir: string): Promise<unknown> {
  await mkdir(artifactDir, { recursive: true });
  const profile = runtimeProfile();
  if (profile.mode !== 'isolated-dev') throw new Error('acceptance harness requires an isolated dev profile');
  await mkdir(profile.mediaDir, { recursive: true });
  const sourceName = 'agent-acceptance-fixture.mp4';
  const sourcePath = join(profile.mediaDir, sourceName);
  const fixture = await generateFixtureVideo(sourcePath);
  const baseDoc = fixtureDocument(sourceName, fixture.sha256, fixture.bytes);
  const live = makeDraft(baseDoc);
  const liveContext: AgentContext = {
    commands: live.commands,
    getState: () => activeEditorState(baseDoc),
    getDoc: () => baseDoc,
    getCreativeMode: () => null,
    templates: [],
    audio: [],
    getProjectId: () => AGENT_EDIT_ACCEPTANCE_PROJECT_ID,
    getOfflineMediaSrcs: () => new Set(),
  };
  let session = createExternalEditSession(baseDoc, 'Gemini Acceptance', 'manual');
  const schemas = externalToolSchemas().filter((schema) => TOOL_NAMES.includes(schema.name as typeof TOOL_NAMES[number]));
  const trace: AgentEditToolTrace[] = [];
  const assistantText: string[] = [];
  let round = 0;
  let executionTail = Promise.resolve();

  const execute = async (name: string, rawArgs: Record<string, unknown>): Promise<unknown> => {
    if (rawArgs.editSessionId !== session.id) return { error: 'editSessionId does not match the manual fixture session' };
    const args = validateExternalInvocation(name, rawArgs);
    if (name === 'read_project') {
      return execReadProjectTool(name, args, externalDraftContext(session, liveContext));
    }
    if (name === 'read_timeline') {
      return execCoreDataTool(name, args, externalDraftContext(session, liveContext));
    }
    if (name === 'edit_item') {
      const isolated = forkExternalEditSession(session);
      const result = await execEditItemTool(name, args, externalDraftContext(isolated, liveContext));
      if (!hasError(result)) session = captureExternalToolActions(isolated, name, args);
      return result;
    }
    if (name === 'review_edit_session') {
      session = reviewExternalEditSession(session, args.summary);
      return {
        editSessionId: session.id,
        approvalMode: session.approvalMode,
        status: session.status,
        operationCount: session.operationCount,
        proposalId: session.proposal?.id ?? null,
        applied: false,
      };
    }
    return { error: `unsupported acceptance tool ${name}` };
  };

  const tools = Object.fromEntries(schemas.map((schema) => [schema.name, tool({
    description: schema.description,
    inputSchema: jsonSchema<Record<string, unknown>>(
      schema.input_schema as Parameters<typeof jsonSchema<Record<string, unknown>>>[0],
    ),
    execute: (args: Record<string, unknown>) => {
      const invocationRound = round;
      const invocation = executionTail.then(async () => {
        let result: unknown;
        let isError = false;
        try {
          result = await execute(schema.name, args ?? {});
          isError = hasError(result);
        } catch (error) {
          isError = true;
          result = { error: error instanceof Error ? error.message : String(error) };
        }
        trace.push({ round: invocationRound, name: schema.name, args: args ?? {}, result, ...(isError ? { isError: true } : {}) });
        return result;
      });
      executionTail = invocation.then(() => undefined, () => undefined);
      return invocation;
    },
  })])) as ToolSet;

  const status = await fetchZCodeStatus(origin);
  const model = createServerLanguageModel('zcode', AGENT_EDIT_ACCEPTANCE_MODEL, 'chat', origin);
  let messages: ModelMessage[] = [{
    role: 'user',
    content: [
      'Run the deterministic safe editing acceptance on the dedicated fixture project.',
      `The manual editSessionId is ${session.id}.`,
      'First inspect the media assets with read_project(view="assets"), then inspect the timeline with read_timeline.',
      'After inspection, make one meaningful edit_item call that trims the six-second main video to about four seconds, lowers its volume, and adds a short title on V2 for the opening two seconds.',
      'Use ids and fps returned by the tools. Do not invent assets. Do not export or touch any other project.',
      'Finish by calling review_edit_session with a concise summary. This is manual mode: never claim the proposal was applied.',
    ].join(' '),
  }];
  const instructions = [
    'You are the YoloCut acceptance editor. Tool calls, not prose, are the acceptance result.',
    'Use only the provided tools and execute them in the requested order.',
    'A successful edit requires at least two distinct categories among trim/split, title/caption, and volume/transition.',
    'The live project must remain unchanged until a human approves the complete manual proposal.',
    'Once review_edit_session reports awaiting_review, stop and state that human approval is still required.',
  ].join('\n');

  for (round = 1; round <= MAX_MODEL_ROUNDS && session.status === 'drafting'; round += 1) {
    const result = streamText({
      model,
      instructions,
      messages,
      tools,
      maxOutputTokens: 4_096,
      maxRetries: 0,
    });
    const text = await result.text;
    const [toolCalls, responseMessages] = await Promise.all([result.toolCalls, result.responseMessages]);
    if (text.trim()) assistantText.push(text.trim());
    messages = [...messages, ...responseMessages];
    if (!toolCalls.length && session.status === 'drafting') {
      throw new Error('gemini-3.7-flash returned text without completing the required tool workflow');
    }
  }
  await executionTail;
  if (session.status !== 'awaiting_review' || !session.proposal) {
    throw new Error(`manual proposal was not created (status=${session.status})`);
  }
  const traceSummary = validateAgentEditTrace(trace);
  const baseHash = acceptanceDocumentHash(baseDoc);
  const actions = session.proposal.options[0].operations.flatMap((operation) => operation.actions);
  const resultDoc = replayActions(baseDoc, actions);
  const initialHistory: History = { past: [], present: baseDoc, future: [] };
  const appliedContract = historyReduce(initialHistory, { type: 'tl.setDoc', doc: resultDoc });
  const undoneContract = historyReduce(appliedContract, { type: 'undo' });
  if (appliedContract.past.length !== 1 || acceptanceDocumentHash(undoneContract.present) !== baseHash) {
    throw new Error('proposal did not satisfy the one-action apply/undo contract');
  }
  if (acceptanceDocumentHash(live.getDoc()) !== baseHash) {
    throw new Error('manual proposal mutated the live fixture before approval');
  }

  const artifact = {
    version: 1,
    generatedAt: new Date().toISOString(),
    profile: { mode: profile.mode, id: profile.id, rootDir: profile.rootDir },
    source: { origin, endpoint: '/api/zcode/status' },
    model: {
      provider: 'zcode',
      id: AGENT_EDIT_ACCEPTANCE_MODEL,
      authenticated: status.status.authenticated === true,
      advertisedModelCount: status.status.models?.length ?? 0,
      zcodeVersion: status.status.version ?? null,
      zcodePort: status.status.port ?? null,
    },
    fixture: {
      projectId: AGENT_EDIT_ACCEPTANCE_PROJECT_ID,
      projectName: AGENT_EDIT_ACCEPTANCE_PROJECT_NAME,
      assetId: AGENT_EDIT_ACCEPTANCE_ASSET_ID,
      clipId: AGENT_EDIT_ACCEPTANCE_CLIP_ID,
      sourceName: basename(sourcePath),
      sourcePath,
      durationFrames: AGENT_EDIT_ACCEPTANCE_SOURCE_FRAMES,
      fps: 30,
      bytes: fixture.bytes,
      sha256: fixture.sha256,
      baselineDocumentHash: baseHash,
    },
    toolProof: { ...traceSummary, trace },
    assistantText,
    proposal: {
      id: session.proposal.id,
      approvalMode: session.approvalMode,
      status: session.status,
      applied: false,
      operationCount: session.operationCount,
      summary: session.proposal.summary,
      totalImpact: session.proposal.totalImpact,
      resultDocumentHash: acceptanceDocumentHash(resultDoc),
      liveDocumentHash: acceptanceDocumentHash(live.getDoc()),
    },
    applyUndoContract: {
      verified: true,
      runtimeApplied: false,
      historyDepthAfterHypotheticalApproval: appliedContract.past.length,
      undoRestoresBaseline: acceptanceDocumentHash(undoneContract.present) === baseHash,
      note: 'Reducer contract verified without marking the manual session applied; YoloCut human approval remains required.',
    },
    export: {
      status: 'not_run',
      reason: 'Real browser proposal approval and rendered export are an explicit remaining runtime gate.',
    },
  };
  await writeJsonAtomic(join(artifactDir, 'acceptance.json'), artifact);
  return artifact;
}

const origin = safeOrigin(argument('--origin'));
const artifactDir = safeArtifactDirectory(argument('--artifact-dir'));
try {
  const artifact = await runAcceptance(origin, artifactDir) as {
    proposal?: { status?: string; applied?: boolean };
    toolProof?: { toolNames?: string[]; categories?: string[] };
  };
  process.stdout.write(`AGENT_EDIT_ACCEPTANCE_PROPOSAL=${artifact.proposal?.status}\n`);
  process.stdout.write(`AGENT_EDIT_ACCEPTANCE_APPLIED=${String(artifact.proposal?.applied === true)}\n`);
  process.stdout.write(`AGENT_EDIT_ACCEPTANCE_TOOLS=${artifact.toolProof?.toolNames?.join(',') ?? ''}\n`);
  process.stdout.write(`AGENT_EDIT_ACCEPTANCE_CATEGORIES=${artifact.toolProof?.categories?.join(',') ?? ''}\n`);
  process.stdout.write(`AGENT_EDIT_ACCEPTANCE_ARTIFACT=${join(artifactDir, 'acceptance.json')}\n`);
} catch (error) {
  await mkdir(artifactDir, { recursive: true });
  await writeJsonAtomic(join(artifactDir, 'failure.json'), {
    version: 1,
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
