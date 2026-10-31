import { required } from "../../testing/required";
import { describe, it, expect } from "vitest";
import { createTemplate } from "./template";
import { snapshotSchema, checkpointDate, displayDocument } from "./model";
import { applyCommand } from "./commands";
import { dateOnly, addDays, daysBetween } from "../dates";
const make = (start = "2028-02-26") =>
  createTemplate(
    "Нейтральный",
    "",
    dateOnly(start),
    () => crypto.randomUUID(),
    "2026-10-31T12:00:00Z",
  );
describe("V2 foundation invariants", () => {
  it("creates independent neutral 14-day structures across leap/year boundaries", () => {
    for (const start of ["2028-02-26", "2026-12-28"]) {
      const d = make(start),
        other = make(start);
      expect(d.schemaVersion).toBe(2);
      expect(daysBetween(d.project.startDate, d.project.endDateExclusive)).toBe(
        14,
      );
      expect(d.stages).toHaveLength(2);
      expect(d.processes).toHaveLength(4);
      expect(d.tasks).toHaveLength(8);
      expect(d.results).toHaveLength(0);
      expect(d.checkpoints).toHaveLength(1);
      expect(checkpointDate(d, required(d.checkpoints[0]))).toBe(
        addDays(d.project.startDate, 13),
      );
      expect(
        d.processes.filter((p) => other.processes.some((x) => x.id === p.id))
          .length,
      ).toBe(0);
      for (const p of d.processes) {
        expect(daysBetween(p.startDate, p.endDateExclusive)).toBe(4);
        expect(d.tasks.filter((t) => t.processId === p.id)).toHaveLength(2);
      }
      expect(displayDocument(d).people).toEqual([]);
    }
  });
  it.each([
    "workspace",
    "project",
    "stage",
    "lane",
    "task-lane",
    "zero",
    "coverage",
    "overlap",
    "result",
  ])("rejects invalid %s before commit", (kind) => {
    const d = structuredClone(make());
    const p = required(d.processes[0]),
      t = required(d.tasks[0]);
    if (kind === "workspace") p.workspaceId = crypto.randomUUID();
    if (kind === "project") t.projectId = make().project.id;
    if (kind === "stage") p.stageId = required(d.stages[1]).id;
    if (kind === "lane") p.laneId = required(d.processes[2]).laneId;
    if (kind === "task-lane") t.laneId = required(d.tasks[2]).laneId;
    if (kind === "zero") t.endDateExclusive = t.startDate;
    if (kind === "coverage")
      required(d.stages[0]).endDateExclusive = addDays(
        required(d.stages[0]).endDateExclusive,
        -1,
      );
    if (kind === "overlap") required(d.tasks[1]).startDate = t.startDate;
    if (kind === "result")
      d.results.push({
        id: crypto.randomUUID(),
        workspaceId: d.project.workspaceId,
        projectId: d.project.id,
        stageId: required(d.stages[1]).id,
        processId: p.id,
        title: "",
        description: "",
        revision: 0,
      });
    expect(snapshotSchema.safeParse(d).success).toBe(false);
  });
  it("moves children once, expands stage on crossing, rejects child truncation", () => {
    const d = make(),
      p = required(d.processes[0]);
    const next = applyCommand(d, {
      type: "Timeline",
      command: { type: "move", target: { kind: "process", id: p.id }, days: 2 },
    });
    expect(required(next.tasks[0]).startDate).toBe(
      addDays(required(d.tasks[0]).startDate, 2),
    );
    expect(required(d.tasks[0]).startDate).toBe(d.project.startDate);
    const expanded=applyCommand(d,{type:'Timeline',command:{type:'move',target:{kind:'process',id:p.id},days:4}});
    expect(required(expanded.stages[0]).endDateExclusive).toBe(addDays(d.project.startDate,8));
    expect(required(expanded.processes[2]).startDate).toBe(addDays(d.project.startDate,8));
    expect(() =>
      applyCommand(d, {
        type: "Timeline",
        command: {
          type: "resize",
          target: { kind: "process", id: p.id },
          edge: "end",
          date: addDays(p.startDate, 2),
        },
      }),
    ).toThrow();
  });
  it("keeps free dates on resize, resolves anchored inclusive end and shifts once", () => {
    const d = make(),
      c = required(d.checkpoints[0]);
    const free = applyCommand(d, {
      type: "ResizeProject",
      edge: "end",
      date: addDays(d.project.endDateExclusive, 3),
    });
    expect(checkpointDate(free, required(free.checkpoints[0]))).toBe(
      c.timing.anchor === "free" ? c.timing.date : "",
    );
    const anchored = applyCommand(d, {
      type: "UpdateCheckpoint",
      id: c.id,
      title: c.title,
      note: "",
      timing: { anchor: "project_end" },
    });
    const resized = applyCommand(anchored, {
      type: "ResizeProject",
      edge: "end",
      date: addDays(d.project.endDateExclusive, 3),
    });
    expect(checkpointDate(resized, required(resized.checkpoints[0]))).toBe(
      addDays(d.project.endDateExclusive, 2),
    );
    const shifted = applyCommand(anchored, { type: "ShiftProject", days: 7 });
    expect(checkpointDate(shifted, required(shifted.checkpoints[0]))).toBe(
      addDays(checkpointDate(d, c), 7),
    );
  });
  it("does not create content changes for no-op names and zero-day moves", () => {
    const d = make();
    expect(
      applyCommand(d, {
        type: "Rename",
        kind: "project",
        id: d.project.id,
        value: d.project.name,
      }),
    ).toBe(d);
    expect(
      applyCommand(d, {
        type: "Timeline",
        command: {
          type: "move",
          target: { kind: "process", id: required(d.processes[0]).id },
          days: 0,
        },
      }),
    ).toBe(d);
  });
});
