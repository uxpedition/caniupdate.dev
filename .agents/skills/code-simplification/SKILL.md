---
name: code-simplification
description: Simplify working code for clarity without changing behavior. Use for focused refactors, accumulated complexity, duplication, or readability improvements after understanding the code's contract.
---

# Code Simplification

## Purpose

Simplify by reducing complexity while preserving behavior. The goal is not fewer lines; it is code that is easier to read, understand, modify, and debug. Before accepting a simplification ask: **Would a new teammate understand this version faster than the original?**

## When to use

- A feature works but its implementation is heavier or harder to follow than needed.
- A review identified readability or complexity issues.
- You encounter deep nesting, long functions, unclear names, duplicated logic, or inconsistent patterns.
- Recent work introduced duplication or unnecessary indirection.
- Related logic is scattered and can be made more local without changing behavior.

Do not simplify merely to make a diff. Leave already-clear code alone. Understand the responsibility and contract before changing anything. Avoid using simplification as cover for a module rewrite, an unrelated cleanup, or a performance regression.

## Five principles

### 1. Preserve behavior exactly

A simplification changes expression, not observable behavior. Preserve results, accepted/rejected inputs, side effects, ordering, errors, timing/async contracts where observable, and relevant resource use.

Before each change, ask:

- Does this produce the same result for every relevant input, including empty and boundary values?
- Does it preserve the same error/rejection behavior and error context?
- Does it preserve side effects, their ordering, and state transitions?
- Do the existing tests express the same contract and pass without being weakened or rewritten?
- Is the “simpler” code measurably slower in a performance-sensitive path?

If exact equivalence is uncertain, inspect more context or do not make the change. A test that needs to be modified merely to accept a behavior change is evidence that this is not a pure simplification; separate the intentional behavior change and obtain the appropriate authorization.

### 2. Follow project conventions

Simplification means making code more consistent with this repository, not imposing a preferred external style. Before editing:

1. Read relevant repository/agent instructions and documentation.
2. Study neighboring implementations of the same kind of behavior.
3. Discover the actual language, formatter, package manager, and tooling from manifests/configuration/CI; never guess them.
4. Match local import ordering, module system, declaration style, naming, error handling, and type depth.

Use the repository's existing abstractions where they serve the same purpose; do not create a second convention. When changing module interfaces or seams, use the vocabulary and design guidance in [codebase-design](../codebase-design/SKILL.md): module, interface, depth, seam, adapter, leverage, and locality. When a simplification changes domain terminology or a model's concepts, consult [domain-modeling](../domain-modeling/SKILL.md) rather than silently renaming the domain.

### 3. Prefer clarity over cleverness

Explicit code is better than compact code when the compact form requires a mental pause to parse.

```typescript
// Harder to scan: a nested conditional makes the priority order implicit.
const label = isNew ? 'New' : isUpdated ? 'Updated' : isArchived ? 'Archived' : 'Active';

// Clearer: each branch and its priority are visible.
function getStatusLabel(item: Item): string {
  if (item.isNew) return 'New';
  if (item.isUpdated) return 'Updated';
  if (item.isArchived) return 'Archived';
  return 'Active';
}
```

```typescript
// Harder to scan: accumulation and defaulting are embedded in a reducer.
const result = items.reduce(
  (acc, item) => ({
    ...acc,
    [item.id]: { ...acc[item.id], count: (acc[item.id]?.count ?? 0) + 1 },
  }),
  {},
);

// Clearer for a count-by-id operation: name the result and update one entry.
const countById = new Map<string, number>();
for (const item of items) {
  countById.set(item.id, (countById.get(item.id) ?? 0) + 1);
}
```

These are illustrative TypeScript examples, not a repository stack assumption. A shorter alternative is not automatically clearer: compare against the actual data contract and local idioms.

### 4. Maintain balance

Watch for over-simplification:

- **Inlining too aggressively:** removing a helper can erase a useful concept name and make callers harder to understand.
- **Combining unrelated logic:** two simple responsibilities in one large function are not simpler.
- **Removing an abstraction reflexively:** an abstraction may support a real seam, testability, or necessary variation even if only one adapter is currently visible.
- **Optimizing line count:** comprehension and locality matter more than line count.
- **Compressing meaningful error handling:** a shorter path that changes failure behavior is not a simplification.

### 5. Scope to the task

Default to code changed for the current task. Avoid unrelated “drive-by” refactors unless the user authorizes a broader scope. Unscoped simplification adds review noise and regression risk.

## Simplification process

### Step 1: Understand before touching — Chesterton's Fence

Before changing or deleting code, answer:

- What responsibility and behavior does this code own?
- What calls it, and what does it call?
- What are the edge cases, ordering constraints, and error paths?
- Which tests or consumers define its behavior?
- Why might it have been written this way—performance, platform limits, a past bug, or compatibility?
- What do the repository's history and adjacent code reveal about its purpose? Use Git blame/history only if available and safe; protect existing user changes.

If these answers are unknown, investigate rather than simplifying on appearance. A fence may still be needed; understand its reason first.

### Step 2: Identify concrete simplification opportunities

Look for a signal, then verify it in context:

#### Structural complexity

| Pattern                             | Signal                                                         | Possible simplification                                                       |
| ----------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Deep nesting (three or more levels) | The reader must retain several conditions at once.             | Use guard clauses or a focused helper when that makes flow clearer.           |
| Long function (around 50+ lines)    | Multiple responsibilities or phases are interleaved.           | Split into focused functions with names that reveal responsibility.           |
| Nested ternary                      | The reader must mentally track branch priority.                | Use a clear `if`/`else`, `switch`, or lookup when semantics remain identical. |
| Boolean parameter flags             | Calls such as `doThing(true, false, true)` hide their meaning. | Use named options or separate operations when it improves the interface.      |
| Repeated conditionals               | The same shape is checked in several places.                   | Extract a well-named predicate or model only if it removes duplication.       |

#### Naming and readability

| Pattern                                                 | Signal                                                   | Possible simplification                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Generic names (`data`, `result`, `temp`, `val`, `item`) | The value's role is unclear at its use site.             | Name its domain meaning (`userProfile`, `validationErrors`).                             |
| Unfamiliar abbreviation (`usr`, `cfg`, `btn`, `evt`)    | The reader must decode a local shorthand.                | Spell it out unless the abbreviation is universal in this codebase (`id`, `url`, `api`). |
| Misleading name                                         | A function named `get` also mutates or has side effects. | Rename only to reflect actual behavior and local naming conventions.                     |
| Comment says what obvious code does                     | The comment duplicates the operation.                    | Delete the no-op comment.                                                                |
| Comment explains why                                    | The code alone cannot express the constraint or reason.  | Keep it, and keep it close to the relevant code.                                         |

#### Redundancy

| Pattern                  | Signal                                                                      | Possible simplification                                                      |
| ------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Duplicated logic         | The same meaningful block appears in several locations.                     | Reuse/extract one canonical helper if it improves locality.                  |
| Dead code                | Unreachable branches, unused variables, commented-out code.                 | Prove it is dead, then remove it within authorized scope.                    |
| No-value wrapper         | A wrapper adds no behavior, contract, or naming value.                      | Inline/remove it if doing so does not weaken a useful seam.                  |
| Speculative abstraction  | A factory-for-a-factory or one-strategy framework has no present variation. | Replace with the direct approach; add abstraction when real use requires it. |
| Redundant type assertion | The type is already correctly inferred.                                     | Remove it only after checking the inferred contract and compiler behavior.   |

Do not generalize from a smell alone. A long function can be clear; a repeated condition may represent a deliberate policy boundary; unused-looking code may be public compatibility. Verify before acting.

### Step 3: Apply one change at a time

For each candidate simplification:

1. Make one focused behavior-preserving change.
2. Run the focused test or check using the command discovered from repository docs/configuration.
3. Compare relevant output, errors, side effects, and behavior with the original contract.
4. If verification fails or equivalence is unclear, restore only your change and reconsider; never overwrite unrelated user edits.
5. After individual changes, run the broader relevant checks warranted by the repository and scope.

Separate refactoring from feature/bug behavior changes. When a slice is verified and commits are authorized, keep a separate commit per finished code/durable-documentation slice. Do not create a commit without authorization and never commit temporary plans, test artifacts, or working notes.

**Rule of 500:** If a refactoring would touch more than about 500 lines, use a code-aware transformation (for example, an AST codemod) instead of hand-editing a large repetitive change. Test the transformation on a disposable sample under the task's named OS-temporary `${workDir}` outside the repository, inspect the full diff, and verify behavior. If no `workDir` exists, discover the OS temp location through the active runtime, create a uniquely named per-work directory, and record/propagate its exact absolute path. The threshold is a warning to automate, not a reason to change unrelated files or to trust generated output without review.

### Step 4: Evaluate the result

Compare the original and simplified versions against the same contract:

- Is the new code genuinely faster to understand?
- Did it introduce a pattern inconsistent with the repository?
- Is the diff focused and reviewable?
- Are edge cases, errors, side effects, and performance behavior preserved?
- Would a teammate approve the change as a net improvement?

If the new version is harder to understand, changes behavior, weakens error handling, or spreads complexity, restore the simplification and keep the original.

## Language-specific examples

These examples preserve the source skill's TypeScript/JavaScript, Python, and React illustrations. They are examples only: inspect the actual repository and apply the same reasoning in its language and conventions.

### TypeScript / JavaScript

**Redundant `await`:** keep `async` semantics when they are part of the contract; removing `await` is safe only when rejection/error handling, stack context, and ordering remain equivalent. For a simple forwarding function with no local `try`/`catch`/`finally`:

```typescript
// Before
async function getUser(id: string): Promise<User> {
  return await userService.findById(id);
}

// After: still async, but no redundant await.
async function getUser(id: string): Promise<User> {
  return userService.findById(id);
}
```

**Conditional assignment:** this preserves the original truthiness behavior of the `if` form. Do not change `||` to `??` (or vice versa) unless the empty-string/zero/null semantics are intended:

```typescript
// Before
let displayName: string;
if (user.nickname) {
  displayName = user.nickname;
} else {
  displayName = user.fullName;
}

// After: same truthiness condition.
const displayName = user.nickname || user.fullName;
```

**Manual array building:** for a pure, non-mutating predicate over an ordinary array, a filter expresses the operation directly. Retain a loop when it has required ordering, side effects, early exit, or mutation behavior:

```typescript
// Before
const activeUsers: User[] = [];
for (const user of users) {
  if (user.isActive) {
    activeUsers.push(user);
  }
}

// After
const activeUsers = users.filter((user) => user.isActive);
```

**Redundant boolean return:**

```typescript
// Before
function isValid(input: string): boolean {
  if (input.length > 0 && input.length < 100) {
    return true;
  }
  return false;
}

// After
function isValid(input: string): boolean {
  return input.length > 0 && input.length < 100;
}
```

### Python

**Verbose dictionary building:**

```python
# Before
result = {}
for item in items:
    result[item.id] = item.name

# After
result = {item.id: item.name for item in items}
```

**Nested conditionals with early return:** preserves the validation/permission order and exceptions:

```python
# Before
def process(data):
    if data is not None:
        if data.is_valid():
            if data.has_permission():
                return do_work(data)
            else:
                raise PermissionError("No permission")
        else:
            raise ValueError("Invalid data")
    else:
        raise TypeError("Data is None")

# After
def process(data):
    if data is None:
        raise TypeError("Data is None")
    if not data.is_valid():
        raise ValueError("Invalid data")
    if not data.has_permission():
        raise PermissionError("No permission")
    return do_work(data)
```

### React / JSX

**Verbose conditional rendering:**

```tsx
// Before
function UserBadge({ user }: Props) {
  if (user.isAdmin) {
    return <Badge variant='admin'>Admin</Badge>;
  } else {
    return <Badge variant='default'>User</Badge>;
  }
}

// After
function UserBadge({ user }: Props) {
  const variant = user.isAdmin ? 'admin' : 'default';
  const label = user.isAdmin ? 'Admin' : 'User';
  return <Badge variant={variant}>{label}</Badge>;
}
```

**Prop drilling:** consider whether composition or context solves a demonstrated problem, but this is a design judgment, not an automatic refactor. Load codebase-design before changing module interfaces/seams and compare the proposed interface against existing patterns. Flag the concern first when the right design is unclear.

## Common rationalizations

| Rationalization                               | Reality                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| “It's working; no need to touch it.”          | Working code that is hard to understand is harder to repair; simplify only when there is a concrete gain.         |
| “Fewer lines is always simpler.”              | A dense nested expression may be slower to comprehend than a longer direct flow.                                  |
| “I'll quickly simplify unrelated code too.”   | Unscoped changes create noisy diffs and regression risk; stay within the authorized task.                         |
| “The types make it self-documenting.”         | Types describe structure; names and focused logic can explain intent.                                             |
| “This abstraction might be useful later.”     | Speculative abstractions carry complexity now; keep only abstractions with present value or a justified contract. |
| “The original author must have had a reason.” | Inspect behavior/history before removing the fence; accumulated complexity may also be residue.                   |
| “I'll refactor while adding this feature.”    | Separate behavior changes from behavior-preserving refactors so each can be reviewed and reverted clearly.        |

## Red flags

- Tests had to be weakened or changed to make a supposed simplification pass.
- The “simpler” code is longer and harder to follow without a real gain.
- Names changed to match personal preference rather than project convention.
- Error handling, validation, or a useful seam was removed just to reduce code.
- The code was simplified before its contract and purpose were understood.
- Many candidates were batched into one hard-to-review change.
- Unrelated code was refactored without authorization.
- A supposedly equivalent rewrite changes falsy/null behavior, ordering, exceptions, timing, or side effects.

## Verification checklist

After a simplification pass, record evidence that:

- [ ] The repository's relevant conventions and nearby patterns were checked.
- [ ] Each simplification was applied and reviewed incrementally.
- [ ] Existing behavior tests pass without being weakened; edge/error/side-effect contracts were considered.
- [ ] The project's applicable build, type, lint, or format checks passed, if those checks exist and are relevant.
- [ ] The diff is focused, clean, and reviewable; each slice is independently understandable.
- [ ] No error handling or meaningful abstraction was removed without evidence.
- [ ] No dead code, unused imports, or temporary scaffolding remains.
- [ ] The result is easier to understand and consistent with project conventions.
- [ ] No temporary working artifact was committed and no unrequested behavior change was introduced.

See [shared skill policy](../../references/POLICY.md).
