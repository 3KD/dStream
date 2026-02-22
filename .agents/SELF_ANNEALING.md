# SELF_ANNEALING

Defines the self-annealing workflow for non-trivial changes.

## 1. When to Use Self-Annealing

- Always use for:
  - Large or major edits (see CHANGE_CLASSES).
  - Any change that modifies shared/public interfaces or critical behavior.
  - Multi-file updates that could break integration.
- Optional but recommended for:
  - Medium edits that impact behavior in multiple places.

## 2. Self-Annealing Steps

1. **Apply code changes**
   - Implement the change in code, keeping edits as small and focused as possible.

2. **Update tests**
   - Update or add tests to reflect new behavior.
   - Ensure tests cover normal cases, edge cases, and error paths if applicable.

3. **Update docs/specs**
   - Sync relevant docs, specs, comments, and doc-blocks with the new behavior.
   - Ensure examples and descriptions are still correct.

4. **Update logs/change history**
   - Write a structured change summary:
     - What changed.
     - Why it changed.
     - Files/modules touched.
     - Risks or assumptions.
     - Follow-up items or technical debt.

5. **List edge cases**
   - Record known edge cases and how they are handled (or not yet handled).

6. **Propose next improvements**
   - Note small follow-up refactors or cleanup steps that are out of scope for the current change.

7. **Re-check coherence**
   - Re-scan the code, tests, and docs to ensure they are consistent.
   - Re-run tests as needed (including CI if available).

## 3. On Failure

- If tests fail, integration breaks, or behavior is clearly wrong:
  - Stop.
  - Revert to the last known-good state.
  - Log the failure with:
    - Symptom.
    - Suspected cause.
    - Files involved.
  - Wait for explicit instruction to retry, rescope, or abandon the attempt.

