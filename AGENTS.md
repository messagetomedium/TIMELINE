# TIMELINE: instructions for Codex

## Task and sources

The owner receives an assignment from ChatGPT and passes it to Codex. Execute only that explicitly assigned stage. Read this file, the relevant current sections of `docs/TIMELINE_MASTER_PLAN.md`, actual branch/HEAD and any more-specific instructions. Do not reread the whole repository, historical specifications or completed stages. The owner's current instructions take precedence over older task cards and rules.

Use a new short branch from current main; preserve unrelated work. Begin with a small file-level plan and deliver a working slice. A merged/published stage does not authorize another stage without a new assignment.

The owner's or ChatGPT's explicit confirmation of publication, including its SHA/workflow when supplied, is sufficient evidence to start the next authorized stage. Do not block development because your own GitHub API or Pages request returned 403. Do not repeat requests to an unavailable address, bypass its restrictions, or change environment/credentials just to obtain PR access.

The design references in `docs/design-system/README.md`, `docs/design-system/DESIGN_SYSTEM_V2.md` and `docs/design-system/CODEX_HANDOFF.md` are read only for an explicitly assigned visual task. Keep the existing Russian custom timeline, design, geometry and working components during unrelated tasks.

## Implementation and data safety

- Make the smallest correct change through the existing architecture; no unsolicited stack rewrite, audit, dependencies or future features.
- All content changes use serializable application commands and the shared planner. A completed gesture/edit is one atomic transaction and Undo step. Preview/view preferences do not mutate schedule history.
- Project-local Undo/Redo persists across reload, reopening and project navigation. Save revisions, content and history atomically; validate version, scope and current state. Stale history never overwrites newer data. No-op/duplicate completion preserves revisions and Redo. Text Ctrl/Cmd+Z remains native inside fields.
- Preserve inactive-work semantics, relationships, date-only intervals, exclusive stored ends, cascade rules, SegmentAxis/result gaps, IndexedDB namespace and JSON compatibility unless explicitly assigned otherwise.
- Never silently reset IndexedDB/SQL, apply a destructive migration or production seed, or fall back from a failed server save to a local write reported as saved. Tests use explicitly isolated databases only. Restore drills use a different empty test database and never clean/overwrite a working database.
- Keep actor/session/workspace/project checks, idempotent command receipts, revision conflicts and transaction rollback. Person and authenticated User remain distinct.
- No production passwords, connection credentials, SMTP keys, invitation/guest tokens or private exports in repository, logs, browser bundle, images, comments or chat. Use secret settings and placeholders. Preserve certificate verification; Docker session CA files use temporary BuildKit secret mounts, not COPY or disabled TLS.
- Paid services, real cloud resources, DNS, production databases and production migrations require separate explicit authorization. Packaging/local tests do not authorize infrastructure purchases or deployment.

## Verification and resource use

Run lint, build/typecheck and only the necessary new/affected unit/integration tests. Critical changes to gestures, dates, persistence, navigation or command/history integration also need targeted behavioral browser tests. Server/database changes need actual PostgreSQL tests, not an emulator. Never invent passing checks or conceal failures/unrun checks.

Reuse successful results when affected code, dependencies, configuration and runtime inputs are unchanged; record exact scope and SHA/workflow. Do not rerun a full local suite merely because GitHub starts CI or because its API is unavailable. Documentation-only work needs diff/documentation checks, not application tests. Full validation belongs primarily to the PR CI.

No screenshots, videos, screenshot comparisons or visual reports. Keep useful behavioral assertions. Existing Playwright config disables trace screenshots. For focused Chromium checks use the Node version in `.nvmrc`, a valid existing build and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` when available. WebKit automation does not establish testing of a physical iPhone.

Commands: `npm ci`, `npm run lint`, `npm run build`, `npm run test`, `npm run server:test`, `npm run server:build`, `npm run test:e2e`; packaging and operator commands are documented in `docs/STAGING.md`.

## GitHub checks and publication

Codex implements, performs targeted checks, commits and pushes the assigned branch, then reports branch, SHA, evidence and blockers briefly. If API access is available, create/update the stage's single PR and follow the ordinary protected merge process after required checks succeed. Never force-push, directly push main or use an administrative bypass.

If GitHub API/Pages returns 403, stop requests to that address after the first failure. Do not stop authorized development or repeat tests because of 403. Leave a concrete committed/pushed result and the create-PR link. ChatGPT finishes PR, CI review, merge and Pages using the connected GitHub. A prior 403 in the active task needs no new attempt at PR creation.

Keep stable required check names `checks` and `server`. `checks` aggregates the selected frontend/server/package gates and fails closed if scope detection or a selected job fails. Unknown paths and critical configuration require both application suites. Documentation-only changes skip expensive application tests. Cancel obsolete PR runs, not main publication evidence.

**Do not assume main is protected.** Until branch protection/rulesets requiring PR and successful checks are actually confirmed, retain full validation of every functional main push and protective Pages checks. A later narrow push must not publish code from an earlier failed main. Do not switch to PR-only validation or remove the remaining frontend publication tests merely for speed. Pages is gated by a successful CI push run for the exact same main SHA, checks artifact provenance/SHA and avoids publishing an obsolete main. Never publish from an untrusted fork/PR workflow_run.

Each completed functional version publishes automatically to GitHub Pages after successful required checks and merge. The standing authorization covers the test site https://messagetomedium.github.io/TIMELINE/ and needs no second routine merge permission. Manual review is optional and never blocks publication or the next separately assigned stage. `accepted` still requires the owner's explicit acceptance; do not infer it from deployment.

Distinguish implementation readiness, delivery and acceptance. A successful push or a live old site does not prove a new deployment. Where accessible, verify the resulting main SHA and Pages run/readiness without screenshots; where access is blocked, report the actual state and accept publication confirmation from the owner/ChatGPT without retrying.

During implementation update only the execution ledger in section 00 of the master plan: base/task, changed paths, new/reused checks, limitations, commit/PR/delivery, brief optional manual checks. Change permanent rules/task cards only when explicitly assigned. Keep final reports short (follow the owner's requested line/bullet limit) and stop at the assigned stage.
