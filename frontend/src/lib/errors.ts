/**
 * Pulls a human-readable message out of an axios error.
 *
 * Nest's ValidationPipe returns `message` as a string[] of field errors; most
 * other exceptions return a single string. Network failures have no response at
 * all, which is worth distinguishing from a server-side rejection.
 */
export function extractApiError(err: unknown, fallback: string): string {
  const e = err as {
    response?: { data?: { message?: string | string[] }; status?: number };
    code?: string;
    message?: string;
  };

  if (!e?.response) {
    if (e?.code === 'ECONNABORTED') return 'Request timed out — try again';
    return 'Cannot reach the server. Is the backend running?';
  }

  const msg = e.response.data?.message;
  if (Array.isArray(msg) && msg.length > 0) return msg.join('; ');
  if (typeof msg === 'string' && msg) return msg;

  if (e.response.status === 403) return 'You do not have permission to do that';
  if (e.response.status === 404) return 'Not found';

  return fallback;
}
