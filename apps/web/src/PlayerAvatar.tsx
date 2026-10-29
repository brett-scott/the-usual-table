import { PLAYER_ICONS, type PublicPlayer } from '@casual/protocol';
import s from './App.module.css';

export function PlayerAvatar({ player }: { player: Pick<PublicPlayer, 'name' | 'icon'> }) {
  const choice = PLAYER_ICONS.find(icon => icon.emoji === player.icon);
  return <span className={s.avatar} data-player-icon={player.icon} data-emoji={!!choice} role={choice ? 'img' : undefined} aria-label={choice ? `${choice.label} player icon` : undefined} aria-hidden={choice ? undefined : true}>{choice?.emoji ?? player.name.slice(0, 1).toUpperCase()}</span>;
}
