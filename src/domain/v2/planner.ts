import { z } from "zod";
import {
  addDays,
  containsInterval,
  daysBetween,
  shiftInterval,
} from "../dates";
import type { DateOnly } from "../dates";
import { dateOnlySchema } from "../schema";
import { laneIdSchema, processIdSchema } from "../ids";
import type { TimelineCommand } from "../legacyCommands";
import type { Snapshot } from "./model";

export const stageCommandSchemas = [
  z.strictObject({
    type: z.literal("InsertStage"),
    id: z.uuid(),
    leftStageId: z.uuid().nullable(),
    rightStageId: z.uuid().nullable(),
    title: z.string().trim().min(1),
    durationDays: z.number().int().positive(),
  }),
  z.strictObject({ type: z.literal("DeleteStage"), id: z.uuid() }),
  z.strictObject({
    type: z.literal("ClearStage"),
    id: z.uuid(),
    processId: processIdSchema,
    laneId: laneIdSchema,
  }),
  z.strictObject({
    type: z.literal("MergeStages"),
    leftStageId: z.uuid(),
    rightStageId: z.uuid(),
  }),
  z.strictObject({
    type: z.literal("MoveStageBoundary"),
    id: z.uuid(),
    date: dateOnlySchema,
  }),
] as const;
export const stageCommandSchema = z.discriminatedUnion(
  "type",
  stageCommandSchemas,
);
export type StageCommand = z.infer<typeof stageCommandSchema>;
type Stage = Snapshot["stages"][number];
type Work = Snapshot["processes"][number] | Snapshot["tasks"][number];
function required<T>(v: T | undefined): T {
  if (v === undefined) throw Error("Элемент не найден");
  return v;
}
const sortedStages = (d: Snapshot) =>
  [...d.stages].sort(
    (a, b) => a.sortIndex - b.sortIndex || a.id.localeCompare(b.id),
  );
const earlier = (a: DateOnly, b: DateOnly) => (a < b ? a : b);
const later = (a: DateOnly, b: DateOnly) => (a > b ? a : b);
function shiftProcess(d: Snapshot, id: string, days: number) {
  const p = required(d.processes.find((x) => x.id === id));
  Object.assign(p, shiftInterval(p, days));
  for (const t of d.tasks)
    if (t.processId === id) Object.assign(t, shiftInterval(t, days));
}
function shiftContents(d: Snapshot, id: string, days: number) {
  for (const p of d.processes)
    if (p.stageId === id) shiftProcess(d, p.id, days);
}
function shiftStage(d: Snapshot, s: Stage, days: number) {
  Object.assign(s, shiftInterval(s, days));
  shiftContents(d, s.id, days);
}
const contentEnd = (d: Snapshot, s: Stage) =>
  d.processes
    .filter((p) => p.stageId === s.id)
    .reduce((v, p) => later(v, p.endDateExclusive), addDays(s.startDate, 1));

/** Forward deficit propagation. The edited stage's children are never shifted here. */
function growRight(d: Snapshot, index: number, end: DateOnly) {
  const stages = sortedStages(d);
  let edge = end;
  for (let i = index; i < stages.length; i++) {
    const s = required(stages[i]);
    if (i !== index) {
      const delta = daysBetween(s.startDate, edge);
      if (delta <= 0) break;
      shiftContents(d, s.id, delta);
      s.startDate = edge;
    }
    const nextEnd = later(s.endDateExclusive, later(edge, contentEnd(d, s)));
    if (nextEnd === s.endDateExclusive) break;
    s.endDateExclusive = nextEnd;
    edge = nextEnd;
  }
  d.project.endDateExclusive = required(stages.at(-1)).endDateExclusive;
}
/** Consume previous tail slack, then move only the missing amount backwards. */
function growLeft(d: Snapshot, index: number, start: DateOnly) {
  const stages = sortedStages(d);
  let edge = start;
  for (let i = index; i >= 0; i--) {
    const s = required(stages[i]);
    s.startDate = edge;
    const prev = stages[i - 1];
    if (!prev) break;
    const workEnd = d.processes
      .filter((p) => p.stageId === prev.id)
      .reduce<DateOnly | null>(
        (v, p) => (v ? later(v, p.endDateExclusive) : p.endDateExclusive),
        null,
      );
    const deficit = Math.max(
      workEnd ? daysBetween(edge, workEnd) : 0,
      daysBetween(edge, prev.startDate) + 1,
      0,
    );
    prev.endDateExclusive = edge;
    if (deficit === 0) break;
    shiftContents(d, prev.id, -deficit);
    edge = addDays(prev.startDate, -deficit);
  }
  d.project.startDate = required(stages[0]).startDate;
}
export function expandStage(d: Snapshot, id: string) {
  const stages = sortedStages(d),
    index = stages.findIndex((s) => s.id === id),
    s = required(stages[index]);
  const start = d.processes
    .filter((p) => p.stageId === id)
    .reduce((v, p) => earlier(v, p.startDate), s.startDate);
  if (start < s.startDate) growLeft(d, index, start);
  const end = contentEnd(d, s);
  if (end > s.endDateExclusive) growRight(d, index, end);
}
function moveBoundary(d: Snapshot, id: string, date: DateOnly) {
  const stages = sortedStages(d),
    i = stages.findIndex((s) => s.id === id),
    s = required(stages[i]),
    prev = stages[i - 1];
  if (
    prev &&
    (date <= prev.startDate ||
      d.processes.some(
        (p) => p.stageId === prev.id && p.endDateExclusive > date,
      ))
  )
    throw Error("Граница отрезает работу или длительность предыдущего этапа.");
  const days = daysBetween(s.startDate, date);
  if (days === 0) return;
  shiftContents(d, id, days);
  s.startDate = date;
  if (prev) prev.endDateExclusive = date;
  else d.project.startDate = date;
  growRight(d, i, later(s.endDateExclusive, contentEnd(d, s)));
}
function ripple(
  d: Snapshot,
  source: Snapshot,
  kind: "process" | "task",
  id: string,
  direction: number,
) {
  if (!direction) return;
  const list = kind === "process" ? d.processes : d.tasks,
    original = kind === "process" ? source.processes : source.tasks;
  let cursor: Work = required(list.find((x) => x.id === id));
  const row = original
    .filter((x) => x.laneId === cursor.laneId)
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        a.sortIndex - b.sortIndex ||
        a.id.localeCompare(b.id),
    );
  for (
    let i = row.findIndex((x) => x.id === id) + direction;
    i >= 0 && i < row.length;
    i += direction
  ) {
    const neighbor = required(list.find((x) => x.id === required(row[i]).id));
    const delta =
      direction > 0
        ? daysBetween(neighbor.startDate, cursor.endDateExclusive)
        : daysBetween(neighbor.endDateExclusive, cursor.startDate);
    if (direction > 0 ? delta <= 0 : delta >= 0) break;
    if (kind === "process") shiftProcess(d, neighbor.id, delta);
    else Object.assign(neighbor, shiftInterval(neighbor, delta));
    cursor = neighbor;
  }
}
export function expandTaskParent(d: Snapshot, source: Snapshot, id: string) {
  const p = required(d.processes.find((p) => p.id === id)),
    before = { ...p };
  for (const child of d.tasks.filter((t) => t.processId === id)) {
    p.startDate = earlier(p.startDate, child.startDate);
    p.endDateExclusive = later(p.endDateExclusive, child.endDateExclusive);
  }
  if (p.startDate < before.startDate) ripple(d, source, "process", p.id, -1);
  if (p.endDateExclusive > before.endDateExclusive)
    ripple(d, source, "process", p.id, 1);
  expandStage(d, p.stageId);
}
export function applyTimelinePlan(
  source: Snapshot,
  d: Snapshot,
  c: TimelineCommand,
) {
  if (c.type === "stage") {
    moveBoundary(d, c.id, c.date);
    return;
  }
  const item = required(
    (c.target.kind === "process" ? d.processes : d.tasks).find(
      (x) => x.id === c.target.id,
    ),
  );
  if (c.type === "rename") {
    if (!c.title.trim()) throw Error("Укажите название");
    item.title = c.title.trim();
    return;
  }
  const before = { ...item };
  if (c.type === "move") {
    if (c.target.kind === "process") shiftProcess(d, item.id, c.days);
    else Object.assign(item, shiftInterval(item, c.days));
  } else
    Object.assign(
      item,
      c.edge === "start" ? { startDate: c.date } : { endDateExclusive: c.date },
    );
  if (item.startDate >= item.endDateExclusive)
    throw Error("Длительность должна быть не меньше одного дня.");
  const direction =
    c.type === "move"
      ? Math.sign(c.days)
      : c.edge === "start"
        ? item.startDate < before.startDate
          ? -1
          : 0
        : item.endDateExclusive > before.endDateExclusive
          ? 1
          : 0;
  if (c.target.kind === "process") {
    if (
      d.tasks.some((t) => t.processId === item.id && !containsInterval(item, t))
    )
      throw Error("Границы процесса должны вмещать все задачи.");
    ripple(d, source, "process", item.id, direction);
    const p = required(d.processes.find((p) => p.id === item.id));
    expandStage(d, p.stageId);
  } else {
    ripple(d, source, "task", item.id, direction);
    const t = required(d.tasks.find((t) => t.id === item.id)),
      p = required(d.processes.find((p) => p.id === t.processId));
    for (const child of d.tasks.filter((x) => x.processId === p.id)) {
      p.startDate = earlier(p.startDate, child.startDate);
      p.endDateExclusive = later(p.endDateExclusive, child.endDateExclusive);
    }
    ripple(d, source, "process", p.id, direction);
    expandStage(d, p.stageId);
  }
}
export function resizeWorkRange(
  source: Snapshot,
  d: Snapshot,
  kind: "process" | "task",
  id: string,
  startDate: DateOnly,
  endDateExclusive: DateOnly,
) {
  const item = required(
      (kind === "process" ? d.processes : d.tasks).find((w) => w.id === id),
    ),
    before = { ...item };
  if (startDate >= endDateExclusive)
    throw Error("Конец работы должен быть не раньше начала");
  Object.assign(item, { startDate, endDateExclusive });
  if (kind === "process") {
    if (d.tasks.some((t) => t.processId === id && !containsInterval(item, t)))
      throw Error("Границы процесса обрезают существующие задачи");
    if (startDate < before.startDate) ripple(d, source, "process", id, -1);
    if (endDateExclusive > before.endDateExclusive)
      ripple(d, source, "process", id, 1);
    expandStage(d, required(d.processes.find((p) => p.id === id)).stageId);
  } else {
    if (startDate < before.startDate) ripple(d, source, "task", id, -1);
    if (endDateExclusive > before.endDateExclusive)
      ripple(d, source, "task", id, 1);
    expandTaskParent(
      d,
      source,
      required(d.tasks.find((t) => t.id === id)).processId,
    );
  }
}
function removeContents(d: Snapshot, id: string) {
  const ids = new Set(
    d.processes.filter((p) => p.stageId === id).map((p) => p.id),
  );
  d.processes = d.processes.filter((p) => !ids.has(p.id));
  d.tasks = d.tasks.filter((t) => !ids.has(t.processId));
  d.lanes = d.lanes.filter((l) =>
    l.kind === "process" ? l.stageId !== id : !ids.has(l.processId),
  );
  d.results = d.results.filter((r) => r.stageId !== id);
  d.resultPlacements = d.resultPlacements.filter((p) =>
    d.results.some((r) => r.id === p.resultId),
  );
}
export function applyStagePlan(d: Snapshot, c: StageCommand) {
  const stages = sortedStages(d);
  if (c.type === "MoveStageBoundary") {
    moveBoundary(d, c.id, c.date);
    return;
  }
  if (c.type === "InsertStage") {
    const i =
      c.rightStageId === null
        ? stages.length
        : stages.findIndex((s) => s.id === c.rightStageId);
    if (
      i < 0 ||
      (stages[i - 1]?.id ?? null) !== c.leftStageId ||
      (stages[i]?.id ?? null) !== c.rightStageId
    )
      throw Error("Граница вставки изменилась. Повторите действие.");
    const start = stages[i]?.startDate ?? d.project.endDateExclusive;
    for (const s of stages.slice(i)) shiftStage(d, s, c.durationDays);
    stages.splice(i, 0, {
      id: c.id,
      workspaceId: d.project.workspaceId,
      projectId: d.project.id,
      title: c.title,
      description: "",
      startDate: start,
      endDateExclusive: addDays(start, c.durationDays),
      sortIndex: i,
      revision: 0,
    });
    d.project.endDateExclusive = addDays(
      d.project.endDateExclusive,
      c.durationDays,
    );
  } else if (c.type === "MergeStages") {
    const i = stages.findIndex((s) => s.id === c.leftStageId),
      left = required(stages[i]),
      right = required(stages[i + 1]);
    if (right.id !== c.rightStageId)
      throw Error("Объединить можно только соседние этапы.");
    left.endDateExclusive = right.endDateExclusive;
    left.description = [left.description, right.description]
      .filter(Boolean)
      .join("\n\n—\n\n");
    const lanes = d.lanes
      .filter((l) => l.kind === "process" && l.stageId === left.id)
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .concat(
        d.lanes
          .filter((l) => l.kind === "process" && l.stageId === right.id)
          .sort((a, b) => a.sortIndex - b.sortIndex),
      );
    lanes.forEach((l, index) => {
      if (l.kind === "process") {
        l.stageId = left.id;
        l.sortIndex = index;
      }
    });
    for (const p of d.processes)
      if (p.stageId === right.id) p.stageId = left.id;
    for (const r of d.results) if (r.stageId === right.id) r.stageId = left.id;
    stages.splice(i + 1, 1);
  } else {
    const i = stages.findIndex((s) => s.id === c.id),
      s = required(stages[i]);
    if (c.type === "DeleteStage" && stages.length === 1)
      throw Error("Единственный этап нельзя удалить. Используйте очистку.");
    removeContents(d, s.id);
    if (c.type === "DeleteStage") {
      const days = daysBetween(s.startDate, s.endDateExclusive);
      stages.splice(i, 1);
      for (const laterStage of stages.slice(i))
        shiftStage(d, laterStage, -days);
      d.project.endDateExclusive = addDays(d.project.endDateExclusive, -days);
    } else {
      const scope = {
        workspaceId: d.project.workspaceId,
        projectId: d.project.id,
      };
      d.lanes.push({
        ...scope,
        id: c.laneId,
        kind: "process",
        stageId: s.id,
        processId: null,
        sortIndex: 0,
      });
      d.processes.push({
        ...scope,
        id: c.processId,
        stageId: s.id,
        laneId: c.laneId,
        title: "Процесс",
        details: "",
        startDate: s.startDate,
        endDateExclusive: addDays(s.startDate, 1),
        color: "#678b72",
        status: "Не начато",
        sortIndex: 0,
        revision: 0,
      });
    }
  }
  d.stages = stages.map((s, index) => ({ ...s, sortIndex: index }));
  const ids = new Set(d.processes.map((p) => p.id));
  d.viewPreferences = {
    ...d.viewPreferences,
    expandedProcessIds: d.viewPreferences.expandedProcessIds.filter((id) =>
      ids.has(id),
    ),
  };
}
