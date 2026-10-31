import { z } from 'zod';

export const gameIdSchema = z.enum(['blackjack', 'baccarat', 'roulette', 'texas-holdem', 'keno', 'duck-race', 'penguin-cross', 'crash']);
export type GameId = z.infer<typeof gameIdSchema>;
export const GAME_CATALOG = [
  { id: 'blackjack', name: 'Blackjack', symbol: '♠', badge: '21', status: 'available', description: 'Find your twenty-one. Play solo or share a table with friends.' },
  { id: 'baccarat', name: 'Baccarat', symbol: '♦', badge: '9', status: 'coming-soon', description: 'Player or banker. A new table is on the way.' },
  { id: 'roulette', name: 'Roulette', symbol: '◉', badge: '00', status: 'coming-soon', description: 'Pick your numbers. Watch the wheel.' },
  { id: 'texas-holdem', name: 'Texas Hold’em', symbol: '♣', badge: 'A K', status: 'coming-soon', description: 'Community cards, shared pots, and a little table talk.' },
  { id: 'keno', name: 'Keno', symbol: '#', badge: '7', status: 'coming-soon', description: 'Pick your numbers. See what the draw brings.' },
  { id: 'duck-race', name: 'Duck Race', symbol: '🦆', badge: 'GO', status: 'coming-soon', description: 'Pick a duck. Follow the race with your friends.' },
  { id: 'penguin-cross', name: 'Penguin Cross', symbol: '🐧', badge: '→', status: 'coming-soon', description: 'A little timing. A little nerve. A new game ahead.' },
  { id: 'crash', name: 'Crash', symbol: '↗', badge: '×', status: 'coming-soon', description: 'Watch the multiplier. Choose your moment.' },
] as const satisfies ReadonlyArray<{ id: GameId; name: string; symbol: string; badge: string; status: 'available' | 'coming-soon'; description: string }>;
export const lobbyVisibilitySchema = z.enum(['public', 'private']);
export type LobbyVisibility = z.infer<typeof lobbyVisibilitySchema>;
export const publicLobbySchema = z.object({
  roomId: z.string().regex(/^[a-f0-9]{32}$/), gameId: gameIdSchema,
  hostName: z.string().min(1).max(24), players: z.number().int().min(1).max(12),
  capacity: z.number().int().min(1).max(12), phase: z.enum(['waiting', 'playing']), updatedAt: z.number().int().nonnegative(),
});
export type PublicLobby = z.infer<typeof publicLobbySchema>;
export const lobbyListSchema = z.object({ gameId: gameIdSchema, lobbies: z.array(publicLobbySchema).max(50) });
