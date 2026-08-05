import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { setUserApproval } from "@/lib/activities.functions";
import { toast } from "sonner";
import type { SessionInfo } from "../route";
import { PageHeader, Panel, EmptyState } from "@/components/ui-kit";
import { Users } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (!s.roles.includes("admin")) throw redirect({ to: "/atividades" });
  },
  component: AdminUsers,
});

type AppRole = "admin" | "manager" | "planning" | "leader" | "measurement_control" | "logistics" | "viewer";

type Row = {
  id: string;
  email: string;
  full_name: string;
  approval_status: "pending" | "approved" | "blocked";
  roles: AppRole[];
};

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "leader", label: "Líder" },
  { value: "manager", label: "Gerente" },
  { value: "planning", label: "Planejamento" },
  { value: "measurement_control", label: "Medição e Controle" },
  { value: "logistics", label: "Logística" },
  { value: "viewer", label: "Consulta" },
  { value: "admin", label: "Administrador" },
];

function RoleEditor({ user, onSave }: { user: Row; onSave: (roles: AppRole[]) => Promise<boolean> }) {
  const initial: AppRole[] = user.roles.length > 0 ? user.roles : ["leader"];
  const [selected, setSelected] = useState<AppRole[]>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(user.roles.length > 0 ? user.roles : ["leader"]);
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
  const qc = useQueryClient();
  const call = useServerFn(setUserApproval);
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const [pRes, rRes] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("*"),
      ]);
      const rolesByUser = new Map<string, string[]>();
      (rRes.data ?? []).forEach((r) => {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push(r.role);
        rolesByUser.set(r.user_id, arr);
      });
      return (pRes.data ?? []).map((p) => ({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        approval_status: p.approval_status,
        roles: rolesByUser.get(p.id) ?? [],
      })) as Row[];
    },
  });

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

  const total = users.data?.length ?? 0;
  const pending = (users.data ?? []).filter((u) => u.approval_status === "pending").length;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Administração"
        title="Usuários"
        description="Aprove cadastros, defina perfis e bloqueie acessos."
        meta={
          <>
            <span>{total} usuários</span>
            {pending > 0 && <span className="text-warning-foreground">{pending} aguardando aprovação</span>}
          </>
        }
      />

      <Panel title="Lista de usuários" padded={false}>
        {users.data && users.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Nome</th>
                  <th className="px-3 py-2 text-left font-semibold">E-mail</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Perfil</th>
                  <th className="px-3 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {users.data.map((u) => (
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
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1.5">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState icon={<Users className="h-4 w-4" />} title="Nenhum usuário cadastrado" />
          </div>
        )}
      </Panel>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Para se tornar o primeiro administrador, cadastre-se pela tela de login e peça a um administrador existente que
        promova seu perfil.
      </p>
    </main>
  );
}
