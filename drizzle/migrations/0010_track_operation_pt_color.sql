-- Registra a troca de cor da PT feita pela Operação na linha do tempo.
CREATE OR REPLACE FUNCTION public.tg_activities_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  prof record;
  old_business jsonb;
  new_business jsonb;
  planning_user boolean;
  operation_user boolean;
  report_changed boolean;
  color_changed boolean;
BEGIN
  planning_user := auth.uid() IS NOT NULL AND (public.has_role(auth.uid(), 'planning') OR public.has_role(auth.uid(), 'admin'));
  operation_user := auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'operation');
  old_business := to_jsonb(OLD) - ARRAY['id','week_id','source_row_number','source_key','planning_data','reported_by_user_id','reported_by_name','reported_by_email','reported_at','created_by','sync_status','sync_error','version','created_at','updated_at'];
  new_business := to_jsonb(NEW) - ARRAY['id','week_id','source_row_number','source_key','planning_data','reported_by_user_id','reported_by_name','reported_by_email','reported_at','created_by','sync_status','sync_error','version','created_at','updated_at'];
  report_changed := OLD.status IS DISTINCT FROM NEW.status OR OLD.justification IS DISTINCT FROM NEW.justification OR OLD.observation IS DISTINCT FROM NEW.observation;
  color_changed := OLD.pt_color IS DISTINCT FROM NEW.pt_color;
  IF (planning_user AND old_business IS DISTINCT FROM new_business) OR (operation_user AND color_changed) OR report_changed THEN
    SELECT full_name,email INTO prof FROM public.profiles WHERE id=auth.uid();
    INSERT INTO public.activity_history(activity_id,week_id,previous_values,new_values,changed_by_user_id,changed_by_name,changed_by_email,change_source)
    VALUES (NEW.id,NEW.week_id,old_business,new_business,auth.uid(),coalesce(prof.full_name,''),coalesce(prof.email,''),
      (CASE WHEN planning_user THEN 'planning' WHEN operation_user AND color_changed THEN 'operation' ELSE 'individual' END)::public.change_source);
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='activities') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activities;
  END IF;
END $$;
