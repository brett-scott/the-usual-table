import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {EXPANDED_ACHIEVEMENTS,progressionSchema,baccaratReturned,baccaratWagerUnits,rouletteReturned,kenoReturned,type GameId,type WalletSession,type WalletCommand} from '@casual/protocol';
import {PostgresWalletStore} from './index';
import {supabaseAuthFixture} from './supabaseFixture';
let db:PGlite;let store:PostgresWalletStore;let setup:string;
beforeAll(async()=>{db=await PGlite.create();await db.exec(supabaseAuthFixture);setup=await readFile(new URL('../../../supabase/wallet-setup.sql',import.meta.url),'utf8');await db.exec(setup);store=new PostgresWalletStore(db);},30000);
afterAll(async()=>{await db?.close();});
async function rpc(id:string,name='usual_table_progression_v2',database=db){return database.transaction(async tx=>{await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated',amr:[{method:'oauth'}]})]);await tx.exec('SET LOCAL ROLE authenticated');return(await tx.query<{value:unknown}>(`SELECT public.${name}() AS value`)).rows[0]!.value;});}
async function account(database=db){const id=crypto.randomUUID();await database.query('INSERT INTO auth.users(id) VALUES($1)',[id]);await rpc(id,'usual_table_ensure_wallet',database);return id;}
async function seat(id:string,gameId:GameId,wallet=store){const session=(await wallet.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'allocate',sessionId:crypto.randomUUID(),gameId,roomId:crypto.randomUUID(),funding:'account',amountUnits:100000})).session!;return(await wallet.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'activate',sessionId:session.sessionId,expectedVersion:session.version})).session!;}
type Extra=Partial<Extract<WalletCommand,{kind:'settle'}>>;
async function settle(s:WalletSession,extra:Extra,wallet=store){return(await wallet.execute({contract:1,accountId:s.accountId,operationId:crypto.randomUUID(),kind:'settle',sessionId:s.sessionId,expectedVersion:s.version,gameId:s.gameId,roomId:s.roomId,funding:'account',sequence:s.resultSequence+1,roundId:String(s.resultSequence+1),rulesetVersion:'test',wageredUnits:1000,returnedUnits:2000,...extra})).session!;}
const bj={hands:1,wins:1,losses:0,pushes:0,blackjacks:0,busts:0,doubles:0,splits:0,insuranceTaken:false,insuranceWon:false};
async function progress(id:string){return progressionSchema.parse(await rpc(id));}
function goal(p:Awaited<ReturnType<typeof progress>>,id:string){return p.achievements.find(a=>a.id===id)!;}
function completeGame(p:Awaited<ReturnType<typeof progress>>,game:GameId){for(const d of EXPANDED_ACHIEVEMENTS.filter(a=>a.gameId===game))expect(goal(p,d.id),d.id).toMatchObject({progress:String(d.target),unlocked:true,rewardUnits:d.rewardUnits,difficulty:d.difficulty});}
it('installs all 36 approved definitions, rewards and private/legacy projections without resetting claims',async()=>{
 const id=await account(),p=await progress(id);expect(p.achievements).toHaveLength(60);for(const d of EXPANDED_ACHIEVEMENTS)expect(goal(p,d.id)).toMatchObject({name:d.name,target:d.target,rewardUnits:d.rewardUnits,difficulty:d.difficulty,progress:'0',unlocked:false});expect(EXPANDED_ACHIEVEMENTS.reduce((n,a)=>n+a.rewardUnits,0)).toBe(14100000);
 const legacy=progressionSchema.parse(await rpc(id,'usual_table_progression'));expect(legacy.achievements).toHaveLength(60);expect(legacy.achievements.every(a=>!('breakdown' in a)&&!('difficulty' in a))).toBe(true);
 const start=(await db.query<{starts_at:Date}>("SELECT starts_at FROM wallet_private.progression_policy WHERE version='achievements-v2'")).rows[0]!.starts_at;await db.exec(setup);expect((await db.query<{starts_at:Date}>("SELECT starts_at FROM wallet_private.progression_policy WHERE version='achievements-v2'")).rows[0]!.starts_at).toEqual(start);
 await expect(db.exec("UPDATE wallet_private.achievement_details SET difficulty='Easy' WHERE achievement_id='blackjack:perfect-match'")).rejects.toThrow('append-only');await expect(db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE authenticated');await tx.query('SELECT wallet_private.expanded_achievement_progress($1::uuid)',[id]);})).rejects.toThrow();
});
it('tracks Blackjack hand-specific doubles, all split wins, eligible naturals and actual pair wagers',async()=>{
 const id=await account();let s=await seat(id,'blackjack');s=await settle(s,{blackjack:{...bj,hands:2,wins:1,losses:1,doubles:1,splits:1,doubledHandsWon:0}});expect(goal(await progress(id),'blackjack:double-trouble').progress).toBe('0');expect(goal(await progress(id),'blackjack:split-decision').progress).toBe('0');
 s=await settle(s,{blackjack:{...bj,hands:2,wins:2,doubles:1,splits:1,doubledHandsWon:1}});
 for(let n=0;n<25;n++)s=await settle(s,{blackjack:{...bj,blackjacks:1}});
 for(const kind of ['mixed','coloured','perfect'] as const){const returned=1000*({mixed:7,coloured:13,perfect:26}[kind]);for(let n=0;n<(kind==='perfect'?10:1);n++)s=await settle(s,{rulesetVersion:'blackjack-perfect-pairs-v2',wageredUnits:2000,returnedUnits:1000+returned,blackjack:{...bj,perfectPairs:{wagerUnits:1000,returnedUnits:returned,kind}}});}
 completeGame(await progress(id),'blackjack');
});
it('tracks Baccarat actual winning legs, excludes tied/refunded mains and third-card nines, and caps each collection category',async()=>{
 const id=await account();let s=await seat(id,'baccarat');const play=async(f:NonNullable<Extra['baccarat']>)=>{s=await settle(s,{rulesetVersion:'baccarat-no-commission-v2',wageredUnits:baccaratWagerUnits(f),returnedUnits:baccaratReturned(f),baccarat:f});};
 await play({factsVersion:2,mainSide:'player',mainUnits:1000,tieUnits:0,playerPair:false,bankerPair:false,outcome:'tie',playerTotal:9,bankerTotal:9,commissionUnits:0});expect(goal(await progress(id),'baccarat:both-sides').progress).toBe('0');
 await play({factsVersion:2,mainSide:'player',mainUnits:1000,tieUnits:0,playerPair:false,bankerPair:false,outcome:'player',playerTotal:9,bankerTotal:7,commissionUnits:0,initialTotals:{player:5,banker:5}});expect(goal(await progress(id),'baccarat:natural-nine').progress).toBe('0');
 for(let n=0;n<5;n++){
  await play({factsVersion:2,mainSide:'player',mainUnits:1000,tieUnits:0,playerPair:false,bankerPair:false,outcome:'player',playerTotal:9,bankerTotal:8,commissionUnits:0,initialTotals:{player:9,banker:8}});
  await play({factsVersion:2,mainSide:'banker',mainUnits:1000,tieUnits:0,sideBets:{playerPairUnits:1000,bankerPairUnits:1000,superSixUnits:1000},playerPair:true,bankerPair:true,outcome:'banker',playerTotal:5,bankerTotal:6,commissionUnits:0});
  await play({factsVersion:2,mainSide:null,mainUnits:0,tieUnits:1000,playerPair:false,bankerPair:false,outcome:'tie',playerTotal:0,bankerTotal:0,commissionUnits:0});
 }completeGame(await progress(id),'baccarat');expect(goal(await progress(id),'baccarat:complete-set').breakdown).toHaveLength(6);
});
it('distinguishes actual manual, automatic and ceiling Crash cash-outs; unknown legacy methods stay unknown',async()=>{
 const id=await account();let s=await seat(id,'crash');const play=async(cents:number,method?:'manual'|'automatic'|'ceiling')=>{s=await settle(s,{rulesetVersion:'crash-97-v1',returnedUnits:1000*cents/100,crash:{cashedOut:true,cashoutCents:cents,crashCents:10000,capped:method==='ceiling',...(method?{cashoutMethod:method}:{})}});};
 await play(200);expect(goal(await progress(id),'crash:hands-on').progress).toBe('0');expect(goal(await progress(id),'crash:set-and-forget').progress).toBe('0');await play(10000,'ceiling');expect(goal(await progress(id),'crash:hands-on').progress).toBe('0');
 for(let n=0;n<5;n++)await play(200,'automatic');for(let n=0;n<10;n++)await play(200,'manual');for(let n=0;n<5;n++)await play(1000,'manual');await play(2500,'manual');for(let n=0;n<18;n++)await play(500,'automatic');completeGame(await progress(id),'crash');
});
it('keeps Duck Race streaks in one funded session, handles losses and collects the four duck slots',async()=>{
 const id=await account();let a=await seat(id,'duck-race');const b=await seat(id,'duck-race');const race=(s:WalletSession,duck:number,win=true)=>settle(s,{rulesetVersion:'duck-race-four-v1',returnedUnits:win?4000:0,duckRace:{duckIndex:duck,winner:win?duck:(duck+1)%4,duckCount:4}});
 a=await race(a,0);a=await race(a,0);await race(b,0);expect(goal(await progress(id),'duck-race:hat-trick').progress).toBe('2');a=await race(a,0,false);a=await race(a,0);expect(goal(await progress(id),'duck-race:hat-trick').progress).toBe('2');
 for(let duck=0;duck<4;duck++)for(let n=0;n<10;n++)a=await race(a,duck);for(let n=0;n<60;n++)a=await race(a,0);completeGame(await progress(id),'duck-race');expect(goal(await progress(id),'duck-race:champion-flock').breakdown?.map(p=>p.target)).toEqual([10,10,10,10]);
});
it('requires profitable inside Roulette spins and sole straight-up tickets for the harder number goals',async()=>{
 const id=await account();let s=await seat(id,'roulette');const spin=async(bets:{betId:string;amountUnits:number}[],winner:number)=>{s=await settle(s,{rulesetVersion:'roulette-european-v1',wageredUnits:bets.reduce((n,b)=>n+b.amountUnits,0),returnedUnits:rouletteReturned(bets,winner),roulette:{bets,winner}});};
 await spin([{betId:'straight-0',amountUnits:1000},{betId:'straight-1',amountUnits:1000}],0);expect(goal(await progress(id),'roulette:green-light').progress).toBe('0');expect(goal(await progress(id),'roulette:sharpshooter').progress).toBe('0');
 await spin([{betId:'split-1-2',amountUnits:1000},{betId:'straight-36',amountUnits:100000}],1);expect(goal(await progress(id),'roulette:split-ticket').progress).toBe('0');
 await spin([{betId:'split-1-2',amountUnits:1000}],1);await spin([{betId:'street-1-2-3',amountUnits:1000}],1);await spin([{betId:'six-line-1-2-3-4-5-6',amountUnits:1000}],1);
 await spin([{betId:'corner-1-2-4-5',amountUnits:1000},{betId:'corner-2-3-5-6',amountUnits:1000}],2);expect(goal(await progress(id),'roulette:corner-pocket').progress).toBe('1');for(let n=0;n<2;n++)await spin([{betId:'corner-1-2-4-5',amountUnits:1000}],1);
 for(let n=0;n<10;n++)await spin([{betId:'straight-'+(n%5),amountUnits:1000}],n%5);completeGame(await progress(id),'roulette');
});
it('tracks Keno exact pick counts, distinct winning pick counts and rounded profitable results',async()=>{
 const id=await account();let s=await seat(id,'keno');const draw=[1,2,3,4,5,6,7,8,9,10];const play=async(numbers:number[])=>{s=await settle(s,{rulesetVersion:'keno-40-10-v2',returnedUnits:kenoReturned({numbers,amountUnits:1000},draw),keno:{numbers,draw}});};
 await play([1,2,3,31,32,33,34,35,36,37]);expect(goal(await progress(id),'keno:three-for-three').progress).toBe('0');expect(goal(await progress(id),'keno:lucky-six').progress).toBe('0');
 for(let picks=1;picks<=10;picks++)await play(Array.from({length:picks},(_,i)=>i+1));for(let n=0;n<100;n++)await play([1]);completeGame(await progress(id),'keno');expect(goal(await progress(id),'keno:ticket-explorer').breakdown).toHaveLength(10);
});
it('credits provable saved history and preserves old claims, but never invents missing facts',async()=>{
 const legacy=await PGlite.create();try{
  await legacy.exec(supabaseAuthFixture);const boundary=setup.indexOf("INSERT INTO wallet_private.progression_policy(version) VALUES('achievements-v2')");expect(boundary).toBeGreaterThan(0);await legacy.exec(setup.slice(0,boundary)+'COMMIT;');const wallet=new PostgresWalletStore(legacy),id=await account(legacy);let s=await seat(id,'blackjack',wallet);
  for(let n=0;n<25;n++)s=await settle(s,{blackjack:{...bj,blackjacks:1}},wallet);await rpc(id,'usual_table_claim_rewards',legacy);const before=await wallet.getWallet(id);await legacy.exec('BEGIN;'+setup.slice(boundary));let p=progressionSchema.parse(await rpc(id,'usual_table_progression_v2',legacy));expect(goal(p,'blackjack:blackjack-collection')).toMatchObject({progress:'25',unlocked:true});expect(goal(p,'blackjack:double-trouble')).toMatchObject({progress:'0',unlocked:false});expect(p.achievements.find(a=>a.id==='blackjack:first-round')?.claimed).toBe(true);
  const claimed=progressionSchema.parse(await rpc(id,'usual_table_claim_rewards_v2',legacy));expect(claimed.claimedUnits).toBe(500000);expect((await wallet.getWallet(id)).availableUnits).toBe(before.availableUnits+500000);expect(progressionSchema.parse(await rpc(id,'usual_table_claim_rewards_v2',legacy)).claimedUnits).toBe(0);await legacy.exec(setup);p=progressionSchema.parse(await rpc(id,'usual_table_progression_v2',legacy));expect(goal(p,'blackjack:blackjack-collection').claimed).toBe(true);
 }finally{await legacy.close();}
});
it('claims the expanded rewards atomically, isolates accounts and rolls back a failed ledger write',async()=>{
 const id=await account(),other=await account();const s=await seat(id,'crash');await settle(s,{rulesetVersion:'crash-97-v1',returnedUnits:2000,crash:{cashedOut:true,cashoutCents:200,crashCents:300,capped:false}});const p=await progress(id);expect(goal(p,'crash:safe-landing')).toMatchObject({rewardUnits:50000,unlocked:true});expect(goal(await progress(other),'crash:safe-landing').progress).toBe('0');
 const before=await store.getWallet(id);await db.exec("CREATE FUNCTION wallet_private.fail_expanded_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reward failure';END;$$;CREATE TRIGGER fail_expanded_reward BEFORE INSERT ON wallet_private.ledger FOR EACH ROW WHEN(NEW.kind='claim_reward') EXECUTE FUNCTION wallet_private.fail_expanded_reward();");await expect(rpc(id,'usual_table_claim_rewards_v2')).rejects.toThrow('reward failure');expect(await store.getWallet(id)).toEqual(before);expect(goal(await progress(id),'crash:safe-landing').claimed).toBe(false);await db.exec('DROP TRIGGER fail_expanded_reward ON wallet_private.ledger;DROP FUNCTION wallet_private.fail_expanded_reward();');
 const claimed=progressionSchema.parse(await rpc(id,'usual_table_claim_rewards_v2'));expect(claimed.claimedUnits).toBe(Number(p.readyRewardUnits));expect(goal(claimed,'crash:safe-landing').claimed).toBe(true);expect((await store.getWallet(id)).availableUnits).toBe(before.availableUnits+claimed.claimedUnits);expect(progressionSchema.parse(await rpc(id,'usual_table_claim_rewards_v2')).claimedUnits).toBe(0);
});
