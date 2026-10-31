import { it, expect } from "vitest";
import { createTemplate } from "./template";
import { dateOnly } from "../dates";
import { applyCommand, planCommand } from "./commands";
import { snapshotSchema } from "./model";
import { isResultPlaced, resultLayout } from "./results";
import { required } from "../../testing/required";
const initial = () =>
  createTemplate(
    "Результаты",
    "",
    dateOnly("2026-11-02"),
    () => crypto.randomUUID(),
    "2026-10-31T12:00:00.000Z",
  );
it("shares one process result record; auto places only after a nonempty title, and does not resurrect hidden tiles", () => {
  let d = initial();
  const process = required(d.processes[0]),
    id = crypto.randomUUID();
  const base = {
    type: "UpdateResult" as const,
    id,
    stageId: process.stageId,
    processId: process.id,
  };
  d = applyCommand(d, { ...base, field: "description", value: "До названия" });
  expect(isResultPlaced(d, required(d.results[0]))).toBe(false);
  d = applyCommand(d, { ...base, field: "title", value: "Итог" });
  expect(isResultPlaced(d, required(d.results[0]))).toBe(true);
  d = applyCommand(d, { type: "SetResultPlaced", id, placed: false });
  d = applyCommand(d, { ...base, field: "title", value: "Скрытый итог" });
  expect(isResultPlaced(d, required(d.results[0]))).toBe(false);
  expect(d.results).toHaveLength(1);
  d = applyCommand(d, { type: "SetResultPlaced", id, placed: true });
  expect(isResultPlaced(d, required(d.results[0]))).toBe(true);
  expect(applyCommand(d, { type: "SetResultPlaced", id, placed: true })).toBe(
    d,
  );
  expect(
    applyCommand(d, { ...base, field: "title", value: "Скрытый итог" }),
  ).toBe(d);
});
it("creates independent stage results, moves vertically, and has exact no-op and affected IDs", () => {
  let d = initial();
  const id = crypto.randomUUID(),
    stageId = required(d.stages[0]).id;
  d = applyCommand(d, {
    type: "CreateStandaloneResult",
    id,
    stageId,
    title: "Договор",
  });
  expect(required(d.results[0]).processId).toBeNull();
  expect(d.processes).toHaveLength(4);
  const plan = planCommand(d, { type: "MoveResult", id, y: 156 });
  d = plan.document;
  expect(plan.affectedIds).toContain(`placement:${id}`);
  expect(required(resultLayout(d, new Map())[0]).y).toBe(156);
  expect(applyCommand(d, { type: "MoveResult", id, y: 156 })).toBe(d);
  expect(
    applyCommand(d, { type: "DeleteResult", id }).resultPlacements,
  ).toEqual([]);
});
it("lays out automatic tiles at their parent or next free place and preserves manual placements", () => {
  let d = initial();
  const p = required(d.processes[0]);
  d = applyCommand(d, {
    type: "UpdateResult",
    id: crypto.randomUUID(),
    stageId: p.stageId,
    processId: p.id,
    field: "title",
    value: "Процесс",
  });
  d = applyCommand(d, {
    type: "CreateStandaloneResult",
    id: crypto.randomUUID(),
    stageId: p.stageId,
    title: "Другой",
  });
  let scene = resultLayout(d, new Map([[p.id, 18]]));
  expect(scene.map((t) => t.y)).toEqual([18, 82]);
  d = applyCommand(d, {
    type: "MoveResult",
    id: required(d.results[1]).id,
    y: 18,
  });
  scene = resultLayout(d, new Map([[p.id, 18]]));
  expect(scene.map((t) => t.y)).toEqual([82, 18]);
});
it("validates placement ownership and uniqueness, deletes with stages and preserves result links during merge", () => {
  let d = initial();
  const p = required(d.processes[2]),
    id = crypto.randomUUID();
  d = applyCommand(d, {
    type: "UpdateResult",
    id,
    stageId: p.stageId,
    processId: p.id,
    field: "title",
    value: "Связь",
  });
  expect(() =>
    applyCommand(d, {
      type: "UpdateResult",
      id: crypto.randomUUID(),
      stageId: p.stageId,
      processId: p.id,
      field: "title",
      value: "Дубль",
    }),
  ).toThrow();
  expect(
    snapshotSchema.safeParse({
      ...d,
      resultPlacements: [...d.resultPlacements, ...d.resultPlacements],
    }).success,
  ).toBe(false);
  const removed = applyCommand(d, { type: "DeleteStage", id: p.stageId });
  expect(removed.resultPlacements).toEqual([]);
  expect(removed.results).toEqual([]);
  const merged = applyCommand(d, {
    type: "MergeStages",
    leftStageId: required(d.stages[0]).id,
    rightStageId: p.stageId,
  });
  expect(required(merged.results[0]).stageId).toBe(required(d.stages[0]).id);
  expect(merged.resultPlacements).toEqual(d.resultPlacements);
});
it("loads older snapshots without placement records and never creates a phantom process", () => {
  const d = initial();
  const { resultPlacements, ...old } = d;
  expect(resultPlacements).toEqual([]);
  expect(snapshotSchema.parse(old).resultPlacements).toEqual([]);
});
