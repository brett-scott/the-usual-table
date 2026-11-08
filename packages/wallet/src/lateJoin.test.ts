import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {progressionSchema,type GameId} from '@casual/protocol';
import {gameAdapters} from '../../../apps/server/src/games/registry';
import {newMember} from '../../../apps/server/src/roomMembership';
import {PostgresWalletStore} from './index';
import {supabaseAuthFixture} from './supabaseFixture';

let db:PGlite;let store:PostgresWalletStore;
beforeAll(async()=>{db=await PGlite.create();await db.exec(supabaseAuthFixture);await db.exec(await readFile(new URL('../../../supabase/wallet-setup.sql',import.meta.url),'utf8'));store=new PostgresWalletStore(db);},30000);
afterAll(async()=>{await db?.close();});
async function rpc(accountId:string,name:string){return db.transaction(async tx=>{await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:accountId,role:'authenticated',amr:[{method:'oauth'}]})]);await tx.exec('SET LOCAL ROLE authenticated');return(await tx.query<{value:unknown}>(`SELECT public.${name}() AS value`)).rows[0]!.value;});}
type View={roundId:number;revision:number;phase:string;players:{id:string;balanceUnits:number;returnedUnits:number}[]};
const cases:{gameId:GameId;action:unknown}[]=[
 {gameId:'crash',action:{type:'PlaceBet',amountUnits:1000,autoCashoutCents:150}},
 {gameId:'baccarat',action:{type:'PlaceBet',wager:{mainSide:'banker',mainUnits:1000,tieUnits:0}}},
 {gameId:'duck-race',action:{type:'PlaceBet',wager:{duckIndex:0,amountUnits:1000}}},
 {gameId:'roulette',action:{type:'PlaceBet',wager:[{betId:'straight-0',amountUnits:1000}]}},
 {gameId:'keno',action:{type:'PlaceBet',wager:{numbers:[1],amountUnits:1000}}},
];
for(const {gameId,action} of cases)it(`${gameId} settles a saved player's first round when joining after betting opens`,async()=>{
 const now=Date.now(),accountId=crypto.randomUUID(),adapter=gameAdapters.available(gameId);await db.query('INSERT INTO auth.users(id) VALUES($1)',[accountId]);await rpc(accountId,'usual_table_ensure_wallet');
 let room=adapter.create({roomId:crypto.randomUUID().replaceAll('-',''),player:{id:'host',name:'Host',seat:0},credentialHash:'a'.repeat(64),now,random:n=>n-1});
 const view=(id='saved')=>adapter.snapshot(room,id) as View;
 const move=(playerId:string,action:unknown,time:number)=>{const s=view(playerId);room=adapter.apply(room,adapter.parseCommand({id:crypto.randomUUID(),playerId,revision:s.revision,roundId:s.roundId,action}),()=>0,time);};
 move('host',{type:'StartBetting'},now);adapter.join(room,{id:'saved',name:'Late joiner',seat:1});room.members.saved=newMember('b'.repeat(64),now+1);room.members.saved.account={id:accountId,expiresAt:now+3600000};
 const sessionId=crypto.randomUUID();room=adapter.fund(room,'saved',accountId,100000,sessionId);
 const persist=async()=>{adapter.collectSeats(room,now+2);adapter.restore(structuredClone(room),now+2);};await persist();await adapter.flushWallet(room,store,persist);room=adapter.restore(structuredClone(room),now+2).room;
 move('saved',action,now+3);room=adapter.expire(room,()=>0,now+35000);expect(view().phase).toBe('results');const player=view().players.find(p=>p.id==='saved')!;const expected=99000+player.returnedUnits;expect(player.balanceUnits).toBe(expected);await persist();await adapter.flushWallet(room,store,persist);
 expect(await store.getSession(accountId,sessionId)).toMatchObject({stackUnits:expected,resultSequence:1});expect(progressionSchema.parse(await rpc(accountId,'usual_table_progression')).xp).toBe('10');
 room=adapter.expire(room,()=>0,now+35000);await adapter.flushWallet(room,store,persist);expect((await store.getSession(accountId,sessionId)).resultSequence).toBe(1);
 move('saved',{type:'Leave'},now+35001);await persist();await adapter.flushWallet(room,store,persist);expect(await store.getWallet(accountId)).toMatchObject({availableUnits:900000+expected,atTablesUnits:0});
});
