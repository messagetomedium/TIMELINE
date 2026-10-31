import { activeAssignment } from "./peopleModel";
import type { CatalogData } from "./peopleModel";
import { z } from "zod";
import { dateOnlySchema } from "../schema";
import { laneIdSchema, processIdSchema, taskIdSchema } from "../ids";
import { containsInterval, daysBetween, shiftInterval } from "../dates";
import type { Snapshot } from "./model";
import { applyTimelinePlan, expandStage, expandTaskParent } from "./planner";
const kind = z.enum(["process", "task"]);
export const groupMoveSchema = z.strictObject({
  type: z.literal("GroupMove"),
  kind,
  ids: z.array(z.uuid()).min(1),
  days: z.number().int(),
  destination: z
    .strictObject({
      parentId: z.uuid(),
      beforeLaneId: laneIdSchema.nullable(),
      rows: z
        .array(
          z.strictObject({ sourceLaneId: laneIdSchema, laneId: laneIdSchema }),
        )
        .min(1),
    })
    .optional(),
});
export const workCommandSchemas = [
  groupMoveSchema,
  z.strictObject({
    type: z.literal("CreateWork"),
    kind,
    id: z.uuid(),
    parentId: z.uuid(),
    title: z.string().trim().min(1),
    startDate: dateOnlySchema,
    endDateExclusive: dateOnlySchema,
    laneId: laneIdSchema.nullable(),
    newLaneId: laneIdSchema,
  }),
  z.strictObject({ type: z.literal("DeleteWork"), kind, id: z.uuid() }),
  z.strictObject({
    type: z.literal("DuplicateWork"),
    kind,
    id: z.uuid(),
    ids: z.record(z.uuid(), z.uuid()),
    newLaneId: laneIdSchema,
  }),
] as const;
export type WorkCommand = z.infer<(typeof workCommandSchemas)[number]>;
export type GroupMove = z.infer<typeof groupMoveSchema>;
export type WorkKind = z.infer<typeof kind>;
export type Work = Snapshot["processes"][number] | Snapshot["tasks"][number];
export function workParent(work: Work) {
  return "stageId" in work ? work.stageId : work.processId;
}
export function laneParent(lane: Snapshot["lanes"][number]) {
  return lane.kind === "process" ? lane.stageId : lane.processId;
}
export function selectedWorks(
  d: Snapshot,
  k: WorkKind,
  ids: readonly string[],
) {
  const list = k === "process" ? d.processes : d.tasks;
  const selected = ids.map((id) => {
    const item = list.find((x) => x.id === id);
    if (!item) throw Error("Выбранная работа больше не существует");
    return item;
  });
  if (
    !selected.length ||
    new Set(ids).size !== ids.length ||
    new Set(selected.map(workParent)).size !== 1
  )
    throw Error("Выбирайте процессы одного этапа либо задачи одного процесса");
  return selected;
}
export function cleanupWork(d: Snapshot) {
  d.lanes = d.lanes.filter((l) =>
    l.kind === "process"
      ? d.processes.some((p) => p.laneId === l.id)
      : d.tasks.some((t) => t.laneId === l.id),
  );
  d.viewPreferences = {
    ...d.viewPreferences,
    expandedProcessIds: d.viewPreferences.expandedProcessIds.filter((id) =>
      d.processes.some((p) => p.id === id),
    ),
  };
}
function limits(source: Snapshot, d: Snapshot) {
  if (d.processes.length > 100 && d.processes.length > source.processes.length)
    throw Error("Лимит: 100 процессов в проекте");
  if (
    d.processes.some(
      (p) =>
        d.tasks.filter((t) => t.processId === p.id).length > 40 &&
        d.tasks.filter((t) => t.processId === p.id).length >
          source.tasks.filter((t) => t.processId === p.id).length,
    )
  )
    throw Error("Лимит: 40 задач в процессе");
}
function orderedLanes(d: Snapshot, k: WorkKind, parentId: string) {
  return d.lanes
    .filter((l) => l.kind === k && laneParent(l) === parentId)
    .sort((a, b) => a.sortIndex - b.sortIndex || a.id.localeCompare(b.id));
}
function insertRows(
  d: Snapshot,
  k: WorkKind,
  parentId: string,
  before: string | null,
  rows: Snapshot["lanes"],
) {
  const lanes = orderedLanes(d, k, parentId).filter(
    (l) => !rows.some((r) => r.id === l.id),
  );
  const index =
    before === null ? lanes.length : lanes.findIndex((l) => l.id === before);
  if (index < 0) throw Error("Место вставки изменилось. Повторите перенос");
  lanes.splice(index, 0, ...rows);
  lanes.forEach((l, i) => {
    l.sortIndex = i;
  });
}
function makeLane(
  d: Snapshot,
  k: WorkKind,
  id: Snapshot["lanes"][number]["id"],
  parentId: string,
): Snapshot["lanes"][number] {
  const scope = {
    id,
    workspaceId: d.project.workspaceId,
    projectId: d.project.id,
    sortIndex: 0,
  };
  return k === "process"
    ? { ...scope, kind: "process", stageId: parentId, processId: null }
    : { ...scope, kind: "task", processId: processIdSchema.parse(parentId) };
}
function expand(d: Snapshot, source: Snapshot, k: WorkKind, parentId: string) {
  if (k === "process") expandStage(d, parentId);
  else expandTaskParent(d, source, parentId);
}
export function copySourceIds(d: Snapshot, k: WorkKind, id: string) {
  if (k === "task") {
    if (!d.tasks.some((t) => t.id === id)) throw Error("Задача не найдена");
    return [
      id,
      ...d.assignments
        .filter((a) => a.kind === "task" && a.targetId === id)
        .map((a) => a.id),
    ];
  }
  if (!d.processes.some((p) => p.id === id)) throw Error("Процесс не найден");
  return [
    id,
    ...d.lanes
      .filter((l) => l.kind === "task" && l.processId === id)
      .map((l) => l.id),
    ...d.tasks.filter((t) => t.processId === id).map((t) => t.id),
    ...d.results.filter((r) => r.processId === id).map((r) => r.id),
    ...d.assignments
      .filter(
        (a) =>
          a.targetId === id ||
          d.tasks.some((t) => t.processId === id && t.id === a.targetId),
      )
      .map((a) => a.id),
  ];
}
function assertFresh(d: Snapshot, ids: string[]) {
  const existing = new Set([
    d.project.id,
    ...[
      d.stages,
      d.processes,
      d.tasks,
      d.lanes,
      d.results,
      d.checkpoints,
      d.assignments,
    ].flatMap((xs) => xs.map((x) => x.id)),
  ]);
  if (new Set(ids).size !== ids.length || ids.some((id) => existing.has(id)))
    throw Error("Новые ID должны быть уникальными");
}
export function applyWork(
  source: Snapshot,
  d: Snapshot,
  c: WorkCommand,
  people?: CatalogData,
) {
  if (c.type === "GroupMove") {
    const selected = selectedWorks(d, c.kind, c.ids),
      first = selected[0];
    if (!first) throw Error("Работы не выбраны");
    const parent = workParent(first);
    if (!c.destination) {
      if (!c.days) return;
      const ordered = [...selected].sort((a, b) =>
        c.days > 0
          ? b.startDate.localeCompare(a.startDate)
          : a.startDate.localeCompare(b.startDate),
      );
      for (const item of ordered)
        applyTimelinePlan(source, d, {
          type: "move",
          target:
            c.kind === "process"
              ? { kind: "process", id: processIdSchema.parse(item.id) }
              : { kind: "task", id: taskIdSchema.parse(item.id) },
          days: c.days,
        });
    } else {
      const target = c.destination;
      if (c.kind === "process" && target.parentId !== parent)
        throw Error("Процессы можно переставлять только внутри своего этапа");
      if (
        c.kind === "task" &&
        !d.processes.some((p) => p.id === target.parentId)
      )
        throw Error("Целевой процесс не найден");
      const sourceRows = orderedLanes(d, c.kind, parent).filter((l) =>
        selected.some((w) => w.laneId === l.id),
      );
      if (
        target.rows.length !== sourceRows.length ||
        new Set(target.rows.map((r) => r.sourceLaneId)).size !==
          sourceRows.length ||
        target.rows.some(
          (r) => !sourceRows.some((l) => l.id === r.sourceLaneId),
        )
      )
        throw Error("Состав строк стека изменился");
      assertFresh(
        d,
        target.rows.map((r) => r.laneId),
      );
      const rows = sourceRows.map((l) => {
        const mapping = target.rows.find((r) => r.sourceLaneId === l.id);
        if (!mapping) throw Error("Не найдена строка стека");
        return makeLane(d, c.kind, mapping.laneId, target.parentId);
      });
      for (const item of selected) {
        const mapping = target.rows.find((r) => r.sourceLaneId === item.laneId);
        if (!mapping) throw Error("Строка не найдена");
        item.laneId = mapping.laneId;
        Object.assign(item, shiftInterval(item, c.days));
        if (c.kind === "process") {
          for (const t of d.tasks)
            if (t.processId === item.id)
              Object.assign(t, shiftInterval(t, c.days));
        } else if ("processId" in item)
          item.processId = processIdSchema.parse(target.parentId);
      }
      cleanupWork(d);
      d.lanes.push(...rows);
      insertRows(d, c.kind, target.parentId, target.beforeLaneId, rows);
      const membership = (v: Snapshot) =>
        orderedLanes(v, c.kind, parent)
          .map((l) =>
            (c.kind === "process" ? v.processes : v.tasks)
              .filter((w) => w.laneId === l.id)
              .map((w) => w.id)
              .sort(),
          )
          .filter((ids) => ids.length);
      if (
        c.days === 0 &&
        target.parentId === parent &&
        JSON.stringify(membership(d)) === JSON.stringify(membership(source))
      ) {
        Object.assign(d, structuredClone(source));
        return;
      }
      expand(d, source, c.kind, target.parentId);
    }
  } else if (c.type === "CreateWork") {
    assertFresh(d, [c.id, ...(c.laneId ? [] : [c.newLaneId])]);
    const parent =
      c.kind === "process"
        ? d.stages.find((s) => s.id === c.parentId)
        : d.processes.find((p) => p.id === c.parentId);
    if (!parent) throw Error("Владелец работы не найден");
    const row = c.laneId
      ? d.lanes.find((l) => l.id === c.laneId)
      : makeLane(d, c.kind, c.newLaneId, c.parentId);
    if (!row || row.kind !== c.kind || laneParent(row) !== c.parentId)
      throw Error("Строка принадлежит другому контейнеру");
    if (!c.laneId) {
      row.sortIndex = orderedLanes(d, c.kind, c.parentId).length;
      d.lanes.push(row);
    }
    const common = {
      workspaceId: d.project.workspaceId,
      projectId: d.project.id,
      laneId: row.id,
      title: c.title,
      details: "",
      startDate: c.startDate,
      endDateExclusive: c.endDateExclusive,
      status: "Не начато" as const,
      sortIndex: 0,
      revision: 0,
    };
    if (c.kind === "process")
      d.processes.push({
        ...common,
        id: processIdSchema.parse(c.id),
        stageId: c.parentId,
        color: "#678b72",
      });
    else
      d.tasks.push({
        ...common,
        id: taskIdSchema.parse(c.id),
        processId: processIdSchema.parse(c.parentId),
      });
    expand(d, source, c.kind, c.parentId);
  } else if (c.type === "DeleteWork") {
    selectedWorks(d, c.kind, [c.id]);
    if (c.kind === "task") d.tasks = d.tasks.filter((t) => t.id !== c.id);
    else {
      d.processes = d.processes.filter((p) => p.id !== c.id);
      d.tasks = d.tasks.filter((t) => t.processId !== c.id);
      d.results = d.results.filter((r) => r.processId !== c.id);
      d.resultPlacements = d.resultPlacements.filter((p) =>
        d.results.some((r) => r.id === p.resultId),
      );
    }
    cleanupWork(d);
  } else {
    const item = selectedWorks(d, c.kind, [c.id])[0];
    if (!item) throw Error("Работа не найдена");
    const expected = copySourceIds(d, c.kind, c.id);
    if (
      Object.keys(c.ids).length !== expected.length ||
      expected.some((id) => !c.ids[id])
    )
      throw Error("Неполный набор ID копии");
    assertFresh(d, [...Object.values(c.ids), c.newLaneId]);
    const mapped = (id: string) => {
      const value = c.ids[id];
      if (!value) throw Error("ID копии не найден");
      return value;
    };
    const parentId = workParent(item),
      container =
        c.kind === "process"
          ? d.stages.find((s) => s.id === parentId)
          : d.processes.find((p) => p.id === parentId);
    if (!container) throw Error("Контейнер не найден");
    const duration = daysBetween(item.startDate, item.endDateExclusive),
      candidate = shiftInterval(item, duration),
      list = c.kind === "process" ? d.processes : d.tasks;
    const right =
      containsInterval(container, candidate) &&
      !list.some(
        (w) =>
          w.laneId === item.laneId &&
          w.startDate < candidate.endDateExclusive &&
          candidate.startDate < w.endDateExclusive,
      );
    const shift = right ? duration : 0,
      laneId = right ? item.laneId : c.newLaneId;
    if (!right) {
      const rows = orderedLanes(d, c.kind, parentId),
        next = rows[rows.findIndex((l) => l.id === item.laneId) + 1],
        row = makeLane(d, c.kind, laneId, parentId);
      d.lanes.push(row);
      insertRows(d, c.kind, parentId, next?.id ?? null, [row]);
    }
    const sourceTargets =
      c.kind === "process"
        ? [
            c.id,
            ...d.tasks.filter((t) => t.processId === c.id).map((t) => t.id),
          ]
        : [c.id];
    d.assignments.push(
      ...d.assignments
        .filter(
          (a) =>
            sourceTargets.includes(a.targetId) && activeAssignment(a, people),
        )
        .map((a) => ({
          ...a,
          id: mapped(a.id),
          targetId: mapped(a.targetId),
          revision: 0,
        })),
    );
    if (c.kind === "process") {
      const p = d.processes.find((p) => p.id === c.id);
      if (!p) throw Error("Процесс не найден");
      const id = processIdSchema.parse(mapped(p.id));
      d.processes.push({
        ...p,
        ...shiftInterval(p, shift),
        id,
        laneId,
        title: `${p.title} — копия`,
        revision: 0,
      });
      d.lanes.push(
        ...d.lanes.flatMap((l) =>
          l.kind === "task" && l.processId === p.id
            ? [{ ...l, id: laneIdSchema.parse(mapped(l.id)), processId: id }]
            : [],
        ),
      );
      d.tasks.push(
        ...d.tasks
          .filter((t) => t.processId === p.id)
          .map((t) => ({
            ...t,
            ...shiftInterval(t, shift),
            id: taskIdSchema.parse(mapped(t.id)),
            laneId: laneIdSchema.parse(mapped(t.laneId)),
            processId: id,
            revision: 0,
          })),
      );
      const result = d.results.find((r) => r.processId === p.id);
      if (result) {
        const resultId = mapped(result.id);
        d.results.push({ ...result, id: resultId, processId: id, revision: 0 });
        const placement = d.resultPlacements.find(
          (r) => r.resultId === result.id,
        );
        if (placement)
          d.resultPlacements.push({
            ...placement,
            resultId,
            sortIndex: d.resultPlacements.length,
            revision: 0,
          });
      }
    } else {
      const t = d.tasks.find((t) => t.id === c.id);
      if (!t) throw Error("Задача не найдена");
      d.tasks.push({
        ...t,
        ...shiftInterval(t, shift),
        id: taskIdSchema.parse(mapped(t.id)),
        laneId,
        title: `${t.title} — копия`,
        revision: 0,
      });
    }
  }
  limits(source, d);
}
