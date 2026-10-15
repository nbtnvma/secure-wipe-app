import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import { IPC_CALL, type ApiArgs, type ApiMethod, type ApiResult } from '@shared/api';
import type { ApiResponse } from '@shared/types';
import { AppError, toApiError } from '../infra/errors';
import { log } from '../infra/logger';
import { serviceBlocked } from '../services/serviceStatus';
import { runTask, type TaskContext } from '../tasks/taskManager';

type Handler = (args: unknown, event: IpcMainInvokeEvent) => Promise<unknown>;
const handlers = new Map<string, Handler>();

/** Methods that keep working while the service is locked: read-only info and restoring the user's own files. */
const ALLOWED_WHEN_LOCKED = new Set<string>([
  'app.info',
  'app.beep',
  'app.openExternal',
  'settings.get',
  'settings.set',
  'service.status',
  'service.retry',
  'task.cancel',
  'task.signal',
  'history.list',
  'quarantine.list',
  'quarantine.restore',
]);

let trustedOrigin: (url: string) => boolean = () => false;
export function setTrustedOrigin(fn: (url: string) => boolean): void {
  trustedOrigin = fn;
}

/** Register a request/response handler with input validation. */
export function handle<M extends ApiMethod>(
  method: M,
  schema: z.ZodType | null,
  fn: (args: ApiArgs<M>, event: IpcMainInvokeEvent) => Promise<ApiResult<M>> | ApiResult<M>,
): void {
  handlers.set(method, async (raw, event) => {
    let args = raw;
    if (schema) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new AppError('INVALID_INPUT', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      args = parsed.data;
    }
    return fn(args as ApiArgs<M>, event);
  });
}

/** Register a long-running handler; args must contain taskId (progress events + cancellation). */
export function handleTask<M extends ApiMethod>(
  method: M,
  schema: z.ZodType,
  fn: (args: ApiArgs<M>, ctx: TaskContext) => Promise<ApiResult<M>>,
): void {
  handle(method, schema, (args) => runTask((args as { taskId: string }).taskId, (ctx) => fn(args, ctx)));
}

export function registerIpc(): void {
  ipcMain.handle(IPC_CALL, async (event, method: string, args: unknown): Promise<ApiResponse<unknown>> => {
    const url = event.senderFrame?.url ?? '';
    if (!trustedOrigin(url)) {
      log.warn(`rejected IPC from untrusted frame: ${url}`);
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Untrusted sender' } };
    }
    if (serviceBlocked() && !ALLOWED_WHEN_LOCKED.has(method)) {
      return { ok: false, error: { code: 'OUT_OF_SERVICE', message: 'Out of Service' } };
    }
    const handler = handlers.get(method);
    if (!handler) return { ok: false, error: { code: 'NOT_FOUND', message: `Unknown method ${method}` } };
    try {
      return { ok: true, data: await handler(args, event) };
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr.code === 'INTERNAL') log.error(`${method} failed`, err);
      return { ok: false, error: apiErr };
    }
  });
}
