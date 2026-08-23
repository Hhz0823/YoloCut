export interface PreviewProxySchedulerStats {
  readonly queued: number;
  readonly running: number;
  readonly concurrency: number;
}

interface PreviewProxyJob {
  readonly key: string;
  priority: number;
  readonly sequence: number;
  run: () => Promise<void>;
}

/**
 * Small priority scheduler for heavyweight preview-proxy requests.
 *
 * The server also serializes FFmpeg work, but limiting requests in the client
 * prevents a long project from filling that server queue before the current
 * timeline has had a chance to request its first proxy.
 */
export class PreviewProxyScheduler {
  readonly #concurrency: number;
  readonly #queued = new Map<string, PreviewProxyJob>();
  readonly #running = new Set<string>();
  #sequence = 0;
  #pumpScheduled = false;

  constructor(concurrency = 1) {
    this.#concurrency = Math.max(1, Math.floor(concurrency));
  }

  enqueue(key: string, priority: number, run: () => Promise<void>): boolean {
    if (this.#running.has(key)) return false;
    const existing = this.#queued.get(key);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      existing.run = run;
      this.#schedulePump();
      return false;
    }
    this.#queued.set(key, {
      key,
      priority: Number.isFinite(priority) ? priority : Number.MAX_SAFE_INTEGER,
      sequence: this.#sequence++,
      run,
    });
    this.#schedulePump();
    return true;
  }

  /** Cancel queued work. Running FFmpeg requests are left to their owner. */
  cancel(key: string): boolean {
    return this.#queued.delete(key);
  }

  isQueued(key: string): boolean {
    return this.#queued.has(key);
  }

  clear(): void {
    this.#queued.clear();
  }

  stats(): PreviewProxySchedulerStats {
    return {
      queued: this.#queued.size,
      running: this.#running.size,
      concurrency: this.#concurrency,
    };
  }

  #schedulePump(): void {
    if (this.#pumpScheduled) return;
    this.#pumpScheduled = true;
    // Batch all sources registered by one React effect before choosing the
    // first job, so active-timeline priorities win over insertion timing.
    void Promise.resolve().then(() => {
      this.#pumpScheduled = false;
      this.#pump();
    });
  }

  #pump(): void {
    while (this.#running.size < this.#concurrency && this.#queued.size) {
      const next = [...this.#queued.values()].sort((left, right) => (
        left.priority - right.priority || left.sequence - right.sequence
      ))[0]!;
      this.#queued.delete(next.key);
      this.#running.add(next.key);
      void Promise.resolve()
        .then(next.run)
        .catch(() => undefined)
        .finally(() => {
          this.#running.delete(next.key);
          this.#schedulePump();
        });
    }
  }
}
