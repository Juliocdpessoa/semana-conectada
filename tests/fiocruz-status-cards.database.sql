BEGIN;
SELECT set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
SELECT public.import_continuous_activities('68166d78-53b7-4c66-bea9-deb94e39a2c3','[{"key":"cards-fixture-a","data":{"description":"CardFixtureUnique","status":"1","local":"IARI","requested_date":"2026-11-01"}},{"key":"cards-fixture-b","data":{"description":"CardFixtureUnique","status":"4","local":"ROTINA","requested_date":"2026-11-02"}}]');
DO $checks$ DECLARE c jsonb; BEGIN
 c:=public.continuous_activity_status_counts('68166d78-53b7-4c66-bea9-deb94e39a2c3','CardFixtureUnique','{}',NULL,NULL);
 IF (c->>'1')::int<>1 OR (c->>'4')::int<>1 THEN RAISE EXCEPTION 'Status counts failed'; END IF;
 c:=public.continuous_activity_status_counts('68166d78-53b7-4c66-bea9-deb94e39a2c3','CardFixtureUnique','{"local":"IARI","status":"4"}',NULL,NULL);
 IF (c->>'1')::int<>1 OR c ? '4' THEN RAISE EXCEPTION 'Local / self-excluded status facet failed'; END IF;
 c:=public.continuous_activity_status_counts('68166d78-53b7-4c66-bea9-deb94e39a2c3','CardFixtureUnique','{}','2026-11-02','2026-11-02');
 IF c ? '1' OR (c->>'4')::int<>1 THEN RAISE EXCEPTION 'Date filter failed'; END IF;
END $checks$;
SELECT 'cards, local, search, dates passed' result;
ROLLBACK;
