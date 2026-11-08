import { PGlite } from '@electric-sql/pglite';
import { beforeAll,afterAll,it,expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { accountProfileSchema,publicAccountProfileSchema } from '@casual/protocol';
import { supabaseAuthFixture } from './supabaseFixture';
let db:PGlite;let setup:string;
beforeAll(async()=>{db=await PGlite.create();await db.exec(supabaseAuthFixture);setup=await readFile(new URL('../../../supabase/wallet-setup.sql',import.meta.url),'utf8');await db.exec(setup);},30000);
afterAll(async()=>{await db?.close();});
async function user(){const id=crypto.randomUUID();await db.query('INSERT INTO auth.users(id) VALUES($1)',[id]);return id;}
async function own(id:string,input?:unknown){return db.transaction(async tx=>{
  await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated',amr:[{method:'oauth'}]})]);await tx.exec('SET LOCAL ROLE authenticated');
  return (await tx.query<{p:unknown}>(input===undefined?'SELECT public.usual_table_profile() p':'SELECT public.usual_table_save_profile($1::jsonb) p',input===undefined?[]:[JSON.stringify(input)])).rows[0]!.p;
});}
async function publicProfile(id:string,role='usual_table_wallet_backend'){return db.transaction(async tx=>{await tx.exec(`SET LOCAL ROLE ${role}`);return(await tx.query<{p:unknown}>('SELECT wallet_private.room_player_profile($1::uuid) p',[id])).rows[0]!.p;});}
const draft={nickname:'Same name',appearance:{avatar:{kind:'illustration',id:'fox'},border:'brass'},visibility:{chips:true,statistics:true,achievements:true}};
it('saves atomically by immutable owner, allows duplicate names and rejects stale versions',async()=>{
  const a=await user(),b=await user();expect(accountProfileSchema.parse(await own(a))).toMatchObject({accountId:a,version:0,nickname:null});
  const saved=accountProfileSchema.parse(await own(a,{...draft,version:0}));expect(saved).toMatchObject({...draft,version:1,accountId:a});
  expect(accountProfileSchema.parse(await own(b,{...draft,version:0}))).toMatchObject({...draft,accountId:b});
  await expect(own(a,{...draft,nickname:'Stale',version:0})).rejects.toThrow(/changed/);
  expect(accountProfileSchema.parse(await own(a))).toEqual(saved);
  await db.exec(setup);expect(accountProfileSchema.parse(await own(a))).toEqual(saved);
});
it('validates catalogues and sharing settings in the database and denies arbitrary owners and uploads',async()=>{
  const a=await user();
  for(const bad of [{...draft,accountId:crypto.randomUUID()},{...draft,appearance:{avatar:{kind:'photo',id:'https://image.test/me.png'},border:'brass'}},
    {...draft,appearance:{avatar:{kind:'illustration',id:'unowned'},border:'brass'}},{...draft,appearance:{avatar:{kind:'initials'},border:'made-up'}},{...draft,visibility:{chips:true}}])
    await expect(own(a,{...bad,version:0})).rejects.toThrow();
  await expect(publicProfile(a,'authenticated')).rejects.toThrow();await expect(publicProfile(a,'anon')).rejects.toThrow();
});
it('projects only shareable fields, with no account IDs, wallet internals or reward claim state',async()=>{
  const a=await user();await own(a,{...draft,version:0});
  const p=publicAccountProfileSchema.parse(await publicProfile(a));expect(p).toMatchObject({kind:'account',level:1,totalSavedChipUnits:null,appearance:draft.appearance});
  const json=JSON.stringify(p);expect(json).not.toContain(a);expect(json).not.toMatch(/accountId|claimed|readyReward|wallet|sessionId/);expect(p.statistics?.games).toEqual([]);
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM wallet_private.wallets WHERE account_id=$1',[a])).rows[0]!.n).toBe(0);
  await own(a,{...draft,version:1,visibility:{chips:false,statistics:false,achievements:false}});
  const hidden=publicAccountProfileSchema.parse(await publicProfile(a));expect(hidden.level).toBe(1);expect(hidden).not.toHaveProperty('totalSavedChipUnits');expect(hidden).not.toHaveProperty('statistics');expect(hidden).not.toHaveProperty('achievements');
});
it('restores caller claims after public projection and totals each wallet bucket once',async()=>{
  const a=await user();await own(a);
  await db.transaction(async tx=>{await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:a,role:'authenticated',amr:[{method:'oauth'}]})]);await tx.query('SELECT public.usual_table_ensure_wallet()');});
  expect(publicAccountProfileSchema.parse(await publicProfile(a)).totalSavedChipUnits).toBe('1000000');
  const claims='{"original":"caller"}';await db.query("SELECT set_config('request.jwt.claims',$1,false)",[claims]);await publicProfile(a);
  expect((await db.query<{v:string}>("SELECT current_setting('request.jwt.claims') v")).rows[0]!.v).toBe(claims);
});
