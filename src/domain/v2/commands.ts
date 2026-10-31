import { z } from "zod";
import { snapshotSchema, checkpointSchema, checkpointDate, entityId } from "./model";
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
import { resultCommands, applyResult } from './results';
const textTarget = z.enum(["project", "stage", "process", "task", "checkpoint"]);
export const commandSchema = z.discriminatedUnion("type", [
  ...stageCommandSchemas,
  ...resultCommands,
  z.strictObject({type:z.literal("SetCheckpointTiming"),id:z.uuid(),timing:checkpointSchema.shape.timing}),
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
    } else if(c.kind === "checkpoint") {
      if(!d.checkpoints.some(x=>x.id===c.id)) throw Error("Чекпойнт не найден");
      d.checkpoints=d.checkpoints.map(x=>x.id===c.id?{...x,[c.type==="Rename"?"title":"note"]:c.value}:x);
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
  } else if (c.type === "SetCheckpointTiming") {
    const checkpoint=d.checkpoints.find(x=>x.id===c.id);
    if(!checkpoint) throw Error("Чекпойнт не найден");
    checkpoint.timing=c.timing;
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
  } else if(c.type === "UpdateResult" || c.type === "CreateStandaloneResult" || c.type === "SetResultPlaced" || c.type === "MoveResult" || c.type === "DeleteResult") {
    applyResult(d,c);
  } else {
    applyStagePlan(d, c);
  }
  return finalize(source, d);
}
const collections = [
  "stages",
  "processes",
  "tasks",
  "checkpoints",
  "results",
  "resultPlacements",
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
export function planCommand(source: Snapshot, command: ContentCommand) {
  const document = applyCommand(source, command);
  const entities = (d: Snapshot) => [
    d.project,
    ...d.stages,
    ...d.lanes,
    ...d.processes,
    ...d.tasks,
    ...d.checkpoints,
    ...d.results,
    ...d.resultPlacements,
  ];
  const before = new Map(
      entities(source).map((e) => [("resultId" in e ? "placement:" : "")+entityId(e), JSON.stringify(e)]),
    ),
    after = new Map(entities(document).map((e) => [("resultId" in e ? "placement:" : "")+entityId(e), JSON.stringify(e)]));
  const affectedIds = [...new Set([...before.keys(), ...after.keys()])].filter(
    (id) => before.get(id) !== after.get(id),
  );
  return { document, affectedIds, inverse: { snapshot: source } };
}
