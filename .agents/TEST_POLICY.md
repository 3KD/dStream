# TEST_POLICY

Defines expectations for tests, coverage, and CI behavior.

## 1. When Tests Are Required

- Any change that:
  - Alters runtime behavior.
  - Modifies public interfaces or data formats.
  - Changes error handling or edge-case logic.
- For such changes:
  - Update existing tests that cover the affected behavior, or
  - Add new tests if no coverage exists yet.

## 2. Minimal Applicable Coverage

- For a behavior change:
  - At least one test for the primary path.
  - At least one test for a key edge case.
- For new public APIs:
  - Tests for normal usage.
  - Tests for invalid input or misuse.
  - Tests for boundary conditions.

## 3. CI and Verification

- Before marking changes as final/merged:
  - Existing tests must pass.
  - New tests must pass.
  - If CI is configured:
    - CI should run and pass for the change set.
- If CI or tests fail:
  - Do not treat the change as complete.
  - Diagnose, fix, or revert before proceeding.

## 4. Test Templates

- When a full test implementation is not possible immediately:
  - Provide a test template or skeleton with:
    - Test name.
    - Scenario description.
    - Expected outcome.
  - Mark clearly as TODO for later completion.

## 5. Alignment with Behavior

- Whenever behavior or interfaces change:
  - Tests, docs, and comments must be updated to match.
  - Out-of-date tests or specs should be fixed or removed, not ignored.

