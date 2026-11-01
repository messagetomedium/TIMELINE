import { createTemplate } from "../domain/v2/template";
import { dateOnly, processIdSchema, taskIdSchema, laneIdSchema } from "../domain";
import { snapshotSchema } from "../domain/v2/model";
/** One bounded stress project; 100 processes, 4000 tasks, initially collapsed. */
export function portfolioFixture() {
  const d = createTemplate("Нагрузочный", "", dateOnly("2026-11-02"), () => crypto.randomUUID(), new Date().toISOString());
  const scope = { workspaceId: d.project.workspaceId, projectId: d.project.id };
  d.lanes = []; d.processes = []; d.tasks = [];
  for (let i = 0; i < 100; i++) {
    const stage = d.stages[Math.floor(i / 50)];
    if (!stage) throw Error("Fixture stage missing");
    const processId = processIdSchema.parse(crypto.randomUUID()), laneId = laneIdSchema.parse(crypto.randomUUID());
    d.lanes.push({ ...scope, id: laneId, kind: "process", stageId: stage.id, processId: null, sortIndex: i });
    d.processes.push({ ...scope, id: processId, laneId, stageId: stage.id, title: `Процесс ${String(i + 1)}`, startDate: stage.startDate, endDateExclusive: stage.endDateExclusive, sortIndex: i, revision: 0, color: "#678b72", status: "Не начато", details: "" });
    for (let j = 0; j < 40; j++) {
      const taskLane = laneIdSchema.parse(crypto.randomUUID());
      d.lanes.push({ ...scope, id: taskLane, kind: "task", processId, sortIndex: j });
      d.tasks.push({ ...scope, id: taskIdSchema.parse(crypto.randomUUID()), processId, laneId: taskLane, title: `Задача ${String(i + 1)}.${String(j + 1)}`, startDate: stage.startDate, endDateExclusive: stage.endDateExclusive, sortIndex: j, revision: 0, status: "Не начато", details: "" });
    }
  }
  d.viewPreferences = { ...d.viewPreferences, expandedProcessIds: [] };
  return snapshotSchema.parse(d);
}
