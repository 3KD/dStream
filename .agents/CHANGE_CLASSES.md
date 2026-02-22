# CHANGE_CLASSES

Defines how to classify edits by size and impact, and which workflow to use.

## 1. Change Classes

- **Small edit**
  - One file only.
  - Internal behavior only (no change to public APIs, schemas, or external interfaces).
  - No impact on tests except trivial name fixes.
  - Example: adjust a local helper function, fix a typo in a log message.

- **Medium edit**
  - Up to ~5 files.
  - Internal behavior changes across a module, but no change to public-facing APIs or data formats.
  - May require updating or adding tests for the module.
  - Example: refactor an internal algorithm, add a parameter with a default that keeps external behavior stable.

- **Large edit**
  - Touches public interfaces, exposed types, shared modules, or data formats.
  - Cross-module behavior changes or new behavior that other modules depend on.
  - Requires test updates and documentation updates.
  - Example: change the signature of a function used in multiple modules; modify a serialized data structure.

- **Major edit**
  - Multi-module redesign, new architecture, or schema/API overhaul.
  - High surface-area impact on behavior, tests, and documentation.
  - Example: replace an entire subsystem, move from one data model to another, or rework the build/infra layer.

## 2. Required Workflow by Class

- **Small**
  - Minimal change.
  - Update or verify tests if behavior changes at all.
  - Short change summary.

- **Medium**
  - Identify affected modules.
  - Update/add tests for all modified behavior.
  - Ensure docs/comments reflect changes.
  - Short rationale is recommended.

- **Large**
  - Produce a design rationale before editing.
  - Run self-annealing: code → tests → docs → logs → summary.
  - Perform code review (even if self-review).
  - Expect integration risks; consider impact on dependent modules.

- **Major**
  - Always produce a design rationale and wait for explicit approval before edits.
  - Use full self-annealing workflow.
  - Run extended tests/CI.
  - Write a detailed change summary and log risk/impact explicitly.

## 3. How to Classify

- Default to **medium** if uncertain and downgrade/upgrade as clarity is gained.
- If a change:
  - touches public APIs, schemas, or shared modules → **at least large**.
  - redesigns multiple components or changes core architecture → **major**.
- Recompute classification if scope grows during editing.

