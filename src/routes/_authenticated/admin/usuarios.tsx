import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { setUserApproval } from "@/lib/activities.functions";
import { toast } from "sonner";
import type { SessionInfo } from "../route";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (s.role !== "admin") throw redirect({ to: "/atividades" });
  },
  component: AdminUsers,
});

type Row = { id: string; email: string; full_name: string; approval_status: "pending" | "approved" | "blocked"; roles: string[] };

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

  async function updateUser(id: string, status: Row["approval_status"], role?: "admin" | "planning" | "leader" | "viewer") {
    const res = await call({ data: { targetUserId: id, approvalStatus: status, role } });
    if (!res.ok) return toast.error(res.error);
    toast.success("Usuário atualizado.");
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold">Administração de usuários</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Aprove novos cadastros, defina perfis e bloqueie acessos.
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Nome</th>
              <th className="px-3 py-2 text-left">E-mail</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Perfil</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id} className="border-b border-border/60">
                <td className="px-3 py-2">{u.full_name || <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 text-xs">{u.email}</td>
                <td className="px-3 py-2">
                  <span className={`status-pill ${u.approval_status === "approved" ? "border-success/40 bg-success/10 text-success"
                    : u.approval_status === "pending" ? "border-warning/40 bg-warning/10 text-warning-foreground"
                    : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
                    {u.approval_status === "approved" ? "Aprovado" : u.approval_status === "pending" ? "Pendente" : "Bloqueado"}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  <select
                    defaultValue={u.roles[0] ?? "leader"}
                    onChange={(e) => updateUser(u.id, u.approval_status, e.target.value as any)}
                    className="rounded-md border border-input bg-card px-2 py-1 text-xs"
                  >
                    <option value="leader">Líder</option>
                    <option value="planning">Planejamento</option>
                    <option value="viewer">Consulta</option>
                    <option value="admin">Administrador</option>
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    {u.approval_status !== "approved" && (
                      <button onClick={() => updateUser(u.id, "approved")} className="rounded-md bg-success px-2 py-1 text-xs font-medium text-success-foreground">Aprovar</button>
                    )}
                    {u.approval_status !== "blocked" && (
                      <button onClick={() => updateUser(u.id, "blocked")} className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">Bloquear</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Para se tornar o primeiro administrador, cadastre-se pela tela de login e peça
        a um administrador existente que promova seu perfil. Se este é o primeiro
        cadastro do sistema, um administrador pode ser promovido diretamente pelo
        banco de dados.
      </p>
    </main>
  );
}
