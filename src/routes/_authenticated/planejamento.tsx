import { createFileRoute, redirect } from "@tanstack/react-router";
import type { SessionInfo } from "./route";

// Preserve bookmarks without a second navigation entry or another copy of the module.
export const Route = createFileRoute("/_authenticated/planejamento")({
  beforeLoad: ({ context }) => {
    const session = (context as { session: SessionInfo }).session;
    if (!session.roles.some((role) => role === "planning" || role === "admin"))
      throw redirect({ to: "/atividades" });
    throw redirect({ href: "/painel?view=importacoes", replace: true });
  },
});
