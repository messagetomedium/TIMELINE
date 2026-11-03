import { snapshotSchema } from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
export function cloneProject(source: Snapshot, id: () => string, clock: () => string, ids = new Map<string,string>()) {
    for (const value of [
      source.project,
      ...source.stages,
      ...source.lanes,
      ...source.processes,
      ...source.tasks,
      ...source.checkpoints,
      ...source.results,
      ...source.assignments,
    ])
      ids.set(value.id, id());
    // Replace UUID values only, never text that happens to contain an ID.
    const links = new Set([
      "id",
      "projectId",
      "stageId",
      "resultId",
      "targetId",
      "personId",
      "processId",
      "laneId",
      "expandedProcessIds",
    ]);
    const remap = (v: unknown, key = ""): unknown =>
      typeof v === "string" && links.has(key)
        ? (ids.get(v) ?? v)
        : Array.isArray(v)
          ? v.map((x) => remap(x, key))
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, remap(x, k)]),
              )
            : v;
    const d = snapshotSchema.parse(remap(source));
    const now = clock();
    d.project = {
      ...d.project,
      name: `${source.project.name} — копия`,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    return d;
}
