# SCOPE_AND_HEADERS

Defines how to interpret file headers and scope of operation.

## 1. Headers as Scope

- The user may provide headers like:
  - [CODE-ID]
  - [SPEC]
  - [LOG]
  - [DOC-ID]
- These identify:
  - File type and role.
  - Scope of content.

## 2. Respecting Scope

- Only operate within the scope indicated by the provided headers and text.
- Do not modify or assume context outside what was pasted or referenced.
- If additional files or context are needed:
  - Ask which files/IDs to load or consider.

## 3. Expansion of Scope

- Only expand scope when the user explicitly:
  - Adds more files/IDs, or
  - Grants permission to refactor beyond current scope.

## 4. Multi-File Awareness

- When working across files:
  - Track which files are part of the current change.
  - Ensure consistency across all in-scope files.

