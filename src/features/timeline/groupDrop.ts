import { daysBetween, laneIdSchema } from "../../domain";
import type { DateOnly, ProjectDocument } from "../../domain";
import type { Snapshot } from "../../domain/v2/model";
import { laneParent, selectedWorks, workParent } from "../../domain/v2/work";
import type { GroupMove, WorkKind } from "../../domain/v2/work";
import type { layoutTimeline } from "../../application/timelineLayout";
export interface StackDrop {
  kind: WorkKind;
  ids: readonly string[];
  days: number;
  date: DateOnly;
  y: number;
  rows: readonly { sourceLaneId: string; laneId: string }[];
}
/** Hit-test an unchanging source layout after extracting selected works, never the moving preview. */
export function groupDrop(
  source: Snapshot,
  doc: ProjectDocument,
  layout: typeof layoutTimeline,
  expanded: ReadonlySet<import("../../domain").ProcessId>,
  drop: StackDrop,
): GroupMove {
  const selected = selectedWorks(source, drop.kind, drop.ids),
    first = selected[0];
  if (!first) throw Error("Работы не выбраны");
  const processes =
    drop.kind === "process"
      ? doc.processes.filter((p) => !drop.ids.includes(p.id))
      : doc.processes;
  const tasks =
    drop.kind === "task"
      ? doc.tasks.filter((t) => !drop.ids.includes(t.id))
      : doc.tasks;
  const compact = {
    ...doc,
    processes,
    tasks,
    lanes: doc.lanes.filter((l) =>
      l.kind === "process"
        ? processes.some((p) => p.laneId === l.id)
        : tasks.some((t) => t.laneId === l.id),
    ),
  };
  let scene = layout(compact, expanded),
    parentId = workParent(first);
  if (drop.kind === "task") {
    const old = source.processes.find((p) => p.id === parentId);
    if (!old) throw Error("Процесс не найден");
    const stage =
      source.stages.find(
        (s) => s.startDate <= drop.date && drop.date < s.endDateExclusive,
      )?.id ?? old.stageId;
    const candidates = source.processes
      .filter((p) => p.stageId === stage)
      .map((p) => ({
        p,
        y:
          scene.rows.find((r) => r.kind === "process" && r.id === p.laneId)
            ?.y ?? 18,
      }))
      .sort((a, b) => a.y - b.y || a.p.startDate.localeCompare(b.p.startDate));
    const rowCandidate =
      [...candidates].reverse().find((c) => c.y <= drop.y) ?? candidates[0];
    if (!rowCandidate) throw Error("В этом этапе нет процесса для задачи");
    const distance = (p: Snapshot["processes"][number]) =>
      drop.date < p.startDate
        ? daysBetween(drop.date, p.startDate)
        : drop.date >= p.endDateExclusive
          ? daysBetween(p.endDateExclusive, drop.date) + 1
          : 0;
    const candidate = candidates
      .filter((c) => c.y === rowCandidate.y)
      .sort(
        (a, b) =>
          distance(a.p) - distance(b.p) ||
          a.p.startDate.localeCompare(b.p.startDate),
      )[0];
    if (!candidate) throw Error("Целевой процесс не найден");
    parentId = candidate.p.id;
    scene = layout(compact, new Set([...expanded, candidate.p.id]));
  }
  const targetLanes = source.lanes.filter(
    (l) =>
      l.kind === drop.kind &&
      laneParent(l) === parentId &&
      compact.lanes.some((x) => x.id === l.id),
  );
  const row = scene.rows
    .filter(
      (r) => r.kind === drop.kind && targetLanes.some((l) => l.id === r.id),
    )
    .find((r) => drop.y < r.y + 14);
  return {
    type: "GroupMove",
    kind: drop.kind,
    ids: [...drop.ids],
    days: drop.days,
    destination: {
      parentId,
      beforeLaneId: row ? laneIdSchema.parse(row.id) : null,
      rows: drop.rows.map((r) => ({
        sourceLaneId: laneIdSchema.parse(r.sourceLaneId),
        laneId: laneIdSchema.parse(r.laneId),
      })),
    },
  };
}
