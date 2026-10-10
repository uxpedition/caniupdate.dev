---
name: observability-and-instrumentation
description: Makes production behavior diagnosable with logging, metrics, traces, and actionable alerts. Use when adding a production feature, service, endpoint, job, external integration, or telemetry; when configuring alerts; or when incidents reveal that the system lacks useful evidence.
---

# Observability and Instrumentation

## Overview

Code that cannot be observed is difficult to operate. Observability is the ability to answer “what is the system doing and why?” from emitted evidence. Instrumentation belongs beside feature work, like tests; without it, the first user-reported bug becomes archaeology.

## When to use

- Building a feature, endpoint, background job, or external integration that will run in production
- Adding or reviewing logging, metrics, distributed tracing, or alerting
- A production incident took too long because the available evidence could not explain it
- Reviewing work that introduces I/O, retries, queues, or cross-system calls

**Use a different workflow when:** diagnosing a failure happening now is `debugging-and-error-recovery`; profiling measured slowness is `performance-optimization`; launch-day monitoring and rollout/rollback decisions are `shipping-and-launch`. This skill designs the instrumentation that feeds those workflows.

## Process

### 1. Define the questions before choosing telemetry

Telemetry without a question is noise. Write 2–4 concrete questions an on-call engineer will need to answer for this feature. Each new signal must answer at least one question:

```
FEATURE: a provider-backed request workflow
QUESTIONS ON-CALL WILL ASK:
1. What fraction of requests complete versus fail or time out?
2. When a request fails, is the cause input, dependency, capacity, or internal state?
3. Is the external dependency slower or less available than its baseline?
4. Can one request be followed across its queue/worker boundaries?
```

If the questions are unclear, clarify the desired operational outcome before instrumenting. Do not log everything and hope a useful signal emerges.

### 2. Match each question to a signal

| Signal             | Answers                                       | Cost profile                         | Example                                                     |
| ------------------ | --------------------------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| **Structured log** | What happened in this specific case?          | Per event; volume grows with traffic | Sanitized `dependency_call_failed` with bounded error class |
| **Metric**         | How often or how fast, in aggregate?          | Fixed per series; cheap to query     | Dependency-call failure rate or duration histogram          |
| **Trace**          | Where did time go across operations/services? | Per request; often sampled           | One slow request, broken down by dependency hop             |

Rule of thumb: metrics show **that** something is wrong, traces show **where**, and logs help explain **why**. Select only signals that answer a stated question and can be operated within cost, privacy, and retention limits.

### 3. Structured logging

Emit stable events with machine-readable fields. Follow the existing logger and serialization convention; JSON is a common format, not a reason to add a second logging stack.

```typescript
// Avoid: prose assembled at each call site is hard to query consistently.
logger.info(`Request ${id} failed for ${user} after ${attempts} retries`);

// Prefer: stable event, bounded safe fields, no user/provider payload.
logger.warn(
  {
    event: 'dependency_call_failed',
    requestId,
    entryPoint: 'api',
    dependency: 'catalog',
    errorClass: 'timeout',
    attempt,
  },
  'dependency call failed',
);
```

Use levels consistently:

| Level   | Meaning                                        | Typical response                                |
| ------- | ---------------------------------------------- | ----------------------------------------------- |
| `error` | Invariant broken or action may be needed       | Investigate and recover                         |
| `warn`  | Degraded behavior was handled (retry/fallback) | Watch for a trend                               |
| `info`  | Material system/business transition            | No action unless correlated with a symptom      |
| `debug` | Temporary diagnostic detail                    | Disabled or controlled in production by default |

**Correlation IDs are required across request paths.** Create a high-entropy request/run identifier at the trusted system entry point or accept a strictly validated existing one; enforce length and character limits. Attach it to the request logger, spans, queue metadata, and downstream calls. Never let a caller choose arbitrary structured fields through an unvalidated header.

```typescript
// Framework-neutral pseudocode: one context follows the work across async boundaries.
const requestId = validateOrCreateRequestId(incomingHeader);
const context = logger.child({ requestId });
response.setHeader('request-id', requestId);
await handleRequest(input, context);
```

A correlation ID tells you which work items belong together; it does not identify who initiated the work. When multiple entry points write to one log sink, stamp a bounded `entryPoint` at the start (such as `scheduler`, `webhook`, `replay`, or `cli`) and propagate both it and the correlation ID across queues and services. Do not infer the entry point from a timestamp, external process table, or correlated side record; it is a hint that disappears when that record expires.

#### Privacy and credential boundaries

Logs, traces, metrics, dashboards, alerts, and telemetry-provider exports are data stores. Never emit credentials, access tokens, passwords, private runtime configuration, provider keys/endpoints, prompts, raw provider errors/bodies, evidence/request/response payloads, full URLs containing user data, or unredacted personal information. A vendor's error response may echo the request or secret. Use an allowlist of safe fields and bounded error classes; sanitize before export, not only in the dashboard. Do not attach user IDs, email addresses, package/customer names, prompt fragments, or raw identifiers merely because they make a query convenient. Follow the project's data classification, consent, access, retention, and deletion rules; use `security-and-hardening` for privacy boundaries.

If user-level correlation is truly required, document the operational question, minimize scope and retention, and use an approved pseudonymous identifier with access controls. It still counts as personal data where it can be linked back to a person; it is not a license to include it in metric labels.

### 4. Metrics

For request-driven systems, use **RED** on every relevant endpoint and external dependency: **R**ate, **E**rrors, **D**uration (a histogram, not just an average). For resources such as queues, pools, hosts, or worker capacity, use **USE**: **U**tilization, **S**aturation, **E**rrors.

Use a vendor-neutral instrumentation API where available; [OpenTelemetry](https://opentelemetry.io/docs/) is a common portable route, while Prometheus client libraries are one backend option. The API and example below are illustrative; reuse the project's telemetry stack and avoid duplicating it.

```typescript
import { Histogram } from 'prom-client';

const requestDuration = new Histogram({
  name: 'request_duration_seconds',
  help: 'Request duration',
  labelNames: ['method', 'route', 'status_class'], // bounded values such as 2xx or 5xx
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});
```

**Cardinality is a common failure mode.** Each unique label combination creates a time series. Keep labels from small fixed sets: route templates, method, status class, dependency type. Never use user identifiers, request IDs, raw URL, arbitrary tenant/package names, free-form error text, or private provider fields as metric labels. Put controlled, sanitized diagnostic detail in logs/traces instead.

```
Good labels:   route="/resources/:id"  status_class="5xx"  dependency="catalog"
Never labels:  user_id, email, request_id, full URL, error message, prompt text
```

Track histograms and query p50/p95/p99 where latency matters. An average hides tail latency and the users with a terrible experience. Align labels and buckets to the operational questions; avoid metrics with no owner or decision attached.

### 5. Distributed tracing

Use the repository's existing tracing system; OpenTelemetry provides a vendor-neutral API when one is needed. Auto-instrument common HTTP, RPC, and database clients where supported, then add manual spans only around meaningful units of work. Do not create a span for every trivial function.

```typescript
// Illustrative Node setup; initialize before instrumented libraries are loaded.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'example-service',
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

Add spans around operations an on-call engineer needs to distinguish (for example, validation, storage, or a dependency call). Add bounded attributes, not full request bodies or secret configuration. Propagate context across asynchronous boundaries—HTTP headers and queue message metadata—so a trace does not die between services. Choose sampling deliberately: head-sample normal traffic at a cost-appropriate rate and retain errors at a higher rate or through tail sampling when the backend supports it. Confirm sampling and retention meet privacy and incident-response requirements.

### 6. Alert on symptoms and give responders a runbook

Page on **symptoms users feel**; keep causes visible on dashboards rather than paging for every resource fluctuation:

```
SYMPTOM (page-worthy):          CAUSE (dashboard/trend):
error rate exceeds SLO           CPU utilization is elevated
p99 latency violates target      one worker restarted
queue age exceeds objective      disk usage is trending up
```

A cause-based alert may fire when no user is affected and miss an unexpected cause. A symptom alert asks whether the service is violating a user-facing objective.

Every alert should be:

1. **Actionable:** if responders only acknowledge it because it self-heals, remove or change it.
2. **Linked to a runbook:** at minimum, state what the alert means, what to check first, and who to escalate to.
3. **Thresholded from an SLO or historical data:** record the threshold and duration rationale; avoid guesswork.
4. **Assigned one of two clear severities:** page for user-facing urgent harm; ticket for a degradation that can be handled soon. More tiers often become noise.

Use the repository's runbook/operations documentation convention. If none exists, identify the appropriate maintained operations destination and request authorization before establishing it. A minimal runbook can be short:

```markdown
# Runbook: Elevated request failures

**Means:** The service is failing above its agreed objective; dependency or rollout regression is possible.
**First check:** Compare the error-class and duration dashboards for the affected route and recent deployment.
**Escalate to:** The documented service owner or on-call rotation.
```

Expand it only when responders need the additional steps to decide safely. Update the runbook while closing every incident that reveals a wrong or missing step; stale instructions create false confidence. Do not put credentials, raw provider bodies, or private runtime values in a runbook.

### 7. Verify the telemetry itself

Instrumentation is code and can be broken. Trigger the relevant paths in an authorized, isolated environment and inspect actual emitted data:

- Induce a controlled error and find it by correlation ID; verify fields are structured and sanitized.
- Send bounded test traffic and confirm expected metric series, label values, and plausible counts/histograms.
- Follow one request through the trace viewer; check context propagation across services and queues.
- Fire each new alert once using a controlled threshold/fixture; confirm it reaches the intended channel and the runbook link works.
- Inspect a sample of production-like exports for accidental credentials, personal data, raw payloads, or private provider/runtime details before widening collection.

Do not claim an alert, dashboard, hosted collector, or export path works merely because configuration compiled. A production collector, credentials, test message, or paid provider request is an external side effect and requires explicit authorization. Follow runtime/repository permissions for telemetry tools, and obtain authorization for external publication, production mutations, and private-data export. Each external CLI invocation for cross-model review requires its own explicit authorization under [`../../references/POLICY.md`](../../references/POLICY.md). Do not put private telemetry into a public artifact or an unapproved cross-model/tool prompt.

## Common rationalizations

| Rationalization                                   | Reality                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| “I'll add logging after it works.”                | After often means after the first incident. Add only the signals needed to answer operational questions as the feature is built.         |
| “More logs mean more observability.”              | Unstructured noise makes incident response slower; a few queryable events beat a flood of prose.                                         |
| “A console print is enough.”                      | It cannot be consistently filtered, correlated, or turned into an alert. Use the repository's structured logger.                         |
| “We can build dashboards when it breaks.”         | Dashboards without a question show data without an answer. Start with on-call questions.                                                 |
| “Alert on every important metric and tune later.” | Pager noise trains responders to ignore real incidents. Set actionable thresholds before paging.                                         |
| “A user ID metric label helps debugging.”         | It explodes cardinality and may expose personal data. Use bounded labels and approved access-controlled diagnostics.                     |
| “Tracing is overkill for a few services.”         | A single cross-service path can contain latency that logs cannot locate; use measured, sampled tracing where it answers a real question. |
| “The telemetry vendor will sanitize this.”        | Data already sent is exposed to the vendor and its retention/access policy. Minimize and sanitize before export.                         |

## Red flags

- A new queue/retry/external call with no diagnostic question or signal
- Prose string interpolation rather than stable structured events
- Missing correlation ID or entry-point attribution for multi-origin work
- Metrics with user IDs, raw URLs, free-form errors, prompts, or unbounded values
- Latency represented only as an average
- Alerts that fire repeatedly without action or page on causes alone
- No SLO/history rationale, owner, runbook, or test-fire for an alert
- Credentials, raw provider errors, personal data, prompts, or complete request bodies in telemetry
- Claims that monitoring is live based only on configuration or build output
- A production exporter or telemetry vendor enabled without explicit authorization and privacy review

## Verification

After instrumenting a feature, confirm:

- [ ] Operational questions are written down and every emitted signal answers one.
- [ ] Logs use stable structured events and include a generated/validated correlation ID across the request path.
- [ ] Every shared sink with multiple entry points records the origin at the start and propagates it with the correlation ID.
- [ ] Sampled emitted logs/traces contain no credentials, private runtime/provider data, raw payloads, prompts, or unredacted personal information.
- [ ] RED metrics cover the relevant endpoints and dependencies; USE metrics cover resources whose saturation matters.
- [ ] Label sets are bounded and latency distributions expose meaningful percentiles.
- [ ] A request can be followed across asynchronous/service boundaries without broken context.
- [ ] Every new alert is symptom-based, has an SLO/history-backed threshold, owner, runbook, and verified notification route.
- [ ] A controlled failure in an isolated environment was diagnosed from telemetry without reading the source.
- [ ] Export, retention, access, consent, sampling, and cost were reviewed before production collection was widened.

For the compact implementation and launch checklist, see [`../../references/observability-checklist.md`](../../references/observability-checklist.md). For privacy boundaries see `security-and-hardening`; for measured latency and regression guards see `performance-optimization`; for launch thresholds see `shipping-and-launch`.
