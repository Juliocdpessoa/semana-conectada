-- GoTrue updates encrypted_password, then app_metadata in the same transaction.
-- Store only transaction/reset identifiers, never passwords or hashes.
CREATE TABLE IF NOT EXISTS public.password_reset_write_proofs (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 reset_id uuid NOT NULL, transaction_id bigint NOT NULL
);
ALTER TABLE public.password_reset_write_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_write_proofs FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.audit_password_reset_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_reset jsonb:=OLD.raw_app_meta_data->'nexo_password_reset';
 new_reset jsonb:=NEW.raw_app_meta_data->'nexo_password_reset';
 changed_here boolean:=NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password;
BEGIN
 IF changed_here AND coalesce((old_reset->>'required')::boolean,false) THEN
  INSERT INTO public.password_reset_write_proofs(user_id,reset_id,transaction_id)
   VALUES(NEW.id,(old_reset->>'id')::uuid,txid_current())
  ON CONFLICT(user_id) DO UPDATE SET reset_id=EXCLUDED.reset_id,transaction_id=EXCLUDED.transaction_id;
 END IF;
 IF old_reset IS NOT DISTINCT FROM new_reset THEN RETURN NEW; END IF;
 IF coalesce((old_reset->>'required')::boolean,false) AND NOT coalesce((new_reset->>'required')::boolean,false) THEN
  IF new_reset->>'id' IS DISTINCT FROM old_reset->>'id' OR NOT (
   changed_here OR EXISTS(SELECT 1 FROM public.password_reset_write_proofs p
    WHERE p.user_id=NEW.id AND p.reset_id=(old_reset->>'id')::uuid AND p.transaction_id=txid_current())
  ) THEN
   RAISE EXCEPTION 'Reset alterado ou senha não atualizada. Entre novamente.';
  END IF;
  INSERT INTO public.password_reset_audit(user_id,reset_id,event,actor_id,actor_name)
   VALUES(NEW.id,(new_reset->>'id')::uuid,'completed',NEW.id,null);
  DELETE FROM public.password_reset_write_proofs WHERE user_id=NEW.id;
 ELSIF coalesce((new_reset->>'required')::boolean,false) AND new_reset->>'id' IS DISTINCT FROM old_reset->>'id' THEN
  INSERT INTO public.password_reset_audit(user_id,reset_id,event,actor_id,actor_name)
   VALUES(NEW.id,(new_reset->>'id')::uuid,'requested',(new_reset->>'requested_by')::uuid,new_reset->>'requested_by_name');
  DELETE FROM public.password_reset_write_proofs WHERE user_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_password_reset_transition() FROM PUBLIC,anon,authenticated;
