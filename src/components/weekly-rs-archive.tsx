import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Modal } from "@/components/ui-kit";
import { WeeklySapLoadHistory } from "@/components/weekly-sap-load-history";

export type RsClosure = {
  id: string;
  version: number;
  closed_at: string;
  closed_by_name: string;
  reason: string;
  rule_version: string;
  summary?: Record<string, unknown>;
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
  const [action, setAction] = useState<"close" | "reopen" | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
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
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc(
        action === "close" ? "close_sap_week" : "reopen_sap_week",
        { p_week_id: weekId, p_reason: reason.trim() },
      );
      if (error) throw error;
      toast.success(
        action === "close"
          ? "Fechamento SAP + RS preservado em nova versão."
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
      const filename = `RS-${weekId}-v${closure.version}`;
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
                week: data.week,
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
      <Panel
        title={
          isFrozen
            ? `Fechado · versão ${closure?.version}`
            : legacy
              ? "Semana encerrada sem versão preservada"
              : "Em apuração"
        }
      >
        {closure && (
          <p className="mb-3 text-xs">
            Fechado em {new Date(closure.closed_at).toLocaleString("pt-BR")} por{" "}
            {closure.closed_by_name} · Motivo: {closure.reason} · Regra: {closure.rule_version}
          </p>
        )}
        {legacy && (
          <p className="mb-3 text-xs text-amber-800 dark:text-amber-300">
            Este encerramento é anterior ao histórico versionado. Os valores abaixo são uma consulta
            recalculada, não um resultado oficial congelado. Não reconstruímos dados de cargas já
            removidas.
          </p>
        )}
        {!isFrozen && deadlinePassed && !legacy && (
          <p className="mb-3 text-xs text-amber-800 dark:text-amber-300">
            Prazo de apropriação encerrado. O administrador deve conferir e usar Fechar agora para
            consolidar o resultado oficial. O prazo sozinho não cria uma versão preservada.
          </p>
        )}
        {!isFrozen && !legacy && (
          <p className="mb-3 text-xs text-muted-foreground">
            A última carga SAP atualiza esta apuração. Ao fechar, os resultados e a memória de
            cálculo são preservados. Pendências e justificativas também ficam no arquivo.
          </p>
        )}
        {catalog.isError ? (
          <p role="alert" className="text-xs text-destructive">
            Falha ao carregar versões.{" "}
            <button className="underline" onClick={() => catalog.refetch()}>
              Tentar novamente
            </button>
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              Versão da consulta
              <select
                className="input-base mt-1"
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
              <button
                className="btn-outline text-xs"
                onClick={() => {
                  setReason("");
                  setAction(catalog.data.status === "closed" ? "reopen" : "close");
                }}
              >
                {catalog.data.status === "closed" ? "Reabrir fechamento" : "Fechar agora"}
              </button>
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
        <WeeklySapLoadHistory weekId={weekId} userId={userId} worksiteId={worksiteId} />
      </Panel>
      {action && (
        <Modal
          title={action === "close" ? "Fechar semana · SAP + RS" : "Reabrir fechamento"}
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
              : "A versão anterior será mantida. O próximo fechamento criará uma nova versão com a regra vigente."}
          </p>
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
