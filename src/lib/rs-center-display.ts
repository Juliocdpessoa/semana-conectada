/** Presentation only: never remove inputs from official RS calculations. */
export const hasRsDisplayLoad = (row: { available: number; programmed: number }) =>
  row.available > 0 || row.programmed > 0;
