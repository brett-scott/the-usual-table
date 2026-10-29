import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ChatFeed, GameClient } from '@casual/protocol';
import s from './App.module.css';
const empty: ChatFeed = { messages: [], available: false, unread: 0 };
export const BUBBLE_LIMIT = 80;
export function bubbleText(text: string) {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.length > BUBBLE_LIMIT ? `${characters.slice(0, BUBBLE_LIMIT - 1).join('')}…` : characters.join('');
}
export function ChatBubble({ client, playerId, name }: { client: GameClient; playerId: string; name: string }) {
  const feed = useSyncExternalStore(client.subscribe, () => client.getChat?.() ?? empty);
  const latest = feed.liveMessages?.filter(entry => entry.message.playerId === playerId).at(-1);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!latest) return;
    const timeout = setTimeout(() => tick(value => value + 1), Math.max(0, latest.receivedAt + 5000 - Date.now()));
    return () => clearTimeout(timeout);
  }, [latest]);
  if (!latest || Date.now() >= latest.receivedAt + 5000) return null;
  return <div className={s.chatBubble} role="note" aria-label={`Message from ${name}`}><span>{bubbleText(latest.message.text)}</span></div>;
}
