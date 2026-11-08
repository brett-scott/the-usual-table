import { Pool } from 'pg';
import { GameError } from '@casual/engine';
import { accountProfileSchema, publicAccountProfileSchema, PUBLIC_SUPABASE_CONFIG, publicAuthConfigSchema,collectionSchema } from '@casual/protocol';
import { postgresPoolCloser } from '@casual/wallet/postgres';
import type { Env } from './env';

export async function accountProfile(request:Request,env:Env,input?:unknown,modern=false){
  return accountRpc(request,env,`${input===undefined?'usual_table_profile':'usual_table_save_profile'}${modern?'_v2':''}`,input,accountProfileSchema);
}
export async function accountCollection(request:Request,env:Env,input?:unknown){
  return accountRpc(request,env,input===undefined?'usual_table_collection':'usual_table_equip_cosmetic',input,collectionSchema);
}
async function accountRpc<T>(request:Request,env:Env,rpc:string,input:unknown,schema:import('zod').z.ZodType<T>):Promise<T>{
  const parsed=publicAuthConfigSchema.safeParse({url:env.SUPABASE_URL??PUBLIC_SUPABASE_CONFIG.url,publishableKey:env.SUPABASE_PUBLISHABLE_KEY??(!env.SUPABASE_URL||env.SUPABASE_URL===PUBLIC_SUPABASE_CONFIG.url?PUBLIC_SUPABASE_CONFIG.publishableKey:'')});
  if(!parsed.success)throw new GameError('PROFILE_UNAVAILABLE','Account profiles are not configured for this project yet.');
  const config=parsed.data;
  try{
    const response=await fetch(`${config.url}/rest/v1/rpc/${rpc}`,{
      method:'POST',headers:{apikey:config.publishableKey,Authorization:request.headers.get('Authorization')!,'Content-Type':'application/json'},
      body:JSON.stringify(input===undefined?{}:{input}),redirect:'manual',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(5000)])});
    const data:unknown=await response.json();
    if(!response.ok){const code=data&&typeof data==='object'&&'code'in data?String(data.code):'';
      if(code==='40001')throw new GameError('PROFILE_CONFLICT','Your profile changed on another device. Reload the latest profile before saving.');
      if(code==='42501'&&input!==undefined)throw new GameError('COSMETIC_LOCKED','Earn this cosmetic before equipping it.');
      throw new Error('Profile unavailable');}
    return schema.parse(data);
  }catch(error){if(error instanceof GameError)throw error;throw new GameError('PROFILE_UNAVAILABLE','Your profile could not be loaded or saved. Please try again.');}
}
export async function roomAccountProfile(env:Env,id:string,modern=false){
  if(!env.WALLET_DB)throw new GameError('PROFILE_UNAVAILABLE','Player profiles are not connected yet.');
  const pool=new Pool({connectionString:env.WALLET_DB.connectionString,max:1,connectionTimeoutMillis:2000,query_timeout:4000});
  const close=postgresPoolCloser(pool);
  try{
    const client=await pool.connect();
    try{
      // A transaction bypasses shared query caching and gives every projection one consistent snapshot.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      const result=await client.query<{profile:unknown}>(`SELECT wallet_private.room_player_profile${modern?'_v2':''}($1::uuid) AS profile`,[id]);
      const profile=publicAccountProfileSchema.parse(result.rows[0]?.profile);
      await client.query('COMMIT');return profile;
    }catch(error){try{await client.query('ROLLBACK');}catch{/* The original read failed. */}throw error;}
    finally{client.release();}
  }catch{throw new GameError('PROFILE_UNAVAILABLE','This player’s profile is unavailable. Please try again.');}
  finally{await close();}
}
