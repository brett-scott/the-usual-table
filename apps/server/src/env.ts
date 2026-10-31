import type { TableRoom } from './tableRoom';
import type { LobbyDirectory } from './lobbyDirectory';
import type { WalletGateway } from './roomWallet';
export interface Env { ROOMS: DurableObjectNamespace<TableRoom>; LOBBIES: DurableObjectNamespace<LobbyDirectory>; ALLOWED_ORIGINS: string; ENTRY_LIMITER: RateLimit; WALLET_SERVICE?: WalletGateway; WALLET_DB?: Hyperdrive; SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string }
