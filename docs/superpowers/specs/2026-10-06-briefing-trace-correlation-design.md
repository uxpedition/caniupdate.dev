# Briefing Trace Correlation Design

**Status:** Approved after user review for implementation planning  
**Scope:** Browser comparison-page event, briefing submission HTTP request, briefing API handler, and the shared briefing generation. Console output only; no exporter or trace backend.

## Goal

Correlate the browser and API handling of a briefing submission as a direct parent-child flow, while representing the asynchronous Queue-backed generation as shared work that can relate to several submitters without inheriting any one submitter as its parent.

The briefing generation remains owned by `BriefingJob`. Trace metadata is diagnostic only: it must not change evidence identity, generation IDs, leases, fencing, D1 reuse, Queue acknowledgement/retry behavior, or public submission results.

## Alternatives

- **Make the first submitter the generation parent:** rejected. Other callers can join the same generation, so this incorrectly assigns shared work to one visitor.
- **Use correlation IDs without spans:** rejected. It could group records but would not retain parent-child or linked-work semantics.
- **Give the generation independent context and link callers to it:** selected. Each browser request and API handler form a direct HTTP trace; each API handler links to the shared generation context returned by the private service.

## Trace structure

```text
comparison.page (browser root; emits comparison.page.opened)
└─ briefing.submit client span ── traceparent ──▶ briefing.submit server span
                                                    └─ link ──▶ briefing.generation.accepted root
                                                                     └─ briefing.generation span
```

The page-root context is route-owned reactive state, not a module-global singleton. A client span is created for each POST attempt and uses the current page context as its parent. The client span's W3C `traceparent` identifies the API server span's parent. `comparison.page.opened`, `briefing.submission.started`, the API's accepted/failed outcome, `briefing.generation.accepted`, and `briefing.generation.started` carry bounded trace/span context fields in their console JSON annotations.

Each accepted generation gets a new independent root span in the Briefing Job Durable Object, with no parent from the caller. The root span ends after acceptance/dispatch; the later generation execution span uses the persisted root context as its parent. This avoids holding an Effect span open across Queue delivery or object restart. Create and persist the context under the existing job lock. For a legacy pending record without context, the first submitter or Queue run stores one under that lock; every racing submitter and the eventual generation run then use the same value. Each API request that creates or joins the pending generation adds one link to that root context. Cached results and refused submissions have no generation link.

## Context and contract boundaries

- Propagate only a strictly validated W3C `traceparent` on the browser's same-origin briefing POST: support version `00`, its exact 55-character form, valid lowercase hexadecimal fields, and nonzero trace/span IDs. Missing or invalid input creates a fresh server trace; it never rejects an otherwise valid application request. Local sampling is policy-owned, not controlled by an inbound flags bit. Do not accept baggage or `tracestate`, and do not forward trace headers to package or AI providers.
- Persist optional generation trace context separately from the evidence packet and hash in `JobRecord`. The Durable Object already owns and reads that record for Queue wake-ups, so retain the Queue message shape `{ hash, generationId }`.
- Return generation context only through the private Briefing Service binding. The Nuxt handler uses it to add a span link, then strips it; browser-facing `BriefingSubmission` remains unchanged.
- Existing job records and Queue messages without trace metadata remain valid. A pending legacy job may receive a fresh independent context when joined or when `run` claims it. Malformed or unavailable diagnostic context is ignored or replaced; it cannot fail submission or generation.
- Do not place package/version selectors, evidence, prompts, credentials, provider errors, or job hashes in trace attributes or annotations. Use fixed operation names and safe status/reason fields only.

## Console visibility and limitations

Use the existing Effect JSON console logger. Annotate relevant records with trace ID, span ID, parent span ID when present, and the one shared-generation link when present. No OTLP/Grafana/Jaeger exporter is part of this change, so the records can be correlated by IDs but will not appear as a trace tree in a tracing UI.

## Verification

- Strictly decode valid and malformed W3C trace context; malformed context must not reject the HTTP operation.
- Exercise the browser page root → client POST span → server handler parent chain.
- Submit/join one pending generation from distinct request traces; both API spans must link to the same independent generation root, and the generation span must not have either caller as parent.
- Verify the public response omits diagnostic metadata, the Queue pointer remains `{ hash, generationId }`, and old records/messages still execute.
- Verify no trace context reaches provider HTTP or the WebSocket URL/protocol. Smoke the actual browser POST and local briefing Worker with the existing local fixture.
