import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PerformanceDashboardView } from "@/components/performance-dashboard";
import { getPerformanceDashboard } from "@/lib/performance.functions";
import type { SessionInfo } from "../route";

export const Route = createFileRoute("/_authenticated/admin/desempenho")({
  beforeLoad: ({ context }) => {
    const session = (context as { session: SessionInfo }).session;
    if (!session.roles.includes("admin")) throw redirect({ to: "/atividades" });
  },
  component: PerformancePage,
});
function PerformancePage() {
  const { session } = Route.useRouteContext() as { session: SessionInfo };
  const [hours, setHours] = useState<1 | 6 | 24>(24);
  const call = useServerFn(getPerformanceDashboard);
  const query = useQuery({
    queryKey: ["admin-performance", hours, session.userId, session.worksiteId],
    queryFn: () => call({ data: { hours } }),
    staleTime: 30_000,
    retry: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  return (
    <PerformanceDashboardView
      data={query.data}
      hours={hours}
      setHours={setHours}
      query={query}
      worksiteName={session.worksiteName}
    />
  );
}
