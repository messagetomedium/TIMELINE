# Codex Implementation Specification: Visual Timeline Manager v1.0

This is an executable engineering specification for an incremental solo-browser MVP. Follow ARCHITECTURE.md. Language of the application UI: Russian. Do not replace the custom interactive timeline with a generic Gantt package.

## Product intent

Build a project-management editor whose primary interaction is directly manipulating dated, colored bars, resembling a production timeline reference. It includes process containers with nested task bars, a separate performer utilization panel, visible stage separators, day/week/month grid snapping, and a portfolio timeline across projects. Initial release must be fully usable locally, without auth/server/AI.

## Non-negotiable user requirements

1. Launch straight to main project overview, no login.
2. Create a blank project; duplicate an existing project along with all nested processes, tasks, tracks, stage dividers and assignment references.
3. Open a project timeline and use it as the primary editor, not as a read-only Gantt.
4. Stage = independently adjustable dated vertical separator, NOT a container. Editing the date relocates the line; dragging its top dot updates date.
5. Process = colored time-span container. Selecting opens the right inspector and expands tasks under the bar. Multiple processes can remain open. Move process and every child shifts together. Extending child beyond boundaries extends parent.
6. Task = titled bar. Single click selects/open inspector; double click inline title edit; dedicated small top-left drag handle moves; left and right resize grips change date interval. Do not allow clicking anywhere on bar to drag.
7. Lane organization is intentionally semantic: parallel tasks are stacked in separate rows, sequential tasks occupy the same row. Users control vertical lane placement. Same-lane bars cannot overlap or obscure one another; avoid unrequested automatic packing.
8. Grid snapping and canvas zoom are independent. Snap-step choices: 1 day, 2 days, 3 days, 1 week, 2 weeks, 1 month. +/- zoom controls. Pan using middle mouse or left mouse on blank canvas. Date labels are clearly legible.
9. Weekend highlighting toggle paints faint pale-green background vertical bands/lines and changes no dates. A distinct vertical TODAY marker is always visible when the current date intersects the viewed time range.
10. Basic performer panel below timeline. Rows show role followed by name when set. Process leader and nested task assignees appear in expandable groups. Hovering task/process highlights associated performer rows/bars. Assignment selector provides prefix/substring search against global roster.
11. Status values: 'Не начато', 'В работе', 'Согласование', 'Пауза', 'Готово', 'Закрыта'. Color is set manually per process in right inspector. No progress percentage.
12. Select several items with Shift+click; move selected items together. Undo/redo with buttons and keyboard shortcuts Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z. A drag counts as one undoable command. Separate automatic dependency scheduling is NOT in Phase A.
13. Portfolio timeline across projects. Move one project there -> all child processes, tasks and stage markers move by the same calendar duration.
14. Export a single PDF preserving the configured timeline appearance, content arrangement, expansion state, date grid, colors, and people panel. No inspector or editing controls in PDF.
15. On mobile, final product should support project browsing and status updates, but Phase A is desktop-first. Do not promise cross-device sync until Phase B.
16. No auth, invites, real-time sync, Supabase connection, ChatGPT API, or MCP in the MVP runtime. Build extension points for later phases.

## Functional slices (finish sequentially; each must run and be testable)

### Slice 0: Repository setup and conventions
- Bootstrap Vite React TS; strict lint/typecheck; Vitest + Playwright.
- Set up route/screen shell, application tokens, feature directories, documentation and ADRs.
- A seeded developer fixture may exist as an optional menu command; never overwrite real data and never auto-populate a newly created blank project.
- Define core types, stable IDs, calendar interval helpers.
- Pass `npm run build`, `npm run test`, and a Playwright smoke test before proceeding.

### Slice 1: Domain model, commands, local data
- Implement typed Project, StageMarker, Process, Task, Lane, Person, Assignment, ViewPreferences.
- `CommandBus.execute(command)` with validate/plan/apply and inverse patches; undo/redo for current session.
- `ProjectRepository` interface; Dexie implementation in IndexedDB. Transactional persisted writes; migrations and schema version.
- Project list, create, rename, delete (confirm), duplicate. Autosave; refresh retains data. JSON backup/import and safe validation.
- Test deep clone IDs/references; original unchanged after editing clone.

### Slice 2: Time axis, camera, grid, dividers
- Independent zoom and time-grid step; grid origin/date mapping with pure deterministic math.
- Snap to grid on drag/resize with clear hover feedback; month uses real boundaries, week uses consistent Monday anchor.
- Mouse middle-button and blank-area left-button panning. Zoom +/- buttons; no accidental bar drags.
- Render headers, vertical translucent lines, optional pale-green Saturday/Sunday bands, current-day marker.
- Stage marker drag via its top circle and direct date edit. Verify bidirectional synchronization.
- Test zoom changes only pixels, step changes only snap, neither silently shifts task dates.

### Slice 3: Interactive process/task editor
- Render top-level process lanes, process bars, nested task lanes under expanded processes.
- Single-select -> right inspector; double-click title inline; drag only via small handle; resize from exact left/right targets.
- Shift multi-select and atomic group move. Place tasks between lanes via drag, no overlaps in same lane.
- Parent shift moves all descendants; task extension auto-grows process. Process edge trim cannot exclude child tasks.
- Expansion states are independently maintained. No unexpected vertical re-packing.
- One undo command per pointer gesture. Keyboard shortcuts respect focused text editors (native text undo must work).
- Test all invariants including boundaries, negative direction moves, same-lane collisions, simultaneous parent/child selection.

### Slice 4: Inspectors and performers
- Right inspector shows process/task title, description, dates, status, role/assignee, result/notes (lightweight fields).
- Process color picker and inherited child visual styling.
- Basic global performer roster with role + optional person name and typeahead suggestions.
- Task can store multiple Assignment entries; distinguish lead process assignment from task assignees.
- Bottom performer timeline with collapsible leader/role groups and highlighted link on hover. Shared horizontal time transform with main timeline.
- Test assignee mutation, name suggestions, hover mapping, performer panel alignment.

### Slice 5: Portfolio and copying
- Portfolio timeline has one or more lanes of project bars with direct move handles and date spans.
- Moving a project shifts all nested dates including markers and declared project bounds, but does not alter content titles/people.
- Deep-copy an existing project preserving its view layout, structure, assignments and dates with new entity IDs.
- Test a moved project's complete date set; verify all references and no orphan objects.

### Slice 6: Export and polish
- PDF output from explicit export scene derived from model and current presentation state.
- Keep configured expanded/collapsed processes, hierarchy, performers, colors, date grid and stage lines. Exclude tool chrome.
- Export whole configured timeline on one PDF sheet; if extremely wide, warn or fit rather than cut off silently.
- Fix touch hit targets for mobile view/status controls as a minimal responsive fallback without implementing full touch editing.
- Test reload, local persistence, nested drag/resize/undo, blank-project behavior and export.

## Data and date requirements

Store ISO date-only values and explicit date intervals, with exclusive end for calculations. Duration >= 1 calendar day. Never shift dates by elapsed milliseconds across DST; shift by calendar units. Week start Monday. Monthly snapping uses calendar month boundaries. A project has explicit bounds, even when empty. A process can extend beyond all tasks, but no task can extend beyond a process after a completed action.

## Interaction acceptance matrix

- Click process: inspector opens and tasks expand. Click another: both remain expanded.
- Double-click title: rename without moving bar, Enter commits, Esc cancels.
- Drag process handle by +10 calendar days: process AND child task dates +10; stage date unchanged unless project moved.
- Drag task right edge beyond parent: task extends; parent end extends to task end.
- Drag a task to a different row: laneId changes; date remains unless horizontal drag also intended; overlapping same-lane placement invalid.
- Multi-select 3 tasks and drag one selected handle +1 grid step: all 3 move +1 grid step; one undo reverses all.
- Zoom x2: positions scale; stored ISO dates remain identical.
- Change snap 1 day -> 1 week: dates remain identical until a drag; grid becomes weekly and new motion lands on week boundaries.
- Toggle weekends: faint weekend coloring toggles, schedule invariant.
- Today: device-local current-day vertical marker displayed where appropriate; not stored as a stage.
- Delete/reload/duplicate: no orphan tasks, no loss of local edits, no shared IDs in copied structure.
- Portfolio project move: all descendants and project markers follow, exactly once.
- PDF: matching expansion state and visual row order, not a screenshot of side panel.

## Security/future extension notes (no server build now)

- Repository layer may later use a server implementation; do not bake Dexie calls into React components.
- Domain commands must support serializable DTOs and granular validation, so server and MCP can reuse them.
- Stub interfaces for current user, permissions and conflict handling; no fake security UI or disabled auth screen in MVP.
- Phase B role policy: admins edit, guests view only projects they are explicitly invited to; invitations via revocable expiring links, never global/public access to all projects.
- Future edit locks must be server-enforced leases with expiry, not UI-only flags.
- Future ChatGPT write operations must be previewed as structured changes and explicitly confirmed before commit.

## Definition of done for MVP

- The user can create and duplicate projects, edit a complex multi-process timeline with precisely dated bars, manage a roster, view performer assignments, move projects on a portfolio timeline, and export the configured layout to PDF.
- All changes survive browser refresh on the same device; no API keys/configuration required.
- Key interactions perform without accidental move/resizes, date arithmetic regressions, or loss of undo functionality.
- Automated unit and browser tests cover the acceptance matrix; no known failing checks, no errors in browser console.
- README explains local run, saving/backup, known limitations, and future server/auth/MCP phases without claiming they exist.

## Delivery discipline for Codex

- Implement ONLY the slice requested in the current instruction. Avoid speculative UI and unrelated features.
- Begin by reading ARCHITECTURE.md and this file; propose file-level work and risk points briefly.
- Commit code in small cohesive units; execute tests and provide exact commands/results.
- Never delete user data or reset IndexedDB to make a test pass.
- When a requirement is ambiguous, preserve the established behavior above; if an implementation default is necessary, document it as an ADR and keep the choice reversible.
