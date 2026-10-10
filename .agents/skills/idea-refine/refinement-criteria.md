# Refinement and Evaluation Criteria

Use this rubric in Phase 2 (Evaluate and Converge) to stress-test directions. Not every criterion applies to every idea; use judgment about the domain and the user's confirmed goals.

## Core Evaluation Dimensions

### 1. User Value

The most important dimension. If the value is unclear, nothing else matters.

**Painkiller vs. vitamin:**

- **Painkiller:** Solves an acute, frequent problem. People actively seek a solution, have built workarounds, describe the problem with emotion, or will pay to remove it.
- **Vitamin:** Nice to have; it marginally improves something but people will not change behavior. Users may nod politely and then do nothing.

**Questions:**

- Can you name three specific people with this problem now?
- What do they do today instead? The real competitor is often the current workaround.
- Would they switch? What would make them switch?
- How often do they encounter the problem? Daily problems generally have more pull than monthly problems.
- Is this a pull problem (people request it) or a push problem (the builder believes they should want it)?

**Red flags:**

- "Everyone could use this" — no specific user means value is unclear.
- "It's like X but better" — marginal improvements rarely drive adoption.
- The problem is intense but rare — high intensity with low frequency may not justify a product.

### 2. Feasibility

Can this be built or changed in practice, not only in theory?

**Technical feasibility:**

- Does the core technology exist and work reliably?
- What is the hardest technical problem? Is it known to be hard or novel?
- Are there dependencies on third parties, APIs, or data sources the team does not control?
- What is the minimum technical stack needed? A large answer is a signal to investigate scope.

**Resource feasibility:**

- What is the minimum team and effort for a useful test or MVP?
- Is specialized expertise required?
- Are there legal, regulatory, safety, or compliance requirements?

**Time-to-value:**

- How quickly can the idea reach the affected people?
- Is there a version that delivers value in days or weeks rather than months?
- What is the critical path — what must happen first?

**Red flags:**

- "We just need to solve [very hard research problem] first."
- Several dependencies all need to work at once.
- The alleged MVP still takes months — perhaps it is not minimal enough.

### 3. Differentiation

What makes this meaningfully different to the people it serves — not merely technically different?

**Questions:**

- If a user described it to a friend, what would they say? Is that compelling?
- What is the one thing it does that alternatives do not?
- Is the difference durable, or can a competitor copy it quickly?
- Is it a difference users care about, or one builders find interesting?

**Types of differentiation (strongest to weakest):**

1. **New capability:** Does something previously impossible.
2. **10x improvement:** So much better on a key dimension that it changes behavior.
3. **New audience:** Brings an existing capability to people previously excluded.
4. **New context:** Works where existing solutions fail.
5. **Better UX:** Same capability with a dramatically simpler experience.
6. **Cheaper:** Same thing at lower cost; often easiest to copy.

**Red flags:**

- Differentiation is entirely about technology, not user experience.
- "Faster/cheaper/prettier" has no structural reason behind it.
- The differentiating feature is not the feature users care about most.

## Assumption Audit

For every direction, classify assumptions:

### Must Be True (Dealbreakers)

If false, the idea fails. Validate before substantial building.

Example: "Users will share their data with us." If they will not, the product cannot work as proposed.

### Should Be True (Important)

These assumptions strongly affect success but allow an adjustment if false.

Example: "Users prefer self-serve over talking to a person." If false, the go-to-market changes but the underlying product might survive.

### Might Be True (Nice to Have)

Secondary features or optimizations. Do not validate before the core value is demonstrated.

Example: "Users will want to share results with teammates" may be a growth feature, not core value.

## Decision Framework

Rank directions using this matrix, then use differentiation as the tiebreaker within a quadrant:

|                | High Feasibility | Low Feasibility |
| -------------- | ---------------- | --------------- |
| **High Value** | Do this first    | Worth the risk  |
| **Low Value**  | Only if trivial  | Don't do this   |

Make explicit where evidence is missing; the matrix is a prompt for judgment, not numerical proof.

## MVP Scoping Principles

1. **One job, done well.** The MVP should nail one user job, not do three jobs partially.
2. **Riskiest assumption first.** The primary purpose is to test the assumption most likely to be wrong.
3. **Time-box, not feature-list.** Ask what can be built and tested in a timeframe, not what features a product should eventually contain.
4. **Not Doing is mandatory.** Name what is cut and why. This prevents scope creep and forces prioritization.
5. **Make the first test small.** The first version should feel incomplete to the builder; if it does not, check whether it is overbuilt.
