-- Read-only investigation. Timestamps of diagnostics are RECEIPT times, not event times.
-- Window: 21 Nov 2026 00:00 America/Sao_Paulo through capture on 23 Nov.
-- Statement statistics are cumulative since their reset, not limited by this window.
-- Backup capture queue snapshot (not file integrity/restore validation):
select count(*) as total,count(*) filter(where completed_at is null) as pending,count(*) filter(where completed_at is null and last_error is not null) as pending_with_error,max(attempts) as max_attempts from public.nexo_backup_capture_queue;
-- diagnostics
select (d.received_at at time zone 'America/Sao_Paulo')::date as dia,d.stage,d.category,coalesce(d.realtime_reason,'-') as motivo,count(*) as eventos,count(distinct d.client_id) as navegadores,count(distinct d.actor_id) as usuarios_identificados,count(*) filter(where d.actor_id is null) as sem_identidade,count(*) filter(where p.email ilike '%prestserv%') as eventos_prestserv,round(avg(d.elapsed_ms)) as media_ms,max(d.elapsed_ms) as max_ms from app_access_diagnostics d left join profiles p on p.id=d.actor_id where d.received_at>='2026-11-21 00:00:00-03' and d.received_at<'2026-11-24 00:00:00-03' group by 1,2,3,4 order by 1,2,3,4;

-- performance
select (received_at at time zone 'America/Sao_Paulo')::date as dia, operation,count(*) as amostras,count(distinct actor_id) as usuarios,count(*) filter(where not success) as falhas,percentile_disc(0.5) within group(order by duration_ms) as p50_ms,percentile_disc(0.95) within group(order by duration_ms) as p95_ms,max(duration_ms) as max_ms from app_performance_samples where received_at>='2026-11-21 00:00:00-03' and received_at<'2026-11-24 00:00:00-03' group by 1,2 order by 1,2;

-- health
select now() as captured_at,(select count(*) from pg_stat_activity where wait_event_type='Lock') as lock_waits,(select count(*) from pg_stat_activity where state='active' and usename='authenticator' and query_start<now()-interval '5 seconds') as api_over_5s,(select count(*) from pg_replication_slots where active) as active_slots,(select count(*) from realtime.subscription) as subscriptions;

-- coverage
select count(*) as eventos,count(distinct id) as ids_unicos,count(distinct client_id) as navegadores,count(distinct actor_id) as usuarios_identificados,count(*) filter(where actor_id is null) as sem_identidade,min(received_at) as primeiro,max(received_at) as ultimo from app_access_diagnostics where received_at>='2026-11-21 00:00:00-03' and received_at<'2026-11-24 00:00:00-03';

-- history
select (received_at at time zone 'America/Sao_Paulo')::date as dia, stage,category,count(*) as eventos from app_access_diagnostics where received_at>='2026-11-18 00:00:00-03' and received_at<'2026-11-21 00:00:00-03' group by 1,2,3 order by 1,2,3;

-- slow
select queryid,calls,round(mean_exec_time::numeric,1) as mean_ms,round(max_exec_time::numeric,1) as max_ms,round(total_exec_time::numeric,1) as total_ms,case when query ilike '%get_activities_page%' then 'get_activities_page' when query ilike '%record_app_%' then 'telemetry' when query ilike '%update_activity%' then 'activity_update' when query ilike '%get_activity_revision%' then 'revision' when query ilike '%weekly%' then 'weekly' else 'other' end as family from extensions.pg_stat_statements where calls>0 order by total_exec_time desc limit 12;

-- replication
select slot_name,active,pg_wal_lsn_diff(pg_current_wal_lsn(),confirmed_flush_lsn) as pending_bytes from pg_replication_slots; select schemaname,tablename from pg_tables where schemaname in ('realtime','_realtime') order by 1,2;

-- slowNames
select s.queryid,s.calls,round(s.mean_exec_time::numeric,1) as mean_ms,round(s.max_exec_time::numeric,1) as max_ms,array(select distinct m[1] from regexp_matches(s.query,'([a-zA-Z_][a-zA-Z0-9_]*)\s*\(','g') m limit 18) as function_names from extensions.pg_stat_statements s where s.queryid in (-8757826424326125475,2104060019563274571,-8795060391133088212,2666560903368831138,-2097825419542815611,-8451307956603652680,-2570351979093960938,8850808499068719884);

-- replication
select slot_name,active,pg_wal_lsn_diff(pg_current_wal_lsn(),confirmed_flush_lsn) as pending_bytes from pg_replication_slots;

-- contracts
select p.proname,position('40001' in pg_get_functiondef(p.oid))>0 as has_40001,position('PT409' in pg_get_functiondef(p.oid))>0 as has_pt409 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname ilike '%update_activity%' or p.proname ilike '%update_bulk_activity%');

-- statsReset
select stats_reset from extensions.pg_stat_statements_info; select pubname,schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='activities';

-- businessErrors
select p.proname,position('40001' in pg_get_functiondef(p.oid))>0 as has_40001,position('PT409' in pg_get_functiondef(p.oid))>0 as has_pt409 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and (position('40001' in pg_get_functiondef(p.oid))>0 or position('PT409' in pg_get_functiondef(p.oid))>0);

-- statsReset
select stats_reset from extensions.pg_stat_statements_info;

-- eventVersions
select build,stage,count(*) as registros from app_access_diagnostics where received_at>='2026-11-21 00:00:00-03' and received_at<'2026-11-24 00:00:00-03' group by 1,2 order by 1,2;

-- backupRuns
select r.status,count(*) as runs,max(round(extract(epoch from (r.end_time-r.start_time))::numeric,2)) as max_seconds,min(r.start_time) as first_run,max(r.start_time) as last_run from cron.job_run_details r join cron.job j on j.jobid=r.jobid where j.jobname='nexo-backup-capture-worker' and r.start_time>='2026-11-21 00:00:00-03' and r.start_time<'2026-11-24 00:00:00-03' group by r.status;

-- recoveries
select received_at at time zone 'America/Sao_Paulo' as recebido,duration_ms from app_performance_samples where operation='realtime_recovery' and received_at>='2026-11-21 00:00:00-03' and received_at<'2026-11-24 00:00:00-03' order by received_at;

-- slowTargets
select s.queryid,array(select distinct m[1] from regexp_matches(s.query,'(?:public|pgrst_call|pgrst_source)\."?([a-zA-Z_][a-zA-Z0-9_]*)','g') m limit 12) as targets from extensions.pg_stat_statements s where s.queryid in (-8795060391133088212,2666560903368831138,-2097825419542815611,-2570351979093960938);

-- identifiers
select s.queryid,round(s.mean_exec_time::numeric,1) as mean_ms,array(select distinct m[1] from regexp_matches(s.query,'"([a-zA-Z_][a-zA-Z0-9_]*)"','g') m where m[1] not in ('pgrst_source','pgrst_body','pgrst_source_count','pgrst_ignored','total_result_set','page_total','body','response_headers','response_status','response_inserted','_postgrest_t') limit 22) as identifiers from extensions.pg_stat_statements s where s.queryid in (-8795060391133088212,2666560903368831138,-2097825419542815611,-2570351979093960938) and s.calls>1;

