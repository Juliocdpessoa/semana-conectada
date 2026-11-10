export function canCompleteOvertimePt(row: { source_type: string; status: string; pt_number?: string | null }) {
 return ["manual","scale_change"].includes(row.source_type) && ["pending","approved"].includes(row.status) && !row.pt_number?.trim();
}
