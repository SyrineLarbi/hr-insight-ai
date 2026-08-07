/**
 * Parses FRONTEND_ORIGIN into the list CORS and the WebSocket gateway both need.
 *
 * Accepts a single origin or a comma-separated list, so the frontend can move
 * ports without a code change — which matters here because :3000, :3001, and
 * :4000 are all commonly taken by other things on a dev machine.
 */
export const DEFAULT_FRONTEND_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3002',
];

export function parseFrontendOrigins(raw?: string): string[] {
  if (!raw) return DEFAULT_FRONTEND_ORIGINS;

  const origins = raw
    .split(',')
    .map((o) => o.trim().replace(/\/$/, '')) // a trailing slash never matches
    .filter(Boolean);

  return origins.length > 0 ? origins : DEFAULT_FRONTEND_ORIGINS;
}
