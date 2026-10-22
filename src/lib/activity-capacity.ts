export type ActivityCapacityRow = {
  center: string;
  date: string | null;
  programmed: number;
  available: number | null;
  excess: number | null;
  tasks: number;
  invalidHours: number;
};

export type ActivityCapacity = {
  hasAvailability: boolean;
  updatedAt: string | null;
  rows: ActivityCapacityRow[];
};

export const capacityCenter = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
export function capacityOverloadList(rows: readonly ActivityCapacityRow[]) {
  return rows
    .filter((row) => row.excess !== null && row.excess > 1e-8)
    .sort(
      (a, b) =>
        a.center.localeCompare(b.center, "pt-BR") || (a.date ?? "").localeCompare(b.date ?? ""),
    );
}
const key = (row: ActivityCapacityRow) => JSON.stringify([capacityCenter(row.center), row.date]);

export function summarizeActivityCapacity(
  data: ActivityCapacity,
  centers: string[] = [],
  dates: string[] = [],
) {
  const selectedCenters = new Set(centers.map(capacityCenter));
  const rows = data.rows.filter(
    (row) =>
      (!selectedCenters.size || selectedCenters.has(capacityCenter(row.center))) &&
      (!dates.length || (row.date !== null && dates.includes(row.date))),
  );
  const overloaded = rows.filter((row) => row.excess !== null && row.excess > 1e-8);
  const unknown = rows.filter(
    (row) => row.available === null || row.invalidHours > 0 || !row.date || !row.center,
  );
  return {
    rows,
    overloaded,
    unknown,
    excess: overloaded.reduce((sum, row) => sum + row.excess!, 0),
    programmed: rows.reduce((sum, row) => sum + row.programmed, 0),
    available: rows.reduce((sum, row) => sum + (row.available ?? 0), 0),
  };
}

/** A saved move warns only when it creates/increases an overloaded center/day. */
export function increasedCapacityOverloads(before: ActivityCapacity, after: ActivityCapacity) {
  const previous = new Map(before.rows.map((row) => [key(row), row]));
  return after.rows.filter((row) => {
    const old = previous.get(key(row));
    return (
      row.excess !== null &&
      row.excess > 1e-8 &&
      row.invalidHours === 0 &&
      row.programmed > (old?.programmed ?? 0) + 1e-8 &&
      row.excess > (old?.excess ?? 0) + 1e-8
    );
  });
}

export function capacityWarningText(row: ActivityCapacityRow) {
  const date = row.date ? row.date.split("-").reverse().join("/") : "sem data";
  const hours = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(
    row.excess ?? 0,
  );
  return `${row.center || "Sem centro"} em ${date}: ${hours} HH acima da capacidade.`;
}
