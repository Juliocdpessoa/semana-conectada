
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin','planning','leader','viewer');
CREATE TYPE public.approval_status AS ENUM ('pending','approved','blocked');
CREATE TYPE public.sync_status AS ENUM ('synced','pending','error');
CREATE TYPE public.change_source AS ENUM ('individual','bulk','import','sync');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  approval_status public.approval_status NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER ROLES (separate table for security) ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============ SECURITY DEFINER FUNCTIONS ============
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.is_approved(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND approval_status = 'approved') $$;

CREATE OR REPLACE FUNCTION public.current_role_label(_user_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT CASE
  WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='admin') THEN 'admin'
  WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='planning') THEN 'planning'
  WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='leader') THEN 'leader'
  WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='viewer') THEN 'viewer'
  ELSE NULL END $$;

-- ============ PROFILE POLICIES ============
CREATE POLICY "profiles select self" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'planning'));
CREATE POLICY "profiles insert self" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles update admin" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles update own name" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ============ USER_ROLES POLICIES ============
CREATE POLICY "user_roles select self or admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'planning'));

-- ============ WEEKS ============
CREATE TABLE public.weeks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  source_file_name TEXT,
  sharepoint_item_id TEXT,
  sheet_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  imported_by UUID REFERENCES auth.users(id),
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX weeks_only_one_active ON public.weeks((is_active)) WHERE is_active = true;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weeks TO authenticated;
GRANT ALL ON public.weeks TO service_role;
ALTER TABLE public.weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "weeks select approved" ON public.weeks FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
CREATE POLICY "weeks write planning" ON public.weeks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'));

-- ============ ACTIVITIES ============
CREATE TABLE public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id UUID NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
  source_row_number INTEGER,
  source_key TEXT NOT NULL,
  order_number TEXT,
  note_number TEXT,
  description TEXT NOT NULL DEFAULT '',
  area TEXT,
  specialty TEXT,
  scheduled_date DATE,
  planning_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'Sem apontamento',
  justification TEXT,
  observation TEXT,
  reported_by_user_id UUID REFERENCES auth.users(id),
  reported_by_name TEXT,
  reported_by_email TEXT,
  reported_at TIMESTAMPTZ,
  is_immediate BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  sync_status public.sync_status NOT NULL DEFAULT 'synced',
  sync_error TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(week_id, source_key)
);
CREATE INDEX activities_week_idx ON public.activities(week_id);
CREATE INDEX activities_order_idx ON public.activities(order_number);
CREATE INDEX activities_note_idx ON public.activities(note_number);
CREATE INDEX activities_date_idx ON public.activities(scheduled_date);
CREATE INDEX activities_status_idx ON public.activities(status);
CREATE INDEX activities_area_idx ON public.activities(area);
CREATE INDEX activities_sync_idx ON public.activities(sync_status);
CREATE INDEX activities_updated_idx ON public.activities(updated_at);
CREATE INDEX activities_desc_trgm_idx ON public.activities USING GIN (to_tsvector('portuguese', coalesce(description,'')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO authenticated;
GRANT ALL ON public.activities TO service_role;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activities select approved" ON public.activities FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- Leaders can only update reporting columns; enforced by trigger below
CREATE POLICY "activities update leader" ON public.activities FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid()) AND (
    public.has_role(auth.uid(),'leader') OR public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin')
  ))
  WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "activities insert planning" ON public.activities FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "activities delete planning" ON public.activities FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'));

-- ============ ACTIVITY HISTORY ============
CREATE TABLE public.activity_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  week_id UUID NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
  previous_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by_user_id UUID REFERENCES auth.users(id),
  changed_by_name TEXT,
  changed_by_email TEXT,
  change_source public.change_source NOT NULL DEFAULT 'individual',
  sync_status public.sync_status,
  sync_error TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_history_activity_idx ON public.activity_history(activity_id);
CREATE INDEX activity_history_week_idx ON public.activity_history(week_id);
GRANT SELECT ON public.activity_history TO authenticated;
GRANT ALL ON public.activity_history TO service_role;
ALTER TABLE public.activity_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "history select planning" ON public.activity_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'planning'));

-- ============ SYNC JOBS ============
CREATE TABLE public.sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID REFERENCES public.activities(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.sync_status NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
GRANT SELECT, UPDATE ON public.sync_jobs TO authenticated;
GRANT ALL ON public.sync_jobs TO service_role;
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync select planning" ON public.sync_jobs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'planning'));

-- ============ SHAREPOINT CONFIG (singleton) ============
CREATE TABLE public.sharepoint_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  site_id TEXT,
  drive_id TEXT,
  item_id TEXT,
  sheet_name TEXT DEFAULT 'Acompanhamento',
  table_name TEXT,
  column_mapping JSONB NOT NULL DEFAULT '{"status":"U","justification":"V","observation":"W","responsible":"X"}'::jsonb,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.sharepoint_config (id) VALUES (1);
GRANT SELECT ON public.sharepoint_config TO authenticated;
GRANT ALL ON public.sharepoint_config TO service_role;
ALTER TABLE public.sharepoint_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp select approved" ON public.sharepoint_config FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
CREATE POLICY "sp update admin" ON public.sharepoint_config FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ TRIGGERS ============
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Activities: enforce leader field restrictions + version bump + history
CREATE OR REPLACE FUNCTION public.tg_activities_before_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_leader_only BOOLEAN;
BEGIN
  is_leader_only := NOT (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'));
  IF is_leader_only THEN
    -- leaders can only change status/justification/observation
    NEW.week_id := OLD.week_id;
    NEW.source_row_number := OLD.source_row_number;
    NEW.source_key := OLD.source_key;
    NEW.order_number := OLD.order_number;
    NEW.note_number := OLD.note_number;
    NEW.description := OLD.description;
    NEW.area := OLD.area;
    NEW.specialty := OLD.specialty;
    NEW.scheduled_date := OLD.scheduled_date;
    NEW.planning_data := OLD.planning_data;
    NEW.is_immediate := OLD.is_immediate;
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END; $$;

CREATE TRIGGER activities_before_update BEFORE UPDATE ON public.activities
FOR EACH ROW EXECUTE FUNCTION public.tg_activities_before_update();

-- Auto history on activity updates
CREATE OR REPLACE FUNCTION public.tg_activities_after_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prof RECORD;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     OR OLD.justification IS DISTINCT FROM NEW.justification
     OR OLD.observation IS DISTINCT FROM NEW.observation THEN
    SELECT full_name, email INTO prof FROM public.profiles WHERE id = auth.uid();
    INSERT INTO public.activity_history(
      activity_id, week_id, previous_values, new_values,
      changed_by_user_id, changed_by_name, changed_by_email, change_source
    ) VALUES (
      NEW.id, NEW.week_id,
      jsonb_build_object('status',OLD.status,'justification',OLD.justification,'observation',OLD.observation,'reported_by_name',OLD.reported_by_name),
      jsonb_build_object('status',NEW.status,'justification',NEW.justification,'observation',NEW.observation,'reported_by_name',NEW.reported_by_name),
      auth.uid(), COALESCE(prof.full_name,''), COALESCE(prof.email,''), 'individual'
    );
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER activities_after_update AFTER UPDATE ON public.activities
FOR EACH ROW EXECUTE FUNCTION public.tg_activities_after_update();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, approval_status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    'pending'
  );
  -- Default role: leader (pending approval still blocks reads)
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'leader');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ SEED: Semana 030/2026 with 25 fictitious activities ============
INSERT INTO public.weeks (id, code, label, start_date, end_date, is_active, imported_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'S030-2026', 'Semana 030/2026', '2026-07-20', '2026-07-26', true, now());

INSERT INTO public.activities (week_id, source_row_number, source_key, order_number, note_number, description, area, specialty, scheduled_date, status, justification, observation, reported_by_name, reported_at, is_immediate)
VALUES
('11111111-1111-1111-1111-111111111111', 1, 'K001', '400012345', 'N-8891', 'Inspeção termográfica painel CCM-01', 'Subestação Norte', 'Elétrica', '2026-07-20', 'Concluída', NULL, 'Sem anomalias detectadas', 'Carlos Ribeiro', now(), false),
('11111111-1111-1111-1111-111111111111', 2, 'K002', '400012346', 'N-8892', 'Troca de rolamento bomba B-102', 'Utilidades', 'Mecânica', '2026-07-20', 'Em execução', NULL, 'Aguardando kit selagem', 'Ana Ferreira', now(), false),
('11111111-1111-1111-1111-111111111111', 3, 'K003', '400012347', 'N-8893', 'Calibração de válvula PV-201', 'Processo A', 'Instrumentação', '2026-07-20', 'Sem apontamento', NULL, NULL, NULL, NULL, false),
('11111111-1111-1111-1111-111111111111', 4, 'K004', '400012348', 'N-8894', 'Limpeza filtro F-301', 'Utilidades', 'Mecânica', '2026-07-21', 'Não realizada', 'Falta de acesso/liberação', 'Área bloqueada pela operação', 'João Souza', now(), false),
('11111111-1111-1111-1111-111111111111', 5, 'K005', '400012349', 'N-8895', 'Ensaio dielétrico motor M-45', 'Subestação Sul', 'Elétrica', '2026-07-21', 'Impedida', 'Equipamento indisponível', 'Aguardando parada geral', 'Márcia Lima', now(), false),
('11111111-1111-1111-1111-111111111111', 6, 'K006', '400012350', 'N-8896', 'Análise de vibração compressor C-11', 'Processo B', 'Preditiva', '2026-07-21', 'Concluída', NULL, 'Vibração dentro do padrão', 'Pedro Alves', now(), false),
('11111111-1111-1111-1111-111111111111', 7, 'K007', '400012351', 'N-8897', 'Substituição de sensor de temperatura TT-14', 'Processo A', 'Instrumentação', '2026-07-22', 'Sem apontamento', NULL, NULL, NULL, NULL, false),
('11111111-1111-1111-1111-111111111111', 8, 'K008', '400012352', 'N-8898', 'Reaperto conexões elétricas TR-02', 'Subestação Norte', 'Elétrica', '2026-07-22', 'Concluída', NULL, NULL, 'Carlos Ribeiro', now(), false),
('11111111-1111-1111-1111-111111111111', 9, 'K009', '400012353', 'N-8899', 'Lubrificação redutor R-08', 'Utilidades', 'Mecânica', '2026-07-22', 'Reprogramada', 'Prioridade alterada', 'Reprogramado para semana 031', 'Ana Ferreira', now(), false),
('11111111-1111-1111-1111-111111111111', 10, 'K010', '400012354', 'N-8900', 'Verificação de aterramento SE-Norte', 'Subestação Norte', 'Elétrica', '2026-07-22', 'Concluída', NULL, NULL, 'Márcia Lima', now(), false),
('11111111-1111-1111-1111-111111111111', 11, 'K011', '400012355', 'N-8901', 'Inspeção visual tubulação linha 12', 'Processo B', 'Mecânica', '2026-07-23', 'Em execução', NULL, NULL, 'João Souza', now(), false),
('11111111-1111-1111-1111-111111111111', 12, 'K012', '400012356', 'N-8902', 'Teste funcional válvula de segurança PSV-77', 'Processo A', 'Instrumentação', '2026-07-23', 'Sem apontamento', NULL, NULL, NULL, NULL, false),
('11111111-1111-1111-1111-111111111111', 13, 'K013', '400012357', 'N-8903', 'Troca de correia ventilador V-05', 'Utilidades', 'Mecânica', '2026-07-23', 'Concluída', NULL, NULL, 'Pedro Alves', now(), false),
('11111111-1111-1111-1111-111111111111', 14, 'K014', '400012358', 'N-8904', 'Medição de isolação cabo AT-33', 'Subestação Sul', 'Elétrica', '2026-07-23', 'Cancelada', 'Outro impedimento', 'Cancelado pela engenharia', 'Márcia Lima', now(), false),
('11111111-1111-1111-1111-111111111111', 15, 'K015', '400012359', 'N-8905', 'Limpeza trocador de calor E-22', 'Processo A', 'Mecânica', '2026-07-24', 'Sem apontamento', NULL, NULL, NULL, NULL, false),
('11111111-1111-1111-1111-111111111111', 16, 'K016', '400012360', 'N-8906', 'Ajuste malha de controle FIC-88', 'Processo A', 'Instrumentação', '2026-07-24', 'Concluída', NULL, NULL, 'Ana Ferreira', now(), false),
('11111111-1111-1111-1111-111111111111', 17, 'K017', '400012361', 'N-8907', 'Substituição lâmpadas pátio SE-Sul', 'Subestação Sul', 'Elétrica', '2026-07-24', 'Não realizada', 'Condição climática', 'Chuva intensa', 'Carlos Ribeiro', now(), false),
('11111111-1111-1111-1111-111111111111', 18, 'K018', '400012362', 'N-8908', 'Análise de óleo transformador TR-05', 'Subestação Norte', 'Preditiva', '2026-07-24', 'Concluída', NULL, NULL, 'Pedro Alves', now(), false),
('11111111-1111-1111-1111-111111111111', 19, 'K019', '400012363', 'N-8909', 'Revisão de instrumentação painel P-14', 'Processo B', 'Instrumentação', '2026-07-25', 'Em execução', NULL, NULL, 'João Souza', now(), false),
('11111111-1111-1111-1111-111111111111', 20, 'K020', '400012364', 'N-8910', 'Troca de válvula globo VG-19', 'Utilidades', 'Mecânica', '2026-07-25', 'Impedida', 'Falta de material', 'Válvula fora de estoque', 'Ana Ferreira', now(), false),
('11111111-1111-1111-1111-111111111111', 21, 'K021', '400012365', 'N-8911', 'Ronda operacional utilidades', 'Utilidades', 'Operacional', '2026-07-25', 'Concluída', NULL, NULL, 'Márcia Lima', now(), false),
('11111111-1111-1111-1111-111111111111', 22, 'K022', '400012366', 'N-8912', 'Inspeção de para-raios SE-Norte', 'Subestação Norte', 'Elétrica', '2026-07-26', 'Sem apontamento', NULL, NULL, NULL, NULL, false),
('11111111-1111-1111-1111-111111111111', 23, 'K023', '400012367', 'N-8913', 'Preventiva mensal grupo gerador GG-02', 'Utilidades', 'Mecânica', '2026-07-26', 'Concluída', NULL, NULL, 'Carlos Ribeiro', now(), false),
('11111111-1111-1111-1111-111111111111', 24, 'IMM001', 'IMD-001', 'N-9001', 'IMEDIATA: Vazamento em flange linha 07', 'Processo A', 'Mecânica', '2026-07-22', 'Em execução', NULL, 'Contenção instalada', 'João Souza', now(), true),
('11111111-1111-1111-1111-111111111111', 25, 'IMM002', 'IMD-002', 'N-9002', 'IMEDIATA: Falha em disjuntor DJ-14', 'Subestação Sul', 'Elétrica', '2026-07-23', 'Concluída', NULL, 'Disjuntor substituído', 'Márcia Lima', now(), true);
