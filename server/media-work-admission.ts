import { availableParallelism, totalmem } from 'node:os';

import { resolveMediaCpuBudget } from './media-process.ts';

export type ReleaseMediaWorkPermit = () => void;

export interface MediaWorkAdmissionLike {
  acquire(signal?: AbortSignal): Promise<ReleaseMediaWorkPermit>;
  snapshot(): { active: number; queued: number; concurrency: number };
}

interface Waiter {
  readonly signal?: AbortSignal;
  readonly resolve: (release: ReleaseMediaWorkPermit) => void;
  readonly reject: (error: Error) => void;
  readonly onAbort: () => void;
}

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('media work cancelled');
  error.name = 'AbortError';
  return error;
}

export function resolveMediaWorkConcurrency(
  cores: number,
  totalMemoryBytes: number,
  override = process.env.YOLOCUT_MEDIA_WORK_CONCURRENCY,
): number {
  const parsed = Number.parseInt(override ?? '', 10);
  if (Number.isFinite(parsed)) return Math.max(1, Math.min(4, parsed));
  return resolveMediaCpuBudget(cores, totalMemoryBytes).backgroundProcessConcurrency;
}

export class MediaWorkAdmission implements MediaWorkAdmissionLike {
  readonly concurrency: number;
  private active = 0;
  private readonly pending: Waiter[] = [];

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, Math.min(4, Math.floor(concurrency) || 1));
  }

  acquire(signal?: AbortSignal): Promise<ReleaseMediaWorkPermit> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.pending.indexOf(waiter);
          if (index >= 0) this.pending.splice(index, 1);
          reject(abortError(signal));
        },
      };
      if (this.active < this.concurrency) this.start(waiter);
      else {
        this.pending.push(waiter);
        signal?.addEventListener('abort', waiter.onAbort, { once: true });
      }
    });
  }

  snapshot() {
    return { active: this.active, queued: this.pending.length, concurrency: this.concurrency };
  }

  private start(waiter: Waiter): void {
    waiter.signal?.removeEventListener('abort', waiter.onAbort);
    if (waiter.signal?.aborted) {
      waiter.reject(abortError(waiter.signal));
      return;
    }
    this.active += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const waiter = this.pending.shift();
      if (!waiter) return;
      this.start(waiter);
    }
  }
}

export const mediaWorkAdmission = new MediaWorkAdmission(resolveMediaWorkConcurrency(
  availableParallelism(),
  totalmem(),
));
