export type OwnerAuthStatus = {mode: 'sites' | 'access' | 'native'; canSetup?: boolean; configured?: boolean; authenticated?: boolean};

export async function ownerRequest(data?: Record<string, unknown>, signal?: AbortSignal) {
  let response: Response;
  try { response = await fetch('/api/owner-auth', {
    method: data ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    ...(data ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)} : {}),
  }); } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error('The connection could not be completed. Please try again.');
  }
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new Error('Sign-in could not be checked. Please try again.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Sign-in could not be checked. Please try again.');
  const record = result as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof record.error === 'string' ? record.error : 'Sign-in failed. Please try again.');
  return record;
}

export async function readOwnerStatus(signal?: AbortSignal): Promise<OwnerAuthStatus> {
  const result = await ownerRequest(undefined, signal);
  if (typeof result.mode !== 'string' || !['sites', 'access', 'native'].includes(result.mode)
    || (result.mode === 'native' && (typeof result.configured !== 'boolean' || typeof result.authenticated !== 'boolean'))) {
    throw new Error('Sign-in settings could not be checked. Please try again.');
  }
  return result as OwnerAuthStatus;
}
