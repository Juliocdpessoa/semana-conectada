import { createFileRoute, redirect } from "@tanstack/react-router";

// Compatibilidade com favoritos e links antigos do módulo de transporte.
export const Route = createFileRoute("/_authenticated/transporte-programado")({
  beforeLoad: () => {
    throw redirect({ to: "/mudanca-de-escala", replace: true });
  },
});

