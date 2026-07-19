import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ClipboardList, ShieldCheck, BarChart3, ArrowRight } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="inline-flex items-center rounded-md border border-border/70 bg-white px-3 py-1.5 shadow-sm">
              <BrandLogo className="h-6 w-auto" />
            </div>
            <div className="hidden sm:block leading-tight">
              <div className="text-[13px] font-semibold text-foreground">Controle Semanal</div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Normatel · Manutenção</div>
            </div>
          </div>
          <Link to="/auth" className="btn-primary">
            Entrar <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-14">
        <section className="max-w-3xl">
          <span className="inline-block rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Plataforma operacional corporativa
          </span>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Acompanhamento diário de atividades semanais de manutenção
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Líderes aprovados visualizam a programação da semana e apontam status,
            justificativa e observações. Cada alteração é registrada
            automaticamente com autor, data e versão.
          </p>
          <div className="mt-5">
            <Link to="/auth" className="btn-primary">
              Entrar ou cadastrar-se
            </Link>
          </div>
        </section>

        <section className="mt-14 grid gap-3 sm:grid-cols-3">
          {[
            { icon: ClipboardList, title: "Busca operacional", text: "Localize por ordem, nota, descrição, área, data, status ou responsável." },
            { icon: BarChart3, title: "Painel gerencial", text: "Aderência, execução por dia, área, especialidade e ranking de responsáveis." },
            { icon: ShieldCheck, title: "Auditoria completa", text: "Cada alteração registra autor, data e valores antes/depois com controle de versão." },
          ].map((f) => (
            <div key={f.title} className="surface-card p-5">
              <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
                <f.icon className="h-4 w-4" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-foreground">{f.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border py-5 text-center text-[11px] text-muted-foreground">
        Controle Semanal · Normatel Engenharia · Uso interno
      </footer>
    </div>
  );
}
