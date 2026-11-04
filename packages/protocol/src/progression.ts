import { z } from 'zod';
import { gameIdSchema } from './games';
import { walletSummarySchema, walletUnitsSchema } from './wallet';
const integer = z.string().max(40).regex(/^(0|[1-9]\d*)$/);
export const progressionSchema = z.object({
  contract:z.literal(1),accountId:z.string().uuid(),policy:z.literal('progress-v1'),startsAt:z.number().int().nonnegative().safe(),
  xpPerRound:z.literal(10),xp:integer,level:z.number().int().min(1).max(2000000000),levelStartXp:integer,nextLevelXp:integer,
  levelRewardUnits:z.literal(100000),claimedLevel:z.number().int().min(1),readyRewardUnits:integer,claimedUnits:walletUnitsSchema,
  achievements:z.array(z.object({id:z.string().max(100),gameId:gameIdSchema,name:z.string().max(100),description:z.string().max(200),
    rewardUnits:walletUnitsSchema,target:z.number().int().positive(),progress:integer,unlocked:z.boolean(),claimed:z.boolean()}).strict()).max(200),
  wallet:walletSummarySchema.nullable(),
}).strict().refine(v=>{
  try {
    const level=BigInt(v.level);const start=100n*(level-1n)*level/2n;const end=100n*level*(level+1n)/2n;
    return (!v.wallet || v.wallet.accountId===v.accountId) && v.claimedLevel<=v.level
      && BigInt(v.levelStartXp)===start && BigInt(v.nextLevelXp)===end && BigInt(v.xp)>=start && BigInt(v.xp)<end
      && BigInt(v.readyRewardUnits)===BigInt(v.level-v.claimedLevel)*100000n+v.achievements.reduce((sum,a)=>sum+(a.unlocked&&!a.claimed?BigInt(a.rewardUnits):0n),0n)
      && new Set(v.achievements.map(a=>a.id)).size===v.achievements.length
      && v.achievements.every(a=>a.unlocked===(BigInt(a.progress)>=BigInt(a.target))&&(!a.claimed||a.unlocked));
  }catch{return false;}
},'Invalid progression ownership, thresholds or claims');
export type Progression = z.infer<typeof progressionSchema>;
