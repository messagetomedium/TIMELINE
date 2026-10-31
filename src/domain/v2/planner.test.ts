import { describe, it, expect } from "vitest";
import { addDays, dateOnly, shiftInterval, daysBetween } from "../dates";
import { processIdSchema, laneIdSchema, taskIdSchema } from "../ids";
import { required } from "../../testing/required";
import { createTemplate } from "./template";
import { snapshotSchema, checkpointDate } from "./model";
import { applyCommand, planCommand } from "./commands";
import type { ContentCommand } from "./commands";
const day = (n: number) => addDays(dateOnly("2026-11-01"), n - 1);
function make(count = 2) {
  const d = createTemplate(
    "Тест",
    "",
    day(1),
    () => crypto.randomUUID(),
    "2026-10-31T00:00:00Z",
  );
  if (count === 3) {
    const s = required(d.stages[1]),
      newId = crypto.randomUUID();
    d.stages.push({ ...s, id: newId, ...shiftInterval(s, 7), sortIndex: 2 });
    for (const p of d.processes.filter((p) => p.stageId === s.id)) {
      const id = processIdSchema.parse(crypto.randomUUID()),
        laneId = laneIdSchema.parse(crypto.randomUUID());
      d.processes.push({
        ...p,
        id,
        laneId,
        stageId: newId,
        ...shiftInterval(p, 7),
      });
      d.lanes.push({
        id: laneId,
        projectId: d.project.id,
        workspaceId: d.project.workspaceId,
        kind: "process",
        processId: null,
        stageId: newId,
        sortIndex: p.sortIndex,
      });
    }
    d.project.endDateExclusive = day(22);
  }
  return snapshotSchema.parse(d);
}
function taskRow() {
  const d = make(),
    s = required(d.stages[1]);
  Object.assign(s, shiftInterval(s, 7));
  for (const p of d.processes.filter((p) => p.stageId === s.id)) {
    Object.assign(p, shiftInterval(p, 7));
    for (const t of d.tasks.filter((t) => t.processId === p.id))
      Object.assign(t, shiftInterval(t, 7));
  }
  required(d.stages[0]).endDateExclusive = day(15);
  d.project.endDateExclusive = day(22);
  const p = required(d.processes[0]),
    a = required(d.tasks[0]),
    b = required(d.tasks[1]);
  p.endDateExclusive = day(12);
  a.startDate = day(1);
  a.endDateExclusive = day(5);
  b.startDate = day(5);
  b.endDateExclusive = day(8);
  d.tasks.push({
    ...b,
    id: taskIdSchema.parse(crypto.randomUUID()),
    startDate: day(10),
    endDateExclusive: day(12),
    sortIndex: 2,
  });
  return snapshotSchema.parse(d);
}
const resizeTask = (d: ReturnType<typeof make>, end: number) =>
  applyCommand(d, {
    type: "Timeline",
    command: {
      type: "resize",
      target: { kind: "task", id: required(d.tasks[0]).id },
      edge: "end",
      date: day(end),
    },
  });
describe("V1.3B deterministic scheduler", () => {
  it.each([7, 9])(
    "absorbs gaps and pushes only overlapping tasks (end %s)",
    (end) => {
      const d = taskRow(),
        n = resizeTask(d, end),
        children = n.tasks.filter(
          (t) => t.processId === required(d.processes[0]).id,
        );
      expect([
        required(children[1]).startDate,
        required(children[1]).endDateExclusive,
      ]).toEqual([day(end), day(end + 3)]);
      expect([
        required(children[2]).startDate,
        required(children[2]).endDateExclusive,
      ]).toEqual(end === 7 ? [day(10), day(12)] : [day(12), day(14)]);
      expect(n.project.revision).toBe(1);
      expect(required(d.tasks[1]).startDate).toBe(day(5));
    },
  );
  it("mirrors ripple left without changing neighbor duration or pulling on shrink", () => {
    const d = taskRow(),
      c = required(d.tasks.at(-1)),
      n = applyCommand(d, {
        type: "Timeline",
        command: { type: "move", target: { kind: "task", id: c.id }, days: -5 },
      });
    expect(required(n.tasks[1]).startDate).toBe(day(2));
    expect(required(n.tasks[0]).startDate).toBe(day(-2));
    expect(
      daysBetween(
        required(n.tasks[0]).startDate,
        required(n.tasks[0]).endDateExclusive,
      ),
    ).toBe(4);
    const shrink = resizeTask(d, 3);
    expect(shrink.tasks.slice(1)).toEqual(d.tasks.slice(1));
    expect(required(shrink.processes[0]).endDateExclusive).toBe(day(12));
  });
  it("pushes processes and their children once in stable original lane order", () => {
    const d = taskRow(),
      a = required(d.processes[0]),
      b = required(d.processes[1]);
    // Use the first two processes as successive work on one row, with bounded children.
    d.tasks = d.tasks.filter((t) => t.processId !== a.id);
    a.endDateExclusive = day(5);
    b.laneId = a.laneId;
    Object.assign(b, { startDate: day(5), endDateExclusive: day(9) });
    for (const t of d.tasks.filter((t) => t.processId === b.id))
      Object.assign(t, shiftInterval(t, 4));
    const n = applyCommand(snapshotSchema.parse(d), {
      type: "Timeline",
      command: {
        type: "resize",
        target: { kind: "process", id: a.id },
        edge: "end",
        date: day(9),
      },
    });
    expect(n.processes.find((p) => p.id === b.id)?.startDate).toBe(day(9));
    expect(n.tasks.find((t) => t.processId === b.id)?.startDate).toBe(day(9));
    expect(n.processes.find((p) => p.id === b.id)?.endDateExclusive).toBe(
      day(13),
    );
  });
  it.each([2, 5, 10])(
    "stage boundary carries contents and only the missing tail (%s days)",
    (delta) => {
      const d = make(3),
        b = required(d.stages[1]),
        c = required(d.stages[2]);
      const n = applyCommand(d, {
        type: "MoveStageBoundary",
        id: b.id,
        date: addDays(b.startDate, delta),
      });
      const deficit = Math.max(0, delta - 3);
      expect(required(n.stages[1]).startDate).toBe(addDays(day(8), delta));
      expect(required(n.stages[1]).endDateExclusive).toBe(
        addDays(day(15), deficit),
      );
      expect(n.processes.find((p) => p.stageId === b.id)?.startDate).toBe(
        addDays(day(8), delta),
      );
      expect(n.processes.find((p) => p.stageId === c.id)?.startDate).toBe(
        addDays(day(15), deficit),
      );
      expect(n.project.endDateExclusive).toBe(
        addDays(day(22), Math.max(0, deficit - 3)),
      );
    },
  );
  it("permits slack on left direct boundary and rejects truncation of the preceding work", () => {
    const d = make(),
      b = required(d.stages[1]);
    const n = applyCommand(d, {
      type: "MoveStageBoundary",
      id: b.id,
      date: day(7),
    });
    expect(required(n.stages[0]).endDateExclusive).toBe(day(7));
    expect(required(n.processes[2]).startDate).toBe(day(7));
    expect(() =>
      applyCommand(d, { type: "MoveStageBoundary", id: b.id, date: day(4) }),
    ).toThrow("предыдущего");
  });
  it("expands from a child without moving that child or other work in the same stage twice", () => {
    const d = make(),
      t = required(d.tasks[1]);
    const n = applyCommand(d, {
      type: "Timeline",
      command: {
        type: "resize",
        target: { kind: "task", id: t.id },
        edge: "end",
        date: day(11),
      },
    });
    expect(required(n.tasks[1]).endDateExclusive).toBe(day(11));
    expect(required(n.processes[1]).startDate).toBe(day(1));
    expect(required(n.stages[0]).endDateExclusive).toBe(day(11));
    expect(required(n.processes[2]).startDate).toBe(day(11));
    expect(required(n.tasks[4]).startDate).toBe(day(11));
  });
  it.each([2, 5])(
    "expands a child left through preceding slack/deficit (%s days)",
    (delta) => {
      const d = make(),
        t = required(d.tasks[4]);
      const n = applyCommand(d, {
        type: "Timeline",
        command: {
          type: "move",
          target: { kind: "task", id: t.id },
          days: -delta,
        },
      });
      expect(required(n.tasks[4]).startDate).toBe(day(8 - delta));
      expect(required(n.stages[0]).endDateExclusive).toBe(day(8 - delta));
      const deficit = Math.max(0, delta - 3);
      expect(required(n.processes[0]).startDate).toBe(day(1 - deficit));
      expect(n.project.startDate).toBe(day(1 - deficit));
    },
  );
  it("separates first-stage boundary from project resize; keeps free checkpoint except on explicit shift", () => {
    const d = make(),
      first = required(d.stages[0]),
      c = required(d.checkpoints[0]);
    const moved = applyCommand(d, {
        type: "MoveStageBoundary",
        id: first.id,
        date: day(-2),
      }),
      resized = applyCommand(d, {
        type: "ResizeProject",
        edge: "start",
        date: day(-2),
      });
    expect(required(moved.processes[0]).startDate).toBe(day(-2));
    expect(required(resized.processes[0]).startDate).toBe(day(1));
    expect(checkpointDate(moved, c)).toBe(day(14));
    const anchored = applyCommand(d, {
      type: "UpdateCheckpoint",
      id: c.id,
      title: c.title,
      note: "",
      timing: { anchor: "project_end" },
    });
    const shift = applyCommand(anchored, { type: "ShiftProject", days: 7 });
    expect(checkpointDate(shift, required(shift.checkpoints[0]))).toBe(day(21));
  });
  it("is a no-op at the same boundary, rejects invalid intervals and reports complete affected IDs", () => {
    const d = make(),
      s = required(d.stages[0]);
    expect(
      applyCommand(d, {
        type: "MoveStageBoundary",
        id: s.id,
        date: s.startDate,
      }),
    ).toBe(d);
    expect(() =>
      applyCommand(d, { type: "ResizeProject", edge: "end", date: day(10) }),
    ).toThrow();
    const p = planCommand(d, {
      type: "Timeline",
      command: {
        type: "move",
        target: { kind: "process", id: required(d.processes[0]).id },
        days: 5,
      },
    });
    for (const id of [
      d.project.id,
      required(d.stages[0]).id,
      required(d.stages[1]).id,
      required(d.processes[0]).id,
      required(d.tasks[0]).id,
      required(d.processes[2]).id,
    ])
      expect(p.affectedIds).toContain(id);
    expect(p.inverse.snapshot).toEqual(d);
    expect(typeof window).toBe("undefined");
  });
});
describe("V1.3B stage structure", () => {
  it.each([0, 1, 2])(
    "inserts at boundary %s with fresh ID and one shift of subsequent contents",
    (i) => {
      const d = make(),
        id = crypto.randomUUID();
      const n = applyCommand(d, {
        type: "InsertStage",
        id,
        leftStageId: d.stages[i - 1]?.id ?? null,
        rightStageId: d.stages[i]?.id ?? null,
        title: "Вставка",
        durationDays: 7,
      });
      expect(n.stages).toHaveLength(3);
      expect(required(n.stages[i]).id).toBe(id);
      expect(n.project.startDate).toBe(d.project.startDate);
      expect(n.project.endDateExclusive).toBe(day(22));
      for (const p of d.processes)
        expect(n.processes.find((x) => x.id === p.id)?.startDate).toBe(
          addDays(
            p.startDate,
            p.stageId === required(d.stages[0]).id
              ? i === 0
                ? 7
                : 0
              : i <= 1
                ? 7
                : 0,
          ),
        );
      expect(n.checkpoints).toEqual(d.checkpoints);
    },
  );
  it.each([0, 1, 2])(
    "deletes stage %s, its scoped contents, closes time, keeps free events",
    (i) => {
      const d = make(3),
        s = required(d.stages[i]),
        n = applyCommand(d, { type: "DeleteStage", id: s.id });
      expect(n.stages).toHaveLength(2);
      expect(n.project.startDate).toBe(day(1));
      expect(n.project.endDateExclusive).toBe(day(15));
      expect(n.processes.some((p) => p.stageId === s.id)).toBe(false);
      expect(n.checkpoints).toEqual(d.checkpoints);
      expect(snapshotSchema.safeParse(n).success).toBe(true);
    },
  );
  it("clears without shrinking, refuses deleting the last stage, validates boundary and IDs", () => {
    const d = make(),
      s = required(d.stages[0]),
      command: ContentCommand = {
        type: "ClearStage",
        id: s.id,
        processId: processIdSchema.parse(crypto.randomUUID()),
        laneId: laneIdSchema.parse(crypto.randomUUID()),
      };
    const n = applyCommand(d, command),
      p = required(n.processes.find((p) => p.stageId === s.id));
    expect(p.title).toBe("Процесс");
    expect(daysBetween(p.startDate, p.endDateExclusive)).toBe(1);
    expect(n.tasks.some((t) => t.processId === p.id)).toBe(false);
    expect(n.project.endDateExclusive).toBe(d.project.endDateExclusive);
    const single = applyCommand(d, {
      type: "DeleteStage",
      id: required(d.stages[1]).id,
    });
    expect(() =>
      applyCommand(single, { type: "DeleteStage", id: s.id }),
    ).toThrow("Единственный");
    expect(() =>
      applyCommand(d, {
        type: "InsertStage",
        id: crypto.randomUUID(),
        leftStageId: null,
        rightStageId: required(d.stages[1]).id,
        title: "Неверно",
        durationDays: 7,
      }),
    ).toThrow("Граница");
    expect(() =>
      applyCommand(d, { ...command, processId: required(d.processes[2]).id }),
    ).toThrow();
  });
  it("merges neighbors preserving dates, descriptions, row IDs, tasks and result links", () => {
    const d = make(3),
      a = required(d.stages[0]),
      b = required(d.stages[1]);
    a.description = "А";
    b.description = "Б";
    const p = required(d.processes[2]);
    d.results.push({
      id: crypto.randomUUID(),
      workspaceId: d.project.workspaceId,
      projectId: d.project.id,
      stageId: b.id,
      processId: p.id,
      title: "Результат",
      description: "Текст",
      revision: 0,
    });
    const n = applyCommand(d, {
      type: "MergeStages",
      leftStageId: a.id,
      rightStageId: b.id,
    });
    expect(required(n.stages[0]).title).toBe(a.title);
    expect(required(n.stages[0]).description).toContain("А\n\n—\n\nБ");
    expect(n.tasks).toEqual(d.tasks);
    expect(n.results[0]?.stageId).toBe(a.id);
    expect(n.results[0]?.processId).toBe(p.id);
    for (const old of d.processes) {
      const next = required(n.processes.find((p) => p.id === old.id));
      expect([next.startDate, next.endDateExclusive, next.laneId]).toEqual([
        old.startDate,
        old.endDateExclusive,
        old.laneId,
      ]);
    }
    expect(() =>
      applyCommand(d, {
        type: "MergeStages",
        leftStageId: a.id,
        rightStageId: required(d.stages[2]).id,
      }),
    ).toThrow();
  });
  it("rejects zero/negative stage durations and calendar overflow atomically", () => {
    const d = make();
    for (const n of [0, -1, 1.5])
      expect(() =>
        applyCommand(d, {
          type: "InsertStage",
          id: crypto.randomUUID(),
          leftStageId: null,
          rightStageId: required(d.stages[0]).id,
          title: "Этап",
          durationDays: n,
        }),
      ).toThrow();
    expect(() =>
      applyCommand(d, { type: "ShiftProject", days: 4000000 }),
    ).toThrow();
    expect(d.project.revision).toBe(0);
  });
});
