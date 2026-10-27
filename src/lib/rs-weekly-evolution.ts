import type { MonthlyRsWeek } from "./monthly-realization.ts";

export type EvolutionWeek = MonthlyRsWeek["week"];
export const EVOLUTION_PAGE_SIZE = 12;

export function evolutionLabel(week: EvolutionWeek) {
  const match = week.code.match(/0?(\d{2})[-/](\d{4})/);
  return match ? `S${match[1]} · ${match[2].slice(-2)}` : week.code;
}

/** Latest page first; marks always run from oldest to newest. Never mutate the selector. */
export function evolutionWindow(weeks: EvolutionWeek[], page = 0) {
  const ordered = [...new Map(weeks.map((week) => [week.id, week])).values()].sort(
    (a, b) => b.start_date.localeCompare(a.start_date) || b.id.localeCompare(a.id),
  );
  const pages = Math.max(1, Math.ceil(ordered.length / EVOLUTION_PAGE_SIZE));
  const current = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  return {
    page: current,
    pages,
    weeks: ordered
      .slice(current * EVOLUTION_PAGE_SIZE, (current + 1) * EVOLUTION_PAGE_SIZE)
      .reverse(),
  };
}

export function evolutionPoints(weeks: EvolutionWeek[], reports: MonthlyRsWeek[]) {
  const byId = new Map(reports.map((report) => [report.week.id, report]));
  return weeks.map((week) => {
    const report = byId.get(week.id);
    const result = report?.calculation?.result;
    const rs =
      report?.valid && result && Number.isFinite(result.rs) && result.rs >= 0 ? result.rs : null;
    return {
      ...week,
      axisLabel: evolutionLabel(week),
      rs,
      factor: rs === null ? null : result!.factor,
      frozen: report?.isFrozen ?? false,
      issues: report?.issues?.length ? report.issues : rs === null ? ["Sem apuração válida"] : [],
    };
  });
}

/** Same factor already calculated by the governed RS engine; no second threshold policy. */
export function evolutionColor(factor: number | null) {
  return factor === -0.02
    ? "#dc2626"
    : factor === -0.01
      ? "#d97706"
      : factor === 0
        ? "#16a34a"
        : factor === 0.01
          ? "#0284c7"
          : "#94a3b8";
}
