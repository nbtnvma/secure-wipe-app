import { AppError } from '../infra/errors';
import { newId } from '../infra/ids';

/**
 * Scan results live here, in the main process. The renderer only ever receives item ids and sends
 * those back, so a compromised renderer cannot make the app delete an arbitrary path.
 */
export interface Session<T> {
  id: string;
  kind: string;
  createdAt: number;
  items: Map<string, T>;
  meta: Record<string, unknown>;
}

const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 40;
const sessions = new Map<string, Session<unknown>>();

function evict(): void {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.createdAt > TTL_MS) sessions.delete(id);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value as string;
    sessions.delete(oldest);
  }
}

export function createSession<T>(kind: string, items: Iterable<[string, T]> = [], meta: Record<string, unknown> = {}): Session<T> {
  evict();
  const session: Session<T> = { id: newId(), kind, createdAt: Date.now(), items: new Map(items), meta };
  sessions.set(session.id, session as Session<unknown>);
  return session;
}

export function getSession<T>(id: string, kind: string | string[]): Session<T> {
  const s = sessions.get(id);
  const kinds = Array.isArray(kind) ? kind : [kind];
  if (!s || !kinds.includes(s.kind)) throw new AppError('SESSION_EXPIRED', 'Scan results expired, please scan again');
  return s as Session<T>;
}

export function getItems<T>(session: Session<T>, ids: string[]): T[] {
  const out: T[] = [];
  for (const id of ids) {
    const item = session.items.get(id);
    if (item === undefined) throw new AppError('INVALID_INPUT', `Unknown item ${id}`);
    out.push(item);
  }
  return out;
}

export function dropSession(id: string): void {
  sessions.delete(id);
}

/** Any session item exposing a filesystem path can be revealed / trashed generically. */
export interface PathLike {
  path: string;
  bytes?: number;
}
