import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { completeRequiredPasswordChange } from "@/lib/password-reset.functions";
import { newPasswordSchema, type PasswordResetState } from "@/lib/password-reset";
import { BrandLogo } from "@/components/brand-logo";

export const Route = createFileRoute("/redefinir-senha")({
  component: ResetPasswordPage,
});

const passwordSchema = newPasswordSchema;

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [resetState, setResetState] = useState<PasswordResetState | null>(null);
  const [message, setMessage] = useState("Validando acesso…");
  const completeChange = useServerFn(completeRequiredPasswordChange);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function initialize() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) { setMessage("Entre com sua senha temporária ou solicite um link em Esqueci minha senha."); return; }
      const { data: state, error } = await (supabase as any).rpc("password_reset_state");
      if (!active) return;
      if (error) { setMessage("Não foi possível validar o acesso. Atualize a página e tente novamente."); return; }
      setResetState(state);
      setReady(Boolean(state?.required ? state.can_change : state?.allowed));
      if (state?.required && !state.can_change)
        setMessage(state.expired ? "A senha temporária expirou. Solicite um novo reset ao administrador." : "Saia e entre novamente com a senha temporária.");
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setTimeout(() => void initialize(), 0);
    });
    void initialize();
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    if (password !== confirm) return toast.error("As senhas não coincidem");
    setLoading(true);
    try {
      if (!ready) return;
      if (resetState?.required) {
        const result = await completeChange({ data: { password: parsed.data, resetId: resetState.reset_id! } });
        if (!result.ok) return toast.error(result.error);
      } else {
        const { error } = await supabase.auth.updateUser({ password: parsed.data });
        if (error) return toast.error(error.message);
      }
      toast.success("Senha atualizada. Faça login novamente.");
      await supabase.auth.signOut();
      navigate({ to: "/auth" });
    } catch {
      toast.error("Não foi possível salvar. Verifique sua conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center">
          <div className="inline-flex items-center rounded-md border border-border/70 bg-white px-3 py-1.5 shadow-sm">
            <BrandLogo className="h-8 w-auto" />
          </div>
        </div>
        <div className="surface-card p-6">
          <h2 className="text-base font-semibold text-foreground">Definir nova senha</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {resetState?.required ? "Troca obrigatória: escolha uma nova senha com pelo menos 8 caracteres para acessar o NEXO." : "Informe e confirme sua nova senha de acesso."}
          </p>

          {!ready ? (
            <p className="mt-6 text-sm text-muted-foreground">
              {message}
            </p>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Nova senha</label>
                <input
                  type="password" required autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="input-base"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Confirmar senha</label>
                <input
                  type="password" required autoComplete="new-password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  className="input-base"
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
                {loading ? "Aguarde..." : "Salvar nova senha"}
              </button>
            </form>
          )}
          <button type="button" disabled={loading} className="btn-ghost mt-4 w-full text-xs"
            onClick={async () => { await supabase.auth.signOut({ scope: "local" }); navigate({ to: "/auth" }); }}>
            Sair e voltar ao login
          </button>
        </div>
      </div>
    </div>
  );
}
