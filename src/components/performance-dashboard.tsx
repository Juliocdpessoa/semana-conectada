import { Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RefreshCw } from "lucide-react";
import { PageHeader, Panel } from "@/components/ui-kit";
import type { PerformanceDashboard } from "@/lib/performance.functions";
import {occurrenceTriage,performanceTriage} from '@/lib/performance-triage';
const stages: Record<string, string> = {
  session: "Sessão",
  identity: "Autenticação",
  password: "Validação da senha",
  profile: "Perfil",
  roles: "Permissões",
  worksite: "Obra",
  membership: "Vínculo",
  runtime: "Aplicativo",
  realtime: "Tempo real",
};
const categories: Record<string, string> = {
  network: "Conexão",
  timeout: "Tempo esgotado",
  auth: "Autenticação",
  server: "Servidor",
  missing: "Dado ausente",
  runtime: "Aplicativo",
};
const reasons: Record<string, string> = {
  transport: "Transporte",
  timeout: "Tempo esgotado",
  authorization: "Autorização",
  jwt: "Token",
  quota: "Limite do serviço",
  replication: "Replicação",
  closed: "Conexão encerrada",
  unknown: "Não identificado",
};
const date = (value: string) =>
  new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const ms = (value: number | null) =>
  value === null ? "Sem amostras" : `${value.toLocaleString("pt-BR")} ms`;

function Metric({
  label,
  value,
  detail,
  attention = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  attention?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-4 ${attention ? "border-amber-500" : "border-border"}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="my-2 text-2xl font-semibold tabular-nums">{value}</div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function PerformanceDashboardView({
  data,
  hours,
  setHours,
  query,
  worksiteName,
}: {
  data?: PerformanceDashboard;
  hours: 1 | 6 | 24;
  setHours: (value: 1 | 6 | 24) => void;
  worksiteName: string;
  query: { isError: boolean; isPending: boolean; isFetching: boolean; refetch: () => unknown };
}) {
  const activityMetrics=data?.metrics.filter(row=>['activities_list','activities_filter'].includes(row.operation))??[];
  const healthMetrics=data?.metrics.filter(row=>row.operation.startsWith('realtime_'))??[];
  const triage=data?performanceTriage(data):null;
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Administração"
        title="Desempenho do NEXO"
        description="Erros recebidos, tempos de consulta e situação atual do banco."
      />
      <nav aria-label="Administração" className="flex flex-wrap gap-2">
        <Link to="/admin/usuarios" className="btn-ghost border border-border">
          Usuários e configurações
        </Link>
        <span className="btn-primary" aria-current="page">
          Desempenho
        </span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <label className="space-y-1 text-xs">
          <span className="block">Período</span>
          <select
            className="min-h-9 rounded border border-border bg-background px-3"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value) as 1 | 6 | 24)}
          >
            <option value={1}>Última hora</option>
            <option value={6}>Últimas 6 horas</option>
            <option value={24}>Últimas 24 horas</option>
          </select>
        </label>
        <div className="text-xs text-muted-foreground">
          {data
            ? `${data.globalScope ? "Todas as obras" : worksiteName} · Atualizado em ${date(data.checkedAt)} (Brasília)`
            : "Aguardando consulta"}
          <div>Atualização automática a cada minuto enquanto esta tela estiver visível.</div>
        </div>
        <button
          type="button"
          className="btn-primary min-h-9"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          {query.isFetching ? "Consultando…" : "Atualizar"}
        </button>
      </div>
      {query.isError && (
        <div role="alert" className="rounded border border-destructive p-3 text-sm">
          Não foi possível atualizar o painel.{" "}
          {data
            ? "Os dados abaixo são da última consulta bem-sucedida; não representam a situação atual."
            : "Tente novamente. Nenhum dado foi alterado."}
        </div>
      )}
      {query.isPending && <p role="status">Consultando os indicadores…</p>}
      {data && (
        <>
          {triage && <Panel title="O que merece atenção">
            <div className="grid gap-3 md:grid-cols-3">
              <section className={`rounded border p-3 ${triage.readFailures>0||triage.attentionDiagnostics>0||triage.databaseAttention?'border-destructive':'border-border'}`}>
                <h3 className="text-sm font-semibold">Verificar falhas</h3>
                <p className="mt-2 text-sm">{triage.readFailures} falhas de consulta amostradas · {triage.attentionDiagnostics} diagnósticos de acesso, aplicativo ou serviço.</p>
                <p className="mt-2 text-xs text-muted-foreground">{data.database?(triage.databaseAttention?'Banco com sinal de atenção no instante consultado.':'Banco sem bloqueios, consultas API acima de 5 s ou slots inativos no instante consultado.'):'Situação global do banco restrita à administração global.'} As duas contagens podem se referir ao mesmo problema; não devem ser somadas.</p>
              </section>
              <section className="rounded border border-border p-3">
                <h3 className="text-sm font-semibold">Retorno de conexão confirmado</h3>
                <p className="mt-2 text-lg tabular-nums">{triage.recoveries}</p>
                <p className="mt-2 text-xs text-muted-foreground">Reinscrições no canal após falha observada. Não confirmam a entrega de cada tarefa nem ausência de intervenção do usuário.</p>
              </section>
              <section className="rounded border border-amber-500 p-3">
                <h3 className="text-sm font-semibold">Impacto não confirmado</h3>
                <p className="mt-2 text-lg tabular-nums">{triage.unconfirmedRealtime}</p>
                <p className="mt-2 text-xs text-muted-foreground">Diagnósticos de transporte, timeout ou encerramento. Não indicam por si só queda do aplicativo ou falha persistente.</p>
              </section>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Desconexões e retornos têm cobertura diferente e não estão vinculados por episódio. Não subtraímos as contagens nem classificamos ausência de retorno como queda persistente. Lentidão dos salvamentos, atraso por tarefa e perda de dados ainda não são medidos aqui.</p>
          </Panel>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Diagnósticos recebidos"
              value={data.diagnostics.total}
              detail={`No período selecionado · ${data.diagnostics.browsers} navegadores com registro`}
              attention={false}
            />
            <Metric
              label="Eventos de tempo real"
              value={data.diagnostics.realtime}
              detail="Registros de conexão; não equivalem a usuários desconectados agora."
              attention={false}
            />
            <Metric
              label="Consultas acima de 5 segundos"
              value={data.database?.slowRequests ?? "Restrito"}
              detail="Requisições API ativas no instante da consulta."
              attention={(data.database?.slowRequests ?? 0) > 0}
            />
            <Metric
              label="Esperas por bloqueio"
              value={data.database?.lockWaits ?? "Restrito"}
              detail="Situação atual do banco, não o histórico do período."
              attention={(data.database?.lockWaits ?? 0) > 0}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Erros recebidos por hora">
              <p className="mb-3 text-xs text-muted-foreground">
                Horário de recebimento em Brasília. Registros podem chegar depois da falha; zero não
                comprova disponibilidade.
              </p>
              <div className="h-56 w-full" aria-label="Histórico horário de erros">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.hourly.map((row) => ({
                      ...row,
                      label: new Date(row.hour).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Sao_Paulo",
                      }),
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} width={30} tick={{ fontSize: 10 }} />
                    <Tooltip
                      labelFormatter={(_, payload) =>
                        payload?.[0]?.payload?.hour ? date(payload[0].payload.hour) : ""
                      }
                      contentStyle={{
                        background: "var(--card)",
                        color: "var(--foreground)",
                        borderColor: "var(--border)",
                      }}
                    />
                    <Bar
                      dataKey="errors"
                      name="Erros recebidos"
                      fill="#d97706"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Tempo das consultas de Atividades">
              <p className="mb-3 text-xs text-muted-foreground">
                Amostras coletadas a partir desta versão. Incluem rede e resposta da consulta; não
                incluem a renderização da tela. P95: 95% das consultas bem-sucedidas medidas ficaram
                nesse tempo ou abaixo.
              </p>
              {!activityMetrics.length ? (
                <p className="rounded border border-dashed border-border p-6 text-sm text-muted-foreground">
                  Ainda sem amostras. Os tempos aparecerão conforme os usuários consultarem
                  Atividades.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="p-2">Operação</th>
                        <th className="p-2">Amostras</th>
                        <th className="p-2">Mediana</th>
                        <th className="p-2">P95</th>
                        <th className="p-2">Falhas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityMetrics.map((row) => (
                        <tr key={row.operation} className="border-b">
                          <td className="p-2">
                            {row.operation === "activities_filter"
                              ? "Aplicar filtros"
                              : "Consultar lista"}
                          </td>
                          <td className="p-2">{row.samples}</td>
                          <td className="p-2">{ms(row.median_ms)}</td>
                          <td className="p-2">{ms(row.p95_ms)}</td>
                          <td className="p-2">{row.failures}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Coleta limitada e amostrada: não é uma taxa geral de falhas nem um teste de carga.
              </p>
            </Panel>
          </div>
          <Panel title="Recuperação da conexão em tempo real">
            <p className="mb-3 text-xs text-muted-foreground">Eventos medidos a partir desta versão. Recuperação mede o intervalo entre a falha detectada e a reinscrição no canal; não comprova entrega de uma tarefa. Coleta limitada, sem percentual de disponibilidade.</p>
            {!healthMetrics.length?<p className="text-sm text-muted-foreground">Ainda sem eventos de conexão medidos neste período.</p>:<div className="grid gap-3 sm:grid-cols-3">{healthMetrics.map(row=><Metric key={row.operation} label={row.operation==='realtime_connect'?'Conexões iniciais':row.operation==='realtime_disconnect'?'Interrupções detectadas':'Reconexões confirmadas'} value={row.samples} detail={row.operation==='realtime_recovery'?`Mediana: ${ms(row.median_ms)} · P95: ${ms(row.p95_ms)}`:row.operation==='realtime_connect'?`P95 para entrar no canal: ${ms(row.p95_ms)}`:'Um evento por interrupção observada, não por tarefa.'} attention={row.operation==='realtime_disconnect'}/>)}</div>}
          </Panel>
          <Panel title="Ocorrências por etapa">
            <div className="flex flex-wrap gap-2">
              {data.groups.length ? (
                data.groups.map((row) => (
                  <span
                    key={`${row.stage}:${row.category}:${row.realtime_reason}`}
                    className="rounded border border-border px-3 py-2 text-xs"
                  >
                    <strong>{stages[row.stage] ?? row.stage}</strong> ·{" "}
                    {categories[row.category] ?? row.category}
                    {row.realtime_reason
                      ? ` · ${reasons[row.realtime_reason] ?? row.realtime_reason}`
                      : ""}
                    : {row.total}
                  </span>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma ocorrência recebida no período.
                </p>
              )}
            </div>
          </Panel>
          <Panel
            title="Últimas ocorrências"
            description="Até 30 registros, sem nomes, credenciais ou conteúdo de tarefas."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="p-2">Recebido em (Brasília)</th>
                    <th className="p-2">Etapa</th>
                    <th className="p-2">Categoria</th>
                    <th className="p-2">Conexão</th>
                    <th className="p-2">Interpretação</th>
                    <th className="p-2">Código de atendimento</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((row) => (
                    <tr key={row.id} className="border-b hover:bg-muted/50">
                      <td className="whitespace-nowrap p-2">{date(row.received_at)}</td>
                      <td className="p-2">{stages[row.stage] ?? row.stage}</td>
                      <td className="p-2">{categories[row.category] ?? row.category}</td>
                      <td className="p-2">
                        {row.realtime_reason
                          ? (reasons[row.realtime_reason] ?? row.realtime_reason)
                          : "—"}
                      </td>
                      <td className={`p-2 ${occurrenceTriage(row).kind==='attention'?'text-destructive':'text-muted-foreground'}`}>{occurrenceTriage(row).label}</td>
                      <td className="p-2 font-mono">{row.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.recent.length && (
                <p className="p-3 text-sm text-muted-foreground">Nenhuma ocorrência no período.</p>
              )}
            </div>
          </Panel>
          <details className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">
              Cobertura e interpretação
            </summary>
            <div className="mt-3 space-y-2">
              <p>
                Fonte: diagnósticos do aplicativo (retenção de 30 dias), amostras de consultas (7
                dias) e estatísticas atuais do PostgreSQL. As contagens de erros não têm um
                denominador de acessos e não representam percentual de indisponibilidade.
              </p>
              <p>
                Um navegador totalmente sem comunicação pode não conseguir enviar registros. O
                painel não identifica automaticamente a rede Petrobras. Administradores locais veem
                somente os diagnósticos vinculados à obra atual.
              </p>
              <p>
                Replicação:{" "}
                {data.database
                  ? `${data.database.activeSlots} de ${data.database.totalSlots} slots ativos no instante consultado. Isso não comprova a entrega das alterações a todos os usuários.`
                  : "Estatísticas globais disponíveis somente à administração global."}
              </p>
              <p>
                Ainda não medidos neste painel: tempo total de abertura das telas, duração de
                salvamentos, atraso de entrega por tarefa, CPU/memória da hospedagem e integridade
                dos backups locais. Não há alerta externo contínuo; a atualização deste painel
                depende de ele estar aberto.
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
