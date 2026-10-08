type ReportSnapshot = {
  status: string;
  justification: string | null;
  observation: string | null;
  planning_data: unknown;
};

// Retry only when the report itself has not changed. PT/date edits may
// advance the row version without changing the report being submitted.
export function canRetryActivityReport(previous: ReportSnapshot, current: ReportSnapshot) {
  const links = (value: unknown) => {
    const data = value as Record<string, unknown> | null;
    const ids = data?.__linked_immediate_ids;
    return JSON.stringify(Array.isArray(ids) ? [...ids].map(String).sort() : []);
  };
  return previous.status === current.status
    && (previous.justification ?? "") === (current.justification ?? "")
    && (previous.observation ?? "") === (current.observation ?? "")
    && links(previous.planning_data) === links(current.planning_data);
}
