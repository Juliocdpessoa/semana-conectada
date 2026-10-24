import {
  availabilityKey,
  validateAvailability,
  weekCode,
  type AvailabilityRow,
  type AvailabilityWeek,
} from "./weekly-availability.ts";

export function availabilityWeekDates(week: AvailabilityWeek): string[] {
  const start = Date.parse(week.start_date + "T12:00:00Z");
  const end = Date.parse(week.end_date + "T12:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 6 * 86400000)
    throw new Error("A semana deve ter um período válido de até sete dias.");
  return Array.from({ length: (end - start) / 86400000 + 1 }, (_, i) =>
    new Date(start + i * 86400000).toISOString().slice(0, 10),
  );
}

export function createAvailabilityCenter(
  existing: AvailabilityRow[],
  week: AvailabilityWeek,
  input: {
    center: string;
    local: string;
    specialty: string;
    days: Array<{ date: string; hours: number }>;
  },
): AvailabilityRow[] {
  const center = availabilityKey(input.center),
    local = availabilityKey(input.local);
  if (!["IARI", "ROTINA"].includes(local)) throw new Error("Selecione IARI ou ROTINA.");
  const dates = availabilityWeekDates(week);
  if (
    input.days.length !== dates.length ||
    dates.some((date) => !input.days.some((day) => day.date === date))
  )
    throw new Error("Informe o HH de todos os dias da semana, inclusive zero.");
  const next = input.days.map((day) => ({
    center,
    local,
    specialty:
      existing
        .find((row) => availabilityKey(row.specialty) === availabilityKey(input.specialty))
        ?.specialty.trim() ?? input.specialty.trim(),
    week: weekCode(week.code),
    ...day,
  }));
  const errors = validateAvailability(next, week);
  if (existing.length + next.length > 5000) errors.push("A tabela admite até 5.000 linhas.");
  if (
    existing.some(
      (row) =>
        availabilityKey(row.center) === center &&
        availabilityKey(row.specialty) !== availabilityKey(input.specialty),
    )
  )
    errors.push("Este centro já está vinculado a outra especialidade nesta semana.");
  if (
    existing.some(
      (row) =>
        availabilityKey(row.center) === center &&
        availabilityKey(row.local) === local &&
        dates.includes(row.date),
    )
  )
    errors.push(
      "Este centro já tem disponibilidade neste local e semana. Edite as linhas existentes.",
    );
  if (errors.length) throw new Error(errors.join("\n"));
  return next;
}
