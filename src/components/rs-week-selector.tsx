import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Week = { id: string; code: string; label: string; start_date: string; end_date: string };
export function RsWeekSelector({
  weeks,
  selected,
  onChange,
  loading,
}: {
  weeks: Week[];
  selected: string[];
  onChange: (ids: string[]) => void;
  loading: boolean;
}) {
  const chosen = weeks.filter((week) => selected.includes(week.id));
  const label =
    chosen.length === 1
      ? chosen[0].label
      : chosen.length
        ? `${chosen.length} semanas · ${chosen.map((week) => week.code.match(/^\d+/)?.[0] ?? week.code).join(", ")}`
        : loading
          ? "Carregando…"
          : "Selecione as semanas";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          id="rs-week"
          type="button"
          className="input-base flex h-9 w-full items-center justify-between gap-2 text-left"
          title={chosen.map((week) => week.label).join(" | ")}
          disabled={loading}
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-2">
        <div className="max-h-72 overflow-y-auto">
          {weeks.map((week) => {
            const checked = selected.includes(week.id);
            return (
              <div key={week.id} className="flex items-center gap-2 rounded p-2 hover:bg-muted">
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checked}
                    disabled={!checked && selected.length >= 12}
                    onChange={() =>
                      onChange(
                        checked ? selected.filter((id) => id !== week.id) : [...selected, week.id],
                      )
                    }
                  />
                  <span className="min-w-0">
                    <strong className="block truncate">{week.label}</strong>
                    <span className="text-muted-foreground">
                      {new Date(week.start_date + "T12:00:00").toLocaleDateString("pt-BR")} a{" "}
                      {new Date(week.end_date + "T12:00:00").toLocaleDateString("pt-BR")}
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  className="shrink-0 text-[11px] text-primary underline"
                  aria-label={`Selecionar somente ${week.label}`}
                  onClick={() => onChange([week.id])}
                >
                  Só esta
                </button>
              </div>
            );
          })}
          {!weeks.length && (
            <p className="p-2 text-xs text-muted-foreground">Nenhuma semana neste recorte.</p>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
          <span>Marque as semanas · cálculo automático</span>
          <button type="button" className="text-primary underline" onClick={() => onChange([])}>
            Limpar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
