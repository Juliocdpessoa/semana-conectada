# Realtime recovery follow-up

## Evidence and scope

Locked production Supabase JS 2.110.7 already forwards TOKEN_REFRESHED,
SIGNED_IN and INITIAL_SESSION changes to Realtime. Its existing reconnect logic
was retained. A synthetic two-client broadcast probe closed only its receiver's
own WebSocket with code 4001: CHANNEL_ERROR -> SUBSCRIBED, recovered in 1249 ms,
then received the synthetic message. No real account, task, PT, status or history
record was changed. This is not an authenticated Postgres Changes or Petrobras
network delivery test. An earlier probe attempt could not find its own socket;
that script defect was corrected and is not evidence of a service outage.

## Application changes

* Initial missing-channel recovery check: 5–8 seconds, rather than 60–80.
* While disconnected, indexed caller-RLS revision probe every 10–15 seconds.
  It returns a fingerprint, not task contents. Heavy reads only on change, with
  a minimum 20-second interval, or periodic 60-second reconciliation. Explicit
  reconnection and foreground resume catch up immediately; foreground event
  bursts retain a 15-second throttle. Healthy channels do not poll.
* Probe failure backs off to 15/30/60 seconds plus jitter. Hidden/offline tabs do
  not issue reads. No overlap; one catch-up can queue behind an existing read.
* Client probe deadline is six seconds, aborted on teardown; DB read is bounded.
  An already-running list response is joined and then reread once before the
  revision is certified, avoiding promotion of a pre-probe snapshot.
* No save replay, forced logout, extra session refresh, manual setAuth, global
  socket disconnect or speculative channel rebuild. Token events only schedule
  read recovery outside the auth lock if the channel is unhealthy. Disposed
  handlers cannot start new heavy reads or report stale lifecycle events.

## Measurement and privacy

New `app_performance_samples.operation` values: realtime_connect,
realtime_disconnect, realtime_recovery. These are lifecycle events, NOT activity
queries and NOT an uptime denominator. Keep them separate when reporting usage
or latency. Recovery is the client-observed interval from a failure callback to
SUBSCRIBED, not proof of task delivery. It can include a background/suspended tab.
Durations are bounded at one day. No raw JWT, token, message, URL, PT or payload
is recorded. Existing actor/site derivation, admin scoping and raw table denial
remain. Best-effort, no retry/queue; at most twelve lifecycle events per browser
module per ten minutes, plus existing DB caps and rolling seven-day retention.

Admin performance now separates normal Activities latency from lifecycle counts
and recovery median/P95. Zero/missing events are not an availability guarantee.
Classification recognizes documented snake_case/camelCase limit codes instead
of automatically grouping those as transport. Old records lack raw messages and
cannot be retroactively reclassified. Reference:
https://supabase.com/docs/guides/realtime/limits

## Validation and rollout

Unit tests cover duplicate callbacks, initial failure vs successful connection,
elapsed recovery, no-overlap, pending reconnect, hidden/offline states, unmount
during probe, heavy-read cooldown, error backoff, and SDK token-event forwarding.
Migration tested in a rolled-back transaction: invoker rights, anonymous RPC
denial, valid fixed health phases, rejection of arbitrary phases and recovery
duration longer than two minutes. Synthetic telemetry rows were rolled back.
No production task fixtures or user session resets were used.

Apply `20261121220000_realtime_recovery_health.sql` before publishing this code.
It adds an index and invoker revision RPC, and extends metadata operation/duration
validation only. Existing task/version/audit/RLS/business functions are untouched.
The new admin section uses existing Metric components; visual browser review is
not claimed. Authenticated two-user task propagation on Petrobras remains to be
validated during actual controlled use. This is resilience work, not a claim
that the network cause or every transport failure has been eliminated.
