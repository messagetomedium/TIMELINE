import { addDays } from "../dates";
import type { DateOnly } from "../dates";
import { snapshotSchema, WORKSPACE_ID } from "./model";
import type { Snapshot } from "./model";
export function createTemplate(
  name: string,
  description: string,
  start: DateOnly,
  id: () => string,
  now: string,
): Snapshot {
  const projectId = id(),
    scope = { workspaceId: WORKSPACE_ID, projectId };
  const stages = [0, 1].map((i) => ({
    ...scope,
    id: id(),
    title: `Этап ${String(i + 1)}`,
    description: "",
    startDate: addDays(start, i * 7),
    endDateExclusive: addDays(start, (i + 1) * 7),
    sortIndex: i,
    revision: 0,
  }));
  const lanes: unknown[] = [],
    processes: unknown[] = [],
    tasks: unknown[] = [];
  const expanded: string[] = [];
  for (const [i, s] of stages.entries())
    for (let j = 0; j < 2; j++) {
      const pid = id(),
        lid = id();
      expanded.push(pid);
      lanes.push({
        ...scope,
        id: lid,
        kind: "process",
        processId: null,
        stageId: s.id,
        sortIndex: i * 2 + j,
      });
      processes.push({
        ...scope,
        id: pid,
        laneId: lid,
        stageId: s.id,
        title: `Процесс ${String(i * 2 + j + 1)}`,
        startDate: s.startDate,
        endDateExclusive: addDays(s.startDate, 4),
        color: ["#678b72", "#b38560"][i],
        status: "Не начато",
        details: "",
        sortIndex: j,
        revision: 0,
      });
      const tl = id();
      lanes.push({
        ...scope,
        id: tl,
        kind: "task",
        processId: pid,
        sortIndex: 0,
      });
      for (let k = 0; k < 2; k++)
        tasks.push({
          ...scope,
          id: id(),
          processId: pid,
          laneId: tl,
          title: `Задача ${String(k + 1)}`,
          startDate: addDays(s.startDate, k * 2),
          endDateExclusive: addDays(s.startDate, k * 2 + 2),
          status: "Не начато",
          details: "",
          sortIndex: k,
          revision: 0,
        });
    }
  return snapshotSchema.parse({
    schemaVersion: 2,
    project: {
      id: projectId,
      workspaceId: WORKSPACE_ID,
      name,
      description,
      anchorDate: start,
      startDate: start,
      endDateExclusive: addDays(start, 14),
      sortIndex: 0,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      isScheduled: true,
      archivedAt: null,
      visibility: "workspace",
    },
    stages,
    lanes,
    processes,
    tasks,
    results: [],
    checkpoints: [
      {
        ...scope,
        id: id(),
        title: "Дедлайн",
        note: "",
        revision: 0,
        timing: { anchor: "free", date: addDays(start, 13) },
      },
    ],
    viewPreferences: {
      projectId,
      gridStep: "1w",
      zoomPxPerDay: 48,
      cameraX: 48,
      cameraY: 0,
      showWeekends: true,
      expandedProcessIds: expanded,
      expandedAssigneeGroupIds: [],
      showPeoplePanel: true,
    },
  });
}
