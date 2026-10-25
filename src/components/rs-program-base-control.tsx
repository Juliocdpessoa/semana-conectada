import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Modal } from "@/components/ui-kit";
import { availabilityKey } from "@/lib/weekly-availability";
import {
  parseRsProgramGrid,
  RS_PROGRAM_SHEET,
  type RsProgramBasis,
  type RsProgramRow,
} from "@/lib/rs-program-base";

export function RsProgramBaseControl({
  weekId,
  weekLabel,
  basis,
  readOnly,
  onSaved,
}: {
  weekId: string;
  weekLabel: string;
  basis?: RsProgramBasis;
  readOnly: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{
    name: string;
    sheet: string;
    rows: RsProgramRow[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  async function read(file: File) {
    if (readOnly || busy) return;
    setPreview(null);
    setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Use um arquivo de até 10 MB.");
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheet =
        book.SheetNames.find(
          (name) => availabilityKey(name) === availabilityKey(RS_PROGRAM_SHEET),
        ) ?? (book.SheetNames.length === 1 ? book.SheetNames[0] : null);
      if (!sheet) throw new Error("Identifique a aba original do SAP como Programação SAP.");
      const rows = parseRsProgramGrid(
        XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], {
          header: 1,
          defval: null,
          raw: true,
        }),
      );
      setPreview({ name: file.name, sheet, rows });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ler a base oficial.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function save() {
    if (!preview || busy || readOnly) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("save_weekly_rs_program_base", {
        p_week_id: weekId,
        p_rows: preview.rows,
        p_source_file_name: preview.name,
        p_sheet_name: preview.sheet,
        p_expected_version: basis?.kind === "official" ? (basis.version ?? 0) : 0,
      });
      if (error) throw error;
      setPreview(null);
      await onSaved();
      toast.success("Base oficial do RS salva. Atividades, status e PTs não foram alterados.");
    } catch (error) {
      toast.error(
        (error as { message?: string })?.message ?? "Não foi possível salvar a base oficial.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <p className="min-w-0 text-muted-foreground">
        {basis?.kind === "official" ? (
          <>
            Base programada RS: versão {basis.version} · {basis.row_count} confirmações ·{" "}
            {basis.total_work?.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} HH brutos ·{" "}
            {basis.source_file_name} · {basis.updated_by_name}
            {basis.updated_at ? ` · ${new Date(basis.updated_at).toLocaleString("pt-BR")}` : ""}
          </>
        ) : (
          <span className="text-warning-foreground">
            Sem base oficial SAP: o RS usa a programação operacional desta semana.
          </span>
        )}
      </p>
      {!readOnly && (
        <>
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xls"
            className="sr-only"
            aria-label="Importar base programada oficial do RS"
            onChange={(event) => {
              if (event.target.files?.[0]) void read(event.target.files[0]);
            }}
          />
          <button
            type="button"
            className="btn-ghost shrink-0 text-xs"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {busy ? "Processando…" : "Importar base oficial RS"}
          </button>
        </>
      )}
      {preview && (
        <Modal
          title="Confirmar base oficial do RS"
          onClose={() => {
            if (!busy) setPreview(null);
          }}
          footer={
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Salvando…" : "Confirmar base da semana"}
            </button>
          }
        >
          <div className="space-y-3 text-sm">
            <p>
              <strong>Semana selecionada: {weekLabel}</strong>
            </p>
            <p>
              {preview.rows.length} confirmações ·{" "}
              {preview.rows
                .reduce((sum, row) => sum + row.work, 0)
                .toLocaleString("pt-BR", { maximumFractionDigits: 2 })}{" "}
              HH brutos · {preview.name}
            </p>
            <p>
              A coluna Trabalho será considerada integralmente nesta semana. As datas da planilha
              não rateiam nem transferem HH para outras semanas.
            </p>
            <p>
              Esta ação substitui somente a base programada do RS. A versão anterior fica
              registrada. A programação diária, seus status e PTs permanecem intactos.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
