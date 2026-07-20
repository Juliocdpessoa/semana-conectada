import { createFileRoute, Outlet, Link, redirect, useRouter, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { LogOut, ClipboardList, History, Settings, Zap, BarChart3, Menu, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

export type SessionInfo = {
  userId: string;
  email: string;
  fullName: string;
  role: "admin" | "planning" | "leader" | "viewer" | null;
  approvalStatus: "pending" | "approved" | "blocked";
};

async function loadSession(): Promise<SessionInfo | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const [profile, roles] = await Promise.all([
    supabase.from("profiles").select("email, full_name, approval_status").eq("id", data.user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", data.user.id),
  ]);
  const rolesRows = roles.data ?? [];
  const priority: SessionInfo["role"][] = ["admin", "planning", "leader", "viewer"];
  const role = priority.find((r) => rolesRows.some((row) => row.role === r)) ?? null;
  return {
    userId: data.user.id,
    email: profile.data?.email ?? data.user.email ?? "",
    fullName: profile.data?.full_name ?? "",
    role,
    approvalStatus: (profile.data?.approval_status as SessionInfo["approvalStatus"]) ?? "pending",
  };
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const session = await loadSession();
    if (!session) throw redirect({ to: "/auth" });
    if (session.approvalStatus !== "approved") throw redirect({ to: "/aguardando-aprovacao" });
    return { session };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.navigate({ to: "/auth" });
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const s = session as SessionInfo;
  const isPlanning = s.role === "planning" || s.role === "admin";
  const isAdmin = s.role === "admin";

  const nav = [
    { to: "/atividades", label: "Atividades", icon: ClipboardList, show: true },
    { to: "/painel", label: "Painel", icon: BarChart3, show: true },
    { to: "/planejamento", label: "Planejamento", icon: Zap, show: isPlanning },
    { to: "/historico", label: "Histórico", icon: History, show: isPlanning },
    { to: "/admin/usuarios", label: "Administração", icon: Settings, show: isAdmin },
  ].filter((n) => n.show);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-white/15 bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-1.5 sm:px-6">
          {/* Marca */}
          <Link to="/atividades" className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-auto brightness-0 invert" />
            <div className="hidden leading-tight sm:block">
              <div className="text-[13px] font-semibold">NEXO</div>
              <div className="text-[10px] uppercase tracking-[0.09em] text-primary-foreground/70">
                Gestão integrada da manutenção
              </div>
            </div>
          </Link>

          <div className="mx-4 hidden h-6 w-px bg-white/20 sm:block" />

          {/* Navegação desktop */}
          <nav className="hidden items-center gap-0.5 sm:flex">
            {nav.map((n) => <DesktopNavItem key={n.to} to={n.to} label={n.label} icon={<n.icon className="h-3.5 w-3.5" />} />)}
          </nav>

          {/* Ações à direita */}
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden text-right md:block">
              <div className="text-[12px] font-medium leading-tight">{s.fullName || s.email}</div>
              <div className="text-[10px] leading-tight text-primary-foreground/70">{roleLabel(s.role)}</div>
            </div>
            <button
              onClick={signOut}
              className="hidden items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-2.5 py-1.5 text-[11px] font-medium hover:bg-white/20 md:inline-flex"
              title="Sair"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-8 w-8 place-items-center rounded-md border border-white/20 hover:bg-white/10 sm:hidden"
              aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Navegação mobile */}
        {menuOpen && (
          <nav className="border-t border-white/15 bg-primary px-3 py-2 sm:hidden">
            <div className="mb-2 rounded-md bg-white/10 px-3 py-2 text-[11px]">
              <div className="font-medium">{s.fullName || s.email}</div>
              <div className="text-primary-foreground/70">{s.email} · {roleLabel(s.role)}</div>
            </div>
            <div className="flex flex-col gap-0.5">
              {nav.map((n) => (
                <MobileNavItem key={n.to} to={n.to} label={n.label} icon={<n.icon className="h-4 w-4" />} />
              ))}
              <button
                onClick={signOut}
                className="mt-2 inline-flex items-center gap-2 rounded-md border border-white/20 px-3 py-2.5 text-[13px] hover:bg-white/10"
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          </nav>
        )}
      </header>
      <Outlet />
    </div>
  );
}

function DesktopNavItem({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        "group relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
      activeProps={{
        className:
          "bg-sidebar-accent text-sidebar-foreground after:absolute after:inset-x-2 after:-bottom-[9px] after:h-[2px] after:rounded-full after:bg-sidebar-primary",
      }}
    >
      {icon}
      {label}
    </Link>
  );
}

function MobileNavItem({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-[13px] font-medium text-sidebar-foreground/85 hover:bg-sidebar-accent"
      activeProps={{ className: "bg-sidebar-accent text-sidebar-foreground border-l-2 border-sidebar-primary" }}
    >
      {icon}
      {label}
    </Link>
  );
}

function roleLabel(role: SessionInfo["role"]) {
  switch (role) {
    case "admin": return "Administrador";
    case "planning": return "Planejamento";
    case "leader": return "Líder";
    case "viewer": return "Consulta";
    default: return "Sem perfil";
  }
}
