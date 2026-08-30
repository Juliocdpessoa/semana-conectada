import {
  createFileRoute,
  Outlet,
  Link,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { selectGlobalWorksite } from "@/lib/worksites.functions";
import { toast } from "sonner";
import {
  LogOut,
  ClipboardList,
  History,
  Settings,
  Zap,
  BarChart3,
  Menu,
  X,
  Timer,
  Bus,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

export type AppRole =
  "admin" | "manager" | "planning" | "leader" | "measurement_control" | "logistics" | "viewer";

export type SessionInfo = {
  userId: string;
  email: string;
  fullName: string;
  role: AppRole | null;
  roles: AppRole[];
  approvalStatus: "pending" | "approved" | "blocked";
  worksiteId: string;
  worksiteCode: string;
  worksiteName: string;
  isWorksiteAdmin: boolean;
};

async function loadSession(): Promise<SessionInfo | null> {
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error("Não foi possível validar sua sessão. Verifique a conexão e tente novamente.");
  if (!data.user) return null;
  let profile: any = null;
  let roles: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    [profile, roles] = await Promise.all([
      (supabase as any)
        .from("profiles")
        .select("email, full_name, approval_status, worksite_id")
        .eq("id", data.user.id)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", data.user.id),
    ]);
    if (!profile.error && profile.data && !roles.error) break;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  if (profile?.error || roles?.error || !profile?.data) {
    throw new Error("Não foi possível carregar seu perfil. Verifique a conexão e atualize a página.");
  }
  const worksiteId = String(profile.data?.worksite_id ?? "");
  const { data: worksite } = worksiteId
    ? await (supabase as any)
        .from("worksites")
        .select("code,name")
        .eq("id", worksiteId)
        .maybeSingle()
    : { data: null };
  const { data: activeMembership } = worksiteId
    ? await (supabase as any).from("worksite_memberships")
        .select("is_worksite_admin").eq("user_id", data.user.id)
        .eq("worksite_id", worksiteId).maybeSingle()
    : { data: null };
  const rolesRows = roles?.data ?? [];
  const priority: SessionInfo["role"][] = [
    "admin",
    "manager",
    "planning",
    "leader",
    "measurement_control",
    "logistics",
    "viewer",
  ];
  const allRoles = rolesRows
    .map((row) => row.role)
    .filter((role): role is AppRole => priority.includes(role as AppRole));
  const role = priority.find((r) => allRoles.includes(r!)) ?? null;
  return {
    userId: data.user.id,
    email: profile.data?.email ?? data.user.email ?? "",
    fullName: profile.data?.full_name ?? "",
    role,
    roles: allRoles,
    approvalStatus: profile.data.approval_status as SessionInfo["approvalStatus"],
    worksiteId,
    worksiteCode: String(worksite?.code ?? ""),
    worksiteName: String(worksite?.name ?? ""),
    isWorksiteAdmin: Boolean(activeMembership?.is_worksite_admin),
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
  const selectWorksite = useServerFn(selectGlobalWorksite);
  const [worksites, setWorksites] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [switchingWorksite, setSwitchingWorksite] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.navigate({ to: "/auth" });
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const s = session as SessionInfo;
  const roleSet = new Set(s.roles.length > 0 ? s.roles : s.role ? [s.role] : []);
  const isPlanning = roleSet.has("planning") || roleSet.has("admin");
  const isAdmin = roleSet.has("admin") || s.isWorksiteAdmin;
  const isManager = roleSet.has("manager") || isAdmin;
  const isMeasurementControl = roleSet.has("measurement_control");
  const isLogistics = roleSet.has("logistics");
  const hasGeneralAccess = ["admin", "manager", "planning", "leader", "viewer"].some((role) =>
    roleSet.has(role as AppRole),
  );
  const overtimeOnly = (isMeasurementControl || isLogistics) && !hasGeneralAccess;
  const canOvertime =
    roleSet.has("leader") ||
    roleSet.has("manager") ||
    isAdmin ||
    isMeasurementControl ||
    isLogistics;

  useEffect(() => {
    if (overtimeOnly && pathname !== "/hora-extra" && pathname !== "/transporte-programado") {
      router.navigate({ to: "/hora-extra", replace: true });
    }
  }, [overtimeOnly, pathname, router]);

  const canScheduledTransport = isManager || isAdmin || isLogistics;

  useEffect(() => {
    void (async () => {
      const { data, error } = await (supabase as any)
        .from("worksites")
        .select("id,code,name")
        .eq("is_active", true)
        .order("code");
      if (error) toast.error("Não foi possível carregar as obras.");
      else setWorksites(data ?? []);
    })();
  }, []);

  async function changeWorksite(worksiteId: string) {
    if (!worksiteId || worksiteId === s.worksiteId) return;
    setSwitchingWorksite(true);
    const result = await selectWorksite({ data: { worksiteId } });
    if (!result.ok) {
      toast.error(result.error);
      setSwitchingWorksite(false);
      return;
    }
    toast.success(`Obra alterada para ${result.worksite.code}.`);
    window.location.reload();
  }

  const nav = [
    { to: "/atividades", label: "Atividades", icon: ClipboardList, show: !overtimeOnly },
    { to: "/painel", label: "Painel", icon: BarChart3, show: !overtimeOnly },
    { to: "/planejamento", label: "Planejamento", icon: Zap, show: isPlanning },
    { to: "/hora-extra", label: "Hora Extra", icon: Timer, show: canOvertime },
    {
      to: "/transporte-programado",
      label: "Mudança de Escala",
      icon: Bus,
      show: canScheduledTransport,
    },
    { to: "/historico", label: "Histórico", icon: History, show: isPlanning },
    { to: "/admin/usuarios", label: "Administração", icon: Settings, show: isAdmin },
  ].filter((n) => n.show);

  void isManager;

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[oklch(0.42_0.13_142)] text-primary-foreground shadow-sm">
        <div className="mx-auto flex max-w-none items-center gap-4 px-4 py-2 sm:px-6">
          {/* Marca */}
          <Link
            to={overtimeOnly ? "/hora-extra" : "/atividades"}
            className="flex items-center gap-2.5"
          >
            <div className="leading-tight">
              <div className="text-[13px] font-semibold">NEXO</div>
              <div className="hidden text-[10px] uppercase tracking-[0.09em] text-primary-foreground/70 lg:block">
                Gestão integrada da manutenção
              </div>
            </div>
          </Link>

          <div className="mx-4 hidden h-6 w-px bg-white/20 sm:block" />

          {/* Navegação desktop */}
          <nav className="hidden items-center gap-0.5 sm:flex">
            {nav.map((n) => (
              <DesktopNavItem
                key={n.to}
                to={n.to}
                label={n.label}
                icon={<n.icon className="h-3.5 w-3.5" />}
              />
            ))}
          </nav>

          {/* Ações à direita */}
          <div className="ml-auto flex items-center gap-2">
            {worksites.length > 1 && (
              <label className="hidden items-center gap-1.5 md:flex">
                <span className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                  Obra
                </span>
                <select
                  value={s.worksiteId}
                  onChange={(event) => void changeWorksite(event.target.value)}
                  disabled={switchingWorksite}
                  className="h-8 max-w-[260px] rounded-md border border-white/25 bg-white/10 px-2 text-[11px] text-white outline-none hover:bg-white/15 disabled:opacity-60"
                  aria-label="Obra ativa"
                >
                  {worksites.map((worksite) => (
                    <option key={worksite.id} value={worksite.id} className="text-foreground">
                      {worksite.code}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="hidden text-right md:block">
              <div className="text-[12px] font-medium leading-tight">{s.fullName || s.email}</div>
              <div className="text-[10px] leading-tight text-primary-foreground/70">
                {(s.roles.length > 0 ? s.roles : s.role ? [s.role] : []).map(roleLabel).join(" + ")}
              </div>
              {s.worksiteCode && (
                <div className="text-[9px] leading-tight text-primary-foreground/65">
                  {s.worksiteCode}
                </div>
              )}
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
          <nav className="border-t border-white/10 bg-[oklch(0.42_0.13_142)] px-3 py-2 sm:hidden">
            <div className="mb-2 rounded-md bg-white/10 px-3 py-2 text-[11px]">
              <div className="font-medium">{s.fullName || s.email}</div>
              <div className="text-primary-foreground/70">
                {s.email} · {roleLabel(s.role)}
              </div>
              {s.worksiteCode && (
                <div className="mt-0.5 text-primary-foreground/70">
                  Obra: {s.worksiteCode}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              {nav.map((n) => (
                <MobileNavItem
                  key={n.to}
                  to={n.to}
                  label={n.label}
                  icon={<n.icon className="h-4 w-4" />}
                />
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
      <BrandLogo
        alt=""
        className="pointer-events-none fixed bottom-8 right-8 z-0 hidden w-64 select-none opacity-[0.035] grayscale lg:block"
      />
      <div className="relative z-10">
        <Outlet />
      </div>
    </div>
  );
}

function DesktopNavItem({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        "group relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground/85 transition-colors hover:bg-white/10 hover:text-primary-foreground",
      )}
      activeProps={{
        className:
          "bg-white/15 text-primary-foreground after:absolute after:inset-x-2 after:-bottom-[9px] after:h-[2px] after:rounded-full after:bg-primary-foreground",
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
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-[13px] font-medium text-primary-foreground/85 hover:bg-white/10"
      activeProps={{
        className: "bg-white/15 text-primary-foreground border-l-2 border-primary-foreground",
      }}
    >
      {icon}
      {label}
    </Link>
  );
}

function roleLabel(role: SessionInfo["role"]) {
  switch (role) {
    case "admin":
      return "Administrador";
    case "manager":
      return "Gerente";
    case "planning":
      return "Planejamento";
    case "leader":
      return "Líder";
    case "measurement_control":
      return "Medição e Controle";
    case "logistics":
      return "Logística";
    case "viewer":
      return "Consulta";
    default:
      return "Sem perfil";
  }
}

