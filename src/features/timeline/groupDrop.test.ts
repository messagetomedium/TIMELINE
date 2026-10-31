import { expect, it } from "vitest";
import { groupDrop } from "./groupDrop";
import { createTemplate } from "../../domain/v2/template";
import { applyCommand } from "../../domain/v2/commands";
import { displayDocument } from "../../domain/v2/model";
import { dateOnly, laneIdSchema } from "../../domain";
import { layoutTimeline } from "../../application/timelineLayout";
import { required } from "../../testing/required";
it("uses calendar X as well as Y to choose between sequential processes sharing one row", () => {
  let d = createTemplate(
    "Hit-test",
    "",
    dateOnly("2026-11-02"),
    () => crypto.randomUUID(),
    "2026-10-31T12:00:00Z",
  );
  const early = required(d.processes[0]),
    id = crypto.randomUUID();
  d = applyCommand(d, {
    type: "CreateWork",
    kind: "process",
    id,
    parentId: early.stageId,
    title: "После первого",
    startDate: dateOnly("2026-11-06"),
    endDateExclusive: dateOnly("2026-11-09"),
    laneId: early.laneId,
    newLaneId: laneIdSchema.parse(crypto.randomUUID()),
  });
  const t = required(d.tasks[2]),
    common = {
      kind: "task" as const,
      ids: [t.id],
      days: 0,
      y: 52,
      rows: [{ sourceLaneId: t.laneId, laneId: crypto.randomUUID() }],
    },
    expanded = new Set(d.viewPreferences.expandedProcessIds);
  const first = groupDrop(d, displayDocument(d), layoutTimeline, expanded, {
      ...common,
      date: dateOnly("2026-11-03"),
    }),
    second = groupDrop(d, displayDocument(d), layoutTimeline, expanded, {
      ...common,
      date: dateOnly("2026-11-07"),
    });
  expect(first.destination?.parentId).toBe(early.id);
  expect(second.destination?.parentId).toBe(id);
});
