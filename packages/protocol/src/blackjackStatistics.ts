import { z } from 'zod';
const hands = z.number().int().min(0).max(4);
/** Authoritative round facts from the Blackjack engine; never accepted from a browser. */
export const blackjackRoundFactsSchema = z.object({
  hands: hands.min(1), wins: hands, losses: hands, pushes: hands, blackjacks: hands,
  busts: hands, doubles: hands, splits: z.number().int().min(0).max(3),
  insuranceTaken: z.boolean(), insuranceWon: z.boolean(),
}).strict().refine(f => f.hands === f.wins + f.losses + f.pushes && f.blackjacks <= f.hands
  && f.blackjacks <= f.wins + f.pushes && f.blackjacks + f.doubles <= f.hands
  && f.busts <= f.losses && f.doubles <= f.hands && f.splits === f.hands - 1 && (!f.insuranceWon || f.insuranceTaken), 'Invalid Blackjack round facts');
