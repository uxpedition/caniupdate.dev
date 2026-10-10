---
name: domain-modeling
description: Use when clarifying domain terminology, resolving conflicting or overloaded concepts, maintaining a domain glossary, or recording significant domain decisions in ADRs.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design: clarify terms, probe edge cases, and capture resolved language and decisions in the conversation. Merely reading a glossary is not this skill; use it when changing the model.

## Composition and authorization

No other skill is required for standalone use. When composed with `grill-with-artifacts`, the wrapper owns scope, focused questions, recommendations, completion, and publication. Clarify terminology only where it affects the confirmed slice; park independently useful glossary cleanup. Capture settled wording immediately in chat, separating domain intent, verified behaviour, adopted choices, and unknowns. A settled term or decision is not authorization to write files. Show proposed edits and destinations for review before writing, unless explicitly authorized already.

## File structure

Read repository documentation conventions before choosing destinations. Here, `docs/CONTEXT.md` places settled decisions in `docs/engineering/adrs/` with descriptive filenames. Follow the existing convention rather than creating a competing ADR directory or numbering scheme.

Most repos use a root `GLOSSARY.md`. If a root `GLOSSARY-MAP.md` exists, follow its links to the relevant context's glossary and decision records. Preserve context-specific organization rather than flattening it. If no glossary exists, propose a root `GLOSSARY.md` when the first domain term is resolved.

Create files and directories lazily, only when approved content needs them. An interview alone does not authorize their creation.

## During the session

### Challenge against the glossary

When a conflicting term affects the agreed output, clarify it in the focused interview: "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?" Park unrelated terminology conflicts rather than expanding the session.

### Sharpen fuzzy language

When vague or overloaded language affects the slice, ask for the intended meaning using neutral alternatives: "You're saying 'account': do you mean the Customer or the User? Those are different things." Record canonical wording once adopted; when the user asks for naming advice, propose a precise term.

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Capture glossary changes inline

When a term is resolved, capture its definition in the conversation immediately using [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md). Show the proposed glossary edit and destination for review. Write it when explicitly authorized; otherwise retain the in-chat capture until review. Prior authorization to maintain the glossary permits inline writes of resolved terms, not invented definitions or unrelated cleanup.

`GLOSSARY.md` should be totally devoid of implementation details. Do not treat `GLOSSARY.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Preserve consequential decisions

Offer an ADR for every expensive-to-reverse domain decision, even when the choice seems obvious or unsurprising today. Other significant constraints or non-obvious decisions can also warrant a record. Use the eligibility guidance and format in [ADR-FORMAT.md](./ADR-FORMAT.md); obtain publication authorization separately.
