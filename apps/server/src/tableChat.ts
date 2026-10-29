import { z } from 'zod';
import { CHAT_HISTORY_LIMIT, chatMessageSchema, type ChatMessage } from '@casual/protocol';
import { assertRule, type OnlineRoom } from './roomState';

const counter = z.object({ start: z.number().int().nonnegative(), count: z.number().int().nonnegative() });
const stateSchema = z.object({ schema: z.literal(1), messages: z.array(chatMessageSchema).max(CHAT_HISTORY_LIMIT), receipts: z.array(z.object({ playerId: z.string(), id: z.string().uuid() })).max(128), rates: z.record(z.string(), counter) });
export type ChatState = z.infer<typeof stateSchema>;
export function restoreChat(value: unknown): ChatState {
  if (value === undefined) return { schema: 1, messages: [], receipts: [], rates: {} };
  const parsed = stateSchema.safeParse(value);
  assertRule(parsed.success, 'CHAT_UNAVAILABLE', 'Table chat is unavailable. Your game can continue.');
  return parsed.data;
}
export function addChat(chat: ChatState, room: OnlineRoom, playerId: string, id: string, text: string, now: number): boolean {
  if (chat.receipts.some(receipt => receipt.playerId === playerId && receipt.id === id)) return false;
  const player = room.engine.players.find(p => p.id === playerId);
  assertRule(player && room.members[playerId]?.connected && !room.members[playerId]?.leaveAfterRound, 'SESSION_INVALID', 'Reconnect to your seat before sending a message.');
  // Keep only current-seat rate buckets. Chat never uses the gameplay rate budget.
  chat.rates = Object.fromEntries(Object.entries(chat.rates).filter(([key]) => room.members[key]));
  const rate = chat.rates[playerId];
  const count = !rate || now - rate.start >= 10_000 ? { start: now, count: 0 } : rate;
  assertRule(count.count < 5, 'CHAT_RATE_LIMITED', 'Give the table a moment. You can send five messages every 10 seconds.');
  count.count++; chat.rates[playerId] = count;
  const message: ChatMessage = { id: crypto.randomUUID(), playerId, name: player.name, seat: player.seat, text, sentAt: now };
  chat.messages = [...chat.messages, message].slice(-CHAT_HISTORY_LIMIT);
  chat.receipts = [...chat.receipts, { playerId, id }].slice(-128);
  return true;
}
