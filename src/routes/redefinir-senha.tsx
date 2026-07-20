import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { BrandLogo } from "@/components/brand-logo";

export const Route = createFileRoute("/redefinir-senha")({
  component: ResetPasswordPage,
});

const passwordSchema = z.string().min(8, { message: "Mínimo 8 caracteres" }).max(72);

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase envia o token via hash e cria a sessão automaticamente.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    if (password !== confirm) return toast.error("As senhas não coincidem");
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: parsed.data });
      if (error) return toast.error(error.message);
      toast.success("Senha atualizada. Faça login novamente.");
      await supabase.auth.signOut();
      navigate({ to: "/auth" });
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
            Informe e confirme sua nova senha de acesso.
          </p>

          {!ready ? (
            <p className="mt-6 text-sm text-muted-foreground">
              Validando link de recuperação... Se esta tela não avançar, solicite um novo link em "Esqueci minha senha".
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
        </div>
      </div>
    </div>
  );
}
