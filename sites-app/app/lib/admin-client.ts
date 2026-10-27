import type { AdminData } from './types';

class WorkspaceError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function workspaceRequest(path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    let result: unknown;
    try { result = await response.json(); }
    catch { throw new WorkspaceError('The server response could not be read.', response.ok ? null : response.status); }
    if (!response.ok) throw new WorkspaceError(isRecord(result) && typeof result.error === 'string' ? result.error : 'The workspace could not be updated.', response.status);
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function readAdminData(signal?: AbortSignal): Promise<AdminData> {
  const result = await workspaceRequest('/api/admin', undefined, signal);
  if (!isRecord(result) || typeof result.initialized !== 'boolean' || typeof result.identity !== 'string'
    || !isRecord(result.settings) || !['services', 'resources', 'requests', 'blocks', 'departures'].every(key => Array.isArray(result[key]))) {
    throw new Error('Workspace details could not be read. Refresh to try again.');
  }
  return result as AdminData;
}

export async function saveAdminChange(body: Record<string, unknown>, refresh: () => Promise<void>, path = '/api/admin') {
  let saved = false;
  try {
    const result = await workspaceRequest(path, body);
    const receipt = isRecord(result) && (result.ok === true || (body.action === 'createManual' && typeof result.reference === 'string' && typeof result.token === 'string'));
    if (!receipt) throw new WorkspaceError('The save result could not be checked.');
    saved = true;
    await refresh();
    return { saved: true, needsRefresh: false, error: '' };
  } catch (cause) {
    if (saved) return { saved: true, needsRefresh: true, error: 'Your change was saved, but the latest workspace could not be loaded. Refresh before making another change.' };
    if (cause instanceof WorkspaceError && cause.status !== null && cause.status < 500 && cause.status !== 408) {
      return { saved: false, needsRefresh: cause.status === 409, error: cause.message };
    }
    return { saved: false, needsRefresh: true, error: 'We could not check whether this change was saved. Refresh and check the record before trying again, especially payments or refunds.' };
  }
}
