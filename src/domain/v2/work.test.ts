import { expect, it } from "vitest";
import { createTemplate } from "./template";
import { applyCommand } from "./commands";
import { copySourceIds } from "./work";
import type { GroupMove, WorkCommand } from "./work";
import { dateOnly, laneIdSchema } from "../index";
import type { Snapshot } from "./model";
import { required } from "../../testing/required";
const fresh = () =>
  createTemplate(
    "Группы",
    "",
    dateOnly("2026-11-02"),
    () => crypto.randomUUID(),
    "2026-10-31T12:00:00Z",
  );
function create(
  d: Snapshot,
  parentId: string,
  start: string,
  end: string,
  laneId: string | null = null,
) {
  return applyCommand(d, {
    type: "CreateWork",
    kind: "task",
    id: crypto.randomUUID(),
    parentId,
    title: "Ещё задача",
    startDate: dateOnly(start),
    endDateExclusive: dateOnly(end),
    laneId: laneId ? laneIdSchema.parse(laneId) : null,
    newLaneId: laneIdSchema.parse(crypto.randomUUID()),
  });
}
function duplicate(
  d: Snapshot,
  kind: "process" | "task",
  id: string,
): WorkCommand {
  return {
    type: "DuplicateWork",
    kind,
    id,
    ids: Object.fromEntries(
      copySourceIds(d, kind, id).map((id) => [id, crypto.randomUUID()]),
    ),
    newLaneId: laneIdSchema.parse(crypto.randomUUID()),
  };
}
function destination(
  d: Snapshot,
  ids: string[],
  parentId: string,
  beforeLaneId: string | null = null,
): GroupMove["destination"] {
  return {
    parentId,
    beforeLaneId: beforeLaneId ? laneIdSchema.parse(beforeLaneId) : null,
    rows: [
      ...new Set(
        d.tasks.filter((t) => ids.includes(t.id)).map((t) => t.laneId),
      ),
    ].map((sourceLaneId) => ({
      sourceLaneId,
      laneId: laneIdSchema.parse(crypto.randomUUID()),
    })),
  };
}
function dates(d: Snapshot) {
  return [...d.processes, ...d.tasks].map((w) => [
    w.id,
    w.startDate,
    w.endDateExclusive,
  ]);
}
it("moving selected works sharing a row preserves offsets and ripples only intervening/unselected works", () => {
  let d = fresh();
  const p = required(d.processes[0]),
    a = required(d.tasks[0]),
    b = required(d.tasks[1]);
  d = create(d, p.id, "2026-11-06", "2026-11-08", a.laneId);
  const c = required(d.tasks.at(-1));
  const next = applyCommand(d, {
    type: "GroupMove",
    kind: "task",
    ids: [a.id, c.id],
    days: 3,
  });
  expect(next.tasks.find((t) => t.id === a.id)?.startDate).toBe("2026-11-05");
  expect(next.tasks.find((t) => t.id === c.id)?.startDate).toBe("2026-11-09");
  expect(next.tasks.find((t) => t.id === b.id)?.startDate).toBe("2026-11-07");
  expect(next.project.revision).toBe(d.project.revision + 1);
  const left = applyCommand(d, {
    type: "GroupMove",
    kind: "task",
    ids: [c.id, a.id],
    days: -2,
  });
  expect(left.tasks.find((t) => t.id === a.id)?.startDate).toBe("2026-10-31");
  expect(left.tasks.find((t) => t.id === c.id)?.startDate).toBe("2026-11-04");
  expect(left.tasks.find((t) => t.id === b.id)?.startDate).toBe("2026-11-02");
});
it("vertical stack retains two shared source rows instead of making three rows and does not change any dates", () => {
  let d = fresh();
  const p = required(d.processes[0]);
  d = create(d, p.id, "2026-11-02", "2026-11-03");
  const ids = d.tasks.filter((t) => t.processId === p.id).map((t) => t.id),
    before = dates(d);
  const n = applyCommand(d, {
    type: "GroupMove",
    kind: "task",
    ids,
    days: 0,
    destination: destination(d, ids, p.id),
  });
  expect(
    new Set(n.tasks.filter((t) => ids.includes(t.id)).map((t) => t.laneId))
      .size,
  ).toBe(2);
  expect(
    n.lanes.filter((l) => l.kind === "task" && l.processId === p.id),
  ).toHaveLength(2);
  expect(dates(n)).toEqual(before);
});
it("process stacks move each child once and keep their stage ownership", () => {
  const d = fresh(),
    ps = d.processes.filter((p) => p.stageId === required(d.stages[0]).id),
    ids = ps.map((p) => p.id);
  const n = applyCommand(d, {
    type: "GroupMove",
    kind: "process",
    ids,
    days: 2,
  });
  for (const p of ps) {
    expect(n.processes.find((x) => x.id === p.id)?.startDate).toBe(
      "2026-11-04",
    );
    for (const t of d.tasks.filter((t) => t.processId === p.id)) {
      expect(n.tasks.find((x) => x.id === t.id)?.startDate).toBe(
        t.startDate === "2026-11-02" ? "2026-11-04" : "2026-11-06",
      );
    }
  }
  expect(n.processes[0]?.stageId).toBe(ps[0]?.stageId);
});
it("reparents a task group with one uniform calendar delta, expands target and removes empty source rows", () => {
  const d = fresh(),
    source = required(d.processes[0]),
    target = required(d.processes[2]),
    ids = d.tasks.filter((t) => t.processId === source.id).map((t) => t.id);
  const n = applyCommand(d, {
    type: "GroupMove",
    kind: "task",
    ids,
    days: 9,
    destination: destination(d, ids, target.id),
  });
  expect(
    n.tasks
      .filter((t) => ids.includes(t.id))
      .map((t) => [t.processId, t.startDate, t.endDateExclusive]),
  ).toEqual([
    [target.id, "2026-11-11", "2026-11-13"],
    [target.id, "2026-11-13", "2026-11-15"],
  ]);
  expect(n.processes.find((p) => p.id === target.id)?.endDateExclusive).toBe(
    "2026-11-15",
  );
  expect(
    n.lanes.some((l) => l.kind === "task" && l.processId === source.id),
  ).toBe(false);
  expect(n.processes.find((p) => p.id === source.id)).toEqual(source);
});
it("rejects mixed parents, duplicate IDs, cross-stage processes and stale row destinations atomically", () => {
  const d = fresh(),
    before = structuredClone(d),
    a = required(d.tasks[0]),
    other = required(d.tasks[2]);
  expect(() =>
    applyCommand(d, {
      type: "GroupMove",
      kind: "task",
      ids: [a.id, other.id],
      days: 1,
    }),
  ).toThrow();
  expect(() =>
    applyCommand(d, {
      type: "GroupMove",
      kind: "task",
      ids: [a.id, a.id],
      days: 1,
    }),
  ).toThrow();
  const p = required(d.processes[0]);
  expect(() =>
    applyCommand(d, {
      type: "GroupMove",
      kind: "process",
      ids: [p.id],
      days: 0,
      destination: {
        parentId: required(d.stages[1]).id,
        beforeLaneId: null,
        rows: [
          {
            sourceLaneId: p.laneId,
            laneId: laneIdSchema.parse(crypto.randomUUID()),
          },
        ],
      },
    }),
  ).toThrow("своего этапа");
  expect(() =>
    applyCommand(d, {
      type: "GroupMove",
      kind: "task",
      ids: [a.id],
      days: 0,
      destination: destination(d, [a.id], a.processId, crypto.randomUUID()),
    }),
  ).toThrow("Место вставки");
  expect(d).toEqual(before);
});
it("zero-delta horizontal moves are exact no-ops", () => {
  const d = fresh();
  expect(
    applyCommand(d, {
      type: "GroupMove",
      kind: "task",
      ids: [required(d.tasks[0]).id],
      days: 0,
    }),
  ).toBe(d);
});
it("a task copy uses free space on the right without shifting other work or its parent", () => {
  let d = fresh();
  const first = required(d.tasks[0]);
  d = applyCommand(d, {
    type: "DeleteWork",
    kind: "task",
    id: required(d.tasks[1]).id,
  });
  const n = applyCommand(d, duplicate(d, "task", first.id)),
    copy = required(n.tasks.at(-1));
  expect(copy.startDate).toBe("2026-11-04");
  expect(copy.endDateExclusive).toBe("2026-11-06");
  expect(copy.laneId).toBe(first.laneId);
  expect(n.processes).toEqual(d.processes);
  expect(n.tasks.slice(0, -1)).toEqual(d.tasks);
});
it("a blocked copy goes immediately below on original dates, leaving all other dates untouched", () => {
  const d = fresh(),
    first = required(d.tasks[0]),
    n = applyCommand(d, duplicate(d, "task", first.id)),
    copy = required(n.tasks.at(-1));
  expect(copy.startDate).toBe(first.startDate);
  expect(copy.laneId).not.toBe(first.laneId);
  expect(n.tasks.slice(0, -1)).toEqual(d.tasks);
  expect(n.stages).toEqual(d.stages);
  expect(n.processes).toEqual(d.processes);
  const rows = n.lanes
    .filter((l) => l.kind === "task" && l.processId === first.processId)
    .sort((a, b) => a.sortIndex - b.sortIndex);
  expect(rows[1]?.id).toBe(copy.laneId);
});
it("a process copy includes fresh child/result links and hidden placement without moving existing objects", () => {
  let d = fresh();
  const p = required(d.processes[0]),
    rid = crypto.randomUUID();
  d = applyCommand(d, {
    type: "UpdateResult",
    id: rid,
    stageId: p.stageId,
    processId: p.id,
    field: "title",
    value: "Итог",
  });
  d = applyCommand(d, { type: "SetResultPlaced", id: rid, placed: false });
  const n = applyCommand(d, duplicate(d, "process", p.id)),
    copy = required(n.processes.at(-1)),
    result = required(n.results.at(-1));
  expect(n.tasks.filter((t) => t.processId === copy.id)).toHaveLength(2);
  expect(result.processId).toBe(copy.id);
  expect(result.id).not.toBe(rid);
  expect(
    n.resultPlacements.find((x) => x.resultId === result.id)?.hiddenByUser,
  ).toBe(true);
  expect(n.processes.slice(0, -1)).toEqual(d.processes);
  expect(n.tasks.slice(0, d.tasks.length)).toEqual(d.tasks);
  expect(n.stages).toEqual(d.stages);
});
it("deleting a process removes only its contents and result, preserving independent stage results and all remaining dates", () => {
  let d = fresh();
  const p = required(d.processes[0]);
  d = applyCommand(d, {
    type: "UpdateResult",
    id: crypto.randomUUID(),
    stageId: p.stageId,
    processId: p.id,
    field: "title",
    value: "Связанный",
  });
  d = applyCommand(d, {
    type: "CreateStandaloneResult",
    id: crypto.randomUUID(),
    stageId: p.stageId,
    title: "Самостоятельный",
  });
  const n = applyCommand(d, { type: "DeleteWork", kind: "process", id: p.id });
  expect(n.tasks).toHaveLength(6);
  expect(n.results.map((r) => r.title)).toEqual(["Самостоятельный"]);
  expect(n.resultPlacements).toHaveLength(1);
  expect(n.stages).toEqual(d.stages);
  expect(n.processes).toEqual(d.processes.slice(1));
  expect(n.lanes.some((l) => l.id === p.laneId)).toBe(false);
});
it("creation validates lane ownership, collisions and duration before a document can be saved", () => {
  const d = fresh(),
    p = required(d.processes[0]),
    a = required(d.tasks[0]);
  expect(() => create(d, p.id, "2026-11-02", "2026-11-03", a.laneId)).toThrow();
  expect(() => create(d, p.id, "2026-11-03", "2026-11-03")).toThrow();
  expect(() =>
    create(
      d,
      required(d.processes[1]).id,
      "2026-11-02",
      "2026-11-03",
      a.laneId,
    ),
  ).toThrow("другому");
  const n = create(d, p.id, "2026-11-06", "2026-11-08");
  expect(n.processes.find((x) => x.id === p.id)?.endDateExclusive).toBe(
    "2026-11-08",
  );
  expect(n.tasks).toHaveLength(9);
});
it("dropping complete rows back into their existing place is a true no-op", () => {
  const d = fresh(),
    p = required(d.processes[0]),
    ids = d.tasks.filter((t) => t.processId === p.id).map((t) => t.id);
  expect(
    applyCommand(d, {
      type: "GroupMove",
      kind: "task",
      ids,
      days: 0,
      destination: destination(d, ids, p.id),
    }),
  ).toBe(d);
});
it("enforces the task limit during reparenting without altering the source", () => {
  let d = fresh();
  const source = required(d.processes[0]),
    target = required(d.processes[1]);
  for (let i = 0; i < 37; i++)
    d = create(d, target.id, "2026-11-02", "2026-11-03");
  const before = structuredClone(d),
    ids = d.tasks.filter((t) => t.processId === source.id).map((t) => t.id);
  expect(() =>
    applyCommand(d, {
      type: "GroupMove",
      kind: "task",
      ids,
      days: 0,
      destination: destination(d, ids, target.id),
    }),
  ).toThrow("40 задач");
  expect(d).toEqual(before);
});
