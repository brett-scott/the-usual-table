BEGIN;
-- Account-owned display settings; names deliberately have no uniqueness constraint.
CREATE TABLE IF NOT EXISTS wallet_private.player_profiles (
  account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname text CHECK(nickname IS NULL OR length(btrim(nickname)) BETWEEN 1 AND 24),
  appearance jsonb NOT NULL DEFAULT '{"avatar":{"kind":"initials"},"border":"none"}',
  visibility jsonb NOT NULL DEFAULT '{"chips":true,"statistics":true,"achievements":true}',
  version bigint NOT NULL DEFAULT 0 CHECK(version>=0)
);
ALTER TABLE wallet_private.player_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_private.player_profiles FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION wallet_private.valid_profile_appearance(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(value)='object' AND value-ARRAY['avatar','border']='{}'::jsonb
 AND value->>'border' IN ('none','sage','brass','midnight','copper','royal','orbit')
 AND jsonb_typeof(value->'avatar')='object' AND CASE value->'avatar'->>'kind'
 WHEN 'initials' THEN value->'avatar'='{"kind":"initials"}'::jsonb
 WHEN 'illustration' THEN (value->'avatar')-ARRAY['kind','id']='{}'::jsonb AND value->'avatar'->>'id' IN ('fox','owl','panda','robot','cat','penguin','moon','club')
 WHEN 'emoji' THEN (value->'avatar')-ARRAY['kind','id']='{}'::jsonb AND value->'avatar'->>'id' IN ('😎','🦊','🐱','🐶','🐼','🐸','🦁','🦉','🦄','🐙','🤖','👽','🎩','🍀','🔥','⭐')
 ELSE false END,false)
$$;
CREATE OR REPLACE FUNCTION public.usual_table_profile()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); metadata jsonb; p wallet_private.player_profiles;
BEGIN
  SELECT to_jsonb(u)->'raw_user_meta_data' INTO metadata FROM auth.users u WHERE id=account;
  INSERT INTO wallet_private.player_profiles(account_id,nickname,appearance)
  VALUES(account,CASE WHEN length(btrim(metadata->>'usual_table_nickname')) BETWEEN 1 AND 24 THEN btrim(metadata->>'usual_table_nickname') END,
    CASE WHEN wallet_private.valid_profile_appearance(jsonb_build_object('avatar',jsonb_build_object('kind','emoji','id',metadata->>'usual_table_player_icon'),'border','none'))
    THEN jsonb_build_object('avatar',jsonb_build_object('kind','emoji','id',metadata->>'usual_table_player_icon'),'border','none') ELSE '{"avatar":{"kind":"initials"},"border":"none"}' END)
  ON CONFLICT DO NOTHING;
  SELECT * INTO p FROM wallet_private.player_profiles WHERE account_id=account;
  RETURN jsonb_build_object('contract',1,'accountId',account,'version',p.version,'nickname',p.nickname,'appearance',p.appearance,'visibility',p.visibility);
END; $$;
CREATE OR REPLACE FUNCTION public.usual_table_save_profile(input jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); p wallet_private.player_profiles;
BEGIN
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['nickname','appearance','visibility','version']<>'{}'::jsonb
    OR jsonb_typeof(input->'nickname') IS DISTINCT FROM 'string' OR length(btrim(input->>'nickname')) NOT BETWEEN 1 AND 24
    OR NOT wallet_private.valid_profile_appearance(input->'appearance')
    OR jsonb_typeof(input->'visibility') IS DISTINCT FROM 'object' OR (input->'visibility')-ARRAY['chips','statistics','achievements']<>'{}'::jsonb
    OR jsonb_typeof(input->'visibility'->'chips') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'visibility'->'statistics') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(input->'visibility'->'achievements') IS DISTINCT FROM 'boolean' OR coalesce(input->>'version','') !~ '^(0|[1-9][0-9]{0,14})$'
    THEN RAISE EXCEPTION 'Invalid profile selection' USING ERRCODE='22023'; END IF;
  PERFORM public.usual_table_profile();
  UPDATE wallet_private.player_profiles SET nickname=btrim(input->>'nickname'),appearance=input->'appearance',visibility=input->'visibility',version=version+1
    WHERE account_id=account AND version=(input->>'version')::bigint RETURNING * INTO p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile changed; reload before saving' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('contract',1,'accountId',account,'version',p.version,'nickname',p.nickname,'appearance',p.appearance,'visibility',p.visibility);
END; $$;
-- Only the trusted Worker database role can select a target. Browser RPCs cannot call this function.
-- Reuse authoritative game projections in one snapshot, restoring transaction-local claims before return.
CREATE OR REPLACE FUNCTION wallet_private.room_player_profile(target uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_claims text:=current_setting('request.jwt.claims',true); previous_sub text:=current_setting('request.jwt.claim.sub',true); previous_role text:=current_setting('request.jwt.claim.role',true);
  settings jsonb; progress jsonb; details jsonb; wallet jsonb; result jsonb; earned jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',target,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','oauth')))::text,true);
  PERFORM set_config('request.jwt.claim.sub',target::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  settings:=public.usual_table_profile();
  progress:=public.usual_table_progression();
  result:=jsonb_build_object('kind','account','appearance',settings->'appearance','version',settings->'version','visibility',settings->'visibility','level',progress->'level');
  IF (settings->'visibility'->>'chips')::boolean THEN
    wallet:=public.usual_table_wallet_summary();
    result:=result||jsonb_build_object('totalSavedChipUnits',CASE WHEN wallet IS NULL THEN NULL ELSE
      ((wallet->>'availableUnits')::numeric+(wallet->>'atTablesUnits')::numeric+(wallet->>'pendingReturnUnits')::numeric)::text END);
  END IF;
  IF (settings->'visibility'->>'statistics')::boolean THEN
    details:=public.usual_table_detailed_statistics_v5();
    result:=result||jsonb_build_object('statistics',(details-ARRAY['accountId','summary'])||jsonb_build_object('games',details->'summary'->'games'));
  END IF;
  IF (settings->'visibility'->>'achievements')::boolean THEN
    SELECT coalesce(jsonb_agg(a-'claimed'),'[]'::jsonb) INTO earned FROM jsonb_array_elements(progress->'achievements') a;
    result:=result||jsonb_build_object('achievements',earned);
  END IF;
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true); RAISE;
END; $$;
REVOKE ALL ON FUNCTION wallet_private.valid_profile_appearance(jsonb),wallet_private.room_player_profile(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.usual_table_profile(),public.usual_table_save_profile(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_profile(),public.usual_table_save_profile(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_private.room_player_profile(uuid) TO usual_table_wallet_backend;
NOTIFY pgrst,'reload schema';
COMMIT;
