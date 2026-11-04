import { z } from 'zod';
/** Display text only: duplicates are allowed. Account/player IDs determine ownership. */
export const displayNameSchema = z.string().trim().min(1, 'Enter your name.').max(24, 'Use at most 24 characters.');
export const PLAYER_ICONS = [
  { emoji: '😎', label: 'Sunglasses' }, { emoji: '🦊', label: 'Fox' },
  { emoji: '🐱', label: 'Cat' }, { emoji: '🐶', label: 'Dog' },
  { emoji: '🐼', label: 'Panda' }, { emoji: '🐸', label: 'Frog' },
  { emoji: '🦁', label: 'Lion' }, { emoji: '🦉', label: 'Owl' },
  { emoji: '🦄', label: 'Unicorn' }, { emoji: '🐙', label: 'Octopus' },
  { emoji: '🤖', label: 'Robot' }, { emoji: '👽', label: 'Alien' },
  { emoji: '🎩', label: 'Top hat' }, { emoji: '🍀', label: 'Clover' },
  { emoji: '🔥', label: 'Fire' }, { emoji: '⭐', label: 'Star' },
] as const;
export const playerIconSchema = z.enum(PLAYER_ICONS.map(icon => icon.emoji), { error: 'Choose an available player icon.' });
export type PlayerIcon = z.infer<typeof playerIconSchema>;
