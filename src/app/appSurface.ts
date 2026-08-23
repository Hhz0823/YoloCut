export type AppSurface = 'main' | 'agent' | 'transcript';

/**
 * Pick exactly one renderer surface before loading its React graph. Transcript
 * keeps precedence for compatibility with the previous nested ternary.
 */
export function resolveAppSurface(search: string): AppSurface {
  const params = new URLSearchParams(search);
  if (params.has('transcript-window')) return 'transcript';
  if (params.has('agent-window')) return 'agent';
  return 'main';
}
