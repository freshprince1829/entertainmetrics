-- Removes ONLY the "[SAMPLE] ..." records created by seed_sample_data.py.
-- Run in the Supabase SQL editor. Order matters: the tables have no cascade.
begin;
create temp table _se as select id from events where event_name like '[SAMPLE] %';
create temp table _sa as select id from artists where artist_name like '[SAMPLE] %';
delete from snapshot_tier_sales where snapshot_id in (select id from ticket_sales_snapshots where event_id in (select id from _se));
delete from snapshot_tier_sales where tier_id in (select id from ticket_tiers where event_id in (select id from _se));
delete from ticket_sales_snapshots where event_id in (select id from _se);
delete from prediction_bands where prediction_id in (select id from predictions where event_id in (select id from _se));
delete from predictions where event_id in (select id from _se);
delete from ticket_tiers where event_id in (select id from _se);
delete from event_artists where event_id in (select id from _se) or artist_id in (select id from _sa);
delete from events where id in (select id from _se);
delete from artists where id in (select id from _sa);
commit;
