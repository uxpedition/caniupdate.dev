# Observability Checklist

Quick reference for production instrumentation. Use alongside the local [`observability-and-instrumentation`](../skills/observability-and-instrumentation/SKILL.md) skill and the service's existing telemetry conventions.

## Table of Contents

- [On-Call Questions (Start Here)](#on-call-questions-start-here)
- [Structured Logging](#structured-logging)
- [Metrics](#metrics)
- [Distributed Tracing](#distributed-tracing)
- [Alerting](#alerting)
- [Dashboards](#dashboards)
- [Verify the Telemetry](#verify-the-telemetry)
- [Pre-Launch Gate](#pre-launch-gate)

## On-Call Questions (Start Here)

Telemetry without a question is noise. Before instrumenting anything:

- [ ] Write down 2–4 questions an on-call engineer will ask about this feature
- [ ] Map every proposed signal below to one of those questions
- [ ] Match each question to the right signal type: metrics say **that** something is wrong, traces say **where**, logs say **why**

## Structured Logging

- [ ] Logs are structured (for example JSON) with stable event names, rather than only free-form strings
- [ ] Every log line carries a correlation/request ID generated or accepted at the system boundary
- [ ] Correlation ID is propagated on every outbound call and asynchronous boundary (for example HTTP headers and queue metadata)
- [ ] Any log stream written by more than one entry point (scheduler, replay endpoint, manual run) carries an entry-point field, set where the run starts and propagated alongside the correlation ID
- [ ] Log levels are consistent: `error` = invariant broken, someone may act; `warn` = degraded but handled; `info` = significant business event; `debug` = diagnostic detail that is disabled or appropriately restricted in production
- [ ] No secrets, tokens, passwords, or unredacted PII appear in logs (the hard rule in [`security-and-hardening`](../skills/security-and-hardening/SKILL.md))
- [ ] Fields are allowlisted; do not log complete request/response bodies or authentication headers
- [ ] External-service calls are logged with metadata only: endpoint, status, latency, attempt count, and sanitized identifiers
- [ ] Actual log output is spot-checked for structured fields (not values such as `[object Object]`)

## Metrics

- [ ] **RED** is instrumented for every endpoint and external dependency: Rate, Errors, Duration
- [ ] **USE** is instrumented for every resource (queues, pools, hosts): Utilization, Saturation, Errors
- [ ] Latency is a histogram with p50/p95/p99 queryable; do not use an average as the only latency measure
- [ ] Labels come from small, fixed sets (for example route template, status class, provider name)
- [ ] No unbounded label values: no user IDs, tenant IDs, emails, raw URLs, request IDs, or error-message text
- [ ] Status codes are grouped by class (`5xx`, not one series per status such as `503`)
- [ ] Queue depth and processing duration are tracked for every worker/queue where relevant

## Distributed Tracing

- [ ] OpenTelemetry or the service's equivalent is initialized at service startup, before instrumented modules are loaded where required
- [ ] Automatic instrumentation is enabled for the relevant HTTP, RPC, and database clients
- [ ] Trace context is propagated on outbound calls (for example W3C `traceparent`/`tracestate`) and extracted from inbound requests
- [ ] Context survives asynchronous boundaries; queue messages carry trace metadata
- [ ] Manual spans surround meaningful internal units of work and include attributes on-call engineers will filter by
- [ ] No secrets or PII are used as span attributes
- [ ] Sampling uses an appropriate low baseline, with errors retained when tail sampling or equivalent is available

## Alerting

- [ ] Alerts are symptom-based (error rate, p99 latency, queue age); causes (CPU, disk, restarts) belong on dashboards rather than pagers
- [ ] Every alert is actionable; delete alerts that mean “ignore it, it self-heals”
- [ ] Every alert links to a runbook with at least three useful lines: what it means, first query to run, and escalation path
- [ ] Thresholds and durations are justified by an SLO or historical data, not guesses
- [ ] Use two severities where the operating model supports it: **page** (user-facing, act now) and **ticket** (degradation, act this week)
- [ ] Each new alert is test-fired once: it reaches the intended channel and the runbook link works
- [ ] No alerts fire routinely and get acknowledged without action

## Dashboards

- [ ] A service-health dashboard exists with error rate, latency p99, traffic, and saturation
- [ ] A dependency-health panel shows per-service error rates and latency
- [ ] The dashboard answers the on-call questions from the top of this checklist, rather than showing “everything except the answer”
- [ ] The default time range is useful for operations (often 1h–6h, not 30d)

## Verify the Telemetry

Instrumentation is code; it can be wrong:

- [ ] Induce an error in a safe staging/test environment and find it in logs by correlation ID
- [ ] Send test traffic and confirm metric series appear with expected labels and sane values
- [ ] Follow one request end-to-end in the tracing interface and confirm spans are connected
- [ ] Diagnose an induced failure from telemetry alone, without reading the source

## Pre-Launch Gate

Before a feature ships to production, verify the applicable items:

- [ ] Structured logs flow to the configured log aggregator
- [ ] RED metrics are visible in dashboards for every new endpoint and dependency
- [ ] At least one symptom-based alert is configured, has a runbook, and has been test-fired
- [ ] A request can be traced across every service it touches
- [ ] On-call engineers know where the runbooks are

For launch-day monitoring sequence and rollback triggers, see the local [`shipping-and-launch`](../skills/shipping-and-launch/SKILL.md) skill. Ordinary telemetry checks follow runtime/repository permissions. Obtain explicit authorization for publication, deployment, production mutations, and private-data export; cross-model review CLI calls require per-invocation authorization.
