import { addDays, containsInterval, daysBetween } from "../dates";
import type { DateOnly } from "../dates";
import { laneIdSchema } from "../ids";
import type { Snapshot } from "./model";

export function effectiveActive(d: Pick<Snapshot, "processes">, w: { isActive: boolean; processId?: string }) {
  return w.isActive && (!w.processId || d.processes.some((p) => p.id === w.processId && p.isActive));
}
type Range = { startDate: DateOnly; endDateExclusive: DateOnly };
export type BoundaryEffect = "clip" | "deactivate";
function stagesInRange(d: Snapshot, range: Range) {
  const stages = [...d.stages].sort((a, b) => a.sortIndex - b.sortIndex);
  if (daysBetween(range.startDate, range.endDateExclusive) < stages.length)
    throw Error("Диапазон слишком короткий: каждому этапу нужен хотя бы один день. Сначала объедините этапы.");
  const edges = [range.startDate];
  for (let i = 1; i < stages.length; i++) {
    const old = stages[i]?.startDate;
    if (!old) throw Error("Этап не найден");
    const min = addDays(range.startDate, i), max = addDays(range.endDateExclusive, i - stages.length);
    edges.push(old < min ? min : old > max ? max : old);
  }
  edges.push(range.endDateExclusive);
  return stages.map((s, i) => ({ ...s, startDate: edges[i] ?? range.startDate, endDateExclusive: edges[i + 1] ?? range.endDateExclusive }));
}
export function rangeImpact(d: Snapshot, range: Range) {
  const stages = stagesInRange(d, range);
  return [...d.processes, ...d.tasks].filter((w) => {
    if (!effectiveActive(d, w)) return false;
    const parent = "stageId" in w ? stages.find((s) => s.id === w.stageId) : range;
    return !parent || !containsInterval(parent, w);
  });
}
export function resizeProjectRange(d: Snapshot, range: Range, effect?: BoundaryEffect) {
  if (range.startDate >= range.endDateExclusive) throw Error("Конец должен быть не раньше начала");
  if (rangeImpact(d, range).length && !effect) throw Error("Выберите: обрезать работы или сделать затронутые работы неактивными");
  const wasActive = new Set(d.tasks.filter((t) => effectiveActive(d, t)).map((t) => t.id));
  d.stages = stagesInRange(d, range);
  Object.assign(d.project, { startDate: range.startDate, endDateExclusive: range.endDateExclusive });
  const adjust = (w: Range & { isActive: boolean }, parent: Range) => {
    if (containsInterval(parent, w)) return;
    const startDate = w.startDate < parent.startDate ? parent.startDate : w.startDate;
    const endDateExclusive = w.endDateExclusive > parent.endDateExclusive ? parent.endDateExclusive : w.endDateExclusive;
    if (effect === "deactivate" || startDate >= endDateExclusive) w.isActive = false;
    else Object.assign(w, { startDate, endDateExclusive });
  };
  for (const p of d.processes) {
    const stage = d.stages.find((s) => s.id === p.stageId);
    if (p.isActive && stage) adjust(p, stage);
  }
  for (const t of d.tasks) {
    const p = d.processes.find((p) => p.id === t.processId);
    if (wasActive.has(t.id) && p) {
      if (p.isActive) adjust(t, p);
      else if (effect === "deactivate" && !containsInterval(range, t)) t.isActive = false;
    }
  }
}

/** Distance between date-only intervals; ties retain the earlier stage. */
export function rebindInactive(d: Snapshot) {
  const stages = [...d.stages].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const occupied = new Set([d.project.id, ...[d.stages, d.lanes, d.processes, d.tasks, d.results, d.checkpoints, d.assignments].flatMap((xs) => xs.map((x) => x.id))]);
  for (const p of d.processes.filter((p) => !p.isActive)) {
    const distance = (s: Range) => p.endDateExclusive <= s.startDate ? daysBetween(addDays(p.endDateExclusive, -1), s.startDate) : s.endDateExclusive <= p.startDate ? daysBetween(addDays(s.endDateExclusive, -1), p.startDate) : 0;
    const stage = stages.reduce((best, s) => !best || distance(s) < distance(best) ? s : best, stages[0]);
    if (!stage || p.stageId === stage.id) continue;
    let lane = d.lanes.find((l) => l.kind === "process" && l.id === p.laneId && d.processes.filter((w) => w.laneId === l.id).length === 1);
    if (lane?.kind === "process") lane.stageId = stage.id;
    else lane = d.lanes.find((l) => l.kind === "process" && l.stageId === stage.id && !d.processes.some((w) => w.laneId === l.id));
    if (!lane) {
      // Deterministic spare entity ID: preview and commit must produce the same row.
      let n = 0, id: string;
      do { id = `${(++n).toString(16).padStart(8, "0")}${p.id.slice(8)}`; } while (occupied.has(id));
      occupied.add(id);
      lane = { id: laneIdSchema.parse(id), workspaceId: p.workspaceId, projectId: p.projectId, kind: "process", stageId: stage.id, processId: null, sortIndex: d.lanes.filter((l) => l.kind === "process" && l.stageId === stage.id).length };
      d.lanes.push(lane);
    }
    p.stageId = stage.id; p.laneId = lane.id;
    for (const r of d.results) if (r.processId === p.id) r.stageId = stage.id;
  }
}
