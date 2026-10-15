import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiArgs, ApiMethod, ApiResult, BridgeApi } from '@shared/api';
import type { AppEvent, ErrorCode, TaskProgress } from '@shared/types';
import { useApp, type Route } from '../store';

declare global {
  interface Window {
    sw: BridgeApi;
  }
}

export class ApiErr extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export async function call<M extends ApiMethod>(method: M, ...args: ApiArgs<M> extends void ? [] : [ApiArgs<M>]): Promise<ApiResult<M>> {
  const res = await window.sw.call(method, args[0] as ApiArgs<M>);
  if (!res.ok) throw new ApiErr(res.error.code, res.error.message);
  return res.data;
}

// ---- single event subscription fanned out to listeners ----
type Listener = (e: AppEvent) => void;
const listeners = new Set<Listener>();
let subscribed = false;
function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  window.sw.onEvent((e) => listeners.forEach((l) => l(e)));
}
export function onAppEvent(l: Listener): () => void {
  ensureSubscribed();
  listeners.add(l);
  return () => listeners.delete(l);
}

export const newTaskId = () => crypto.randomUUID().replace(/-/g, '');

type TaskArgs<M extends ApiMethod> = Omit<ApiArgs<M>, 'taskId'>;

export interface TaskState<M extends ApiMethod> {
  running: boolean;
  progress: TaskProgress | null;
  result: ApiResult<M> | null;
  error: ApiErr | null;
  taskId: string | null;
  run: (args: TaskArgs<M>) => Promise<ApiResult<M> | null>;
  cancel: () => void;
  signal: (name: 'continue') => void;
  reset: () => void;
}

/**
 * Runs a long main-process task with live progress. Cancelling resolves to null instead of throwing;
 * other errors are stored in `error` and re-thrown to the caller.
 */
export function useTask<M extends ApiMethod>(method: M, route?: Route): TaskState<M> {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [result, setResult] = useState<ApiResult<M> | null>(null);
  const [error, setError] = useState<ApiErr | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const off = onAppEvent((e) => {
      if (e.kind === 'progress' && e.progress.taskId === idRef.current) {
        setProgress(e.progress);
        if (route) {
          const p = e.progress;
          const pct = p.totalBytes ? ((p.bytes ?? 0) / p.totalBytes) * 100 : p.total ? ((p.done ?? 0) / p.total) * 100 : null;
          useApp.getState().setBusy(route, pct === null ? null : Math.min(100, pct));
        }
      }
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, []);

  const run = useCallback(
    async (args: TaskArgs<M>) => {
      const id = newTaskId();
      idRef.current = id;
      setTaskId(id);
      setRunning(true);
      setProgress(null);
      setError(null);
      if (route) useApp.getState().setBusy(route, null);
      try {
        const r = await call(method, ...([{ ...args, taskId: id }] as unknown as ApiArgs<M> extends void ? [] : [ApiArgs<M>]));
        if (mounted.current && idRef.current === id) setResult(r);
        return r;
      } catch (err) {
        const e = err instanceof ApiErr ? err : new ApiErr('INTERNAL', String(err));
        if (e.code === 'CANCELLED') return null;
        if (mounted.current) setError(e);
        throw e;
      } finally {
        if (route && idRef.current === id) {
          useApp.getState().setBusy(route, undefined);
          void useApp.getState().refreshFreed();
        }
        if (mounted.current && idRef.current === id) {
          setRunning(false);
          idRef.current = null;
        }
      }
    },
    [method, route],
  );

  const cancel = useCallback(() => {
    if (idRef.current) void call('task.cancel', { taskId: idRef.current }).catch(() => undefined);
  }, []);

  const signal = useCallback((name: 'continue') => {
    if (idRef.current) void call('task.signal', { taskId: idRef.current, signal: name }).catch(() => undefined);
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setProgress(null);
    setError(null);
  }, []);

  return { running, progress, result, error, taskId, run, cancel, signal, reset };
}
