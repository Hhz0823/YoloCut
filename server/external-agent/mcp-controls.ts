import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  LEGACY_MCP_STATUS_TOOLS,
  MCP_STATUS_TOOL,
  PRODUCT_NAME,
} from '../../shared/product-brand.ts';

const STATUS_TOOL: Tool = {
    name: MCP_STATUS_TOOL,
    description: `Show connected ${PRODUCT_NAME} editors, this transport session binding, and capability status.`,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const LEGACY_STATUS_TOOLS: Tool[] = LEGACY_MCP_STATUS_TOOLS.map((name) => ({
    name,
    description: `Backward-compatible alias for ${MCP_STATUS_TOOL}.`,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}));

export const MCP_CONTROL_TOOLS: Tool[] = [
  STATUS_TOOL,
  ...LEGACY_STATUS_TOOLS,
  {
    name: 'get_connection_manifest',
    description: `Return the machine-readable ${PRODUCT_NAME} connection, full-catalog coverage, discovery, and safe edit workflow contract.`,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_projects',
    description: `List ${PRODUCT_NAME} projects, newest first.`,
    inputSchema: {
      type: 'object',
      properties: {
        includeDeleted: { type: 'boolean' },
        editorBaseUrl: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'create_project',
    description: `Create an empty ${PRODUCT_NAME} project with one active timeline and one video track.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        compositionWidth: { type: 'number' },
        compositionHeight: { type: 'number' },
        fps: { type: 'number' },
        editorBaseUrl: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'target_project',
    description: 'Permanently bind this MCP transport to a live browser editor, or to an existing stored project through the offline fallback.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, editorBaseUrl: { type: 'string' } },
      required: ['projectId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_editor_url',
    description: `Return the ${PRODUCT_NAME} editor URL for this session project or an explicitly named project.`,
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, editorBaseUrl: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

export const MCP_CONTROL_TOOL_NAMES: Record<string, true> = Object.fromEntries(
  MCP_CONTROL_TOOLS.map((tool) => [tool.name, true]),
);
