import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {COSMETICS,collectionSchema,accountProfileSchema,type WalletSession} from '@casual/protocol';
import {PostgresWalletStore} from './index';
import {supabaseAuthFixture} from './supabaseFixture';
let db:PGlite;let setup:string;let store:PostgresWalletStore;
beforeAll(async()=>{db=await PGlite.create();await db.exec(supabaseAuthFixture);setup=await readFile(new URL('../../../supabase/wallet-setup.sql',import.meta.url),'utf8');await db.exec(setup);store=new PostgresWalletStore(db);},30000);
afterAll(async()=>{await db?.close();});
async function rpc(id:string,name:string,input?:unknown){return db.transaction(async tx=>{await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated',amr:[{method:'oauth'}]})]);await tx.exec('SET LOCAL ROLE authenticated');return(await tx.query<{v:unknown}>(`SELECT public.${name}(${input===undefined?'':'$1::jsonb'}) v`,input===undefined?[]:[JSON.stringify(input)])).rows[0]!.v;});}
async function user(){const id=crypto.randomUUID();await db.query('INSERT INTO auth.users(id) VALUES($1)',[id]);return id;}
const read=async(id:string)=>collectionSchema.parse(await rpc(id,'usual_table_collection'));
async function seat(id:string){await rpc(id,'usual_table_ensure_wallet');const allocated=(await store.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'allocate',sessionId:crypto.randomUUID(),roomId:crypto.randomUUID(),gameId:'blackjack',funding:'account',amountUnits:100000})).session!;return(await store.execute({contract:1,accountId:id,operationId:crypto.randomUUID(),kind:'activate',sessionId:allocated.sessionId,expectedVersion:allocated.version})).session!;}
async function round(s:WalletSession,win=false){return(await store.execute({contract:1,accountId:s.accountId,operationId:crypto.randomUUID(),kind:'settle',sessionId:s.sessionId,expectedVersion:s.version,roomId:s.roomId,gameId:'blackjack',funding:'account',sequence:s.resultSequence+1,roundId:String(s.resultSequence+1),rulesetVersion:'test',wageredUnits:1000,returnedUnits:win?2000:1000,blackjack:{hands:1,wins:win?1:0,losses:0,pushes:win?0:1,blackjacks:0,busts:0,doubles:0,splits:0,insuranceTaken:false,insuranceWon:false}})).session!;}
it('keeps the bundled and database catalogues aligned, preserves all free options and grants no wallet for browsing',async()=>{
 const id=await user();const c=await read(id);expect(c.selection).toEqual({theme:'classic',artwork:'ivory',back:'traditional',border:'none'});expect(c.owned.sort()).toEqual(COSMETICS.filter(c=>c.free).map(c=>`${c.category}:${c.id}`).sort());
 expect((await db.query<{k:string}>('SELECT category||\':\'||id k FROM wallet_private.cosmetic_definitions')).rows.map(r=>r.k).sort()).toEqual(COSMETICS.map(c=>`${c.category}:${c.id}`).sort());
 expect((await db.query('SELECT * FROM wallet_private.wallets WHERE account_id=$1',[id])).rows).toHaveLength(0);
});
it('enforces server ownership and versions; rejects injected IDs and direct table access',async()=>{
 const id=await user();for(const input of [{category:'theme',id:'moonlit',version:0},{category:'border',id:'club-glint',version:0}])await expect(rpc(id,'usual_table_equip_cosmetic',input)).rejects.toThrow(/Earn/);
 for(const input of [{category:'theme',id:'classic',version:0,accountId:crypto.randomUUID()},{category:'theme',id:'made-up',version:0},{category:'theme',id:'classic',version:-1}])await expect(rpc(id,'usual_table_equip_cosmetic',input)).rejects.toThrow(/Invalid/);
 const c=await read(id);expect(c.profile.version).toBe(0);
 await expect(rpc(id,'usual_table_save_profile_v2',{nickname:'Alex',appearance:{avatar:{kind:'initials'},border:'soft-halo'},visibility:{chips:true,statistics:true,achievements:true},version:0})).rejects.toThrow(/Earn/);
 await db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE authenticated');await expect(tx.query('SELECT * FROM wallet_private.cosmetic_entitlements')).rejects.toThrow(/permission/);});
});
it('recognises existing settled wins independently of reward claims, equips atomically and projects legacy fallbacks',async()=>{
 const id=await user();await round(await seat(id),true);const before=await store.getWallet(id);let c=await read(id);
 expect(c.owned).toContain('border:club-glint');expect(c.owned).toContain('theme:rosewood');expect(c.owned).not.toContain('theme:moonlit');
 c=collectionSchema.parse(await rpc(id,'usual_table_equip_cosmetic',{category:'border',id:'club-glint',version:c.profile.version}));expect(c.profile.appearance.border).toBe('club-glint');
 expect(accountProfileSchema.parse(await rpc(id,'usual_table_profile')).appearance.border).toBe('brass');
 expect(accountProfileSchema.parse(await rpc(id,'usual_table_profile_v2')).appearance.border).toBe('club-glint');
 await expect(rpc(id,'usual_table_equip_cosmetic',{category:'theme',id:'rosewood',version:0})).rejects.toThrow(/changed/);
 const saved=accountProfileSchema.parse(await rpc(id,'usual_table_save_profile_v2',{nickname:'Alex',appearance:c.profile.appearance,visibility:c.profile.visibility,version:c.profile.version}));
 c=collectionSchema.parse(await rpc(id,'usual_table_equip_cosmetic',{category:'theme',id:'rosewood',version:saved.version}));expect(c.selection).toMatchObject({theme:'rosewood',border:'club-glint',back:'traditional'});
 expect(await store.getWallet(id)).toEqual(before);expect((await read(await user())).owned).not.toContain('border:club-glint');
 await db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE usual_table_wallet_backend');const old=(await tx.query<{v:{appearance:{border:string}}}>('SELECT wallet_private.room_player_profile($1) v',[id])).rows[0]!.v;const modern=(await tx.query<{v:{appearance:{border:string}}}>('SELECT wallet_private.room_player_profile_v2($1) v',[id])).rows[0]!.v;expect(old.appearance.border).toBe('brass');expect(modern.appearance.border).toBe('club-glint');});
 await db.exec(setup);expect((await read(id)).selection).toEqual(c.selection);expect((await read(id)).profile.version).toBe(c.profile.version);
});
it('unlocks the game and level milestones once, without paying chips or claiming progression rewards',async()=>{
 const id=await user();let session=await seat(id);
 for(let i=0;i<25;i++)session=await round(session);let c=await read(id);expect(c.owned).toContain('theme:jade');expect(c.owned).toContain('artwork:letterpress');expect(c.owned).not.toContain('artwork:porcelain');expect(c.owned).not.toContain('theme:rosewood');
 for(let i=25;i<30;i++)session=await round(session);c=await read(id);expect(c.owned).toContain('artwork:porcelain');expect(c.owned).toContain('border:soft-halo');expect(c.owned).not.toContain('theme:moonlit');
 for(let i=30;i<100;i++)session=await round(session);const wallet=await store.getWallet(id);c=await read(id);expect(c.owned).toContain('theme:moonlit');expect(c.owned).toContain('border:lunar-orbit');
 const count=(await db.query<{n:number}>('SELECT count(*)::int n FROM wallet_private.cosmetic_entitlements WHERE account_id=$1',[id])).rows[0]!.n;await read(id);expect((await db.query<{n:number}>('SELECT count(*)::int n FROM wallet_private.cosmetic_entitlements WHERE account_id=$1',[id])).rows[0]!.n).toBe(count);
 expect(await store.getWallet(id)).toEqual(wallet);expect((await db.query('SELECT * FROM wallet_private.achievement_claims WHERE account_id=$1',[id])).rows).toHaveLength(0);
},30000);
