import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { setUserApproval } from "@/lib/activities.functions";
import { createWorksite, setWorksiteMembership } from "@/lib/worksites.functions";
import { resetUserPassword } from "@/lib/password-reset.functions";
import { canResetPassword } from "@/lib/password-reset";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { filterUsersBySearch } from "@/lib/user-search";
import { toast } from "sonner";
import type { SessionInfo } from "../route";
import { PageHeader, Panel, EmptyState } from "@/components/ui-kit";
import { Building2, Search, Users, KeyRound } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (!s.roles.includes("admin") && !s.isWorksiteAdmin) throw redirect({ to: "/atividades" });
  },
  component: AdminUsers,
});

type AppRole = "admin" | "manager" | "planning" | "leader" | "measurement_control" | "logistics" | "operation" | "viewer";

type Row = {
  id: string;
  email: string;
  full_name: string;
  approval_status: "pending" | "approved" | "blocked";
  roles: AppRole[];
  resetAudit?: { event: string; happened_at: string; actor_name: string | null };
  memberships: Array<{ worksite_id: string; is_worksite_admin: boolean }>;
};

type Worksite = { id: string; code: string; name: string };

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "leader", label: "Líder" },
  { value: "manager", label: "Gerente" },
  { value: "planning", label: "Planejamento" },
  { value: "measurement_control", label: "Medição e Controle" },
  { value: "logistics", label: "Logística" },
  { value: "operation", label: "Operação" },
  { value: "viewer", label: "Consulta" },
  { value: "admin", label: "Administrador" },
];

function RoleEditor({ user, onSave }: { user: Row; onSave: (roles: AppRole[]) => Promise<boolean> }) {
  const initial: AppRole[] = user.roles;
  const [selected, setSelected] = useState<AppRole[]>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(user.roles);
  }, [user.roles]);

  const savedKey = [...initial].sort().join("|");
  const selectedKey = [...selected].sort().join("|");
  const changed = savedKey !== selectedKey;

  function toggle(role: AppRole) {
    setSelected((current) =>
      current.includes(role)
        ? current.length === 1
          ? current
          : current.filter((item) => item !== role)
        : [...current, role],
    );
  }

  async function save() {
    setSaving(true);
    await onSave(selected);
    setSaving(false);
  }

  return (
    <div className="min-w-[280px]">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {ROLE_OPTIONS.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label key={option.value} className="flex min-h-7 cursor-pointer items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(option.value)}
                className="h-4 w-4 shrink-0 accent-primary"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={!changed || saving}
        className="btn-primary mt-2 min-h-8 px-3 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {saving ? "Salvando…" : "Salvar perfis"}
      </button>
    </div>
  );
}

function AdminUsers() {
  const { session } = Route.useRouteContext() as { session: SessionInfo };
  const qc = useQueryClient();
  const call = useServerFn(setUserApproval);
  const resetPasswordCall = useServerFn(resetUserPassword);
  const [resetTarget, setResetTarget] = useState<Row | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const createWorksiteCall = useServerFn(createWorksite);
  const membershipCall = useServerFn(setWorksiteMembership);
  const isGlobalAdmin = session.email.trim().toLowerCase() === "julio.pessoa@normatel.com.br";
  const [worksiteCode, setWorksiteCode] = useState("");
  const [worksiteName, setWorksiteName] = useState("");
  const [creatingWorksite, setCreatingWorksite] = useState(false);
  const [allWorksites, setAllWorksites] = useState<Worksite[]>([]);
  const [savingMembership, setSavingMembership] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!isGlobalAdmin) return;
    void (supabase as any).from("worksites").select("id,code,name").eq("is_active", true).order("code")
      .then(({ data }: { data: Worksite[] | null }) => setAllWorksites(data ?? []));
  }, [isGlobalAdmin]);
  const users = useQuery({
    queryKey: ["admin-users", session.worksiteId],
    queryFn: async () => {
      const [pRes, rRes, mRes, auditRes] = await Promise.all([
        (supabase as any)
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.from("user_roles").select("*"),
        (supabase as any).from("worksite_memberships").select("user_id,worksite_id,is_worksite_admin"),
        (supabase as any).from("password_reset_latest").select("user_id,event,happened_at,actor_name"),
      ]);
      const rolesByUser = new Map<string, string[]>();
      (rRes.data ?? []).forEach((r) => {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push(r.role);
        rolesByUser.set(r.user_id, arr);
      });
      const visibleProfiles = isGlobalAdmin
        ? (pRes.data ?? [])
        : (pRes.data ?? []).filter((p: any) => (mRes.data ?? []).some((m: any) =>
            m.user_id === p.id && m.worksite_id === session.worksiteId));
      return visibleProfiles.map((p: any) => ({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        approval_status: p.approval_status,
        roles: rolesByUser.get(p.id) ?? [],
        resetAudit: (auditRes.data ?? []).find((event: any) => event.user_id === p.id),
        memberships: (mRes.data ?? []).filter((m: any) => m.user_id === p.id),
      })) as Row[];
    },
  });

  async function confirmPasswordReset() {
    if (!resetTarget || resettingPassword) return;
    setResettingPassword(true);
    try {
      const result = await resetPasswordCall({ data: { targetUserId: resetTarget.id } });
      if (!result.ok) return toast.error(result.error);
      toast.success("Senha resetada para 123456. O colaborador deverá trocá-la no próximo login. Validade: 24 horas.");
      setResetTarget(null);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch {
      toast.error("Não foi possível confirmar o reset. Atualize a lista antes de tentar novamente.");
    } finally { setResettingPassword(false); }
  }

  async function updateUser(id: string, status: Row["approval_status"], roles?: AppRole[]) {
    const res = await call({ data: { targetUserId: id, approvalStatus: status, roles } });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(roles ? "Perfis atualizados." : "Usuário atualizado.");
    await qc.invalidateQueries({ queryKey: ["admin-users"] });
    return true;
  }

  async function changeMembership(user: Row, worksite: Worksite, enabled: boolean, localAdmin: boolean) {
    const key = `${user.id}:${worksite.id}`;
    setSavingMembership(key);
    const result = await membershipCall({ data: {
      targetUserId: user.id,
      worksiteId: worksite.id,
      enabled,
      isWorksiteAdmin: localAdmin,
    }});
    setSavingMembership(null);
    if (!result.ok) return toast.error(result.error);
    toast.success("Acesso à obra atualizado.");
    await qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  async function addWorksite(event: FormEvent) {
    event.preventDefault();
    setCreatingWorksite(true);
    const result = await createWorksiteCall({
      data: { code: worksiteCode, name: worksiteName },
    });
    setCreatingWorksite(false);
    if (!result.ok) return toast.error(result.error);
    setWorksiteCode("");
    setWorksiteName("");
    toast.success(`Obra ${result.worksite.code} cadastrada.`);
    window.location.reload();
  }

  const total = users.data?.length ?? 0;
  const filteredUsers = useMemo(() => filterUsersBySearch(users.data ?? [], search), [users.data, search]);
  const pending = (users.data ?? []).filter((u) => u.approval_status === "pending").length;

  return (
    <main className="mx-auto max-w-none px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Administração"
        title="Usuários"
        description="Aprove cadastros, defina perfis e controle o acesso às obras."
        meta={
          <>
            <span>{total} usuários</span>
            {pending > 0 && <span className="text-warning-foreground">{pending} aguardando aprovação</span>}
          </>
        }
      />

      {isGlobalAdmin && (
        <Panel
          className="mb-4"
          title={
            <span className="inline-flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Cadastrar obra
            </span>
          }
        >
          <form onSubmit={addWorksite} className="grid gap-3 md:grid-cols-[180px_minmax(280px,1fr)_auto] md:items-end">
            <label className="space-y-1 text-[11px] font-medium">
              <span>Código</span>
              <input
                value={worksiteCode}
                onChange={(event) => setWorksiteCode(event.target.value.toUpperCase())}
                maxLength={20}
                required
                placeholder="Ex.: RPBC"
                className="input-field h-9 w-full"
              />
            </label>
            <label className="space-y-1 text-[11px] font-medium">
              <span>Nome da obra</span>
              <input
                value={worksiteName}
                onChange={(event) => setWorksiteName(event.target.value)}
                maxLength={160}
                required
                placeholder="Nome completo da obra"
                className="input-field h-9 w-full"
              />
            </label>
            <button type="submit" disabled={creatingWorksite} className="btn-primary h-9 px-4 text-[12px] disabled:opacity-60">
              {creatingWorksite ? "Cadastrando…" : "Cadastrar obra"}
            </button>
          </form>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Novos usuários poderão selecionar a obra no cadastro. Cada obra mantém dados e colaboradores separados.
          </p>
        </Panel>
      )}

      <Panel title={`Usuários · ${session.worksiteCode}`} padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
          <div className="w-full sm:max-w-md">
            <label htmlFor="user-search" className="mb-1 block text-[11px] font-medium">Buscar usuários</label>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input id="user-search" type="search" value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome ou e-mail…"
                className="input-field h-9 w-full pl-9" />
            </div>
          </div>
          {search && <button type="button" onClick={() => setSearch("")} className="btn-ghost h-9 text-xs">Limpar busca</button>}
          <span role="status" className="pb-2 text-xs text-muted-foreground">
            {users.isLoading ? "Carregando usuários…" : `${filteredUsers.length} de ${total} usuários`}
          </span>
        </div>
        {filteredUsers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Nome</th>
                  <th className="px-3 py-2 text-left font-semibold">E-mail</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Perfil</th>
                  {isGlobalAdmin && <th className="px-3 py-2 text-left font-semibold">Obras e administração local</th>}
                  <th className="px-3 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="row-zebra">
                    <td className="px-3 py-2">{u.full_name || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">{u.email}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`status-pill ${
                          u.approval_status === "approved"
                            ? "border-success/40 bg-success/10 text-success"
                            : u.approval_status === "pending"
                              ? "border-warning/40 bg-warning/15 text-warning-foreground"
                              : "border-destructive/40 bg-destructive/10 text-destructive"
                        }`}
                      >
                        {u.approval_status === "approved"
                          ? "Aprovado"
                          : u.approval_status === "pending"
                            ? "Pendente"
                            : "Bloqueado"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      <RoleEditor user={u} onSave={(roles) => updateUser(u.id, u.approval_status, roles)} />
                    </td>
                    {isGlobalAdmin && (
                      <td className="min-w-[300px] px-3 py-2 align-top text-[11px]">
                        <div className="space-y-2">
                          {allWorksites.map((worksite) => {
                            const membership = u.memberships.find((m) => m.worksite_id === worksite.id);
                            const busy = savingMembership === `${u.id}:${worksite.id}`;
                            return (
                              <div key={worksite.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 px-2 py-1.5">
                                <label className="flex cursor-pointer items-center gap-1.5 font-medium">
                                  <input type="checkbox" checked={Boolean(membership)} disabled={busy}
                                    onChange={(e) => void changeMembership(u, worksite, e.target.checked, false)} />
                                  {worksite.code}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                                  <input type="checkbox" checked={membership?.is_worksite_admin ?? false}
                                    disabled={!membership || busy}
                                    onChange={(e) => void changeMembership(u, worksite, true, e.target.checked)} />
                                  Administrador da obra
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {(() => {
                          const actor = users.data?.find((row) => row.id === session.userId);
                          return actor && canResetPassword(actor, u, session.worksiteId) ? (
                            <button type="button" onClick={() => setResetTarget(u)} className="btn-ghost py-1 text-[11px]">
                              <KeyRound className="mr-1 h-3.5 w-3.5" /> Resetar senha
                            </button>
                          ) : null;
                        })()}
                        {u.approval_status !== "approved" && (
                          <button onClick={() => updateUser(u.id, "approved")} className="btn-success py-1 text-[11px]">
                            Aprovar
                          </button>
                        )}
                        {u.approval_status !== "blocked" && (
                          <button
                            onClick={() => updateUser(u.id, "blocked")}
                            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/15"
                          >
                            Bloquear
                          </button>
                        )}
                      </div>
                      {u.resetAudit && <p className="mt-1 max-w-[260px] text-[10px] text-muted-foreground">
                        {u.resetAudit.event === "completed" ? "Senha alterada pelo usuário" : "Troca de senha pendente"}
                        {" · "}{new Date(u.resetAudit.happened_at).toLocaleString("pt-BR")}
                        {u.resetAudit.actor_name ? ` · ${u.resetAudit.actor_name}` : ""}
                      </p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState icon={<Users className="h-4 w-4" />}
              title={users.isLoading ? "Carregando usuários…" : users.isError ? "Não foi possível carregar os usuários" : search.trim() ? "Nenhum usuário encontrado" : "Nenhum usuário cadastrado"}
              description={search.trim() && !users.isLoading && !users.isError ? "Tente outro nome ou e-mail, ou limpe a busca." : undefined} />
          </div>
        )}
      </Panel>

      <AlertDialog open={Boolean(resetTarget)} onOpenChange={(open) => { if (!open && !resettingPassword) setResetTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resetar senha de {resetTarget?.full_name || resetTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              A senha atual será substituída por 123456, válida por 24 horas. Avise o colaborador por um canal seguro.
              Ele deverá definir uma nova senha antes de acessar o NEXO. O reset não aprova nem desbloqueia cadastros.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resettingPassword}>Cancelar</AlertDialogCancel>
            <button type="button" disabled={resettingPassword} onClick={() => void confirmPasswordReset()} className="btn-primary">
              {resettingPassword ? "Resetando…" : "Confirmar reset"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="mt-4 text-[11px] text-muted-foreground">
        Para se tornar o primeiro administrador, cadastre-se pela tela de login e peça a um administrador existente que
        promova seu perfil.
      </p>
    </main>
  );
}

