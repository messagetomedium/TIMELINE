import { hashPayload } from "./commandHash";
import type { Snapshot } from "../src/domain/v2/model";
import { entityId } from "../src/domain/v2/model";

export const projectScope = (id: string) => `p:${id}:*`;
export const processScope = (projectId: string, id: string) => `p:${projectId}:process:${id}`;
export function overlaps(a: readonly string[], b: readonly string[]) {
  return a.some((x) => b.some((y) => x === y || x.endsWith(":*") && y.startsWith(x.slice(0, -1)) || y.endsWith(":*") && x.startsWith(y.slice(0, -1))));
}
const collections = ["stages", "lanes", "processes", "tasks", "results", "resultPlacements", "checkpoints", "assignments"] as const;
const semantic = (value: object) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== "revision" && k !== "updatedAt"));
function states(d: Snapshot) {
  const state = new Map<string, object>([["project", semantic(d.project)]]);
  for (const key of collections) for (const row of d[key]) state.set(`${key}:${entityId(row)}`, semantic(row));
  return state;
}
function resource(d: Snapshot, key: string): string {
  const [kind, id] = key.split(":");
  const p = (pid: string) => processScope(d.project.id, pid);
  if (kind === "processes") return p(id ?? "");
  if (kind === "tasks") { const task = d.tasks.find((v) => v.id === id); if (task) return p(task.processId); }
  if (kind === "lanes") {
    const lane = d.lanes.find((v) => v.id === id);
    const pid = lane?.processId ?? d.processes.find((v) => v.laneId === id)?.id;
    if (pid) return p(pid);
  }
  if (kind === "checkpoints") return `p:${d.project.id}:checkpoint:${id ?? ""}`;
  if (kind === "assignments") {
    const a = d.assignments.find((v) => v.id === id);
    const pid = a?.kind === "process" ? a.targetId : d.tasks.find((v) => v.id === a?.targetId)?.processId;
    if (pid) return p(pid);
  }
  if (kind === "results" || kind === "resultPlacements") {
    const r = d.results.find((v) => v.id === id);
    if (r) return r.processId ? p(r.processId) : `p:${d.project.id}:results:${r.stageId}`;
  }
  return projectScope(d.project.id);
}
/** Derive locks from the authoritative planner's semantic before/after delta. */
export function leasePlan(before: Snapshot, after: Snapshot) {
  const a = states(before), b = states(after), resources = new Set<string>();
  const changed = [...new Set([...a.keys(), ...b.keys()])].sort().filter((key) => hashPayload(a.get(key) ?? null) !== hashPayload(b.get(key) ?? null));
  for (const key of changed) resources.add(resource(b.has(key) ? after : before, key));
  const ordered = resources.has(projectScope(before.project.id)) || resources.size > 256 ? [projectScope(before.project.id)] : [...resources].sort();
  return { resources: ordered, deltaHash: hashPayload(changed.map((key) => [key, b.get(key) ?? null])), basis: basis(before, ordered) };
}
export function basis(d: Snapshot, resources: string[]) {
  const values: Record<string, string> = {};
  for (const scope of resources) {
    if (scope === projectScope(d.project.id)) { values[scope] = hashPayload([...states(d)]); continue; }
    const prefix = `p:${d.project.id}:`, tail = scope.slice(prefix.length), id = tail.split(":")[1];
    if (tail.startsWith("process:")) {
      const process = d.processes.find((p) => p.id === id), tasks = d.tasks.filter((v) => v.processId === id), taskIds = new Set<string>(tasks.map((v) => v.id));
      const results = d.results.filter((v) => v.processId === id), resultIds = new Set(results.map((v) => v.id));
      const rows = [process, ...tasks, ...d.lanes.filter((v) => v.processId === id || v.id === process?.laneId), ...results,
        ...d.resultPlacements.filter((v) => resultIds.has(v.resultId)), ...d.assignments.filter((v) => v.kind === "process" ? v.targetId === id : taskIds.has(v.targetId))];
      values[scope] = hashPayload(rows.filter((v) => v !== undefined).map(semantic));
    } else if (tail.startsWith("checkpoint:")) values[scope] = hashPayload(d.checkpoints.filter((v) => v.id === id).map(semantic));
    else values[scope] = hashPayload(d.results.filter((v) => v.stageId === id).map(semantic));
  }
  values.boundaries = hashPayload(Object.fromEntries(Object.entries(semantic(d.project)).filter(([k]) => !["name", "description", "sortIndex", "createdAt", "creatorId"].includes(k))));
  values.stages = hashPayload(d.stages.map(semantic));
  return values;
}
