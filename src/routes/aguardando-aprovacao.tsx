import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Clock } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export const Route = createFileRoute("/aguardando-aprovacao")({
  component: PendingPage,
});

function PendingPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-5 flex justify-center">
          <div className="inline-flex items-center rounded-md bg-sidebar px-3 py-2">
            <BrandLogo className="h-5 w-auto" />
          </div>
        </div>
        <div className="surface-card p-8 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-warning/15 text-warning-foreground">
            <Clock className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-base font-semibold text-foreground">Aguardando aprovação</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Seu cadastro foi recebido. Um administrador precisa liberar seu acesso
            antes que você possa visualizar as atividades da semana.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/";
              }}
              className="btn-ghost"
            >
              Sair
            </button>
            <Link to="/" className="text-[11px] text-muted-foreground hover:underline">
              Voltar ao início
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
