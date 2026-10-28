import type { TableRoom } from './tableRoom';
export interface Env { ROOMS: DurableObjectNamespace<TableRoom>; ALLOWED_ORIGINS: string; ENTRY_LIMITER: RateLimit }
