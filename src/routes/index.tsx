import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ClipboardList, ShieldCheck, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/atividades" });
  },
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
              CS
            </div>
            <div>
              <div className="font-semibold text-foreground leading-tight">Controle Semanal</div>
              <div className="text-xs text-muted-foreground">Acompanhamento de manutenção</div>
            </div>
          </div>
          <Link
            to="/auth"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-secondary"
          >
            Entrar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <section className="max-w-3xl">
          <span className="inline-block rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-secondary">
            Plataforma operacional corporativa
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Acompanhamento diário de atividades semanais de manutenção
          </h1>
          <p className="mt-4 text-base text-muted-foreground">
            Todos os líderes aprovados enxergam a programação da semana, apontam
            status, justificativa e observação. O sistema registra automaticamente
            quem informou cada atividade.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-secondary"
            >
              Entrar ou cadastrar-se
            </Link>
          </div>
        </section>

        <section className="mt-16 grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: ClipboardList,
              title: "Busca operacional",
              text: "Localize por ordem, nota, descrição, área, data, status ou responsável.",
            },
            {
              icon: ShieldCheck,
              title: "Auditoria completa",
              text: "Cada alteração fica registrada com autor, data e valores antes/depois.",
            },
            {
              icon: RefreshCw,
              title: "Integração SharePoint",
              text: "Sincronização segura com o Excel semanal via Microsoft Graph.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-card p-5">
              <f.icon className="h-5 w-5 text-success" />
              <h3 className="mt-3 font-semibold text-foreground">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Controle Semanal · Uso interno
      </footer>
    </div>
  );
}
