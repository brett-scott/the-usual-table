import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,expect,it } from 'vitest';
import { allowanceSchema,progressionSchema,detailedStatisticsSchema,type WalletSession } from '@casual/protocol';
import { PostgresWalletStore } from './index';
import { supabaseAuthFixture } from './supabaseFixture';
let db:PGlite;let store:PostgresWalletStore;let setup:string;
beforeAll(async()=>{db=await PGlite.create();await db.exec(supabaseAuthFixture);setup=await readFile(new URL('../../../supabase/wallet-setup.sql',import.meta.url),'utf8');await db.exec(setup);store=new PostgresWalletStore(db);},30000);
afterAll(async()=>{await db?.close();});
async function rpc(id:string,name:string){return db.transaction(async tx=>{await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated',amr:[{method:'oauth'}]})]);await tx.exec('SET LOCAL ROLE authenticated');return(await tx.query<{value:unknown}>(`SELECT public.${name}() AS value`)).rows[0]!.value;});}
async function account(){const id=crypto.randomUUID();await db.query('INSERT INTO auth.users(id) VALUES($1)',[id]);await rpc(id,'usual_table_ensure_wallet');return id;}
async function round(session:WalletSession,returned=2000,blackjack=false){return(await store.execute({contract:1,accountId:session.accountId,operationId:crypto.randomUUID(),kind:'settle',sessionId:session.sessionId,expectedVersion:session.version,
  roomId:session.roomId,gameId:'blackjack',funding:'account',sequence:session.resultSequence+1,roundId:String(session.resultSequence+1),rulesetVersion:'test',wageredUnits:1000,returnedUnits:returned,
  blackjack:{hands:1,wins:returned>1000?1:0,losses:returned<1000?1:0,pushes:returned===1000?1:0,blackjacks:blackjack?1:0,busts:0,doubles:0,splits:0,insuranceTaken:false,insuranceWon:false}})).session!;}
async function seat(id:string){const allocated=(await store.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'allocate',sessionId:crypto.randomUUID(),roomId:crypto.randomUUID(),gameId:'blackjack',funding:'account',amountUnits:100000})).session!;return(await store.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'activate',sessionId:allocated.sessionId,expectedVersion:allocated.version})).session!;}
it('claims 1,000 chips once per 24 hours and preserves cooldown on reinstall',async()=>{
  const id=await account();const before=await store.getWallet(id);
  expect(allowanceSchema.parse(await rpc(id,'usual_table_allowance'))).toMatchObject({canClaim:true,claimed:false,amountUnits:100000});
  const claimed=allowanceSchema.parse(await rpc(id,'usual_table_claim_allowance'));expect(claimed.claimed).toBe(true);
  expect(claimed.nextEligibleAt!-claimed.serverNow).toBeGreaterThan(86399000);expect(claimed.wallet?.availableUnits).toBe(before.availableUnits+100000);
  expect(allowanceSchema.parse(await rpc(id,'usual_table_claim_allowance')).claimed).toBe(false);
  await db.exec(setup);expect(allowanceSchema.parse(await rpc(id,'usual_table_claim_allowance')).claimed).toBe(false);
  expect((await store.getWallet(id)).availableUnits).toBe(before.availableUnits+100000);
  await expect(db.exec("UPDATE wallet_private.progression_policy SET starts_at=clock_timestamp() WHERE version='progress-v1'")).rejects.toThrow('append-only');
  await expect(db.exec("UPDATE wallet_private.achievement_definitions SET target=999 WHERE id='blackjack:first-round'")).rejects.toThrow('append-only');
});
it('allows the next daily claim after the stored eligibility time expires',async()=>{
  const id=await account();const timed=new PostgresWalletStore(db,{daily:{version:'test-clock',amountUnits:100000,cooldownMs:1}});
  await timed.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'claim_grant',source:'daily'});
  await db.query('SELECT pg_sleep(0.005)');
  const before=await store.getWallet(id);expect(allowanceSchema.parse(await rpc(id,'usual_table_allowance')).canClaim).toBe(true);
  const claimed=allowanceSchema.parse(await rpc(id,'usual_table_claim_allowance'));expect(claimed.claimed).toBe(true);expect(claimed.wallet?.availableUnits).toBe(before.availableUnits+100000);
  expect(allowanceSchema.parse(await rpc(id,'usual_table_claim_allowance')).claimed).toBe(false);
});
it('derives XP, per-game achievements and detailed facts only from settled rounds; claims once',async()=>{
  const id=await account();let session=await seat(id);
  expect(progressionSchema.parse(await rpc(id,'usual_table_progression'))).toMatchObject({xp:'0',level:1,readyRewardUnits:'0'});
  for(let i=0;i<10;i++)session=await round(session,2000,i===0);
  const progress=progressionSchema.parse(await rpc(id,'usual_table_progression'));
  expect(progress).toMatchObject({xp:'100',level:2,nextLevelXp:'300',readyRewardUnits:'145000'});
  const wallet=await store.getWallet(id);
  const claimed=progressionSchema.parse(await rpc(id,'usual_table_claim_rewards'));expect(claimed).toMatchObject({claimedUnits:145000,readyRewardUnits:'0',claimedLevel:2});
  expect((await store.getWallet(id)).availableUnits).toBe(wallet.availableUnits+145000);
  expect(progressionSchema.parse(await rpc(id,'usual_table_claim_rewards')).claimedUnits).toBe(0);
  const detailed=detailedStatisticsSchema.parse(await rpc(id,'usual_table_detailed_statistics'));
  expect(detailed.blackjack).toMatchObject({trackedRounds:'10',hands:'10',wins:'10',blackjacks:'1'});
  const replay=(await db.query<{request:Parameters<typeof store.execute>[0]}>("SELECT request FROM wallet_private.operations WHERE account_id=$1 AND request->>'kind'='settle' LIMIT 1",[id])).rows[0]!.request;
  await store.execute(replay);expect(progressionSchema.parse(await rpc(id,'usual_table_progression')).xp).toBe('100');
  for(let i=0;i<20;i++)session=await round(session,1000);
  expect(progressionSchema.parse(await rpc(id,'usual_table_progression'))).toMatchObject({xp:'300',level:3,nextLevelXp:'600',readyRewardUnits:'125000'});
  expect(progressionSchema.parse(await rpc(id,'usual_table_claim_rewards')).claimedUnits).toBe(125000);
  await db.exec(setup);expect(progressionSchema.parse(await rpc(id,'usual_table_progression'))).toMatchObject({xp:'300',readyRewardUnits:'0'});
  expect((await store.getWallet(id)).availableUnits).toBe(wallet.availableUnits+270000);
});
it('keeps accounts isolated, rejects suspended/deleted claims and rolls back failed reward ledger writes',async()=>{
  const id=await account();const other=await account();await round(await seat(id));
  expect(progressionSchema.parse(await rpc(other,'usual_table_progression')).xp).toBe('0');
  const before=await store.getWallet(id);
  await db.exec(`CREATE FUNCTION wallet_private.fail_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$;
    CREATE TRIGGER fail_reward BEFORE INSERT ON wallet_private.ledger FOR EACH ROW WHEN(NEW.kind='claim_reward') EXECUTE FUNCTION wallet_private.fail_reward();`);
  await expect(rpc(id,'usual_table_claim_rewards')).rejects.toThrow('test failure');
  expect(await store.getWallet(id)).toEqual(before);expect(progressionSchema.parse(await rpc(id,'usual_table_progression')).readyRewardUnits).toBe('20000');
  await db.exec('DROP TRIGGER fail_reward ON wallet_private.ledger; DROP FUNCTION wallet_private.fail_reward();');
  await store.setAccountStatus(id,'suspended');await expect(rpc(id,'usual_table_claim_rewards')).rejects.toThrow('Wallet paused');await expect(rpc(id,'usual_table_claim_allowance')).rejects.toThrow('Wallet paused');
  await db.query('DELETE FROM auth.users WHERE id=$1',[id]);await expect(rpc(id,'usual_table_progression')).rejects.toThrow('current social account');
});
it('preserves historical totals but starts XP and achievement eligibility at installation',async()=>{
  const legacy=await PGlite.create();try{
    await legacy.exec(supabaseAuthFixture);
    const boundary=setup.indexOf('CREATE TABLE IF NOT EXISTS wallet_private.progression_policy');expect(boundary).toBeGreaterThan(0);
    await legacy.exec(setup.slice(0,boundary)+'COMMIT;');
    const oldStore=new PostgresWalletStore(legacy,{welcome:{version:'test',amountUnits:100000}});const id=crypto.randomUUID();
    await legacy.query('INSERT INTO auth.users(id) VALUES($1)',[id]);await oldStore.createAccount(id);
    await oldStore.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'claim_grant',source:'welcome'});
    const allocated=(await oldStore.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'allocate',sessionId:crypto.randomUUID(),roomId:crypto.randomUUID(),gameId:'blackjack',funding:'account',amountUnits:20000})).session!;
    const active=(await oldStore.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'activate',sessionId:allocated.sessionId,expectedVersion:allocated.version})).session!;
    await oldStore.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'settle',sessionId:active.sessionId,expectedVersion:active.version,roomId:active.roomId,gameId:'blackjack',funding:'account',sequence:1,roundId:'1',rulesetVersion:'old',wageredUnits:1000,returnedUnits:2000});
    await legacy.exec(await readFile(new URL('../migrations/008_progression.sql',import.meta.url),'utf8'));
    await legacy.transaction(async tx=>{
      await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated',amr:[{method:'oauth'}]})]);await tx.exec('SET LOCAL ROLE authenticated');
      const progress=(await tx.query<{value:unknown}>('SELECT public.usual_table_progression() AS value')).rows[0]!.value;
      expect(progressionSchema.parse(progress)).toMatchObject({xp:'0',level:1,readyRewardUnits:'0'});
      const details=detailedStatisticsSchema.parse((await tx.query<{value:unknown}>('SELECT public.usual_table_detailed_statistics() AS value')).rows[0]!.value);
      expect(details.summary.games[0]?.roundsPlayed).toBe('1');expect(details.blackjack.trackedRounds).toBe('0');
    });
  }finally{await legacy.close();}
});
