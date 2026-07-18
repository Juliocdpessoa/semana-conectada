import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createImmediateActivity } from "@/lib/activities.functions";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import type { SessionInfo } from "../_authenticated";

export const Route = createFileRoute("/_authenticated/planejamento")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (s.role !== "planning" && s.role !== "admin") throw redirect({ to: "/atividades" });
  },
  component: PlanejamentoPage,
});

function PlanejamentoPage() {
  const qc = useQueryClient();
  const [showImm, setShowImm] = useState(false);
  const week = useQuery({
    queryKey: ["active-week"],
    queryFn: async () => (await supabase.from("weeks").select("*").eq("is_active", true).maybeSingle()).data,
  });
  const pending = useQuery({
    queryKey: ["sync-pending"],
    queryFn: async () => (await supabase.from("activities").select("id, order_number, description, sync_status, sync_error").neq("sync_status", "synced")).data ?? [],
  });

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold text-foreground">Painel do Planejamento</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Gerencie a semana ativa, cadastre IMEDIATAS e acompanhe sincronizações.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Semana ativa</h2>
          <div className="mt-2 text-lg font-semibold">{week.data?.label ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{week.data?.start_date} a {week.data?.end_date}</div>
          <p className="mt-3 text-xs text-muted-foreground">
            A importação real da planilha do SharePoint fica disponível após configurar
            a integração Microsoft na tela de Administração. No modo demonstração a
            semana já vem populada.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Atividades IMEDIATAS</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Somente planejamento/administrador pode cadastrar.
          </p>
          <button
            onClick={() => setShowImm(true)}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground hover:opacity-90"
          >
            <Zap className="h-4 w-4" /> Cadastrar IMEDIATA
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Sincronização pendente</h2>
        {pending.data && pending.data.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr><th className="px-2 py-2 text-left">Ordem</th><th className="px-2 py-2 text-left">Descrição</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Erro</th></tr>
              </thead>
              <tbody>
                {pending.data.map((r: any) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="px-2 py-2 font-mono text-xs">{r.order_number}</td>
                    <td className="px-2 py-2">{r.description}</td>
                    <td className="px-2 py-2">{r.sync_status}</td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">{r.sync_error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Nenhuma sincronização pendente. No modo demonstração todos os apontamentos são marcados como sincronizados localmente.
          </div>
        )}
      </div>

      {showImm && week.data && (
        <ImmediateModal weekId={week.data.id} onClose={() => setShowImm(false)} onSaved={() => { setShowImm(false); qc.invalidateQueries({ queryKey: ["activities"] }); toast.success("IMEDIATA cadastrada."); }} />
      )}
    </main>
  );
}

function ImmediateModal({ weekId, onClose, onSaved }: { weekId: string; onClose: () => void; onSaved: () => void }) {
  const [order, setOrder] = useState("");
  const [note, setNote] = useState("");
  const [desc, setDesc] = useState("");
  const [area, setArea] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const call = useServerFn(createImmediateActivity);

  async function save() {
    if (!order.trim() || !desc.trim()) return toast.error("Ordem e descrição são obrigatórios.");
    setSaving(true);
    try {
      const res = await call({
        data: {
          weekId,
          order_number: order.trim(),
          note_number: note.trim() || null,
          description: desc.trim(),
          area: area.trim() || null,
          specialty: specialty.trim() || null,
          scheduled_date: date || null,
        },
      });
      if (!res.ok) return toast.error(res.error);
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">Cadastrar atividade IMEDIATA</h2>
        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ordem *"><input value={order} onChange={(e) => setOrder(e.target.value)} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" /></Field>
            <Field label="Nota"><input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" /></Field>
          </div>
          <Field label="Descrição *"><input value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Área"><input value={area} onChange={(e) => setArea(e.target.value)} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" /></Field>
            <Field label="Especialidade"><input value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" /></Field>
          </div>
          <Field label="Data"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">Cancelar</button>
          <button onClick={save} disabled={saving} className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60">
            {saving ? "Salvando..." : "Cadastrar IMEDIATA"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<label className="block"><span className="mb-1 block text-xs font-medium">{label}</span>{children}</label>);
}
