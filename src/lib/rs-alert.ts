import { calculateWeeklyRealization } from "./weekly-realization.ts";

/** Contractual bands: [95,98) has factor -0.01; [98,100] has no discount. */
export function rsAlert(rs: number | null, included = true) {
  if (!included)
    return {
      label: "Somente acompanhamento",
      className: "border-border bg-muted text-muted-foreground",
    };
  if (rs === null || !Number.isFinite(rs) || rs < 0)
    return { label: "RS indisponível", className: "border-border bg-muted text-muted-foreground" };
  const factor = calculateWeeklyRealization({
    programmed: 100,
    completed: rs,
    immediate: 0,
    reference: 100,
    eep: 0,
  })?.factor;
  if (factor === -0.02)
    return {
      label: "Crítico · fator −0,02",
      className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    };
  if (factor === -0.01)
    return {
      label: "Atenção · fator −0,01",
      className: "border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-300",
    };
  if (factor === 0.01)
    return {
      label: "Acima de 100% · fator +0,01",
      className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    };
  return {
    label: "Faixa sem desconto · fator 0,00",
    className: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
  };
}
