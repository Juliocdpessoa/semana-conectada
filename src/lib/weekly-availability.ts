import { calculateWeeklyRealization, parseServiceHours } from "./weekly-realization.ts";

export type AvailabilityRow = {
  center: string;
  date: string;
  hours: number;
  week: string;
  local: string;
  specialty: string;
};
export type AvailabilityWeek = { code: string; start_date: string; end_date: string };
export type CenterHours = {
  center: string;
  local?: string;
  programmed: number;
  completed: number;
  completedForRs?: number;
  immediate: number;
};
export const RS_MONITORING_CENTERS = ["INSPPINT", "TECNIEND", "TECNINSC", "HIDROJATO"] as const;
export const isRsMonitoringOnly = (specialty: string, center = "") =>
  ["ALPINISTA", "ALPINISTAS", "ALPINISMO"].includes(availabilityKey(specialty)) ||
  RS_MONITORING_CENTERS.some((code) => code === availabilityKey(center));
export const availabilityKey = (value: string) =>
  value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");
export const weekCode = (value: string) =>
  value
    .trim()
    .match(/^(\d{1,3})[-/](\d{4})(?:\s|$)/)
    ?.slice(1)
    .map((v, i) => (i === 0 ? v.padStart(3, "0") : v))
    .join("-") ?? value.trim();

/** Carry a weekly pattern by weekday, never shift Tuesday into Monday after a holiday. */
export function prepareAvailabilityReuse(source: AvailabilityRow[], target: AvailabilityWeek) {
  const dates: string[] = [];
  for (
    let time = Date.parse(target.start_date + "T12:00:00Z");
    time <= Date.parse(target.end_date + "T12:00:00Z");
    time += 86400000
  ) {
    dates.push(new Date(time).toISOString().slice(0, 10));
    if (dates.length > 7)
      throw new Error("A base só pode ser reaproveitada para um período de até sete dias.");
  }
  const groups = new Map<string, AvailabilityRow[]>();
  for (const row of source) {
    const key = JSON.stringify([availabilityKey(row.center), availabilityKey(row.local)]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let missing = 0;
  const rows: AvailabilityRow[] = [];
  for (const group of groups.values())
    for (const date of dates) {
      const matches = group.filter(
        (row) =>
          new Date(row.date + "T12:00:00Z").getUTCDay() ===
          new Date(date + "T12:00:00Z").getUTCDay(),
      );
      if (matches.length > 1)
        throw new Error("A base anterior contém mais de um valor para o mesmo dia da semana.");
      if (!matches.length) missing++;
      rows.push({
        ...(matches[0] ?? group[0]),
        date,
        week: weekCode(target.code),
        hours: matches[0]?.hours ?? NaN,
      });
    }
  return { rows, missing };
}

export function validateAvailability(rows: AvailabilityRow[], week: AvailabilityWeek): string[] {
  const errors: string[] = [];
  if (!rows.length || rows.length > 5000)
    return ["Informe entre 1 e 5.000 linhas de disponibilidade."];
  const keys = new Set<string>();
  const centers = new Map<string, string>();
  rows.forEach((row, i) => {
    const label = `Linha ${i + 1}`;
    if (
      ![row.center, row.local, row.specialty].every(
        (s) => s.trim().length > 0 && s.trim().length <= 160,
      )
    )
      errors.push(`${label}: preencha centro, local e especialidade (até 160 caracteres).`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isFinite(Date.parse(`${row.date}T12:00:00Z`)) ||
      new Date(`${row.date}T12:00:00Z`).toISOString().slice(0, 10) !== row.date ||
      row.date < week.start_date ||
      row.date > week.end_date
    )
      errors.push(`${label}: data fora da semana ou inválida.`);
    if (weekCode(row.week) !== weekCode(week.code))
      errors.push(`${label}: semana diferente da selecionada.`);
    if (!Number.isFinite(row.hours) || row.hours < 0 || row.hours >= 1e9)
      errors.push(`${label}: HH disponível inválido. Zero é permitido; vazio não é zero.`);
    const center = availabilityKey(row.center),
      specialty = availabilityKey(row.specialty);
    const key = JSON.stringify([center, row.date, availabilityKey(row.local)]);
    if (keys.has(key)) errors.push(`${label}: centro, data e local duplicados.`);
    keys.add(key);
    if (centers.has(center) && centers.get(center) !== specialty)
      errors.push(`${label}: o mesmo centro está vinculado a especialidades diferentes.`);
    centers.set(center, specialty);
  });
  return errors;
}

/** Sum all days and locations first. Only then cap each specialty's combined SAP HS. */
export function calculateSpecialtyRealization(
  availability: AvailabilityRow[],
  centers: CenterHours[],
  hasSap: boolean,
  selectedLocal = "",
) {
  const local = availabilityKey(selectedLocal);
  const allAvailability = availability;
  availability = local
    ? availability.filter((r) => availabilityKey(r.local) === local)
    : availability;
  centers = local ? centers.filter((r) => availabilityKey(r.local ?? "") === local) : centers;
  const mapping = new Map<string, string>();
  const allSpecialties = new Map(
    allAvailability.map((r) => [availabilityKey(r.center), r.specialty]),
  );
  const groups = new Map<
    string,
    {
      specialty: string;
      includedInRs: boolean;
      centers: string[];
      available: number;
      programmed: number;
      completed: number;
      completedForRs: number;
      immediate: number;
    }
  >();
  const invalid: string[] = [];
  for (const row of availability) {
    const includedInRs = !isRsMonitoringOnly(row.specialty, row.center);
    const key = JSON.stringify([availabilityKey(row.specialty), includedInRs]),
      center = availabilityKey(row.center);
    if (!Number.isFinite(row.hours) || row.hours < 0) invalid.push("HH disponível inválido");
    if (mapping.has(center) && mapping.get(center) !== key)
      invalid.push(`Centro ambíguo: ${row.center}`);
    mapping.set(center, key);
    const group = groups.get(key) ?? {
      specialty: row.specialty.trim(),
      includedInRs,
      centers: [],
      available: 0,
      programmed: 0,
      completed: 0,
      completedForRs: 0,
      immediate: 0,
    };
    group.available += row.hours;
    if (!group.centers.includes(center)) group.centers.push(center);
    groups.set(key, group);
  }
  const unmapped = new Set<string>();
  for (const center of centers) {
    if (
      [
        center.programmed,
        center.completed,
        center.completedForRs ?? center.completed,
        center.immediate,
      ].some((v) => !Number.isFinite(v) || v < 0)
    )
      invalid.push(`HH inválido no centro ${center.center}`);
    const key = mapping.get(availabilityKey(center.center));
    if (!key) {
      const specialty = allSpecialties.get(availabilityKey(center.center));
      if (isRsMonitoringOnly(specialty ?? "", center.center)) {
        const monitoringKey = JSON.stringify([
          availabilityKey(specialty ?? `Centro ${center.center}`),
          false,
        ]);
        const group = groups.get(monitoringKey) ?? {
          specialty: specialty ?? `Centro ${center.center}`,
          includedInRs: false,
          centers: [],
          available: 0,
          programmed: 0,
          completed: 0,
          completedForRs: 0,
          immediate: 0,
        };
        group.programmed += center.programmed;
        group.completed += center.completed;
        group.completedForRs += center.completedForRs ?? center.completed;
        group.immediate += center.immediate;
        if (!group.centers.includes(availabilityKey(center.center)))
          group.centers.push(availabilityKey(center.center));
        groups.set(monitoringKey, group);
        continue;
      }
      if (center.programmed > 0 || center.completed > 0 || center.immediate > 0)
        unmapped.add(center.center || "Sem centro de trabalho");
      continue;
    }
    const group = groups.get(key)!;
    group.programmed += center.programmed;
    group.completed += center.completed;
    group.completedForRs += center.completedForRs ?? center.completed;
    group.immediate += center.immediate;
  }
  const rows = [...groups.values()]
    .sort((a, b) => a.specialty.localeCompare(b.specialty, "pt-BR"))
    .map((g) => {
      const actual = g.completed + g.immediate;
      const considered = Math.min(g.completedForRs + g.immediate, g.available);
      return {
        ...g,
        actual,
        considered,
        programmedConsidered: Math.min(g.programmed, g.available),
        excess: Math.max(0, actual - considered),
        occupation: g.available > 0 ? Math.min(g.programmed / g.available, 1) : null,
        // Equivalent HS expression; with no TP in a specialty, retain the hours for the general consolidation.
        rs: hasSap && g.available > 0 ? (considered / g.available) * 100 : null,
      };
    });
  const totals = rows
    .filter((r) => r.includedInRs)
    .reduce(
      (t, r) => ({
        available: t.available + r.available,
        programmed: t.programmed + r.programmed,
        completed: t.completed + r.completed,
        completedForRs: t.completedForRs + r.completedForRs,
        immediate: t.immediate + r.immediate,
        considered: t.considered + r.considered,
        excess: t.excess + r.excess,
      }),
      {
        available: 0,
        programmed: 0,
        completed: 0,
        completedForRs: 0,
        immediate: 0,
        considered: 0,
        excess: 0,
      },
    );
  const result =
    hasSap && availability.length > 0 && unmapped.size === 0 && invalid.length === 0
      ? calculateWeeklyRealization({
          programmed: totals.programmed,
          completed: totals.considered,
          immediate: 0,
          reference: totals.available,
          eep: 0,
        })
      : null;
  const monitoring = rows.filter((r) => !r.includedInRs);
  return { rows, totals, result, monitoring, unmapped: [...unmapped].sort(), invalid };
}

export function availabilityDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 0 && value < 2958466)
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
      .toISOString()
      .slice(0, 10);
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : text;
}

/** Read one explicit availability sheet. Never infer a specialty from a work-center prefix. */
export function parseAvailabilityGrid(
  grid: unknown[][],
  week: AvailabilityWeek,
): AvailabilityRow[] {
  const canonical = (v: unknown) => availabilityKey(String(v ?? "")).replace(/[^A-Z0-9]/g, "");
  const aliases = [
    ["CENTRODETRABALHO", "CENTRAB"],
    ["DATA"],
    ["HHDIARIODISPONIVEL", "HHDISPONIVEL"],
    ["SEMANA"],
    ["LOCAL"],
    ["ESPECIALIDADE", "ESPECIALIDAE"],
  ];
  const header = grid.findIndex((r) =>
    aliases.every((names) => r.some((v) => names.includes(canonical(v)))),
  );
  if (header < 0)
    throw new Error(
      "Não encontrei as colunas CENTRO DE TRABALHO, DATA, HH DIÁRIO DISPONÍVEL, SEMANA, LOCAL e ESPECIALIDADE.",
    );
  const columns = aliases.map((names) =>
    grid[header].findIndex((v) => names.includes(canonical(v))),
  );
  const rows = grid
    .slice(header + 1)
    .filter((r) => r.some((v) => v !== null && v !== undefined && String(v).trim() !== ""))
    .map((r) => {
      const [center, dt, hh, code, local, specialty] = columns.map((col) => r[col]);
      return {
        center: String(center ?? "").trim(),
        date: availabilityDate(dt),
        hours: typeof hh === "number" ? hh : (parseServiceHours(String(hh ?? "")) ?? NaN),
        week: String(code ?? "").trim(),
        local: String(local ?? "").trim(),
        specialty: String(specialty ?? "").trim(),
      };
    });
  const errors = validateAvailability(rows, week);
  if (errors.length)
    throw new Error(
      errors.slice(0, 5).join("\n") +
        (errors.length > 5 ? `\nMais ${errors.length - 5} erros.` : ""),
    );
  return rows.map((r) => ({ ...r, week: weekCode(week.code) }));
}
