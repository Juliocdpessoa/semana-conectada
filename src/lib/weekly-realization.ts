export type RsInputs = {
  programmed: number;
  completed: number;
  immediate: number;
  reference: number;
  eep: number;
};
export type RsFactor = -0.02 | -0.01 | 0 | 0.01;

export function calculateWeeklyRealization(input: RsInputs) {
  const values = Object.values(input);
  if (values.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const reference = input.reference + input.eep;
  if (input.programmed <= 0 || reference <= 0) return null;
  const occupation = input.programmed / reference;
  const totalCompleted = input.completed + input.immediate;
  // Equivalent in HS to ((TCpr + TCoi) / TP) * (TP / reference) * 100.
  // Keep TP > 0 mandatory. Do not cap OM or RS at 100%.
  const rs = (totalCompleted / reference) * 100;
  if (!Number.isFinite(rs) || !Number.isFinite(occupation)) return null;
  const compare = (threshold: number) => {
    const difference = totalCompleted * 100 - reference * threshold;
    const tolerance = Number.EPSILON * Math.max(totalCompleted * 100, reference * threshold, 1) * 8;
    return Math.abs(difference) <= tolerance ? 0 : difference < 0 ? -1 : 1;
  };
  const at95 = compare(95) === 0;
  const factor: RsFactor | null = at95
    ? null
    : compare(95) < 0
      ? -0.02
      : compare(98) <= 0
        ? -0.01
        : compare(100) <= 0
          ? 0
          : 0.01;
  return { occupation, rs, factor, totalCompleted, reference, at95 };
}

export function parseServiceHours(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const grouped = /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/.test(text);
  if (!grouped && !/^\d+(?:[.,]\d+)?$/.test(text)) return null;
  const number = Number((grouped ? text.replace(/\./g, "") : text).replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function serviceHoursInput(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("pt-BR", { useGrouping: false, maximumFractionDigits: 20 })
    : "";
}
