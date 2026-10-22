import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard, Modal } from "@/components/ui-kit";
import {
  summarizeActivityCapacity,
  capacityOverloadList,
  type ActivityCapacity,
} from "@/lib/activity-capacity";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

const hours = (value: number) =>
  `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)} h`;
const dateLabel = (value: string | null) =>
  value ? value.split("-").reverse().join("/") : "Sem data";

export function notifyActivityCapacity(result: {
  capacityWarnings?: string[];
  capacityCheckFailed?: boolean;
}) {
  if (result.capacityWarnings?.length) {
    const warnings = result.capacityWarnings;
    toast.warning("Alteração salva — atenção à capacidade", {
      description:
        warnings.slice(0, 3).join(" ") +
        (warnings.length > 3
          ? ` Mais ${warnings.length - 3} alerta(s); consulte o cartão de capacidade.`
          : ""),
      duration: 12_000,
    });
  }
  if (result.capacityCheckFailed)
    toast.warning("Alteração salva, mas não foi possível conferir a capacidade.", {
      description: "Atualize o cartão de capacidade para verificar a sobrecarga.",
      duration: 10_000,
    });
}

export function ActivityCapacityCard({
  weekId,
  userId,
  worksiteId,
  centers,
  dates,
}: {
  weekId?: string;
  userId: string;
  worksiteId: string | null;
  centers: string[];
  dates: string[];
}) {
  const [open, setOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(0);
  const capacity = useQuery({
    queryKey: ["activities", weekId, "daily-capacity", userId, worksiteId],
    enabled: Boolean(weekId),
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await (supabase as any)
        .rpc("get_activity_daily_capacity", { p_week_id: weekId })
        .abortSignal(signal);
      if (error) throw error;
      return data as ActivityCapacity;
    },
  });
  const summary = capacity.data ? summarizeActivityCapacity(capacity.data, centers, dates) : null;
  const partial = Boolean(summary?.unknown.length);
  const value = capacity.isPending
    ? "Carregando…"
    : capacity.isError
      ? "Indisponível"
      : !capacity.data?.hasAvailability
        ? "Sem base"
        : partial && !summary?.rows.some((row) => row.excess !== null)
          ? "Indisponível"
          : `${partial ? "≥ " : ""}${hours(summary?.excess ?? 0)}`;
  const hint = capacity.isError
    ? "Falha na consulta · clique para tentar"
    : !capacity.data?.hasAvailability
      ? "Disponibilidade não cadastrada"
      : `${summary?.overloaded.length ?? 0} centro/dia com excesso${partial ? ` · ${summary?.unknown.length} sem conferência` : ""}`;
  const rows =
    summary?.rows.filter((row) => showAll || row.excess === null || row.excess > 1e-8) ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const visiblePage = Math.min(page, pages - 1);
  const hoverRows = capacityOverloadList(summary?.rows ?? []);
  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip open={!open && hoverOpen} onOpenChange={setHoverOpen}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="rounded-md text-left transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-label={`HH acima da capacidade: ${value}. Ver centros de trabalho e detalhamento.`}
              onClick={() => {
                setHoverOpen(false);
                setOpen(true);
                setPage(0);
                if (capacity.isError) void capacity.refetch();
              }}
            >
              <KpiCard
                label="HH acima da capacidade"
                value={value}
                hint={hint}
                tone={(summary?.excess ?? 0) > 0 || partial ? "warning" : "default"}
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            sideOffset={8}
            className="w-80 max-w-[calc(100vw-2rem)] border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            <p className="font-semibold">Centros acima da capacidade</p>
            <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
              {dates.length === 1 ? dateLabel(dates[0]) : "Dias selecionados ou semana completa"} ·
              excesso de HH
            </p>
            {capacity.isPending ? (
              <p>Carregando capacidade…</p>
            ) : capacity.isError ? (
              <p>Não foi possível conferir a capacidade. Clique para atualizar.</p>
            ) : !capacity.data?.hasAvailability ? (
              <p>Disponibilidade não cadastrada nesta semana.</p>
            ) : (
              <>
                {hoverRows.length > 0 ? (
                  <ul
                    className="max-h-64 space-y-1.5 overflow-y-auto pr-1"
                    aria-label="Centros sobrecarregados"
                  >
                    {hoverRows.map((row) => (
                      <li
                        key={JSON.stringify([row.center, row.date])}
                        className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1"
                      >
                        <span className="min-w-0 break-words font-medium">
                          {row.center}
                          {dates.length !== 1 && (
                            <span className="ml-1 font-normal text-muted-foreground">
                              · {dateLabel(row.date)}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-semibold text-warning-foreground">
                          +{hours(row.excess!)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Nenhum centro acima da capacidade no recorte selecionado.</p>
                )}
                {partial && (
                  <p className="mt-2 text-[11px] text-warning-foreground">
                    Há {summary?.unknown.length} centro/dia sem conferência. A lista inclui somente
                    excessos conhecidos.
                  </p>
                )}
              </>
            )}
            <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
              Respeita os filtros de centro e data. Clique no cartão para abrir o detalhamento.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {open && (
        <Modal
          title="Capacidade por centro de trabalho e dia"
          size="lg"
          onClose={() => setOpen(false)}
          description="Excesso = HH programado − HH disponível, sem compensar sobras de outros centros ou dias."
        >
          <p className="mb-3 text-xs text-muted-foreground">
            Acompanha somente os filtros de centro e data da tela. Inclui Alpinismo e imediatas com
            HH; exclui canceladas. Status, busca e demais filtros não reduzem a carga deste cálculo.
          </p>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => {
                  setShowAll(event.target.checked);
                  setPage(0);
                }}
              />{" "}
              Mostrar também centros/dias sem excesso
            </label>
            <button
              type="button"
              className="btn-outline h-7 px-2 text-xs"
              disabled={capacity.isFetching}
              onClick={() => void capacity.refetch()}
            >
              Atualizar capacidade
            </button>
          </div>
          {capacity.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar a capacidade. Tente atualizar.
            </p>
          ) : capacity.isPending ? (
            <p>Carregando capacidade…</p>
          ) : (
            <>
              {!capacity.data?.hasAvailability && (
                <p role="status" className="mb-3 text-sm text-warning-foreground">
                  Disponibilidade não cadastrada para esta semana. A carga é mostrada sem presumir
                  capacidade zero.
                </p>
              )}
              {partial && (
                <p role="status" className="mb-3 text-xs text-warning-foreground">
                  Há grupos sem disponibilidade, centro/data ou com HH inválido. O excesso conhecido
                  não inclui esses grupos.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      {["Centro", "Dia", "Programado", "Disponível", "Acima da capacidade"].map(
                        (label) => (
                          <th key={label} className="whitespace-nowrap p-2 text-left">
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(visiblePage * 50, (visiblePage + 1) * 50).map((row) => (
                      <tr
                        key={JSON.stringify([row.center, row.date])}
                        className="border-b border-border"
                      >
                        <td className="p-2 font-medium">{row.center || "Sem centro"}</td>
                        <td className="whitespace-nowrap p-2">{dateLabel(row.date)}</td>
                        <td className="p-2">
                          {hours(row.programmed)}
                          {row.invalidHours > 0 && (
                            <span className="block text-warning-foreground">
                              + {row.invalidHours} tarefa(s) com HH inválido
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          {row.available === null ? "Não cadastrada" : hours(row.available)}
                        </td>
                        <td className="p-2 font-semibold text-warning-foreground">
                          {row.excess === null ? "Sem conferência" : hours(row.excess)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length && (
                <p className="py-5 text-center text-sm text-muted-foreground">
                  {summary?.rows.length
                    ? "Nenhuma sobrecarga no recorte selecionado."
                    : "Nenhuma carga ou disponibilidade no recorte selecionado."}
                </p>
              )}
              {pages > 1 && (
                <div className="mt-3 flex items-center justify-between text-xs">
                  <button
                    className="btn-outline"
                    disabled={visiblePage === 0}
                    onClick={() => setPage(visiblePage - 1)}
                  >
                    Anterior
                  </button>
                  <span>
                    {visiblePage + 1} de {pages}
                  </span>
                  <button
                    className="btn-outline"
                    disabled={visiblePage + 1 === pages}
                    onClick={() => setPage(visiblePage + 1)}
                  >
                    Próxima
                  </button>
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                Fonte: tarefas agendadas (coluna Trab) e tabela Disponibilidade HH da semana.
                {capacity.data?.updatedAt
                  ? ` Base alterada em ${new Date(capacity.data.updatedAt).toLocaleString("pt-BR")}.`
                  : ""}
              </p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
