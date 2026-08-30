-- Configurações singleton passam a ser singleton por obra.
ALTER TABLE public.activity_edit_settings
  DROP CONSTRAINT IF EXISTS activity_edit_settings_pkey;
ALTER TABLE public.activity_edit_settings
  ADD CONSTRAINT activity_edit_settings_pkey PRIMARY KEY (worksite_id, id);

ALTER TABLE public.sharepoint_config
  DROP CONSTRAINT IF EXISTS sharepoint_config_pkey;
ALTER TABLE public.sharepoint_config
  ADD CONSTRAINT sharepoint_config_pkey PRIMARY KEY (worksite_id, id);
