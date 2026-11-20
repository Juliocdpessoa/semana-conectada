# Administration performance dashboard

## Delivery and sources

Route: `/admin/desempenho`, linked from Administration. Caller authentication,
password reset gate and approved profile are enforced in the server middleware
and the database. Only the global administrator sees all sites, unassigned
access failures and global database statistics. Other users with the admin role
see diagnostics/samples for their current authorized site. Worksite-admin status
alone does not grant this system-monitoring view.

Apply `20261120170000_app_performance_dashboard.sql` before deploying the app.
It adds an isolated telemetry table and two narrowly scoped RPCs. It does not
change task data, user roles, existing RLS policies or the access relay allowlist.
This feature has not itself been deployed to production during implementation.

* `app_access_diagnostics`: counts, unique reporting browser IDs, hourly receipt
  buckets, fixed classifications and at most 30 recent safe records. The existing
  30-day retention and rate caps still apply. Receipt is not occurrence time.
* `app_performance_samples`: observed duration of the normal paginated Activities
  RPC, including transport but excluding React rendering. Large print/export
  requests and aborted queries are excluded. Percentiles include successful
  samples only; sample and failure counts are displayed alongside them.
* `pg_stat_activity`: point-in-time active API requests older than five seconds
  and lock waits, not historical incidents or a concurrency capacity estimate.
* `pg_replication_slots`: active/total database replication slots, not proof of
  delivery to authenticated task subscribers.

## Collection and overhead

First eligible observation per operation/tab is accepted locally. Subsequent
successful observations are sampled at 20%, with a minimum one-minute gap per
operation. Failures bypass random sampling but retain the time cap. RPC receipts
cap inserts at six/user/minute and 200/minute overall, using a nonblocking
advisory lock. At most 200 expired telemetry rows are removed per accepted insert
after seven days. When there are no further inserts, expired rows remain until
collection resumes; this is rolling cleanup, not a scheduled deletion guarantee.

The browser sends only fixed operation names, bounded duration and a success
flag through an authenticated same-origin server function. No filter text, task
content, PT number, raw error, full URL or credential is recorded. Actor and site
are derived from the caller in SQL, not trusted from the payload. Reporting is
fire-and-forget with a three-second browser deadline, no retry/queue, and must
not affect a task read. Raw telemetry has no authenticated table grants.

Dashboard refresh is one minute while visible; filters support 1/6/24 hours.
Failed refresh shows a warning and marks existing data as stale. Empty samples
are not rendered as zero latency. There is no inferred uptime percentage.

## Validation record and remaining scope

Migration executed in rolled-back transactions: anonymous/non-admin denial,
raw table grants, approved administrator response, hourly count reconciliation,
valid inserts, invalid operation/duration rejection, six/user rate cap, median
and p95 checked against known samples (350/575 ms). All test records rolled back.
Pure policy and structural tests cover bounded sampling, private fields,
authorization, cancellation, print/export exclusion and visible limitations.
TypeScript and production build were checked during implementation.

An isolated UI fixture uses synthetic data under `.audit-tmp`, never production
data. Browser review could not reach localhost (connection timeout), so actual
visual rendering is not yet verified; do not describe a successful screenshot
review. The fixture and its development server are not deployment artifacts.

This is an initial admin measurement surface, not independent 24/7 monitoring.
Full page-render duration, save timings, task delivery lag, infrastructure CPU/
memory, backup integrity/restore testing and external alerts remain unmeasured.
No load test or authenticated Petrobras-network validation was performed.
