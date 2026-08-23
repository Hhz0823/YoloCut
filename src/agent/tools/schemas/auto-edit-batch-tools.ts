import type { AgentToolSchema } from '../../tool-schema';

export const AUTO_EDIT_BATCH_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'manage_auto_edit_batch',
    description: [
      'Create, inspect and drive a durable batch auto-edit queue containing up to 10,000 jobs.',
      'The UI creates an opaque directory grant; create never accepts arbitrary filesystem paths.',
      'claim materializes one isolated project and returns its exact editing brief. Respect the queue concurrency and lease.',
      'analyze_reference runs the installed Apache-2.0 SmolVLM2 Q8 pack through llama.cpp and extracts structure only; it never copies reference footage.',
      'After editing and export, call complete or fail with the same workerId. Pause/resume/retry are idempotent.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'status', 'claim', 'heartbeat', 'editing', 'rendering', 'complete', 'fail', 'pause', 'resume', 'retry_failed', 'cancel', 'analyze_reference'],
        },
        batchId: { type: 'string', description: 'Batch id returned by create/list.' },
        sourceGrantId: { type: 'string', description: 'Opaque grant id returned by the native Agent-workbench folder picker.' },
        name: { type: 'string' },
        editScript: { type: 'string', maxLength: 200000 },
        narrationScript: { type: 'string', maxLength: 200000 },
        referenceAssetIds: { type: 'array', maxItems: 16, items: { type: 'string' } },
        workerConcurrency: { type: 'integer', minimum: 1, maximum: 4 },
        renderConcurrency: { type: 'integer', minimum: 1, maximum: 2 },
        workerId: { type: 'string', maxLength: 160, description: 'Stable id for the connected worker/Agent.' },
        jobId: { type: 'string' },
        projectId: { type: 'string' },
        sourceAssetId: { type: 'string' },
        outputPath: { type: 'string', maxLength: 4096 },
        error: { type: 'string', maxLength: 4000 },
        assetId: { type: 'string', description: 'Reference video asset id in the currently open owner project.' },
        instruction: { type: 'string', maxLength: 4000 },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      required: ['action'],
    },
  },
];

export const AUTO_EDIT_BATCH_TOOL_NAMES = new Set(AUTO_EDIT_BATCH_TOOL_SCHEMAS.map((schema) => schema.name));
