import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";

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
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary text-primary-foreground font-bold">
            CS
          </div>
          <div>
            <div className="font-semibold text-foreground">Controle Semanal</div>
            <div className="text-xs text-muted-foreground">Acompanhamento de manutenção</div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex gap-2 rounded-md bg-muted p-1">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${
                  mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                {m === "login" ? "Entrar" : "Cadastrar"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Nome completo</label>
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">E-mail</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Senha</label>
              <input
                type="password"
                required
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-secondary disabled:opacity-60"
            >
              {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Cadastrar"}
            </button>

            {mode === "signup" && (
              <p className="text-xs text-muted-foreground">
                Após o cadastro seu acesso ficará pendente até a aprovação de um administrador.
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
