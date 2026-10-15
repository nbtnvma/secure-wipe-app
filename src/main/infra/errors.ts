import type { ApiError, ErrorCode } from '@shared/types';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const cancelled = () => new AppError('CANCELLED', 'Operation cancelled');

export function toApiError(err: unknown): ApiError {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
    return { code: 'CANCELLED', message: 'Operation cancelled' };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'INTERNAL', message };
}

export function errMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    const code = (err as { code: string }).code;
    if (code === 'EBUSY') return 'File is in use';
    if (code === 'EPERM' || code === 'EACCES') return 'Access denied';
    if (code === 'ENOENT') return 'Not found';
  }
  return err instanceof Error ? err.message : String(err);
}
