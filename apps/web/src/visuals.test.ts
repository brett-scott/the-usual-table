import { expect, it } from 'vitest';
import { chipTokens } from './WagerChips';
import { bubbleText } from './ChatBubble';
import { savedAppearance } from './cardAppearance';

it('represents legal wagers and returns with a bounded stack and exact chip value', () => {
  for (let wager = 20; wager <= 200; wager += 20) for (const amount of [wager, wager * 2, wager * 4, wager * 2.5, wager / 2, wager * 1.5]) {
    const tokens = chipTokens(amount); expect(tokens.length).toBeLessThanOrEqual(7); expect(tokens.reduce((sum, coin) => sum + coin.units, 0)).toBe(amount);
  }
});
it('caps table bubbles at 80 Unicode characters while keeping the original message intact', () => {
  const text = '😀'.repeat(100); expect(Array.from(bubbleText(text))).toHaveLength(80); expect(bubbleText(text).endsWith('…')).toBe(true);
  expect(text).toBe('😀'.repeat(100)); expect(bubbleText(' hello\n  table ')).toBe('hello table');
});
it('uses safe appearance defaults when storage is unavailable', () => { expect(savedAppearance()).toEqual({ face: 'classic', back: 'traditional' }); });
