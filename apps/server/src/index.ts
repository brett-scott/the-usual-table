import { errorResponse, originAllowed, readRequestBody } from './security';
import { GameError } from '@casual/engine';
import type { Env } from './env';
export { TableRoom } from './tableRoom';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    let response: Response;
    try {
      if (!originAllowed(request, env.ALLOWED_ORIGINS, request.headers.get('Upgrade')?.toLowerCase() === 'websocket')) throw new GameError('ORIGIN_DENIED', 'This website is not allowed to connect to the table service.');
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
      else if (url.pathname === '/api/v1/health' && request.method === 'GET') response = Response.json({ status: 'ok', protocol: 1 });
      else {
        const create = url.pathname === '/api/v1/rooms' && request.method === 'POST';
        const match = url.pathname.match(/^\/api\/v1\/rooms\/([a-f0-9]{32})(?:\/(join|resume|ticket|snapshot|socket))?$/);
        if (!create && !match) return Response.json({ code: 'NOT_FOUND', message: 'This table route does not exist.' }, { status: 404 });
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          const key = `${create ? 'create' : match?.[2] ?? 'room'}:${request.headers.get('CF-Connecting-IP') ?? 'local'}`;
          if (!(await env.ENTRY_LIMITER.limit({ key })).success) throw new GameError('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
        }
        const inviteId = create ? crypto.randomUUID().replaceAll('-', '') : match![1]!;
        const headers = new Headers(request.headers); headers.set('X-Room-Id', inviteId);
        // Consume the bounded HTTP body before a room can reject early (for example,
        // an expired invitation). Otherwise an unread forwarded stream can outlive
        // the outer response in workerd. WebSocket upgrades have no request body.
        const body = request.body ? await readRequestBody(request) : undefined;
        response = await env.ROOMS.getByName(inviteId).fetch(new Request(request.url, { method: request.method, headers, body }));
      }
    } catch (error) { response = errorResponse(error); }
    // Upgrade responses retain their WebSocket; only append headers for HTTP responses.
    if (response.status !== 101) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store'); headers.set('Vary', 'Origin');
      if (origin && originAllowed(request, env.ALLOWED_ORIGINS)) headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response = new Response(response.body, { status: response.status, headers });
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
