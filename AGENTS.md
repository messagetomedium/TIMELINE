# TIMELINE: instructions for Codex

## Start here

Read `docs/TIMELINE_MASTER_PLAN.md` before changing code. It is the single current product, architecture, roadmap, deployment, and acceptance contract, based on the updated user brief and its 23 supplemental answers.

The master plan supersedes conflicting requirements in `ARCHITECTURE.md`, `CODEX_SPEC.md`, `docs/specs/*`, old roadmaps, and historical ADRs. Those files describe earlier versions; do not implement their conflicting behavior. Preserve compatible existing behavior and working code.

## Task discipline

- Execute only the explicitly authorized task ID. `V1.3A` is `ready_for_review` in existing PR #1; do not create a duplicate PR. The detailed V1.3B task card in section 12B is planning only. Implement it only after the user explicitly accepts V1.3A and authorizes V1.3B. A roadmap or a finished task is not permission to start another version.
- Read the actual current branch, commits, code, tests, and any more-specific AGENTS.md before planning. Do not overwrite other work or assume the baseline commit is still HEAD.
- Distinguish user requirements (U), engineering defaults (D), observed implementation, and planned functionality. Do not quietly turn an ambiguous rule into a different product.
- Start with a small file-level plan, then implement a visible working slice. Do not deliver architecture-only scaffolding when an implementation task is requested.
- Keep the custom Russian visual timeline. No generic Gantt replacement, unsolicited redesign, stack rewrite, external services, or premature later-stage features.
- All content mutations go through serializable application commands. Pointer previews and view preferences are not schedule mutations. One completed gesture is one atomic change and one undo step.
- No silent IndexedDB reset, SQL reset, destructive migration, production seed, credential exposure, or automatic fallback from failed server saving to local saving.
- Never invent passing checks. Lint, build (including typecheck), unit tests, and necessary integration tests are mandatory for affected implementation changes. Run browser tests for critical changes to gestures, calendar geometry, persistence, navigation, and command/history integration. Report failures, skipped/unrun checks, and environment limitations exactly.
- Reuse successful results when the affected code, dependencies, configuration, and relevant runtime have not changed. Record their exact commit and scope; do not present reused results as a new run. Repeat a check only for changed affected code, a prior failure, or a concrete unresolved concern. Documentation-only work needs documentation/diff checks, not another application test run.
- Do not generate screenshots, screenshot comparisons, or visual reports without a separate explicit user request. The user performs visual acceptance of the published application. Browser tests should check behavior without screenshot generation; exclude existing screenshot-capture scenarios from routine runs. Do not attach screenshot paths or produce visual artifacts merely to fill a report.
- Test dates independently from pixels, including result-column gaps. Test persistence, cancel, undo/redo, copying, and cascade movement.

## Delivery and release gates

Use a focused branch, commit the implementation, and open a PR when the environment supports it. Continue an existing PR for the task instead of creating another one. Do not assume a local commit is pushed, a PR is merged, or an application is deployed. Do not force-push, merge a PR, or deploy without explicit authorization. An explicit user instruction to publish to main applies only to that task and does not authorize production deployment.

During an implementation task update ONLY the execution ledger in section 00 of the master plan: actual base SHA, task, changed paths, checks/results (including reused evidence), known limitations, PR/commit, and 3–5 manual acceptance actions. Update permanent rules or future task cards outside the ledger only when the user explicitly requests that documentation work. Product decisions and task scopes must not be silently rewritten to match incomplete code.

End each stage with a brief report: what was done, what remains undone, check results, a PR/commit link, and 3–5 concrete manual checks. Screenshots and visual reports require a separate explicit request.

Allowed states: planned -> in_progress -> ready_for_review -> accepted. Only the user/reviewer accepts a task. Finishing a task does not authorize the next one. Stop at ready_for_review.

Never put production passwords, SMTP keys, DB connection strings, real guest/invitation tokens, or private project exports in this repository, PR comments, screenshots, or chat. Deployment instructions use placeholders and provider secret settings.

## Existing checks

Use the Node version from `.nvmrc` and the lockfile. Current scripts: `npm ci`, `npm run lint`, `npm run build`, `npm run test`, `npm run test:e2e`. For critical browser changes run the relevant behavioral scenarios; in the current suite use `npm run test:e2e -- --grep-invert 'captures'` to exclude the two explicit screenshot-capture scenarios. In this cloud environment set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` and use `--workers=2`. This exclusion implements the user's visual-artifact rule; do not disable behavioral assertions. Build precedes Playwright preview; reuse a valid build when its inputs are unchanged. Install the documented browser dependencies only in the test environment. Add WebKit checks in the scheduled browser-compatibility task, not as a claim that an actual iPhone was tested.
