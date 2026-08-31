import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { BrandLogo } from "@/components/brand-logo";
import { ShieldCheck, ClipboardCheck, BarChart3, Timer, CalendarClock, Users, Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

const emailSchema = z.string().trim().email({ message: "E-mail inválido" }).max(254);
const passwordSchema = z.string().min(8, { message: "Mínimo 8 caracteres" }).max(72);
const nameSchema = z.string().trim().min(2, { message: "Informe seu nome" }).max(100);
type WorksiteOption = { id: string; code: string; name: string };

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [worksiteId, setWorksiteId] = useState("");
  const [worksites, setWorksites] = useState<WorksiteOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode !== "signup" || worksites.length > 0) return;
    void (async () => {
      const { data, error } = await (supabase as any)
        .from("worksites")
        .select("id,code,name")
        .eq("is_active", true)
        .order("name");
      if (error) return toast.error("Não foi possível carregar as obras disponíveis.");
      const options = (data ?? []) as WorksiteOption[];
      setWorksites(options);
      setWorksiteId((current) => current || options[0]?.id || "");
    })();
  }, [mode, worksites.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const parsedEmail = emailSchema.safeParse(email);
      if (!parsedEmail.success) return toast.error(parsedEmail.error.issues[0].message);

      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(parsedEmail.data, {
          redirectTo: `${window.location.origin}/redefinir-senha`,
        });
        if (error) return toast.error(error.message);
        toast.success("Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.");
        setMode("login");
        return;
      }

      const parsedPw = passwordSchema.safeParse(password);
      if (!parsedPw.success) return toast.error(parsedPw.error.issues[0].message);

      if (mode === "signup") {
        const parsedName = nameSchema.safeParse(fullName);
        if (!parsedName.success) return toast.error(parsedName.error.issues[0].message);
        if (!worksiteId) return toast.error("Selecione a obra para solicitar acesso.");
        // Garante que ninguém está logado antes de criar novo cadastro
        await supabase.auth.signOut().catch(() => {});
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: parsedEmail.data,
          password: parsedPw.data,
          options: {
            emailRedirectTo: `${window.location.origin}/atividades`,
            data: { full_name: parsedName.data, worksite_id: worksiteId },
          },
        });
        if (error) {
          const msg = error.message?.toLowerCase() ?? "";
          if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
            toast.error("Este e-mail já possui cadastro. Use 'Entrar' ou 'Esqueci minha senha'.");
            setMode("login");
            return;
          }
          if (msg.includes("rate") || msg.includes("limit")) {
            toast.error("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
            return;
          }
          return toast.error(error.message);
        }
        // Se a sessão veio junto (auto-confirm), desloga para não travar em /atividades
        if (signUpData.session) await supabase.auth.signOut().catch(() => {});
        toast.success("Cadastro enviado. Aguarde a aprovação de um administrador.");
        navigate({ to: "/aguardando-aprovacao" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsedEmail.data,
          password: parsedPw.data,
        });
        if (error) return toast.error(error.message);
        navigate({ to: "/atividades" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
      {/* Painel de marca (desktop) */}
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-sidebar-foreground) 1px, transparent 1px), linear-gradient(90deg, var(--color-sidebar-foreground) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2.5 rounded-md border border-border/40 bg-white px-3.5 py-2 shadow-sm">
            <BrandLogo className="h-9 w-auto" />
          </div>
          <div className="mt-10 max-w-xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
              NEXO · Plataforma operacional
            </div>
            <h1 className="mt-2 text-3xl font-semibold leading-tight text-sidebar-foreground">
              Um só lugar para planejar, executar e comprovar a manutenção
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-sidebar-foreground/75">
              Programação semanal, apontamento auditado, hora extra, mudança de escala e logística
              de transporte — com controle de acesso por perfil e histórico completo de cada
              alteração.
            </p>
          </div>
        </div>

        <div className="relative mt-10 grid max-w-xl grid-cols-2 gap-2.5">
          {[
            {
              icon: ClipboardCheck,
              title: "Programação semanal",
              desc: "Importação, versionamento e atividades imediatas",
            },
            {
              icon: BarChart3,
              title: "Painel gerencial",
              desc: "Aderência, curva de avanço em HH e pendências",
            },
            {
              icon: Timer,
              title: "Hora extra",
              desc: "Solicitação do líder e aprovação do gerente",
            },
            {
              icon: CalendarClock,
              title: "Mudança de escala",
              desc: "Transporte por colaborador e exportação Excel",
            },
            {
              icon: Users,
              title: "Colaboradores",
              desc: "Cadastro, contatos e dados de transporte",
            },
            {
              icon: ShieldCheck,
              title: "Acesso controlado",
              desc: "Perfis, aprovação e trilha de auditoria",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-md border border-sidebar-border/40 bg-sidebar-accent/40 p-3"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sidebar-accent text-sidebar-primary">
                  <f.icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-[12px] font-semibold text-sidebar-foreground">{f.title}</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-sidebar-foreground/70">
                {f.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="relative mt-10 text-[11px] uppercase tracking-widest text-sidebar-foreground/50">
          Normatel Engenharia · Uso interno
        </div>
      </aside>

      {/* Formulário */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="inline-flex items-center rounded-md border border-border/70 bg-white px-3 py-1.5 shadow-sm">
              <BrandLogo className="h-8 w-auto" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">NEXO</div>
              <div className="text-[11px] text-muted-foreground">
                Gestão integrada da manutenção
              </div>
            </div>
          </div>

          <div className="mb-5 flex flex-wrap gap-1.5 lg:hidden">
            {[
              "Programação semanal",
              "Apontamento",
              "Painel",
              "Hora extra",
              "Mudança de escala",
            ].map((t) => (
              <span
                key={t}
                className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-[10px] font-medium text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>

          <div className="surface-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {mode === "login"
                    ? "Acessar plataforma"
                    : mode === "signup"
                      ? "Solicitar acesso"
                      : "Recuperar senha"}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {mode === "login"
                    ? "Informe seu e-mail e senha."
                    : mode === "signup"
                      ? "Novo cadastro requer aprovação."
                      : "Informe seu e-mail para receber as instruções."}
                </p>
              </div>
            </div>

            {mode !== "forgot" && (
              <div className="mt-5 inline-flex rounded-md border border-border p-0.5">
                {(["login", "signup"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-[3px] px-3 py-1 text-[12px] font-medium transition ${
                      mode === m
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m === "login" ? "Entrar" : "Cadastrar"}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={submit} className="mt-5 space-y-4">
              {mode === "signup" && (
                <>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Nome completo
                    </label>
                    <input
                      type="text"
                      required
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="input-base"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Obra
                    </label>
                    <select
                      required
                      value={worksiteId}
                      onChange={(event) => setWorksiteId(event.target.value)}
                      className="input-base"
                    >
                      <option value="">Selecione a obra</option>
                      {worksites.map((worksite) => (
                        <option key={worksite.id} value={worksite.id}>
                          {worksite.code} — {worksite.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  E-mail
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-base"
                />
              </div>
              {mode !== "forgot" && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Senha
                    </label>
                    {mode === "login" && (
                      <button
                        type="button"
                        onClick={() => setMode("forgot")}
                        className="text-[11px] font-medium text-primary hover:underline"
                      >
                        Esqueci minha senha
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input-base pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
                {loading
                  ? "Aguarde..."
                  : mode === "login"
                    ? "Entrar"
                    : mode === "signup"
                      ? "Solicitar acesso"
                      : "Enviar instruções"}
              </button>

              {mode === "signup" && (
                <p className="text-[11px] text-muted-foreground">
                  Após o cadastro seu acesso fica pendente até aprovação de um administrador.
                </p>
              )}
              {mode === "forgot" && (
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Voltar para login
                </button>
              )}
            </form>
          </div>

          <p className="mt-6 text-center text-[11px] text-muted-foreground lg:hidden">
            Normatel Engenharia · Uso interno
          </p>
        </div>
      </main>
    </div>
  );
}

