import { GameError, type RandomIndex } from '@casual/engine';
export function randomSecret() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
export async function hashSecret(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export const secureRandomIndex: RandomIndex = max => {
  const limit = Math.floor(0x100000000 / max) * max; const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0]! >= limit);
  return buffer[0]! % max;
};
export function originAllowed(request: Request, allowed: string, required = false) {
  const origin = request.headers.get('Origin');
  return origin ? allowed.split(',').map(o => o.trim()).includes(origin) : !required;
}
export async function readRequestBody(request: Request) {
  if (Number(request.headers.get('Content-Length') ?? 0) > 8192) throw new GameError('MESSAGE_TOO_LARGE', 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new GameError('INVALID_REQUEST', 'A JSON body is required.');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 8192) { await reader.cancel(); throw new GameError('MESSAGE_TOO_LARGE', 'Request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function readJson(request: Request) {
  const bytes = await readRequestBody(request);
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new GameError('INVALID_REQUEST', 'Send a valid JSON request.'); }
}
export function errorResponse(error: unknown) {
  const known = error instanceof GameError;
  const code = known ? error.code : 'INTERNAL_ERROR';
  const status = ['SESSION_INVALID', 'SESSION_EXPIRED', 'TICKET_INVALID', 'ACCOUNT_REQUIRED', 'ACCOUNT_SESSION_INVALID'].includes(code) ? 401 : code === 'ORIGIN_DENIED' ? 403 : ['ROOM_EXPIRED', 'WALLET_NOT_FOUND'].includes(code) ? 404 : ['TABLE_FULL', 'STALE_STATE', 'SESSION_REPLACED', 'ROOM_VERSION_UNSUPPORTED'].includes(code) ? 409 : ['ROOM_STATE_INVALID', 'AUTH_UNAVAILABLE', 'WALLET_NOT_CONNECTED', 'WALLET_UNAVAILABLE'].includes(code) ? 503 : code === 'RATE_LIMITED' ? 429 : known ? 400 : 500;
  return Response.json({ code, message: known ? error.message : 'The table service could not complete this request. Please try again.' }, { status, headers: { 'Cache-Control': 'no-store' } });
}
