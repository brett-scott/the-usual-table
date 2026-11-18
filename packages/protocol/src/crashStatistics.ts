import { z } from 'zod';
const CRASH_MAX_MULTIPLIER=10000;
/** Trusted settlement facts; never a browser command. */
export const crashRoundFactsSchema=z.object({cashedOut:z.boolean(),cashoutCents:z.number().int().min(100).max(CRASH_MAX_MULTIPLIER).nullable(),
  crashCents:z.number().int().min(100).max(CRASH_MAX_MULTIPLIER),capped:z.boolean(),cashoutMethod:z.enum(['manual','automatic','ceiling']).optional()}).strict()
  .refine(f=>f.cashedOut===(f.cashoutCents!==null)&&(!f.capped||f.crashCents===CRASH_MAX_MULTIPLIER)
    &&(f.cashoutCents===null||f.cashoutCents<f.crashCents||f.capped&&f.cashoutCents===CRASH_MAX_MULTIPLIER)
    &&(f.cashoutMethod===undefined||f.cashedOut&&(f.cashoutMethod!=='ceiling'||f.capped&&f.cashoutCents===CRASH_MAX_MULTIPLIER)),'Invalid Crash result');
