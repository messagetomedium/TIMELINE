# TIMELINE: instructions for Codex

## Start here

Read `docs/TIMELINE_MASTER_PLAN.md` before changing code. It is the single current product, architecture, roadmap, deployment, and acceptance contract, based on the updated user brief and its 23 supplemental answers.

The master plan supersedes conflicting requirements in `ARCHITECTURE.md`, `CODEX_SPEC.md`, `docs/specs/*`, old roadmaps, and historical ADRs. Those files describe earlier versions; do not implement their conflicting behavior. Preserve compatible existing behavior and working code.

## Task discipline

- Execute only the explicitly authorized task ID. The initial task is `V1.3A`, detailed in section 12 of the master plan. A roadmap is not permission to implement all releases.
- Read the actual current branch, commits, code, tests, and any more-specific AGENTS.md before planning. Do not overwrite other work or assume the baseline commit is still HEAD.
- Distinguish user requirements (U), engineering defaults (D), observed implementation, and planned functionality. Do not quietly turn an ambiguous rule into a different product.
- Start with a small file-level plan, then implement a visible working slice. Do not deliver architecture-only scaffolding when an implementation task is requested.
- Keep the custom Russian visual timeline. No generic Gantt replacement, unsolicited redesign, stack rewrite, external services, or premature later-stage features.
- All content mutations go through serializable application commands. Pointer previews and view preferences are not schedule mutations. One completed gesture is one atomic change and one undo step.
- No silent IndexedDB reset, SQL reset, destructive migration, production seed, credential exposure, or automatic fallback from failed server saving to local saving.
- Never invent passing checks. Run applicable lint, typecheck/build, unit, integration, and browser tests. Report failures and environment limitations exactly.
- Test dates independently from pixels, including result-column gaps. Test persistence, cancel, undo/redo, copying, and cascade movement.

## Delivery and release gates

Use a focused branch, commit the implementation, and open a PR when the environment supports it. Do not assume a local commit is published. Do not force-push or merge a PR without explicit authorization. An explicit user instruction to publish to main applies only to that task and does not authorize production deployment.

Update ONLY the execution ledger in section 00 of the master plan and append a task report there: actual base SHA, task, changed paths, commands/results, screenshot/artifact paths, known limitations, PR/commit, and manual acceptance steps. Product decisions and future task scopes must not be silently rewritten to match incomplete code.

Allowed states: planned -> in_progress -> ready_for_review -> accepted. Only the user/reviewer accepts a task. Finishing a task does not authorize the next one. Stop at ready_for_review.

Never put production passwords, SMTP keys, DB connection strings, real guest/invitation tokens, or private project exports in this repository, PR comments, screenshots, or chat. Deployment instructions use placeholders and provider secret settings.

## Existing checks

Use the Node version from `.nvmrc` and the lockfile. Current scripts: `npm ci`, `npm run lint`, `npm run build`, `npm run test`, `npm run test:e2e`. Build precedes Playwright preview. Install the documented browser dependencies only in the test environment. Add WebKit checks in the scheduled browser-compatibility task, not as a claim that an actual iPhone was tested.
