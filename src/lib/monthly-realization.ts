import { availabilityKey } from "./weekly-availability.ts";
import { calculateWeeklyRealization } from "./weekly-realization.ts";

export type MonthlyRsRow = {
  specialty: string;
  center?: string;
  includedInRs: boolean;
  centers: string[];
  available: number;
  programmed: number;
  programmedConsidered: number;
  completed: number;
  completedForRs: number;
  immediate: number;
  considered: number;
  excess: number;
  occupation: number | null;
  rs: number | null;
};
export type MonthlyRsWeek = {
  week: { id: string; code: string; label: string; start_date: string; end_date: string };
  isFrozen: boolean;
  closure: { id: string; version: number; rule_version: string } | null;
  basis: { kind: string; version?: number; source_file_name?: string } | null;
  source: { id?: string; source_file_name: string; imported_at: string } | null;
  valid: boolean;
  issues: string[];
  calculation: {
    result: ReturnType<typeof calculateWeeklyRealization>;
    totals: Record<string, number>;
    rows: MonthlyRsRow[];
    centerRows: MonthlyRsRow[];
  };
};
const sums = [
  "available",
  "programmed",
  "programmedConsidered",
  "completed",
  "completedForRs",
  "immediate",
  "considered",
  "excess",
] as const;

/** Add already capped WEEKLY amounts. Never recap a specialty across the month. */
export function consolidateMonthlyRs(weeks: MonthlyRsWeek[]) {
  const ids = new Set<string>();
  for (const week of weeks) {
    if (ids.has(week.week.id)) throw new Error("Semana duplicada no consolidado.");
    ids.add(week.week.id);
  }
  const complete =
    weeks.length > 0 && weeks.every((week) => week.valid && week.calculation.result !== null);
  function aggregate(kind: "rows" | "centerRows") {
    const groups = new Map<string, MonthlyRsRow>();
    for (const week of weeks)
      for (const row of week.calculation[kind]) {
        const key = `${row.includedInRs}|${availabilityKey(row.specialty)}|${kind === "centerRows" ? availabilityKey(row.center ?? "") : ""}`;
        let target = groups.get(key);
        if (!target) {
          target = {
            ...row,
            centers: [],
            ...Object.fromEntries(sums.map((field) => [field, 0])),
            occupation: null,
            rs: null,
          } as MonthlyRsRow;
          groups.set(key, target);
        }
        for (const field of sums) {
          const amount = row[field];
          if (!Number.isFinite(amount) || amount < 0)
            throw new Error("HH inválido no consolidado.");
          target[field] += amount;
        }
        target.centers = [...new Set([...target.centers, ...row.centers])];
      }
    return [...groups.values()]
      .map((row) => ({
        ...row,
        occupation:
          row.available > 0 ? Math.min(1, row.programmedConsidered / row.available) : null,
        rs: complete && row.available > 0 ? (row.considered / row.available) * 100 : null,
      }))
      .sort(
        (a, b) =>
          a.specialty.localeCompare(b.specialty, "pt-BR") ||
          (a.center ?? "").localeCompare(b.center ?? ""),
      );
  }
  const rows = aggregate("rows"),
    centerRows = aggregate("centerRows");
  const totals = Object.fromEntries(
    sums.map((field) => [
      field,
      rows.filter((row) => row.includedInRs).reduce((sum, row) => sum + row[field], 0),
    ]),
  ) as Record<(typeof sums)[number], number>;
  // General OM uses each week's GENERAL considered TP, not the sum of specialty TPs.
  // The weekly general cap and the specialty caps are distinct existing rules.
  totals.programmedConsidered = weeks.reduce(
    (sum, week) => sum + (week.calculation.result?.programmedConsidered ?? 0),
    0,
  );
  const result = complete
    ? calculateWeeklyRealization({
        programmed: totals.programmedConsidered,
        completed: totals.considered,
        immediate: 0,
        reference: totals.available,
        eep: 0,
      })
    : null;
  return {
    complete,
    rows,
    centerRows,
    totals,
    result,
    closedWeeks: weeks.filter((week) => week.isFrozen).length,
    openWeeks: weeks.filter((week) => !week.isFrozen).length,
  };
}

/** Month narrows the chooser only; selected weeks always enter in full. */
export function rsWeekOverlapsMonth(
  week: { start_date: string; end_date: string },
  year: string,
  month: string,
) {
  if (!month) return !year || week.start_date.startsWith(year) || week.end_date.startsWith(year);
  const years = year ? [year] : [week.start_date.slice(0, 4), week.end_date.slice(0, 4)];
  return years.some(
    (value) => week.start_date <= `${value}-${month}-31` && week.end_date >= `${value}-${month}-01`,
  );
}
