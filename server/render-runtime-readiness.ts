type RenderRuntimeReadinessProvider = () => Promise<void>;

const registry = globalThis as typeof globalThis & {
  __yolocutRenderRuntimeReadinessV1?: RenderRuntimeReadinessProvider;
};

/**
 * Desktop injects the packaged render-resource preparation here without making
 * the server layer depend on Electron. Development and browser-only runtimes
 * keep the default no-op provider.
 */
export function setRenderRuntimeReadinessProvider(
  provider: RenderRuntimeReadinessProvider,
): void {
  registry.__yolocutRenderRuntimeReadinessV1 = provider;
}

/** Ensure writable Remotion resources exist before the renderer is imported. */
export function ensureRenderRuntimeReady(): Promise<void> {
  return (registry.__yolocutRenderRuntimeReadinessV1 ?? (async () => undefined))();
}
