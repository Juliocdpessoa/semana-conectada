-- Keep master identities and foreign keys for historical HE/shift/transport records.
ALTER TABLE public.employees ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.employees ADD CONSTRAINT employees_deleted_inactive CHECK (deleted_at IS NULL OR NOT is_active);
COMMENT ON COLUMN public.employees.deleted_at IS 'Logical deletion: hidden from registration and new requests; historical links retained. Actor in updated_by_user_id/updated_by_name.';
NOTIFY pgrst,'reload schema';
