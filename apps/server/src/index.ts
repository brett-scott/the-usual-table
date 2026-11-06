import { errorResponse, hashSecret, originAllowed, readRequestBody } from './security';
import { GameError } from '@casual/engine';
import { GAME_CATALOG, PUBLIC_SUPABASE_CONFIG, supabaseUrlSchema } from '@casual/protocol';
import type { Env } from './env';
import { verifyAccountSession } from './accountAuth';
import { readAccountWallet } from './accountWallet';
import { supabaseWallet } from './supabaseWallet';
import { supabaseStatistics } from './supabaseStatistics';
import { supabaseAllowance } from './supabaseRewards';
import { gameAdapters } from './games/registry';
export { TableRoom } from './tableRoom';
export { LobbyDirectory } from './lobbyDirectory';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    let response: Response;
    try {
      if (!originAllowed(request, env.ALLOWED_ORIGINS, request.headers.get('Upgrade')?.toLowerCase() === 'websocket')) throw new GameError('ORIGIN_DENIED', 'This website is not allowed to connect to the table service.');
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
      else if (url.pathname === '/api/v1/health' && request.method === 'GET') {
        const auth = supabaseUrlSchema.safeParse(env.SUPABASE_URL ?? PUBLIC_SUPABASE_CONFIG.url);
        response = Response.json({ status: 'ok', protocol: 1, authProjectUrl: auth.success ? auth.data : null,
          accountPlayProtocol: 1, accountPlayConfigured: !!(env.WALLET_DB || env.WALLET_SERVICE), accountStatisticsProtocol: 1, accountRewardsProtocol:1,gameAdapterProtocol:1,crashProtocol:2,baccaratProtocol:3 });
      }
      else if (url.pathname === '/api/v1/games' && request.method === 'GET') response = Response.json({ games: GAME_CATALOG });
      else if (url.pathname === '/api/v1/account/session' && request.method === 'GET') {
        if (!(await env.ENTRY_LIMITER.limit({ key: `account:${request.headers.get('CF-Connecting-IP') ?? 'local'}` })).success) throw new GameError('RATE_LIMITED', 'Wait a moment before reconnecting your account.');
        response = Response.json(await verifyAccountSession(request, env));
      }
      else if (['/api/v1/account/allowance','/api/v1/account/progression'].includes(url.pathname) && ['GET','POST'].includes(request.method)) {
        if (!(await env.ENTRY_LIMITER.limit({ key: `rewards:${request.headers.get('CF-Connecting-IP') ?? 'local'}` })).success) throw new GameError('RATE_LIMITED', 'Wait a moment before refreshing rewards.');
        const account = await verifyAccountSession(request, env);
        if (request.method === 'POST' && request.body && (await readRequestBody(request)).length) throw new GameError('INVALID_REQUEST','Reward claims do not accept amounts or account IDs.');
        response = Response.json(await supabaseAllowance(request,env,account,url.pathname.endsWith('/progression')));
      }
      else if (['/api/v1/account/statistics','/api/v1/account/statistics/details'].includes(url.pathname) && request.method === 'GET') {
        if (!(await env.ENTRY_LIMITER.limit({ key: `statistics:${request.headers.get('CF-Connecting-IP') ?? 'local'}` })).success) throw new GameError('RATE_LIMITED', 'Wait a moment before refreshing statistics.');
        response = Response.json(await supabaseStatistics(request, env, await verifyAccountSession(request, env),url.pathname.endsWith('/details')));
      }
      else if (url.pathname === '/api/v1/account/wallet' && ['GET', 'POST'].includes(request.method)) {
        if (!(await env.ENTRY_LIMITER.limit({ key: `wallet:${request.headers.get('CF-Connecting-IP') ?? 'local'}` })).success) throw new GameError('RATE_LIMITED', 'Wait a moment before refreshing your wallet.');
        const account = await verifyAccountSession(request, env);
        if (request.method === 'POST' && request.body) {
          const bytes = await readRequestBody(request);
          if (bytes.length) throw new GameError('INVALID_REQUEST', 'Wallet setup does not accept account IDs, amounts or other fields.');
        }
        if (env.WALLET_SERVICE) {
          if (request.method === 'POST') throw new GameError('WALLET_NOT_CONNECTED', 'Wallet provisioning is not configured for this service.');
          response = Response.json(await readAccountWallet(account, env.WALLET_SERVICE));
        } else response = Response.json(await supabaseWallet(request, env, account, request.method === 'POST'));
      }
      else if (/^\/api\/v1\/games\/[^/]+\/lobbies$/.test(url.pathname) && request.method === 'GET') {
        const gameId = url.pathname.split('/')[4];
        const game = gameAdapters.available(gameId);
        if (!(await env.ENTRY_LIMITER.limit({ key: `lobbies:${request.headers.get('CF-Connecting-IP') ?? 'local'}` })).success) throw new GameError('RATE_LIMITED', 'Wait a moment before refreshing the tables.');
        response = Response.json({ gameId, lobbies: (await env.LOBBIES.getByName(game.gameId).list()).filter(lobby=>lobby.gameId===game.gameId) });
      }
      else {
        const gameCreate=/^\/api\/v1\/games\/([^/]+)\/rooms$/.exec(url.pathname);
        const create = (url.pathname === '/api/v1/rooms'||!!gameCreate) && request.method === 'POST';
        const game=create?gameAdapters.available(gameCreate?.[1]??'blackjack'):undefined;
        const match = url.pathname.match(/^\/api\/v1\/rooms\/([a-f0-9]{32})(?:\/(join|resume|ticket|snapshot|socket|authorize|info))?$/);
        if (!create && !match) return Response.json({ code: 'NOT_FOUND', message: 'This table route does not exist.' }, { status: 404 });
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          const key = `${create ? 'create' : match?.[2] ?? 'room'}:${request.headers.get('CF-Connecting-IP') ?? 'local'}`;
          if (!(await env.ENTRY_LIMITER.limit({ key })).success) throw new GameError('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
        }
        // Consume the bounded HTTP body before a room can reject early (for example,
        // an expired invitation). Otherwise an unread forwarded stream can outlive
        // the outer response in workerd. WebSocket upgrades have no request body.
        const body = request.body ? await readRequestBody(request) : undefined;
        let inviteId = create ? crypto.randomUUID().replaceAll('-', '') : match![1]!;
        if (create && request.headers.has('Authorization')) {
          const account = await verifyAccountSession(request, env);
          let entry: { funding?: unknown; entryId?: unknown }; try { entry = JSON.parse(new TextDecoder().decode(body)); } catch { throw new GameError('INVALID_REQUEST', 'Send a valid table entry.'); }
          if (!entry || entry.funding !== 'account' || typeof entry.entryId !== 'string' || !/^[a-f0-9-]{36}$/i.test(entry.entryId)) throw new GameError('INVALID_REQUEST', 'Saved-chip entries require a unique entry ID.');
          inviteId = (await hashSecret(`${game!.gameId}:${account.accountId}:${entry.entryId.toLowerCase()}`)).slice(0, 32);
        }
        const headers = new Headers(request.headers); headers.set('X-Room-Id', inviteId);
        headers.delete('X-Game-Id');if(game)headers.set('X-Game-Id',game.gameId);
        if(create)url.pathname='/api/v1/rooms';
        response = await env.ROOMS.getByName(inviteId).fetch(new Request(url, { method: request.method, headers, body }));
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
