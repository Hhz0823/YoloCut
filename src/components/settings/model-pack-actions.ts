import type { ModelPackId, ModelPackInstallOptions } from '../../../shared/model-packs';

export type ModelPackMutation = (
  id: ModelPackId,
  headers: HeadersInit,
  options?: ModelPackInstallOptions,
) => Promise<unknown>;

export async function executeModelPackMutation(
  id: ModelPackId,
  action: ModelPackMutation,
  options?: ModelPackInstallOptions,
): Promise<unknown> {
  return action(id, {}, options);
}
