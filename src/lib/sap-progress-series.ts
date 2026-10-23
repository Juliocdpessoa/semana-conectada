export type SapEarnedProgress = {
  hasSource: boolean;
  invalidHours: number;
  planned: number;
  earned: number;
  days: { date: string | null; planned: number | null; earned: number }[];
};

/** Daily HH bars and accumulated percentages share the same SAP credit and denominator. */
export function sapProgressSeries(
  startDate: string,
  endDate: string,
  progress?: SapEarnedProgress,
) {
  const rows = [];
  let planned = 0,
    earned = 0;
  const measured = !!progress?.hasSource && !progress.invalidHours;
  const byDay = new Map(progress?.days.map((day) => [day.date, day]));
  for (
    const dt = new Date(startDate + "T12:00:00");
    dt <= new Date(endDate + "T12:00:00");
    dt.setDate(dt.getDate() + 1)
  ) {
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const day = byDay.get(iso);
    const dailyPlanned = day?.planned ?? 0;
    const dailyEarned = measured ? (day?.earned ?? 0) : null;
    planned += dailyPlanned;
    earned += dailyEarned ?? 0;
    rows.push({
      date: iso.slice(8) + "/" + iso.slice(5, 7),
      dailyPlanned,
      dailyEarned,
      dailyRemaining: dailyEarned === null ? null : Math.max(0, dailyPlanned - dailyEarned),
      planned: progress && progress.planned > 0 ? (planned / progress.planned) * 100 : null,
      earned: measured && progress!.planned > 0 ? (earned / progress!.planned) * 100 : null,
    });
  }
  return rows;
}
