import { gameIdSchema } from './games';
export function gameIdFromHash(hash:string){const match=/^#\/games\/([^/]+)(?:\/lobbies)?$/.exec(hash);return match?gameIdSchema.safeParse(match[1]).data??null:null;}
