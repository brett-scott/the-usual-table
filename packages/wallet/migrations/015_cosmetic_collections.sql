BEGIN;
CREATE TABLE IF NOT EXISTS wallet_private.cosmetic_definitions (
 category text NOT NULL CHECK(category IN ('theme','artwork','back','border')), id text NOT NULL,
 unlock_rule text NOT NULL CHECK(unlock_rule IN ('included','level-3','level-5','first-win','blackjack-25')),
 PRIMARY KEY(category,id)
);
INSERT INTO wallet_private.cosmetic_definitions(category,id,unlock_rule) VALUES
 ('theme','classic','included'),('theme','midnight','included'),('theme','moonlit','level-5'),('theme','rosewood','first-win'),('theme','jade','blackjack-25'),
 ('artwork','ivory','included'),('artwork','porcelain','level-3'),('artwork','letterpress','blackjack-25'),
 ('back','traditional','included'),('back','geometric','included'),('back','moonphase','level-5'),('back','deco','first-win'),('back','botanical','blackjack-25'),
 ('border','none','included'),('border','sage','included'),('border','brass','included'),('border','midnight','included'),('border','copper','included'),('border','royal','included'),('border','orbit','included'),
 ('border','moonstone','level-5'),('border','garden-edge','blackjack-25'),('border','club-glint','first-win'),('border','lunar-orbit','level-5'),('border','soft-halo','level-3')
 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS wallet_private.cosmetic_entitlements (
 account_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, category text NOT NULL,id text NOT NULL,
 source text NOT NULL,earned_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,category,id),
 FOREIGN KEY(category,id) REFERENCES wallet_private.cosmetic_definitions(category,id)
);
CREATE TABLE IF NOT EXISTS wallet_private.cosmetic_preferences (
 account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 theme text NOT NULL DEFAULT 'classic',artwork text NOT NULL DEFAULT 'ivory',back text NOT NULL DEFAULT 'traditional'
);
ALTER TABLE wallet_private.cosmetic_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.cosmetic_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.cosmetic_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_private.cosmetic_definitions,wallet_private.cosmetic_entitlements,wallet_private.cosmetic_preferences FROM PUBLIC,anon,authenticated;

-- Version 2 keeps the original profile shape while negotiating the extended border catalogue.
CREATE OR REPLACE FUNCTION public.usual_table_profile_v2()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); metadata jsonb;p wallet_private.player_profiles;
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
-- Legacy RPC and room projection always return an existing static border ID.
CREATE OR REPLACE FUNCTION public.usual_table_profile()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb:=public.usual_table_profile_v2();
BEGIN
 IF result->'appearance'->>'border' NOT IN ('none','sage','brass','midnight','copper','royal','orbit') THEN
  result:=jsonb_set(result,'{appearance,border}','"brass"');
 END IF;RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION wallet_private.refresh_cosmetics()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id();progress jsonb:=public.usual_table_progression();won boolean;regular boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM wallet_private.results r WHERE r.account_id=account AND r.returned_units>r.wagered_units
 AND r.created_at>=to_timestamp((progress->>'startsAt')::numeric/1000)) INTO won;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(progress->'achievements') a WHERE a->>'id'='blackjack:25-rounds' AND (a->>'unlocked')::boolean) INTO regular;
 INSERT INTO wallet_private.cosmetic_entitlements(account_id,category,id,source)
 SELECT account,d.category,d.id,d.unlock_rule FROM wallet_private.cosmetic_definitions d WHERE
 (d.unlock_rule='level-3' AND (progress->>'level')::integer>=3) OR (d.unlock_rule='level-5' AND (progress->>'level')::integer>=5)
 OR (d.unlock_rule='first-win' AND won) OR (d.unlock_rule='blackjack-25' AND regular)
 ON CONFLICT DO NOTHING;
END; $$;
CREATE OR REPLACE FUNCTION public.usual_table_collection()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id();profile jsonb;prefs wallet_private.cosmetic_preferences;owned jsonb;
BEGIN
 PERFORM public.usual_table_profile_v2();
 -- Equip locks this same row before changing either profile or card/table settings.
 PERFORM 1 FROM wallet_private.player_profiles WHERE account_id=account FOR SHARE;
 profile:=public.usual_table_profile_v2();
 PERFORM wallet_private.refresh_cosmetics();
 INSERT INTO wallet_private.cosmetic_preferences(account_id) VALUES(account) ON CONFLICT DO NOTHING;
 SELECT * INTO prefs FROM wallet_private.cosmetic_preferences WHERE account_id=account;
 SELECT jsonb_agg(d.category||':'||d.id ORDER BY d.category,d.id) INTO owned FROM wallet_private.cosmetic_definitions d
 WHERE d.unlock_rule='included' OR EXISTS(SELECT 1 FROM wallet_private.cosmetic_entitlements e WHERE e.account_id=account AND e.category=d.category AND e.id=d.id);
 RETURN jsonb_build_object('contract',1,'accountId',account,'profile',profile,'owned',owned,'selection',jsonb_build_object('theme',prefs.theme,'artwork',prefs.artwork,'back',prefs.back,'border',profile->'appearance'->>'border'));
END; $$;
CREATE OR REPLACE FUNCTION public.usual_table_equip_cosmetic(input jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id();chosen_category text:=input->>'category';item text:=input->>'id';p wallet_private.player_profiles;
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['category','id','version']<>'{}'::jsonb
 OR jsonb_typeof(input->'category') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'id') IS DISTINCT FROM 'string'
 OR coalesce(input->>'version','')!~'^(0|[1-9][0-9]{0,14})$'
 OR NOT EXISTS(SELECT 1 FROM wallet_private.cosmetic_definitions d WHERE d.category=chosen_category AND d.id=item)
 THEN RAISE EXCEPTION 'Invalid collection choice' USING ERRCODE='22023';END IF;
 PERFORM public.usual_table_profile_v2();
 SELECT * INTO p FROM wallet_private.player_profiles WHERE account_id=account FOR UPDATE;
 IF p.version<>(input->>'version')::bigint THEN RAISE EXCEPTION 'Profile changed; reload before saving' USING ERRCODE='40001';END IF;
 PERFORM wallet_private.refresh_cosmetics();
 IF NOT EXISTS(SELECT 1 FROM wallet_private.cosmetic_definitions d WHERE d.category=chosen_category AND d.id=item AND
 (d.unlock_rule='included' OR EXISTS(SELECT 1 FROM wallet_private.cosmetic_entitlements e WHERE e.account_id=account AND e.category=d.category AND e.id=d.id)))
 THEN RAISE EXCEPTION 'Earn this cosmetic before equipping it' USING ERRCODE='42501';END IF;
 INSERT INTO wallet_private.cosmetic_preferences(account_id) VALUES(account) ON CONFLICT DO NOTHING;
 IF chosen_category='border' THEN UPDATE wallet_private.player_profiles SET appearance=jsonb_set(appearance,'{border}',to_jsonb(item)) WHERE account_id=account;
 ELSIF chosen_category='theme' THEN UPDATE wallet_private.cosmetic_preferences SET theme=item WHERE account_id=account;
 ELSIF chosen_category='artwork' THEN UPDATE wallet_private.cosmetic_preferences SET artwork=item WHERE account_id=account;
 ELSE UPDATE wallet_private.cosmetic_preferences SET back=item WHERE account_id=account;END IF;
 UPDATE wallet_private.player_profiles SET version=version+1 WHERE account_id=account;
 RETURN public.usual_table_collection();
END; $$;
CREATE OR REPLACE FUNCTION public.usual_table_save_profile_v2(input jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id();p wallet_private.player_profiles;chosen text:=input->'appearance'->>'border';
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['nickname','appearance','visibility','version']<>'{}'::jsonb
 OR jsonb_typeof(input->'nickname') IS DISTINCT FROM 'string' OR length(btrim(input->>'nickname')) NOT BETWEEN 1 AND 24
 OR NOT wallet_private.valid_profile_appearance(jsonb_set(input->'appearance','{border}','"none"'))
 OR NOT EXISTS(SELECT 1 FROM wallet_private.cosmetic_definitions d WHERE d.category='border' AND d.id=chosen)
 OR jsonb_typeof(input->'visibility') IS DISTINCT FROM 'object' OR (input->'visibility')-ARRAY['chips','statistics','achievements']<>'{}'::jsonb
 OR jsonb_typeof(input->'visibility'->'chips') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'visibility'->'statistics') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(input->'visibility'->'achievements') IS DISTINCT FROM 'boolean' OR coalesce(input->>'version','')!~'^(0|[1-9][0-9]{0,14})$'
 THEN RAISE EXCEPTION 'Invalid profile selection' USING ERRCODE='22023';END IF;
 PERFORM public.usual_table_profile_v2();
 SELECT * INTO p FROM wallet_private.player_profiles WHERE account_id=account FOR UPDATE;
 IF p.version<>(input->>'version')::bigint THEN RAISE EXCEPTION 'Profile changed; reload before saving' USING ERRCODE='40001';END IF;
 PERFORM wallet_private.refresh_cosmetics();
 IF NOT EXISTS(SELECT 1 FROM wallet_private.cosmetic_definitions d WHERE d.category='border' AND d.id=chosen AND
 (d.unlock_rule='included' OR EXISTS(SELECT 1 FROM wallet_private.cosmetic_entitlements e WHERE e.account_id=account AND e.category=d.category AND e.id=d.id)))
 THEN RAISE EXCEPTION 'Earn this border before equipping it' USING ERRCODE='42501';END IF;
 UPDATE wallet_private.player_profiles SET nickname=btrim(input->>'nickname'),appearance=input->'appearance',visibility=input->'visibility',version=version+1 WHERE account_id=account;
 RETURN public.usual_table_profile_v2();
END; $$;
CREATE OR REPLACE FUNCTION wallet_private.room_player_profile_v2(target uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb:=wallet_private.room_player_profile(target);appearance jsonb;
BEGIN
 SELECT p.appearance INTO appearance FROM wallet_private.player_profiles p WHERE p.account_id=target;
 RETURN jsonb_set(result,'{appearance}',appearance);
END; $$;
REVOKE ALL ON FUNCTION wallet_private.refresh_cosmetics(),wallet_private.room_player_profile_v2(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.usual_table_profile_v2(),public.usual_table_save_profile_v2(jsonb),public.usual_table_collection(),public.usual_table_equip_cosmetic(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_profile_v2(),public.usual_table_save_profile_v2(jsonb),public.usual_table_collection(),public.usual_table_equip_cosmetic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_private.room_player_profile_v2(uuid) TO usual_table_wallet_backend;
NOTIFY pgrst,'reload schema';
COMMIT;
