BEGIN;
-- Add Duck Race rewards without replacing existing progression, claims or balances.
INSERT INTO wallet_private.achievement_definitions VALUES
 ('duck-race:first-race','duck-race','First Race','Complete a saved-chip Duck Race.','rounds',1,10000),
 ('duck-race:first-win','duck-race','First Win','Win a saved-chip Duck Race.','wins',1,10000),
 ('duck-race:10-wins','duck-race','Lucky Duck','Win 10 saved-chip Duck Races.','wins',10,25000),
 ('duck-race:25-races','duck-race','Regular Racer','Complete 25 saved-chip Duck Races.','rounds',25,25000)
 ON CONFLICT DO NOTHING;
COMMIT;
