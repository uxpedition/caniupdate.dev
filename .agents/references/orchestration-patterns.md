# Orchestration Patterns

A reference catalog for choosing how to coordinate focused work in this repository. Use it when designing a multi-step workflow, considering delegation, or deciding whether separate perspectives are worth their cost. It is runtime-portable: use only the delegation and collaboration capabilities available in the current runtime. It does not assume installed specialist agents, personas, plugins, hooks, slash commands, or a particular orchestration tool.

## Governing rule

**The user is the orchestrator.** The primary assistant owns the request, workflow, integration, and final report. A delegated worker should return its assigned result to the primary assistant, not invoke another specialist. Relevant local skills provide procedural guidance inside the work; they are not a chain of agents. Keep the human in decisions where judgment or authorization matters.

## Endorsed patterns

### 1. Direct work (no orchestration)

One perspective, one artifact, one owner. This is the default and the cheapest option.

```
user → primary assistant applies one relevant specialist perspective → result → user
```

**Use when:** the work is one perspective on one artifact and you can describe it in one sentence.

**Examples:**

- “Review this change” → apply the repository's review criteria and return findings
- “Find security issues in the authentication boundary” → inspect that boundary against the security checklist
- “What tests are missing for this flow?” → inspect behavior and report coverage gaps

**Cost:** one interaction. This is the baseline to compare more elaborate workflows against.

### 2. Reusable single-step workflow

A repeatable invocation template that applies a known workflow to one perspective. Keep the work in the primary assistant unless a separate context materially improves the result.

```
request → primary assistant follows local review guidance → report
```

**Use when:** the same single-perspective workflow recurs with the same setup and acceptance bar.

**Cost:** the same as direct work. The template is saved instructions, not an orchestration layer.

**Anti-signal:** if most of the workflow is “decide which specialist to call,” remove the routing layer and let the user request the intended perspective directly or use the local skill router.

### 3. Parallel fan-out with merge

Independent workers inspect the same input concurrently and return separate reports. The primary assistant then synthesizes them into one decision. Delegate only when the runtime supports it and when the slices genuinely benefit from separate contexts.

```
                       ┌─ independent correctness review ─┐
request → primary ─────┼─ independent security review ────┼→ primary merge → verdict + next steps
                       └─ independent test-gap review ────┘
```

**Use when:**

- Subtasks are genuinely independent (no shared mutable state and no ordering dependency)
- Each delegate benefits from its own context window
- The merge is small enough for the primary assistant to perform
- Wall-clock latency matters, or focused independent reports improve coverage

**Cost:** N delegated contexts plus one merge. It costs more than direct work, but may reduce wall-clock time and improve focus. Budget for integration; a set of reports without a synthesis is not a completed workflow.

**Validation checklist before adopting this pattern:**

- [ ] Can all workers run concurrently without ordering issues?
- [ ] Does each worker produce a different kind of finding, rather than repeating the same inspection from another angle?
- [ ] Will the primary assistant be able to compare and merge the results?
- [ ] Does parallelism materially improve latency or decision quality?

If any answer is “no,” use direct work or a reusable single-step workflow. Never fake concurrency by serially calling the same work parallel.

### 4. Sequential, user-directed phases

The user advances a dependent workflow in order, carrying the decision and relevant artifacts between phases. The user remains the orchestrator; each phase returns its result and next decision point rather than silently triggering the next phase.

```
user guides: DISCUSS → DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP
```

**Use when:** later steps depend on earlier outputs and human judgment between phases can catch a wrong direction before more work accumulates.

**Examples:** idea/discovery → spec → plan → implementation → verification → review → release. Use local skills such as [`grilling`](../skills/grilling/SKILL.md) for interviewing and the applicable planning, implementation, testing, and shipping skills at their corresponding phases.

**Cost:** one focused interaction or delegation per phase. The workflow has no separate orchestration model to paraphrase every handoff.

**Why not automate the entire lifecycle:** an automatic lifecycle coordinator can lose nuance while summarizing handoffs, skip human checkpoints, and add paraphrasing/context cost at every step. Keep required approval, authorization, and decision gates visible to the user. Discussion does not itself authorize implementation, publication, or deployment.

**Handoff discipline:** follow the shared OS-temporary working-set convention in [`POLICY.md`](POLICY.md). Use a named `workDir`, report and pass its exact absolute path to each skill/session that needs it, and preserve the dependency order. Do not guess an active spec or plan. Durable requirements, constraints, and decisions follow the separate documentation and authorization policy.

### 5. Research isolation (context preservation)

When investigation consumes substantial material that would distract from the main work, delegate a bounded read-only research task and request a compact, evidence-backed digest.

```
primary → isolated researcher (reads many sources) → cited digest → primary continues
```

**Use when:**

- The primary session needs to stay focused on a downstream task
- Investigation consumes much more material than its useful result
- The primary needs room to reason after the research is complete

**Examples:** “Find every call site of this deprecated API across the repository,” “Summarize what these architecture decisions say about caching.”

**Cost:** one isolated context. It is worthwhile when the alternative would load a large body of files into the primary context.

Specify whether the researcher may write. For discovery and analysis, make it read-only and ask it to return file/line evidence, uncertainty, and a digest. When the current runtime has no delegation capability, keep the investigation in the primary context and load material progressively instead of assuming a tool exists.

## Collaborating investigators: competing-hypothesis debugging

Independent parallel reports and active debate solve different problems. Parallel fan-out is best for a verdict on a known artifact; a collaboration mode that permits direct peer challenge is valuable when the artifact/root cause is unknown and several competing hypotheses fit the evidence. Use peer discussion only if the runtime offers it. Otherwise have the primary assistant compare independent reports and actively seek disconfirming evidence; do not claim that workers debated each other when they could not communicate.

### Scenario

> Checkout intermittently hangs for about 30 seconds before completing. It happens roughly once every 50 sessions. Logs show no errors. It began after last week's release.

Plausible competing causes include:

1. A race condition in a recently changed payment-confirmation flow
2. An authentication check that falls through to a slow synchronous network call
3. A missing index on a query whose cost grows with cart size
4. A third-party API whose client silently retries before timing out

One investigator may stop at the first plausible theory. A parallel verdict-style review produces independent reports but does not itself make those reports test each other's assumptions. An unknown-cause investigation benefits from explicit disconfirmation: each hypothesis should be checked against the others and against observed evidence.

### Why collaboration is different from a verdict review

|                   | Independent parallel review                  | Competing-hypothesis investigation                                                       |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Investigators see | The same artifact through different lenses   | A shared investigation and one another's evidence, if the runtime supports communication |
| Output            | Separate reports followed by a primary merge | Challenges, counter-evidence, and a root-cause finding                                   |
| Right when        | You want a verdict on a known change         | You need to discover which explanation fits                                              |

A review is a verdict; hypothesis collaboration is an investigation. Do not pay the cost of collaboration when only an independent review is needed.

### Investigation brief

Give each investigator one distinct evidence-seeking angle, not a preselected answer. For the scenario above, request:

- Concurrency investigator: inspect races, lock contention, and blocking work in the checkout path
- Authentication/network investigator: inspect authorization branches, session handling, and newly introduced synchronous calls
- Test/evidence investigator: identify measurements or focused tests that distinguish the hypotheses and inspect checkout coverage gaps

Ask investigators to challenge competing explanations with concrete evidence, track what would falsify their own theory, and report uncertainty. The primary assistant should converge only when evidence accounts for the intermittent timing and competing theories have been tested or explicitly remain unresolved. A focused test or measurement should verify the winning explanation before implementation where practical. The primary synthesizes the result and presents it to the user; the investigators do not authorize the fix or deployment.

### Cost expectation

Several investigators communicating and running for 10–15 minutes costs noticeably more than a simple parallel review. The justification is conclusion quality when the wrong root cause would be expensive. For a routine review, use direct work or independent fan-out instead.

### When not to use collaborative investigation

- A verdict on a known change → independent parallel review with a primary merge, if its validation checks pass
- One specialist perspective on one artifact → direct work
- A dependent lifecycle (discussion → plan → implementation) → user-directed sequential phases
- Read-heavy research with a small digest → research isolation

Choose collaboration only when investigators need to challenge each other to produce the right answer, and only when the available runtime can support that interaction.

## Anti-patterns

### A. Routing assistant with no domain value

A layer whose job is deciding which specialist to invoke, then paraphrasing that specialist's result:

```
request → router → “this needs a review” → reviewer → router paraphrases → user
```

**Why it fails:**

- Adds a pure routing layer with no domain value
- Adds paraphrasing hops, causing information loss and roughly twice the context/turn cost
- The user often already knows which review they want
- Replicates intent mapping that belongs in the repository's local router or user request

**What to do instead:** refine the direct request or the existing skill router's intent mapping. Keep a routing step only when it contributes a real decision that cannot be expressed more simply.

### B. One specialist invokes another specialist

For example, a reviewer sees authentication code and internally launches a separate security review.

**Why it fails:**

- A specialist is scoped to one perspective; chaining it obscures which perspective and rules govern the result
- A summary passed between specialists loses context the second investigator needs
- Failure modes multiply (which output contract wins? who owns the conclusion?)
- Hides cost and scope from the user

**What to do instead:** the first report may recommend a follow-up. The user or primary assistant makes the next explicit workflow decision and supplies the relevant context.

### C. Sequential coordinator that paraphrases

A coordinator performs the whole sequence (discussion, plan, build, verify, review, ship) on the user's behalf and summarizes each stage to the next.

**Why it fails:**

- Removes human checkpoints that catch wrong-direction work
- Each handoff summarizes context, accumulating drift across a long pipeline
- Adds an orchestration turn plus a work turn for every stage
- Removes user agency at the points where judgment and authorization matter most

**What to do instead:** keep the user as the orchestrator. Make the recommended order and handoff requirements explicit, and let each phase finish with its output and next decision point.

### D. Deep delegation trees

One workflow delegates to a coordinator, which delegates to another coordinator, which invokes a specialist.

**Why it fails:**

- Each layer adds latency and context cost without necessarily adding decision value
- Failures and ownership become difficult to trace
- Leaf workers lose context through multiple summarizations

**What to do instead:** keep orchestration shallow: the primary assistant may delegate focused slices, then owns the merge. Do not delegate further unless a separate, explicit contract gives that extra level a necessary independent role.

## Decision flow

When considering an orchestrated workflow, walk this flow:

```
Is the work one perspective on one artifact?
├── Yes → Direct work. Stop.
└── No  → Will the same composition recur?
         ├── No  → Direct, ad hoc work. Stop.
         └── Yes → Are the subtasks independent?
                  ├── No  → Sequential, user-directed phases (Pattern 4).
                  └── Yes → Parallel fan-out with primary merge (Pattern 3).
                           Validate against its checklist.
                           If any check fails → use direct work or one reusable workflow (Pattern 2).
```

If the problem is an unknown root cause rather than a known artifact, consider competing-hypothesis investigation only when peer communication is available and justified by the cost of a wrong conclusion.

## When to add a new pattern

Add an entry to this catalog only after:

1. The pattern has been used at least twice in real work
2. It has a concrete artifact or workflow in this repository that demonstrates it
3. There is a clear explanation for why an existing pattern did not work
4. Its likely anti-pattern shadow is described (what people will mistakenly build instead)

A pattern without evidence is aspirational documentation that no one follows.
