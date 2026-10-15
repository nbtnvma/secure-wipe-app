import type { AppEvent, TaskProgress } from '@shared/types';
import { AppError } from '../infra/errors';

type Emitter = (event: AppEvent) => void;
let emit: Emitter = () => undefined;

export function setEventEmitter(fn: Emitter): void {
  emit = fn;
}

export function emitEvent(event: AppEvent): void {
  emit(event);
}

const PROGRESS_INTERVAL_MS = 120;

export class TaskContext {
  readonly controller = new AbortController();
  private last = 0;
  private pending: Partial<TaskProgress> | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private signalWaiters = new Map<string, () => void>();
  private state: Partial<TaskProgress> = {};

  constructor(readonly id: string) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new AppError('CANCELLED');
  }

  /** Merges progress fields and emits at most every PROGRESS_INTERVAL_MS. */
  progress(p: Partial<TaskProgress>, force = false): void {
    this.state = { ...this.state, ...p };
    this.pending = this.state;
    const now = Date.now();
    if (force || now - this.last >= PROGRESS_INTERVAL_MS) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), PROGRESS_INTERVAL_MS);
    }
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.pending) return;
    this.last = Date.now();
    emit({ kind: 'progress', progress: { ...this.pending, taskId: this.id } });
    this.pending = null;
  }

  /** Resolves when the renderer sends task.signal with this name (or when cancelled). */
  waitForSignal(name: string): Promise<'signal' | 'cancelled'> {
    return new Promise((resolve) => {
      if (this.cancelled) return resolve('cancelled');
      const onAbort = () => resolve('cancelled');
      this.signal.addEventListener('abort', onAbort, { once: true });
      this.signalWaiters.set(name, () => {
        this.signal.removeEventListener('abort', onAbort);
        resolve('signal');
      });
    });
  }

  deliverSignal(name: string): void {
    const waiter = this.signalWaiters.get(name);
    if (waiter) {
      this.signalWaiters.delete(name);
      waiter();
    }
  }

  dispose(): void {
    this.flush();
  }
}

const tasks = new Map<string, TaskContext>();

export async function runTask<R>(taskId: string, fn: (ctx: TaskContext) => Promise<R>): Promise<R> {
  if (tasks.has(taskId)) throw new AppError('INVALID_INPUT', 'Task id already in use');
  const ctx = new TaskContext(taskId);
  tasks.set(taskId, ctx);
  try {
    return await fn(ctx);
  } finally {
    ctx.dispose();
    tasks.delete(taskId);
    if (tasks.size === 0) idleListeners.forEach((l) => l());
  }
}

export function cancelTask(taskId: string): void {
  tasks.get(taskId)?.controller.abort();
}

export function signalTask(taskId: string, name: string): void {
  tasks.get(taskId)?.deliverSignal(name);
}

/** Speed/ETA helper for byte-oriented operations. */
export class RateMeter {
  private start = Date.now();
  rate(done: number): { speed: number; etaSec?: number } & { elapsed: number } {
    const elapsed = (Date.now() - this.start) / 1000;
    return { speed: elapsed > 0.5 ? done / elapsed : 0, elapsed };
  }
  eta(done: number, total: number): number | undefined {
    const { speed } = this.rate(done);
    if (!speed || total <= done) return undefined;
    return Math.round((total - done) / speed);
  }
}

const idleListeners = new Set<() => void>();

export const activeTaskCount = () => tasks.size;

/** Called whenever the last running task finishes. */
export function onTasksIdle(fn: () => void): () => void {
  idleListeners.add(fn);
  return () => idleListeners.delete(fn);
}
