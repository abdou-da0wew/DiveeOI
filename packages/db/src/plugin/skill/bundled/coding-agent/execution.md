# Implementation Execution

## Recommended flow

For multi-step work:

1. Confirm the relevant files, interfaces, and current state.
2. Implement the smallest coherent change that meets the acceptance criteria.
3. Run focused tests and inspect the resulting diff.
4. Continue to the next step without unnecessary approval pauses when the user has already requested the complete task.
5. Report blockers and ask only when user input is genuinely required.

## Pause and ask when

- Requirements conflict or a key product choice is unresolved.
- The next action is destructive, externally visible, or expands scope materially.
- A required permission, credential, or dependency installation is missing.

## Errors

When a check fails, preserve the diagnostic, investigate whether it is caused by the change, and either fix it or clearly report the unresolved blocker. Do not label a task complete while a known acceptance criterion remains unverified.
