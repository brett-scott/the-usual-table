import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,expect,it } from 'vitest';
import { progressionSchema,detailedStatisticsSchema,type CrashAction,type WalletCommand } from '@casual/protocol';
import { targetTime } from '@casual/crash';
import { PostgresWalletStore } from './index';
import { supabaseAuthFixture } from './supabaseFixture';
import { crashRoomAdapter,collectCrashSeats,restoreCrashRoom,type CrashRoom } from '../../../apps/server/src/games/crash';
import { flushCrashWallet } from '../../../apps/server/src/games/crashWallet';
let db:PGlite;let store:PostgresWalletStore;let setup:string;
beforeAll(async()=>{db=await PGlite.create();await db.exec(supabaseAuthFixture);setup=await readFile(new URL('../../../supabase/wallet-setup.sql',import.meta.url),'utf8');await db.exec(setup);store=new PostgresWalletStore(db);},30000);
afterAll(async()=>{await db?.close();});
async function rpc(id:string,name:string){return db.transaction(async tx=>{await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated',amr:[{method:'oauth'}]})]);await tx.exec('SET LOCAL ROLE authenticated');return(await tx.query<{value:unknown}>(`SELECT public.${name}() AS value`)).rows[0]!.value;});}
async function funded(){
  const accountId=crypto.randomUUID();await db.query('INSERT INTO auth.users(id) VALUES($1)',[accountId]);await rpc(accountId,'usual_table_ensure_wallet');
  let room=crashRoomAdapter.create({roomId:crypto.randomUUID().replaceAll('-',''),player:{id:'saved',name:'Pilot',seat:0},credentialHash:'a'.repeat(64),now:Date.now(),random:()=>0});
  room.members.saved!.account={id:accountId,expiresAt:Date.now()+3600000};room=crashRoomAdapter.fund(room,'saved',accountId,100000,crypto.randomUUID());
  let durable=structuredClone(room);const persist=async()=>{collectCrashSeats(room,Date.now());durable=structuredClone(room);restoreCrashRoom(durable);};
  const flush=()=>flushCrashWallet(room,store,persist);await persist();await flush();
  return{accountId,get room(){return room;},set room(value:CrashRoom){room=value;},get durable(){return durable;},persist,flush};
}
function move(room:CrashRoom,action:CrashAction,now:number){const command={id:crypto.randomUUID(),playerId:'saved',revision:room.revision,roundId:room.engine.roundId,action};return crashRoomAdapter.apply(room,command,()=>0,now);}
function finish(room:CrashRoom,point:number,now:number){return crashRoomAdapter.expire(room,()=>Math.floor(1_000_000_000-97_000_000_000/point),now);}
it('saves exact Crash payouts, retries a committed result once, returns funds, and awards account-specific XP/achievements',async()=>{
  const f=await funded();expect(f.room.engine.players[0]!.balanceUnits).toBe(100000);const start=Date.now();
  f.room=move(f.room,{type:'StartBetting'},start);f.room=move(f.room,{type:'PlaceBet',amountUnits:1000,autoCashoutCents:150},start+1);
  expect(()=>move(f.room,{type:'Refill'},start+2)).toThrow('not available');
  f.room=finish(f.room,200,start+10000+targetTime(0,200));expect(f.room.engine.players[0]!.balanceUnits).toBe(100500);
  await f.persist();let uncertain=true;
  const gateway={async execute(command:WalletCommand){const receipt=await store.execute(command);if(command.kind==='settle'&&uncertain){uncertain=false;throw new Error('lost response');}return receipt;}};
  await flushCrashWallet(f.room,gateway,f.persist);expect(f.room.wallet!.outbox).toHaveLength(1);
  f.room=restoreCrashRoom(f.durable).room;f.room.wallet!.retryAt=0;await f.persist();await flushCrashWallet(f.room,gateway,f.persist);
  expect(f.room.wallet!.outbox).toEqual([]);expect(progressionSchema.parse(await rpc(f.accountId,'usual_table_progression'))).toMatchObject({xp:'10',readyRewardUnits:'20000'});
  const next=start+30000;f.room.members.saved!.connected=true;f.room.members.saved!.controllerId='controller';f.room.members.saved!.presenceDeadline=next+30000;f.room.members.saved!.reservationDeadline=null;
  f.room=crashRoomAdapter.expire(f.room,()=>0,next);expect(f.room.engine.phase).toBe('betting');
  f.room=move(f.room,{type:'PlaceBet',amountUnits:1000,autoCashoutCents:500},next+1);f.room=finish(f.room,600,next+10000+targetTime(0,600));
  await f.persist();await f.flush();
  const details=detailedStatisticsSchema.parse(await rpc(f.accountId,'usual_table_detailed_statistics_v2'));
  expect(details.crash).toEqual({trackedRounds:'2',cashouts:'2',crashes:'0',highestCashoutCents:'500'});
  expect(details.summary.games.find(g=>g.gameId==='crash')).toMatchObject({roundsPlayed:'2',returnedUnits:'6500',wageredUnits:'2000',netUnits:'4500'});
  expect(progressionSchema.parse(await rpc(f.accountId,'usual_table_progression'))).toMatchObject({xp:'20',readyRewardUnits:'45000'});
  const claim=progressionSchema.parse(await rpc(f.accountId,'usual_table_claim_rewards'));expect(claim.claimedUnits).toBe(45000);expect(progressionSchema.parse(await rpc(f.accountId,'usual_table_claim_rewards')).claimedUnits).toBe(0);
  f.room=move(f.room,{type:'Leave'},next+40000);await f.persist();await f.flush();expect(f.room.engine.players).toEqual([]);
  expect(await store.getWallet(f.accountId)).toMatchObject({availableUnits:1049500,atTablesUnits:0,pendingReturnUnits:0});
  await db.exec(setup);expect(progressionSchema.parse(await rpc(f.accountId,'usual_table_progression'))).toMatchObject({xp:'20',readyRewardUnits:'0'});
  const other=await funded();expect(progressionSchema.parse(await rpc(other.accountId,'usual_table_progression'))).toMatchObject({xp:'0',readyRewardUnits:'0'});
});
it('keeps a departed saved wager committed until its crash and returns only the remaining stack',async()=>{
  const f=await funded();const now=Date.now();f.room=move(f.room,{type:'StartBetting'},now);f.room=move(f.room,{type:'PlaceBet',amountUnits:1000,autoCashoutCents:null},now+1);
  f.room=move(f.room,{type:'Leave'},now+2);await f.persist();expect(f.room.engine.players).toHaveLength(1);expect(f.room.wallet!.seats[Object.keys(f.room.wallet!.seats)[0]!]!.status).toBe('active');
  f.room=finish(f.room,100,now+10000);await f.persist();await f.flush();expect(f.room.engine.players).toEqual([]);
  expect(await store.getWallet(f.accountId)).toMatchObject({availableUnits:999000,atTablesUnits:0,pendingReturnUnits:0});
  expect(detailedStatisticsSchema.parse(await rpc(f.accountId,'usual_table_detailed_statistics_v2')).crash).toMatchObject({trackedRounds:'1',cashouts:'0',crashes:'1'});
  expect(progressionSchema.parse(await rpc(f.accountId,'usual_table_progression'))).toMatchObject({xp:'10',readyRewardUnits:'10000'});
});
it('rejects cross-game or inconsistent trusted Crash facts atomically without crediting wallet chips',async()=>{
  const f=await funded();const seat=Object.values(f.room.wallet!.seats)[0]!;const base={contract:1 as const,accountId:f.accountId,operationId:crypto.randomUUID(),kind:'settle' as const,gameId:'crash' as const,roomId:f.room.id,funding:'account' as const,
    sessionId:seat.sessionId,expectedVersion:seat.version,sequence:1,roundId:'1',rulesetVersion:'crash-97-v1',wageredUnits:1000,returnedUnits:1500,crash:{cashedOut:true,cashoutCents:150,crashCents:200,capped:false}};
  const before=await store.getWallet(f.accountId);await expect(store.execute({...base,returnedUnits:9999})).rejects.toThrow('INVALID_RESULT');
  await expect(store.execute({...base,gameId:'blackjack'})).rejects.toThrow('WRONG_GAME');expect(await store.getWallet(f.accountId)).toEqual(before);
  expect(progressionSchema.parse(await rpc(f.accountId,'usual_table_progression')).xp).toBe('0');
});
it('unlocks the 25-round Crash achievement and level reward once without requiring wins',async()=>{
  const f=await funded();const seat=Object.values(f.room.wallet!.seats)[0]!;let session=await store.getSession(f.accountId,seat.sessionId);
  for(let i=0;i<25;i++)session=(await store.execute({contract:1,accountId:f.accountId,operationId:crypto.randomUUID(),kind:'settle',sessionId:session.sessionId,expectedVersion:session.version,
    gameId:'crash',roomId:session.roomId,funding:'account',sequence:i+1,roundId:String(i+1),rulesetVersion:'crash-97-v1',wageredUnits:1000,returnedUnits:0,crash:{cashedOut:false,cashoutCents:null,crashCents:100,capped:false}})).session!;
  const p=progressionSchema.parse(await rpc(f.accountId,'usual_table_progression'));expect(p).toMatchObject({xp:'250',level:2,readyRewardUnits:'135000'});
  expect(p.achievements.find(a=>a.id==='crash:25-rounds')).toMatchObject({progress:'25',unlocked:true,claimed:false});
  expect(progressionSchema.parse(await rpc(f.accountId,'usual_table_claim_rewards')).claimedUnits).toBe(135000);expect(progressionSchema.parse(await rpc(f.accountId,'usual_table_claim_rewards')).claimedUnits).toBe(0);
});
