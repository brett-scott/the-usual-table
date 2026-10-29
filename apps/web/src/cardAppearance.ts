import { createContext } from 'react';
export type CardFace = 'classic' | 'large-index';
export type CardBack = 'traditional' | 'geometric';
export const CardAppearance = createContext<{ face: CardFace; back: CardBack }>({ face: 'classic', back: 'traditional' });
export function savedAppearance() {
  try {
    return { face: localStorage.getItem('casual-card-face') === 'large-index' ? 'large-index' as const : 'classic' as const,
      back: localStorage.getItem('casual-card-back') === 'geometric' ? 'geometric' as const : 'traditional' as const };
  } catch { return { face: 'classic' as const, back: 'traditional' as const }; }
}
