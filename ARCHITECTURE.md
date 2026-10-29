# Visual Project Timeline Manager - Architecture v1.0

Status: proposed technical architecture following requirements briefing on 2026-10-29.
Reference: the user-provided one-page production timeline PDF. Preserve its dense, readable arrangement of process bars and a separate assignee section, but make it interactive. Do NOT clone the PDF as a static picture.

## 1. Product scope and deployment sequence

Phase A (first executable release): single-user browser application; no accounts, API, remote database, real-time network, or AI; complete editing workflows and local persistence. Navigate directly to project list on launch. Do not ask the user to configure external services.

Phase B: shared workspaces, authentication, authorization, Supabase/PostgreSQL storage, real-time updates, leases for concurrent editing, invitations, guest links, migration of local projects to server.

Phase C: remote MCP server for ChatGPT actions, with explicit preview/approval of planned mutations. No AI API keys or MCP server required in Phase A.

Do not make Phase A depend on Supabase. Do not claim local data syncs across devices; it does not.

## 2. Preferred stack

- Vite + React + TypeScript with strict type checking.
- Zustand for transient editor/UI state (active project, selection, expansion state, camera, tool mode).
- IndexedDB via Dexie for durable local project data; schema versioning and migrations.
- Pure TypeScript domain operations and validation, callable independently of React, database, UI, and future MCP endpoints.
- Timeline rendering: custom semantic HTML/SVG layers; CSS for bars, SVG/canvas possible for efficient background grid. Use Pointer Events with explicit hit targets for drag/resize. Evaluate virtualization only if measured performance requires it.
- Vitest for date math, movement invariants, cloning, command undo/redo; Playwright for browser interactions and PDF export regressions.
- Later: Supabase Auth (email/password and optional Google OAuth), PostgreSQL, row-level security, private Broadcast and Presence, server-enforced edit leases and version checks. Use a dedicated server-side command endpoint or transaction/RPC layer for atomic multi-record edits.
- Later: secure remote MCP server, using the same domain command semantics on the server, with draft -> preview -> confirm -> apply.
- Mobile future: responsive web/PWA. In Phase A desktop-first. Browser local data does not automatically follow a user to their phone.

## 3. High-level module boundaries

src/domain: entities, time/date arithmetic, snapping, scheduling constraints, clone/shift logic, command types, validation, pure reducers.
src/application: command bus, undo/redo stack, repository interfaces, project/task queries, export orchestration.
src/infrastructure/local: IndexedDB/Dexie implementation of repositories, schema migrations, JSON backup/restore.
src/features/projects: project browser, new blank project, duplicate project, project settings.
src/features/timeline: camera, time axis, snap grid, weekend shading, current-day marker, stage dividers, lanes, process bars, child tasks, pointer interaction, multi-selection.
src/features/assignees: role/name roster, autocomplete, assignment links, bottom resource timeline and highlight.
src/features/details: right property inspector for selected task or process.
src/features/portfolio: aggregate timeline with one row per project (plus optional stacked rows when needed).
src/features/pdf: standalone print/export renderer from domain data and view state, excluding editing controls.
src/styles: reusable design tokens and styles.

The feature UI MUST NOT directly mutate IndexedDB documents or future network rows. Domain commands are the sole write entrypoint. Preview pointer interactions may use ephemeral UI state; only committed actions create a command, one undo item, and one persistence transaction.

## 4. Core data model

Stable UUID IDs, independent of array indices. Store dates as ISO date-only strings (YYYY-MM-DD). All scheduling is calendar-based, not hour-based. Internally represent intervals as [startDate, endDateExclusive) for deterministic day and month boundaries; the UI may display an inclusive final calendar day. Avoid timezone-sensitive Date parsing: use a date library or UTC date-only helpers. Calendar month = actual calendar month, NOT 30 days.

Project
- id, name, description?, anchorDate, startDate, endDateExclusive, sortIndex, createdAt, updatedAt, revision.
- Visible duration is explicit; if moving the whole project, shift stage markers, processes, and tasks together.

StageMarker
- id, projectId, title, date, sortIndex.
- A vertical dated divider, not a parent container. Editing date moves line. Dragging its top circle adjusts date. Project shift also shifts markers.

Lane
- id, projectId, processId? (null for top-level process lanes), sortIndex, kind='process'|'task'.
- User-controlled track, with deterministic vertical order. Sequential nonoverlapping items share a lane. Parallel activities use different lanes. Never pack randomly.

Process
- id, projectId, laneId, title, startDate, endDateExclusive, color, status, details?, sortIndex, revision.
- Container of tasks. Process may be longer than its children. Shift process shifts all descendants by the same calendar offset. Expanding a task outside process dates expands the process to contain the child. Shrinking process boundaries may not cut off any task; clamp or reject with explanation.

Task
- id, processId, laneId, title, startDate, endDateExclusive, status, details?, sortIndex, revision.
- Each task lives within one process and one of that process's task lanes. The bar displays title only; detailed properties live in inspector.

Person
- id, displayName?, defaultRole?, createdAt, updatedAt. Global roster for assignment autocomplete. An unnamed position may have roleLabel with no personId.

Assignment
- id, projectId, targetType='process'|'task', targetId, personId?, roleLabel, isLead, sortIndex.
- Role is on the assignment because the same person may serve different roles on different projects. Model allows multiple assignees per task from day one even if the initial inspector adds only basic assignment editing.

ViewPreferences
- projectId, gridStep ('1d','2d','3d','1w','2w','1mo'), zoomPxPerDay, cameraX, cameraY, showWeekends, expandedProcessIds, expandedAssigneeGroupIds, showPeoplePanel.
- Zoom and gridStep are independent. A project may store a preferred view; PDF exports the configured view.

Dependency (reserved; not exposed or auto-applied in Phase A)
- id, projectId, predecessorTaskId, successorTaskId, type, lagDays.
- No automatic dependency graph scheduling in Phase A. Multi-select moving several tasks is a separate user action.

Optional long-term entities: User, Membership, ProjectInvite, EditLease, CommandAudit, FileAttachment, MCPApproval. Leave room in schema without requiring server tables locally.

## 5. Critical invariants and transformations

- startDate < endDateExclusive for any interval.
- task belongs to exactly one process, task lane belongs to same process, and process belongs to one project.
- task interval must fit inside process interval; task extension enlarges process as needed.
- moving whole process shifts each child exactly once; moving whole project shifts each process/task and stage marker exactly once. Avoid double shifting when a parent and child are both selected.
- changing process size only edits container boundaries, unless the operation is a move; cannot shorten past child coverage.
- items assigned to the SAME lane may not overlap in time. During drag/resize show invalid preview and reject or clamp at commit; do not silently shuffle rows. Items on DIFFERENT lanes may overlap freely.
- users can move tasks vertically between lanes in the same process; adding/removing and reordering lanes is explicit. Processes can move between top-level process lanes.
- task selection via click, Shift+click multi-select; a group drag preserves relative offsets and lanes, enforces all constraints atomically. Ctrl/Cmd+A scoped to active editable timeline when implemented; do not select parents and descendants twice.
- stage markers snap to the currently selected grid step when dragged.
- date math for the current-day line uses the user's device local date, recomputed on calendar day change; it never alters timeline data.
- statuses (exact UI strings): 'Не начато', 'В работе', 'Согласование', 'Пауза', 'Готово', 'Закрыта'. No percent-complete UI.
- color belongs to a process and is set manually in inspector; task coloring derives from process color unless a later design decision overrides this.

## 6. Interaction model

At all times, separate view zoom from snapping step. Zoom +/- increases/decreases pixels per calendar day, ideally anchored at viewport center or pointer, without changing any schedule dates. Step selector changes date grid segmentation and snap granularity without changing zoom. Steps: 1 day, 2 days, 3 days, 1 week, 2 weeks, 1 calendar month; define week anchors consistently, e.g., Monday.

Pan with middle mouse drag anywhere or left mouse drag on empty canvas. Panning MUST NOT move items. Drag bars by a small dedicated top-left handle only. Resize by left/right bar edge hit targets. Double-click bar title for inline text editing. Single-click selects it, opens its right inspector; selecting process also expands its tasks below. Processes may be expanded independently, with any number open at once. Preserve row order and vertical task semantics.

Timeline composition on desktop:
- project header and project switcher;
- date header and translucent vertical date grid, scroll/zoom/pan workspace;
- stage marker label and top circular handle + thin vertical line spanning relevant timeline sections;
- top process/task bands with user-controlled lanes;
- separate, synchronized bottom performer panel showing process lead/role rows and expandable child assignees; hover an item highlights connected persons and vice versa;
- right details inspector;
- floating bottom toolbar for zoom, grid/snap step, weekend toggle, undo/redo, export;
- current date vertical indicator, visually distinct from stage markers and weekend bands.

Weekend toggle paints subtle pale-green date stripes/lines for Saturdays and Sundays; do not use weekend markers to change task durations or snapping. Scroll and horizontal time alignment of process and people panels must be synchronized.

## 7. Persistence, undo, and backup

- Phase A autosaves committed commands in IndexedDB. Inform the user that data is stored in this browser/device and can be lost on site data clearing.
- Provide JSON project export/import as a safety/backup and future migration route; distinct from user-facing visual PDF export.
- Undo/redo buttons and Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z. Use command inverses or patches for the current session; drag gesture is exactly one history item, not hundreds. Clearing redo on new edit. No full audit history or collaborative undo yet.
- Use explicit schema version + migration tests; test refresh and reopening.

## 8. Project copying and portfolio

Creating 'New project' yields a blank project with timeline and starter lanes but no demo data. 'Duplicate project' deep-clones markers, processes, tasks, lanes, assignments and their relationships with fresh IDs; retains dates and layout by default. Person records remain globally shared (not duplicated). Edits to clone never mutate original. Later file attachments need a clear copy-by-reference or duplicate-asset policy.

Portfolio is a timeline with project bars instead of processes. Moving a project bar shifts all stage markers, processes, tasks, and explicit project start/end boundaries in one atomic operation. If expanded project detail is provided later, it should use the same domain calculations, not a separate copy of data.

## 9. PDF export

Single PDF export action, using an export-only render derived from the active project/view state. Reproduce bar positions, color scheme, labels, grid period, stage markers, today line, weekend shading if active, order and expanded/collapsed state, including people section visibility. Exclude toolbar, edit handles, selection indicators, side inspector. Export the whole configured timeline layout instead of blindly screenshotting the browser viewport; scale to one landscape page (custom width if necessary), warn if labels would be too small. Prefer vector text/shapes/SVG -> PDF where practical. Raster or browser print fallback is acceptable if visual regression tests pass. Exact cropping to visible viewport is NOT approved yet; keep time range configurable in an export adapter.

## 10. Version 2 architecture (designed, not implemented in phase A)

- User identity via email/password and optionally Google OAuth.
- Membership: admin (full edit) and guest (read-only), scoped to explicitly granted projects. No access to unrelated projects.
- Server-side RLS/authorization for every read and write. An invitation link is an expiring, revocable access-grant token and not an unprotected globally readable URL.
- Atomic command processing and optimistic revisions; private real-time events and client resync on version mismatch.
- Temporary edit lease per item, with expiry/renewal, peer presence and indication. Never trust a UI-only lock to enforce writes.
- Migration wizard: export local project snapshot, validate and import atomically to workspace, map IDs, preserve references, keep a local backup until server import confirmed.
- MCP integration: read plans, create draft mutations, return structured preview, request explicit approval, then apply via authenticated server commands; never grant an unbounded system-wide database credential to ChatGPT.

## 11. Architectural decisions still provisional

- Multiple assignees per task: yes at data layer, UI keeps simple.
- Roles per assignment and global people directory: yes.
- Lane collisions: reject/clamp instead of silently moving another task.
- Process dates: manually adjustable boundaries constrained to include tasks.
- Blank project initial date range: current month plus several nearby months, without sample tasks.
- PDF exported region: configured full timeline, preserving current expanded/layout state (not merely visible pixels). Can refine after testing.
- Task dependencies: schema reserved, behavior explicitly deferred.
