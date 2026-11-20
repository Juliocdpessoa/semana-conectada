import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type ErrorComponentProps,
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { COLOR_THEME_BOOTSTRAP } from "@/lib/color-theme";
import { accessErrorMessage } from "@/lib/access-diagnostics";
import { authCacheAction } from "@/lib/auth-cache-policy";
import { reportCentralDiagnostic, startCentralDiagnostics, setAccessDiagnosticIdentity } from "@/lib/access-diagnostics-client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-6xl font-bold text-primary">404</h1>
        <h2 className="mt-4 text-lg font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          O endereço acessado não existe ou foi removido.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-secondary"
        >
          Voltar ao início
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const [reportId,setReportId]=useState<string|null>(null);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    setReportId(reportCentralDiagnostic(error,window.location.pathname));
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-foreground">Não foi possível carregar a página</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {accessErrorMessage(error)}
        </p>
        {reportId&&<p className="mt-3 break-all text-xs text-muted-foreground">Código de atendimento: <span className="font-mono select-all">{reportId}</span><br/>O NEXO tentará enviar o diagnóstico automaticamente. Sem conexão, o código pode ainda não estar disponível para consulta.</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-secondary"
          >
            Tentar novamente
          </button>
          <a
            href="/auth"
            className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Abrir tela de entrada
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "NEXO — Gestão integrada da manutenção" },
      {
        name: "description",
        content:
          "NEXO — Gestão integrada da manutenção. Plataforma corporativa para acompanhamento diário de atividades semanais: apontamento, histórico e indicadores.",
      },
      { property: "og:title", content: "NEXO — Gestão integrada da manutenção" },
      { property: "og:description", content: "NEXO — Gestão integrada da manutenção. Plataforma corporativa para acompanhamento diário de atividades semanais: apontamento, histórico e indicadores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#1E3A2B" },
      { name: "twitter:title", content: "NEXO — Gestão integrada da manutenção" },
      { name: "twitter:description", content: "NEXO — Gestão integrada da manutenção. Plataforma corporativa para acompanhamento diário de atividades semanais: apontamento, histórico e indicadores." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/795d3c1d-f0b5-4514-bce1-513e36eeb4a5/id-preview-206a26bc--2d7fe323-9bef-4a5e-965c-e5eada694ae5.lovable.app-1784417883296.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/795d3c1d-f0b5-4514-bce1-513e36eeb4a5/id-preview-206a26bc--2d7fe323-9bef-4a5e-965c-e5eada694ae5.lovable.app-1784417883296.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/app-icon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/app-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
    htmlAttrs: { lang: "pt-BR" },
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: COLOR_THEME_BOOTSTRAP }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  useEffect(()=>startCentralDiagnostics(),[]);
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    let previousUser: string | null | undefined;
    let active = true;
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user.id ?? null;
      const action = authCacheAction(event, previousUser, nextUser);
      previousUser = nextUser;
      if (action === "none") return;
      if(event==="SIGNED_OUT")setAccessDiagnosticIdentity(undefined);
      // Run outside GoTrue's auth lock. Never reuse a previous user's queries,
      // and do not refetch the whole application on a same-user tab focus.
      const timer = setTimeout(() => {
        pending.delete(timer);
        void (async () => {
          if (!active) return;
          if (action === "clear") {
            await queryClient.cancelQueries();
            if (!active) return;
            queryClient.clear();
          }
          await router.invalidate();
          if (active && action === "refresh") await queryClient.invalidateQueries();
        })().catch(() => { /* Route recovery presents its own access error. */ });
      }, 0);
      pending.add(timer);
    });
    return () => { active = false; for (const timer of pending) clearTimeout(timer); sub.subscription.unsubscribe(); };
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
