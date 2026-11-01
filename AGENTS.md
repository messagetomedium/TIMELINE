# TIMELINE: instructions for Codex

## Start here

Read `docs/TIMELINE_MASTER_PLAN.md` before changing code. It is the single current product, architecture, roadmap, deployment, and acceptance contract, based on the updated user brief and its 23 supplemental answers.

The master plan supersedes conflicting requirements in `ARCHITECTURE.md`, `CODEX_SPEC.md`, `docs/specs/*`, old roadmaps, and historical ADRs. Those files describe earlier versions; do not implement their conflicting behavior. Preserve compatible existing behavior and working code.


## Design references for future authorized visual work

The user-approved design references and image files live in docs/design-system/README.md. The complete visual specification is docs/design-system/DESIGN_SYSTEM_V2.md; task limits and a ready handoff are in docs/design-system/CODEX_HANDOFF.md. **Read these materials when a visual-redesign task is explicitly assigned.** They do not authorize redesign during an unrelated implementation stage and must not override the functional contract, roadmap, data model, or current task scope.

## Task discipline

- Execute only the explicitly authorized task ID. V1.3A has already been merged into main through PR #1; do not merge it again or reopen/reuse that PR. Its merge/deployment does not establish user acceptance. The detailed V1.3B task card in section 12B is planning only; implement it only after the required user acceptance and a separate explicit V1.3B assignment. Preserve the roadmap order. A finished, merged, or deployed task is not permission to start another version.
- Read the actual current branch, commits, code, tests, and any more-specific AGENTS.md before planning. Do not overwrite other work or assume the baseline commit is still HEAD.
- Distinguish user requirements (U), engineering defaults (D), observed implementation, and planned functionality. Do not quietly turn an ambiguous rule into a different product.
- Start with a small file-level plan, then implement a visible working slice. Do not deliver architecture-only scaffolding when an implementation task is requested.
- Keep the custom Russian visual timeline. No generic Gantt replacement, unsolicited redesign, stack rewrite, external services, or premature later-stage features.
- Project-local Undo/Redo must persist across reload and reopening the tab. Save history, data and revisions atomically; validate history compatibility and never overwrite newer data using a stale stack. No-op saves (including repeated Enter) must preserve revision and Redo. This browser-local history is distinct from the future server journal.
- All content mutations go through serializable application commands. Pointer previews and view preferences are not schedule mutations. One completed gesture is one atomic change and one undo step.
- No silent IndexedDB reset, SQL reset, destructive migration, production seed, credential exposure, or automatic fallback from failed server saving to local saving.
- Never invent passing checks. Lint, build (including typecheck), unit tests, and necessary integration tests are mandatory for affected implementation changes. Run browser tests for critical changes to gestures, calendar geometry, persistence, navigation, and command/history integration. Report failures, skipped/unrun checks, and environment limitations exactly.
- Reuse successful results when the affected code, dependencies, configuration, and relevant runtime have not changed. Record their exact commit and scope; do not present reused results as a new run. Repeat a check only for changed affected code, a prior failure, or a concrete unresolved concern. Documentation-only work needs documentation/diff checks, not another application test run.
- Do not generate screenshots, screenshot comparisons, or visual reports. The user performs visual testing on GitHub Pages. Browser tests should check behavior without screenshot generation; exclude existing screenshot-capture scenarios from routine runs. Do not attach screenshot paths or produce visual artifacts merely to fill a report.
- Test dates independently from pixels, including result-column gaps. Test persistence, cancel, undo/redo, copying, and cascade movement.

## Delivery and release gates

GitHub Pages at https://messagetomedium.github.io/TIMELINE/ is the primary test environment. For each separately assigned implementation stage, work in a dedicated branch, run lint, build/typecheck, unit/integration tests and the necessary behavioral browser scenarios, and prepare or update that stage's PR. After successful required checks, merge the PR into main through the normal protected PR flow and verify the automatic GitHub Pages deployment. The user's standing workflow authorizes this merge and Pages publication for an assigned stage; do not wait for visual acceptance or ask for a second routine merge permission. Use current PR-head checks and existing branch protection; never bypass protections or force-push. Never merge PR #1 again.

If API access, permissions, required reviews, protection rules, checks, or merge conflicts prevent delivery, report the specific blocker and leave the PR unmerged. Do not substitute a direct push to main or use administrative overrides. If merge succeeds but deployment fails or is unavailable, report `merged` and the actual deployment state separately; diagnose the failed workflow and do not claim the site was updated. Verify the completed Pages run/deployment belongs to the resulting main SHA and perform a basic HTTP/site readiness check without screenshots. A successful push or a live old site alone does not establish deployment of the new version.

This authorization covers the GitHub Pages test site. It does not authorize paid server services, infrastructure purchases, future server production deployment, or changes to the release order. Documentation-only changes must remain limited to the requested instructions; use documentation/diff checks rather than rerunning unchanged application tests locally.

During an implementation task update ONLY the execution ledger in section 00 of the master plan: actual base SHA, task, changed paths, checks/results (including reused evidence), known limitations, PR/commit, and 3–5 manual acceptance actions. Update permanent rules or future task cards outside the ledger only when the user explicitly requests that documentation work. Product decisions and task scopes must not be silently rewritten to match incomplete code.

After publication, briefly report what was done/undone, https://messagetomedium.github.io/TIMELINE/, the deployed main commit, PR and deployment/run links, test results (new versus reused evidence), and 3–5 concrete browser checks for the user. If blocked, give the actual partial delivery state and next required action instead of a publication claim. Do not produce screenshots or visual reports.

Track implementation readiness (`planned`, `in_progress`, `ready_for_review`, `blocked`), delivery (`merged`, `deployed`, or the precise pending/failed state), and user acceptance separately. `merged` means the PR actually entered main; `deployed` means that main version successfully reached Pages; `accepted` requires the user's explicit final acceptance. Do not stop the authorized merge/deployment flow merely because implementation is `ready_for_review`. After successful publication stop for the user's manual review; do not mark the task accepted or start the next stage without a separate assignment.

Never put production passwords, SMTP keys, DB connection strings, real guest/invitation tokens, or private project exports in this repository, PR comments, screenshots, or chat. Deployment instructions use placeholders and provider secret settings.

## Token-efficient development

- Read only task-relevant files and documentation; prefer targeted search over full repository exploration.
- Make the smallest correct change using the existing architecture; avoid unsolicited refactoring, dependencies and extra features.
- Run focused local tests and rely on existing CI for full validation. Do not repeat successful checks without changed inputs or a concrete unresolved concern.
- Do not generate screenshots, videos, lengthy reports or unnecessary documents. Keep final reports short.
- Do not start another milestone without explicit authorization. Never sacrifice data safety or essential correctness to save tokens.

## Existing checks


Use the Node version from `.nvmrc` and the lockfile. Current scripts: `npm ci`, `npm run lint`, `npm run build`, `npm run test`, `npm run test:e2e`. For critical browser changes run the relevant behavioral scenarios; in the current suite use `npm run test:e2e -- --grep-invert 'captures'` to exclude the two explicit screenshot-capture scenarios. In this cloud environment set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` and use `--workers=2`. This exclusion implements the user's visual-artifact rule; do not disable behavioral assertions. Build precedes Playwright preview; reuse a valid build when its inputs are unchanged. Install the documented browser dependencies only in the test environment. Add WebKit checks in the scheduled browser-compatibility task, not as a claim that an actual iPhone was tested.
