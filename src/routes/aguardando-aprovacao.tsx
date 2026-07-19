import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Clock } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export const Route = createFileRoute("/aguardando-aprovacao")({
  component: PendingPage,
});

function PendingPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <div className="rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <BrandLogo className="mx-auto mb-4 h-10 w-auto" />
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-warning/15 text-warning-foreground">
            <Clock className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-foreground">Aguardando aprovação</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Seu cadastro foi recebido. Um administrador precisa aprovar seu acesso
            antes que você possa visualizar as atividades da semana.
          </p>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/";
            }}
            className="mt-6 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Sair
          </button>
          <Link to="/" className="mt-2 block text-xs text-muted-foreground hover:underline">
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}
