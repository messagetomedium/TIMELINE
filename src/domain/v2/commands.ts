import { assignmentCommands, applyAssignment } from "./assignmentCommands";
import type { CatalogData } from "./peopleModel";
import { statusSchema } from "../schema";
import { resizeWorkRange } from "./planner";
import { workCommandSchemas, applyWork } from "./work";
import { z } from "zod";
import {
  snapshotSchema,
  checkpointSchema,
  checkpointDate,
  entityId,
} from "./model";
import type { Snapshot } from "./model";
import { dateOnlySchema } from "../schema";
import { addDays, shiftInterval } from "../dates";
import {
  applyTimelinePlan,
  applyStagePlan,
  stageCommandSchemas,
} from "./planner";
import { processIdSchema, taskIdSchema, stageMarkerIdSchema } from "../ids";
const targetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("process"), id: processIdSchema }),
  z.strictObject({ kind: z.literal("task"), id: taskIdSchema }),
]);
const timelineSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("rename"),
    target: targetSchema,
    title: z.string().trim().min(1),
  }),
  z.strictObject({
    type: z.literal("move"),
    target: targetSchema,
    days: z.number().int(),
  }),
  z.strictObject({
    type: z.literal("resize"),
    target: targetSchema,
    edge: z.enum(["start", "end"]),
    date: dateOnlySchema,
  }),
  z.strictObject({
    type: z.literal("stage"),
    id: stageMarkerIdSchema,
    date: dateOnlySchema,
  }),
]);
import { resultCommands, applyResult } from "./results";
const textTarget = z.enum([
  "project",
  "stage",
  "process",
  "task",
  "checkpoint",
]);
export const commandSchema = z.discriminatedUnion("type", [
  ...stageCommandSchemas,
  ...assignmentCommands,
  z.strictObject({
    type: z.literal("SetWorkStatus"),
    kind: z.enum(["process", "task"]),
    id: z.uuid(),
    status: statusSchema,
  }),
  z.strictObject({
    type: z.literal("SetProcessColor"),
    id: z.uuid(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  z.strictObject({
    type: z.literal("ResizeWorkRange"),
    kind: z.enum(["process", "task"]),
    id: z.uuid(),
    startDate: dateOnlySchema,
    endDateExclusive: dateOnlySchema,
  }),
  z.strictObject({
    type: z.literal("SetProjectScheduled"),
    value: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("ResizeProjectRange"),
    startDate: dateOnlySchema,
    endDateExclusive: dateOnlySchema,
  }),
  z.strictObject({
    type: z.literal("CreateCheckpoint"),
    id: z.uuid(),
    title: z.string().trim().min(1),
  }),
  z.strictObject({ type: z.literal("DeleteCheckpoint"), id: z.uuid() }),
  z.strictObject({
    type: z.literal("DuplicateCheckpoint"),
    id: z.uuid(),
    newId: z.uuid(),
  }),
  ...workCommandSchemas,
  ...resultCommands,
  z.strictObject({
    type: z.literal("SetCheckpointTiming"),
    id: z.uuid(),
    timing: checkpointSchema.shape.timing,
  }),
  z.strictObject({
    type: z.literal("Rename"),
    kind: textTarget,
    id: z.uuid(),
    value: z.string().trim().min(1),
  }),
  z.strictObject({
    type: z.literal("Describe"),
    kind: textTarget,
    id: z.uuid(),
    value: z.string(),
  }),
  z.strictObject({
    type: z.literal("UpdateCheckpoint"),
    id: z.uuid(),
    title: z.string().trim().min(1),
    note: z.string(),
    timing: checkpointSchema.shape.timing,
  }),
  z.strictObject({ type: z.literal("ShiftProject"), days: z.number().int() }),
  z.strictObject({
    type: z.literal("ResizeProject"),
    edge: z.enum(["start", "end"]),
    date: dateOnlySchema,
  }),
  z.strictObject({ type: z.literal("Timeline"), command: timelineSchema }),
]);
export type ContentCommand = z.infer<typeof commandSchema>;
export const envelopeSchema = z.strictObject({
  commandId: z.uuid(),
  version: z.literal(1),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  command: commandSchema,
});
export type CommandEnvelope = z.infer<typeof envelopeSchema>;
export function applyCommand(
  source: Snapshot,
  input: ContentCommand,
  people?: CatalogData,
): Snapshot {
  const c = commandSchema.parse(input);
  const d = structuredClone(source);
  if (c.type === "Rename" || c.type === "Describe") {
    const field = c.type === "Rename" ? "title" : "description";
    if (c.kind === "project") {
      if (c.id !== d.project.id) throw Error("Проект не найден");
      d.project = {
        ...d.project,
        [c.type === "Rename" ? "name" : "description"]: c.value,
      };
    } else if (c.kind === "checkpoint") {
      if (!d.checkpoints.some((x) => x.id === c.id))
        throw Error("Чекпойнт не найден");
      d.checkpoints = d.checkpoints.map((x) =>
        x.id === c.id
          ? { ...x, [c.type === "Rename" ? "title" : "note"]: c.value }
          : x,
      );
    } else {
      const key =
        c.kind === "stage"
          ? "stages"
          : c.kind === "process"
            ? "processes"
            : "tasks";
      if (!d[key].some((x) => x.id === c.id)) throw Error("Элемент не найден");
      // The discriminated branch retains each collection's exact type.
      if (key === "stages")
        d.stages = d.stages.map((x) =>
          x.id === c.id
            ? { ...x, [field]: c.value, revision: x.revision + 1 }
            : x,
        );
      if (key === "processes")
        d.processes = d.processes.map((x) =>
          x.id === c.id
            ? {
                ...x,
                [c.type === "Rename" ? "title" : "details"]: c.value,
                revision: x.revision + 1,
              }
            : x,
        );
      if (key === "tasks")
        d.tasks = d.tasks.map((x) =>
          x.id === c.id
            ? {
                ...x,
                [c.type === "Rename" ? "title" : "details"]: c.value,
                revision: x.revision + 1,
              }
            : x,
        );
    }
  } else if (c.type === "SetAssignment" || c.type === "CreatePersonAndAssign") {
    applyAssignment(d, c, people);
  } else if (c.type === "SetWorkStatus") {
    const item = (c.kind === "process" ? d.processes : d.tasks).find(
      (x) => x.id === c.id,
    );
    if (!item) throw Error("Работа не найдена");
    item.status = c.status;
  } else if (c.type === "SetProcessColor") {
    const process = d.processes.find((p) => p.id === c.id);
    if (!process) throw Error("Процесс не найден");
    process.color = c.color;
  } else if (c.type === "ResizeWorkRange") {
    resizeWorkRange(source, d, c.kind, c.id, c.startDate, c.endDateExclusive);
  } else if (c.type === "SetProjectScheduled") {
    d.project.isScheduled = c.value;
  } else if (c.type === "SetCheckpointTiming") {
    const checkpoint = d.checkpoints.find((x) => x.id === c.id);
    if (!checkpoint) throw Error("Чекпойнт не найден");
    checkpoint.timing = c.timing;
  } else if (c.type === "UpdateCheckpoint") {
    if (!d.checkpoints.some((x) => x.id === c.id))
      throw Error("Чекпойнт не найден");
    d.checkpoints = d.checkpoints.map((x) =>
      x.id === c.id
        ? {
            ...x,
            title: c.title,
            note: c.note,
            timing: c.timing,
            revision: x.revision + 1,
          }
        : x,
    );
  } else if (c.type === "ResizeProjectRange") {
    if (c.startDate >= c.endDateExclusive)
      throw Error("Конец должен быть не раньше начала");
    if (
      d.processes.some(
        (p) =>
          p.startDate < c.startDate || p.endDateExclusive > c.endDateExclusive,
      )
    )
      throw Error(
        "Нельзя сократить проект: новые границы обрезают существующие работы",
      );
    const stages = [...d.stages].sort((a, b) => a.sortIndex - b.sortIndex),
      first = stages[0],
      last = stages.at(-1);
    if (!first || !last) throw Error("Этапы не найдены");
    d.project.startDate = c.startDate;
    d.project.endDateExclusive = c.endDateExclusive;
    first.startDate = c.startDate;
    last.endDateExclusive = c.endDateExclusive;
  } else if (c.type === "CreateCheckpoint") {
    d.checkpoints.push({
      id: c.id,
      workspaceId: d.project.workspaceId,
      projectId: d.project.id,
      title: c.title,
      note: "",
      revision: 0,
      timing: { anchor: "free", date: addDays(d.project.endDateExclusive, -1) },
    });
  } else if (c.type === "DeleteCheckpoint") {
    if (!d.checkpoints.some((x) => x.id === c.id))
      throw Error("Чекпойнт не найден");
    d.checkpoints = d.checkpoints.filter((x) => x.id !== c.id);
  } else if (c.type === "DuplicateCheckpoint") {
    const original = d.checkpoints.find((x) => x.id === c.id);
    if (!original) throw Error("Чекпойнт не найден");
    d.checkpoints.push({
      ...original,
      id: c.newId,
      title: `${original.title} — копия`,
      revision: 0,
    });
  } else if (c.type === "Timeline") {
    applyTimelinePlan(source, d, c.command);
  } else if (c.type === "ShiftProject") {
    if (c.days === 0) return source;
    d.project = {
      ...d.project,
      ...shiftInterval(d.project, c.days),
      anchorDate: addDays(d.project.anchorDate, c.days),
    };
    d.stages = d.stages.map((x) => ({
      ...x,
      ...shiftInterval(x, c.days),
      revision: x.revision + 1,
    }));
    d.processes = d.processes.map((x) => ({
      ...x,
      ...shiftInterval(x, c.days),
      revision: x.revision + 1,
    }));
    d.tasks = d.tasks.map((x) => ({
      ...x,
      ...shiftInterval(x, c.days),
      revision: x.revision + 1,
    }));
    d.checkpoints = d.checkpoints.map((x) => ({
      ...x,
      timing:
        x.timing.anchor === "free"
          ? { anchor: "free", date: addDays(checkpointDate(source, x), c.days) }
          : x.timing,
      revision: x.revision + 1,
    }));
  } else if (c.type === "ResizeProject") {
    d.project = {
      ...d.project,
      [c.edge === "start" ? "startDate" : "endDateExclusive"]: c.date,
    };
    const ordered = [...d.stages].sort((a, b) => a.sortIndex - b.sortIndex),
      target = c.edge === "start" ? ordered[0] : ordered.at(-1);
    if (!target) throw Error("Этап не найден");
    d.stages = d.stages.map((x) =>
      x.id === target.id
        ? {
            ...x,
            [c.edge === "start" ? "startDate" : "endDateExclusive"]: c.date,
            revision: x.revision + 1,
          }
        : x,
    );
  } else if (
    c.type === "UpdateResult" ||
    c.type === "CreateStandaloneResult" ||
    c.type === "SetResultPlaced" ||
    c.type === "MoveResult" ||
    c.type === "DeleteResult"
  ) {
    applyResult(d, c);
  } else if (
    c.type === "GroupMove" ||
    c.type === "CreateWork" ||
    c.type === "DuplicateWork" ||
    c.type === "DeleteWork"
  ) {
    applyWork(source, d, c, people);
  } else {
    applyStagePlan(d, c);
  }
  d.assignments = d.assignments.filter((a) =>
    (a.kind === "process" ? d.processes : d.tasks).some(
      (w) => w.id === a.targetId,
    ),
  );
  return finalize(source, d);
}
const collections = [
  "stages",
  "processes",
  "tasks",
  "checkpoints",
  "results",
  "resultPlacements",
  "assignments",
] as const;
function content(entity: object) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(entity).filter(
        ([key]) => key !== "revision" && key !== "updatedAt",
      ),
    ),
  );
}
function finalize(source: Snapshot, d: Snapshot): Snapshot {
  for (const key of collections)
    for (const entity of d[key]) {
      const old = source[key].find((x) => entityId(x) === entityId(entity));
      entity.revision = old
        ? old.revision + (content(old) === content(entity) ? 0 : 1)
        : 0;
    }
  const withoutRevision = (v: Snapshot) =>
    JSON.stringify({
      ...v,
      project: { ...v.project, revision: 0, updatedAt: "" },
      ...Object.fromEntries(
        collections.map((key) => [
          key,
          v[key].map((x) => ({ ...x, revision: 0 })),
        ]),
      ),
    });
  if (withoutRevision(d) === withoutRevision(source)) return source;
  d.project.revision = source.project.revision + 1;
  const result = snapshotSchema.safeParse(d);
  if (!result.success)
    throw Error(
      result.error.issues[0]?.message ?? "Изменение нарушает структуру проекта",
    );
  return result.data;
}
export function planCommand(
  source: Snapshot,
  command: ContentCommand,
  people?: CatalogData,
) {
  const document = applyCommand(source, command, people);
  const entities = (d: Snapshot) => [
    d.project,
    ...d.stages,
    ...d.lanes,
    ...d.processes,
    ...d.tasks,
    ...d.checkpoints,
    ...d.results,
    ...d.resultPlacements,
    ...d.assignments,
  ];
  const before = new Map(
      entities(source).map((e) => [
        ("resultId" in e ? "placement:" : "") + entityId(e),
        JSON.stringify(e),
      ]),
    ),
    after = new Map(
      entities(document).map((e) => [
        ("resultId" in e ? "placement:" : "") + entityId(e),
        JSON.stringify(e),
      ]),
    );
  const affectedIds = [...new Set([...before.keys(), ...after.keys()])].filter(
    (id) => before.get(id) !== after.get(id),
  );
  return { document, affectedIds, inverse: { snapshot: source } };
}
