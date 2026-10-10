# Ideation Session Examples

These examples show the rhythm and specificity of good sessions across a vague product idea, an existing-codebase feature, and a process improvement. Learn the pattern, not the literal answers.

---

## Example 1: Vague Early-Stage Concept (Full Three-Phase Session)

**User invokes `idea-refine`:** "I want to help small local restaurants compete with the big delivery platforms."

### Phase 1: Understand and Expand

**Skill response:**

> **How might we** give independent restaurants the reach and convenience customers expect from delivery platforms, without forcing them into a model that erodes their margins and brand?

That's a big space. Let me sharpen it:

1. **Which part of "compete"?** Customer acquisition? Delivery logistics? Online ordering UX? Loyalty and retention? Margin pressure from platform fees?
2. **Who are you building for?** The restaurant owner, the diner, or both?
3. **What is the constraint?** Are you thinking software, a cooperative model, something physical, or are you open?

**User responds:** "Restaurant owners. The core pain is that they're paying 25–30% commission to delivery apps but feel they can't opt out because that's where the customers are. I'm thinking software but I'm open."

**Skill continues:**

So the problem isn't delivery logistics — it's **customer dependency**. The platforms own the customer relationship, and restaurants are renting access to their own customers at 30% of revenue. That's the leverage to break.

Here are six variations:

1. **Direct Channel Toolkit:** Give restaurants their own branded ordering — web, SMS, perhaps a lightweight app — so they can move existing customers off-platform. The core bet: customers who already know a restaurant will order direct if it's easy enough. You don't need to compete for discovery, just for reordering.
2. **Inversion — Charge the Customer, Not the Restaurant:** What if the delivery-fee model flipped? Customers pay a small premium for direct ordering, restaurants pay zero commission. The bet: enough customers care about supporting local businesses to pay $1–2 more per order.
3. **Simplification — What If Delivery Weren't Required?** The platforms bundle discovery, ordering, and delivery, but most of the restaurant's commission is tied to delivery. What if you only solved ordering and pickup? A pickup-first model lets restaurants keep more revenue and customers save the delivery fee. It works best in dense neighborhoods.
4. **Combination — Restaurant Collective:** A cooperative model where 20–50 local restaurants in an area share a platform, split costs, and cross-promote. Individual restaurants may not afford marketing, but a neighborhood collective can. Think "local food hall" but digital.
5. **Audience Shift — For Regular Customers:** Don't try to acquire new customers. Build for a restaurant's existing regulars — the people who come in weekly. A loyalty/reorder tool that's dead simple: "Your usual?" one-tap reorder. The bet: regulars don't need a marketplace to discover a restaurant they already know.
6. **Expert Lens — What Restaurant Owners Actually Do:** Most small restaurant owners aren't looking at dashboards; they're in the kitchen. Any tool that requires them to manage something will fail. The winning approach might be something that runs itself — a reorder reminder, the daily special, or an easy reorder — with near-zero restaurant-side effort.

Variations 5 and 6 together are interesting. Instead of trying to out-platform the platforms, you'd build something hyper-narrow: a reordering and retention tool for a restaurant's best existing customers. No discovery, no delivery, no marketplace. Just keep regulars ordering direct.

Which directions interest you?

### Phase 2: Evaluate and Converge

**User responds:** "I love the regulars angle (5 and 6). The direct channel toolkit (1) feels necessary but boring. The co-op idea (4) is interesting but complex. Let me focus on 1 + 5 + 6 combined."

**Skill response:**

That combination has a clear thesis: **own the relationship with your best customers, make reordering effortless, and require near-zero effort from the restaurant owner.** Let me stress-test it.

**Direction A: The Regulars Engine (variations 5 + 6 fused)**
A tool focused on a restaurant's existing repeat customers: easy reordering, light engagement, little management.

- **Core bet:** A restaurant's repeat customers will shift to direct ordering if the experience is frictionless and personal. The restaurant may not need new customers as much as it needs to stop paying commission on customers it already has.
- **User value:** Potentially high and immediate. Direct reorders could save platform fees on recurring revenue. Validate actual fees, customer behavior, and willingness to switch before using a savings estimate as fact.
- **Feasibility:** Medium. Ordering and payment technology may be commodity; the hard parts are identifying and onboarding regulars, obtaining permission to contact them, and solving the cold start when their order history belongs to the platform.
- **Differentiation:** Strong for the niche if it optimizes specifically for direct reordering rather than marketplace discovery or delivery logistics.
- **Hidden assumptions:** Regulars will use another ordering route; owners can share customer contact details appropriately; direct orders won't cannibalize dine-in revenue.
- **What could kill it:** Customers may refuse to switch channels. Habit is powerful even when a new method is cheaper.

**Direction B: Direct Channel + Retention Hybrid (variation 1 + 5)**
Branded ordering for the restaurant plus retention automation. More complete, but more complex.

- **Core bet:** Restaurants need both the channel and the engine that keeps customers using that channel.
- **User value:** Higher ceiling if both parts reinforce each other. Ordering alone is a commodity; retention alone has no channel to retain customers on.
- **Feasibility:** Lower. You're building two products and hoping they work better together.
- **Differentiation:** Medium. The combination is interesting, but each component has alternatives.
- **Hidden assumption:** Bundling is better than integrating with an existing ordering service.
- **What could kill it:** Scope. Building two things well is harder than building one thing well.

**The honest read:** Direction A is the sharper bet. Direction B is safer but less differentiated. The biggest risk for A is getting customers to switch channels. If an SMS-based reorder works, it may lower friction without requiring another app. One pushback: including the "necessary" channel first is how products lose focus. If the regulars engine works, the broader channel can come later.

### Phase 3: Sharpen the Brief

**Skill produces this draft in the conversation; it writes the file only with the required authorization:**

# ReOrder: Keep Your Regulars Ordering Direct

## Problem Statement

How might we help independent restaurants retain their best existing customers through direct reordering, reducing the platform commissions on the revenue that matters most?

## Recommended Direction

Build a **regulars-focused retention experiment**, not a marketplace or a full ordering platform. Focus on one job: make it effortless for a restaurant's repeat customers to reorder directly.

The key insight is that restaurants may already know their regulars; the challenge is moving those relationships to a direct channel. The tool must demand little owner attention. An SMS-first test may be lower friction than asking customers to install another app.

## Key Assumptions to Validate

- [ ] Repeat customers will reorder through SMS or a direct link instead of their usual platform — test with a small, consent-based pilot and measure conversion over a defined period.
- [ ] Restaurant owners can identify regulars and appropriately invite them — test with owners before building an integration.
- [ ] Commission savings are motivating enough to justify setup effort — verify actual fee schedules and interview owners.

## MVP Scope

- A consent-based direct reorder flow for one restaurant's existing regulars
- A small pilot list supplied by the restaurant with appropriate permission
- A customer can confirm an order and pay through a direct link
- The restaurant receives the order using the simplest available workflow
- Start with pickup if it tests the core behavior without delivery operations
- No discovery marketplace, native app, or POS integration in the first test

## Not Doing (and Why)

- **Delivery logistics** — complex and not necessary to test whether regulars will reorder directly.
- **Customer discovery** — a marketplace competes on a different job; start with known customers.
- **Branded native apps** — an app install may add friction before the direct-ordering behavior is proven.
- **Menu/POS integrations** — defer until manual setup is demonstrably the bottleneck.
- **Active analytics dashboards** — test the core behavior before building reporting surfaces.

## Open Questions

- What consent and messaging rules apply to customer outreach in the target jurisdiction?
- How will price or menu changes affect a saved "usual" order?
- Can existing POS data be used lawfully and with permission?
- What payment and pricing model would fit the confirmed user value?

The skill then asks whether the user wants this brief saved at the exact OS-temporary `${workDir}/idea.md` path and waits for explicit authorization. It does not start implementation or publish the brief to project documentation.

---

## Example 2: Feature Idea Within an Existing Product (Codebase-Aware)

**User invokes `idea-refine`:** "Add real-time collaboration to our document editor."

### Phase 1: Understand and Expand

**Skill response:**

> **How might we** let multiple people work on the same document simultaneously in a way that feels natural, not chaotic?

I inspected the relevant repository files. The editor uses block-based documents and a REST API for persistence; I found no existing WebSocket infrastructure. The document model uses independent blocks with a flat ordering system (`src/models/document.ts:45`). Those are useful constraints, not proof that any implementation is easy.

A few questions:

1. **What's the collaboration pattern?** Simultaneous editing of the same paragraph, work in different sections, or reviewing/commenting while one person edits?
2. **How many simultaneous users** need to collaborate?
3. **What's driving this now?** Customer requests, competitive pressure, or an internal need?

**User responds:** "2–5 people, usually working in different sections. Customers keep asking. We're losing deals because they assume any modern editor has this."

**Skill continues:**

The competitive pressure matters: this might be a checkbox feature to stay in the consideration set, not a differentiator. That changes how much to invest.

Here are five variations:

1. **Block-Level Locking (simplest path):** When someone edits a block, others see who is editing and work elsewhere. This avoids character-level conflict resolution but must define lock expiry, failure recovery, and what happens when two edits race.
2. **Inversion — Async-First Collaboration:** Make comments, suggestions, and proposed edits the primary mode. For a small group working in different sections, async may be more useful than simultaneous typing.
3. **Simplification — Presence Without Co-Editing:** Show who is viewing a document and which section they are looking at, but keep editing single-writer. This may provide coordination value at a fraction of the complexity, though it may not satisfy the request.
4. **Combination — Collaboration + Version Branches:** Let people edit separate branches, then review and merge. This avoids some live conflicts but requires a clear merge experience.
5. **10x Version — AI-Mediated Collaboration:** People describe what they want in a section and a synthesis process produces a draft. Radical and risky; useful as a future possibility, not an assumed requirement.

Given the current architecture and competitive context, I'd compare variation 1 with variation 3. The first is closer to real co-editing; the third may be cheaper but might fail the expectation behind the request.

### Phase 2: Evaluate and Converge

**User responds:** "The regular presence idea sounds closest, but reviewers still need to suggest changes. The release is not a hard deadline."

The skill waits for the reaction before clustering. It might then compare **presence + suggestions** against **block locking + suggestions**, test both against how users work, and call out whether suggestions are a new requirement or a hypothesis. It would explain the strongest technical unknowns and link each codebase claim to the files it read. It does not silently decide that the REST API must become a real-time transport.

### Phase 3: Sharpen the Brief

The temporary brief would recommend a bounded experiment only if the user selects or authorizes that direction. Its Not Doing list might defer character-level conflict-free replication, offline synchronization, and AI features because they are not needed to test the confirmed collaboration job. It records the exact repository evidence and leaves unresolved decisions visible rather than inventing product requirements.

---

## Example 3: Process/Workflow Idea (Non-Product)

**User invokes `idea-refine`:** "A better way to run our weekly team retrospectives — they've gotten stale and people dread them."

### Phase 1: Understand and Expand

**Skill response:**

> **How might we** make retrospectives genuinely useful — something the team looks forward to — instead of a recurring meeting people endure?

Before expanding:

1. **What's stale about them?** Same format, same people talking, action items that never happen, or repetitive topics?
2. **What's the team dynamic?** How many people participate, and who tends to speak?
3. **What does a good retro look like?** Have you had one that worked, and what made it different?

**User responds:** "Eight people, maybe 3–4 actually talk. Same 'what went well / what didn't / action items' format for a year. Action items pile up and nothing changes. People think it's theater."

**Skill continues:**

The action-item problem is the strongest signal. If nothing changes after the retro, people rationally disengage. The meeting may not be stale so much as **broken at the output layer**.

Here are six variations:

1. **Fix the Output, Not the Meeting:** Keep the format but limit the retro to one action item, assign an owner and deadline during the meeting, and open the next retro by reviewing it. The constraint forces prioritization.
2. **Inversion — Kill the Meeting:** Collect reflections asynchronously during the week, synthesize themes, then use a short meeting to agree on one change. The bet is that writing produces more honest input.
3. **Audience Shift — Retro for the Quiet Ones:** Use anonymous topic submission, dot-voting, and pair discussion before group discussion to prevent a few voices from dominating.
4. **Simplification — The One Question Retro:** Ask exactly one rotating question each week. The constraint encourages depth over breadth.
5. **Combination — Retro + Experimentation:** Treat each output as a hypothesis, run it as a short experiment, then keep, modify, or stop it at the next retro.
6. **Expert Lens — Psychological Safety:** The format may be a symptom. Start with an anonymous team-health signal and investigate whether people feel safe naming the real problem.

Variations 1 and 5 address output; 2–4 address input; 6 suggests a deeper cause. Where do you think the bottleneck is?

### Phase 2: Evaluate and Converge

The user might choose follow-through as the primary problem. The skill then compares one-action accountability with a short experiment cycle, evaluating effort, safety, and whether both can be tried without a tool purchase. It should not convert a plausible interpretation into a settled fact without the user's reaction.

### Phase 3: Sharpen the Brief

A useful brief might recommend a zero-cost, two-week experiment: one action per retro, with an owner, deadline, and next-meeting review. Its Not Doing list could defer new software, elaborate facilitation, and broad format changes until the experiment shows whether follow-through was the bottleneck. The validation measure is whether an agreed action was completed and changed a working condition, not whether the document grew.

---

## What to Notice

1. **The restatement changes the frame.** "Help restaurants compete" becomes retaining existing customers; a feature request becomes the collaboration job; a stale meeting becomes a follow-through problem.
2. **Questions diagnose before prescribing.** Each question changes which kinds of solution are relevant.
3. **Variations have reasons.** The lens explains why an option exists, not just what it is.
4. **The skill has opinions, with evidence.** It recommends when asked, names risks, and pushes back without claiming unverified facts.
5. **Evaluation is honest.** Low differentiation, high complexity, or behavioral switching costs are explicit.
6. **The output is actionable.** It describes validation or an experiment, not just more thinking.
7. **The Not Doing list prevents scope creep.** Each cut is tempting and has a reason.
8. **The skill adapts to context.** A codebase idea uses repository evidence; a process idea proposes a process experiment rather than forcing a product MVP.
9. **Authorization is a separate gate.** A compelling brief does not authorize implementation or durable publication.
