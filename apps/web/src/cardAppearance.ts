import { createContext } from 'react';
export type CardFace = 'classic' | 'large-index';
export type CardBack = import('@casual/protocol').CosmeticSelection['back'];
export type CardArtwork=import('@casual/protocol').CosmeticSelection['artwork'];
export type CardAppearanceValue={face:CardFace;back:CardBack;artwork?:CardArtwork};
export const CardAppearance = createContext<CardAppearanceValue>({ face: 'classic', back: 'traditional',artwork:'ivory' });
export function savedAppearance() {
  try {
    return { face: localStorage.getItem('casual-card-face') === 'large-index' ? 'large-index' as const : 'classic' as const,
      back: localStorage.getItem('casual-card-back') === 'geometric' ? 'geometric' as const : 'traditional' as const };
  } catch { return { face: 'classic' as const, back: 'traditional' as const }; }
}
