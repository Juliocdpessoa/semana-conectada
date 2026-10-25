import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function NexoBackupStatus({ worksiteId }: { worksiteId: string }) {
  const status = useQuery({
    queryKey: ["nexo-backup-status", worksiteId],
    enabled: Boolean(worksiteId),
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_nexo_backup_status", {
        p_worksite: worksiteId,
      });
      if (error) throw error;
      return data as {
        pending: number;
        lastCaptured: string | null;
        lastDelivered: string | null;
        deviceLastSeen: string | null;
      };
    },
  });
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString("pt-BR") : "Ainda não recebido";
  return (
    <div className="mb-4 rounded-md border bg-card px-3 py-2 text-xs" role="status">
      <span className="font-semibold">Backup automático SAP + RS</span>
      {" | "}
      {status.isError ? (
        "Não foi possível consultar o recebimento. Atualize a página."
      ) : !status.data ? (
        "Consultando…"
      ) : (
        <>
          {status.data.pending} pendente(s) de recebimento local{" | "}Último recebido:{" "}
          {date(status.data.lastDelivered)}
          <span className="ml-2 text-muted-foreground">
            Destino: C:\Backup NEXO. O computador receptor precisa estar ligado, com a sessão
            iniciada e internet.
          </span>
        </>
      )}
    </div>
  );
}
