BEGIN;
INSERT INTO wallet_private.progression_policy(version) VALUES('achievements-v2') ON CONFLICT DO NOTHING;
ALTER TABLE wallet_private.achievement_definitions DROP CONSTRAINT IF EXISTS achievement_definitions_metric_check;
ALTER TABLE wallet_private.achievement_definitions ADD CONSTRAINT achievement_definitions_metric_check CHECK(metric IN ('rounds','wins','blackjacks','cashouts','cashout-5x','tie-wins','straight-wins','keno-five','expanded-v1'));
INSERT INTO wallet_private.achievement_definitions VALUES
 ('blackjack:pair-paid','blackjack','Pair Paid','Win any Perfect Pairs bet.','expanded-v1',1,50000),
 ('blackjack:double-trouble','blackjack','Double Trouble','Win a hand after doubling down.','expanded-v1',1,150000),
 ('blackjack:split-decision','blackjack','Split Decision','Split, then win every resulting hand in that round.','expanded-v1',1,150000),
 ('blackjack:blackjack-collection','blackjack','Blackjack Collection','Be dealt 25 natural blackjacks in total.','expanded-v1',25,500000),
 ('blackjack:colour-coordinated','blackjack','Colour Coordinated','Win a mixed, coloured and perfect Perfect Pairs bet.','expanded-v1',3,500000),
 ('blackjack:perfect-match','blackjack','Perfect Match','Win the perfect category of Perfect Pairs 10 times.','expanded-v1',10,1000000),
 ('baccarat:both-sides','baccarat','Both Sides','Win a Player main bet and a Banker main bet.','expanded-v1',2,50000),
 ('baccarat:natural-nine','baccarat','Natural Nine','Win a main bet with a two-card natural nine.','expanded-v1',1,150000),
 ('baccarat:pair-collector','baccarat','Pair Collector','Win Player Pair and Banker Pair at least once each.','expanded-v1',2,150000),
 ('baccarat:super-six','baccarat','Super Six','Win the Super 6 side bet three times.','expanded-v1',3,500000),
 ('baccarat:double-pair','baccarat','Double Pair','Win both Pair side bets in the same round.','expanded-v1',1,500000),
 ('baccarat:complete-set','baccarat','Complete Set','Win each of the six betting types five times.','expanded-v1',30,1000000),
 ('crash:safe-landing','crash','Safe Landing','Cash out at 2x or higher.','expanded-v1',1,50000),
 ('crash:set-and-forget','crash','Set and Forget','Complete five automatic cash-outs at 2x or higher.','expanded-v1',5,150000),
 ('crash:hands-on','crash','Hands On','Complete 10 manual cash-outs at 2x or higher.','expanded-v1',10,150000),
 ('crash:double-figures','crash','Double Figures','Cash out at 10x or higher five times.','expanded-v1',5,500000),
 ('crash:stratosphere','crash','Stratosphere','Cash out at 25x or higher once.','expanded-v1',1,500000),
 ('crash:frequent-high-flyer','crash','Frequent High Flyer','Cash out at 5x or higher 25 times.','expanded-v1',25,1000000),
 ('duck-race:meet-the-flock','duck-race','Meet the Flock','Complete a race backing each of the four ducks.','expanded-v1',4,50000),
 ('duck-race:winning-flock','duck-race','Winning Flock','Win with each of the four ducks.','expanded-v1',4,150000),
 ('duck-race:loyal-supporter','duck-race','Loyal Supporter','Win 10 races backing the same duck.','expanded-v1',10,150000),
 ('duck-race:hat-trick','duck-race','Hat Trick','Win three consecutive wagered races in one table session.','expanded-v1',3,500000),
 ('duck-race:champion-flock','duck-race','Champion Flock','Win 10 races with each of the four ducks.','expanded-v1',40,500000),
 ('duck-race:race-veteran','duck-race','Race Veteran','Win 100 races in total.','expanded-v1',100,1000000),
 ('roulette:split-ticket','roulette','Split Ticket','Win a split bet in a profitable spin.','expanded-v1',1,50000),
 ('roulette:corner-pocket','roulette','Corner Pocket','Win a corner bet in three profitable spins.','expanded-v1',3,150000),
 ('roulette:inside-knowledge','roulette','Inside Knowledge','Win with a split, street, corner and six-line bet.','expanded-v1',4,150000),
 ('roulette:green-light','roulette','Green Light','Win on zero with a single straight-up bet.','expanded-v1',1,500000),
 ('roulette:around-the-wheel','roulette','Around the Wheel','Win single-number tickets on five different numbers.','expanded-v1',5,500000),
 ('roulette:sharpshooter','roulette','Sharpshooter','Win 10 single-number tickets.','expanded-v1',10,1000000),
 ('keno:try-a-trio','keno','Try a Trio','Complete a draw with exactly three selected numbers.','expanded-v1',1,50000),
 ('keno:ticket-explorer','keno','Ticket Explorer','Complete tickets using every pick count from 1 to 10.','expanded-v1',10,150000),
 ('keno:three-for-three','keno','Three for Three','Match all three numbers on a three-number ticket.','expanded-v1',1,150000),
 ('keno:lucky-six','keno','Lucky Six','Match at least six numbers on a ten-number ticket.','expanded-v1',1,500000),
 ('keno:pick-mix','keno','Pick Mix','Finish profitable tickets at five different pick counts.','expanded-v1',5,500000),
 ('keno:draw-specialist','keno','Draw Specialist','Finish 100 profitable Keno tickets.','expanded-v1',100,1000000)
 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS wallet_private.achievement_details (
 achievement_id text PRIMARY KEY REFERENCES wallet_private.achievement_definitions(id),
 difficulty text NOT NULL CHECK(difficulty IN ('Easy','Medium','Hard','Master')),new_facts boolean NOT NULL
);
ALTER TABLE wallet_private.achievement_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_private.achievement_details FROM PUBLIC,anon,authenticated;
INSERT INTO wallet_private.achievement_details VALUES
 ('blackjack:pair-paid','Easy',false),
 ('blackjack:double-trouble','Medium',true),
 ('blackjack:split-decision','Medium',false),
 ('blackjack:blackjack-collection','Hard',false),
 ('blackjack:colour-coordinated','Hard',false),
 ('blackjack:perfect-match','Master',false),
 ('baccarat:both-sides','Easy',false),
 ('baccarat:natural-nine','Medium',true),
 ('baccarat:pair-collector','Medium',false),
 ('baccarat:super-six','Hard',false),
 ('baccarat:double-pair','Hard',false),
 ('baccarat:complete-set','Master',false),
 ('crash:safe-landing','Easy',false),
 ('crash:set-and-forget','Medium',true),
 ('crash:hands-on','Medium',true),
 ('crash:double-figures','Hard',false),
 ('crash:stratosphere','Hard',false),
 ('crash:frequent-high-flyer','Master',false),
 ('duck-race:meet-the-flock','Easy',false),
 ('duck-race:winning-flock','Medium',false),
 ('duck-race:loyal-supporter','Medium',false),
 ('duck-race:hat-trick','Hard',false),
 ('duck-race:champion-flock','Hard',false),
 ('duck-race:race-veteran','Master',false),
 ('roulette:split-ticket','Easy',false),
 ('roulette:corner-pocket','Medium',false),
 ('roulette:inside-knowledge','Medium',false),
 ('roulette:green-light','Hard',false),
 ('roulette:around-the-wheel','Hard',false),
 ('roulette:sharpshooter','Master',false),
 ('keno:try-a-trio','Easy',false),
 ('keno:ticket-explorer','Medium',false),
 ('keno:three-for-three','Medium',false),
 ('keno:lucky-six','Hard',false),
 ('keno:pick-mix','Hard',false),
 ('keno:draw-specialist','Master',false)
 ON CONFLICT DO NOTHING;
DROP TRIGGER IF EXISTS immutable_achievement_details ON wallet_private.achievement_details;
CREATE TRIGGER immutable_achievement_details BEFORE UPDATE OR DELETE ON wallet_private.achievement_details FOR EACH ROW EXECUTE FUNCTION wallet_private.reject_history_mutation();
CREATE OR REPLACE FUNCTION wallet_private.achievement_measure(labels text[],counts bigint[],targets integer[])
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('progress',coalesce(sum(least(coalesce(counts[i],0),targets[i])),0)::text,'breakdown',
 coalesce(jsonb_agg(jsonb_build_object('label',labels[i],'current',coalesce(counts[i],0)::text,'target',targets[i]) ORDER BY i),'[]'::jsonb))
 FROM generate_subscripts(labels,1) i
$$;
CREATE OR REPLACE FUNCTION wallet_private.expanded_achievement_progress(account uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH policy AS (SELECT starts_at FROM wallet_private.progression_policy WHERE version='achievements-v2'),
 r AS MATERIALIZED (
  SELECT r.*,s.game_id,coalesce(r.facts,'{}'::jsonb) f,r.returned_units>r.wagered_units won
  FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
  WHERE r.account_id=account AND r.wagered_units>0 AND r.created_at>=greatest(
   (SELECT starts_at FROM wallet_private.progression_policy WHERE version='progress-v1'),
   CASE WHEN s.game_id='keno' THEN (SELECT starts_at FROM wallet_private.progression_policy WHERE version='keno-v1') END)
 ),
 bj AS (SELECT
  count(*) FILTER(WHERE f->'perfectPairs'->>'kind' IN ('mixed','coloured','perfect') AND (f->'perfectPairs'->>'wagerUnits')::bigint>0) paid,
  count(*) FILTER(WHERE (f->>'doubledHandsWon')::integer>0 AND created_at>=(SELECT starts_at FROM policy)) doubled,
  count(*) FILTER(WHERE (f->>'splits')::integer>=1 AND (f->>'wins')::integer=(f->>'hands')::integer) split,
  coalesce(sum((f->>'blackjacks')::integer),0)::bigint naturals,
  count(*) FILTER(WHERE f->'perfectPairs'->>'kind'='mixed' AND (f->'perfectPairs'->>'wagerUnits')::bigint>0) mixed,
  count(*) FILTER(WHERE f->'perfectPairs'->>'kind'='coloured' AND (f->'perfectPairs'->>'wagerUnits')::bigint>0) coloured,
  count(*) FILTER(WHERE f->'perfectPairs'->>'kind'='perfect' AND (f->'perfectPairs'->>'wagerUnits')::bigint>0) perfect
  FROM r WHERE game_id='blackjack'),
 blegs AS (SELECT leg FROM r CROSS JOIN LATERAL (VALUES
  ('Player',(f->>'mainUnits')::bigint>0 AND f->>'mainSide'='player' AND f->>'outcome'='player'),
  ('Banker',(f->>'mainUnits')::bigint>0 AND f->>'mainSide'='banker' AND f->>'outcome'='banker'),
  ('Tie',(f->>'tieUnits')::bigint>0 AND f->>'outcome'='tie'),
  ('Player Pair',(f->'sideBets'->>'playerPairUnits')::bigint>0 AND (f->>'playerPair')::boolean),
  ('Banker Pair',(f->'sideBets'->>'bankerPairUnits')::bigint>0 AND (f->>'bankerPair')::boolean),
  ('Super 6',(f->'sideBets'->>'superSixUnits')::bigint>0 AND f->>'outcome'='banker' AND f->>'bankerTotal'='6')
 ) legs(leg,won) WHERE game_id='baccarat' AND legs.won),
 bc AS (SELECT count(*) FILTER(WHERE leg='Player') player,count(*) FILTER(WHERE leg='Banker') banker,count(*) FILTER(WHERE leg='Tie') tie,
  count(*) FILTER(WHERE leg='Player Pair') player_pair,count(*) FILTER(WHERE leg='Banker Pair') banker_pair,count(*) FILTER(WHERE leg='Super 6') six FROM blegs),
 bx AS (SELECT count(*) FILTER(WHERE (f->>'mainUnits')::bigint>0 AND f->>'mainSide'=f->>'outcome'
   AND f->>'outcome' IN ('player','banker') AND f->'initialTotals'->>(f->>'outcome')='9' AND created_at>=(SELECT starts_at FROM policy)) natural,
  count(*) FILTER(WHERE (f->'sideBets'->>'playerPairUnits')::bigint>0 AND (f->'sideBets'->>'bankerPairUnits')::bigint>0 AND (f->>'playerPair')::boolean AND (f->>'bankerPair')::boolean) double_pair FROM r WHERE game_id='baccarat'),
 cr AS (SELECT count(*) FILTER(WHERE (f->>'cashedOut')::boolean AND (f->>'cashoutCents')::integer>=200) two,
  count(*) FILTER(WHERE (f->>'cashedOut')::boolean AND (f->>'cashoutCents')::integer>=200 AND f->>'cashoutMethod'='automatic' AND created_at>=(SELECT starts_at FROM policy)) automatic,
  count(*) FILTER(WHERE (f->>'cashedOut')::boolean AND (f->>'cashoutCents')::integer>=200 AND f->>'cashoutMethod'='manual' AND created_at>=(SELECT starts_at FROM policy)) manual,
  count(*) FILTER(WHERE (f->>'cashedOut')::boolean AND (f->>'cashoutCents')::integer>=1000) ten,
  count(*) FILTER(WHERE (f->>'cashedOut')::boolean AND (f->>'cashoutCents')::integer>=2500) high,
  count(*) FILTER(WHERE (f->>'cashedOut')::boolean AND (f->>'cashoutCents')::integer>=500) five FROM r WHERE game_id='crash'),
 dr AS (SELECT f->>'duckIndex' duck,count(*) played,count(*) FILTER(WHERE f->>'duckIndex'=f->>'winner') wins FROM r WHERE game_id='duck-race' AND f->>'duckIndex' IN ('0','1','2','3') GROUP BY f->>'duckIndex'),
 dw AS (SELECT won,session_id,sum(CASE WHEN won THEN 0 ELSE 1 END) OVER(PARTITION BY session_id ORDER BY sequence) block FROM r WHERE game_id='duck-race'),
 ds AS (SELECT count(*) n FROM dw WHERE won GROUP BY session_id,block),
 d AS (SELECT ARRAY(SELECT coalesce((SELECT played FROM dr WHERE duck=i::text),0) FROM generate_series(0,3) i) played,
  ARRAY(SELECT coalesce((SELECT wins FROM dr WHERE duck=i::text),0) FROM generate_series(0,3) i) wins,
  (SELECT count(*) FROM r WHERE game_id='duck-race' AND won) total,(SELECT coalesce(max(n),0) FROM ds) streak),
 rl AS (SELECT regexp_replace(b->>'betId','-[0-9].*$','') kind FROM r CROSS JOIN LATERAL jsonb_array_elements(coalesce(f->'bets','[]'::jsonb)) b
  WHERE game_id='roulette' AND won AND b->>'betId' ~ '^(split|street|corner|six-line)-'
  AND string_to_array(regexp_replace(b->>'betId','^(split|street|corner|six-line)-',''),'-') @> ARRAY[f->>'winner']),
 rk AS (SELECT count(*) FILTER(WHERE kind='split') split,count(*) FILTER(WHERE kind='street') street,count(*) FILTER(WHERE kind='corner') corner,count(*) FILTER(WHERE kind='six-line') six FROM rl),
 rc AS (SELECT count(*) FILTER(WHERE winning) singles,count(DISTINCT f->>'winner') FILTER(WHERE winning) numbers,
 count(*) FILTER(WHERE winning AND f->>'winner'='0') zero FROM (SELECT f,jsonb_array_length(coalesce(f->'bets','[]'::jsonb))=1 AND f->'bets'->0->>'betId'='straight-'||(f->>'winner') winning FROM r WHERE game_id='roulette') a),
 kr AS (SELECT *,jsonb_array_length(coalesce(f->'numbers','[]'::jsonb)) picks,wallet_private.keno_matches(f->'numbers',f->'draw') hits FROM r WHERE game_id='keno'),
 k AS (SELECT count(*) FILTER(WHERE picks=3) trio,count(DISTINCT picks) FILTER(WHERE picks BETWEEN 1 AND 10) variety,
 count(*) FILTER(WHERE picks=3 AND hits=3) all_three,count(*) FILTER(WHERE picks=10 AND hits>=6) six,
 count(DISTINCT picks) FILTER(WHERE won AND picks BETWEEN 1 AND 10) winning_variety,count(*) FILTER(WHERE won) wins FROM kr)
 SELECT jsonb_object_agg(id,measure) FROM bj,bc,bx,cr,d,rk,rc,k CROSS JOIN LATERAL (VALUES
 ('blackjack:pair-paid',wallet_private.achievement_measure(ARRAY['Pair wins'],ARRAY[bj.paid]::bigint[],ARRAY[1])),
 ('blackjack:double-trouble',wallet_private.achievement_measure(ARRAY['Doubled hands won'],ARRAY[bj.doubled]::bigint[],ARRAY[1])),
 ('blackjack:split-decision',wallet_private.achievement_measure(ARRAY['All split hands won'],ARRAY[bj.split]::bigint[],ARRAY[1])),
 ('blackjack:blackjack-collection',wallet_private.achievement_measure(ARRAY['Natural blackjacks'],ARRAY[bj.naturals]::bigint[],ARRAY[25])),
 ('blackjack:colour-coordinated',wallet_private.achievement_measure(ARRAY['Mixed','Coloured','Perfect'],ARRAY[bj.mixed,bj.coloured,bj.perfect]::bigint[],ARRAY[1,1,1])),
 ('blackjack:perfect-match',wallet_private.achievement_measure(ARRAY['Perfect pair wins'],ARRAY[bj.perfect]::bigint[],ARRAY[10])),
 ('baccarat:both-sides',wallet_private.achievement_measure(ARRAY['Player','Banker'],ARRAY[bc.player,bc.banker]::bigint[],ARRAY[1,1])),
 ('baccarat:natural-nine',wallet_private.achievement_measure(ARRAY['Winning natural nines'],ARRAY[bx.natural]::bigint[],ARRAY[1])),
 ('baccarat:pair-collector',wallet_private.achievement_measure(ARRAY['Player Pair','Banker Pair'],ARRAY[bc.player_pair,bc.banker_pair]::bigint[],ARRAY[1,1])),
 ('baccarat:super-six',wallet_private.achievement_measure(ARRAY['Super 6 wins'],ARRAY[bc.six]::bigint[],ARRAY[3])),
 ('baccarat:double-pair',wallet_private.achievement_measure(ARRAY['Both Pair bets won'],ARRAY[bx.double_pair]::bigint[],ARRAY[1])),
 ('baccarat:complete-set',wallet_private.achievement_measure(ARRAY['Player','Banker','Tie','Player Pair','Banker Pair','Super 6'],ARRAY[bc.player,bc.banker,bc.tie,bc.player_pair,bc.banker_pair,bc.six]::bigint[],ARRAY[5,5,5,5,5,5])),
 ('crash:safe-landing',wallet_private.achievement_measure(ARRAY['Cash-outs at 2x or higher'],ARRAY[cr.two]::bigint[],ARRAY[1])),
 ('crash:set-and-forget',wallet_private.achievement_measure(ARRAY['Automatic cash-outs at 2x or higher'],ARRAY[cr.automatic]::bigint[],ARRAY[5])),
 ('crash:hands-on',wallet_private.achievement_measure(ARRAY['Manual cash-outs at 2x or higher'],ARRAY[cr.manual]::bigint[],ARRAY[10])),
 ('crash:double-figures',wallet_private.achievement_measure(ARRAY['Cash-outs at 10x or higher'],ARRAY[cr.ten]::bigint[],ARRAY[5])),
 ('crash:stratosphere',wallet_private.achievement_measure(ARRAY['Cash-outs at 25x or higher'],ARRAY[cr.high]::bigint[],ARRAY[1])),
 ('crash:frequent-high-flyer',wallet_private.achievement_measure(ARRAY['Cash-outs at 5x or higher'],ARRAY[cr.five]::bigint[],ARRAY[25])),
 ('duck-race:meet-the-flock',wallet_private.achievement_measure(ARRAY['Duck 1','Duck 2','Duck 3','Duck 4'],ARRAY[d.played[1],d.played[2],d.played[3],d.played[4]]::bigint[],ARRAY[1,1,1,1])),
 ('duck-race:winning-flock',wallet_private.achievement_measure(ARRAY['Duck 1','Duck 2','Duck 3','Duck 4'],ARRAY[d.wins[1],d.wins[2],d.wins[3],d.wins[4]]::bigint[],ARRAY[1,1,1,1])),
 ('duck-race:loyal-supporter',wallet_private.achievement_measure(ARRAY['Most wins with one duck'],ARRAY[greatest(d.wins[1],d.wins[2],d.wins[3],d.wins[4])]::bigint[],ARRAY[10])),
 ('duck-race:hat-trick',wallet_private.achievement_measure(ARRAY['Best streak in one session'],ARRAY[d.streak]::bigint[],ARRAY[3])),
 ('duck-race:champion-flock',wallet_private.achievement_measure(ARRAY['Duck 1','Duck 2','Duck 3','Duck 4'],ARRAY[d.wins[1],d.wins[2],d.wins[3],d.wins[4]]::bigint[],ARRAY[10,10,10,10])),
 ('duck-race:race-veteran',wallet_private.achievement_measure(ARRAY['Races won'],ARRAY[d.total]::bigint[],ARRAY[100])),
 ('roulette:split-ticket',wallet_private.achievement_measure(ARRAY['Profitable split spins'],ARRAY[rk.split]::bigint[],ARRAY[1])),
 ('roulette:corner-pocket',wallet_private.achievement_measure(ARRAY['Profitable corner spins'],ARRAY[(SELECT count(*) FROM r WHERE game_id='roulette' AND won AND EXISTS(SELECT 1 FROM jsonb_array_elements(f->'bets') b WHERE b->>'betId' LIKE 'corner-%' AND string_to_array(substr(b->>'betId',8),'-') @> ARRAY[f->>'winner']))]::bigint[],ARRAY[3])),
 ('roulette:inside-knowledge',wallet_private.achievement_measure(ARRAY['Split','Street','Corner','Six-line'],ARRAY[rk.split,rk.street,rk.corner,rk.six]::bigint[],ARRAY[1,1,1,1])),
 ('roulette:green-light',wallet_private.achievement_measure(ARRAY['Single-number wins on zero'],ARRAY[rc.zero]::bigint[],ARRAY[1])),
 ('roulette:around-the-wheel',wallet_private.achievement_measure(ARRAY['Different single-number wins'],ARRAY[rc.numbers]::bigint[],ARRAY[5])),
 ('roulette:sharpshooter',wallet_private.achievement_measure(ARRAY['Single-number tickets won'],ARRAY[rc.singles]::bigint[],ARRAY[10])),
 ('keno:try-a-trio',wallet_private.achievement_measure(ARRAY['Three-pick tickets completed'],ARRAY[k.trio]::bigint[],ARRAY[1])),
 ('keno:ticket-explorer',wallet_private.achievement_measure(ARRAY['1 pick','2 picks','3 picks','4 picks','5 picks','6 picks','7 picks','8 picks','9 picks','10 picks'],ARRAY[(SELECT count(*) FROM kr WHERE picks=1),(SELECT count(*) FROM kr WHERE picks=2),(SELECT count(*) FROM kr WHERE picks=3),(SELECT count(*) FROM kr WHERE picks=4),(SELECT count(*) FROM kr WHERE picks=5),(SELECT count(*) FROM kr WHERE picks=6),(SELECT count(*) FROM kr WHERE picks=7),(SELECT count(*) FROM kr WHERE picks=8),(SELECT count(*) FROM kr WHERE picks=9),(SELECT count(*) FROM kr WHERE picks=10)]::bigint[],ARRAY[1,1,1,1,1,1,1,1,1,1])),
 ('keno:three-for-three',wallet_private.achievement_measure(ARRAY['All three numbers matched'],ARRAY[k.all_three]::bigint[],ARRAY[1])),
 ('keno:lucky-six',wallet_private.achievement_measure(ARRAY['Six or more hits on ten picks'],ARRAY[k.six]::bigint[],ARRAY[1])),
 ('keno:pick-mix',wallet_private.achievement_measure(ARRAY['Different profitable pick counts'],ARRAY[k.winning_variety]::bigint[],ARRAY[5])),
 ('keno:draw-specialist',wallet_private.achievement_measure(ARRAY['Profitable tickets'],ARRAY[k.wins]::bigint[],ARRAY[100]))
 ) v(id,measure)
$$;
CREATE OR REPLACE FUNCTION public.usual_table_progression()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); start_at timestamptz; experience numeric; current_level integer;
  claimed_level integer; achievements jsonb; rewards numeric; expanded jsonb;
BEGIN
  SELECT starts_at INTO start_at FROM wallet_private.progression_policy WHERE version='progress-v1';
  expanded:=wallet_private.expanded_achievement_progress(account);
  SELECT count(*)*10::numeric INTO experience FROM wallet_private.results WHERE account_id=account AND created_at>=start_at;
  current_level:=floor((1+sqrt(1+8*experience/100))/2)::integer;
  SELECT highest_level INTO claimed_level FROM wallet_private.level_claims WHERE account_id=account;
  claimed_level:=coalesce(claimed_level,1);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'gameId',a.game_id,'name',a.name,'description',a.description,
    'rewardUnits',a.reward_units,'target',a.target,'progress',a.progress::text,'unlocked',a.progress>=a.target,'claimed',a.claimed) ORDER BY a.game_id,a.id),'[]'::jsonb),
    coalesce(sum(a.reward_units) FILTER(WHERE a.progress>=a.target AND NOT a.claimed),0) INTO achievements,rewards FROM (
    SELECT d.*,EXISTS(SELECT 1 FROM wallet_private.achievement_claims c WHERE c.account_id=account AND c.achievement_id=d.id) AS claimed,
      CASE WHEN d.metric='expanded-v1' THEN coalesce((expanded->d.id->>'progress')::numeric,0) ELSE (SELECT CASE d.metric WHEN 'rounds' THEN count(*)::numeric WHEN 'wins' THEN count(*) FILTER(WHERE r.returned_units>r.wagered_units)::numeric
        WHEN 'keno-five' THEN count(*) FILTER(WHERE wallet_private.keno_matches(r.facts->'numbers',r.facts->'draw')>=5)::numeric
        WHEN 'straight-wins' THEN count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(r.facts->'bets','[]'::jsonb)) b WHERE b->>'betId'='straight-' || (r.facts->>'winner')))::numeric
        WHEN 'blackjacks' THEN coalesce(sum((r.facts->>'blackjacks')::integer),0)::numeric
        WHEN 'tie-wins' THEN count(*) FILTER(WHERE (r.facts->>'tieUnits')::bigint>0 AND r.facts->>'outcome'='tie')::numeric
        WHEN 'cashouts' THEN count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean)::numeric
        WHEN 'cashout-5x' THEN count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean AND (r.facts->>'cashoutCents')::integer>=500)::numeric END
       FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
       WHERE r.account_id=account AND r.created_at>=greatest(start_at,CASE WHEN d.game_id='keno' THEN (SELECT starts_at FROM wallet_private.progression_policy WHERE version='keno-v1') ELSE start_at END) AND s.game_id=d.game_id) END AS progress
    FROM wallet_private.achievement_definitions d
  ) a;
  RETURN jsonb_build_object('contract',1,'accountId',account,'policy','progress-v1','startsAt',floor(extract(epoch FROM start_at)*1000),
    'xpPerRound',10,'xp',experience::text,'level',current_level,'levelStartXp',(100::numeric*(current_level-1)*current_level/2)::numeric(40,0)::text,
    'nextLevelXp',(100::numeric*current_level*(current_level+1)/2)::numeric(40,0)::text,'levelRewardUnits',100000,'claimedLevel',claimed_level,
    'readyRewardUnits',(rewards+greatest(0,current_level-claimed_level)*100000::numeric)::text,'claimedUnits',0,'achievements',achievements,'wallet',public.usual_table_wallet_summary());
END;
$$;
CREATE OR REPLACE FUNCTION wallet_private.achievement_details_payload(snapshot jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH metrics AS (SELECT wallet_private.expanded_achievement_progress((snapshot->>'accountId')::uuid) m)
 SELECT jsonb_set(snapshot,'{achievements}',coalesce((SELECT jsonb_agg(a.value||CASE WHEN d.achievement_id IS NOT NULL THEN
 jsonb_build_object('difficulty',d.difficulty,'breakdown',metrics.m->d.achievement_id->'breakdown')||CASE WHEN d.new_facts THEN jsonb_build_object('trackedSince',(SELECT floor(extract(epoch FROM starts_at)*1000)::bigint FROM wallet_private.progression_policy WHERE version='achievements-v2')) ELSE '{}'::jsonb END ELSE '{}'::jsonb END ORDER BY a.ordinality)
 FROM jsonb_array_elements(snapshot->'achievements') WITH ORDINALITY a(value,ordinality) LEFT JOIN wallet_private.achievement_details d ON d.achievement_id=a.value->>'id' CROSS JOIN metrics),'[]'::jsonb))
$$;
CREATE OR REPLACE FUNCTION public.usual_table_progression_v2()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT wallet_private.achievement_details_payload(public.usual_table_progression())
$$;
CREATE OR REPLACE FUNCTION public.usual_table_claim_rewards_v2()
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT wallet_private.achievement_details_payload(public.usual_table_claim_rewards())
$$;
REVOKE ALL ON FUNCTION wallet_private.achievement_measure(text[],bigint[],integer[]),wallet_private.expanded_achievement_progress(uuid),wallet_private.achievement_details_payload(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.usual_table_progression_v2(),public.usual_table_claim_rewards_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_progression_v2(),public.usual_table_claim_rewards_v2() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
