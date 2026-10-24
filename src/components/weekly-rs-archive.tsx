import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Modal } from "@/components/ui-kit";
import { WeeklySapLoadHistory } from "@/components/weekly-sap-load-history";

export type RsClosure = {
  id: string;
  version: number;
  closed_at: string;
  closed_by_name: string;
  reason: string;
  rule_version: string;
  summary?: Record<string, unknown>;
  week_info?: { code?: string; label?: string; start_date?: string; end_date?: string };
};
type Catalog = { status: string; deadline: string | null; versions: RsClosure[] };
const kinds = [
  "activity",
  "sap",
  "sap_import",
  "availability",
  "activity_history",
  "availability_history",
] as const;
const sheets = [
  "Atividades",
  "Apropriações SAP",
  "Carga oficial SAP",
  "Disponibilidade",
  "Histórico atividades",
  "Histórico disponibilidade",
];
export function WeeklyRsArchive({
  weekId,
  userId,
  worksiteId,
  isAdmin,
  version,
  onVersion,
  closure,
  isFrozen,
  legacy,
  deadlinePassed,
}: {
  weekId: string;
  userId: string;
  worksiteId: string;
  isAdmin: boolean;
  version: number | null;
  onVersion: (v: number | null) => void;
  closure?: RsClosure | null;
  isFrozen?: boolean;
  legacy?: boolean;
  deadlinePassed?: boolean;
}) {
  const qc = useQueryClient();
  const [action, setAction] = useState<"close" | "reopen" | "extend" | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const catalog = useQuery({
    queryKey: ["weekly-rs-closures", userId, worksiteId, weekId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_weekly_rs_closures", {
        p_week_id: weekId,
      });
      if (error) throw error;
      return data as Catalog;
    },
  });
  async function save() {
    if (!action || reason.trim().length < 3 || busy) return;
    if (
      action === "extend" &&
      (!deadline ||
        !Number.isFinite(new Date(deadline).getTime()) ||
        new Date(deadline).getTime() <= Date.now() ||
        (catalog.data?.deadline &&
          new Date(deadline).getTime() <= new Date(catalog.data.deadline).getTime()))
    ) {
      toast.error("Informe um prazo futuro e posterior ao prazo vigente.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc(
        action === "close"
          ? "close_sap_week"
          : action === "extend"
            ? "extend_sap_week_deadline"
            : "reopen_sap_week",
        {
          p_week_id: weekId,
          p_reason: reason.trim(),
          ...(action === "extend" ? { p_deadline: new Date(deadline).toISOString() } : {}),
        },
      );
      if (error) throw error;
      toast.success(
        action === "close"
          ? "Fechamento SAP + RS preservado em nova versão."
          : action === "extend"
            ? "Prazo prorrogado. As versões anteriores continuam preservadas."
            : "Semana reaberta. As versões anteriores continuam preservadas.",
      );
      setAction(null);
      setReason("");
      onVersion(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["weekly-rs"] }),
        qc.invalidateQueries({ queryKey: ["weekly-rs-closures"] }),
        qc.invalidateQueries({ queryKey: ["weekly-rs-weeks"] }),
        qc.invalidateQueries({ queryKey: ["weeks-list"] }),
        qc.invalidateQueries({ queryKey: ["activity-working-weeks"] }),
        qc.invalidateQueries({ queryKey: ["active-week"] }),
        qc.invalidateQueries({ queryKey: ["sap-confirmation-overview"] }),
      ]);
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível concluir a ação.");
    } finally {
      setBusy(false);
    }
  }
  async function download(format: "xlsx" | "json") {
    if (!closure || exporting) return;
    setExporting(true);
    try {
      const scopes: Record<string, unknown> = {};
      for (const local of [null, "IARI", "ROTINA"]) {
        const { data, error } = await (supabase as any).rpc("get_weekly_rs_report", {
          p_week_id: weekId,
          p_local: local,
          p_version: closure.version,
        });
        if (error) throw error;
        scopes[local ?? "ALL"] = data;
      }
      const records: Record<string, Record<string, unknown>[]> = {};
      for (const kind of kinds) {
        const rows: Record<string, unknown>[] = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await (supabase as any).rpc("get_weekly_rs_closure_items", {
            p_closure_id: closure.id,
            p_kind: kind,
            p_offset: offset,
            p_limit: 500,
          });
          if (error) throw error;
          rows.push(...data.rows);
          if (rows.length >= data.total) break;
        }
        records[kind] = rows;
      }
      const filename = `RS-${(closure.week_info?.code || weekId).replace(/[^\p{L}\p{N}._-]+/gu, "-")}-v${closure.version}`;
      if (format === "json") {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify({ closure, scopes, records }, null, 2)], {
            type: "application/json",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = filename + ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const XLSX = await import("xlsx");
        const workbook = XLSX.utils.book_new();
        const flat = (r: Record<string, unknown>) =>
          Object.fromEntries(
            Object.entries(r).map(([key, value]) => {
              const cell =
                value !== null && typeof value === "object" ? JSON.stringify(value) : value;
              if (typeof cell === "string" && cell.length > 32767)
                throw new Error(
                  "Um campo ultrapassa o limite do Excel. Use Arquivo completo JSON para preservar todos os dados.",
                );
              return [key, cell];
            }),
          );
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet([flat(closure as unknown as Record<string, unknown>)]),
          "Fechamento",
        );
        for (const [local, data] of Object.entries(scopes) as [string, any][]) {
          XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet([
              flat({
                ...data.frozenCalculation.result,
                rule_version: closure.rule_version,
                rules: data.rules,
                week: closure.week_info,
              }),
            ]),
            `Memória ${local}`,
          );
          XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet(data.frozenCalculation.rows.map(flat)),
            `RS ${local}`,
          );
          XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet(data.frozenCalculation.centerRows.map(flat)),
            `Centros ${local}`,
          );
        }
        kinds.forEach((kind, i) =>
          XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.json_to_sheet(
              records[kind].flatMap((record) => {
                if (kind === "activity") {
                  const { planning_data, archived_evidence, ...activity } = record;
                  const fields = (prefix: string, value: unknown) =>
                    value && typeof value === "object" && !Array.isArray(value)
                      ? Object.fromEntries(
                          Object.entries(value).map(([key, cell]) => [prefix + key, cell]),
                        )
                      : { [prefix + "dados"]: value };
                  return [
                    flat({
                      ...activity,
                      ...fields("Programação · ", planning_data),
                      ...fields("Conferência · ", archived_evidence),
                    }),
                  ];
                }
                if (kind !== "availability" && kind !== "availability_history")
                  return [flat(record)];
                const { rows, ...metadata } = record;
                return Array.isArray(rows)
                  ? rows.map((row) => flat({ ...metadata, ...row }))
                  : [flat(record)];
              }),
            ),
            sheets[i],
          ),
        );
        XLSX.writeFile(workbook, filename + ".xlsx");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível exportar o fechamento.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <div className="min-w-0">
        <span className="mb-1 block text-xs font-medium">
          {isFrozen
            ? `Fechado · versão ${closure?.version}`
            : legacy
              ? "Semana encerrada"
              : "Em apuração"}
        </span>
        <button
          type="button"
          className="input-base flex w-full items-center justify-between gap-2 text-left text-xs"
          onClick={() => setControlsOpen(true)}
        >
          <span className="truncate">
            {catalog.data?.deadline && !isFrozen
              ? `Prazo: ${new Date(catalog.data.deadline).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · Brasília`
              : "Versões e histórico SAP"}
          </span>
          <span className="shrink-0 font-medium text-primary">Gerenciar</span>
        </button>
      </div>
      {controlsOpen && (
        <Modal
          title="Apuração semanal · versões e controles"
          onClose={() => setControlsOpen(false)}
        >
          <section aria-label="Apuração semanal" className="surface-card min-w-0 p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2 className="text-[13px] font-semibold">
                {isFrozen
                  ? `Fechado · versão ${closure?.version}`
                  : legacy
                    ? "Semana encerrada sem versão preservada"
                    : "Em apuração"}
              </h2>
              <div className="contents [&>p]:mb-0">
                {closure && (
                  <p className="mb-3 text-xs">
                    Fechado em {new Date(closure.closed_at).toLocaleString("pt-BR")} por{" "}
                    {closure.closed_by_name} · Motivo: {closure.reason} · Regra:{" "}
                    {closure.rule_version}
                  </p>
                )}
                {catalog.data?.deadline && !isFrozen && (
                  <p className="mb-3 text-xs text-muted-foreground">
                    Prazo vigente:{" "}
                    {new Date(catalog.data.deadline).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}{" "}
                    (Brasília)
                  </p>
                )}
                {legacy && (
                  <p className="mb-3 text-xs text-amber-800 dark:text-amber-300">
                    Este encerramento é anterior ao histórico versionado. Os valores abaixo são uma
                    consulta recalculada, não um resultado oficial congelado. Não reconstruímos
                    dados de cargas já removidas.
                  </p>
                )}
                {!isFrozen && deadlinePassed && !legacy && (
                  <p className="mb-3 text-xs text-amber-800 dark:text-amber-300">
                    Prazo de apropriação encerrado. O administrador deve conferir e usar Fechar
                    agora para consolidar o resultado oficial. O prazo sozinho não cria uma versão
                    preservada.
                  </p>
                )}
              </div>
              {catalog.isError ? (
                <p role="alert" className="text-xs text-destructive">
                  Falha ao carregar versões.{" "}
                  <button className="underline" onClick={() => catalog.refetch()}>
                    Tentar novamente
                  </button>
                </p>
              ) : (
                <div className="flex min-w-0 flex-wrap items-center gap-2 lg:ml-auto">
                  <label className="w-full min-w-0 text-xs sm:w-64">
                    <span className="sr-only">Versão da consulta</span>
                    <select
                      className="input-base"
                      value={version ?? ""}
                      onChange={(e) => onVersion(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">
                        {catalog.data?.status === "closed"
                          ? "Último fechamento disponível"
                          : "Apuração atual"}
                      </option>
                      {catalog.data?.versions.map((v) => (
                        <option key={v.id} value={v.version}>
                          Versão {v.version} · {new Date(v.closed_at).toLocaleDateString("pt-BR")} ·{" "}
                          {v.closed_by_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {isAdmin && catalog.data && (
                    <>
                      <button
                        className="btn-outline text-xs"
                        onClick={() => {
                          setReason("");
                          setAction(catalog.data.status === "closed" ? "reopen" : "close");
                        setControlsOpen(false);
                        }}
                      >
                        {catalog.data.status === "closed" ? "Reabrir fechamento" : "Fechar agora"}
                      </button>
                      {catalog.data.status !== "closed" && (
                        <button
                          className="btn-outline text-xs"
                          onClick={() => {
                            setReason("");
                            const date = new Date(
                              Math.max(Date.now(), new Date(catalog.data.deadline ?? 0).getTime()) +
                                2 * 3600000,
                            );
                            setDeadline(
                              new Date(date.getTime() - date.getTimezoneOffset() * 60000)
                                .toISOString()
                                .slice(0, 16),
                            );
                            setAction("extend");
                          setControlsOpen(false);
                          }}
                        >
                          Prorrogar prazo
                        </button>
                      )}
                    </>
                  )}
                  {closure && (
                    <>
                      <button
                        className="btn-outline text-xs"
                        disabled={exporting}
                        onClick={() => download("xlsx")}
                      >
                        {exporting ? "Preparando…" : "Exportar fechamento Excel"}
                      </button>
                      <button
                        className="btn-ghost text-xs"
                        disabled={exporting}
                        onClick={() => download("json")}
                      >
                        Arquivo completo JSON
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <WeeklySapLoadHistory weekId={weekId} userId={userId} worksiteId={worksiteId} />
          </section>
        </Modal>
      )}
      {action && (
        <Modal
          title={
            action === "close"
              ? "Fechar semana · SAP + RS"
              : action === "extend"
                ? "Prorrogar prazo SAP"
                : "Reabrir fechamento"
          }
          onClose={() => {
            if (!busy) setAction(null);
          }}
          footer={
            <button
              className="btn-primary"
              disabled={busy || reason.trim().length < 3}
              onClick={save}
            >
              {busy ? "Salvando…" : "Confirmar"}
            </button>
          }
        >
          <p className="mb-3 text-xs">
            {action === "close"
              ? "O resultado oficial será congelado junto da carga SAP, programação, disponibilidade e justificativas."
              : action === "extend"
                ? "A apuração continuará aberta até o novo prazo. Os fechamentos anteriores não serão alterados."
                : "A versão anterior será mantida. O próximo fechamento criará uma nova versão com a regra vigente."}
          </p>
          {action === "extend" && (
            <label className="mb-3 block text-xs">
              Novo prazo (horário deste dispositivo)
              <input
                className="input-base mt-1"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                disabled={busy}
              />
            </label>
          )}
          <label className="text-xs">
            Justificativa obrigatória
            <textarea
              className="input-base mt-1"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </Modal>
      )}
    </>
  );
}
