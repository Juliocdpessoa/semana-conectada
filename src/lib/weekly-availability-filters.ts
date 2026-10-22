import { availabilityKey } from "./weekly-availability.ts";
import { parseServiceHours } from "./weekly-realization.ts";

/** Keep source indices: editing/removing a filtered row must target the full draft. */
export function filterAvailabilityDraft<T extends { center: string; date: string }>(
  rows: T[],
  centers: string[] = [],
  dates: string[] = [],
  pinnedIndex: number | null = null,
) {
  const selected = new Set(centers.map(availabilityKey));
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => {
      return (
        index === pinnedIndex ||
        ((!selected.size || selected.has(availabilityKey(row.center))) &&
          (!dates.length || dates.includes(row.date)))
      );
    });
}

export function filteredAvailabilityHours(rows: Array<{ hours: string | number }>): number | null {
  let total = 0;
  for (const row of rows) {
    const hours = typeof row.hours === "number" ? row.hours : parseServiceHours(row.hours);
    if (hours === null || !Number.isFinite(hours) || hours < 0) return null;
    total += hours;
  }
  return total;
}
