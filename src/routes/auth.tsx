import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { BrandLogo } from "@/components/brand-logo";
import logoTransparent from "@/assets/normatel-logo-light.png";
import { ShieldCheck, ClipboardCheck, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

const emailSchema = z.string().trim().email({ message: "E-mail inválido" }).max(254);
const passwordSchema = z.string().min(8, { message: "Mínimo 8 caracteres" }).max(72);
const nameSchema = z.string().trim().min(2, { message: "Informe seu nome" }).max(100);

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const parsedEmail = emailSchema.safeParse(email);
      const parsedPw = passwordSchema.safeParse(password);
      if (!parsedEmail.success) return toast.error(parsedEmail.error.issues[0].message);
      if (!parsedPw.success) return toast.error(parsedPw.error.issues[0].message);

      if (mode === "signup") {
        const parsedName = nameSchema.safeParse(fullName);
        if (!parsedName.success) return toast.error(parsedName.error.issues[0].message);
        const { error } = await supabase.auth.signUp({
          email: parsedEmail.data,
          password: parsedPw.data,
          options: {
            emailRedirectTo: `${window.location.origin}/atividades`,
            data: { full_name: parsedName.data },
          },
        });
        if (error) return toast.error(error.message);
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
          <div className="inline-flex items-center gap-2.5">
            <img src={logoTransparent} alt="Normatel Engenharia" className="h-8 w-auto" />
          </div>
          <div className="mt-10 max-w-md">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
              Controle Semanal
            </div>
            <h1 className="mt-2 text-2xl font-semibold leading-tight text-sidebar-foreground">
              Central operacional de acompanhamento diário
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-sidebar-foreground/75">
              Plataforma corporativa para líderes e planejamento acompanharem
              cerca de 1.400 atividades por semana com apontamento auditado,
              filtros técnicos e indicadores de aderência.
            </p>
          </div>
        </div>

        <ul className="relative mt-10 space-y-3 text-sm text-sidebar-foreground/85">
          {[
            { icon: ClipboardCheck, label: "Apontamento individual e em lote com auditoria" },
            { icon: BarChart3, label: "Painel gerencial com aderência da semana" },
            { icon: ShieldCheck, label: "Acesso controlado e aprovação por administrador" },
          ].map((f) => (
            <li key={f.label} className="flex items-start gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sidebar-accent text-sidebar-primary">
                <f.icon className="h-3.5 w-3.5" />
              </span>
              <span>{f.label}</span>
            </li>
          ))}
        </ul>

        <div className="relative text-[11px] uppercase tracking-widest text-sidebar-foreground/50">
          Normatel Engenharia · Uso interno
        </div>
      </aside>

      {/* Formulário */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="inline-flex items-center rounded-md border border-border bg-white px-2.5 py-2 shadow-sm">
              <BrandLogo className="h-6 w-auto mix-blend-lighten" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Controle Semanal</div>
              <div className="text-[11px] text-muted-foreground">Normatel · Manutenção</div>
            </div>
          </div>

          <div className="surface-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {mode === "login" ? "Acessar plataforma" : "Solicitar acesso"}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {mode === "login" ? "Use seu e-mail corporativo." : "Novo cadastro requer aprovação."}
                </p>
              </div>
            </div>

            <div className="mt-5 inline-flex rounded-md border border-border p-0.5">
              {(["login", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-[3px] px-3 py-1 text-[12px] font-medium transition ${
                    mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "login" ? "Entrar" : "Cadastrar"}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="mt-5 space-y-4">
              {mode === "signup" && (
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Nome completo</label>
                  <input
                    type="text" required autoComplete="name"
                    value={fullName} onChange={(e) => setFullName(e.target.value)}
                    className="input-base"
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">E-mail</label>
                <input
                  type="email" required autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="input-base"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Senha</label>
                <input
                  type="password" required
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="input-base"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-2.5"
              >
                {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Solicitar acesso"}
              </button>

              {mode === "signup" && (
                <p className="text-[11px] text-muted-foreground">
                  Após o cadastro seu acesso fica pendente até aprovação de um administrador.
                </p>
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
