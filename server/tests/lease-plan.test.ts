import { expect, it } from "vitest";
import { createTemplate } from "../../src/domain/v2/template";
import { dateOnly } from "../../src/domain";
import { planCommand } from "../../src/domain/v2/commands";
import { basis, leasePlan, overlaps, processScope, projectScope } from "../leasePlan";
import { hashPayload } from "../commandHash";

const fixture = () => createTemplate("Lease", "", dateOnly("2026-11-02"), () => crypto.randomUUID(), new Date().toISOString());
it("independent processes coexist and preserve identical semantic deltas on a newer snapshot", () => {
  const d = fixture(), a = d.processes[0], b = d.processes[1]; if (!a || !b) throw Error("Fixture");
  const command = { type: "Rename" as const, kind: "process" as const, id: a.id, value: "Alice" };
  const alice = leasePlan(d, planCommand(d, command).document);
  const afterBob = planCommand(d, { type: "Rename", kind: "process", id: b.id, value: "Bob" }).document;
  const bob = leasePlan(d, afterBob), replanned = leasePlan(afterBob, planCommand(afterBob, command).document);
  expect(alice.resources).toEqual([processScope(d.project.id, a.id)]); expect(overlaps(alice.resources, bob.resources)).toBe(false);
  expect(replanned).toEqual(alice);
});
it("a process includes its tasks; cascade/structural project changes intersect and invalidate dependencies", () => {
  const d = fixture(), p = d.processes[0], task = d.tasks.find((t) => t.processId === p?.id); if (!p || !task) throw Error("Fixture");
  const taskPlan = leasePlan(d, planCommand(d, { type: "Rename", kind: "task", id: task.id, value: "Changed" }).document);
  expect(taskPlan.resources).toEqual([processScope(d.project.id, p.id)]);
  const shifted = planCommand(d, { type: "ShiftProject", days: 1 }).document;
  const project = leasePlan(d, shifted);
  expect(project.resources).toEqual([projectScope(d.project.id)]); expect(overlaps(project.resources, taskPlan.resources)).toBe(true);
  expect(hashPayload(basis(shifted, taskPlan.resources))).not.toBe(hashPayload(taskPlan.basis));
});
it("presentation changes cannot become lease resources or content deltas", () => {
  const d = fixture(), viewed = { ...d, viewPreferences: { ...d.viewPreferences, cameraY: 900, zoomPxPerDay: 28, showWeekends: false } };
  expect(leasePlan(d, viewed).resources).toEqual([]); expect(leasePlan(d, viewed).deltaHash).toBe(leasePlan(d, d).deltaHash);
});
