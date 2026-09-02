import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { ptBR } from "date-fns/locale";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  const parsed = parseIsoDate(value);
  return parsed ? parsed.toLocaleDateString("pt-BR") : "Selecione uma data";
}

export function DateRecordCalendar({
  value,
  availableDates,
  onChange,
  allowAll = true,
  disabled = false,
  className,
}: {
  value: string;
  availableDates: string[];
  onChange: (value: string) => void;
  allowAll?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value && value !== "all" ? parseIsoDate(value) : undefined;
  const datesWithRecords = useMemo(
    () => availableDates.map(parseIsoDate).filter((date): date is Date => Boolean(date)),
    [availableDates],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "input-base flex min-h-10 w-full min-w-0 items-center justify-between gap-2 text-left text-[16px] disabled:cursor-not-allowed disabled:opacity-50 sm:text-[12px]",
            className,
          )}
        >
          <span className="truncate">
            {value === "all" || (!value && allowAll) ? "Todos os dias" : formatDate(value)}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="w-[min(340px,calc(100vw-1.5rem))] p-0"
      >
        <Calendar
          mode="single"
          locale={ptBR}
          selected={selected}
          defaultMonth={selected ?? new Date()}
          onSelect={(date) => {
            if (!date) return;
            onChange(toIsoDate(date));
            setOpen(false);
          }}
          modifiers={{ hasRecords: datesWithRecords }}
          modifiersClassNames={{
            hasRecords:
              "after:absolute after:bottom-0.5 after:left-1/2 after:h-1.5 after:w-1.5 after:-translate-x-1/2 after:rounded-full after:bg-emerald-500",
          }}
          className="mx-auto"
        />
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-[11px]">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Com registros
          </span>
          {allowAll && (
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                onChange("all");
                setOpen(false);
              }}
            >
              Todos os dias
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

