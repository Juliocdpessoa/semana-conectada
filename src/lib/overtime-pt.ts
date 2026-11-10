export function canCompleteOvertimePt(row: { source_type: string; status: string; pt_number?: string | null }) {
 return row.source_type === "manual" && ["pending","approved"].includes(row.status) && !row.pt_number?.trim();
}
