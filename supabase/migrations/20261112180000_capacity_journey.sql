CREATE TABLE IF NOT EXISTS public.weekly_capacity_journey(
 week_id uuid PRIMARY KEY REFERENCES public.weeks(id) ON DELETE CASCADE,
 days jsonb NOT NULL CHECK(jsonb_typeof(days)='object'),
 version integer NOT NULL DEFAULT 1, updated_by uuid NOT NULL DEFAULT auth.uid(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.weekly_capacity_journey_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),week_id uuid NOT NULL,
 days jsonb NOT NULL,version integer NOT NULL,updated_by uuid NOT NULL,updated_at timestamptz NOT NULL,updated_by_name text);
ALTER TABLE public.weekly_capacity_journey ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_capacity_journey_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY journey_access ON public.weekly_capacity_journey FOR ALL TO authenticated
 USING(public.can_access_sap(auth.uid()) AND EXISTS(SELECT 1 FROM public.weeks w WHERE w.id=week_id AND public.can_access_worksite(auth.uid(),w.worksite_id)))
 WITH CHECK(public.can_access_sap(auth.uid()) AND EXISTS(SELECT 1 FROM public.weeks w WHERE w.id=week_id AND public.can_access_worksite(auth.uid(),w.worksite_id)));
CREATE POLICY journey_history_read ON public.weekly_capacity_journey_history FOR SELECT TO authenticated
 USING(public.can_access_sap(auth.uid()) AND EXISTS(SELECT 1 FROM public.weeks w WHERE w.id=week_id AND public.can_access_worksite(auth.uid(),w.worksite_id)));
GRANT SELECT,INSERT,UPDATE ON public.weekly_capacity_journey TO authenticated;
GRANT SELECT ON public.weekly_capacity_journey_history TO authenticated;
CREATE OR REPLACE FUNCTION public.audit_capacity_journey() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d text;h jsonb;w public.weeks%ROWTYPE;
BEGIN
 SELECT * INTO w FROM public.weeks WHERE id=NEW.week_id;
 FOR d,h IN SELECT key,value FROM jsonb_each(NEW.days) LOOP
 IF d !~ '^\d{4}-\d{2}-\d{2}$' OR d::date<w.start_date OR d::date>w.end_date OR jsonb_typeof(h)<>'number' OR h::text::numeric<0 OR h::text::numeric>24 THEN RAISE EXCEPTION 'Jornada diária inválida'; END IF;
 END LOOP;
 IF TG_OP='UPDATE' THEN NEW.version:=OLD.version+1; ELSE NEW.version:=1; END IF;
 NEW.updated_by:=auth.uid();NEW.updated_at:=now();
 INSERT INTO public.weekly_capacity_journey_history(week_id,days,version,updated_by,updated_at,updated_by_name) VALUES(NEW.week_id,NEW.days,NEW.version,NEW.updated_by,NEW.updated_at,(SELECT full_name FROM public.profiles WHERE id=auth.uid()));
 RETURN NEW;
END $$;
CREATE TRIGGER capacity_journey_audit BEFORE INSERT OR UPDATE ON public.weekly_capacity_journey FOR EACH ROW EXECUTE FUNCTION public.audit_capacity_journey();

REVOKE ALL ON public.weekly_capacity_journey,public.weekly_capacity_journey_history FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.weekly_capacity_journey TO authenticated;
GRANT SELECT ON public.weekly_capacity_journey_history TO authenticated;
