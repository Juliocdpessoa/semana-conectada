import { createFileRoute, Outlet, Link, redirect, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { LogOut, ClipboardList, History, Settings, Zap } from "lucide-react";

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

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.navigate({ to: "/auth" });
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const s = session as SessionInfo;
  const isPlanning = s.role === "planning" || s.role === "admin";
  const isAdmin = s.role === "admin";

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/atividades" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
              CS
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold leading-tight">Controle Semanal</div>
              <div className="text-[11px] leading-tight opacity-70">Manutenção</div>
            </div>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 sm:flex">
            <NavItem to="/atividades" icon={<ClipboardList className="h-4 w-4" />} label="Atividades" />
            {isPlanning && (
              <>
                <NavItem to="/planejamento" icon={<Zap className="h-4 w-4" />} label="Planejamento" />
                <NavItem to="/historico" icon={<History className="h-4 w-4" />} label="Histórico" />
              </>
            )}
            {isAdmin && <NavItem to="/admin/usuarios" icon={<Settings className="h-4 w-4" />} label="Administração" />}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right md:block">
              <div className="text-xs font-medium">{s.fullName || s.email}</div>
              <div className="text-[11px] opacity-70">
                {s.email} · {roleLabel(s.role)}
              </div>
            </div>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-md border border-sidebar-border/60 bg-sidebar-accent px-3 py-1.5 text-xs font-medium hover:bg-secondary"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="sm:hidden rounded-md border border-sidebar-border/60 px-2 py-1.5 text-xs"
              aria-label="Menu"
            >
              Menu
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="border-t border-sidebar-border/40 bg-sidebar px-4 py-2 sm:hidden">
            <NavItem to="/atividades" icon={<ClipboardList className="h-4 w-4" />} label="Atividades" block />
            {isPlanning && (
              <>
                <NavItem to="/planejamento" icon={<Zap className="h-4 w-4" />} label="Planejamento" block />
                <NavItem to="/historico" icon={<History className="h-4 w-4" />} label="Histórico" block />
              </>
            )}
            {isAdmin && <NavItem to="/admin/usuarios" icon={<Settings className="h-4 w-4" />} label="Administração" block />}
          </nav>
        )}
      </header>
      <Outlet />
    </div>
  );
}

function NavItem({ to, icon, label, block }: { to: string; icon: React.ReactNode; label: string; block?: boolean }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition hover:bg-sidebar-accent ${block ? "w-full" : ""}`}
      activeProps={{ className: "bg-sidebar-accent" }}
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
