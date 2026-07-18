# Controle Semanal — Plano de Implementação

Aplicação full-stack em TanStack Start + Lovable Cloud (Supabase) para acompanhamento diário de ~1.400 atividades semanais de manutenção, usada por 40–60 líderes e o time de planejamento.

## Arquitetura

- **Frontend**: TanStack Start (React 19 + Vite 7), Tailwind v4, shadcn/ui, TanStack Query.
- **Backend**: Lovable Cloud (Supabase) — Auth por e-mail, Postgres com RLS, server functions do TanStack para lógica sensível.
- **Integração SharePoint/Excel**: server functions chamando Microsoft Graph via conector Lovable (App Connector `microsoft_excel`), com fila `sync_jobs` e retry. Desativado por padrão (modo demonstração).
- **i18n**: PT-BR fixo em toda a UI.

## Design System

Tokens em `src/styles.css` (oklch):
- `--primary` #102B46 (marinho), `--secondary` #173D60, `--success` #168866 (verde operacional), `--background` #F4F7F9, `--card` #FFF, `--warning` âmbar (impedimentos), `--destructive` vermelho (críticos).
- Tipografia: Inter (system fallback), densidade alta, cantos suaves (radius 0.5rem), sem gradientes.
- Componentes: Header fixo, KPIs compactos, tabela densa desktop, cartão compacto mobile.

## Modelo de dados (migrations Lovable Cloud)

Enums: `app_role` (admin, planning, leader, viewer), `approval_status` (pending, approved, blocked), `sync_status` (synced, pending, error), `change_source` (individual, bulk, import, sync).

Tabelas conforme especificado:
`profiles`, `user_roles` (separada por segurança — ver regra de RLS), `weeks`, `activities`, `activity_history`, `sync_jobs`, `sharepoint_config` (singleton para site/drive/item/sheet/mapping).

RLS:
- `has_role(uuid, app_role)` SECURITY DEFINER.
- `is_approved(uuid)` SECURITY DEFINER lendo `profiles.approval_status`.
- Leitura de `activities`/`weeks` só para `is_approved`.
- UPDATE de `activities` só nos campos U/V/W por `leader/planning/admin`; coluna X (responsável) sempre setada por trigger no servidor com `auth.uid()`.
- INSERT de atividades IMEDIATAS: só `planning/admin`.
- `activity_history` insert-only via trigger; select para `planning/admin`.
- `user_roles`/aprovação: só `admin`.
- Controle otimista via coluna `version` incrementada em trigger BEFORE UPDATE; conflito detectado comparando versão enviada.

Índices: `(week_id, is_active)`, `order_number`, `note_number`, GIN em `to_tsvector(description)`, `scheduled_date`, `status`, `area`, `sync_status`, `updated_at`.

Seed: 25+ atividades fictícias em uma semana ativa (`Semana 030/2026`), incluindo 2 IMEDIATAS e mix de status.

## Rotas (file-based)

- `/` — landing pública com CTA login (redireciona autenticados aprovados para `/atividades`).
- `/auth` — cadastro/login (Lovable Cloud email/senha).
- `/aguardando-aprovacao` — tela para pending/blocked.
- `/_authenticated/atividades` — tela principal (KPIs, busca, filtros, tabela/cartões, apontamento, lote).
- `/_authenticated/historico` — semanas anteriores + auditoria (planning/admin).
- `/_authenticated/planejamento` — importar/ativar semana, IMEDIATAS, pendências sync (planning/admin).
- `/_authenticated/admin/usuarios` — aprovação e perfis (admin).
- `/_authenticated/admin/sharepoint` — configuração do conector (admin).

Guardas por perfil em `beforeLoad` + verificação no servidor.

## Server Functions

- `updateActivity` — apontamento individual com checagem de versão, grava histórico, enfileira `sync_job`.
- `bulkUpdateActivities` — lote transacional.
- `createImmediateActivity` — só planning/admin.
- `importWeek` — cria `weeks` + `activities` a partir de payload validado (modo demo: gera fictícios; modo real: chama Graph).
- `approveUser` / `setUserRole` — admin.
- `retrySyncJob`, `listSyncJobs` — planning/admin.
- `graphReadWorkbook` / `graphPatchRange` — helpers server-only usando `callAsAppUser` do conector Microsoft Excel (App User) OU app connector workspace, conforme conta autorizada.

## Sincronização SharePoint

- **Modo demo padrão**: `sharepoint_config.enabled=false`; apontamentos marcam `sync_status='synced'` (fictício) sem chamar Graph.
- **Modo real**: apontamento cria `sync_job` pendente; server function processa com backoff exponencial, atualiza colunas U/V/W/X via PATCH range, idempotência por `(week_id, source_key, version)`.
- Antes de habilitar real, tela exibe permissões necessárias (`Files.ReadWrite`, `Sites.ReadWrite.All`) e conta requerida.

## Ordem de execução

1. Habilitar Lovable Cloud.
2. Migração: enums, tabelas, RLS, funções, triggers, seed.
3. Design system em `styles.css` + shell (`__root`, header, layout autenticado).
4. Auth (cadastro/login/aguardando aprovação) + guarda `_authenticated`.
5. Tela principal: KPIs, busca, filtros, tabela desktop + cartões mobile, paginação.
6. Modal apontar (individual) com validação de justificativa + controle otimista.
7. Seleção em lote + confirmação.
8. Histórico e auditoria.
9. Painel planejamento: IMEDIATAS, importar/ativar semana (modo demo), pendências sync.
10. Admin: aprovação de usuários, atribuição de perfis.
11. Configuração SharePoint (tela + stubs Graph desabilitados por padrão).
12. Sitemap/robots, metadata head, publicar prévia.

## Observações

- Sem login Microsoft para usuários finais nesta versão.
- Nenhum token no navegador; chamadas Graph só em server functions.
- Sem dados reais durante construção.
- Acessibilidade: navegação por teclado, contraste AA, labels ARIA.

Confirma o plano para eu iniciar pela etapa 1 (habilitar Cloud + migração + auth)?
