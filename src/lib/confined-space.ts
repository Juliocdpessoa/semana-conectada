/** PBS codes are a list, not a substring match: 16 matches; 116 and 160 do not. */
export function hasConfinedSpacePbs(pbs: unknown): boolean {
  return /(^|[^0-9])16([^0-9]|$)/.test(String(pbs ?? ""));
}
export type ConfinedSpaceFilter = "all" | "yes" | "no";
export function readConfinedSpaceFilter(value: unknown): ConfinedSpaceFilter {
  return value === "yes" || value === "no" ? value : "all";
}
